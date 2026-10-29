-- Migration 240: Cancel delegation RPC
-- Fixes: manager cannot cancel their own delegation via RLS-restricted PostgREST update
-- Solution: SECURITY DEFINER RPC that verifies the caller is the delegator

CREATE OR REPLACE FUNCTION cancel_my_delegation(p_delegation_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  UPDATE approval_delegations
  SET is_active = false, updated_at = now()
  WHERE id = p_delegation_id
    AND delegator_id IN (
      SELECT e.id FROM employees e WHERE e.auth_user_id = auth.uid()
    )
    AND is_active = true;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count > 0;
END;
$$;

REVOKE EXECUTE ON FUNCTION cancel_my_delegation(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION cancel_my_delegation(UUID) TO authenticated;
