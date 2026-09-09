import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../../lib/supabase'
import { useAdminCompany } from '../../context/AdminCompanyContext'
import { useLanguage } from '../../context/LanguageContext'
import { useToast } from '../../context/ToastContext'
import { useFeatures } from '../../context/FeatureContext'
import { toLocalDateStr } from '../../lib/formatters'

interface WorkflowRow {
  id: number
  emp_display_name: string
  step: number
  status: string
  record_type: string
  action: string
  employee_email: string
  assigned_to: string
  approval_id: number | null
  task_description: string | null
  approval_status: string | null
  created_at: string
  company_id: string
}

interface Announcement {
  id: number
  title: string
  body: string
  submitted_by_name: string | null
  is_pinned: boolean
  published_at: string
  expires_at: string | null
  author: { first_name: string; last_name: string } | null
}

type Tab = 'workflow' | 'company' | 'email'

interface EmailSettings {
  leave_enabled: boolean
  expenses_enabled: boolean
  shifts_enabled: boolean
  kudos_enabled: boolean
  space_booking_enabled: boolean
  performance_reminders_enabled: boolean
  elearning_reminders_enabled: boolean
}

const DEFAULT_EMAIL_SETTINGS: EmailSettings = {
  leave_enabled: false,
  expenses_enabled: false,
  shifts_enabled: false,
  kudos_enabled: false,
  space_booking_enabled: false,
  performance_reminders_enabled: false,
  elearning_reminders_enabled: false,
}

const EMAIL_TOGGLES: { key: keyof EmailSettings; label: string; description: string }[] = [
  { key: 'leave_enabled', label: 'Leave Confirmations', description: 'Email employees when their leave request is approved or declined' },
  { key: 'expenses_enabled', label: 'Expense Confirmations', description: 'Email employees when their expense claim is approved or declined' },
  { key: 'shifts_enabled', label: 'Shift Notifications', description: 'Email employees when they are assigned a new shift' },
  { key: 'kudos_enabled', label: 'Kudos Received', description: 'Email employees when they receive kudos recognition from a colleague' },
  { key: 'space_booking_enabled', label: 'Booking Confirmations', description: 'Email employees when their desk or meeting room booking is confirmed' },
  { key: 'performance_reminders_enabled', label: '1:1 Reminders', description: 'Email employees one day before a scheduled 1:1 performance meeting' },
  { key: 'elearning_reminders_enabled', label: 'E-Learning Expiry Reminders', description: 'Email employees one day before an e-learning course deadline expires' },
]

const PAGE_SIZE = 30
const STATUS_OPTIONS = ['Pending', 'Complete']
const TYPE_OPTIONS = ['Expense', 'Leave', 'Timesheet', 'Meeting', 'Birthday', 'Kudos']

