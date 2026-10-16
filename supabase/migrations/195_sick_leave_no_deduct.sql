-- 195: Enforce sick leave never deducts from allowance (UK Equality Act 2010)
-- Sick leave must not reduce annual leave entitlement under UK law.

UPDATE leave_types
SET deducts_from_allowance = false
WHERE LOWER(name) = 'sick leave'
  AND deducts_from_allowance IS DISTINCT FROM false;

-- Also delete any lingering sick leave balance rows (migration 194 should have done this,
-- but catch any created between then and now)
DELETE FROM leave_balances lb
USING leave_types lt
WHERE lb.leave_type_id = lt.id
  AND LOWER(lt.name) = 'sick leave';
