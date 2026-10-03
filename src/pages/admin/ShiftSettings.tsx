import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { useAdminCompany } from '../../context/AdminCompanyContext'
import { useToast } from '../../context/ToastContext'
import type { CheckinSettings } from '../../context/CheckInContext'

interface WorkLocationRow {
  id: string
  name: string
  address: string
  latitude: number
  longitude: number
  radius_metres: number
  allow_remote: boolean
  is_active: boolean
}

interface ShiftAppSettings {
  allow_shift_swaps: boolean
  swap_require_manager_approval: boolean
  swap_request_window_days: number
  shift_reminder_enabled: boolean
  shift_reminder_hours_before: number
  rota_published_notify: boolean
  swap_notifications_enabled: boolean
}

export default function ShiftSettings() {
  const { selectedCompanyId } = useAdminCompany()
  const companyId = selectedCompanyId || ''
  const { showSuccess, showError } = useToast()

  const defaultAppSettings: ShiftAppSettings = {
    allow_shift_swaps: true,
    swap_require_manager_approval: true,
    swap_request_window_days: 7,
    shift_reminder_enabled: true,
    shift_reminder_hours_before: 2,
    rota_published_notify: true,
    swap_notifications_enabled: true,
  }

  const [settings, setSettings] = useState<CheckinSettings | null>(null)
  const [appSettings, setAppSettings] = useState<ShiftAppSettings>(defaultAppSettings)
  const [locations, setLocations] = useState<WorkLocationRow[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [departments, setDepartments] = useState<string[]>([])

  const [showLocForm, setShowLocForm] = useState(false)
  const [editingLoc, setEditingLoc] = useState<WorkLocationRow | null>(null)
  const [locForm, setLocForm] = useState({ name: '', address: '', latitude: '', longitude: '', radius_metres: '200', allow_remote: false })

  const load = useCallback(async () => {
    if (!companyId) return
    setLoading(true)
    const [sRes, lRes, dRes, asRes] = await Promise.all([
      supabase.from('checkin_settings').select('*').eq('company_id', companyId).single(),
      supabase.from('work_locations').select('*').eq('company_id', companyId).order('name'),
      supabase.from('employees').select('department').eq('company_id', companyId).eq('is_active', true),
      supabase.from('app_settings').select('*').eq('company_id', companyId).single(),
    ])
    if (sRes.data) setSettings(sRes.data)
    else {
      const { data: newS } = await supabase.from('checkin_settings').insert({ company_id: companyId }).select().single()
      if (newS) setSettings(newS)
    }
    if (lRes.data) setLocations(lRes.data)
    if (dRes.data) {
      const unique = [...new Set(dRes.data.map((d: { department: string | null }) => d.department).filter(Boolean))] as string[]
      setDepartments(unique.sort())
    }
    if (asRes.data) {
      setAppSettings({
        allow_shift_swaps: asRes.data.allow_shift_swaps ?? defaultAppSettings.allow_shift_swaps,
        swap_require_manager_approval: asRes.data.swap_require_manager_approval ?? defaultAppSettings.swap_require_manager_approval,
        swap_request_window_days: asRes.data.swap_request_window_days ?? defaultAppSettings.swap_request_window_days,
        shift_reminder_enabled: asRes.data.shift_reminder_enabled ?? defaultAppSettings.shift_reminder_enabled,
        shift_reminder_hours_before: asRes.data.shift_reminder_hours_before ?? defaultAppSettings.shift_reminder_hours_before,
        rota_published_notify: asRes.data.rota_published_notify ?? defaultAppSettings.rota_published_notify,
        swap_notifications_enabled: asRes.data.swap_notifications_enabled ?? defaultAppSettings.swap_notifications_enabled,
      })
    }
    setLoading(false)
  }, [companyId])

  useEffect(() => { load() }, [load])

  async function toggleCheckin() {
    if (!settings) return
    const newVal = !settings.shifts_checkin_enabled
    setSaving(true)

    if (!newVal) {
      const { data: count } = await supabase.rpc('cancel_current_month_checkins', {
        p_company_id: companyId,
        p_source: 'shifts',
      })
      if (typeof count === 'number' && count > 0) {
        showSuccess(`Check-in disabled. ${count} current-month record${count > 1 ? 's' : ''} cancelled.`)
      }
    }

    const { error } = await supabase.from('checkin_settings').update({
      shifts_checkin_enabled: newVal,
      updated_at: new Date().toISOString(),
    }).eq('id', settings.id)

    if (error) { showError(error.message); setSaving(false); return }
    setSettings({ ...settings, shifts_checkin_enabled: newVal })
    if (newVal) showSuccess('Check-in enabled')
    setSaving(false)
  }

  async function updateCheckinSetting(key: string, value: unknown) {
    if (!settings) return
    const { error } = await supabase.from('checkin_settings').update({
      [key]: value,
      updated_at: new Date().toISOString(),
    }).eq('id', settings.id)
    if (error) { showError(error.message); return }
    setSettings({ ...settings, [key]: value } as CheckinSettings)
    showSuccess('Setting updated')
  }

  async function updateAppSetting(key: string, value: unknown) {
    if (!appSettings) return
    const { error } = await supabase.from('app_settings').update({
      [key]: value,
      updated_at: new Date().toISOString(),
    }).eq('company_id', companyId)
    if (error) { showError(error.message); return }
    setAppSettings({ ...appSettings, [key]: value } as ShiftAppSettings)
    showSuccess('Setting updated')
  }

  function openLocForm(loc?: WorkLocationRow) {
    if (loc) {
      setEditingLoc(loc)
      setLocForm({
        name: loc.name, address: loc.address || '', latitude: String(loc.latitude),
        longitude: String(loc.longitude), radius_metres: String(loc.radius_metres),
        allow_remote: loc.allow_remote,
      })
    } else {
      setEditingLoc(null)
      setLocForm({ name: '', address: '', latitude: '', longitude: '', radius_metres: '200', allow_remote: false })
    }
    setShowLocForm(true)
  }

  async function saveLoc() {
    const lat = parseFloat(locForm.latitude)
    const lng = parseFloat(locForm.longitude)
    const radius = parseInt(locForm.radius_metres, 10)
    if (!locForm.name.trim()) { showError('Name is required'); return }
    if (isNaN(lat) || lat < -90 || lat > 90) { showError('Invalid latitude (-90 to 90)'); return }
    if (isNaN(lng) || lng < -180 || lng > 180) { showError('Invalid longitude (-180 to 180)'); return }
    if (isNaN(radius) || radius < 50) { showError('Radius must be at least 50 metres'); return }

    setSaving(true)
    const row = {
      company_id: companyId,
      name: locForm.name.trim(),
      address: locForm.address.trim(),
      latitude: lat,
      longitude: lng,
      radius_metres: radius,
      allow_remote: locForm.allow_remote,
    }

    if (editingLoc) {
      const { error } = await supabase.from('work_locations').update({ ...row, updated_at: new Date().toISOString() }).eq('id', editingLoc.id)
      if (error) { showError(error.message); setSaving(false); return }
    } else {
      const { error } = await supabase.from('work_locations').insert(row)
      if (error) { showError(error.message); setSaving(false); return }
    }
    showSuccess(editingLoc ? 'Location updated' : 'Location added')
    setShowLocForm(false)
    setSaving(false)
    load()
  }

  async function deleteLoc(id: string) {
    if (!confirm('Delete this work location?')) return
    const { error } = await supabase.from('work_locations').delete().eq('id', id)
    if (error) { showError(error.message); return }
    showSuccess('Location deleted')
    load()
  }

  async function toggleLocActive(loc: WorkLocationRow) {
    const { error } = await supabase.from('work_locations').update({ is_active: !loc.is_active, updated_at: new Date().toISOString() }).eq('id', loc.id)
    if (error) { showError(error.message); return }
    load()
  }

  if (loading) return <div className="admin-loading">Loading...</div>

  return (
    <div className="admin-settings-section">
      {/* Check-In Settings */}
      <div className="admin-settings-group">
        <div className="ss-group-header">
          <div className="ss-group-icon ss-icon-checkin">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M10 18a8 8 0 100-16 8 8 0 000 16z" stroke="currentColor" strokeWidth="1.5"/><path d="M7 10l2 2 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </div>
          <div>
            <h3>Check-In</h3>
            <p className="ss-group-desc">Require employees to check in at the start of their shift using geolocation</p>
          </div>
          <label className="admin-toggle" style={{ cursor: 'pointer', marginLeft: 'auto', flexShrink: 0 }}>
            <input
              type="checkbox"
              checked={settings?.shifts_checkin_enabled || false}
              onChange={toggleCheckin}
              disabled={saving}
            />
            <span className="admin-toggle-slider" />
          </label>
        </div>

        {settings?.shifts_checkin_enabled && (
          <div className="ss-settings-grid">
            <div className="ss-setting-row">
              <div className="ss-setting-info">
                <span className="ss-setting-label">Allow Work From Home</span>
                <span className="ss-setting-hint">Employees can check in without being at a work location</span>
              </div>
              <label className="admin-toggle" style={{ cursor: 'pointer' }}>
                <input type="checkbox" checked={settings.allow_work_from_home} onChange={() => updateCheckinSetting('allow_work_from_home', !settings.allow_work_from_home)} />
                <span className="admin-toggle-slider" />
              </label>
            </div>
            <div className="ss-setting-row">
              <div className="ss-setting-info">
                <span className="ss-setting-label">Auto-Checkout</span>
                <span className="ss-setting-hint">Automatically check out after this many hours if the employee forgets</span>
              </div>
              <div className="ss-input-suffix">
                <input className="admin-input" type="number" min={1} max={24} value={settings.auto_checkout_hours}
                  onChange={e => updateCheckinSetting('auto_checkout_hours', parseInt(e.target.value, 10) || 2)}
                />
                <span>hrs</span>
              </div>
            </div>
            <div className="ss-setting-row">
              <div className="ss-setting-info">
                <span className="ss-setting-label">Prompt Before Shift</span>
                <span className="ss-setting-hint">Show the check-in prompt this many minutes before a shift starts</span>
              </div>
              <div className="ss-input-suffix">
                <input className="admin-input" type="number" min={5} max={60} value={settings.prompt_before_shift_mins}
                  onChange={e => updateCheckinSetting('prompt_before_shift_mins', parseInt(e.target.value, 10) || 20)}
                />
                <span>mins</span>
              </div>
            </div>
            <div className="ss-setting-row ss-setting-row-full">
              <div className="ss-setting-info">
                <span className="ss-setting-label">Enabled Departments</span>
                <span className="ss-setting-hint">Restrict check-in to specific departments or enable for all</span>
              </div>
              <select className="admin-input" value={settings.allowed_departments ? 'specific' : 'all'} style={{ maxWidth: 200 }}
                onChange={e => updateCheckinSetting('allowed_departments', e.target.value === 'all' ? null : [])}>
                <option value="all">All Departments</option>
                <option value="specific">Specific Departments</option>
              </select>
            </div>
            {settings.allowed_departments !== null && (
              <div className="ss-dept-chips">
                {departments.map(d => {
                  const checked = settings.allowed_departments?.includes(d) || false
                  return (
                    <button
                      key={d}
                      className={`ss-dept-chip ${checked ? 'ss-dept-chip-active' : ''}`}
                      onClick={() => {
                        const current = settings.allowed_departments || []
                        const next = checked ? current.filter(x => x !== d) : [...current, d]
                        updateCheckinSetting('allowed_departments', next)
                      }}
                    >
                      {checked && <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M3 6l2 2 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                      {d}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Work Locations */}
      <div className="admin-settings-group">
        <div className="ss-group-header">
          <div className="ss-group-icon ss-icon-location">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M10 11a3 3 0 100-6 3 3 0 000 6z" stroke="currentColor" strokeWidth="1.5"/><path d="M10 18s-6-4.35-6-9A6 6 0 0116 9c0 4.65-6 9-6 9z" stroke="currentColor" strokeWidth="1.5"/></svg>
          </div>
          <div>
            <h3>Work Locations</h3>
            <p className="ss-group-desc">Define geofenced locations where employees can check in on-site</p>
          </div>
          <button className="admin-save-btn" onClick={() => openLocForm()} style={{ marginLeft: 'auto', flexShrink: 0 }}>+ Add Location</button>
        </div>

        {showLocForm && (
          <div className="ss-loc-form">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div>
                <label className="ss-field-label">Name *</label>
                <input className="admin-input" value={locForm.name} onChange={e => setLocForm({ ...locForm, name: e.target.value })} placeholder="Head Office" />
              </div>
              <div>
                <label className="ss-field-label">Address</label>
                <input className="admin-input" value={locForm.address} onChange={e => setLocForm({ ...locForm, address: e.target.value })} placeholder="123 High Street" />
              </div>
              <div>
                <label className="ss-field-label">Latitude *</label>
                <input className="admin-input" type="number" step="any" value={locForm.latitude} onChange={e => setLocForm({ ...locForm, latitude: e.target.value })} placeholder="51.5074" />
              </div>
              <div>
                <label className="ss-field-label">Longitude *</label>
                <input className="admin-input" type="number" step="any" value={locForm.longitude} onChange={e => setLocForm({ ...locForm, longitude: e.target.value })} placeholder="-0.1278" />
              </div>
              <div>
                <label className="ss-field-label">Radius (metres, min 50)</label>
                <input className="admin-input" type="number" min={50} value={locForm.radius_metres} onChange={e => setLocForm({ ...locForm, radius_metres: e.target.value })} />
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
                <label style={{ fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
                  <input type="checkbox" checked={locForm.allow_remote} onChange={e => setLocForm({ ...locForm, allow_remote: e.target.checked })} />
                  Allow remote check-in
                </label>
              </div>
            </div>
            <div className="admin-form-actions" style={{ marginTop: 10 }}>
              <button className="admin-save-btn" onClick={saveLoc} disabled={saving}>{saving ? 'Saving...' : editingLoc ? 'Update' : 'Add'}</button>
              <button className="admin-cancel-btn" onClick={() => setShowLocForm(false)}>Cancel</button>
            </div>
          </div>
        )}

        {locations.length === 0 ? (
          <div className="ss-empty">
            <svg width="32" height="32" viewBox="0 0 32 32" fill="none"><path d="M16 18a5 5 0 100-10 5 5 0 000 10z" stroke="#ccc" strokeWidth="1.5"/><path d="M16 28s-9-7-9-14a9 9 0 0118 0c0 7-9 14-9 14z" stroke="#ccc" strokeWidth="1.5"/></svg>
            <p>No work locations configured</p>
            <span>Check-in will work without geofencing</span>
          </div>
        ) : (
          <div className="ss-loc-list">
            {locations.map(l => (
              <div key={l.id} className={`ss-loc-card ${!l.is_active ? 'ss-loc-inactive' : ''}`}>
                <div className="ss-loc-info">
                  <div className="ss-loc-name">{l.name}</div>
                  {l.address && <div className="ss-loc-addr">{l.address}</div>}
                  <div className="ss-loc-meta">
                    <span className="ss-loc-coords">{l.latitude.toFixed(4)}, {l.longitude.toFixed(4)}</span>
                    <span className="ss-loc-radius">{l.radius_metres}m radius</span>
                    {l.allow_remote && <span className="ss-loc-badge">Remote OK</span>}
                  </div>
                </div>
                <div className="ss-loc-actions">
                  <span className={`admin-badge admin-badge-${l.is_active ? 'active' : 'inactive'}`}>
                    {l.is_active ? 'Active' : 'Inactive'}
                  </span>
                  <button className="admin-action-btn" onClick={() => openLocForm(l)}>Edit</button>
                  <button className="admin-action-btn" onClick={() => toggleLocActive(l)}>{l.is_active ? 'Disable' : 'Enable'}</button>
                  <button className="admin-action-btn admin-delete-btn" onClick={() => deleteLoc(l.id)}>Delete</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Shift Swaps */}
      <div className="admin-settings-group">
        <div className="ss-group-header">
          <div className="ss-group-icon ss-icon-swap">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M4 7h12M12 3l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/><path d="M16 13H4M8 9l-4 4 4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </div>
          <div>
            <h3>Shift Swaps</h3>
            <p className="ss-group-desc">Control how employees can request and negotiate shift swaps</p>
          </div>
        </div>

        <div className="ss-settings-grid">
          <div className="ss-setting-row">
            <div className="ss-setting-info">
              <span className="ss-setting-label">Allow Shift Swaps</span>
              <span className="ss-setting-hint">Enable employees to request swaps with colleagues</span>
            </div>
            <label className="admin-toggle" style={{ cursor: 'pointer' }}>
              <input type="checkbox" checked={appSettings.allow_shift_swaps} onChange={() => updateAppSetting('allow_shift_swaps', !appSettings.allow_shift_swaps)} />
              <span className="admin-toggle-slider" />
            </label>
          </div>
          {appSettings.allow_shift_swaps && (
            <>
              <div className="ss-setting-row">
                <div className="ss-setting-info">
                  <span className="ss-setting-label">Require Manager Approval</span>
                  <span className="ss-setting-hint">Swaps must be approved by a manager before taking effect</span>
                </div>
                <label className="admin-toggle" style={{ cursor: 'pointer' }}>
                  <input type="checkbox" checked={appSettings.swap_require_manager_approval} onChange={() => updateAppSetting('swap_require_manager_approval', !appSettings.swap_require_manager_approval)} />
                  <span className="admin-toggle-slider" />
                </label>
              </div>
              <div className="ss-setting-row">
                <div className="ss-setting-info">
                  <span className="ss-setting-label">Swap Request Window</span>
                  <span className="ss-setting-hint">Minimum days in advance a swap can be requested</span>
                </div>
                <div className="ss-input-suffix">
                  <input className="admin-input" type="number" min={1} max={30} value={appSettings.swap_request_window_days}
                    onChange={e => updateAppSetting('swap_request_window_days', parseInt(e.target.value, 10) || 7)}
                  />
                  <span>days</span>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Notifications */}
      <div className="admin-settings-group">
        <div className="ss-group-header">
          <div className="ss-group-icon ss-icon-notify">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M10 18a2 2 0 01-2-2h4a2 2 0 01-2 2zM15 9a5 5 0 00-10 0c0 3.5-2 5-2 5h14s-2-1.5-2-5z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </div>
          <div>
            <h3>Notifications</h3>
            <p className="ss-group-desc">Configure which shift-related notifications employees receive</p>
          </div>
        </div>

        <div className="ss-settings-grid">
          <div className="ss-setting-row">
            <div className="ss-setting-info">
              <span className="ss-setting-label">Shift Reminders</span>
              <span className="ss-setting-hint">Send a reminder before upcoming shifts</span>
            </div>
            <label className="admin-toggle" style={{ cursor: 'pointer' }}>
              <input type="checkbox" checked={appSettings.shift_reminder_enabled} onChange={() => updateAppSetting('shift_reminder_enabled', !appSettings.shift_reminder_enabled)} />
              <span className="admin-toggle-slider" />
            </label>
          </div>
          {appSettings.shift_reminder_enabled && (
            <div className="ss-setting-row">
              <div className="ss-setting-info">
                <span className="ss-setting-label">Reminder Lead Time</span>
                <span className="ss-setting-hint">How far in advance to send the shift reminder</span>
              </div>
              <div className="ss-input-suffix">
                <input className="admin-input" type="number" min={1} max={48} value={appSettings.shift_reminder_hours_before}
                  onChange={e => updateAppSetting('shift_reminder_hours_before', parseInt(e.target.value, 10) || 2)}
                />
                <span>hrs</span>
              </div>
            </div>
          )}
          <div className="ss-setting-row">
            <div className="ss-setting-info">
              <span className="ss-setting-label">Rota Published Alerts</span>
              <span className="ss-setting-hint">Notify employees when a new rota is published</span>
            </div>
            <label className="admin-toggle" style={{ cursor: 'pointer' }}>
              <input type="checkbox" checked={appSettings.rota_published_notify} onChange={() => updateAppSetting('rota_published_notify', !appSettings.rota_published_notify)} />
              <span className="admin-toggle-slider" />
            </label>
          </div>
          <div className="ss-setting-row">
            <div className="ss-setting-info">
              <span className="ss-setting-label">Swap Notifications</span>
              <span className="ss-setting-hint">Notify employees about swap requests, approvals, and rejections</span>
            </div>
            <label className="admin-toggle" style={{ cursor: 'pointer' }}>
              <input type="checkbox" checked={appSettings.swap_notifications_enabled} onChange={() => updateAppSetting('swap_notifications_enabled', !appSettings.swap_notifications_enabled)} />
              <span className="admin-toggle-slider" />
            </label>
          </div>
        </div>
      </div>
    </div>
  )
}
