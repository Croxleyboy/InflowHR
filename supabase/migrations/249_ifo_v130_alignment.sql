-- Migration 249: InflowOnboarder v1.30 alignment
-- Adds functions_cache column to store per-function gating state from GET /v1/functions
-- and passes_available column to track whether passes are offered to this organisation.

ALTER TABLE inflowonboarder_integrations
  ADD COLUMN IF NOT EXISTS functions_cache JSONB DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS functions_cached_at TIMESTAMPTZ DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS passes_available BOOLEAN DEFAULT true;
