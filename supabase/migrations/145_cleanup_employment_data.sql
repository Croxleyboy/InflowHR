-- 145: Clean up employment data across all existing companies
-- Enforces the three-way split: employed / shift worker / zero hours
-- 1. Sets employment_category based on work pattern type for unset employees
-- 2. Fixes contract_type for shift workers who have employed-style types
-- 3. Removes shift data from employed employees
-- 4. Removes timesheet data from shift workers
-- 5. Removes zero-hours-specific data from non-zero-hours shift workers
-- 6. Cleans up mismatched check-in records

-- ═══════════════════════════════════════════════════════════════
-- 1. Set employment_category from work pattern type where not assigned
-- ═══════════════════════════════════════════════════════════════

-- Employees with a fixed work pattern → employed
UPDATE employees e
SET employment_category = 'employed'
FROM work_patterns wp
WHERE e.work_pattern_id = wp.id
  AND wp.pattern_type = 'fixed'
  AND e.employment_category = 'not_assigned';

-- Employees with a variable work pattern → shift_worker
UPDATE employees e
SET employment_category = 'shift_worker'
FROM work_patterns wp
WHERE e.work_pattern_id = wp.id
  AND wp.pattern_type = 'variable'
  AND e.employment_category = 'not_assigned';

-- Employees with a shift worker contract_type but no category set
UPDATE employees
SET employment_category = 'shift_worker'
WHERE contract_type IN (
  'Full-time shift worker', 'Part-time shift worker',
  'Weekends shift worker', 'Zero hours shift worker'
)
AND employment_category = 'not_assigned';

-- Employees with an employed contract_type but no category set
UPDATE employees
SET employment_category = 'employed'
WHERE contract_type IN ('Full-time', 'Part-time', 'Student', 'Temporary')
AND employment_category = 'not_assigned'
AND work_pattern_id IS NULL;

-- ═══════════════════════════════════════════════════════════════
-- 2. Fix contract_type for shift workers with employed-style types
-- ═══════════════════════════════════════════════════════════════

-- Shift workers who still have an employed contract_type get defaulted
UPDATE employees
SET contract_type = 'Full-time shift worker'
WHERE employment_category = 'shift_worker'
  AND contract_type IN ('Full-time', 'Permanent')
  AND contract_type NOT IN (
    'Full-time shift worker', 'Part-time shift worker',
    'Weekends shift worker', 'Zero hours shift worker'
  );

UPDATE employees
SET contract_type = 'Part-time shift worker'
WHERE employment_category = 'shift_worker'
  AND contract_type = 'Part-time';

-- Clear working_pattern text field for shift workers (they use work_pattern_id instead)
UPDATE employees
SET working_pattern = NULL
WHERE employment_category = 'shift_worker'
  AND working_pattern IS NOT NULL
  AND working_pattern != '';

-- ═══════════════════════════════════════════════════════════════
-- 3. Remove shift data from employed employees
-- ═══════════════════════════════════════════════════════════════

-- Delete shift swap requests first (FK to shift_assignments)
DELETE FROM shift_swap_requests ssr
USING employees e
WHERE (ssr.requesting_employee_id = e.id OR ssr.target_employee_id = e.id)
  AND e.employment_category = 'employed';

-- Delete shift-source check-in records for employed employees
DELETE FROM checkin_records cr
USING employees e
WHERE cr.employee_id = e.id
  AND e.employment_category = 'employed'
  AND cr.source = 'shifts';

-- Delete shift assignments for employed employees
DELETE FROM shift_assignments sa
USING employees e
WHERE sa.employee_id = e.id
  AND e.employment_category = 'employed';

-- Delete employee availability for employed employees
DELETE FROM employee_availability ea
USING employees e
WHERE ea.employee_id = e.id
  AND e.employment_category = 'employed';

-- Delete employee shift skills for employed employees
DELETE FROM employee_shift_skills ess
USING employees e
WHERE ess.employee_id = e.id
  AND e.employment_category = 'employed';

-- ═══════════════════════════════════════════════════════════════
-- 4. Remove timesheet data from shift workers
-- ═══════════════════════════════════════════════════════════════

-- Delete timesheets for all shift workers (including zero hours)
DELETE FROM timesheets t
USING employees e
WHERE t.employee_id = e.id
  AND e.employment_category = 'shift_worker';

-- Delete timesheet-source check-in records for shift workers
DELETE FROM checkin_records cr
USING employees e
WHERE cr.employee_id = e.id
  AND e.employment_category = 'shift_worker'
  AND cr.source = 'timesheets';

-- ═══════════════════════════════════════════════════════════════
-- 5. Clean up zero hours / non-zero hours cross-contamination
-- ═══════════════════════════════════════════════════════════════

-- Delete swap requests that reference assignments about to be removed
DELETE FROM shift_swap_requests ssr
WHERE ssr.shift_assignment_id IN (
  SELECT sa.id FROM shift_assignments sa
  JOIN employees e ON sa.employee_id = e.id
  JOIN rotas r ON sa.rota_id = r.id
  WHERE e.employment_category = 'shift_worker'
    AND e.contract_type != 'Zero hours shift worker'
    AND r.shift_contract_type = 'Zero hours shift worker'
) OR ssr.target_shift_assignment_id IN (
  SELECT sa.id FROM shift_assignments sa
  JOIN employees e ON sa.employee_id = e.id
  JOIN rotas r ON sa.rota_id = r.id
  WHERE e.employment_category = 'shift_worker'
    AND e.contract_type != 'Zero hours shift worker'
    AND r.shift_contract_type = 'Zero hours shift worker'
) OR ssr.shift_assignment_id IN (
  SELECT sa.id FROM shift_assignments sa
  JOIN employees e ON sa.employee_id = e.id
  JOIN rotas r ON sa.rota_id = r.id
  WHERE e.employment_category = 'shift_worker'
    AND e.contract_type = 'Zero hours shift worker'
    AND r.shift_contract_type IS NOT NULL
    AND r.shift_contract_type != 'Zero hours shift worker'
) OR ssr.target_shift_assignment_id IN (
  SELECT sa.id FROM shift_assignments sa
  JOIN employees e ON sa.employee_id = e.id
  JOIN rotas r ON sa.rota_id = r.id
  WHERE e.employment_category = 'shift_worker'
    AND e.contract_type = 'Zero hours shift worker'
    AND r.shift_contract_type IS NOT NULL
    AND r.shift_contract_type != 'Zero hours shift worker'
);

-- For non-zero-hours shift workers: remove assignments on zero-hours rotas
DELETE FROM shift_assignments sa
USING employees e, rotas r
WHERE sa.employee_id = e.id
  AND sa.rota_id = r.id
  AND e.employment_category = 'shift_worker'
  AND e.contract_type != 'Zero hours shift worker'
  AND r.shift_contract_type = 'Zero hours shift worker';

-- For zero hours workers: remove assignments on non-zero-hours rotas
DELETE FROM shift_assignments sa
USING employees e, rotas r
WHERE sa.employee_id = e.id
  AND sa.rota_id = r.id
  AND e.employment_category = 'shift_worker'
  AND e.contract_type = 'Zero hours shift worker'
  AND r.shift_contract_type IS NOT NULL
  AND r.shift_contract_type != 'Zero hours shift worker';

-- Set weekly_hours to 0 for zero hours workers who have hours set
UPDATE employees
SET weekly_hours = 0
WHERE contract_type = 'Zero hours shift worker'
  AND weekly_hours IS NOT NULL
  AND weekly_hours > 0;
