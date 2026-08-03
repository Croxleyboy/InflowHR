import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLanguage } from '../context/LanguageContext'
import { useFeatures } from '../context/FeatureContext'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'

interface Location {
  id: string
  name: string
}

interface Floor {
  id: string
  name: string
  location_id: string
}

interface Space {
  id: string
  name: string
  space_type: 'desk' | 'room'
  capacity: number
  equipment_tags: string[]
  floor_id: string
  status: string
}

interface Booking {
  id: string
  space_id: string
  employee_id: string
  booking_date: string
  start_time: string | null
  end_time: string | null
  title: string | null
  attendees: string[]
  guests: string[]
  status: string
  checked_in_at: string | null
  admin_modified_at: string | null
  created_at: string
  space?: { name: string; space_type: string; floor_id: string; floors?: { name: string; locations?: { name: string } } }
}

interface SpaceSettings {
  max_advance_days: number
  default_slot_minutes: number
}

type Tab = 'book' | 'my_bookings'

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

export default function SpaceBooking() {
  const navigate = useNavigate()
  const { t } = useLanguage()
  const { features } = useFeatures()
  const { employeeId, companyUser } = useAuth()

  const [tab, setTab] = useState<Tab>('book')
  const [locations, setLocations] = useState<Location[]>([])
  const [floors, setFloors] = useState<Floor[]>([])
  const [spaces, setSpaces] = useState<Space[]>([])
  const [bookings, setBookings] = useState<Booking[]>([])
  const [myBookings, setMyBookings] = useState<Booking[]>([])
  const [settings, setSettings] = useState<SpaceSettings>({ max_advance_days: 30, default_slot_minutes: 60 })

  const [selectedLocation, setSelectedLocation] = useState('')
  const [selectedFloor, setSelectedFloor] = useState('')
  const [selectedType, setSelectedType] = useState<'' | 'desk' | 'room'>('')
  const [selectedDate, setSelectedDate] = useState(() => new Date().toISOString().split('T')[0])
  const [selectedTime, setSelectedTime] = useState('09:00')
  const [selectedEndTime, setSelectedEndTime] = useState('17:00')

  const [bookingModal, setBookingModal] = useState<Space | null>(null)
  const [bookingTitle, setBookingTitle] = useState('')
  const [bookingStartTime, setBookingStartTime] = useState('09:00')
  const [bookingEndTime, setBookingEndTime] = useState('10:00')
  const [bookingAttendees, setBookingAttendees] = useState('')
  const [bookingGuests, setBookingGuests] = useState('')
  const [bookingMultiDay, setBookingMultiDay] = useState(false)
  const [bookingEndDate, setBookingEndDate] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const companyId = companyUser?.company_id

  const loadData = useCallback(async () => {
    if (!companyId) return

    const [locRes, floorRes, settingsRes] = await Promise.all([
      supabase.from('locations').select('id, name').eq('company_id', companyId).eq('is_active', true).order('sort_order'),
      supabase.from('floors').select('id, name, location_id').eq('company_id', companyId).order('sort_order'),
      supabase.from('space_settings').select('max_advance_days, default_slot_minutes').eq('company_id', companyId).single(),
    ])

    if (locRes.data) setLocations(locRes.data)
    if (floorRes.data) setFloors(floorRes.data)
    if (settingsRes.data) setSettings(settingsRes.data as SpaceSettings)
    if (locRes.data?.length && !selectedLocation) setSelectedLocation(locRes.data[0].id)
  }, [companyId, selectedLocation])

  const loadSpaces = useCallback(async () => {
    if (!companyId) return
    let query = supabase.from('spaces').select('id, name, space_type, capacity, equipment_tags, floor_id, status')
      .eq('company_id', companyId).eq('status', 'active')
    if (selectedFloor) query = query.eq('floor_id', selectedFloor)
    else if (selectedLocation) {
      const floorIds = floors.filter(f => f.location_id === selectedLocation).map(f => f.id)
      if (floorIds.length) query = query.in('floor_id', floorIds)
      else { setSpaces([]); return }
    }
    if (selectedType) query = query.eq('space_type', selectedType)
    query = query.order('sort_order')
    const { data } = await query
    setSpaces(data || [])
  }, [companyId, selectedFloor, selectedLocation, selectedType, floors])

  const loadBookingsForDate = useCallback(async () => {
    if (!companyId) return
    const spaceIds = spaces.map(s => s.id)
    if (!spaceIds.length) { setBookings([]); return }
    const { data } = await supabase.from('space_bookings')
      .select('id, space_id, employee_id, booking_date, start_time, end_time, title, attendees, guests, status, checked_in_at, admin_modified_at, created_at')
      .eq('company_id', companyId)
      .eq('booking_date', selectedDate)
      .in('space_id', spaceIds)
      .neq('status', 'cancelled')
    setBookings((data as Booking[]) || [])
  }, [companyId, spaces, selectedDate])

  const loadMyBookings = useCallback(async () => {
    if (!companyId || !employeeId) return
    const { data } = await supabase.from('space_bookings')
      .select('id, space_id, employee_id, booking_date, start_time, end_time, title, attendees, guests, status, checked_in_at, admin_modified_at, created_at, space:spaces(name, space_type, floor_id, floors(name, locations:locations(name)))')
      .eq('company_id', companyId)
      .eq('employee_id', employeeId)
      .gte('booking_date', new Date().toISOString().split('T')[0])
      .order('booking_date', { ascending: true })
    setMyBookings((data as unknown as Booking[]) || [])
  }, [companyId, employeeId])

  useEffect(() => { loadData() }, [loadData])
  useEffect(() => { loadSpaces() }, [loadSpaces])
  useEffect(() => { if (tab === 'book') loadBookingsForDate() }, [loadBookingsForDate, tab])
  useEffect(() => { if (tab === 'my_bookings') loadMyBookings() }, [loadMyBookings, tab])

  useEffect(() => {
    const onFocus = () => { if (tab === 'book') loadBookingsForDate(); else loadMyBookings() }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [tab, loadBookingsForDate, loadMyBookings])

  if (!features.space_booking) {
    navigate('/')
    return null
  }

  const filteredFloors = selectedLocation ? floors.filter(f => f.location_id === selectedLocation) : floors

  function isSpaceBooked(spaceId: string): boolean {
    const selStart = timeToMinutes(selectedTime)
    const selEnd = timeToMinutes(selectedEndTime)
    return bookings.some(b => {
      if (b.space_id !== spaceId) return false
      if (!b.start_time || !b.end_time) return true
      const bStart = timeToMinutes(b.start_time.slice(0, 5))
      const bEnd = timeToMinutes(b.end_time.slice(0, 5))
      return selStart < bEnd && selEnd > bStart
    })
  }

  function getFloorName(floorId: string): string {
    return floors.find(f => f.id === floorId)?.name || ''
  }

  const maxDate = new Date()
  maxDate.setDate(maxDate.getDate() + settings.max_advance_days)
  const maxDateStr = maxDate.toISOString().split('T')[0]

  function snapTo30(mins: number): string {
    const snapped = Math.round(mins / 30) * 30
    const clamped = Math.min(snapped, 23 * 60 + 30)
    return `${String(Math.floor(clamped / 60)).padStart(2, '0')}:${String(clamped % 60).padStart(2, '0')}`
  }

  function openBookingModal(space: Space) {
    setBookingModal(space)
    setBookingTitle('')
    setBookingStartTime(selectedTime)
    const slotMins = Math.max(settings.default_slot_minutes, 30)
    setBookingEndTime(snapTo30(timeToMinutes(selectedTime) + slotMins))
    setBookingAttendees('')
    setBookingGuests('')
    setBookingMultiDay(false)
    setBookingEndDate('')
    setError(null)
    setSuccess(null)
  }

  async function handleBooking() {
    if (!bookingModal || !companyId || !employeeId) return
    setSubmitting(true)
    setError(null)

    const isMultiDayDesk = bookingMultiDay && bookingModal.space_type === 'desk'
    if (!isMultiDayDesk) {
      const startMins = timeToMinutes(bookingStartTime)
      const endMins = timeToMinutes(bookingEndTime)
      if (endMins - startMins < 30) {
        setError(t('space.min_duration'))
        setSubmitting(false)
        return
      }
    }

    if (isMultiDayDesk) {
      const startD = new Date(selectedDate)
      const endD = new Date(bookingEndDate || selectedDate)
      if (endD < startD) { setError('End date must be after start date'); setSubmitting(false); return }
      const rows = []
      for (let d = new Date(startD); d <= endD; d.setDate(d.getDate() + 1)) {
        rows.push({
          company_id: companyId,
          space_id: bookingModal.id,
          employee_id: employeeId,
          booking_date: d.toISOString().split('T')[0],
          status: 'confirmed',
        })
      }
      const { error: insertErr } = await supabase.from('space_bookings').insert(rows)
      if (insertErr) {
        setError(insertErr.message.includes('space_bookings_desk_unique') ? t('space.conflict') : insertErr.message)
        setSubmitting(false)
        return
      }
    } else {
      const isRoom = bookingModal.space_type === 'room'
      const row: Record<string, unknown> = {
        company_id: companyId,
        space_id: bookingModal.id,
        employee_id: employeeId,
        booking_date: selectedDate,
        start_time: bookingStartTime,
        end_time: bookingEndTime,
        status: 'confirmed',
      }
      if (isRoom) {
        row.title = bookingTitle || null
        row.attendees = bookingAttendees ? bookingAttendees.split(',').map(s => s.trim()).filter(Boolean) : []
        row.guests = bookingGuests ? bookingGuests.split(',').map(s => s.trim()).filter(Boolean) : []
      }
      const { error: insertErr } = await supabase.from('space_bookings').insert(row)
      if (insertErr) {
        const msg = insertErr.message
        setError(msg.includes('desk_unique') || msg.includes('no_overlap') ? t('space.conflict') : msg)
        setSubmitting(false)
        return
      }
    }

    setSuccess(t('space.booking_confirmed'))
    setSubmitting(false)
    loadBookingsForDate()
    loadMyBookings()
    setTimeout(() => { setBookingModal(null); setSuccess(null) }, 1200)
  }

  async function cancelBooking(bookingId: string) {
    await supabase.from('space_bookings').update({ status: 'cancelled' }).eq('id', bookingId).eq('company_id', companyId)
    loadMyBookings()
    loadBookingsForDate()
  }

  async function checkIn(bookingId: string) {
    await supabase.from('space_bookings').update({ status: 'checked_in', checked_in_at: new Date().toISOString() }).eq('id', bookingId).eq('company_id', companyId)
    loadMyBookings()
  }

  const todayStr = new Date().toISOString().split('T')[0]

  return (
    <div className="feature-page space-booking-page">
      <header className="space-header">
        <button className="space-header-back" onClick={() => navigate('/')}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <div className="space-header-center">
          <h1 className="space-header-title">{t('space.title')} {t('space.title_accent')}</h1>
          <p className="space-header-subtitle">{t('space.subtitle')}</p>
        </div>
        <button className="space-header-refresh" onClick={() => { loadSpaces(); loadBookingsForDate(); loadMyBookings() }}>
          <svg width="28" height="28" viewBox="0 0 32 32" fill="none">
            <circle cx="16" cy="16" r="14" stroke="#fff" strokeWidth="2" />
            <path d="M22 14a6.5 6.5 0 0 0-11.3-1.5M10 18a6.5 6.5 0 0 0 11.3 1.5" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
            <path d="M22 10v4h-4M10 22v-4h4" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </header>

      <div className="space-tabs">
        <button className={`space-tab ${tab === 'book' ? 'space-tab-active' : ''}`} onClick={() => setTab('book')}>{t('space.tab_book')}</button>
        <button className={`space-tab ${tab === 'my_bookings' ? 'space-tab-active' : ''}`} onClick={() => setTab('my_bookings')}>{t('space.tab_my_bookings')}</button>
      </div>

      {tab === 'book' && (
        <>
          <div className="space-filters">
            <div className="space-filter-row">
              <label className="space-filter-label">{t('space.filter_location')}</label>
              <select className="space-filter-select" value={selectedLocation} onChange={e => { setSelectedLocation(e.target.value); setSelectedFloor('') }}>
                {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </div>
            <div className="space-filter-row">
              <label className="space-filter-label">{t('space.filter_floor')}</label>
              <select className="space-filter-select" value={selectedFloor} onChange={e => setSelectedFloor(e.target.value)}>
                <option value="">{t('space.filter_all')}</option>
                {filteredFloors.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
            </div>
            <div className="space-filter-row">
              <label className="space-filter-label">{t('space.filter_type')}</label>
              <select className="space-filter-select" value={selectedType} onChange={e => setSelectedType(e.target.value as '' | 'desk' | 'room')}>
                <option value="">{t('space.filter_all')}</option>
                <option value="desk">{t('space.filter_desks')}</option>
                <option value="room">{t('space.filter_rooms')}</option>
              </select>
            </div>
            <div className="space-filter-row">
              <label className="space-filter-label">{t('space.filter_date')}</label>
              <input type="date" className="space-filter-select" value={selectedDate} min={todayStr} max={maxDateStr} onChange={e => setSelectedDate(e.target.value)} />
            </div>
            <div className="space-filter-row">
              <label className="space-filter-label">{t('space.start_time')}</label>
              <select className="space-filter-select" value={selectedTime} onChange={e => setSelectedTime(e.target.value)}>
                {TIME_SLOTS.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div className="space-filter-row">
              <label className="space-filter-label">{t('space.end_time')}</label>
              <select className="space-filter-select" value={selectedEndTime} onChange={e => setSelectedEndTime(e.target.value)}>
                {TIME_SLOTS.filter(s => timeToMinutes(s) >= timeToMinutes(selectedTime) + 30).map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>

          {spaces.length === 0 ? (
            <p className="space-empty">{t('space.no_spaces')}</p>
          ) : (
            <div className="space-grid">
              {spaces.map(space => {
                const booked = isSpaceBooked(space.id)
                const spaceBookings = bookings.filter(b => b.space_id === space.id)
                return (
                  <div key={space.id} className={`space-card ${booked ? 'space-card-booked' : 'space-card-available'}`}>
                    <div className="space-card-icon">
                      {space.space_type === 'desk' ? (
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="7" width="20" height="3" rx="1"/><path d="M4 10v7"/><path d="M20 10v7"/><path d="M12 10v4"/></svg>
                      ) : (
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
                      )}
                    </div>
                    <div className="space-card-info">
                      <span className="space-card-name">{space.name}</span>
                      <span className="space-card-meta">{getFloorName(space.floor_id)} &middot; {space.space_type === 'desk' ? t('space.desk') : t('space.room')}{space.space_type === 'room' && ` (${space.capacity})`}</span>
                      {space.equipment_tags.length > 0 && (
                        <div className="space-card-tags">{space.equipment_tags.map(tag => <span key={tag} className="space-tag">{tag}</span>)}</div>
                      )}
                      {spaceBookings.length > 0 && (
                        <div className="space-card-slots">
                          {spaceBookings.map(b => (
                            <span key={b.id} className="space-slot-badge">
                              {b.start_time?.slice(0, 5)} – {b.end_time?.slice(0, 5)}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="space-card-action">
                      {booked ? (
                        <span className="space-status-badge space-booked-badge">{t('space.unavailable')}</span>
                      ) : (
                        <button className="space-book-btn" onClick={() => openBookingModal(space)}>
                          {space.space_type === 'desk' ? t('space.book_desk') : t('space.book_room')}
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}

      {tab === 'my_bookings' && (
        <div className="space-my-bookings">
          {myBookings.length === 0 ? (
            <p className="space-empty">{t('space.no_bookings')}</p>
          ) : (
            myBookings.map(b => {
              const spaceName = (b as unknown as { space: { name: string } })?.space?.name || ''
              const spaceType = (b as unknown as { space: { space_type: string } })?.space?.space_type || ''
              const isToday = b.booking_date === todayStr
              const isPast = b.booking_date < todayStr
              return (
                <div key={b.id} className={`space-booking-card ${b.status === 'cancelled' ? 'space-booking-cancelled' : ''}`}>
                  <div className="space-booking-header">
                    <span className="space-booking-name">{spaceName}</span>
                    <span className={`space-status-badge space-status-${b.status}`}>
                      {b.status === 'confirmed' && isToday ? t('space.today') : b.status === 'confirmed' ? t('space.upcoming') : b.status === 'checked_in' ? t('space.checked_in') : b.status === 'cancelled' ? t('space.cancelled') : t('space.no_show')}
                    </span>
                  </div>
                  {b.admin_modified_at && (
                    <div className="space-amended-badge">{t('space.amended_by_admin')}</div>
                  )}
                  <div className="space-booking-details">
                    <span>{b.booking_date}</span>
                    {b.start_time && b.end_time && <span>{b.start_time.slice(0, 5)} – {b.end_time.slice(0, 5)}</span>}
                    {b.title && <span className="space-booking-title">{b.title}</span>}
                    <span className="space-booking-type">{spaceType === 'desk' ? t('space.desk') : t('space.room')}</span>
                  </div>
                  {b.status === 'confirmed' && !isPast && (
                    <div className="space-booking-actions">
                      {isToday && <button className="space-checkin-btn" onClick={() => checkIn(b.id)}>{t('space.check_in')}</button>}
                      <button className="space-cancel-btn" onClick={() => cancelBooking(b.id)}>{t('space.cancel_booking')}</button>
                    </div>
                  )}
                </div>
              )
            })
          )}
        </div>
      )}

      {bookingModal && (
        <div className="space-modal-overlay" onClick={() => setBookingModal(null)}>
          <div className="space-modal" onClick={e => e.stopPropagation()}>
            <div className="space-modal-header">
              <h2>{bookingModal.space_type === 'desk' ? t('space.book_desk') : t('space.book_room')}</h2>
              <button className="space-modal-close" onClick={() => setBookingModal(null)}>&times;</button>
            </div>
            <div className="space-modal-body">
              <p className="space-modal-space-name">{bookingModal.name} &middot; {getFloorName(bookingModal.floor_id)}</p>

              {bookingModal.space_type === 'desk' && (
                <div className="space-modal-field">
                  <label>
                    <input type="checkbox" checked={bookingMultiDay} onChange={e => setBookingMultiDay(e.target.checked)} />
                    {' '}{t('space.multi_day')}
                  </label>
                  {bookingMultiDay ? (
                    <div className="space-modal-dates">
                      <div>
                        <label className="space-modal-label">{t('space.date_from')}</label>
                        <input type="date" className="space-modal-input" value={selectedDate} disabled />
                      </div>
                      <div>
                        <label className="space-modal-label">{t('space.date_to')}</label>
                        <input type="date" className="space-modal-input" value={bookingEndDate} min={selectedDate} max={maxDateStr} onChange={e => setBookingEndDate(e.target.value)} />
                      </div>
                    </div>
                  ) : (
                    <div className="space-modal-time-row">
                      <div>
                        <label className="space-modal-label">{t('space.start_time')}</label>
                        <select className="space-modal-input" value={bookingStartTime} onChange={e => setBookingStartTime(e.target.value)}>
                          {TIME_SLOTS.map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="space-modal-label">{t('space.end_time')}</label>
                        <select className="space-modal-input" value={bookingEndTime} onChange={e => setBookingEndTime(e.target.value)}>
                          {TIME_SLOTS.filter(s => timeToMinutes(s) >= timeToMinutes(bookingStartTime) + 30).map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {bookingModal.space_type === 'room' && (
                <>
                  <div className="space-modal-field">
                    <label className="space-modal-label">{t('space.booking_title')}</label>
                    <input className="space-modal-input" value={bookingTitle} onChange={e => setBookingTitle(e.target.value)} placeholder={t('space.booking_title')} />
                  </div>
                  <div className="space-modal-time-row">
                    <div>
                      <label className="space-modal-label">{t('space.start_time')}</label>
                      <select className="space-modal-input" value={bookingStartTime} onChange={e => setBookingStartTime(e.target.value)}>
                        {TIME_SLOTS.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="space-modal-label">{t('space.end_time')}</label>
                      <select className="space-modal-input" value={bookingEndTime} onChange={e => setBookingEndTime(e.target.value)}>
                        {TIME_SLOTS.filter(s => timeToMinutes(s) >= timeToMinutes(bookingStartTime) + 30).map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </div>
                  </div>
                  <div className="space-modal-field">
                    <label className="space-modal-label">{t('space.attendees')}</label>
                    <input className="space-modal-input" value={bookingAttendees} onChange={e => setBookingAttendees(e.target.value)} placeholder="name1, name2" />
                  </div>
                  <div className="space-modal-field">
                    <label className="space-modal-label">{t('space.guests')}</label>
                    <input className="space-modal-input" value={bookingGuests} onChange={e => setBookingGuests(e.target.value)} placeholder="guest@email.com" />
                  </div>
                </>
              )}

              {error && <p className="space-modal-error">{error}</p>}
              {success && <p className="space-modal-success">{success}</p>}
            </div>
            <div className="space-modal-footer">
              <button className="space-confirm-btn" onClick={handleBooking} disabled={submitting}>
                {submitting ? '...' : t('space.confirm_booking')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
