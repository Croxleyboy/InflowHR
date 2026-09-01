import { useState, useEffect, useCallback } from 'react'
import { useAdminCompany } from '../../context/AdminCompanyContext'
import { useFeatures } from '../../context/FeatureContext'
import { useToast } from '../../context/ToastContext'
import { supabase } from '../../lib/supabase'
import { toLocalDateStr } from '../../lib/formatters'

const EQUIPMENT_OPTIONS = [
  'TV / Display',
  'Whiteboard',
  'Video Conferencing',
  'Conference Phone',
  'Projector',
  'Webcam',
  'Standing Desk',
  'Dual Monitor',
  'Microphone',
  'Speakers',
]

interface Location {
  id: string
  name: string
  address: string
  timezone: string
  is_active: boolean
  sort_order: number
}

interface Floor {
  id: string
  location_id: string
  name: string
  sort_order: number
}

interface Space {
  id: string
  floor_id: string
  name: string
  space_type: 'desk' | 'room'
  capacity: number
  equipment_tags: string[]
  status: 'draft' | 'active' | 'maintenance'
  sort_order: number
}

interface SpaceSettings {
  id?: string
  max_advance_days: number
  auto_cancel_no_checkin: boolean
  auto_cancel_minutes: number
  buffer_minutes: number
  default_slot_minutes: number
}

interface AdminBooking {
  id: string
  space_id: string
  employee_id: string
  booking_date: string
  start_time: string | null
  end_time: string | null
  title: string | null
  status: string
  checked_in_at: string | null
  created_at: string
  space_name?: string
  space_type?: string
  employee_name?: string
}

interface AnalyticsData {
  totalBookings: number
  checkedIn: number
  noShows: number
  cancelled: number
  deskBookings: number
  roomBookings: number
  avgDailyBookings: number
  topSpaces: { name: string; type: string; count: number }[]
  byDayOfWeek: number[]
  byHour: number[]
}

type SubTab = 'locations' | 'spaces' | 'bookings' | 'analytics' | 'settings'

