-- Add token usage tracking to company_features for AI cost estimation
ALTER TABLE company_features
  ADD COLUMN IF NOT EXISTS monthly_tokens_used BIGINT DEFAULT 0;

-- Add token columns to ai_help_usage for per-employee daily tracking
ALTER TABLE ai_help_usage
  ADD COLUMN IF NOT EXISTS total_tokens INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS prompt_tokens INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS completion_tokens INT DEFAULT 0;

-- RPC to increment token usage atomically
CREATE OR REPLACE FUNCTION increment_ai_token_usage(
  p_company_id UUID,
  p_tokens BIGINT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE company_features
  SET monthly_tokens_used = COALESCE(monthly_tokens_used, 0) + p_tokens
  WHERE company_id = p_company_id
    AND feature_key = 'ai_help_agent';
END;
$$;