function formatDateTime(d: string) {
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function defaultFrom() {
  const d = new Date()
  d.setDate(d.getDate() - 30)
  return toLocalDateStr(d)
}
function defaultTo() {
  return toLocalDateStr()
}

export default function AdminNotifications() {
  const { selectedCompanyId } = useAdminCompany()
  const { t } = useLanguage()
  const { showError, showSuccess } = useToast()
  const { companyFeatures } = useFeatures()
  const [tab, setTab] = useState<Tab>('workflow')

  // Email notification settings state
  const [emailSettings, setEmailSettings] = useState<EmailSettings>(DEFAULT_EMAIL_SETTINGS)
  const [loadingEmail, setLoadingEmail] = useState(true)
  const [savingEmail, setSavingEmail] = useState<string | null>(null)

  // Workflow state
  const [rows, setRows] = useState<WorkflowRow[]>([])
  const [loadingWorkflow, setLoadingWorkflow] = useState(true)
  const [filterStatus, setFilterStatus] = useState('')
  const [filterType, setFilterType] = useState('')
  const [filterEmployee, setFilterEmployee] = useState('')
  const [dateFrom, setDateFrom] = useState(defaultFrom)
  const [dateTo, setDateTo] = useState(defaultTo)

  // Announcements state
  const [announcements, setAnnouncements] = useState<Announcement[]>([])
  const [loadingAnn, setLoadingAnn] = useState(true)
  const [annSearch, setAnnSearch] = useState('')
  const [wfPage, setWfPage] = useState(1)
  const [annPage, setAnnPage] = useState(1)
  const [editingAnnId, setEditingAnnId] = useState<number | null>(null)
  const [annEditForm, setAnnEditForm] = useState<Record<string, any>>({})

  useEffect(() => {
    if (selectedCompanyId) {
      loadWorkflow()
      loadAnnouncements()
      loadEmailSettings()
    }
  }, [selectedCompanyId])

  async function loadEmailSettings() {
    setLoadingEmail(true)
    const { data } = await supabase
      .from('email_notification_settings')
      .select('*')
      .eq('company_id', selectedCompanyId)
      .single()
    if (data) {
      setEmailSettings({
        leave_enabled: data.leave_enabled ?? false,
        expenses_enabled: data.expenses_enabled ?? false,
        shifts_enabled: data.shifts_enabled ?? false,
        kudos_enabled: data.kudos_enabled ?? false,
        space_booking_enabled: data.space_booking_enabled ?? false,
        performance_reminders_enabled: data.performance_reminders_enabled ?? false,
        elearning_reminders_enabled: data.elearning_reminders_enabled ?? false,
      })
    } else {
      setEmailSettings(DEFAULT_EMAIL_SETTINGS)
    }
    setLoadingEmail(false)
  }

  async function toggleEmailSetting(key: keyof EmailSettings) {
    const newVal = !emailSettings[key]
    setSavingEmail(key)
    setEmailSettings(prev => ({ ...prev, [key]: newVal }))

    const { data: existing } = await supabase
      .from('email_notification_settings')
      .select('id')
      .eq('company_id', selectedCompanyId)
      .single()

    if (existing) {
      const { error } = await supabase
        .from('email_notification_settings')
        .update({ [key]: newVal, updated_at: new Date().toISOString() })
        .eq('company_id', selectedCompanyId)
      if (error) {
        showError('Failed to update setting: ' + error.message)
        setEmailSettings(prev => ({ ...prev, [key]: !newVal }))
      } else {
        showSuccess(`${newVal ? 'Enabled' : 'Disabled'} ${EMAIL_TOGGLES.find(t => t.key === key)?.label || key}`)
      }
    } else {
      const row: Record<string, unknown> = { company_id: selectedCompanyId, [key]: newVal }
      const { error } = await supabase.from('email_notification_settings').insert(row)
      if (error) {
        showError('Failed to save setting: ' + error.message)
        setEmailSettings(prev => ({ ...prev, [key]: !newVal }))
      } else {
        showSuccess(`${newVal ? 'Enabled' : 'Disabled'} ${EMAIL_TOGGLES.find(t => t.key === key)?.label || key}`)
      }
    }
    setSavingEmail(null)
  }

  async function loadWorkflow() {
    setLoadingWorkflow(true)
    const fromISO = new Date(dateFrom).toISOString()
    const toDate = new Date(dateTo)
    toDate.setHours(23, 59, 59, 999)
    const toISO = toDate.toISOString()

    const { data } = await supabase
      .from('workflow_tracker')
      .select('*')
      .eq('company_id', selectedCompanyId)
      .gte('created_at', fromISO)
      .lte('created_at', toISO)
      .order('created_at', { ascending: false })
      .limit(500)
    setRows((data as WorkflowRow[]) || [])
    setLoadingWorkflow(false)
  }

  async function loadAnnouncements() {
    setLoadingAnn(true)
    const { data } = await supabase
      .from('announcements')
      .select('*, author:employees!announcements_author_id_fkey(first_name, last_name)')
      .eq('company_id', selectedCompanyId)
      .order('published_at', { ascending: false })
    setAnnouncements((data as Announcement[]) || [])
    setLoadingAnn(false)
  }

  // Workflow filters
  const filtered = useMemo(() => {
    return rows.filter(r => {
      if (filterStatus && r.status !== filterStatus) return false
      if (filterType && r.record_type !== filterType) return false
      if (filterEmployee) {
        const q = filterEmployee.toLowerCase()
        const name = (r.emp_display_name || '').toLowerCase()
        const email = (r.employee_email || '').toLowerCase()
        if (!name.includes(q) && !email.includes(q)) return false
      }
      return true
    })
  }, [rows, filterStatus, filterType, filterEmployee])

  const wfTotalPages = Math.ceil(filtered.length / PAGE_SIZE)
  const paginatedWf = filtered.slice((wfPage - 1) * PAGE_SIZE, wfPage * PAGE_SIZE)

  useEffect(() => { setWfPage(1) }, [filterStatus, filterType, filterEmployee, rows])

  const stats = useMemo(() => ({
    total: rows.length,
    pending: rows.filter(r => r.status === 'Pending').length,
    complete: rows.filter(r => r.status === 'Complete').length,
  }), [rows])

  const statusBadge = (status: string) => {
    if (status === 'Pending') return 'admin-badge-pending'
    if (status === 'Complete') return 'admin-badge-approved'
    return ''
  }

  const typeBadge = (type: string) => {
    switch (type) {
      case 'Expense': return { bg: '#e3f2fd', color: '#1565c0' }
      case 'Leave': return { bg: '#fce4ec', color: '#c62828' }
      case 'Timesheet': return { bg: '#e8f5e9', color: '#2e7d32' }
      case 'Meeting': return { bg: '#f3e5f5', color: '#7b1fa2' }
      case 'Birthday': return { bg: '#fff8e1', color: '#f57f17' }
      case 'Kudos': return { bg: '#fff3e0', color: '#e65100' }
      default: return { bg: '#f5f5f5', color: '#616161' }
    }
  }

  // Announcements helpers
  const filteredAnn = useMemo(() => {
    if (!annSearch) return announcements
    const q = annSearch.toLowerCase()
    return announcements.filter(a => `${a.title} ${a.body}`.toLowerCase().includes(q))
  }, [announcements, annSearch])

  const annTotalPages = Math.ceil(filteredAnn.length / PAGE_SIZE)
  const paginatedAnn = filteredAnn.slice((annPage - 1) * PAGE_SIZE, annPage * PAGE_SIZE)

  useEffect(() => { setAnnPage(1) }, [annSearch, announcements])

  const annStats = useMemo(() => ({
    total: announcements.length,
    pinned: announcements.filter(a => a.is_pinned).length,
    active: announcements.filter(a => !a.expires_at || new Date(a.expires_at) > new Date()).length,
    expired: announcements.filter(a => a.expires_at && new Date(a.expires_at) <= new Date()).length,
  }), [announcements])

  function startEditAnn(a: Announcement) {
    setEditingAnnId(a.id)
    setAnnEditForm({ title: a.title, body: a.body, is_pinned: a.is_pinned, expires_at: a.expires_at || '' })
  }

  async function saveEditAnn(id: number) {
    const { error } = await supabase.from('announcements').update({
      title: annEditForm.title, body: annEditForm.body, is_pinned: annEditForm.is_pinned,
      expires_at: annEditForm.expires_at || null,
    }).eq('id', id)
    if (error) { showError('Failed to save announcement: ' + error.message); return }
    setEditingAnnId(null)
    loadAnnouncements()
    showSuccess('Announcement saved')
  }

  async function deleteAnnouncement(id: number) {
    if (!confirm('Delete this announcement?')) return
    const { error } = await supabase.from('announcements').delete().eq('id', id)
    if (error) { showError('Failed to delete announcement: ' + error.message); return }
    setAnnouncements(prev => prev.filter(a => a.id !== id))
    showSuccess('Announcement deleted')
  }

  return (
    <div className="admin-section">
      <div className="admin-section-header">
        <h2>{t('admin_notif.title')}</h2>
        <p className="admin-section-subtitle">{t('admin_notif.subtitle')}</p>
      </div>

      <div className="admin-tabs" style={{ display: 'flex', gap: 0, marginBottom: 20, borderBottom: '2px solid var(--border-color, #e0e0e0)' }}>
        <button
          onClick={() => setTab('workflow')}
          style={{
            padding: '10px 20px', fontWeight: 700, fontSize: 14, cursor: 'pointer',
            background: 'none', border: 'none',
            borderBottom: tab === 'workflow' ? '3px solid #1565c0' : '3px solid transparent',
            color: tab === 'workflow' ? '#1565c0' : 'var(--text-muted, #888)',
          }}
        >
          Workflow Tracker
        </button>
        <button
          onClick={() => setTab('company')}
          style={{
            padding: '10px 20px', fontWeight: 700, fontSize: 14, cursor: 'pointer',
            background: 'none', border: 'none',
            borderBottom: tab === 'company' ? '3px solid #7b1fa2' : '3px solid transparent',
            color: tab === 'company' ? '#7b1fa2' : 'var(--text-muted, #888)',
          }}
        >
          Company Messages ({announcements.length})
        </button>
        {companyFeatures.email_notifications && (
          <button
            onClick={() => setTab('email')}
            style={{
              padding: '10px 20px', fontWeight: 700, fontSize: 14, cursor: 'pointer',
              background: 'none', border: 'none',
              borderBottom: tab === 'email' ? '3px solid #43a047' : '3px solid transparent',
              color: tab === 'email' ? '#43a047' : 'var(--text-muted, #888)',
            }}
          >
            Email Notifications
          </button>
        )}
      </div>

      {tab === 'workflow' && (
        <>
          <div className="admin-mini-stats">
            <div className="admin-mini-stat"><span className="admin-mini-value">{stats.total}</span><span>{t('admin_notif.total')}</span></div>
            <div className="admin-mini-stat"><span className="admin-mini-value" style={{ color: '#e65100' }}>{stats.pending}</span><span>{t('admin_notif.pending')}</span></div>
            <div className="admin-mini-stat"><span className="admin-mini-value" style={{ color: '#43a047' }}>{stats.complete}</span><span>{t('admin_notif.complete')}</span></div>
          </div>

          <div className="admin-filters">
            <div className="admin-filter-group">
              <label className="admin-filter-label">{t('admin_notif.from')}</label>
              <input type="date" className="admin-select" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
            </div>
            <div className="admin-filter-group">
              <label className="admin-filter-label">{t('admin_notif.to')}</label>
              <input type="date" className="admin-select" value={dateTo} onChange={e => setDateTo(e.target.value)} />
            </div>
            <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="admin-select">
              <option value="">{t('admin_notif.all_statuses')}</option>
              {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <select value={filterType} onChange={e => setFilterType(e.target.value)} className="admin-select">
              <option value="">{t('admin_notif.all_types')}</option>
              {TYPE_OPTIONS.map(tp => <option key={tp} value={tp}>{tp}</option>)}
            </select>
            <input
              type="text"
              placeholder={t('admin_notif.search_employee')}
              value={filterEmployee}
              onChange={e => setFilterEmployee(e.target.value)}
              className="admin-select"
              style={{ minWidth: 200 }}
            />
            <button className="admin-btn-sm admin-btn-save" onClick={loadWorkflow}>{t('admin_notif.apply')}</button>
          </div>

          {loadingWorkflow ? <div className="admin-loading">Loading...</div> : (
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>{t('admin_notif.date')}</th>
                    <th>{t('admin_notif.employee')}</th>
                    <th>{t('admin_notif.type')}</th>
                    <th>Status</th>
                    <th>{t('admin_notif.action')}</th>
                    <th>{t('admin_notif.assigned_to')}</th>
                    <th>{t('admin_notif.description')}</th>
                    <th>{t('admin_notif.approval')}</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedWf.map(r => {
                    const tb = typeBadge(r.record_type)
                    return (
                      <tr key={r.id}>
                        <td style={{ whiteSpace: 'nowrap' }}>{formatDateTime(r.created_at)}</td>
                        <td>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                            <span style={{ fontWeight: 700 }}>{r.emp_display_name}</span>
                            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{r.employee_email}</span>
                          </div>
                        </td>
                        <td>
                          <span style={{ background: tb.bg, color: tb.color, padding: '3px 10px', borderRadius: 12, fontSize: 12, fontWeight: 700 }}>
                            {r.record_type}
                          </span>
                        </td>
                        <td><span className={`admin-badge ${statusBadge(r.status)}`}>{r.status}</span></td>
                        <td style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.action}</td>
                        <td style={{ fontSize: 12 }}>{r.assigned_to}</td>
                        <td style={{ maxWidth: 250, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12 }}>{r.task_description || '—'}</td>
                        <td>
                          {r.approval_status
                            ? <span className={`admin-badge ${r.approval_status === 'Approved' ? 'admin-badge-approved' : r.approval_status === 'Declined' ? 'admin-badge-rejected' : ''}`}>{r.approval_status}</span>
                            : '—'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              {filtered.length === 0 && <div className="admin-empty">{t('admin_notif.no_results')}</div>}
              {wfTotalPages > 1 && (
                <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 12, marginTop: 16, fontSize: 13 }}>
                  <button className="admin-btn" disabled={wfPage <= 1} onClick={() => setWfPage(p => p - 1)}>Prev</button>
                  <span>Page {wfPage} of {wfTotalPages}</span>
                  <button className="admin-btn" disabled={wfPage >= wfTotalPages} onClick={() => setWfPage(p => p + 1)}>Next</button>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {tab === 'company' && (
        <>
          <div className="admin-mini-stats">
            <div className="admin-mini-stat"><span className="admin-mini-value">{annStats.total}</span><span>Total</span></div>
            <div className="admin-mini-stat"><span className="admin-mini-value" style={{ color: '#7b1fa2' }}>{annStats.pinned}</span><span>Pinned</span></div>
            <div className="admin-mini-stat"><span className="admin-mini-value" style={{ color: '#43a047' }}>{annStats.active}</span><span>Active</span></div>
            <div className="admin-mini-stat"><span className="admin-mini-value" style={{ color: '#e53935' }}>{annStats.expired}</span><span>Expired</span></div>
          </div>

          <div className="admin-filters">
            <input placeholder="Search messages..." value={annSearch} onChange={e => setAnnSearch(e.target.value)} className="admin-input admin-search" />
          </div>

          {loadingAnn ? <div className="admin-loading">Loading...</div> : (
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead><tr><th>Title</th><th>Author</th><th>Published</th><th>Expires</th><th>Pinned</th><th>Actions</th></tr></thead>
                <tbody>
                  {paginatedAnn.map(a => (
                    <tr key={a.id}>
                      <td>{editingAnnId === a.id ? (
                        <div>
                          <input className="admin-inline-input" value={annEditForm.title} onChange={e => setAnnEditForm(f => ({ ...f, title: e.target.value }))} />
                          <textarea className="admin-inline-textarea" value={annEditForm.body} onChange={e => setAnnEditForm(f => ({ ...f, body: e.target.value }))} />
                        </div>
                      ) : (
                        <div><strong>{a.title}</strong><br /><span className="admin-td-desc">{a.body.slice(0, 80)}{a.body.length > 80 ? '...' : ''}</span></div>
                      )}</td>
                      <td>{a.author ? `${a.author.first_name} ${a.author.last_name}` : a.submitted_by_name || '—'}</td>
                      <td>{new Date(a.published_at).toLocaleDateString('en-GB')}</td>
                      <td>{editingAnnId === a.id ? <input type="date" className="admin-inline-input" value={annEditForm.expires_at} onChange={e => setAnnEditForm(f => ({ ...f, expires_at: e.target.value }))} /> : (a.expires_at ? new Date(a.expires_at).toLocaleDateString('en-GB') : '—')}</td>
                      <td>{editingAnnId === a.id ? <label className="admin-toggle-label"><input type="checkbox" checked={annEditForm.is_pinned} onChange={e => setAnnEditForm(f => ({ ...f, is_pinned: e.target.checked }))} /></label> : (a.is_pinned ? '📌' : '—')}</td>
                      <td className="admin-actions">
                        {editingAnnId === a.id ? (
                          <>
                            <button className="admin-btn-sm admin-btn-save" onClick={() => saveEditAnn(a.id)}>Save</button>
                            <button className="admin-btn-sm admin-btn-cancel" onClick={() => setEditingAnnId(null)}>Cancel</button>
                          </>
                        ) : (
                          <>
                            <button className="admin-btn-icon" onClick={() => startEditAnn(a)}>
                              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
                            </button>
                            <button className="admin-btn-icon admin-btn-danger" onClick={() => deleteAnnouncement(a.id)}>
                              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filteredAnn.length === 0 && <div className="admin-empty">No company messages found</div>}
              {annTotalPages > 1 && (
                <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 12, marginTop: 16, fontSize: 13 }}>
                  <button className="admin-btn" disabled={annPage <= 1} onClick={() => setAnnPage(p => p - 1)}>Prev</button>
                  <span>Page {annPage} of {annTotalPages}</span>
                  <button className="admin-btn" disabled={annPage >= annTotalPages} onClick={() => setAnnPage(p => p + 1)}>Next</button>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {tab === 'email' && companyFeatures.email_notifications && (
        <>
          <div style={{ marginBottom: 16 }}>
            <p style={{ fontSize: 13, color: 'var(--text-muted, #888)', margin: 0 }}>
              Configure which HR features send email notifications to employees via Brevo. All switches default to off.
            </p>
          </div>

          {loadingEmail ? <div className="admin-loading">Loading...</div> : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {EMAIL_TOGGLES.map(toggle => (
                <div
                  key={toggle.key}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 16,
                    padding: '14px 18px',
                    background: emailSettings[toggle.key] ? 'var(--card-bg-active, #f0fdf4)' : 'var(--card-bg, #fff)',
                    border: `1px solid ${emailSettings[toggle.key] ? '#43a047' : 'var(--border-color, #e0e0e0)'}`,
                    borderRadius: 8,
                    transition: 'all 0.2s',
                  }}
                >
                  <label className="admin-toggle-switch">
                    <input
                      type="checkbox"
                      checked={emailSettings[toggle.key]}
                      onChange={() => toggleEmailSetting(toggle.key)}
                      disabled={savingEmail === toggle.key}
                    />
                    <span className="admin-toggle-slider" />
                  </label>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-primary, #333)' }}>{toggle.label}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted, #888)', marginTop: 2 }}>{toggle.description}</div>
                  </div>
                  <span style={{
                    fontSize: 11,
                    fontWeight: 600,
                    padding: '3px 10px',
                    borderRadius: 12,
                    background: emailSettings[toggle.key] ? '#e8f5e9' : '#f5f5f5',
                    color: emailSettings[toggle.key] ? '#2e7d32' : '#999',
                  }}>
                    {savingEmail === toggle.key ? 'Saving...' : emailSettings[toggle.key] ? 'On' : 'Off'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
