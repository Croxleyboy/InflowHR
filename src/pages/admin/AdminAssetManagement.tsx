import { useState, useEffect, useCallback, useRef } from 'react'
import { useAdminCompany } from '../../context/AdminCompanyContext'
import { useAuth } from '../../context/AuthContext'
import { useFeatures } from '../../context/FeatureContext'
import { useToast } from '../../context/ToastContext'
import { supabase } from '../../lib/supabase'
import { formatDate } from '../../lib/formatters'

const ASSET_TYPES = [
  'Laptop', 'Desktop', 'Mobile Device', 'Tablet', 'Monitor', 'External Drive',
  'USB Drive', 'Microphone', 'PC Camera', 'Headset', 'Computer Mouse', 'Keyboard',
  'Speakers', 'Laptop Case', 'Docking Station', 'Printer', 'Scanner', 'Router',
  'Phone', 'Accessories', 'Other',
]

const ASSET_STATUSES = ['Assigned', 'Unassigned', 'Maintenance', 'Retired', 'Sold', 'Broken'] as const
type AssetStatus = typeof ASSET_STATUSES[number]

interface Asset {
  id: string
  company_id: string
  asset_name: string
  asset_type: string
  brand: string
  model: string
  serial_number: string
  purchase_date: string | null
  warranty_expiry: string | null
  status: AssetStatus
  assigned_to: string | null
  assigned_to_name: string | null
  notes: string
  is_space_asset: boolean
  created_at: string
}

interface AssetHistory {
  id: string
  asset_id: string
  action: string
  from_employee_id: string | null
  from_employee_name: string | null
  to_employee_id: string | null
  to_employee_name: string | null
  notes: string | null
  created_at: string
}

interface EmployeeOption {
  id: string
  first_name: string
  last_name: string
  avatar_url: string | null
}

const EMPTY_FORM = {
  asset_name: '', asset_type: 'Laptop', brand: '', model: '', serial_number: '',
  purchase_date: '', warranty_expiry: '', status: 'Unassigned' as AssetStatus,
  assigned_to: '', notes: '', is_space_asset: false,
}

