-- Engine Schedule Lifecycle Sync
-- Tracks cancel/change actions InflowHR must send to the InflowOnboarder engine.
-- Three layers: immediate cancel (UI), pre-delete queue (SQL RPC), self-healing reconciliation (cron).

-- ══════════════════════════════════════════════════════════════════
-- 1. Sync table
-- ══════════════════════════════════════════════════════════════════

CREATE TABLE engine_schedule_sync (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id      UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  kind            TEXT NOT NULL CHECK (kind IN ('joiner','leaver','mover','persona')),
  action          TEXT NOT NULL CHECK (action IN ('cancel','change')),
  record_id       BIGINT NOT NULL,
  schedule_id     TEXT,
  external_ref    TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','in_progress','completed','failed','needs_review','dismissed')),
  attempts        INT NOT NULL DEFAULT 0,
  last_attempt_at TIMESTAMPTZ,
  last_error      TEXT,
  next_retry_at   TIMESTAMPTZ DEFAULT now(),
  change_payload  JSONB,
  source          TEXT NOT NULL DEFAULT 'ui'
                    CHECK (source IN ('ui','rpc','cron','reconcile')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at    TIMESTAMPTZ,
  deleted_at      TIMESTAMPTZ,
  reviewed_by     TEXT,
  review_note     TEXT
);

-- Indexes
CREATE INDEX idx_sync_pending ON engine_schedule_sync (company_id, next_retry_at)
  WHERE status IN ('pending','in_progress','failed') AND deleted_at IS NULL;

CREATE INDEX idx_sync_needs_review ON engine_schedule_sync (company_id)
  WHERE status = 'needs_review' AND deleted_at IS NULL;

CREATE INDEX idx_sync_external_ref ON engine_schedule_sync (external_ref)
  WHERE deleted_at IS NULL;

-- RLS (same pattern as M365 action tables)
ALTER TABLE engine_schedule_sync ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sync_select" ON engine_schedule_sync FOR SELECT USING (
  company_id = get_my_company_id() OR is_super_admin()
);

CREATE POLICY "sync_insert" ON engine_schedule_sync FOR INSERT WITH CHECK (
  (company_id = get_my_company_id() AND is_company_admin()) OR is_super_admin()
);

CREATE POLICY "sync_update" ON engine_schedule_sync FOR UPDATE USING (
  (company_id = get_my_company_id() AND is_company_admin()) OR is_super_admin()
);

CREATE POLICY "sync_delete" ON engine_schedule_sync FOR DELETE USING (
  is_super_admin()
);

-- ══════════════════════════════════════════════════════════════════
-- 2. Add external_ref columns to M365 action tables
-- ══════════════════════════════════════════════════════════════════

ALTER TABLE onboarding_m365_actions
  ADD COLUMN IF NOT EXISTS external_ref TEXT;

ALTER TABLE offboarding_m365_actions
  ADD COLUMN IF NOT EXISTS external_ref TEXT;

ALTER TABLE mover_m365_actions
  ADD COLUMN IF NOT EXISTS external_ref TEXT,
  ADD COLUMN IF NOT EXISTS persona_external_ref TEXT;

