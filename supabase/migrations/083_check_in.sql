-- ============================================================================
-- 083 — Check-In System
-- Geolocation-based attendance tracking for Timesheets and Shifts & Rotas.
-- Tables: work_locations, checkin_settings, checkin_records, break_records
-- RPC: cancel_current_month_checkins (used when admin disables check-in)
-- ============================================================================

-- ─── WORK LOCATIONS ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS work_locations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name          text NOT NULL,
  address       text,
  latitude      double precision NOT NULL,
  longitude     double precision NOT NULL,
  radius_metres int NOT NULL DEFAULT 200,
  allow_remote  boolean NOT NULL DEFAULT false,
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, name)
);

ALTER TABLE work_locations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "wl_select" ON work_locations FOR SELECT USING (can_access_company(company_id));
CREATE POLICY "wl_insert" ON work_locations FOR INSERT
  WITH CHECK (can_access_company(company_id) AND (is_company_admin() OR is_super_admin()));
CREATE POLICY "wl_update" ON work_locations FOR UPDATE
  USING (can_access_company(company_id) AND (is_company_admin() OR is_super_admin()));
CREATE POLICY "wl_delete" ON work_locations FOR DELETE
  USING (can_access_company(company_id) AND (is_company_admin() OR is_super_admin()));

CREATE INDEX idx_work_locations_company ON work_locations(company_id);

-- ─── CHECK-IN SETTINGS ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS checkin_settings (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id                  uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  timesheets_checkin_enabled  boolean NOT NULL DEFAULT false,
  shifts_checkin_enabled      boolean NOT NULL DEFAULT false,
  allow_work_from_home        boolean NOT NULL DEFAULT false,
  auto_checkout_hours         int NOT NULL DEFAULT 10,
  prompt_before_shift_mins    int NOT NULL DEFAULT 20,
  allowed_departments         text[] DEFAULT NULL,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id)
);

ALTER TABLE checkin_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cs_select" ON checkin_settings FOR SELECT USING (can_access_company(company_id));
CREATE POLICY "cs_insert" ON checkin_settings FOR INSERT
  WITH CHECK (can_access_company(company_id) AND (is_company_admin() OR is_super_admin()));
CREATE POLICY "cs_update" ON checkin_settings FOR UPDATE
  USING (can_access_company(company_id) AND (is_company_admin() OR is_super_admin()));
CREATE POLICY "cs_delete" ON checkin_settings FOR DELETE
  USING (can_access_company(company_id) AND (is_company_admin() OR is_super_admin()));

-- ─── CHECK-IN RECORDS ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS checkin_records (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  employee_id           uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  check_in_at           timestamptz NOT NULL DEFAULT now(),
  check_out_at          timestamptz,
  check_in_lat          double precision,
  check_in_lng          double precision,
  check_out_lat         double precision,
  check_out_lng         double precision,
  check_in_location_id  uuid REFERENCES work_locations(id) ON DELETE SET NULL,
  check_out_location_id uuid REFERENCES work_locations(id) ON DELETE SET NULL,
  source                text NOT NULL CHECK (source IN ('timesheets', 'shifts')),
  shift_assignment_id   uuid,
  status                text NOT NULL DEFAULT 'checked_in' CHECK (status IN ('checked_in', 'checked_out', 'auto_closed', 'cancelled')),
  work_from_home        boolean NOT NULL DEFAULT false,
  notes                 text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE checkin_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cr_select" ON checkin_records FOR SELECT
  USING (can_access_company(company_id));
CREATE POLICY "cr_insert" ON checkin_records FOR INSERT
  WITH CHECK (
    company_id = get_my_company_id()
    AND employee_id IN (
      SELECT employee_id FROM company_users
      WHERE auth_user_id = auth.uid() AND is_active = true AND employee_id IS NOT NULL
    )
  );
CREATE POLICY "cr_update_own" ON checkin_records FOR UPDATE
  USING (
    company_id = get_my_company_id()
    AND (
      employee_id IN (
        SELECT employee_id FROM company_users
        WHERE auth_user_id = auth.uid() AND is_active = true AND employee_id IS NOT NULL
      )
      OR is_company_admin()
      OR is_super_admin()
    )
  );
CREATE POLICY "cr_delete" ON checkin_records FOR DELETE
  USING (can_access_company(company_id) AND (is_company_admin() OR is_super_admin()));

CREATE INDEX idx_checkin_records_company ON checkin_records(company_id);
CREATE INDEX idx_checkin_records_employee ON checkin_records(employee_id);
CREATE INDEX idx_checkin_records_checkin ON checkin_records(check_in_at);
CREATE INDEX idx_checkin_records_source ON checkin_records(source);
CREATE INDEX idx_checkin_records_status ON checkin_records(status);

-- ─── BREAK RECORDS ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS break_records (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  checkin_record_id uuid NOT NULL REFERENCES checkin_records(id) ON DELETE CASCADE,
  company_id        uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  break_start       timestamptz NOT NULL DEFAULT now(),
  break_end         timestamptz,
  break_type        text NOT NULL DEFAULT 'short' CHECK (break_type IN ('lunch', 'short', 'other')),
  created_at        timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE break_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY "br_select" ON break_records FOR SELECT
  USING (can_access_company(company_id));
CREATE POLICY "br_insert" ON break_records FOR INSERT
  WITH CHECK (
    company_id = get_my_company_id()
    AND checkin_record_id IN (
      SELECT cr.id FROM checkin_records cr
      WHERE cr.employee_id IN (
        SELECT employee_id FROM company_users
        WHERE auth_user_id = auth.uid() AND is_active = true AND employee_id IS NOT NULL
      )
    )
  );
CREATE POLICY "br_update" ON break_records FOR UPDATE
  USING (
    company_id = get_my_company_id()
    AND (
      checkin_record_id IN (
        SELECT cr.id FROM checkin_records cr
        WHERE cr.employee_id IN (
          SELECT employee_id FROM company_users
          WHERE auth_user_id = auth.uid() AND is_active = true AND employee_id IS NOT NULL
        )
      )
      OR is_company_admin()
      OR is_super_admin()
    )
  );

CREATE INDEX idx_break_records_checkin ON break_records(checkin_record_id);

-- ─── CANCEL CURRENT MONTH CHECK-INS RPC ────────────────────────────────────
-- Called by admin when disabling check-in for a source. Cancels (not deletes)
-- all current-month records for that source, preserving historical data.
CREATE OR REPLACE FUNCTION cancel_current_month_checkins(
  p_company_id uuid,
  p_source text
)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_count int;
BEGIN
  IF NOT (is_company_admin() OR is_super_admin()) THEN
    RAISE EXCEPTION 'Forbidden: admin access required';
  END IF;

  IF p_source NOT IN ('timesheets', 'shifts') THEN
    RAISE EXCEPTION 'Invalid source: must be timesheets or shifts';
  END IF;

  UPDATE checkin_records
  SET status = 'cancelled',
      check_out_at = COALESCE(check_out_at, now()),
      updated_at = now()
  WHERE company_id = p_company_id
    AND source = p_source
    AND check_in_at >= date_trunc('month', now())
    AND status IN ('checked_in', 'checked_out');

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- ─── SEED DEFAULT SETTINGS ─────────────────────────────────────────────────
-- Create a checkin_settings row for every company that doesn't have one yet
-- (both flags off by default)
INSERT INTO checkin_settings (company_id)
SELECT id FROM companies
WHERE id NOT IN (SELECT company_id FROM checkin_settings)
ON CONFLICT (company_id) DO NOTHING;