export default function AdminAssetManagement() {
  const { selectedCompanyId: companyId } = useAdminCompany()
  const { isSuperAdmin } = useAuth()
  const { companyFeatures } = useFeatures()
  const { showError, showSuccess } = useToast()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [assets, setAssets] = useState<Asset[]>([])
  const [loading, setLoading] = useState(true)
  const [accessGranted, setAccessGranted] = useState(true)
  const [search, setSearch] = useState('')
  const [filterType, setFilterType] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [filterOwner, setFilterOwner] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState(EMPTY_FORM)
  const [showAdd, setShowAdd] = useState(false)
  const [addForm, setAddForm] = useState(EMPTY_FORM)
  const [employees, setEmployees] = useState<EmployeeOption[]>([])
  const [history, setHistory] = useState<AssetHistory[]>([])
  const [historyAssetId, setHistoryAssetId] = useState<string | null>(null)
  const [swapAssetId, setSwapAssetId] = useState<string | null>(null)
  const [swapTo, setSwapTo] = useState('')
  const [saving, setSaving] = useState(false)

  const spaceBookingEnabled = companyFeatures.space_booking

  const checkAccess = useCallback(async () => {
    if (!companyId || !isSuperAdmin) { setAccessGranted(true); return }
    const { data } = await supabase
      .from('tenant_support_access')
      .select('id')
      .eq('company_id', companyId)
      .eq('status', 'active')
      .gt('expires_at', new Date().toISOString())
      .limit(1)
    setAccessGranted((data || []).length > 0)
  }, [companyId, isSuperAdmin])

  const loadAssets = useCallback(async () => {
    if (!companyId) return
    setLoading(true)
    if (isSuperAdmin) await checkAccess()
    const { data, error } = await supabase
      .from('company_assets')
      .select('*')
      .eq('company_id', companyId)
      .order('created_at', { ascending: false })
    if (error) { showError('Failed to load assets'); setLoading(false); return }
    setAssets((data as Asset[]) || [])
    setLoading(false)
  }, [companyId, isSuperAdmin, checkAccess])

  const loadEmployees = useCallback(async () => {
    if (!companyId) return
    const { data } = await supabase
      .from('employees')
      .select('id, first_name, last_name, avatar_url')
      .eq('company_id', companyId)
      .eq('is_active', true)
      .order('first_name')
    setEmployees((data as EmployeeOption[]) || [])
  }, [companyId])

  useEffect(() => { loadAssets(); loadEmployees() }, [loadAssets, loadEmployees])

  function getEmployeeName(id: string | null): string {
    if (!id) return ''
    const emp = employees.find(e => e.id === id)
    return emp ? `${emp.first_name} ${emp.last_name}` : ''
  }

  function getEmployeeAvatar(id: string | null): string | null {
    if (!id) return null
    return employees.find(e => e.id === id)?.avatar_url || null
  }

  let nextNumber = assets.length + 1
  function generateAssetName(type: string): string {
    const prefix = type.toUpperCase().replace(/\s+/g, '-').slice(0, 10)
    const name = `${prefix}-${String(nextNumber).padStart(4, '0')}`
    nextNumber++
    return name
  }

  async function addAsset() {
    if (!companyId) return
    setSaving(true)
    const assetName = addForm.asset_name || generateAssetName(addForm.asset_type)
    const { error } = await supabase.from('company_assets').insert({
      company_id: companyId,
      asset_name: assetName,
      asset_type: addForm.asset_type,
      brand: addForm.brand,
      model: addForm.model,
      serial_number: addForm.serial_number,
      purchase_date: addForm.purchase_date || null,
      warranty_expiry: addForm.warranty_expiry || null,
      status: addForm.assigned_to ? 'Assigned' : addForm.status,
      assigned_to: addForm.assigned_to || null,
      assigned_to_name: addForm.assigned_to ? getEmployeeName(addForm.assigned_to) : null,
      notes: addForm.notes,
      is_space_asset: addForm.is_space_asset,
    })
    if (error) { showError('Failed to add asset: ' + error.message); setSaving(false); return }
    if (addForm.assigned_to) {
      await supabase.from('asset_history').insert({
        asset_id: assetName,
        company_id: companyId,
        action: 'Assigned',
        to_employee_id: addForm.assigned_to,
        to_employee_name: getEmployeeName(addForm.assigned_to),
        notes: 'Initial assignment',
      })
    }
    showSuccess('Asset added')
    setAddForm(EMPTY_FORM)
    setShowAdd(false)
    setSaving(false)
    loadAssets()
  }

  async function saveEdit(asset: Asset) {
    setSaving(true)
    const assignedChanged = editForm.assigned_to !== (asset.assigned_to || '')
    const statusChanged = editForm.status !== asset.status
    const { error } = await supabase.from('company_assets').update({
      asset_name: editForm.asset_name,
      asset_type: editForm.asset_type,
      brand: editForm.brand,
      model: editForm.model,
      serial_number: editForm.serial_number,
      purchase_date: editForm.purchase_date || null,
      warranty_expiry: editForm.warranty_expiry || null,
      status: editForm.assigned_to ? 'Assigned' : editForm.status,
      assigned_to: editForm.assigned_to || null,
      assigned_to_name: editForm.assigned_to ? getEmployeeName(editForm.assigned_to) : null,
      notes: editForm.notes,
      is_space_asset: editForm.is_space_asset,
    }).eq('id', asset.id)
    if (error) { showError('Failed to save: ' + error.message); setSaving(false); return }
    if (assignedChanged) {
      await supabase.from('asset_history').insert({
        asset_id: asset.id,
        company_id: companyId,
        action: editForm.assigned_to ? 'Reassigned' : 'Unassigned',
        from_employee_id: asset.assigned_to || null,
        from_employee_name: asset.assigned_to_name || null,
        to_employee_id: editForm.assigned_to || null,
        to_employee_name: editForm.assigned_to ? getEmployeeName(editForm.assigned_to) : null,
      })
    }
    if (statusChanged && !assignedChanged) {
      await supabase.from('asset_history').insert({
        asset_id: asset.id,
        company_id: companyId,
        action: `Status changed to ${editForm.status}`,
        from_employee_id: asset.assigned_to || null,
        from_employee_name: asset.assigned_to_name || null,
      })
    }
    showSuccess('Asset updated')
    setEditingId(null)
    setSaving(false)
    loadAssets()
  }

  async function changeStatus(asset: Asset, newStatus: AssetStatus) {
    const { error } = await supabase.from('company_assets').update({
      status: newStatus,
      ...(newStatus !== 'Assigned' ? { assigned_to: null, assigned_to_name: null } : {}),
    }).eq('id', asset.id)
    if (error) { showError('Failed to update status'); return }
    await supabase.from('asset_history').insert({
      asset_id: asset.id,
      company_id: companyId,
      action: `Status changed to ${newStatus}`,
      from_employee_id: asset.assigned_to || null,
      from_employee_name: asset.assigned_to_name || null,
    })
    showSuccess(`Status changed to ${newStatus}`)
    loadAssets()
  }

  async function swapOwnership(asset: Asset) {
    if (!swapTo) return
    setSaving(true)
    const { error } = await supabase.from('company_assets').update({
      assigned_to: swapTo,
      assigned_to_name: getEmployeeName(swapTo),
      status: 'Assigned',
    }).eq('id', asset.id)
    if (error) { showError('Failed to swap ownership'); setSaving(false); return }
    await supabase.from('asset_history').insert({
      asset_id: asset.id,
      company_id: companyId,
      action: 'Ownership swapped',
      from_employee_id: asset.assigned_to || null,
      from_employee_name: asset.assigned_to_name || null,
      to_employee_id: swapTo,
      to_employee_name: getEmployeeName(swapTo),
    })
    showSuccess('Ownership swapped')
    setSwapAssetId(null)
    setSwapTo('')
    setSaving(false)
    loadAssets()
  }

  async function deleteAsset(id: string) {
    if (!confirm('Delete this asset and all its history? This cannot be undone.')) return
    await supabase.from('asset_history').delete().eq('asset_id', id)
    const { error } = await supabase.from('company_assets').delete().eq('id', id)
    if (error) { showError('Failed to delete asset'); return }
    showSuccess('Asset deleted')
    loadAssets()
  }

  async function loadHistory(assetId: string) {
    setHistoryAssetId(assetId)
    const { data } = await supabase
      .from('asset_history')
      .select('*')
      .eq('asset_id', assetId)
      .order('created_at', { ascending: false })
    setHistory((data as AssetHistory[]) || [])
  }

  function exportCsv() {
    const headers = ['Asset Name', 'Type', 'Brand', 'Model', 'Serial Number', 'Purchase Date', 'Warranty Expiry', 'Status', 'Assigned To', 'Space Asset', 'Notes', 'Date Registered']
    const rows = filtered.map(a => [
      a.asset_name, a.asset_type, a.brand, a.model, a.serial_number,
      a.purchase_date || '', a.warranty_expiry || '', a.status,
      a.assigned_to_name || '', a.is_space_asset ? 'Yes' : 'No', a.notes, a.created_at,
    ])
    const csv = [headers.join(','), ...rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `assets-export-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  function downloadTemplate() {
    const headers = ['asset_type', 'brand', 'model', 'serial_number', 'purchase_date', 'warranty_expiry', 'status', 'assigned_to_email', 'notes', 'is_space_asset']
    const example = ['Laptop', 'Dell', 'Latitude 5540', 'SN123456', '2024-01-15', '2027-01-15', 'Assigned', 'john@company.com', 'Standard issue', 'No']
    const csv = [headers.join(','), example.join(',')].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'asset-import-template.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || !companyId) return
    const text = await file.text()
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean)
    if (lines.length < 2) { showError('CSV must have a header row and at least one data row'); return }
    const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/"/g, ''))
    const typeIdx = headers.indexOf('asset_type')
    const brandIdx = headers.indexOf('brand')
    const modelIdx = headers.indexOf('model')
    const serialIdx = headers.indexOf('serial_number')
    const purchIdx = headers.indexOf('purchase_date')
    const warrantyIdx = headers.indexOf('warranty_expiry')
    const statusIdx = headers.indexOf('status')
    const emailIdx = headers.indexOf('assigned_to_email')
    const notesIdx = headers.indexOf('notes')
    const spaceIdx = headers.indexOf('is_space_asset')
    if (typeIdx === -1) { showError('CSV must have an asset_type column'); return }

    let imported = 0
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',').map(c => c.trim().replace(/^"|"$/g, ''))
      const assetType = cols[typeIdx] || 'Other'
      const brand = brandIdx >= 0 ? cols[brandIdx] || '' : ''
      const model = modelIdx >= 0 ? cols[modelIdx] || '' : ''
      const serial = serialIdx >= 0 ? cols[serialIdx] || '' : ''
      const purchDate = purchIdx >= 0 && cols[purchIdx] ? cols[purchIdx] : null
      const warranty = warrantyIdx >= 0 && cols[warrantyIdx] ? cols[warrantyIdx] : null
      const status = statusIdx >= 0 ? (cols[statusIdx] as AssetStatus) || 'Unassigned' : 'Unassigned'
      const email = emailIdx >= 0 ? cols[emailIdx] || '' : ''
      const notes = notesIdx >= 0 ? cols[notesIdx] || '' : ''
      const isSpace = spaceIdx >= 0 ? cols[spaceIdx]?.toLowerCase() === 'yes' : false

      let assignedTo: string | null = null
      let assignedName: string | null = null
      if (email) {
        const { data: emp } = await supabase
          .from('employees')
          .select('id, first_name, last_name, avatar_url')
          .eq('company_id', companyId)
          .eq('email', email)
          .maybeSingle()
        if (emp) {
          assignedTo = emp.id
          assignedName = `${emp.first_name} ${emp.last_name}`
        }
      }

      const assetName = generateAssetName(assetType)
      await supabase.from('company_assets').insert({
        company_id: companyId,
        asset_name: assetName,
        asset_type: assetType,
        brand, model, serial_number: serial,
        purchase_date: purchDate, warranty_expiry: warranty,
        status: assignedTo ? 'Assigned' : status,
        assigned_to: assignedTo, assigned_to_name: assignedName,
        notes, is_space_asset: isSpace,
      })
      imported++
    }
    showSuccess(`Imported ${imported} asset${imported !== 1 ? 's' : ''}`)
    loadAssets()
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const filtered = assets.filter(a => {
    if (search && !a.asset_name.toLowerCase().includes(search.toLowerCase()) && !a.brand.toLowerCase().includes(search.toLowerCase()) && !a.model.toLowerCase().includes(search.toLowerCase()) && !(a.assigned_to_name || '').toLowerCase().includes(search.toLowerCase())) return false
    if (filterType && a.asset_type !== filterType) return false
    if (filterStatus && a.status !== filterStatus) return false
    if (filterOwner && a.assigned_to !== filterOwner) return false
    return true
  })

  const statusCounts = ASSET_STATUSES.reduce((acc, s) => {
    acc[s] = assets.filter(a => a.status === s).length
    return acc
  }, {} as Record<string, number>)

  const statusColor: Record<string, string> = {
    Assigned: '#2e7d32', Unassigned: '#1565c0', Maintenance: '#e65100',
    Retired: '#616161', Sold: '#6a1b9a', Broken: '#c62828',
  }

  if (loading) return <div className="admin-section"><div className="admin-loading">Loading...</div></div>

  if (isSuperAdmin && !accessGranted) return (
    <div className="admin-section">
      <div className="admin-page-header">
        <h2>Asset Management</h2>
        <p>Register, track and manage company assets</p>
      </div>
      <div style={{
        padding: 32, textAlign: 'center', background: 'var(--bg-card, #fff)',
        borderRadius: 12, border: '1px solid var(--border, #e5e7eb)', marginTop: 16,
      }}>
        <div style={{ fontSize: 48, marginBottom: 12 }}>🔒</div>
        <h3 style={{ margin: '0 0 8px', color: 'var(--text, #1a1a2e)' }}>GDPR Access Required</h3>
        <p style={{ color: 'var(--text-muted, #8b8fa3)', fontSize: 14, maxWidth: 480, margin: '0 auto 16px' }}>
          Asset data is classified as company-sensitive under GDPR Art. 28. Super Admin access requires
          an active support grant from the company admin or via the Support Access page.
        </p>
        <p style={{ color: 'var(--text-muted, #8b8fa3)', fontSize: 13 }}>
          Navigate to <strong>Support Access</strong> in the sidebar to request or grant access.
        </p>
      </div>
    </div>
  )

  return (
    <div className="admin-section">
      <div className="admin-page-header">
        <h2>Asset Management</h2>
        <p>Register, track and manage company assets</p>
      </div>

      <div className="admin-mini-stats">
        <div className="admin-mini-stat">
          <span className="admin-mini-value">{assets.length}</span>
          <span>Total Assets</span>
        </div>
        {ASSET_STATUSES.map(s => statusCounts[s] > 0 && (
          <div className="admin-mini-stat" key={s}>
            <span className="admin-mini-value" style={{ color: statusColor[s] }}>{statusCounts[s]}</span>
            <span>{s}</span>
          </div>
        ))}
      </div>

      {/* Actions bar */}
      <div className="admin-filters" style={{ flexWrap: 'wrap' }}>
        <input
          className="admin-input"
          placeholder="Search assets..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ minWidth: 200 }}
        />
        <select className="admin-select" value={filterType} onChange={e => setFilterType(e.target.value)}>
          <option value="">All Types</option>
          {ASSET_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <select className="admin-select" value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
          <option value="">All Statuses</option>
          {ASSET_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select className="admin-select" value={filterOwner} onChange={e => setFilterOwner(e.target.value)}>
          <option value="">All Owners</option>
          {employees.map(emp => <option key={emp.id} value={emp.id}>{emp.first_name} {emp.last_name}</option>)}
        </select>
        <div style={{ display: 'flex', gap: 6, marginLeft: 'auto' }}>
          <button className="admin-btn admin-btn-primary" onClick={() => { setShowAdd(true); setAddForm({ ...EMPTY_FORM }) }}>+ Add Asset</button>
          <button className="admin-btn" onClick={() => fileInputRef.current?.click()}>Import CSV</button>
          <button className="admin-btn" onClick={downloadTemplate}>Download Template</button>
          <button className="admin-btn" onClick={exportCsv}>Export CSV</button>
          <input ref={fileInputRef} type="file" accept=".csv" onChange={handleImport} style={{ display: 'none' }} />
        </div>
      </div>

      {/* Add form */}
      {showAdd && (
        <div className="admin-add-form" style={{ marginBottom: 16 }}>
          <h4 style={{ margin: '0 0 8px' }}>Add New Asset</h4>
          <div className="admin-form-grid">
            <div className="admin-form-field">
              <label>Asset Name (auto-generated if blank)</label>
              <input className="admin-input" value={addForm.asset_name} onChange={e => setAddForm({ ...addForm, asset_name: e.target.value })} placeholder="e.g. LAPTOP-0001" />
            </div>
            <div className="admin-form-field">
              <label>Asset Type</label>
              <select className="admin-select" value={addForm.asset_type} onChange={e => setAddForm({ ...addForm, asset_type: e.target.value })}>
                {ASSET_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div className="admin-form-field">
              <label>Brand</label>
              <input className="admin-input" value={addForm.brand} onChange={e => setAddForm({ ...addForm, brand: e.target.value })} />
            </div>
            <div className="admin-form-field">
              <label>Model</label>
              <input className="admin-input" value={addForm.model} onChange={e => setAddForm({ ...addForm, model: e.target.value })} />
            </div>
            <div className="admin-form-field">
              <label>Serial Number</label>
              <input className="admin-input" value={addForm.serial_number} onChange={e => setAddForm({ ...addForm, serial_number: e.target.value })} />
            </div>
            <div className="admin-form-field">
              <label>Purchase Date</label>
              <input className="admin-input" type="date" value={addForm.purchase_date} onChange={e => setAddForm({ ...addForm, purchase_date: e.target.value })} />
            </div>
            <div className="admin-form-field">
              <label>Warranty Expiry</label>
              <input className="admin-input" type="date" value={addForm.warranty_expiry} onChange={e => setAddForm({ ...addForm, warranty_expiry: e.target.value })} />
            </div>
            <div className="admin-form-field">
              <label>Assign To</label>
              <select className="admin-select" value={addForm.assigned_to} onChange={e => setAddForm({ ...addForm, assigned_to: e.target.value })}>
                <option value="">Unassigned</option>
                {employees.map(emp => <option key={emp.id} value={emp.id}>{emp.first_name} {emp.last_name}</option>)}
              </select>
            </div>
            <div className="admin-form-field">
              <label>Status</label>
              <select className="admin-select" value={addForm.status} onChange={e => setAddForm({ ...addForm, status: e.target.value as AssetStatus })}>
                {ASSET_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            {spaceBookingEnabled && (
              <div className="admin-form-field">
                <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input type="checkbox" checked={addForm.is_space_asset} onChange={e => setAddForm({ ...addForm, is_space_asset: e.target.checked })} />
                  Room / Desk Asset
                </label>
              </div>
            )}
            <div className="admin-form-field" style={{ gridColumn: '1 / -1' }}>
              <label>Notes</label>
              <textarea className="admin-input" value={addForm.notes} onChange={e => setAddForm({ ...addForm, notes: e.target.value })} rows={2} style={{ resize: 'vertical' }} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button className="admin-btn admin-btn-primary" onClick={addAsset} disabled={saving}>{saving ? 'Saving...' : 'Save Asset'}</button>
            <button className="admin-btn" onClick={() => setShowAdd(false)}>Cancel</button>
          </div>
        </div>
      )}

      {/* Asset list */}
      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th style={{ width: 30 }} />
              <th>Asset Name</th>
              <th>Type</th>
              <th>Brand</th>
              <th>Status</th>
              <th>Assigned To</th>
              <th>Warranty Expiry</th>
              <th>Registered</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(asset => (
              <>
                <tr key={asset.id} className={expandedId === asset.id ? 'admin-row-active' : ''}>
                  <td>
                    <button
                      className="admin-btn-icon"
                      onClick={() => setExpandedId(expandedId === asset.id ? null : asset.id)}
                      style={{ transform: expandedId === asset.id ? 'rotate(90deg)' : 'none', transition: 'transform .15s' }}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
                    </button>
                  </td>
                  <td style={{ fontWeight: 600 }}>{asset.asset_name}{asset.is_space_asset && <span style={{ marginLeft: 6, fontSize: 11, color: '#1565c0' }}>🏢</span>}</td>
                  <td>{asset.asset_type}</td>
                  <td>{asset.brand || '—'}</td>
                  <td><span className="admin-badge" style={{ background: statusColor[asset.status] || '#999', color: '#fff' }}>{asset.status}</span></td>
                  <td>{asset.assigned_to_name ? <span className="admin-inline-avatar">{(() => { const av = getEmployeeAvatar(asset.assigned_to); const initials = asset.assigned_to_name.split(' ').map((n: string) => n[0]).join(''); return av ? <img src={av} alt="" /> : <span className="admin-avatar-initials">{initials}</span> })()}{asset.assigned_to_name}</span> : '—'}</td>
                  <td>{asset.warranty_expiry ? formatDate(asset.warranty_expiry) : '—'}</td>
                  <td>{formatDate(asset.created_at)}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button className="admin-btn-icon" title="Edit" onClick={() => { setEditingId(asset.id); setExpandedId(asset.id); setEditForm({ asset_name: asset.asset_name, asset_type: asset.asset_type, brand: asset.brand, model: asset.model, serial_number: asset.serial_number, purchase_date: asset.purchase_date || '', warranty_expiry: asset.warranty_expiry || '', status: asset.status, assigned_to: asset.assigned_to || '', notes: asset.notes, is_space_asset: asset.is_space_asset }) }}>✏️</button>
                    <button className="admin-btn-icon" title="Swap Owner" onClick={() => { setSwapAssetId(asset.id); setSwapTo('') }}>🔄</button>
                    <button className="admin-btn-icon" title="History" onClick={() => loadHistory(asset.id)}>📋</button>
                    <button className="admin-btn-icon admin-btn-danger" title="Delete" onClick={() => deleteAsset(asset.id)}>🗑️</button>
                  </td>
                </tr>
                {expandedId === asset.id && (
                  <tr key={`${asset.id}-expanded`} className="admin-expanded-row">
                    <td colSpan={9}>
                      <div className="admin-expanded-content">
                        {editingId === asset.id ? (
                          <div className="admin-form-grid">
                            <div className="admin-form-field">
                              <label>Asset Name</label>
                              <input className="admin-input" value={editForm.asset_name} onChange={e => setEditForm({ ...editForm, asset_name: e.target.value })} />
                            </div>
                            <div className="admin-form-field">
                              <label>Type</label>
                              <select className="admin-select" value={editForm.asset_type} onChange={e => setEditForm({ ...editForm, asset_type: e.target.value })}>
                                {ASSET_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                              </select>
                            </div>
                            <div className="admin-form-field">
                              <label>Brand</label>
                              <input className="admin-input" value={editForm.brand} onChange={e => setEditForm({ ...editForm, brand: e.target.value })} />
                            </div>
                            <div className="admin-form-field">
                              <label>Model</label>
                              <input className="admin-input" value={editForm.model} onChange={e => setEditForm({ ...editForm, model: e.target.value })} />
                            </div>
                            <div className="admin-form-field">
                              <label>Serial Number</label>
                              <input className="admin-input" value={editForm.serial_number} onChange={e => setEditForm({ ...editForm, serial_number: e.target.value })} />
                            </div>
                            <div className="admin-form-field">
                              <label>Purchase Date</label>
                              <input className="admin-input" type="date" value={editForm.purchase_date} onChange={e => setEditForm({ ...editForm, purchase_date: e.target.value })} />
                            </div>
                            <div className="admin-form-field">
                              <label>Warranty Expiry</label>
                              <input className="admin-input" type="date" value={editForm.warranty_expiry} onChange={e => setEditForm({ ...editForm, warranty_expiry: e.target.value })} />
                            </div>
                            <div className="admin-form-field">
                              <label>Assign To</label>
                              <select className="admin-select" value={editForm.assigned_to} onChange={e => setEditForm({ ...editForm, assigned_to: e.target.value })}>
                                <option value="">Unassigned</option>
                                {employees.map(emp => <option key={emp.id} value={emp.id}>{emp.first_name} {emp.last_name}</option>)}
                              </select>
                            </div>
                            <div className="admin-form-field">
                              <label>Status</label>
                              <select className="admin-select" value={editForm.status} onChange={e => setEditForm({ ...editForm, status: e.target.value as AssetStatus })}>
                                {ASSET_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                              </select>
                            </div>
                            {spaceBookingEnabled && (
                              <div className="admin-form-field">
                                <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                  <input type="checkbox" checked={editForm.is_space_asset} onChange={e => setEditForm({ ...editForm, is_space_asset: e.target.checked })} />
                                  Room / Desk Asset
                                </label>
                              </div>
                            )}
                            <div className="admin-form-field" style={{ gridColumn: '1 / -1' }}>
                              <label>Notes</label>
                              <textarea className="admin-input" value={editForm.notes} onChange={e => setEditForm({ ...editForm, notes: e.target.value })} rows={2} style={{ resize: 'vertical' }} />
                            </div>
                            <div style={{ display: 'flex', gap: 8 }}>
                              <button className="admin-btn-sm admin-btn-save" onClick={() => saveEdit(asset)} disabled={saving}>{saving ? 'Saving...' : 'Save'}</button>
                              <button className="admin-btn-sm admin-btn-cancel" onClick={() => setEditingId(null)}>Cancel</button>
                            </div>
                          </div>
                        ) : (
                          <div className="admin-form-grid" style={{ gap: '8px 24px' }}>
                            <div className="admin-form-field"><label>Asset Name</label><span>{asset.asset_name}</span></div>
                            <div className="admin-form-field"><label>Type</label><span>{asset.asset_type}</span></div>
                            <div className="admin-form-field"><label>Brand</label><span>{asset.brand || '—'}</span></div>
                            <div className="admin-form-field"><label>Model</label><span>{asset.model || '—'}</span></div>
                            <div className="admin-form-field"><label>Serial Number</label><span>{asset.serial_number || '—'}</span></div>
                            <div className="admin-form-field"><label>Purchase Date</label><span>{asset.purchase_date ? formatDate(asset.purchase_date) : '—'}</span></div>
                            <div className="admin-form-field"><label>Warranty Expiry</label><span>{asset.warranty_expiry ? formatDate(asset.warranty_expiry) : '—'}</span></div>
                            <div className="admin-form-field"><label>Assigned To</label><span>{asset.assigned_to_name || 'Unassigned'}</span></div>
                            <div className="admin-form-field"><label>Status</label><span className="admin-badge" style={{ background: statusColor[asset.status] || '#999', color: '#fff' }}>{asset.status}</span></div>
                            {asset.is_space_asset && <div className="admin-form-field"><label>Space Asset</label><span>Yes — available for room/desk assignment</span></div>}
                            <div className="admin-form-field" style={{ gridColumn: '1 / -1' }}><label>Notes</label><span>{asset.notes || '—'}</span></div>
                            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                              <button className="admin-btn-sm admin-btn-save" onClick={() => { setEditingId(asset.id); setEditForm({ asset_name: asset.asset_name, asset_type: asset.asset_type, brand: asset.brand, model: asset.model, serial_number: asset.serial_number, purchase_date: asset.purchase_date || '', warranty_expiry: asset.warranty_expiry || '', status: asset.status, assigned_to: asset.assigned_to || '', notes: asset.notes, is_space_asset: asset.is_space_asset }) }}>Edit</button>
                              {ASSET_STATUSES.filter(s => s !== asset.status).map(s => (
                                <button key={s} className="admin-btn-sm" style={{ borderColor: statusColor[s], color: statusColor[s] }} onClick={() => changeStatus(asset, s)}>→ {s}</button>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                )}
              </>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={9}><div className="admin-empty">{assets.length === 0 ? 'No assets registered yet' : 'No assets match your filters'}</div></td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Swap ownership modal */}
      {swapAssetId && (
        <div className="my-profile-modal-overlay" onClick={() => setSwapAssetId(null)}>
          <div className="my-profile-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 400 }}>
            <div className="my-profile-modal-header">
              <span className="my-profile-modal-dept">Swap Ownership</span>
            </div>
            <div style={{ padding: 16 }}>
              <p style={{ margin: '0 0 12px', fontSize: 13 }}>
                Current owner: <strong>{assets.find(a => a.id === swapAssetId)?.assigned_to_name || 'Unassigned'}</strong>
              </p>
              <label style={{ fontSize: 12, fontWeight: 600 }}>New Owner</label>
              <select className="admin-select" value={swapTo} onChange={e => setSwapTo(e.target.value)} style={{ width: '100%', marginTop: 4 }}>
                <option value="">Select employee...</option>
                {employees.filter(emp => emp.id !== assets.find(a => a.id === swapAssetId)?.assigned_to).map(emp => (
                  <option key={emp.id} value={emp.id}>{emp.first_name} {emp.last_name}</option>
                ))}
              </select>
              <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
                <button className="admin-btn admin-btn-primary" onClick={() => { const asset = assets.find(a => a.id === swapAssetId); if (asset) swapOwnership(asset) }} disabled={!swapTo || saving}>{saving ? 'Swapping...' : 'Confirm Swap'}</button>
                <button className="admin-btn" onClick={() => setSwapAssetId(null)}>Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* History modal */}
      {historyAssetId && (
        <div className="my-profile-modal-overlay" onClick={() => setHistoryAssetId(null)}>
          <div className="my-profile-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 520 }}>
            <div className="my-profile-modal-header">
              <span className="my-profile-modal-dept">Asset History — {assets.find(a => a.id === historyAssetId)?.asset_name}</span>
            </div>
            <div className="my-profile-modal-list" style={{ maxHeight: 400, overflow: 'auto' }}>
              {history.length === 0 && <div className="admin-empty">No history recorded</div>}
              {history.map(h => (
                <div key={h.id} className="my-profile-modal-row" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}>
                  <span style={{ fontWeight: 600, fontSize: 13 }}>{h.action}</span>
                  <span style={{ fontSize: 12, color: '#888' }}>
                    {h.from_employee_name && `From: ${h.from_employee_name}`}
                    {h.from_employee_name && h.to_employee_name && ' → '}
                    {h.to_employee_name && `To: ${h.to_employee_name}`}
                  </span>
                  {h.notes && <span style={{ fontSize: 12, color: '#666' }}>{h.notes}</span>}
                  <span style={{ fontSize: 11, color: '#aaa' }}>{formatDate(h.created_at)}</span>
                </div>
              ))}
            </div>
            <button className="my-profile-modal-close" onClick={() => setHistoryAssetId(null)}>Close</button>
          </div>
        </div>
      )}
    </div>
  )
}
