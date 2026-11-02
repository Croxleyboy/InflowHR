-- MSP Invite Expiry & Super Admin Oversight
-- 1. Add consent_expires_at to msp_managed_companies
-- 2. Update respond_to_msp_consent to reject expired invites
-- 3. Add super admin SELECT policy on msp_managed_companies

-- ============================================================
-- 1. Add consent expiry column
-- ============================================================

ALTER TABLE msp_managed_companies
  ADD COLUMN IF NOT EXISTS consent_expires_at TIMESTAMPTZ;

-- Backfill: set expiry on existing pending rows to 14 days from added_at
UPDATE msp_managed_companies
SET consent_expires_at = added_at + INTERVAL '14 days'
WHERE consent_expires_at IS NULL;

-- ============================================================
-- 2. Update respond_to_msp_consent to check expiry
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
  v_expires_at TIMESTAMPTZ;
  v_consent_status TEXT;
BEGIN
  SELECT managed_company_id, consent_expires_at, consent_status
  INTO v_managed_company_id, v_expires_at, v_consent_status
  FROM msp_managed_companies
  WHERE id = p_msp_managed_id AND is_active = true;

  IF v_managed_company_id IS NULL THEN
    RAISE EXCEPTION 'MSP relationship not found';
  END IF;

  IF v_consent_status != 'pending' THEN
    RAISE EXCEPTION 'This consent request has already been responded to';
  END IF;

  IF v_expires_at IS NOT NULL AND v_expires_at < now() THEN
    RAISE EXCEPTION 'This consent request has expired. The MSP will need to send a new invitation.';
  END IF;

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
-- 3. Super admin can view ALL msp_managed_companies rows
-- ============================================================

CREATE POLICY "Super admins can view all MSP relationships"
  ON msp_managed_companies FOR SELECT
  USING (is_super_admin());
