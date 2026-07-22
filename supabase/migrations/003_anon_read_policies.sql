-- ============================================
-- Temporary anon read policies
-- Remove these once Entra SSO authentication is in place
-- ============================================

CREATE POLICY "Anon can read expense claims (temp)" ON expense_claims FOR SELECT TO anon USING (true);
CREATE POLICY "Anon can read employees (temp)" ON employees FOR SELECT TO anon USING (true);
CREATE POLICY "Anon can read leave types (temp)" ON leave_types FOR SELECT TO anon USING (true);
CREATE POLICY "Anon can read leave balances (temp)" ON leave_balances FOR SELECT TO anon USING (true);
CREATE POLICY "Anon can read leave requests (temp)" ON leave_requests FOR SELECT TO anon USING (true);
CREATE POLICY "Anon can read payslips (temp)" ON payslips FOR SELECT TO anon USING (true);
CREATE POLICY "Anon can read kudos (temp)" ON kudos FOR SELECT TO anon USING (true);
CREATE POLICY "Anon can read benefits (temp)" ON benefits FOR SELECT TO anon USING (true);
CREATE POLICY "Anon can read employee benefits (temp)" ON employee_benefits FOR SELECT TO anon USING (true);
CREATE POLICY "Anon can read courses (temp)" ON courses FOR SELECT TO anon USING (true);
CREATE POLICY "Anon can read course enrolments (temp)" ON course_enrolments FOR SELECT TO anon USING (true);
CREATE POLICY "Anon can read performance reviews (temp)" ON performance_reviews FOR SELECT TO anon USING (true);
CREATE POLICY "Anon can read announcements (temp)" ON announcements FOR SELECT TO anon USING (true);
CREATE POLICY "Anon can read notifications (temp)" ON notifications FOR SELECT TO anon USING (true);
CREATE POLICY "Anon can read user settings (temp)" ON user_settings FOR SELECT TO anon USING (true);
