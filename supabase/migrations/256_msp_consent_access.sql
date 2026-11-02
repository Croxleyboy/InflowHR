-- MSP Consent & Access Model Restructuring
-- 1. MSP company admins are first-class MSP Dashboard users
-- 2. Super admins do NOT get automatic MSP access — must be granted by the MSP
-- 3. Client companies must consent before an MSP can manage them (GDPR)

-- ============================================================
-- 1. Add GDPR consent columns to msp_managed_companies
-- ============================================================

ALTER TABLE msp_managed_companies
  ADD COLUMN IF NOT EXISTS consent_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (consent_status IN ('pending', 'approved', 'rejected')),
  ADD COLUMN IF NOT EXISTS consent_given_by UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS consent_given_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_msp_managed_consent
  ON msp_managed_companies(consent_status) WHERE is_active = true;


-- ============================================================
-- 2. Update is_msp_admin() — also true for admins of MSP companies
-- ============================================================

CREATE OR REPLACE FUNCTION is_msp_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    -- Route 1: explicit msp_user_access grant
    SELECT 1 FROM msp_user_access mua
    JOIN employees e ON e.id = mua.employee_id
    WHERE e.auth_user_id = auth.uid()
      AND mua.is_active = true
  )
  OR EXISTS (
    -- Route 2: admin of a company where is_msp = true
    SELECT 1 FROM company_users cu
    JOIN companies c ON c.id = cu.company_id
    WHERE cu.auth_user_id = auth.uid()
      AND cu.is_active = true
      AND cu.role = 'admin'
      AND c.is_msp = true
  );
$$;


-- ============================================================
-- 3. Update get_msp_company_id() — also returns MSP company for admins
-- ============================================================

CREATE OR REPLACE FUNCTION get_msp_company_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    -- Route 1: from msp_user_access
    (SELECT mua.msp_company_id FROM msp_user_access mua
     JOIN employees e ON e.id = mua.employee_id
     WHERE e.auth_user_id = auth.uid()
       AND mua.is_active = true
     LIMIT 1),
    -- Route 2: admin of MSP company
    (SELECT c.id FROM company_users cu
     JOIN companies c ON c.id = cu.company_id
     WHERE cu.auth_user_id = auth.uid()
       AND cu.is_active = true
       AND cu.role = 'admin'
       AND c.is_msp = true
     LIMIT 1)
  );
$$;


-- ============================================================
-- 4. Update is_my_company() — require approved consent for MSP access
-- ============================================================

CREATE OR REPLACE FUNCTION is_my_company(p_company_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM company_users
    WHERE auth_user_id = auth.uid()
      AND company_id = p_company_id
      AND is_active = true
  )
  OR (
    EXISTS (
      SELECT 1 FROM platform_settings
      WHERE key = 'msp_feature_enabled' AND value = 'true'
    )
    AND EXISTS (
      SELECT 1 FROM msp_user_access mua
      JOIN employees e ON e.id = mua.employee_id
      JOIN msp_managed_companies mmc ON mmc.msp_company_id = mua.msp_company_id
        AND mmc.managed_company_id = mua.managed_company_id
      WHERE e.auth_user_id = auth.uid()
        AND mua.managed_company_id = p_company_id
        AND mua.is_active = true
        AND mmc.is_active = true
        AND mmc.consent_status = 'approved'
    )
  );
$$;


-- ============================================================
-- 5. RPC: respond to MSP consent request (for client company admins)
-- ============================================================

