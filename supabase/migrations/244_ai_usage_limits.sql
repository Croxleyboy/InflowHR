-- Migration 244: AI Usage Limits
-- Adds monthly query cap per company for the AI Help Agent, tracked and enforced at the edge function.
-- Super admins set the monthly_query_limit; company admins see usage.

-- ── Add monthly limit + period reset to company_features ──────────────────────
ALTER TABLE company_features
  ADD COLUMN IF NOT EXISTS monthly_query_limit INT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS monthly_queries_used INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS usage_period_start DATE NOT NULL DEFAULT date_trunc('month', CURRENT_DATE)::date;

-- ── Helper: get current-month AI usage for a company ──────────────────────────
CREATE OR REPLACE FUNCTION get_ai_usage(p_company_id UUID)
RETURNS TABLE(queries_used INT, monthly_limit INT, period_start DATE, period_end DATE, is_capped BOOLEAN)
LANGUAGE plpgsql SECURITY DEFINER STABLE
AS $$
DECLARE
  v_limit INT;
  v_used INT;
  v_period_start DATE;
BEGIN
  SELECT cf.monthly_query_limit, cf.monthly_queries_used, cf.usage_period_start
  INTO v_limit, v_used, v_period_start
  FROM company_features cf
  WHERE cf.company_id = p_company_id AND cf.feature_key = 'ai_help_agent';

  IF NOT FOUND THEN
    queries_used := 0; monthly_limit := NULL; period_start := date_trunc('month', CURRENT_DATE)::date;
    period_end := (date_trunc('month', CURRENT_DATE) + interval '1 month' - interval '1 day')::date;
    is_capped := false;
    RETURN NEXT;
    RETURN;
  END IF;

  -- Auto-reset if we're in a new month
  IF v_period_start < date_trunc('month', CURRENT_DATE)::date THEN
    UPDATE company_features
    SET monthly_queries_used = 0,
        usage_period_start = date_trunc('month', CURRENT_DATE)::date
    WHERE company_id = p_company_id AND feature_key = 'ai_help_agent';
    v_used := 0;
    v_period_start := date_trunc('month', CURRENT_DATE)::date;
  END IF;

  queries_used := v_used;
  monthly_limit := v_limit;
  period_start := v_period_start;
  period_end := (date_trunc('month', v_period_start) + interval '1 month' - interval '1 day')::date;
  is_capped := v_limit IS NOT NULL AND v_used >= v_limit;
  RETURN NEXT;
  RETURN;
END;
$$;

-- ── RPC to increment usage counter (called by edge function) ──────────────────
CREATE OR REPLACE FUNCTION increment_ai_usage(p_company_id UUID)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  -- Auto-reset if new month
  UPDATE company_features
  SET monthly_queries_used = CASE
        WHEN usage_period_start < date_trunc('month', CURRENT_DATE)::date THEN 1
        ELSE monthly_queries_used + 1
      END,
      usage_period_start = CASE
        WHEN usage_period_start < date_trunc('month', CURRENT_DATE)::date THEN date_trunc('month', CURRENT_DATE)::date
        ELSE usage_period_start
      END
  WHERE company_id = p_company_id AND feature_key = 'ai_help_agent';
END;
$$;
