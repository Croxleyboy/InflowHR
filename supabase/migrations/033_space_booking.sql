-- ============================================================
-- Desk & Space Booking — locations, floors, spaces, bookings,
-- and per-company settings.  All tables are company-scoped
-- with RLS via is_my_company().
-- ============================================================

-- 1. Locations (offices / sites)
CREATE TABLE locations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name        text NOT NULL,
  address     text,
  timezone    text DEFAULT 'Europe/London',
  is_active   boolean DEFAULT true,
  sort_order  int DEFAULT 0,
  created_at  timestamptz DEFAULT now()
);

ALTER TABLE locations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Company scoped read"   ON locations FOR SELECT USING (is_my_company(company_id) OR is_super_admin());
CREATE POLICY "Company scoped insert" ON locations FOR INSERT WITH CHECK (is_my_company(company_id) OR is_super_admin());
CREATE POLICY "Company scoped update" ON locations FOR UPDATE USING (is_my_company(company_id) OR is_super_admin());
CREATE POLICY "Company scoped delete" ON locations FOR DELETE USING (is_my_company(company_id) OR is_super_admin());

-- 2. Floors / zones within a location
CREATE TABLE floors (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id uuid NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  company_id  uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name        text NOT NULL,
  sort_order  int DEFAULT 0,
  created_at  timestamptz DEFAULT now()
);

ALTER TABLE floors ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Company scoped read"   ON floors FOR SELECT USING (is_my_company(company_id) OR is_super_admin());
CREATE POLICY "Company scoped insert" ON floors FOR INSERT WITH CHECK (is_my_company(company_id) OR is_super_admin());
CREATE POLICY "Company scoped update" ON floors FOR UPDATE USING (is_my_company(company_id) OR is_super_admin());
CREATE POLICY "Company scoped delete" ON floors FOR DELETE USING (is_my_company(company_id) OR is_super_admin());

-- 3. Spaces (desks or meeting rooms)
CREATE TABLE spaces (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  floor_id       uuid NOT NULL REFERENCES floors(id) ON DELETE CASCADE,
  name           text NOT NULL,
  space_type     text NOT NULL CHECK (space_type IN ('desk', 'room')),
  capacity       int DEFAULT 1,
  equipment_tags text[] DEFAULT '{}',
  status         text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'maintenance')),
  sort_order     int DEFAULT 0,
  created_at     timestamptz DEFAULT now()
);

ALTER TABLE spaces ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Company scoped read"   ON spaces FOR SELECT USING (is_my_company(company_id) OR is_super_admin());
CREATE POLICY "Company scoped insert" ON spaces FOR INSERT WITH CHECK (is_my_company(company_id) OR is_super_admin());
CREATE POLICY "Company scoped update" ON spaces FOR UPDATE USING (is_my_company(company_id) OR is_super_admin());
CREATE POLICY "Company scoped delete" ON spaces FOR DELETE USING (is_my_company(company_id) OR is_super_admin());

-- 4. Bookings
CREATE TABLE space_bookings (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  space_id       uuid NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  employee_id    uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  booking_date   date NOT NULL,
  start_time     time,
  end_time       time,
  title          text,
  attendees      text[] DEFAULT '{}',
  guests         text[] DEFAULT '{}',
  status         text NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'checked_in', 'cancelled', 'no_show')),
  checked_in_at  timestamptz,
  admin_modified_at timestamptz,
  created_at     timestamptz DEFAULT now()
);

ALTER TABLE space_bookings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Company scoped read"   ON space_bookings FOR SELECT USING (is_my_company(company_id) OR is_super_admin());
CREATE POLICY "Company scoped insert" ON space_bookings FOR INSERT WITH CHECK (is_my_company(company_id) OR is_super_admin());
CREATE POLICY "Company scoped update" ON space_bookings FOR UPDATE USING (is_my_company(company_id) OR is_super_admin());
CREATE POLICY "Company scoped delete" ON space_bookings FOR DELETE USING (is_my_company(company_id) OR is_super_admin());

-- Prevent double-booking: all bookings (desks and rooms) use time slots.
-- An exclusion constraint prevents overlapping time ranges on the same space+date.
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE space_bookings
  ADD CONSTRAINT space_bookings_no_overlap
  EXCLUDE USING gist (
    space_id WITH =,
    booking_date WITH =,
    tsrange(
      ('2000-01-01'::date + start_time)::timestamp,
      ('2000-01-01'::date + end_time)::timestamp,
      '[)'
    ) WITH &&
  )
  WHERE (start_time IS NOT NULL AND end_time IS NOT NULL AND status != 'cancelled');

-- 5. Space settings (per-company booking policies)
CREATE TABLE space_settings (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id              uuid NOT NULL UNIQUE REFERENCES companies(id) ON DELETE CASCADE,
  max_advance_days        int DEFAULT 30,
  auto_cancel_no_checkin  boolean DEFAULT false,
  auto_cancel_minutes     int DEFAULT 15,
  buffer_minutes          int DEFAULT 0,
  default_slot_minutes    int DEFAULT 60,
  created_at              timestamptz DEFAULT now()
);

ALTER TABLE space_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Company scoped read"   ON space_settings FOR SELECT USING (is_my_company(company_id) OR is_super_admin());
CREATE POLICY "Company scoped insert" ON space_settings FOR INSERT WITH CHECK (is_my_company(company_id) OR is_super_admin());
CREATE POLICY "Company scoped update" ON space_settings FOR UPDATE USING (is_my_company(company_id) OR is_super_admin());
CREATE POLICY "Company scoped delete" ON space_settings FOR DELETE USING (is_my_company(company_id) OR is_super_admin());

-- 6. Seed subscription_pricing row so it appears in Admin > Subscriptions
INSERT INTO subscription_pricing (feature_key, display_name, description, default_price, is_addon, is_active)
SELECT 'space_booking', 'Space Booking', 'Desk and meeting room booking for employees', 1.00, true, true
WHERE NOT EXISTS (
  SELECT 1 FROM subscription_pricing WHERE feature_key = 'space_booking'
);
