-- Migration 269: AI Query Type Tracking
-- Adds per-query-type counters and token breakdown for cost estimation.
-- Three query types: deterministic (no AI), ai_classifier (question text only), ai_formatter (AI formats pre-gathered text).

-- ── Add query type counters + token breakdown to company_features ──
ALTER TABLE company_features
  ADD COLUMN IF NOT EXISTS monthly_deterministic_queries INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS monthly_ai_classifier_queries INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS monthly_ai_formatter_queries INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS monthly_prompt_tokens BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS monthly_completion_tokens BIGINT NOT NULL DEFAULT 0;

-- ── Add query_type to ai_help_usage for per-employee breakdown ──
ALTER TABLE ai_help_usage
  ADD COLUMN IF NOT EXISTS deterministic_queries INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ai_classifier_queries INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ai_formatter_queries INT NOT NULL DEFAULT 0;

-- ── Updated increment_ai_usage: now accepts query type ──
CREATE OR REPLACE FUNCTION increment_ai_usage(p_company_id UUID, p_query_type TEXT DEFAULT 'deterministic')
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  UPDATE company_features
  SET monthly_queries_used = CASE
        WHEN usage_period_start < date_trunc('month', CURRENT_DATE)::date THEN 1
        ELSE monthly_queries_used + 1
      END,
      monthly_deterministic_queries = CASE
        WHEN usage_period_start < date_trunc('month', CURRENT_DATE)::date THEN
          CASE WHEN p_query_type = 'deterministic' THEN 1 ELSE 0 END
        ELSE monthly_deterministic_queries + CASE WHEN p_query_type = 'deterministic' THEN 1 ELSE 0 END
      END,
      monthly_ai_classifier_queries = CASE
        WHEN usage_period_start < date_trunc('month', CURRENT_DATE)::date THEN
          CASE WHEN p_query_type = 'ai_classifier' THEN 1 ELSE 0 END
        ELSE monthly_ai_classifier_queries + CASE WHEN p_query_type = 'ai_classifier' THEN 1 ELSE 0 END
      END,
      monthly_ai_formatter_queries = CASE
        WHEN usage_period_start < date_trunc('month', CURRENT_DATE)::date THEN
          CASE WHEN p_query_type = 'ai_formatter' THEN 1 ELSE 0 END
        ELSE monthly_ai_formatter_queries + CASE WHEN p_query_type = 'ai_formatter' THEN 1 ELSE 0 END
      END,
      usage_period_start = CASE
        WHEN usage_period_start < date_trunc('month', CURRENT_DATE)::date THEN date_trunc('month', CURRENT_DATE)::date
        ELSE usage_period_start
      END
  WHERE company_id = p_company_id AND feature_key = 'ai_help_agent';
END;
$$;

-- ── Updated increment_ai_token_usage: now tracks prompt + completion separately ──
CREATE OR REPLACE FUNCTION increment_ai_token_usage(
  p_company_id UUID,
  p_tokens BIGINT,
  p_prompt_tokens BIGINT DEFAULT 0,
  p_completion_tokens BIGINT DEFAULT 0
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE company_features
  SET monthly_tokens_used = CASE
        WHEN usage_period_start < date_trunc('month', CURRENT_DATE)::date THEN p_tokens
        ELSE COALESCE(monthly_tokens_used, 0) + p_tokens
      END,
      monthly_prompt_tokens = CASE
        WHEN usage_period_start < date_trunc('month', CURRENT_DATE)::date THEN p_prompt_tokens
        ELSE COALESCE(monthly_prompt_tokens, 0) + p_prompt_tokens
      END,
      monthly_completion_tokens = CASE
        WHEN usage_period_start < date_trunc('month', CURRENT_DATE)::date THEN p_completion_tokens
        ELSE COALESCE(monthly_completion_tokens, 0) + p_completion_tokens
      END
  WHERE company_id = p_company_id
    AND feature_key = 'ai_help_agent';
END;
$$;
