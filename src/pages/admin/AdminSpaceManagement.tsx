import { useState, useEffect, useCallback } from 'react'
import { useAdminCompany } from '../../context/AdminCompanyContext'
import { supabase } from '../../lib/supabase'

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

type SubTab = 'locations' | 'spaces' | 'settings'

const DEFAULT_SETTINGS: SpaceSettings = {
  max_advance_days: 30,
  auto_cancel_no_checkin: false,
  auto_cancel_minutes: 15,
  buffer_minutes: 0,
  default_slot_minutes: 60,
}

export default function AdminSpaceManagement() {
  const { selectedCompanyId: companyId } = useAdminCompany()
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
  const [spaceForm, setSpaceForm] = useState({ name: '', floor_id: '', space_type: 'desk' as 'desk' | 'room', capacity: 1, equipment_tags: '', status: 'draft' as 'draft' | 'active' | 'maintenance' })
  const [showNewSpace, setShowNewSpace] = useState(false)

  const [savingSettings, setSavingSettings] = useState(false)

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

  useEffect(() => { loadAll() }, [loadAll])

  // ---- Location CRUD ----
  async function saveLoc() {
    if (!companyId || !locForm.name.trim()) return
    if (editingLocId) {
      await supabase.from('locations').update({ name: locForm.name, address: locForm.address, timezone: locForm.timezone }).eq('id', editingLocId)
    } else {
      await supabase.from('locations').insert({ company_id: companyId, name: locForm.name, address: locForm.address, timezone: locForm.timezone })
    }
    setEditingLocId(null)
    setShowNewLoc(false)
    loadAll()
  }

  async function deleteLoc(id: string) {
    await supabase.from('locations').delete().eq('id', id)
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
      await supabase.from('floors').update({ name: floorForm.name, location_id: floorForm.location_id }).eq('id', editingFloorId)
    } else {
      await supabase.from('floors').insert({ company_id: companyId, name: floorForm.name, location_id: floorForm.location_id })
    }
    setEditingFloorId(null)
    setShowNewFloor(false)
    loadAll()
  }

  async function deleteFloor(id: string) {
    await supabase.from('floors').delete().eq('id', id)
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
    const tags = spaceForm.equipment_tags.split(',').map(s => s.trim()).filter(Boolean)
    if (editingSpaceId) {
      await supabase.from('spaces').update({
        name: spaceForm.name, floor_id: spaceForm.floor_id, space_type: spaceForm.space_type,
        capacity: spaceForm.capacity, equipment_tags: tags, status: spaceForm.status,
      }).eq('id', editingSpaceId)
    } else {
      await supabase.from('spaces').insert({
        company_id: companyId, name: spaceForm.name, floor_id: spaceForm.floor_id,
        space_type: spaceForm.space_type, capacity: spaceForm.capacity, equipment_tags: tags, status: spaceForm.status,
      })
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
      capacity: space.capacity, equipment_tags: space.equipment_tags.join(', '), status: space.status,
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

  function getLocName(id: string) { return locations.find(l => l.id === id)?.name || '' }
  function getFloorLabel(id: string) {
    const f = floors.find(fl => fl.id === id)
    return f ? `${f.name} (${getLocName(f.location_id)})` : ''
  }

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
            <button className="admin-add-btn" onClick={() => { setShowNewSpace(true); setEditingSpaceId(null); setSpaceForm({ name: '', floor_id: floors[0]?.id || '', space_type: 'desk', capacity: 1, equipment_tags: '', status: 'draft' }) }}>+ Add Space</button>
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
              <input placeholder="Equipment tags (comma separated)" value={spaceForm.equipment_tags} onChange={e => setSpaceForm({ ...spaceForm, equipment_tags: e.target.value })} className="admin-input" />
              <select value={spaceForm.status} onChange={e => setSpaceForm({ ...spaceForm, status: e.target.value as 'draft' | 'active' | 'maintenance' })} className="admin-input">
                <option value="draft">Draft</option>
                <option value="active">Active (Published)</option>
                <option value="maintenance">Maintenance</option>
              </select>
              <div className="admin-form-actions">
                <button className="admin-save-btn" onClick={saveSpace}>Save</button>
                <button className="admin-cancel-btn" onClick={() => { setShowNewSpace(false); setEditingSpaceId(null) }}>Cancel</button>
              </div>
            </div>
          )}

          <table className="admin-table">
            <thead><tr><th>Name</th><th>Floor</th><th>Type</th><th>Capacity</th><th>Equipment</th><th>Status</th><th>Actions</th></tr></thead>
            <tbody>
              {spaces.map(space => (
                <tr key={space.id}>
                  <td>{space.name}</td>
                  <td>{getFloorLabel(space.floor_id)}</td>
                  <td><span className={`admin-badge admin-badge-${space.space_type}`}>{space.space_type === 'desk' ? 'Desk' : 'Room'}</span></td>
                  <td>{space.capacity}</td>
                  <td>{space.equipment_tags.join(', ') || '—'}</td>
                  <td><span className={`admin-badge admin-badge-${space.status}`}>{space.status}</span></td>
                  <td>
                    <button className="admin-action-btn" onClick={() => editSpace(space)}>Edit</button>
                    <button className="admin-action-btn admin-delete-btn" onClick={() => deleteSpace(space.id)}>Delete</button>
                  </td>
                </tr>
              ))}
              {spaces.length === 0 && <tr><td colSpan={7} style={{ textAlign: 'center', color: '#999' }}>No spaces yet — add locations and floors first</td></tr>}
            </tbody>
          </table>
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
