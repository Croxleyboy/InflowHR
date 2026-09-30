-- Allow super admins to delete trial requests
CREATE POLICY "Super admins can delete trial requests"
  ON trial_requests FOR DELETE
  TO authenticated
  USING (is_super_admin());
