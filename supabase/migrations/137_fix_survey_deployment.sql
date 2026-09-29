-- Cancel duplicate active deployments before adding the constraint.
-- For each (company_id, survey_id) pair with multiple active deployments,
-- keep the most recent one and cancel the rest.
UPDATE survey_deployments d
SET status = 'cancelled'
WHERE d.status = 'active'
  AND d.id != (
    SELECT id FROM survey_deployments d2
    WHERE d2.company_id = d.company_id
      AND d2.survey_id = d.survey_id
      AND d2.status = 'active'
    ORDER BY d2.created_at DESC
    LIMIT 1
  );

-- Prevent duplicate active deployments of the same survey
CREATE UNIQUE INDEX IF NOT EXISTS idx_survey_deployments_unique_active
  ON survey_deployments (company_id, survey_id)
  WHERE status = 'active';
