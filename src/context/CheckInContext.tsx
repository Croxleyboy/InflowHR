import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './AuthContext'
import { getCurrentPosition, matchLocation, type WorkLocation, type Coords } from '../lib/geolocation'

export interface CheckinSettings {
  id: string
  company_id: string
  timesheets_checkin_enabled: boolean
  shifts_checkin_enabled: boolean
  allow_work_from_home: boolean
  auto_checkout_hours: number
  prompt_before_shift_mins: number
  allowed_departments: string[] | null
}

export interface CheckinRecord {
  id: string
  employee_id: string
  check_in_at: string
  check_out_at: string | null
  check_in_lat: number | null
  check_in_lng: number | null
  check_in_location_id: string | null
  check_out_location_id: string | null
  source: 'timesheets' | 'shifts'
  shift_assignment_id: string | null
  status: 'checked_in' | 'checked_out' | 'auto_closed' | 'cancelled'
  work_from_home: boolean
  notes: string | null
  company_id: string
}

export interface BreakRecord {
  id: string
  checkin_record_id: string
  break_start: string
  break_end: string | null
  break_type: 'lunch' | 'short' | 'other'
}

interface CheckInState {
  settings: CheckinSettings | null
  workLocations: WorkLocation[]
  activeCheckin: CheckinRecord | null
  activeBreak: BreakRecord | null
  loading: boolean
  checkIn: (source: 'timesheets' | 'shifts', shiftAssignmentId?: string, wfhOverride?: boolean) => Promise<{ ok: boolean; error?: string; wfh?: boolean }>
  checkOut: () => Promise<{ ok: boolean; error?: string }>
  startBreak: (type: 'lunch' | 'short' | 'other') => Promise<{ ok: boolean; error?: string }>
  endBreak: () => Promise<{ ok: boolean; error?: string }>
  reload: () => Promise<void>
}

const CheckInContext = createContext<CheckInState | null>(null)

export function useCheckIn() {
  const ctx = useContext(CheckInContext)
  if (!ctx) throw new Error('useCheckIn must be used within CheckInProvider')
  return ctx
}

