-- Server-side data queries for AI help agents
-- AI picks a query template, the edge function executes it here, formats the
-- answer in code, and returns it. Zero user data is ever sent to the AI model.

CREATE OR REPLACE FUNCTION ai_data_query(
  p_query_type TEXT,
  p_company_id UUID,
  p_employee_id BIGINT,
  p_user_role TEXT,
  p_params JSONB DEFAULT '{}'::JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result JSONB;
  v_today DATE := CURRENT_DATE;
  v_dept TEXT;
  v_mgr_emp_id BIGINT;
  v_is_manager BOOLEAN;
BEGIN
  -- Look up the employee's department and manager_id for gating
  SELECT department, manager_id INTO v_dept, v_mgr_emp_id
  FROM employees WHERE id = p_employee_id AND company_id = p_company_id;

  -- Check if this employee manages anyone
  v_is_manager := EXISTS (
    SELECT 1 FROM employees
    WHERE manager_id = p_employee_id AND company_id = p_company_id
      AND employment_status = 'active'
  );

  -- ═══════════════════════════════════════════════════════════════════════
  -- EMPLOYEE-level queries (any role)
  -- ═══════════════════════════════════════════════════════════════════════

  IF p_query_type = 'my_probation_end' THEN
    SELECT jsonb_build_object(
      'first_name', e.first_name,
      'start_date', e.start_date,
      'probation_end', e.probation_end_date,
      'probation_months', COALESCE(
        (SELECT (s.value)::int FROM company_settings s
         WHERE s.company_id = p_company_id AND s.key = 'probation_months'),
        6
      )
    ) INTO v_result
    FROM employees e WHERE e.id = p_employee_id AND e.company_id = p_company_id;
    RETURN COALESCE(v_result, '{"error":"not_found"}'::JSONB);
  END IF;

  IF p_query_type = 'my_documents_pending' THEN
    SELECT jsonb_build_object(
      'pending_count', COUNT(*) FILTER (WHERE ed.status = 'pending'),
      'expired_count', COUNT(*) FILTER (WHERE ed.expiry_date < v_today),
      'total', COUNT(*)
    ) INTO v_result
    FROM employee_documents ed
    WHERE ed.employee_id = p_employee_id AND ed.company_id = p_company_id;
    RETURN COALESCE(v_result, '{"pending_count":0,"expired_count":0,"total":0}'::JSONB);
  END IF;

  IF p_query_type = 'my_pending_approvals' THEN
    SELECT jsonb_build_object(
      'leave_requests', (
        SELECT COUNT(*) FROM leave_requests lr
        WHERE lr.employee_id = p_employee_id AND lr.company_id = p_company_id
          AND lr.status = 'pending'
      ),
      'expense_claims', (
        SELECT COUNT(*) FROM expense_claims ec
        WHERE ec.employee_id = p_employee_id AND ec.company_id = p_company_id
          AND ec.status = 'submitted'
      )
    ) INTO v_result;
    RETURN v_result;
  END IF;

  IF p_query_type = 'team_on_leave_today' THEN
    -- Any employee can see who in their department is off today (first names only)
    SELECT jsonb_build_object(
      'date', v_today,
      'department', v_dept,
      'colleagues', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'first_name', e.first_name,
          'last_initial', LEFT(e.last_name, 1),
          'leave_type', lt.name
        ))
        FROM leave_requests lr
        JOIN employees e ON e.id = lr.employee_id
        JOIN leave_types lt ON lt.id = lr.leave_type_id
        WHERE lr.company_id = p_company_id
          AND lr.status = 'approved'
          AND v_today BETWEEN lr.start_date AND lr.end_date
          AND e.department = v_dept
          AND e.id != p_employee_id
          AND e.employment_status = 'active'
      ), '[]'::JSONB)
    ) INTO v_result;
    RETURN v_result;
  END IF;

  IF p_query_type = 'upcoming_team_birthdays' THEN
    SELECT jsonb_build_object(
      'birthdays', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'first_name', e.first_name,
          'last_initial', LEFT(e.last_name, 1),
          'date', TO_CHAR(
            MAKE_DATE(EXTRACT(YEAR FROM v_today)::INT, EXTRACT(MONTH FROM e.date_of_birth)::INT, EXTRACT(DAY FROM e.date_of_birth)::INT),
            'DD Mon'
          )
        ) ORDER BY
          MAKE_DATE(EXTRACT(YEAR FROM v_today)::INT, EXTRACT(MONTH FROM e.date_of_birth)::INT, EXTRACT(DAY FROM e.date_of_birth)::INT)
        )
        FROM employees e
        WHERE e.company_id = p_company_id
          AND e.department = v_dept
          AND e.employment_status = 'active'
          AND e.date_of_birth IS NOT NULL
          AND MAKE_DATE(EXTRACT(YEAR FROM v_today)::INT, EXTRACT(MONTH FROM e.date_of_birth)::INT, EXTRACT(DAY FROM e.date_of_birth)::INT)
            BETWEEN v_today AND v_today + INTERVAL '30 days'
      ), '[]'::JSONB)
    ) INTO v_result;
    RETURN v_result;
  END IF;

  -- ═══════════════════════════════════════════════════════════════════════
  -- MANAGER-level queries (role = admin/hr OR is_manager)
  -- ═══════════════════════════════════════════════════════════════════════

  IF p_query_type = 'my_team_pending_leave' THEN
    IF NOT (p_user_role IN ('admin', 'hr') OR v_is_manager) THEN
      RETURN '{"error":"forbidden","message":"Only managers, HR and admins can view team leave requests."}'::JSONB;
    END IF;
    SELECT jsonb_build_object(
      'pending_requests', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'first_name', e.first_name,
          'last_initial', LEFT(e.last_name, 1),
          'leave_type', lt.name,
          'start_date', lr.start_date,
          'end_date', lr.end_date,
          'days', lr.days_requested
        ) ORDER BY lr.start_date)
        FROM leave_requests lr
        JOIN employees e ON e.id = lr.employee_id
        JOIN leave_types lt ON lt.id = lr.leave_type_id
        WHERE lr.company_id = p_company_id
          AND lr.status = 'pending'
          AND e.manager_id = p_employee_id
          AND e.employment_status = 'active'
      ), '[]'::JSONB)
    ) INTO v_result;
    RETURN v_result;
  END IF;

  IF p_query_type = 'my_team_elearning_incomplete' THEN
    IF NOT (p_user_role IN ('admin', 'hr') OR v_is_manager) THEN
      RETURN '{"error":"forbidden","message":"Only managers, HR and admins can view team training progress."}'::JSONB;
    END IF;
    SELECT jsonb_build_object(
      'incomplete', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'first_name', e.first_name,
          'last_initial', LEFT(e.last_name, 1),
          'course', c.title,
          'progress', en.progress_pct
        ) ORDER BY en.progress_pct)
        FROM elearning_enrolments en
        JOIN employees e ON e.id = en.employee_id
        JOIN elearning_courses c ON c.id = en.course_id
        WHERE en.company_id = p_company_id
          AND en.status != 'completed'
          AND e.manager_id = p_employee_id
          AND e.employment_status = 'active'
      ), '[]'::JSONB)
    ) INTO v_result;
    RETURN v_result;
  END IF;

  IF p_query_type = 'my_team_absence_days' THEN
    IF NOT (p_user_role IN ('admin', 'hr') OR v_is_manager) THEN
      RETURN '{"error":"forbidden","message":"Only managers, HR and admins can view team absence data."}'::JSONB;
    END IF;
    SELECT jsonb_build_object(
      'period', jsonb_build_object(
        'start', DATE_TRUNC('month', v_today - INTERVAL '3 months')::DATE,
        'end', v_today
      ),
      'team_members', (
        SELECT COUNT(*) FROM employees e
        WHERE e.manager_id = p_employee_id AND e.company_id = p_company_id
          AND e.employment_status = 'active'
      ),
      'total_absence_days', COALESCE((
        SELECT SUM(lr.days_requested)
        FROM leave_requests lr
        JOIN employees e ON e.id = lr.employee_id
        WHERE lr.company_id = p_company_id
          AND lr.status = 'approved'
          AND e.manager_id = p_employee_id
          AND e.employment_status = 'active'
          AND lr.start_date >= DATE_TRUNC('month', v_today - INTERVAL '3 months')::DATE
      ), 0)
    ) INTO v_result;
    RETURN v_result;
  END IF;

  -- ═══════════════════════════════════════════════════════════════════════
  -- ADMIN/HR-level queries
  -- ═══════════════════════════════════════════════════════════════════════

  IF p_query_type = 'company_headcount' THEN
    IF p_user_role NOT IN ('admin', 'hr') THEN
      RETURN '{"error":"forbidden","message":"Only HR and admins can view company headcount."}'::JSONB;
    END IF;
    SELECT jsonb_build_object(
      'total_active', COUNT(*) FILTER (WHERE e.employment_status = 'active'),
      'by_department', (
        SELECT jsonb_object_agg(COALESCE(dept, 'Unassigned'), cnt)
        FROM (
          SELECT e2.department AS dept, COUNT(*) AS cnt
          FROM employees e2
          WHERE e2.company_id = p_company_id AND e2.employment_status = 'active'
          GROUP BY e2.department
        ) sub
      ),
      'by_employment_type', (
        SELECT jsonb_object_agg(COALESCE(cat, 'Unspecified'), cnt)
        FROM (
          SELECT e3.employment_category AS cat, COUNT(*) AS cnt
          FROM employees e3
          WHERE e3.company_id = p_company_id AND e3.employment_status = 'active'
          GROUP BY e3.employment_category
        ) sub
      )
    ) INTO v_result
    FROM employees e WHERE e.company_id = p_company_id;
    RETURN v_result;
  END IF;

  IF p_query_type = 'company_absence_rate' THEN
    IF p_user_role NOT IN ('admin', 'hr') THEN
      RETURN '{"error":"forbidden","message":"Only HR and admins can view company absence rates."}'::JSONB;
    END IF;
    SELECT jsonb_build_object(
      'month', TO_CHAR(DATE_TRUNC('month', v_today), 'Mon YYYY'),
      'headcount', (
        SELECT COUNT(*) FROM employees e
        WHERE e.company_id = p_company_id AND e.employment_status = 'active'
      ),
      'total_absence_days', COALESCE((
        SELECT SUM(lr.days_requested)
        FROM leave_requests lr
        WHERE lr.company_id = p_company_id
          AND lr.status = 'approved'
          AND lr.start_date >= DATE_TRUNC('month', v_today)::DATE
          AND lr.start_date <= v_today
      ), 0),
      'sick_days', COALESCE((
        SELECT SUM(lr.days_requested)
        FROM leave_requests lr
        JOIN leave_types lt ON lt.id = lr.leave_type_id
        WHERE lr.company_id = p_company_id
          AND lr.status = 'approved'
          AND LOWER(lt.name) LIKE '%sick%'
          AND lr.start_date >= DATE_TRUNC('month', v_today)::DATE
          AND lr.start_date <= v_today
      ), 0)
    ) INTO v_result;
    RETURN v_result;
  END IF;

  IF p_query_type = 'company_on_leave_today' THEN
    IF p_user_role NOT IN ('admin', 'hr') THEN
      RETURN '{"error":"forbidden","message":"Only HR and admins can view company-wide leave."}'::JSONB;
    END IF;
    SELECT jsonb_build_object(
      'date', v_today,
      'on_leave', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'first_name', e.first_name,
          'last_initial', LEFT(e.last_name, 1),
          'department', e.department,
          'leave_type', lt.name
        ) ORDER BY e.department, e.first_name)
        FROM leave_requests lr
        JOIN employees e ON e.id = lr.employee_id
        JOIN leave_types lt ON lt.id = lr.leave_type_id
        WHERE lr.company_id = p_company_id
          AND lr.status = 'approved'
          AND v_today BETWEEN lr.start_date AND lr.end_date
          AND e.employment_status = 'active'
      ), '[]'::JSONB),
      'count', (
        SELECT COUNT(DISTINCT lr.employee_id)
        FROM leave_requests lr
        JOIN employees e ON e.id = lr.employee_id
        WHERE lr.company_id = p_company_id
          AND lr.status = 'approved'
          AND v_today BETWEEN lr.start_date AND lr.end_date
          AND e.employment_status = 'active'
      )
    ) INTO v_result;
    RETURN v_result;
  END IF;

  IF p_query_type = 'company_new_starters' THEN
    IF p_user_role NOT IN ('admin', 'hr') THEN
      RETURN '{"error":"forbidden","message":"Only HR and admins can view new starter information."}'::JSONB;
    END IF;
    SELECT jsonb_build_object(
      'period', 'Last 30 days',
      'new_starters', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'first_name', e.first_name,
          'last_initial', LEFT(e.last_name, 1),
          'department', e.department,
          'job_title', e.job_title,
          'start_date', e.start_date
        ) ORDER BY e.start_date DESC)
        FROM employees e
        WHERE e.company_id = p_company_id
          AND e.employment_status = 'active'
          AND e.start_date >= v_today - INTERVAL '30 days'
          AND e.start_date <= v_today
      ), '[]'::JSONB)
    ) INTO v_result;
    RETURN v_result;
  END IF;

  IF p_query_type = 'company_probation_due' THEN
    IF p_user_role NOT IN ('admin', 'hr') THEN
      RETURN '{"error":"forbidden","message":"Only HR and admins can view probation data."}'::JSONB;
    END IF;
    SELECT jsonb_build_object(
      'in_probation', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'first_name', e.first_name,
          'last_initial', LEFT(e.last_name, 1),
          'department', e.department,
          'probation_end', e.probation_end_date
        ) ORDER BY e.probation_end_date)
        FROM employees e
        WHERE e.company_id = p_company_id
          AND e.employment_status = 'active'
          AND e.probation_end_date IS NOT NULL
          AND e.probation_end_date >= v_today
          AND e.probation_end_date <= v_today + INTERVAL '60 days'
      ), '[]'::JSONB)
    ) INTO v_result;
    RETURN v_result;
  END IF;

  -- Unknown query type
  RETURN jsonb_build_object('error', 'unknown_query', 'message', 'Unrecognised query type: ' || p_query_type);
END;
$$;

REVOKE EXECUTE ON FUNCTION ai_data_query(TEXT, UUID, BIGINT, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION ai_data_query(TEXT, UUID, BIGINT, TEXT, JSONB) TO service_role;
