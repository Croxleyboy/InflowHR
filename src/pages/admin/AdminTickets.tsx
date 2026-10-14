import { useState, useEffect, useMemo, Fragment } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { useAdminCompany } from '../../context/AdminCompanyContext'
import { useLanguage } from '../../context/LanguageContext'
import { useToast } from '../../context/ToastContext'

type Priority = 'low' | 'medium' | 'high' | 'urgent'
type TicketStatus = 'open' | 'in-progress' | 'resolved' | 'closed'
type TicketCategory = 'hr-query' | 'payroll' | 'leave' | 'onboarding' | 'offboarding' | 'system-access' | 'benefits' | 'user-request' | 'other'

interface Ticket {
  id: string
  ref: string
  title: string
  description: string
  category: TicketCategory
  priority: Priority
  status: TicketStatus
  submitted_by: string
  assigned_to: string
  assigned_to_provider: boolean
  company_id: string
  created_at: string
  updated_at: string
  admin_response: string | null
  responded_by: string | null
  responded_at: string | null
  employee_email: string | null
}

const ASSIGN_OPTIONS = [
  { value: 'HR Team', label: 'HR Team', labelDe: 'HR-Team', provider: false },
  { value: 'IT Support', label: 'IT Support', labelDe: 'IT-Support', provider: false },
  { value: 'Line Manager', label: 'Line Manager', labelDe: 'Vorgesetzter', provider: false },
  { value: 'Service Provider', label: 'Service Provider (InflowHR)', labelDe: 'Dienstleister (InflowHR)', provider: true },
]

const CATEGORY_OPTIONS: { value: TicketCategory; label: string; labelDe: string }[] = [
  { value: 'hr-query', label: 'HR Query', labelDe: 'HR-Anfrage' },
  { value: 'payroll', label: 'Payroll', labelDe: 'Gehaltsabrechnung' },
  { value: 'leave', label: 'Leave', labelDe: 'Urlaub' },
  { value: 'onboarding', label: 'Onboarding', labelDe: 'Onboarding' },
  { value: 'offboarding', label: 'Offboarding', labelDe: 'Offboarding' },
  { value: 'system-access', label: 'System Access', labelDe: 'Systemzugang' },
  { value: 'benefits', label: 'Benefits', labelDe: 'Leistungen' },
  { value: 'user-request', label: 'User Request', labelDe: 'Benutzeranfrage' },
  { value: 'other', label: 'Other', labelDe: 'Sonstiges' },
]

const PRIORITY_COLORS: Record<Priority, string> = { low: '#43a047', medium: '#ff9800', high: '#e53935', urgent: '#b71c1c' }
const STATUS_COLORS: Record<TicketStatus, string> = { open: '#ff9800', 'in-progress': '#5b9bd5', resolved: '#43a047', closed: '#78909c' }

const EMPTY_NEW_TICKET = { title: '', description: '', category: 'hr-query' as TicketCategory, priority: 'medium' as Priority, assignedTo: 'HR Team' }

const PAGE_SIZE = 30

