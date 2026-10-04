-- ── Tighten integration disconnect to company admins + super admins only ──────
-- Previously: Xero allowed any company user, Sage allowed admin only (no super admin),
-- Modulr allowed admin+hr (no super admin). All three should be: company admin OR super admin.

-- ── Xero ─────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Xero - company delete" ON xero_integrations;
CREATE POLICY "Xero - company admin delete" ON xero_integrations
  FOR DELETE
  USING (
    (company_id = get_my_company_id()
      AND EXISTS (
        SELECT 1 FROM company_users
        WHERE company_users.auth_user_id = auth.uid()
          AND company_users.company_id = xero_integrations.company_id
          AND company_users.role = 'admin'
          AND company_users.is_active = true
      )
    )
    OR is_super_admin()
  );

-- ── Sage ─────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Admins can delete sage_integrations" ON sage_integrations;
CREATE POLICY "Company admin can delete sage_integrations" ON sage_integrations
  FOR DELETE
  USING (
    (company_id = get_my_company_id()
      AND EXISTS (
        SELECT 1 FROM company_users
        WHERE company_users.auth_user_id = auth.uid()
          AND company_users.company_id = sage_integrations.company_id
          AND company_users.role = 'admin'
          AND company_users.is_active = true
      )
    )
    OR is_super_admin()
  );

-- ── Modulr ───────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Admins can delete modulr integration" ON modulr_integrations;
CREATE POLICY "Company admin can delete modulr integration" ON modulr_integrations
  FOR DELETE
  USING (
    (company_id = get_my_company_id()
      AND EXISTS (
        SELECT 1 FROM company_users
        WHERE company_users.auth_user_id = auth.uid()
          AND company_users.company_id = modulr_integrations.company_id
          AND company_users.role = 'admin'
          AND company_users.is_active = true
      )
    )
    OR is_super_admin()
  );
