-- SEC-26: Lock down user_settings — remove overly permissive anon read policy
-- Replace with authenticated-only policy scoped to the employee's own row
DROP POLICY IF EXISTS "anon_company_read_user_settings" ON user_settings;
DROP POLICY IF EXISTS "Anon can read user settings (temp)" ON user_settings;

CREATE POLICY "Own settings read" ON user_settings
  FOR SELECT TO authenticated
  USING (employee_id IN (
    SELECT id FROM employees WHERE auth_user_id = auth.uid()
  ));

CREATE POLICY "Own settings write" ON user_settings
  FOR ALL TO authenticated
  USING (employee_id IN (
    SELECT id FROM employees WHERE auth_user_id = auth.uid()
  ))
  WITH CHECK (employee_id IN (
    SELECT id FROM employees WHERE auth_user_id = auth.uid()
  ));
