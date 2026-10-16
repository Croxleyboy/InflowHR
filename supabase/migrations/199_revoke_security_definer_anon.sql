-- Migration 199: Lock down SECURITY DEFINER functions (CWE-862)
-- Finding #9:  Five SECURITY DEFINER functions have no REVOKE from anon/public.
-- Finding #10: delete_company_data() lost its REVOKE when recreated in migration 186.

-- ── Finding #9: accrue_holiday_hours (migration 176) ──
REVOKE ALL ON FUNCTION public.accrue_holiday_hours(UUID, UUID, INT, NUMERIC) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.accrue_holiday_hours(UUID, UUID, INT, NUMERIC) FROM anon;
GRANT EXECUTE ON FUNCTION public.accrue_holiday_hours(UUID, UUID, INT, NUMERIC) TO authenticated;

-- ── Finding #9: get_zero_hours_service_weeks (migration 177) ──
REVOKE ALL ON FUNCTION public.get_zero_hours_service_weeks(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_zero_hours_service_weeks(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_zero_hours_service_weeks(UUID) TO authenticated;

-- ── Finding #9: get_zero_hours_avg_weekly_hours (migration 177) ──
REVOKE ALL ON FUNCTION public.get_zero_hours_avg_weekly_hours(UUID, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_zero_hours_avg_weekly_hours(UUID, INTEGER) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_zero_hours_avg_weekly_hours(UUID, INTEGER) TO authenticated;

-- ── Finding #9: get_zero_hours_ytd_earnings (migration 177) ──
REVOKE ALL ON FUNCTION public.get_zero_hours_ytd_earnings(UUID, DATE) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_zero_hours_ytd_earnings(UUID, DATE) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_zero_hours_ytd_earnings(UUID, DATE) TO authenticated;

-- ── Finding #9: calc_bradford_factor (migration 194) ──
REVOKE ALL ON FUNCTION public.calc_bradford_factor(UUID, UUID, DATE, DATE) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.calc_bradford_factor(UUID, UUID, DATE, DATE) FROM anon;
GRANT EXECUTE ON FUNCTION public.calc_bradford_factor(UUID, UUID, DATE, DATE) TO authenticated;

-- ── Finding #10: delete_company_data (recreated in migration 186 without REVOKE) ──
REVOKE EXECUTE ON FUNCTION public.delete_company_data(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.delete_company_data(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.delete_company_data(UUID) TO authenticated;