export default function AdminTickets() {
  const { employeeName, isSuperAdmin } = useAuth()
  const { selectedCompanyId, companies } = useAdminCompany()
  const { lang } = useLanguage()
  const { showError, showSuccess } = useToast()
  const [tickets, setTickets] = useState<Ticket[]>([])
  const [loading, setLoading] = useState(true)
  const [filterStatus, setFilterStatus] = useState('')
  const [filterCategory, setFilterCategory] = useState('')
  const [filterPriority, setFilterPriority] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<Record<string, string>>({})
  const [showRaiseForm, setShowRaiseForm] = useState(false)
  const [newTicket, setNewTicket] = useState(EMPTY_NEW_TICKET)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [respondingId, setRespondingId] = useState<string | null>(null)
  const [responseText, setResponseText] = useState('')
  const [sendingResponse, setSendingResponse] = useState(false)

  async function load() {
    if (!isSuperAdmin && !selectedCompanyId) { setLoading(false); return }
    setLoading(true)
    let query = supabase
      .from('hr_tickets')
      .select('*')
      .order('created_at', { ascending: false })
    if (!isSuperAdmin && selectedCompanyId) {
      query = query.eq('company_id', selectedCompanyId)
    } else if (isSuperAdmin && selectedCompanyId) {
      query = query.eq('company_id', selectedCompanyId)
    }
    const { data } = await query
    setTickets((data as Ticket[]) || [])
    setLoading(false)
  }

  useEffect(() => { load() }, [selectedCompanyId, isSuperAdmin])

  async function raiseTicket() {
    if (!newTicket.title.trim() || !selectedCompanyId) return

    const { data: allRefs } = await supabase
      .from('hr_tickets')
      .select('ref')
      .eq('company_id', selectedCompanyId)
    const maxNum = (allRefs || []).reduce((max, r) => {
      const num = parseInt(r.ref.replace('HR-', ''), 10)
      return isNaN(num) ? max : Math.max(max, num)
    }, 0)
    const ref = `HR-${String(maxNum + 1).padStart(3, '0')}`

    const assignOption = ASSIGN_OPTIONS.find(a => a.value === newTicket.assignedTo)
    const { error } = await supabase.from('hr_tickets').insert({
      ref,
      title: newTicket.title.trim(),
      description: newTicket.description.trim(),
      category: newTicket.category,
      priority: newTicket.priority,
      status: 'open',
      submitted_by: employeeName || 'Admin',
      assigned_to: newTicket.assignedTo || 'HR Team',
      assigned_to_provider: assignOption?.provider ?? false,
      company_id: selectedCompanyId,
    })
    if (error) {
      showError('Failed to create ticket: ' + error.message)
      return
    }
    setNewTicket(EMPTY_NEW_TICKET)
    setShowRaiseForm(false)
    showSuccess('Ticket raised')
    load()
  }

  function startEdit(t: Ticket) {
    setEditingId(t.id)
    setEditForm({ title: t.title, description: t.description, category: t.category, priority: t.priority, status: t.status, assigned_to: t.assigned_to })
  }

  async function saveEdit(id: string) {
    const assignOption = ASSIGN_OPTIONS.find(a => a.value === editForm.assigned_to)
    const { error } = await supabase.from('hr_tickets').update({
      title: editForm.title,
      description: editForm.description,
      category: editForm.category,
      priority: editForm.priority,
      status: editForm.status,
      assigned_to: editForm.assigned_to,
      assigned_to_provider: assignOption?.provider ?? false,
      updated_at: new Date().toISOString(),
    }).eq('id', id)
    if (error) { showError('Failed to save ticket: ' + error.message); return }
    setEditingId(null)
    showSuccess('Ticket updated')
    load()
  }

  async function deleteTicket(id: string) {
    if (!confirm(lang === 'de' ? 'Dieses Ticket löschen?' : 'Delete this ticket?')) return
    const { error } = await supabase.from('hr_tickets').delete().eq('id', id)
    if (error) { showError('Failed to delete ticket: ' + error.message); return }
    showSuccess('Ticket deleted')
    load()
  }

  async function sendResponse(ticket: Ticket) {
    if (!responseText.trim()) return
    setSendingResponse(true)
    const responder = employeeName || 'Admin'
    const now = new Date().toISOString()
    const { error } = await supabase.from('hr_tickets').update({
      admin_response: responseText.trim(),
      responded_by: responder,
      responded_at: now,
      updated_at: now,
    }).eq('id', ticket.id)
    if (error) { showError('Failed to send response: ' + error.message); setSendingResponse(false); return }

    if (ticket.employee_email) {
      await supabase.from('workflow_tracker').insert({
        emp_display_name: ticket.submitted_by,
        step: 1,
        status: 'Pending',
        record_type: 'HR Response',
        action: `Response to ${ticket.ref}: ${ticket.title}`,
        employee_email: ticket.employee_email,
        assigned_to: ticket.employee_email,
        task_description: responseText.trim(),
        approval_status: null,
        company_id: ticket.company_id,
      })
    }

    setRespondingId(null)
    setResponseText('')
    setSendingResponse(false)
    showSuccess('Response sent')
    load()
  }

  const filtered = useMemo(() => {
    return tickets.filter(t => {
      if (filterStatus && t.status !== filterStatus) return false
      if (filterCategory && t.category !== filterCategory) return false
      if (filterPriority && t.priority !== filterPriority) return false
      if (search) {
        const s = search.toLowerCase()
        const haystack = [t.title, t.description, t.ref, t.submitted_by, t.assigned_to, t.status, t.category, t.priority].join(' ').toLowerCase()
        if (!haystack.includes(s)) return false
      }
      return true
    })
  }, [tickets, filterStatus, filterCategory, filterPriority, search])

  useEffect(() => { setPage(1) }, [filterStatus, filterCategory, filterPriority, search])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const stats = useMemo(() => ({
    total: tickets.length,
    open: tickets.filter(t => t.status === 'open').length,
    inProgress: tickets.filter(t => t.status === 'in-progress').length,
    resolved: tickets.filter(t => t.status === 'resolved').length,
    urgent: tickets.filter(t => t.priority === 'urgent' && t.status !== 'closed').length,
  }), [tickets])

  const isEn = lang === 'en'

  return (
    <div className="admin-section">
      <div className="admin-page-header">
        <h2>{isEn ? 'HR Ticket Dashboard' : 'HR-Ticket-Dashboard'}</h2>
        <p>{tickets.length} {isEn ? 'tickets' : 'Tickets'}</p>
      </div>

      <div className="admin-mini-stats">
        <div className="admin-mini-stat"><span className="admin-mini-value">{stats.total}</span><span>{isEn ? 'Total' : 'Gesamt'}</span></div>
        <div className="admin-mini-stat"><span className="admin-mini-value" style={{color:'#ff9800'}}>{stats.open}</span><span>{isEn ? 'Open' : 'Offen'}</span></div>
        <div className="admin-mini-stat"><span className="admin-mini-value" style={{color:'#5b9bd5'}}>{stats.inProgress}</span><span>{isEn ? 'In Progress' : 'In Bearbeitung'}</span></div>
        <div className="admin-mini-stat"><span className="admin-mini-value" style={{color:'#43a047'}}>{stats.resolved}</span><span>{isEn ? 'Resolved' : 'Gelöst'}</span></div>
        <div className="admin-mini-stat"><span className="admin-mini-value" style={{color:'#b71c1c'}}>{stats.urgent}</span><span>{isEn ? 'Urgent' : 'Dringend'}</span></div>
      </div>

      <div className="admin-filters">
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="admin-select">
          <option value="">{isEn ? 'All Statuses' : 'Alle Status'}</option>
          <option value="open">{isEn ? 'Open' : 'Offen'}</option>
          <option value="in-progress">{isEn ? 'In Progress' : 'In Bearbeitung'}</option>
          <option value="resolved">{isEn ? 'Resolved' : 'Gelöst'}</option>
          <option value="closed">{isEn ? 'Closed' : 'Geschlossen'}</option>
        </select>
        <select value={filterCategory} onChange={e => setFilterCategory(e.target.value)} className="admin-select">
          <option value="">{isEn ? 'All Categories' : 'Alle Kategorien'}</option>
          {CATEGORY_OPTIONS.map(c => <option key={c.value} value={c.value}>{isEn ? c.label : c.labelDe}</option>)}
        </select>
        <select value={filterPriority} onChange={e => setFilterPriority(e.target.value)} className="admin-select">
          <option value="">{isEn ? 'All Priorities' : 'Alle Prioritäten'}</option>
          <option value="low">{isEn ? 'Low' : 'Niedrig'}</option>
          <option value="medium">{isEn ? 'Medium' : 'Mittel'}</option>
          <option value="high">{isEn ? 'High' : 'Hoch'}</option>
          <option value="urgent">{isEn ? 'Urgent' : 'Dringend'}</option>
        </select>
        <button className="admin-btn admin-btn-primary" onClick={() => setShowRaiseForm(!showRaiseForm)}>
          {showRaiseForm ? (isEn ? 'Cancel' : 'Abbrechen') : (isEn ? '+ Raise Ticket' : '+ Ticket erstellen')}
        </button>
      </div>

      <input
        className="admin-input"
        placeholder={isEn ? 'Search tickets...' : 'Tickets suchen...'}
        value={search}
        onChange={e => setSearch(e.target.value)}
        style={{ marginBottom: 12, width: '100%', maxWidth: 320 }}
      />

      {showRaiseForm && (
        <div className="admin-add-form">
          <h3>{isEn ? 'Raise New HR Ticket' : 'Neues HR-Ticket erstellen'}</h3>
          <div className="admin-form-grid">
            <div className="admin-form-field admin-form-field-full">
              <label>{isEn ? 'Title' : 'Titel'}</label>
              <input className="admin-input" placeholder={isEn ? 'Brief summary of the issue' : 'Kurze Zusammenfassung des Problems'} value={newTicket.title} onChange={e => setNewTicket(f => ({...f, title: e.target.value}))} />
            </div>
            <div className="admin-form-field admin-form-field-full">
              <label>{isEn ? 'Description' : 'Beschreibung'}</label>
              <textarea className="admin-textarea" placeholder={isEn ? 'Provide details including any employee names, dates, and what action is needed...' : 'Details angeben, einschließlich Mitarbeiternamen, Daten und erforderlicher Maßnahmen...'} value={newTicket.description} onChange={e => setNewTicket(f => ({...f, description: e.target.value}))} />
            </div>
            <div className="admin-form-field">
              <label>{isEn ? 'Category' : 'Kategorie'}</label>
              <select className="admin-select" value={newTicket.category} onChange={e => setNewTicket(f => ({...f, category: e.target.value as TicketCategory}))}>
                {CATEGORY_OPTIONS.map(c => <option key={c.value} value={c.value}>{isEn ? c.label : c.labelDe}</option>)}
              </select>
            </div>
            <div className="admin-form-field">
              <label>{isEn ? 'Priority' : 'Priorität'}</label>
              <select className="admin-select" value={newTicket.priority} onChange={e => setNewTicket(f => ({...f, priority: e.target.value as Priority}))}>
                <option value="low">{isEn ? 'Low' : 'Niedrig'}</option>
                <option value="medium">{isEn ? 'Medium' : 'Mittel'}</option>
                <option value="high">{isEn ? 'High' : 'Hoch'}</option>
                <option value="urgent">{isEn ? 'Urgent' : 'Dringend'}</option>
              </select>
            </div>
            <div className="admin-form-field">
              <label>{isEn ? 'Assign To' : 'Zuweisen an'}</label>
              <select className="admin-select" value={newTicket.assignedTo} onChange={e => setNewTicket(f => ({...f, assignedTo: e.target.value}))}>
                {ASSIGN_OPTIONS.map(a => <option key={a.value} value={a.value}>{isEn ? a.label : a.labelDe}</option>)}
              </select>
            </div>
            <div className="admin-form-field">
              <label>{isEn ? 'Submitted By' : 'Eingereicht von'}</label>
              <input className="admin-input" value={employeeName || 'Admin'} disabled style={{ opacity: 0.7 }} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
            <button className="admin-btn admin-btn-primary" onClick={raiseTicket} disabled={!newTicket.title.trim()}>
              {isEn ? 'Raise Ticket' : 'Ticket erstellen'}
            </button>
            <button className="admin-btn" style={{ background: '#e5e7eb', color: '#4a4a68' }} onClick={() => { setNewTicket(EMPTY_NEW_TICKET); setShowRaiseForm(false) }}>
              {isEn ? 'Cancel' : 'Abbrechen'}
            </button>
          </div>
        </div>
      )}

      {loading ? <div className="admin-loading">{isEn ? 'Loading...' : 'Laden...'}</div> : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead><tr>{isSuperAdmin && <th>{isEn ? 'Company' : 'Firma'}</th>}<th>Ref</th><th>{isEn ? 'Title' : 'Titel'}</th><th className="admin-ticket-hide-mobile">{isEn ? 'Category' : 'Kategorie'}</th><th>{isEn ? 'Priority' : 'Priorität'}</th><th>Status</th><th className="admin-ticket-hide-mobile">{isEn ? 'Assigned' : 'Zugewiesen'}</th><th>{isEn ? 'Actions' : 'Aktionen'}</th></tr></thead>
            <tbody>
              {paginated.map(t => (
                <Fragment key={t.id}>
                  <tr className={expandedId === t.id ? 'admin-row-active' : ''}>
                    {isSuperAdmin && <td style={{ fontSize: 12, fontWeight: 600 }}>{companies?.find(c => c.id === t.company_id)?.name || t.company_id.substring(0, 8)}</td>}
                    <td className="admin-td-mono">{t.ref}</td>
                    <td>{editingId === t.id ? <input className="admin-inline-input" value={editForm.title} onChange={e => setEditForm(f => ({...f, title: e.target.value}))} /> : t.title}</td>
                    <td className="admin-ticket-hide-mobile">{editingId === t.id ? (
                      <select className="admin-inline-select" value={editForm.category} onChange={e => setEditForm(f => ({...f, category: e.target.value}))}>
                        {CATEGORY_OPTIONS.map(c => <option key={c.value} value={c.value}>{isEn ? c.label : c.labelDe}</option>)}
                      </select>
                    ) : <span className="admin-badge admin-badge-info">{t.category.replace('-', ' ')}</span>}</td>
                    <td>{editingId === t.id ? (
                      <select className="admin-inline-select" value={editForm.priority} onChange={e => setEditForm(f => ({...f, priority: e.target.value}))}>
                        <option value="low">{isEn ? 'Low' : 'Niedrig'}</option><option value="medium">{isEn ? 'Medium' : 'Mittel'}</option><option value="high">{isEn ? 'High' : 'Hoch'}</option><option value="urgent">{isEn ? 'Urgent' : 'Dringend'}</option>
                      </select>
                    ) : <span className="admin-badge" style={{background: PRIORITY_COLORS[t.priority], color: '#fff'}}>{t.priority}</span>}</td>
                    <td>{editingId === t.id ? (
                      <select className="admin-inline-select" value={editForm.status} onChange={e => setEditForm(f => ({...f, status: e.target.value}))}>
                        <option value="open">{isEn ? 'Open' : 'Offen'}</option><option value="in-progress">{isEn ? 'In Progress' : 'In Bearbeitung'}</option><option value="resolved">{isEn ? 'Resolved' : 'Gelöst'}</option><option value="closed">{isEn ? 'Closed' : 'Geschlossen'}</option>
                      </select>
                    ) : <span className="admin-badge" style={{background: STATUS_COLORS[t.status], color: '#fff'}}>{t.status}</span>}</td>
                    <td className="admin-ticket-hide-mobile">{editingId === t.id ? (
                      <select className="admin-inline-select" value={editForm.assigned_to} onChange={e => setEditForm(f => ({...f, assigned_to: e.target.value}))}>
                        {ASSIGN_OPTIONS.map(a => <option key={a.value} value={a.value}>{isEn ? a.label : a.labelDe}</option>)}
                      </select>
                    ) : (
                      <span>
                        {t.assigned_to}
                        {t.assigned_to_provider && <span style={{ marginLeft: 6, fontSize: 10, padding: '1px 6px', borderRadius: 4, background: '#e3f2fd', color: '#1565c0', fontWeight: 600 }}>Provider</span>}
                      </span>
                    )}</td>
                    <td className="admin-actions">
                      {editingId === t.id ? (
                        <>
                          <button className="admin-btn-sm admin-btn-save" onClick={() => saveEdit(t.id)}>{isEn ? 'Save' : 'Speichern'}</button>
                          <button className="admin-btn-sm admin-btn-cancel" onClick={() => setEditingId(null)}>{isEn ? 'Cancel' : 'Abbrechen'}</button>
                        </>
                      ) : (
                        <>
                          <button className="admin-btn-icon" onClick={() => setExpandedId(expandedId === t.id ? null : t.id)}>
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points={expandedId === t.id ? "18 15 12 9 6 15" : "6 9 12 15 18 9"}/></svg>
                          </button>
                          <button className="admin-btn-icon" onClick={() => startEdit(t)}>
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                          </button>
                          <button className="admin-btn-icon admin-btn-danger" onClick={() => deleteTicket(t.id)}>
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                  {expandedId === t.id && (
                    <tr className="admin-expanded-row">
                      <td colSpan={isSuperAdmin ? 8 : 7}>
                        <div className="admin-expanded-content">
                          <p style={{ whiteSpace: 'pre-wrap' }}><strong>{isEn ? 'Description' : 'Beschreibung'}:</strong> {editingId === t.id ? <textarea className="admin-inline-textarea" value={editForm.description} onChange={e => setEditForm(f => ({...f, description: e.target.value}))} /> : t.description}</p>
                          <div className="admin-detail-grid">
                            <div><strong>{isEn ? 'Category' : 'Kategorie'}:</strong> <span className="admin-badge admin-badge-info">{t.category.replace('-', ' ')}</span></div>
                            <div><strong>{isEn ? 'Submitted by' : 'Eingereicht von'}:</strong> {t.submitted_by}</div>
                            <div><strong>{isEn ? 'Assigned to' : 'Zugewiesen an'}:</strong> {t.assigned_to}</div>
                            <div><strong>{isEn ? 'Created' : 'Erstellt'}:</strong> {new Date(t.created_at).toLocaleDateString('en-GB')}</div>
                            <div><strong>{isEn ? 'Updated' : 'Aktualisiert'}:</strong> {new Date(t.updated_at).toLocaleDateString('en-GB')}</div>
                          </div>

                          {t.admin_response && (
                            <div style={{ marginTop: 12, padding: 12, background: '#e8f5e9', borderRadius: 8, border: '1px solid #a5d6a7' }}>
                              <p style={{ margin: 0, fontWeight: 600, fontSize: 13, color: '#2e7d32', marginBottom: 4 }}>
                                {isEn ? 'Response' : 'Antwort'} — {t.responded_by} ({t.responded_at ? new Date(t.responded_at).toLocaleDateString('en-GB') : ''})
                              </p>
                              <p style={{ margin: 0, fontSize: 13, whiteSpace: 'pre-wrap' }}>{t.admin_response}</p>
                            </div>
                          )}

                          {t.status !== 'closed' && (
                            <div style={{ marginTop: 12 }}>
                              {respondingId === t.id ? (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                  <textarea
                                    className="admin-textarea"
                                    placeholder={isEn ? 'Type your response to the employee...' : 'Antwort an den Mitarbeiter eingeben...'}
                                    value={responseText}
                                    onChange={e => setResponseText(e.target.value)}
                                    style={{ minHeight: 80 }}
                                  />
                                  <div style={{ display: 'flex', gap: 8 }}>
                                    <button className="admin-btn admin-btn-primary" disabled={!responseText.trim() || sendingResponse} onClick={() => sendResponse(t)}>
                                      {sendingResponse ? (isEn ? 'Sending...' : 'Senden...') : (isEn ? 'Send Response' : 'Antwort senden')}
                                    </button>
                                    <button className="admin-btn" style={{ background: '#e5e7eb', color: '#4a4a68' }} onClick={() => { setRespondingId(null); setResponseText('') }}>
                                      {isEn ? 'Cancel' : 'Abbrechen'}
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                <button className="admin-btn admin-btn-primary" onClick={() => { setRespondingId(t.id); setResponseText(t.admin_response || '') }}>
                                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: 4, verticalAlign: 'middle' }}>
                                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                                  </svg>
                                  {t.admin_response ? (isEn ? 'Update Response' : 'Antwort aktualisieren') : (isEn ? 'Respond' : 'Antworten')}
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
          {filtered.length === 0 && <div className="admin-empty">{isEn ? 'No tickets found' : 'Keine Tickets gefunden'}</div>}
          {filtered.length > PAGE_SIZE && (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 12, marginTop: 16, fontSize: 13 }}>
              <button className="admin-btn" disabled={page === 1} onClick={() => setPage(p => p - 1)}>Prev</button>
              <span>Page {page} of {totalPages}</span>
              <button className="admin-btn" disabled={page === totalPages} onClick={() => setPage(p => p + 1)}>Next</button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