CREATE OR REPLACE FUNCTION respond_to_msp_consent(
  p_msp_managed_id UUID,
  p_approved BOOLEAN
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_managed_company_id UUID;
BEGIN
  -- Look up the managed company row
  SELECT managed_company_id INTO v_managed_company_id
  FROM msp_managed_companies
  WHERE id = p_msp_managed_id AND is_active = true;

  IF v_managed_company_id IS NULL THEN
    RAISE EXCEPTION 'MSP relationship not found';
  END IF;

  -- Caller must be an admin of the managed (client) company
  IF NOT EXISTS (
    SELECT 1 FROM company_users cu
    WHERE cu.auth_user_id = auth.uid()
      AND cu.company_id = v_managed_company_id
      AND cu.is_active = true
      AND cu.role = 'admin'
  ) THEN
    RAISE EXCEPTION 'Only a company admin can respond to MSP consent requests';
  END IF;

  UPDATE msp_managed_companies
  SET consent_status = CASE WHEN p_approved THEN 'approved' ELSE 'rejected' END,
      consent_given_by = auth.uid(),
      consent_given_at = now()
  WHERE id = p_msp_managed_id;
END;
$$;


-- ============================================================
-- 6. Update RLS on msp_managed_companies — client company admins
--    can see and respond to consent requests for their company
-- ============================================================

CREATE POLICY "Client admins can view their MSP relationships"
  ON msp_managed_companies FOR SELECT
  USING (
    managed_company_id IN (
      SELECT cu.company_id FROM company_users cu
      WHERE cu.auth_user_id = auth.uid()
        AND cu.is_active = true
        AND cu.role = 'admin'
    )
  );

CREATE POLICY "Client admins can update consent on their MSP relationships"
  ON msp_managed_companies FOR UPDATE
  USING (
    managed_company_id IN (
      SELECT cu.company_id FROM company_users cu
      WHERE cu.auth_user_id = auth.uid()
        AND cu.is_active = true
        AND cu.role = 'admin'
    )
  )
  WITH CHECK (
    managed_company_id IN (
      SELECT cu.company_id FROM company_users cu
      WHERE cu.auth_user_id = auth.uid()
        AND cu.is_active = true
        AND cu.role = 'admin'
    )
  );


-- ============================================================
-- 7. MSP admins (company admins of MSP companies) can manage
--    their own msp_managed_companies rows
-- ============================================================

CREATE POLICY "MSP company admins can manage their managed companies"
  ON msp_managed_companies FOR ALL
  USING (
    msp_company_id IN (
      SELECT cu.company_id FROM company_users cu
      JOIN companies c ON c.id = cu.company_id
      WHERE cu.auth_user_id = auth.uid()
        AND cu.is_active = true
        AND cu.role = 'admin'
        AND c.is_msp = true
    )
  )
  WITH CHECK (
    msp_company_id IN (
      SELECT cu.company_id FROM company_users cu
      JOIN companies c ON c.id = cu.company_id
      WHERE cu.auth_user_id = auth.uid()
        AND cu.is_active = true
        AND cu.role = 'admin'
        AND c.is_msp = true
    )
  );


-- ============================================================
-- 8. MSP company admins can manage msp_user_access for their company
-- ============================================================

CREATE POLICY "MSP company admins can manage user access"
  ON msp_user_access FOR ALL
  USING (
    msp_company_id IN (
      SELECT cu.company_id FROM company_users cu
      JOIN companies c ON c.id = cu.company_id
      WHERE cu.auth_user_id = auth.uid()
        AND cu.is_active = true
        AND cu.role = 'admin'
        AND c.is_msp = true
    )
  )
  WITH CHECK (
    msp_company_id IN (
      SELECT cu.company_id FROM company_users cu
      JOIN companies c ON c.id = cu.company_id
      WHERE cu.auth_user_id = auth.uid()
        AND cu.is_active = true
        AND cu.role = 'admin'
        AND c.is_msp = true
    )
  );


-- ============================================================
-- 9. MSP company admins can write audit log entries
-- ============================================================

CREATE POLICY "MSP company admins can read their audit log"
  ON msp_audit_log FOR SELECT
  USING (
    msp_company_id IN (
      SELECT cu.company_id FROM company_users cu
      JOIN companies c ON c.id = cu.company_id
      WHERE cu.auth_user_id = auth.uid()
        AND cu.is_active = true
        AND cu.role = 'admin'
        AND c.is_msp = true
    )
  );

CREATE POLICY "MSP company admins can insert audit log"
  ON msp_audit_log FOR INSERT
  WITH CHECK (
    msp_company_id IN (
      SELECT cu.company_id FROM company_users cu
      JOIN companies c ON c.id = cu.company_id
      WHERE cu.auth_user_id = auth.uid()
        AND cu.is_active = true
        AND cu.role = 'admin'
        AND c.is_msp = true
    )
  );


-- ============================================================
-- 10. Backfill: set existing managed companies to approved
--     (they were linked before consent was required)
-- ============================================================

UPDATE msp_managed_companies
SET consent_status = 'approved',
    consent_given_at = added_at
WHERE consent_status = 'pending';