function generateTimeSlots(): string[] {
  const slots: string[] = []
  for (let h = 0; h < 24; h++) {
    for (let m = 0; m < 60; m += 30) {
      slots.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`)
    }
  }
  return slots
}

const TIME_SLOTS = generateTimeSlots()

function timeToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}

const BOOKINGS_PAGE_SIZE = 30

const DEFAULT_SETTINGS: SpaceSettings = {
  max_advance_days: 30,
  auto_cancel_no_checkin: false,
  auto_cancel_minutes: 15,
  buffer_minutes: 0,
  default_slot_minutes: 60,
}

interface SpaceAssetOption {
  id: string
  asset_name: string
  asset_type: string
}

export default function AdminSpaceManagement() {
  const { selectedCompanyId: companyId } = useAdminCompany()
  const { companyFeatures } = useFeatures()
  const { showError } = useToast()
  const [subTab, setSubTab] = useState<SubTab>('locations')
  const [locations, setLocations] = useState<Location[]>([])
  const [floors, setFloors] = useState<Floor[]>([])
  const [spaces, setSpaces] = useState<Space[]>([])
  const [settings, setSettings] = useState<SpaceSettings>(DEFAULT_SETTINGS)
  const [loading, setLoading] = useState(true)

  // Location form
  const [editingLocId, setEditingLocId] = useState<string | null>(null)
  const [locForm, setLocForm] = useState({ name: '', address: '', timezone: 'Europe/London' })
  const [showNewLoc, setShowNewLoc] = useState(false)

  // Floor form
  const [editingFloorId, setEditingFloorId] = useState<string | null>(null)
  const [floorForm, setFloorForm] = useState({ name: '', location_id: '' })
  const [showNewFloor, setShowNewFloor] = useState(false)

  // Space form
  const [editingSpaceId, setEditingSpaceId] = useState<string | null>(null)
  const [spaceForm, setSpaceForm] = useState({ name: '', floor_id: '', space_type: 'desk' as 'desk' | 'room', capacity: 1, equipment_tags: [] as string[], status: 'draft' as 'draft' | 'active' | 'maintenance', linked_asset_ids: [] as string[] })
  const [showNewSpace, setShowNewSpace] = useState(false)
  const [spaceAssets, setSpaceAssets] = useState<SpaceAssetOption[]>([])

  // Analytics state
  const [analyticsRange, setAnalyticsRange] = useState<7 | 30 | 90>(30)
  const [analyticsData, setAnalyticsData] = useState<AnalyticsData | null>(null)
  const [analyticsLoading, setAnalyticsLoading] = useState(false)

  const [savingSettings, setSavingSettings] = useState(false)

  // Bookings state
  const [allBookings, setAllBookings] = useState<AdminBooking[]>([])
  const [bookingsLoading, setBookingsLoading] = useState(false)
  const [bookingFilter, setBookingFilter] = useState<'upcoming' | 'past' | 'cancelled'>('upcoming')
  const [editingBookingId, setEditingBookingId] = useState<string | null>(null)
  const [bookingForm, setBookingForm] = useState({ date: '', start_time: '09:00', end_time: '10:00', title: '', status: 'confirmed' })
  const [bookingError, setBookingError] = useState<string | null>(null)
  const [savingBooking, setSavingBooking] = useState(false)
  const [bookingSearch, setBookingSearch] = useState('')
  const [bookingPage, setBookingPage] = useState(1)

  const loadAll = useCallback(async () => {
    if (!companyId) return
    setLoading(true)
    const [locRes, floorRes, spaceRes, settingsRes] = await Promise.all([
      supabase.from('locations').select('*').eq('company_id', companyId).order('sort_order'),
      supabase.from('floors').select('*').eq('company_id', companyId).order('sort_order'),
      supabase.from('spaces').select('*').eq('company_id', companyId).order('sort_order'),
      supabase.from('space_settings').select('*').eq('company_id', companyId).single(),
    ])
    if (locRes.data) setLocations(locRes.data)
    if (floorRes.data) setFloors(floorRes.data)
    if (spaceRes.data) setSpaces(spaceRes.data)
    if (settingsRes.data) setSettings(settingsRes.data as SpaceSettings)
    setLoading(false)
  }, [companyId])

  const loadSpaceAssets = useCallback(async () => {
    if (!companyId || !companyFeatures.asset_management) return
    const { data } = await supabase
      .from('company_assets')
      .select('id, asset_name, asset_type')
      .eq('company_id', companyId)
      .eq('is_space_asset', true)
      .order('asset_name')
    setSpaceAssets((data as SpaceAssetOption[]) || [])
  }, [companyId, companyFeatures.asset_management])

  useEffect(() => { loadAll(); loadSpaceAssets() }, [loadAll, loadSpaceAssets])

  // ---- Location CRUD ----
  async function saveLoc() {
    if (!companyId || !locForm.name.trim()) return
    if (editingLocId) {
      const { error } = await supabase.from('locations').update({ name: locForm.name, address: locForm.address, timezone: locForm.timezone }).eq('id', editingLocId)
      if (error) { showError('Failed to update location: ' + error.message); return }
    } else {
      const { error } = await supabase.from('locations').insert({ company_id: companyId, name: locForm.name, address: locForm.address, timezone: locForm.timezone })
      if (error) { showError('Failed to add location: ' + error.message); return }
    }
    setEditingLocId(null)
    setShowNewLoc(false)
    loadAll()
  }

  async function deleteLoc(id: string) {
    const { error } = await supabase.from('locations').delete().eq('id', id)
    if (error) { showError('Failed to delete location: ' + error.message); return }
    loadAll()
  }

  function editLoc(loc: Location) {
    setEditingLocId(loc.id)
    setLocForm({ name: loc.name, address: loc.address || '', timezone: loc.timezone || 'Europe/London' })
    setShowNewLoc(false)
  }

  // ---- Floor CRUD ----
  async function saveFloor() {
    if (!companyId || !floorForm.name.trim() || !floorForm.location_id) return
    if (editingFloorId) {
      const { error } = await supabase.from('floors').update({ name: floorForm.name, location_id: floorForm.location_id }).eq('id', editingFloorId)
      if (error) { showError('Failed to update floor: ' + error.message); return }
    } else {
      const { error } = await supabase.from('floors').insert({ company_id: companyId, name: floorForm.name, location_id: floorForm.location_id })
      if (error) { showError('Failed to add floor: ' + error.message); return }
    }
    setEditingFloorId(null)
    setShowNewFloor(false)
    loadAll()
  }

  async function deleteFloor(id: string) {
    const { error } = await supabase.from('floors').delete().eq('id', id)
    if (error) { showError('Failed to delete floor: ' + error.message); return }
    loadAll()
  }

  function editFloor(floor: Floor) {
    setEditingFloorId(floor.id)
    setFloorForm({ name: floor.name, location_id: floor.location_id })
    setShowNewFloor(false)
  }

  // ---- Space CRUD ----
  async function saveSpace() {
    if (!companyId || !spaceForm.name.trim() || !spaceForm.floor_id) return
    if (editingSpaceId) {
      const { error } = await supabase.from('spaces').update({
        name: spaceForm.name, floor_id: spaceForm.floor_id, space_type: spaceForm.space_type,
        capacity: spaceForm.capacity, equipment_tags: spaceForm.equipment_tags, status: spaceForm.status,
        linked_asset_ids: spaceForm.linked_asset_ids,
      }).eq('id', editingSpaceId)
      if (error) { showError('Failed to update space: ' + error.message); return }
    } else {
      const { error } = await supabase.from('spaces').insert({
        company_id: companyId, name: spaceForm.name, floor_id: spaceForm.floor_id,
        space_type: spaceForm.space_type, capacity: spaceForm.capacity, equipment_tags: spaceForm.equipment_tags, status: spaceForm.status,
        linked_asset_ids: spaceForm.linked_asset_ids,
      })
      if (error) { showError('Failed to add space: ' + error.message); return }
    }
    setEditingSpaceId(null)
    setShowNewSpace(false)
    loadAll()
  }

  async function deleteSpace(id: string) {
    await supabase.from('spaces').delete().eq('id', id)
    loadAll()
  }

  function editSpace(space: Space) {
    setEditingSpaceId(space.id)
    setSpaceForm({
      name: space.name, floor_id: space.floor_id, space_type: space.space_type,
      capacity: space.capacity, equipment_tags: [...space.equipment_tags], status: space.status,
      linked_asset_ids: (space as Space & { linked_asset_ids?: string[] }).linked_asset_ids || [],
    })
    setShowNewSpace(false)
  }

  // ---- Settings ----
  async function saveSettings() {
    if (!companyId) return
    setSavingSettings(true)
    if (settings.id) {
      await supabase.from('space_settings').update({
        max_advance_days: settings.max_advance_days,
        auto_cancel_no_checkin: settings.auto_cancel_no_checkin,
        auto_cancel_minutes: settings.auto_cancel_minutes,
        buffer_minutes: settings.buffer_minutes,
        default_slot_minutes: settings.default_slot_minutes,
      }).eq('id', settings.id)
    } else {
      const { data } = await supabase.from('space_settings').insert({ company_id: companyId, ...settings }).select().single()
      if (data) setSettings(data as SpaceSettings)
    }
    setSavingSettings(false)
  }

  const loadBookings = useCallback(async () => {
    if (!companyId) return
    setBookingsLoading(true)
    const todayStr = toLocalDateStr()
    let query = supabase.from('space_bookings')
      .select('id, space_id, employee_id, booking_date, start_time, end_time, title, status, checked_in_at, created_at, spaces(name, space_type), employees(first_name, last_name)')
      .eq('company_id', companyId)
      .order('booking_date', { ascending: bookingFilter === 'upcoming' })

    if (bookingFilter === 'upcoming') {
      query = query.gte('booking_date', todayStr).neq('status', 'cancelled')
    } else if (bookingFilter === 'past') {
      query = query.lt('booking_date', todayStr).neq('status', 'cancelled')
    } else {
      query = query.eq('status', 'cancelled')
    }

    const { data } = await query
    const mapped: AdminBooking[] = (data || []).map((b: Record<string, unknown>) => {
      const space = b.spaces as Record<string, string> | null
      const emp = b.employees as Record<string, string> | null
      return {
        id: b.id as string,
        space_id: b.space_id as string,
        employee_id: b.employee_id as string,
        booking_date: b.booking_date as string,
        start_time: b.start_time as string | null,
        end_time: b.end_time as string | null,
        title: b.title as string | null,
        status: b.status as string,
        checked_in_at: b.checked_in_at as string | null,
        created_at: b.created_at as string,
        space_name: space?.name || '',
        space_type: space?.space_type || '',
        employee_name: emp ? `${emp.first_name} ${emp.last_name}` : '',
      }
    })
    setAllBookings(mapped)
    setBookingsLoading(false)
  }, [companyId, bookingFilter])

  useEffect(() => { setBookingPage(1) }, [bookingSearch, bookingFilter])

  const loadAnalytics = useCallback(async () => {
    if (!companyId) return
    setAnalyticsLoading(true)
    const since = new Date()
    since.setDate(since.getDate() - analyticsRange)
    const sinceStr = toLocalDateStr(since)

    const { data: rows } = await supabase.from('space_bookings')
      .select('id, space_id, booking_date, start_time, status, checked_in_at')
      .eq('company_id', companyId)
      .gte('booking_date', sinceStr)

    const all = rows || []
    const nonCancelled = all.filter(r => r.status !== 'cancelled')
    const checkedIn = all.filter(r => r.status === 'checked_in' || r.checked_in_at)
    const noShows = all.filter(r => r.status === 'no_show')
    const cancelled = all.filter(r => r.status === 'cancelled')

    const spaceMap = new Map(spaces.map(s => [s.id, s]))
    const deskBookings = nonCancelled.filter(r => spaceMap.get(r.space_id)?.space_type === 'desk').length
    const roomBookings = nonCancelled.filter(r => spaceMap.get(r.space_id)?.space_type === 'room').length

    const uniqueDays = new Set(nonCancelled.map(r => r.booking_date))
    const avgDaily = uniqueDays.size > 0 ? nonCancelled.length / uniqueDays.size : 0

    const spaceCounts = new Map<string, number>()
    nonCancelled.forEach(r => spaceCounts.set(r.space_id, (spaceCounts.get(r.space_id) || 0) + 1))
    const topSpaces = Array.from(spaceCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([sid, count]) => {
        const s = spaceMap.get(sid)
        return { name: s?.name || 'Unknown', type: s?.space_type || '', count }
      })

    const byDayOfWeek = [0, 0, 0, 0, 0, 0, 0]
    nonCancelled.forEach(r => {
      const d = new Date(r.booking_date).getDay()
      byDayOfWeek[d]++
    })

    const byHour = new Array(24).fill(0)
    nonCancelled.forEach(r => {
      if (r.start_time) {
        const h = parseInt(r.start_time.slice(0, 2), 10)
        byHour[h]++
      }
    })

    setAnalyticsData({
      totalBookings: nonCancelled.length,
      checkedIn: checkedIn.length,
      noShows: noShows.length,
      cancelled: cancelled.length,
      deskBookings,
      roomBookings,
      avgDailyBookings: Math.round(avgDaily * 10) / 10,
      topSpaces,
      byDayOfWeek,
      byHour,
    })
    setAnalyticsLoading(false)
  }, [companyId, analyticsRange, spaces])

  useEffect(() => { if (subTab === 'bookings') loadBookings() }, [loadBookings, subTab])
  useEffect(() => { if (subTab === 'analytics') loadAnalytics() }, [loadAnalytics, subTab])

  function editBooking(b: AdminBooking) {
    setEditingBookingId(b.id)
    setBookingForm({
      date: b.booking_date,
      start_time: b.start_time?.slice(0, 5) || '09:00',
      end_time: b.end_time?.slice(0, 5) || '10:00',
      title: b.title || '',
      status: b.status,
    })
    setBookingError(null)
  }

  async function saveBooking() {
    if (!editingBookingId || !companyId) return
    setSavingBooking(true)
    setBookingError(null)

    const startMins = timeToMinutes(bookingForm.start_time)
    const endMins = timeToMinutes(bookingForm.end_time)
    if (endMins - startMins < 30) {
      setBookingError('Minimum booking duration is 30 minutes')
      setSavingBooking(false)
      return
    }

    const current = allBookings.find(b => b.id === editingBookingId)
    if (!current) { setSavingBooking(false); return }

    const { data: conflicts } = await supabase.from('space_bookings')
      .select('id, start_time, end_time')
      .eq('space_id', current.space_id)
      .eq('booking_date', bookingForm.date)
      .neq('status', 'cancelled')
      .neq('id', editingBookingId)

    if (conflicts && conflicts.length > 0) {
      const hasOverlap = conflicts.some(c => {
        if (!c.start_time || !c.end_time) return true
        const cStart = timeToMinutes(c.start_time.slice(0, 5))
        const cEnd = timeToMinutes(c.end_time.slice(0, 5))
        return startMins < cEnd && endMins > cStart
      })
      if (hasOverlap) {
        setBookingError('Time conflict — another booking overlaps this slot')
        setSavingBooking(false)
        return
      }
    }

    const { error } = await supabase.from('space_bookings').update({
      booking_date: bookingForm.date,
      start_time: bookingForm.start_time,
      end_time: bookingForm.end_time,
      title: bookingForm.title || null,
      status: bookingForm.status,
      admin_modified_at: new Date().toISOString(),
    }).eq('id', editingBookingId)

    if (error) {
      setBookingError(error.message)
      setSavingBooking(false)
      return
    }

    setEditingBookingId(null)
    setSavingBooking(false)
    loadBookings()
  }

  async function cancelBookingAdmin(id: string) {
    await supabase.from('space_bookings').update({ status: 'cancelled' }).eq('id', id)
    loadBookings()
  }

  function getLocName(id: string) { return locations.find(l => l.id === id)?.name || '' }
  function getFloorLabel(id: string) {
    const f = floors.find(fl => fl.id === id)
    return f ? `${f.name} (${getLocName(f.location_id)})` : ''
  }

  const filteredBookings = bookingSearch.trim()
    ? allBookings.filter(b => {
        const q = bookingSearch.toLowerCase()
        return (
          (b.employee_name || '').toLowerCase().includes(q) ||
          (b.space_name || '').toLowerCase().includes(q) ||
          (b.booking_date || '').toLowerCase().includes(q) ||
          (b.title || '').toLowerCase().includes(q) ||
          (b.status || '').toLowerCase().includes(q) ||
          (b.space_type || '').toLowerCase().includes(q)
        )
      })
    : allBookings
  const bookingTotalPages = Math.max(1, Math.ceil(filteredBookings.length / BOOKINGS_PAGE_SIZE))
  const paginatedBookings = filteredBookings.slice((bookingPage - 1) * BOOKINGS_PAGE_SIZE, bookingPage * BOOKINGS_PAGE_SIZE)

  if (loading) return <div className="admin-page"><p>Loading...</p></div>

  return (
    <div className="admin-page">
      <div className="admin-page-header">
        <h1>Space Management</h1>
        <p style={{ color: '#666', marginTop: 4 }}>Manage locations, floors, desks, and meeting rooms</p>
      </div>

      <div className="admin-sub-tabs">
        <button className={`admin-sub-tab ${subTab === 'locations' ? 'admin-sub-tab-active' : ''}`} onClick={() => setSubTab('locations')}>Locations &amp; Floors</button>
        <button className={`admin-sub-tab ${subTab === 'spaces' ? 'admin-sub-tab-active' : ''}`} onClick={() => setSubTab('spaces')}>Spaces Directory</button>
        <button className={`admin-sub-tab ${subTab === 'bookings' ? 'admin-sub-tab-active' : ''}`} onClick={() => setSubTab('bookings')}>Bookings</button>
        <button className={`admin-sub-tab ${subTab === 'analytics' ? 'admin-sub-tab-active' : ''}`} onClick={() => setSubTab('analytics')}>Analytics</button>
        <button className={`admin-sub-tab ${subTab === 'settings' ? 'admin-sub-tab-active' : ''}`} onClick={() => setSubTab('settings')}>Booking Settings</button>
      </div>

      {/* ---- LOCATIONS & FLOORS ---- */}
      {subTab === 'locations' && (
        <div className="admin-section">
          <div className="admin-section-header">
            <h2>Locations</h2>
            <button className="admin-add-btn" onClick={() => { setShowNewLoc(true); setEditingLocId(null); setLocForm({ name: '', address: '', timezone: 'Europe/London' }) }}>+ Add Location</button>
          </div>

          {(showNewLoc || editingLocId) && (
            <div className="admin-inline-form">
              <input placeholder="Location name" value={locForm.name} onChange={e => setLocForm({ ...locForm, name: e.target.value })} className="admin-input" />
              <input placeholder="Address" value={locForm.address} onChange={e => setLocForm({ ...locForm, address: e.target.value })} className="admin-input" />
              <select value={locForm.timezone} onChange={e => setLocForm({ ...locForm, timezone: e.target.value })} className="admin-input">
                <option value="Europe/London">Europe/London</option>
                <option value="Europe/Berlin">Europe/Berlin</option>
                <option value="America/New_York">America/New_York</option>
                <option value="America/Los_Angeles">America/Los_Angeles</option>
                <option value="Asia/Tokyo">Asia/Tokyo</option>
                <option value="Australia/Sydney">Australia/Sydney</option>
              </select>
              <div className="admin-form-actions">
                <button className="admin-save-btn" onClick={saveLoc}>Save</button>
                <button className="admin-cancel-btn" onClick={() => { setShowNewLoc(false); setEditingLocId(null) }}>Cancel</button>
              </div>
            </div>
          )}

          <table className="admin-table">
            <thead><tr><th>Name</th><th>Address</th><th>Timezone</th><th>Floors</th><th>Actions</th></tr></thead>
            <tbody>
              {locations.map(loc => (
                <tr key={loc.id}>
                  <td>{loc.name}</td>
                  <td>{loc.address}</td>
                  <td>{loc.timezone}</td>
                  <td>{floors.filter(f => f.location_id === loc.id).length}</td>
                  <td>
                    <button className="admin-action-btn" onClick={() => editLoc(loc)}>Edit</button>
                    <button className="admin-action-btn admin-delete-btn" onClick={() => deleteLoc(loc.id)}>Delete</button>
                  </td>
                </tr>
              ))}
              {locations.length === 0 && <tr><td colSpan={5} style={{ textAlign: 'center', color: '#999' }}>No locations yet</td></tr>}
            </tbody>
          </table>

          <div className="admin-section-header" style={{ marginTop: 32 }}>
            <h2>Floors / Zones</h2>
            <button className="admin-add-btn" onClick={() => { setShowNewFloor(true); setEditingFloorId(null); setFloorForm({ name: '', location_id: locations[0]?.id || '' }) }}>+ Add Floor</button>
          </div>

          {(showNewFloor || editingFloorId) && (
            <div className="admin-inline-form">
              <select value={floorForm.location_id} onChange={e => setFloorForm({ ...floorForm, location_id: e.target.value })} className="admin-input">
                {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
              <input placeholder="Floor / zone name" value={floorForm.name} onChange={e => setFloorForm({ ...floorForm, name: e.target.value })} className="admin-input" />
              <div className="admin-form-actions">
                <button className="admin-save-btn" onClick={saveFloor}>Save</button>
                <button className="admin-cancel-btn" onClick={() => { setShowNewFloor(false); setEditingFloorId(null) }}>Cancel</button>
              </div>
            </div>
          )}

          <table className="admin-table">
            <thead><tr><th>Floor / Zone</th><th>Location</th><th>Actions</th></tr></thead>
            <tbody>
              {floors.map(floor => (
                <tr key={floor.id}>
                  <td>{floor.name}</td>
                  <td>{getLocName(floor.location_id)}</td>
                  <td>
                    <button className="admin-action-btn" onClick={() => editFloor(floor)}>Edit</button>
                    <button className="admin-action-btn admin-delete-btn" onClick={() => deleteFloor(floor.id)}>Delete</button>
                  </td>
                </tr>
              ))}
              {floors.length === 0 && <tr><td colSpan={3} style={{ textAlign: 'center', color: '#999' }}>No floors yet</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {/* ---- SPACES DIRECTORY ---- */}
      {subTab === 'spaces' && (
        <div className="admin-section">
          <div className="admin-section-header">
            <h2>Spaces</h2>
            <button className="admin-add-btn" onClick={() => { setShowNewSpace(true); setEditingSpaceId(null); setSpaceForm({ name: '', floor_id: floors[0]?.id || '', space_type: 'desk', capacity: 1, equipment_tags: [], status: 'draft', linked_asset_ids: [] }) }}>+ Add Space</button>
          </div>

          {(showNewSpace || editingSpaceId) && (
            <div className="admin-inline-form">
              <input placeholder="Space name" value={spaceForm.name} onChange={e => setSpaceForm({ ...spaceForm, name: e.target.value })} className="admin-input" />
              <select value={spaceForm.floor_id} onChange={e => setSpaceForm({ ...spaceForm, floor_id: e.target.value })} className="admin-input">
                {floors.map(f => <option key={f.id} value={f.id}>{f.name} ({getLocName(f.location_id)})</option>)}
              </select>
              <select value={spaceForm.space_type} onChange={e => setSpaceForm({ ...spaceForm, space_type: e.target.value as 'desk' | 'room' })} className="admin-input">
                <option value="desk">Desk</option>
                <option value="room">Meeting Room</option>
              </select>
              <input type="number" placeholder="Capacity" value={spaceForm.capacity} onChange={e => setSpaceForm({ ...spaceForm, capacity: Number(e.target.value) })} className="admin-input" min={1} />
              {spaceForm.space_type === 'room' && (
                <div className="admin-equipment-picker">
                  <label style={{ fontSize: 12, fontWeight: 600, color: '#666', marginBottom: 4, display: 'block' }}>Equipment</label>
                  <div className="admin-equipment-grid">
                    {EQUIPMENT_OPTIONS.map(tag => (
                      <label key={tag} className="admin-equipment-option">
                        <input
                          type="checkbox"
                          checked={spaceForm.equipment_tags.includes(tag)}
                          onChange={e => {
                            const next = e.target.checked
                              ? [...spaceForm.equipment_tags, tag]
                              : spaceForm.equipment_tags.filter(t => t !== tag)
                            setSpaceForm({ ...spaceForm, equipment_tags: next })
                          }}
                        />
                        <span>{tag}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
              <select value={spaceForm.status} onChange={e => setSpaceForm({ ...spaceForm, status: e.target.value as 'draft' | 'active' | 'maintenance' })} className="admin-input">
                <option value="draft">Draft</option>
                <option value="active">Active (Published)</option>
                <option value="maintenance">Maintenance</option>
              </select>
              {companyFeatures.asset_management && spaceAssets.length > 0 && (
                <div className="admin-equipment-picker">
                  <label style={{ fontSize: 12, fontWeight: 600, color: '#666', marginBottom: 4, display: 'block' }}>Linked Assets</label>
                  <div className="admin-equipment-grid">
                    {spaceAssets.map(asset => (
                      <label key={asset.id} className="admin-equipment-option">
                        <input
                          type="checkbox"
                          checked={spaceForm.linked_asset_ids.includes(asset.id)}
                          onChange={e => {
                            const next = e.target.checked
                              ? [...spaceForm.linked_asset_ids, asset.id]
                              : spaceForm.linked_asset_ids.filter(id => id !== asset.id)
                            setSpaceForm({ ...spaceForm, linked_asset_ids: next })
                          }}
                        />
                        <span>{asset.asset_name} ({asset.asset_type})</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
              <div className="admin-form-actions">
                <button className="admin-save-btn" onClick={saveSpace}>Save</button>
                <button className="admin-cancel-btn" onClick={() => { setShowNewSpace(false); setEditingSpaceId(null) }}>Cancel</button>
              </div>
            </div>
          )}

          <table className="admin-table">
            <thead><tr><th>Name</th><th>Floor</th><th>Type</th><th>Capacity</th><th>Equipment</th>{companyFeatures.asset_management && <th>Assets</th>}<th>Status</th><th>Actions</th></tr></thead>
            <tbody>
              {spaces.map(space => (
                <tr key={space.id}>
                  <td>{space.name}</td>
                  <td>{getFloorLabel(space.floor_id)}</td>
                  <td><span className={`admin-badge admin-badge-${space.space_type}`}>{space.space_type === 'desk' ? 'Desk' : 'Room'}</span></td>
                  <td>{space.capacity}</td>
                  <td>{space.equipment_tags.join(', ') || '—'}</td>
                  {companyFeatures.asset_management && (
                    <td>{((space as Space & { linked_asset_ids?: string[] }).linked_asset_ids || []).map(id => spaceAssets.find(a => a.id === id)?.asset_name).filter(Boolean).join(', ') || '—'}</td>
                  )}
                  <td><span className={`admin-badge admin-badge-${space.status}`}>{space.status}</span></td>
                  <td>
                    <button className="admin-action-btn" onClick={() => editSpace(space)}>Edit</button>
                    <button className="admin-action-btn admin-delete-btn" onClick={() => deleteSpace(space.id)}>Delete</button>
                  </td>
                </tr>
              ))}
              {spaces.length === 0 && <tr><td colSpan={companyFeatures.asset_management ? 8 : 7} style={{ textAlign: 'center', color: '#999' }}>No spaces yet — add locations and floors first</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {/* ---- BOOKINGS ---- */}
      {subTab === 'bookings' && (
        <div className="admin-section">
          <div className="admin-section-header">
            <h2>Bookings</h2>
            <div style={{ display: 'flex', gap: 6 }}>
              <button className={`admin-action-btn ${bookingFilter === 'upcoming' ? 'admin-filter-active' : ''}`} onClick={() => setBookingFilter('upcoming')}>Upcoming</button>
              <button className={`admin-action-btn ${bookingFilter === 'past' ? 'admin-filter-active' : ''}`} onClick={() => setBookingFilter('past')}>Past</button>
              <button className={`admin-action-btn ${bookingFilter === 'cancelled' ? 'admin-filter-active' : ''}`} onClick={() => setBookingFilter('cancelled')}>Cancelled</button>
            </div>
          </div>

          {editingBookingId && (
            <div className="admin-inline-form" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>
                Edit Booking — {allBookings.find(b => b.id === editingBookingId)?.space_name} ({allBookings.find(b => b.id === editingBookingId)?.employee_name})
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 600, color: '#888', display: 'block' }}>Date</label>
                  <input type="date" className="admin-input" value={bookingForm.date} onChange={e => setBookingForm({ ...bookingForm, date: e.target.value })} />
                </div>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 600, color: '#888', display: 'block' }}>Start</label>
                  <select className="admin-input" value={bookingForm.start_time} onChange={e => setBookingForm({ ...bookingForm, start_time: e.target.value })}>
                    {TIME_SLOTS.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 600, color: '#888', display: 'block' }}>End</label>
                  <select className="admin-input" value={bookingForm.end_time} onChange={e => setBookingForm({ ...bookingForm, end_time: e.target.value })}>
                    {TIME_SLOTS.filter(s => timeToMinutes(s) >= timeToMinutes(bookingForm.start_time) + 30).map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 600, color: '#888', display: 'block' }}>Title</label>
                  <input className="admin-input" value={bookingForm.title} onChange={e => setBookingForm({ ...bookingForm, title: e.target.value })} placeholder="Optional" />
                </div>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 600, color: '#888', display: 'block' }}>Status</label>
                  <select className="admin-input" value={bookingForm.status} onChange={e => setBookingForm({ ...bookingForm, status: e.target.value })}>
                    <option value="confirmed">Confirmed</option>
                    <option value="checked_in">Checked In</option>
                    <option value="cancelled">Cancelled</option>
                    <option value="no_show">No Show</option>
                  </select>
                </div>
              </div>
              {bookingError && <p style={{ color: '#c62828', fontSize: 13, margin: '4px 0 0' }}>{bookingError}</p>}
              <div className="admin-form-actions" style={{ marginTop: 8 }}>
                <button className="admin-save-btn" onClick={saveBooking} disabled={savingBooking}>{savingBooking ? 'Saving...' : 'Save'}</button>
                <button className="admin-cancel-btn" onClick={() => { setEditingBookingId(null); setBookingError(null) }}>Cancel</button>
              </div>
            </div>
          )}

          <input className="admin-input" placeholder="Search bookings..." value={bookingSearch} onChange={e => setBookingSearch(e.target.value)} style={{ maxWidth: 320, marginBottom: 12 }} />

          {bookingsLoading ? (
            <div className="admin-loading">Loading...</div>
          ) : (
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Space</th>
                  <th>Type</th>
                  <th>Employee</th>
                  <th>Date</th>
                  <th>Time</th>
                  <th>Title</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {paginatedBookings.map(b => (
                  <tr key={b.id}>
                    <td>{b.space_name}</td>
                    <td><span className={`admin-badge admin-badge-${b.space_type}`}>{b.space_type === 'desk' ? 'Desk' : 'Room'}</span></td>
                    <td>{b.employee_name}</td>
                    <td>{b.booking_date}</td>
                    <td>{b.start_time?.slice(0, 5) || '—'} – {b.end_time?.slice(0, 5) || '—'}</td>
                    <td>{b.title || '—'}</td>
                    <td><span className={`admin-badge admin-badge-${b.status}`}>{b.status}</span></td>
                    <td>
                      <button className="admin-action-btn" onClick={() => editBooking(b)}>Edit</button>
                      {b.status !== 'cancelled' && (
                        <button className="admin-action-btn admin-delete-btn" onClick={() => cancelBookingAdmin(b.id)}>Cancel</button>
                      )}
                    </td>
                  </tr>
                ))}
                {paginatedBookings.length === 0 && <tr><td colSpan={8} style={{ textAlign: 'center', color: '#999' }}>No bookings found</td></tr>}
              </tbody>
            </table>
          )}
          {bookingTotalPages > 1 && (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 12, marginTop: 12 }}>
              <button className="admin-action-btn" disabled={bookingPage <= 1} onClick={() => setBookingPage(p => p - 1)}>Prev</button>
              <span style={{ fontSize: 13 }}>Page {bookingPage} of {bookingTotalPages}</span>
              <button className="admin-action-btn" disabled={bookingPage >= bookingTotalPages} onClick={() => setBookingPage(p => p + 1)}>Next</button>
            </div>
          )}
        </div>
      )}

      {/* ---- ANALYTICS ---- */}
      {subTab === 'analytics' && (
        <div className="admin-section">
          <div className="admin-section-header">
            <h2>Occupancy Analytics</h2>
            <div style={{ display: 'flex', gap: 6 }}>
              {([7, 30, 90] as const).map(d => (
                <button key={d} className={`admin-action-btn ${analyticsRange === d ? 'admin-filter-active' : ''}`} onClick={() => setAnalyticsRange(d)}>
                  {d}d
                </button>
              ))}
            </div>
          </div>

          {analyticsLoading ? (
            <div className="admin-loading">Loading analytics...</div>
          ) : analyticsData ? (
            <>
              <div className="admin-mini-stats">
                <div className="admin-mini-stat"><span className="admin-mini-value">{analyticsData.totalBookings}</span><span>Total Bookings</span></div>
                <div className="admin-mini-stat"><span className="admin-mini-value" style={{ color: '#5b9bd5' }}>{analyticsData.deskBookings}</span><span>Desk</span></div>
                <div className="admin-mini-stat"><span className="admin-mini-value" style={{ color: '#7e57c2' }}>{analyticsData.roomBookings}</span><span>Room</span></div>
                <div className="admin-mini-stat"><span className="admin-mini-value" style={{ color: '#43a047' }}>{analyticsData.checkedIn}</span><span>Checked In</span></div>
                <div className="admin-mini-stat"><span className="admin-mini-value" style={{ color: '#e53935' }}>{analyticsData.noShows}</span><span>No Shows</span></div>
                <div className="admin-mini-stat"><span className="admin-mini-value" style={{ color: '#ff9800' }}>{analyticsData.cancelled}</span><span>Cancelled</span></div>
                <div className="admin-mini-stat"><span className="admin-mini-value">{analyticsData.avgDailyBookings}</span><span>Avg / Day</span></div>
              </div>

              <div className="admin-analytics-rates" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, margin: '16px 0' }}>
                <div className="admin-analytics-card">
                  <h4>Check-in Rate</h4>
                  <div className="admin-analytics-big-num" style={{ color: '#43a047' }}>
                    {analyticsData.totalBookings > 0 ? Math.round((analyticsData.checkedIn / analyticsData.totalBookings) * 100) : 0}%
                  </div>
                </div>
                <div className="admin-analytics-card">
                  <h4>No-show Rate</h4>
                  <div className="admin-analytics-big-num" style={{ color: '#e53935' }}>
                    {analyticsData.totalBookings > 0 ? Math.round((analyticsData.noShows / analyticsData.totalBookings) * 100) : 0}%
                  </div>
                </div>
              </div>

              {analyticsData.topSpaces.length > 0 && (
                <div style={{ marginBottom: 20 }}>
                  <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 8 }}>Most Popular Spaces</h3>
                  <table className="admin-table">
                    <thead><tr><th>Space</th><th>Type</th><th>Bookings</th><th>Share</th></tr></thead>
                    <tbody>
                      {analyticsData.topSpaces.map(s => (
                        <tr key={s.name}>
                          <td>{s.name}</td>
                          <td><span className={`admin-badge admin-badge-${s.type}`}>{s.type === 'desk' ? 'Desk' : 'Room'}</span></td>
                          <td>{s.count}</td>
                          <td>{analyticsData.totalBookings > 0 ? Math.round((s.count / analyticsData.totalBookings) * 100) : 0}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <div className="admin-analytics-card">
                  <h4>Bookings by Day of Week</h4>
                  <div className="admin-bar-chart">
                    {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day, i) => {
                      const max = Math.max(...analyticsData.byDayOfWeek, 1)
                      return (
                        <div key={day} className="admin-bar-item">
                          <div className="admin-bar-track">
                            <div className="admin-bar-fill" style={{ height: `${(analyticsData.byDayOfWeek[i] / max) * 100}%` }} />
                          </div>
                          <span className="admin-bar-label">{day}</span>
                          <span className="admin-bar-value">{analyticsData.byDayOfWeek[i]}</span>
                        </div>
                      )
                    })}
                  </div>
                </div>

                <div className="admin-analytics-card">
                  <h4>Peak Hours</h4>
                  <div className="admin-bar-chart">
                    {analyticsData.byHour.map((count, h) => {
                      if (h < 7 || h > 19) return null
                      const max = Math.max(...analyticsData.byHour.slice(7, 20), 1)
                      return (
                        <div key={h} className="admin-bar-item">
                          <div className="admin-bar-track">
                            <div className="admin-bar-fill" style={{ height: `${(count / max) * 100}%` }} />
                          </div>
                          <span className="admin-bar-label">{String(h).padStart(2, '0')}</span>
                          <span className="admin-bar-value">{count}</span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>
            </>
          ) : (
            <p style={{ color: '#999', textAlign: 'center', padding: 32 }}>No analytics data available</p>
          )}
        </div>
      )}

      {/* ---- BOOKING SETTINGS ---- */}
      {subTab === 'settings' && (
        <div className="admin-section">
          <h2>Booking Policies</h2>
          <div className="admin-settings-grid">
            <div className="admin-setting-row">
              <label>Max advance booking (days)</label>
              <input type="number" className="admin-input" value={settings.max_advance_days} onChange={e => setSettings({ ...settings, max_advance_days: Number(e.target.value) })} min={1} max={365} />
            </div>
            <div className="admin-setting-row">
              <label>Default time slot (minutes)</label>
              <input type="number" className="admin-input" value={settings.default_slot_minutes} onChange={e => setSettings({ ...settings, default_slot_minutes: Number(e.target.value) })} min={15} step={15} />
            </div>
            <div className="admin-setting-row">
              <label>Buffer between bookings (minutes)</label>
              <input type="number" className="admin-input" value={settings.buffer_minutes} onChange={e => setSettings({ ...settings, buffer_minutes: Number(e.target.value) })} min={0} step={5} />
            </div>
            <div className="admin-setting-row">
              <label>
                <input type="checkbox" checked={settings.auto_cancel_no_checkin} onChange={e => setSettings({ ...settings, auto_cancel_no_checkin: e.target.checked })} />
                {' '}Auto-cancel if no check-in
              </label>
            </div>
            {settings.auto_cancel_no_checkin && (
              <div className="admin-setting-row">
                <label>Cancel after (minutes)</label>
                <input type="number" className="admin-input" value={settings.auto_cancel_minutes} onChange={e => setSettings({ ...settings, auto_cancel_minutes: Number(e.target.value) })} min={5} step={5} />
              </div>
            )}
          </div>
          <button className="admin-save-btn" style={{ marginTop: 16 }} onClick={saveSettings} disabled={savingSettings}>
            {savingSettings ? 'Saving...' : 'Save Settings'}
          </button>
        </div>
      )}
    </div>
  )
}