export function CheckInProvider({ children }: { children: ReactNode }) {
  const { companyUser, employeeId } = useAuth()
  const companyId = companyUser?.company_id || null

  const [settings, setSettings] = useState<CheckinSettings | null>(null)
  const [workLocations, setWorkLocations] = useState<WorkLocation[]>([])
  const [activeCheckin, setActiveCheckin] = useState<CheckinRecord | null>(null)
  const [activeBreak, setActiveBreak] = useState<BreakRecord | null>(null)
  const [loading, setLoading] = useState(true)

  const reload = useCallback(async () => {
    if (!companyId || !employeeId) return
    setLoading(true)
    const [settingsRes, locsRes, checkinRes] = await Promise.all([
      supabase.from('checkin_settings').select('*').eq('company_id', companyId).single(),
      supabase.from('work_locations').select('*').eq('company_id', companyId).eq('is_active', true).order('name'),
      supabase.from('checkin_records').select('*').eq('employee_id', employeeId).eq('status', 'checked_in').order('check_in_at', { ascending: false }).limit(1),
    ])
    if (settingsRes.data) setSettings(settingsRes.data)
    if (locsRes.data) setWorkLocations(locsRes.data.map(l => ({
      id: l.id, name: l.name, latitude: l.latitude, longitude: l.longitude,
      radius_metres: l.radius_metres, allow_remote: l.allow_remote,
    })))
    const active = checkinRes.data?.[0] || null
    setActiveCheckin(active)
    if (active) {
      const { data: brk } = await supabase.from('break_records')
        .select('*').eq('checkin_record_id', active.id)
        .is('break_end', null).limit(1)
      setActiveBreak(brk?.[0] || null)
    } else {
      setActiveBreak(null)
    }
    setLoading(false)
  }, [companyId, employeeId])

  useEffect(() => { reload() }, [reload])

  const getLocation = useCallback(async (): Promise<{ coords: Coords | null; location: WorkLocation | null; wfh: boolean } | { error: string }> => {
    try {
      const pos = await getCurrentPosition()
      const coords: Coords = { lat: pos.coords.latitude, lng: pos.coords.longitude }
      const loc = matchLocation(coords, workLocations)
      if (loc) return { coords, location: loc, wfh: false }
      if (settings?.allow_work_from_home) return { coords, location: null, wfh: true }
      if (workLocations.length === 0) return { coords, location: null, wfh: false }
      return { error: 'You are not at a registered work location. Please check in on-site.' }
    } catch (err: unknown) {
      if (settings?.allow_work_from_home) return { coords: null, location: null, wfh: true }
      const msg = err instanceof GeolocationPositionError
        ? err.code === 1 ? 'Location permission denied. Please enable location services or contact your admin about work-from-home check-in.'
          : 'Unable to determine your location. Please try again.'
        : 'Location service unavailable.'
      return { error: msg }
    }
  }, [workLocations, settings])

  const checkIn = useCallback(async (source: 'timesheets' | 'shifts', shiftAssignmentId?: string, wfhOverride?: boolean) => {
    if (!companyId || !employeeId) return { ok: false, error: 'Not authenticated' }
    if (activeCheckin) return { ok: false, error: 'You are already checked in' }

    let coords: Coords | null = null
    let location: WorkLocation | null = null
    let wfh = false

    if (wfhOverride) {
      wfh = true
    } else {
      const locResult = await getLocation()
      if ('error' in locResult) return { ok: false, error: locResult.error }
      coords = locResult.coords
      location = locResult.location
      wfh = locResult.wfh
    }
    const { data, error } = await supabase.from('checkin_records').insert({
      company_id: companyId,
      employee_id: employeeId,
      check_in_lat: coords?.lat ?? null,
      check_in_lng: coords?.lng ?? null,
      check_in_location_id: location?.id || null,
      source,
      shift_assignment_id: shiftAssignmentId || null,
      work_from_home: wfh,
      status: 'checked_in',
    }).select().single()

    if (error) return { ok: false, error: error.message }
    setActiveCheckin(data)

    if (coords) {
      try {
        await supabase.rpc('log_gdpr_action' as never, {
          p_company_id: companyId,
          p_action: 'geolocation_capture',
          p_details: { employee_id: employeeId, checkin_id: data.id, source, wfh: false },
        } as never)
      } catch { /* audit log failure should not block check-in */ }
    }

    return { ok: true, wfh }
  }, [companyId, employeeId, activeCheckin, getLocation])

  const checkOut = useCallback(async () => {
    if (!activeCheckin || !companyId || !employeeId) return { ok: false, error: 'No active check-in' }

    const now = new Date()
    const nowIso = now.toISOString()

    let outLat: number | null = null
    let outLng: number | null = null
    let outLocId: string | null = null
    try {
      const pos = await getCurrentPosition()
      outLat = pos.coords.latitude
      outLng = pos.coords.longitude
      const loc = matchLocation({ lat: outLat, lng: outLng }, workLocations)
      outLocId = loc?.id || null
    } catch { /* proceed without location */ }

    const { error } = await supabase.from('checkin_records').update({
      check_out_at: nowIso,
      check_out_lat: outLat,
      check_out_lng: outLng,
      check_out_location_id: outLocId,
      status: 'checked_out',
      updated_at: nowIso,
    }).eq('id', activeCheckin.id)

    if (error) return { ok: false, error: error.message }

    if (activeBreak) {
      await supabase.from('break_records').update({
        break_end: nowIso,
      }).eq('id', activeBreak.id)
      setActiveBreak(null)
    }

    // Auto-create timesheet entry from check-in
    try {
      const checkInTime = new Date(activeCheckin.check_in_at)
      const totalMs = now.getTime() - checkInTime.getTime()

      // Fetch all completed breaks for this check-in to subtract break time
      const { data: breaks } = await supabase.from('break_records')
        .select('break_start, break_end')
        .eq('checkin_record_id', activeCheckin.id)
        .not('break_end', 'is', null)

      let breakMs = 0
      if (breaks) {
        for (const b of breaks) {
          if (b.break_start && b.break_end) {
            breakMs += new Date(b.break_end).getTime() - new Date(b.break_start).getTime()
          }
        }
      }

      // If the active break was just closed above, it's already included in the query above
      // since we updated it before this block runs

      const netMinutes = Math.max(0, (totalMs - breakMs) / 60000)
      const netHours = Math.round(netMinutes / 60 * 100) / 100

      const checkinDate = checkInTime.toISOString().split('T')[0]
      const locationName = activeCheckin.check_in_location_id
        ? workLocations.find(l => l.id === activeCheckin.check_in_location_id)?.name || ''
        : ''

      await supabase.from('timesheets').insert({
        employee_id: employeeId,
        company_id: companyId,
        date: checkinDate,
        end_date: checkinDate,
        start_time: activeCheckin.check_in_at,
        end_time: nowIso,
        hours: netHours,
        status: 'pending',
        source: 'checkin',
        source_checkin_id: activeCheckin.id,
        location: locationName,
        role: '',
        description: activeCheckin.source === 'shifts' ? 'Shift check-in' : 'Timesheet check-in',
      })
    } catch { /* timesheet creation failure must not block checkout */ }

    setActiveCheckin(null)
    return { ok: true }
  }, [activeCheckin, activeBreak, companyId, employeeId, workLocations])

  const startBreak = useCallback(async (type: 'lunch' | 'short' | 'other') => {
    if (!activeCheckin || !companyId) return { ok: false, error: 'No active check-in' }
    if (activeBreak) return { ok: false, error: 'Already on a break' }

    const { data, error } = await supabase.from('break_records').insert({
      checkin_record_id: activeCheckin.id,
      company_id: companyId,
      break_type: type,
    }).select().single()

    if (error) return { ok: false, error: error.message }
    setActiveBreak(data)
    return { ok: true }
  }, [activeCheckin, activeBreak, companyId])

  const endBreak = useCallback(async () => {
    if (!activeBreak) return { ok: false, error: 'No active break' }

    const { error } = await supabase.from('break_records').update({
      break_end: new Date().toISOString(),
    }).eq('id', activeBreak.id)

    if (error) return { ok: false, error: error.message }
    setActiveBreak(null)
    return { ok: true }
  }, [activeBreak])

  return (
    <CheckInContext.Provider value={{
      settings, workLocations, activeCheckin, activeBreak, loading,
      checkIn, checkOut, startBreak, endBreak, reload,
    }}>
      {children}
    </CheckInContext.Provider>
  )
}