-- ══════════════════════════════════════════════════════════════════
-- 3. Queue function — called inside delete_employee_permanently
--    BEFORE cascade deletes destroy M365 action rows
-- ══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION queue_engine_schedule_cancels(p_employee_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company_id UUID;
  v_terminal   TEXT[] := ARRAY['completed','cancelled','failed','missed','declined'];
  v_rec        RECORD;
BEGIN
  SELECT company_id INTO v_company_id FROM employees WHERE id = p_employee_id;
  IF v_company_id IS NULL THEN RETURN; END IF;

  -- Joiner schedules
  FOR v_rec IN
    SELECT om.onboarding_id AS record_id,
           om.schedule_id,
           COALESCE(om.external_ref, 'starter-' || om.onboarding_id) AS ext_ref
    FROM onboarding_m365_actions om
    JOIN onboarding o ON o.id = om.onboarding_id
    WHERE o.employee_id = p_employee_id
      AND om.schedule_id IS NOT NULL
      AND om.schedule_status IS NOT NULL
      AND om.schedule_status != ALL(v_terminal)
  LOOP
    INSERT INTO engine_schedule_sync (company_id, kind, action, record_id, schedule_id, external_ref, source)
    VALUES (v_company_id, 'joiner', 'cancel', v_rec.record_id, v_rec.schedule_id, v_rec.ext_ref, 'rpc')
    ON CONFLICT DO NOTHING;
  END LOOP;

  -- Leaver schedules
  FOR v_rec IN
    SELECT om.offboarding_id AS record_id,
           om.schedule_id,
           COALESCE(om.external_ref, 'leaver-' || om.offboarding_id) AS ext_ref
    FROM offboarding_m365_actions om
    JOIN offboarding o ON o.id = om.offboarding_id
    WHERE o.employee_id = p_employee_id
      AND om.schedule_id IS NOT NULL
      AND om.schedule_status IS NOT NULL
      AND om.schedule_status != ALL(v_terminal)
  LOOP
    INSERT INTO engine_schedule_sync (company_id, kind, action, record_id, schedule_id, external_ref, source)
    VALUES (v_company_id, 'leaver', 'cancel', v_rec.record_id, v_rec.schedule_id, v_rec.ext_ref, 'rpc')
    ON CONFLICT DO NOTHING;
  END LOOP;

  -- Mover schedules (both mover and persona)
  FOR v_rec IN
    SELECT mm.role_change_id AS record_id,
           mm.schedule_id,
           mm.schedule_status,
           COALESCE(mm.external_ref, 'move-' || mm.role_change_id) AS ext_ref,
           mm.persona_schedule_id,
           mm.persona_schedule_status,
           COALESCE(mm.persona_external_ref, 'move-persona-' || mm.role_change_id) AS persona_ext_ref
    FROM mover_m365_actions mm
    JOIN role_changes rc ON rc.id = mm.role_change_id
    WHERE rc.employee_id = p_employee_id
  LOOP
    -- Mover schedule
    IF v_rec.schedule_id IS NOT NULL
       AND v_rec.schedule_status IS NOT NULL
       AND v_rec.schedule_status != ALL(v_terminal) THEN
      INSERT INTO engine_schedule_sync (company_id, kind, action, record_id, schedule_id, external_ref, source)
      VALUES (v_company_id, 'mover', 'cancel', v_rec.record_id, v_rec.schedule_id, v_rec.ext_ref, 'rpc')
      ON CONFLICT DO NOTHING;
    END IF;

    -- Persona schedule
    IF v_rec.persona_schedule_id IS NOT NULL
       AND v_rec.persona_schedule_status IS NOT NULL
       AND v_rec.persona_schedule_status != ALL(v_terminal) THEN
      INSERT INTO engine_schedule_sync (company_id, kind, action, record_id, schedule_id, external_ref, source)
      VALUES (v_company_id, 'persona', 'cancel', v_rec.record_id, v_rec.persona_schedule_id, v_rec.persona_ext_ref, 'rpc')
      ON CONFLICT DO NOTHING;
    END IF;
  END LOOP;
END;
$$;

-- ══════════════════════════════════════════════════════════════════
-- 4. Modify delete_employee_permanently to queue cancels first
-- ══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION delete_employee_permanently(p_employee_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_emp              record;
  v_company_id       uuid;
  v_frozen           record;
  v_cert_ref         text;
  v_counts           jsonb := '{}'::jsonb;
  v_deleted          integer;
  v_categories       jsonb := '[]'::jsonb;
  v_offboarding      record;
BEGIN
  IF NOT (is_super_admin() OR current_user = 'postgres') THEN
    RAISE EXCEPTION 'Only super admin or postgres can call this function';
  END IF;

  SELECT * INTO v_emp FROM employees WHERE id = p_employee_id;
  IF v_emp IS NULL THEN
    RAISE EXCEPTION 'Employee not found';
  END IF;
  v_company_id := v_emp.company_id;

  -- ── Queue engine schedule cancellations BEFORE cascade deletes ──
  PERFORM queue_engine_schedule_cancels(p_employee_id);

  SELECT * INTO v_frozen FROM frozen_employees
    WHERE employee_id = p_employee_id AND status = 'awaiting_expiry'
    LIMIT 1;

  SELECT * INTO v_offboarding FROM offboarding
    WHERE employee_id = p_employee_id
    ORDER BY created_at DESC LIMIT 1;

  v_cert_ref := 'DEL-' || to_char(now(), 'YYYYMMDD') || '-' || substr(md5(p_employee_id::text || now()::text), 1, 8);

  -- ── Count data per category before deletion (for certificate) ──
  SELECT count(*) INTO v_deleted FROM leave_requests WHERE employee_id = p_employee_id;
  IF v_deleted > 0 THEN v_counts := v_counts || jsonb_build_object('leave_requests', v_deleted); v_categories := v_categories || '"leave_requests"'::jsonb; END IF;

  SELECT count(*) INTO v_deleted FROM leave_balances WHERE employee_id = p_employee_id;
  IF v_deleted > 0 THEN v_counts := v_counts || jsonb_build_object('leave_balances', v_deleted); v_categories := v_categories || '"leave_balances"'::jsonb; END IF;

  SELECT count(*) INTO v_deleted FROM payslips WHERE employee_id = p_employee_id;
  IF v_deleted > 0 THEN v_counts := v_counts || jsonb_build_object('payslips', v_deleted); v_categories := v_categories || '"payslips"'::jsonb; END IF;

  SELECT count(*) INTO v_deleted FROM expense_claims WHERE employee_id = p_employee_id;
  IF v_deleted > 0 THEN v_counts := v_counts || jsonb_build_object('expense_claims', v_deleted); v_categories := v_categories || '"expense_claims"'::jsonb; END IF;

  SELECT count(*) INTO v_deleted FROM timesheets WHERE employee_id = p_employee_id;
  IF v_deleted > 0 THEN v_counts := v_counts || jsonb_build_object('timesheets', v_deleted); v_categories := v_categories || '"timesheets"'::jsonb; END IF;

  SELECT count(*) INTO v_deleted FROM shift_assignments WHERE employee_id = p_employee_id;
  IF v_deleted > 0 THEN v_counts := v_counts || jsonb_build_object('shift_assignments', v_deleted); v_categories := v_categories || '"shift_assignments"'::jsonb; END IF;

  SELECT count(*) INTO v_deleted FROM performance_reviews WHERE employee_id = p_employee_id;
  IF v_deleted > 0 THEN v_counts := v_counts || jsonb_build_object('performance_reviews', v_deleted); v_categories := v_categories || '"performance_reviews"'::jsonb; END IF;

  SELECT count(*) INTO v_deleted FROM employee_benefits WHERE employee_id = p_employee_id;
  IF v_deleted > 0 THEN v_counts := v_counts || jsonb_build_object('employee_benefits', v_deleted); v_categories := v_categories || '"employee_benefits"'::jsonb; END IF;

  SELECT count(*) INTO v_deleted FROM space_bookings WHERE employee_id = p_employee_id;
  IF v_deleted > 0 THEN v_counts := v_counts || jsonb_build_object('space_bookings', v_deleted); v_categories := v_categories || '"space_bookings"'::jsonb; END IF;

  SELECT count(*) INTO v_deleted FROM notifications WHERE employee_id = p_employee_id;
  IF v_deleted > 0 THEN v_counts := v_counts || jsonb_build_object('notifications', v_deleted); v_categories := v_categories || '"notifications"'::jsonb; END IF;

  SELECT count(*) INTO v_deleted FROM kudos WHERE from_employee_id = p_employee_id OR to_employee_id = p_employee_id;
  IF v_deleted > 0 THEN v_counts := v_counts || jsonb_build_object('kudos', v_deleted); v_categories := v_categories || '"kudos"'::jsonb; END IF;

  SELECT count(*) INTO v_deleted FROM one_to_one_meetings WHERE employee_id = p_employee_id OR manager_id = p_employee_id;
  IF v_deleted > 0 THEN v_counts := v_counts || jsonb_build_object('one_to_one_meetings', v_deleted); v_categories := v_categories || '"one_to_one_meetings"'::jsonb; END IF;

  SELECT count(*) INTO v_deleted FROM course_enrolments WHERE employee_id = p_employee_id;
  IF v_deleted > 0 THEN v_counts := v_counts || jsonb_build_object('course_enrolments', v_deleted); v_categories := v_categories || '"course_enrolments"'::jsonb; END IF;

  SELECT count(*) INTO v_deleted FROM onboarding WHERE employee_id = p_employee_id;
  IF v_deleted > 0 THEN v_counts := v_counts || jsonb_build_object('onboarding', v_deleted); v_categories := v_categories || '"onboarding"'::jsonb; END IF;

  SELECT count(*) INTO v_deleted FROM offboarding WHERE employee_id = p_employee_id;
  IF v_deleted > 0 THEN v_counts := v_counts || jsonb_build_object('offboarding', v_deleted); v_categories := v_categories || '"offboarding"'::jsonb; END IF;

  -- ── Create the deletion certificate BEFORE destroying data ──
  INSERT INTO deletion_certificates (
    company_id, employee_name, employee_email, employee_id,
    leaving_date, leaving_reason, frozen_at, deleted_at,
    retention_days, data_export_provided, data_categories_held,
    deletion_summary, certificate_reference
  ) VALUES (
    v_company_id,
    COALESCE(v_emp.first_name, '') || ' ' || COALESCE(v_emp.last_name, ''),
    COALESCE(v_emp.email, ''),
    p_employee_id,
    v_emp.leaving_date,
    COALESCE(v_offboarding.reason, NULL),
    COALESCE(v_frozen.frozen_at, NULL),
    now(),
    30 + COALESCE(v_frozen.extension_days, 0),
    COALESCE(v_frozen.data_export_url IS NOT NULL, false),
    v_categories,
    v_counts,
    v_cert_ref
  );

  -- ── Delete ALL related data (order: dependents first) ──

  -- M365 offboarding actions (depends on offboarding)
  DELETE FROM offboarding_m365_actions WHERE offboarding_id IN
    (SELECT id FROM offboarding WHERE employee_id = p_employee_id);

  -- Tables without ON DELETE CASCADE — must delete explicitly
  DELETE FROM expense_line_items WHERE expense_claim_id IN
    (SELECT id FROM expense_claims WHERE employee_id = p_employee_id);
  DELETE FROM expense_claims WHERE employee_id = p_employee_id;
  DELETE FROM leave_requests WHERE employee_id = p_employee_id;
  DELETE FROM leave_balances WHERE employee_id = p_employee_id;
  DELETE FROM payslips WHERE employee_id = p_employee_id;
  DELETE FROM kudos WHERE from_employee_id = p_employee_id OR to_employee_id = p_employee_id;
  DELETE FROM employee_benefits WHERE employee_id = p_employee_id;
  DELETE FROM course_enrolments WHERE employee_id = p_employee_id;
  DELETE FROM performance_reviews WHERE employee_id = p_employee_id;
  DELETE FROM notifications WHERE employee_id = p_employee_id;
  DELETE FROM user_settings WHERE employee_id = p_employee_id;
  DELETE FROM one_to_one_comments WHERE meeting_id IN
    (SELECT id FROM one_to_one_meetings WHERE employee_id = p_employee_id OR manager_id = p_employee_id);
  DELETE FROM one_to_one_meetings WHERE employee_id = p_employee_id OR manager_id = p_employee_id;
  DELETE FROM space_bookings WHERE employee_id = p_employee_id;
  DELETE FROM timesheets WHERE employee_id = p_employee_id;
  DELETE FROM shift_assignments WHERE employee_id = p_employee_id;
  DELETE FROM onboarding WHERE employee_id = p_employee_id;
  DELETE FROM offboarding WHERE employee_id = p_employee_id;

  -- Tables with ON DELETE CASCADE — delete explicitly for completeness
  DELETE FROM employee_skills WHERE employee_id = p_employee_id;
  DELETE FROM skill_evidence WHERE employee_id = p_employee_id;
  DELETE FROM employee_certifications WHERE employee_id = p_employee_id;
  DELETE FROM employee_career_aspirations WHERE employee_id = p_employee_id;
  DELETE FROM skill_validations WHERE employee_id = p_employee_id;
  DELETE FROM employee_languages WHERE employee_id = p_employee_id;
  DELETE FROM break_records WHERE checkin_id IN
    (SELECT id FROM checkin_records WHERE employee_id = p_employee_id);
  DELETE FROM checkin_records WHERE employee_id = p_employee_id;
  DELETE FROM employee_documents WHERE employee_id = p_employee_id;
  DELETE FROM employee_consents WHERE employee_id = p_employee_id;
  DELETE FROM survey_responses WHERE employee_id = p_employee_id;
  DELETE FROM elearning_completions WHERE employee_id = p_employee_id;
  DELETE FROM elearning_progress WHERE employee_id = p_employee_id;
  DELETE FROM pay_period_reviews WHERE employee_id = p_employee_id;
  DELETE FROM shift_corrections WHERE employee_id = p_employee_id;
  DELETE FROM payroll_adjustments WHERE employee_id = p_employee_id;
  DELETE FROM modulr_payment_items WHERE employee_id = p_employee_id;
  DELETE FROM predictable_hours_requests WHERE employee_id = p_employee_id;
  DELETE FROM shift_cancellation_log WHERE employee_id = p_employee_id;
  DELETE FROM holiday_accrual_log WHERE employee_id = p_employee_id;
  DELETE FROM employee_shift_skills WHERE employee_id = p_employee_id;
  DELETE FROM admin_portal_access WHERE employee_id = p_employee_id;
  DELETE FROM user_preferences WHERE employee_id = p_employee_id;
  DELETE FROM legal_timesheet_timers WHERE employee_id = p_employee_id;
  DELETE FROM employee_custom_field_values WHERE employee_id = p_employee_id;
  DELETE FROM help_search_logs WHERE employee_id = p_employee_id;
  DELETE FROM ai_help_usage WHERE employee_id = p_employee_id;
  DELETE FROM sick_leave_episode_requests WHERE episode_id IN
    (SELECT id FROM sick_leave_episodes WHERE employee_id = p_employee_id);
  DELETE FROM sick_leave_episodes WHERE employee_id = p_employee_id;
  DELETE FROM payroll_audit_log WHERE employee_id = p_employee_id;

  -- Company users (login record)
  DELETE FROM company_users WHERE employee_id = p_employee_id;

  -- Frozen employees queue
  DELETE FROM frozen_employees WHERE employee_id = p_employee_id;

  -- Finally, delete the employee record itself
  DELETE FROM employees WHERE id = p_employee_id;

  -- Log the permanent deletion
  PERFORM log_gdpr_action(
    v_company_id, 'employees', p_employee_id::text, 'PERMANENT_DELETE',
    NULL, NULL, NULL,
    jsonb_build_object(
      'type', 'right_to_erasure',
      'article', 'Art. 17 GDPR',
      'certificate_ref', v_cert_ref,
      'employee_name', COALESCE(v_emp.first_name, '') || ' ' || COALESCE(v_emp.last_name, ''),
      'data_deleted', v_counts,
      'reason', 'Retention period expired — all data permanently deleted'
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'employee_id', p_employee_id,
    'company_id', v_company_id,
    'certificate_ref', v_cert_ref,
    'data_deleted', v_counts
  );
END;
$$;

GRANT EXECUTE ON FUNCTION delete_employee_permanently(uuid) TO authenticated;

-- ══════════════════════════════════════════════════════════════════
-- 5. pg_cron job — 12-hourly sync agent via pg_net
-- ══════════════════════════════════════════════════════════════════

-- NOTE: This requires pg_net extension (available in Supabase by default).
-- The cron job calls the inflowonboarder-sync edge function.
-- Run this separately in the Supabase SQL editor after deploying the edge function:
--
-- SELECT cron.schedule(
--   'engine-schedule-sync',
--   '0 */12 * * *',
--   $$SELECT net.http_post(
--     url := current_setting('app.settings.supabase_url') || '/functions/v1/inflowonboarder-sync',
--     headers := jsonb_build_object(
--       'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key'),
--       'Content-Type', 'application/json'
--     ),
--     body := '{"action":"process-and-reconcile"}'::jsonb
--   )$$
-- );

-- Rollback:
--   SELECT cron.unschedule('engine-schedule-sync');
--   DROP FUNCTION IF EXISTS queue_engine_schedule_cancels(UUID);
--   DROP TABLE IF EXISTS engine_schedule_sync;
--   ALTER TABLE onboarding_m365_actions DROP COLUMN IF EXISTS external_ref;
--   ALTER TABLE offboarding_m365_actions DROP COLUMN IF EXISTS external_ref;
--   ALTER TABLE mover_m365_actions DROP COLUMN IF EXISTS external_ref;
--   ALTER TABLE mover_m365_actions DROP COLUMN IF EXISTS persona_external_ref;
