import { useState, useMemo } from 'react'
import { supabase } from '../../lib/supabase'
import { useToast } from '../../context/ToastContext'
import {
  TASK_CODES,
  RATE_CARDS,
  STATUS_COLOR,
} from './AdminLegalTimesheets'
import type { LegalClient, LegalMatter, Employee } from './AdminLegalTimesheets'

interface LegalClientMattersProps {
  clients: LegalClient[]
  matters: LegalMatter[]
  employees: Employee[]
  selectedCompanyId: string
  onDataChanged: () => void
}

export default function LegalClientMatters({ clients, matters, employees, selectedCompanyId, onDataChanged }: LegalClientMattersProps) {
  const { showError } = useToast()
  // Client/Matter management state
  const [newClientName, setNewClientName] = useState('')
  const [editingClientId, setEditingClientId] = useState<string | null>(null)
  const [editClientName, setEditClientName] = useState('')
  const [editClientBilling, setEditClientBilling] = useState({
    contact_name: '', contact_email: '', address_line1: '', address_line2: '',
    city: '', county: '', postcode: '', country: 'United Kingdom', payment_terms_days: 30
  })
  const [showBillingFor, setShowBillingFor] = useState<string | null>(null)
  const [editingMatterId, setEditingMatterId] = useState<string | null>(null)
  const [editMatterForm, setEditMatterForm] = useState({ name: '', daily_cap: '', rate_card: 'Associate', assigned_employees: [] as string[], allowed_codes: [] as string[] })
  const [matterForm, setMatterForm] = useState({ name: '', dailyCap: '', rateCard: 'Associate', assigned_employees: [] as string[], codes: [] as string[] })
  const [showMatterForm, setShowMatterForm] = useState(false)
  const [matterClientId, setMatterClientId] = useState('')

  // Matters grouped by client
  const clientsWithMatters = useMemo(() => {
    return clients.map(c => ({
      ...c,
      clientMatters: matters.filter(m => m.client_id === c.id),
    }))
  }, [clients, matters])

  // Client/Matter management functions
  async function addClient() {
    if (!newClientName.trim() || !selectedCompanyId) return
    const { error } = await supabase.from('legal_clients').insert({ company_id: selectedCompanyId, name: newClientName.trim(), status: 'active' })
    if (error) { showError('Failed to add client: ' + error.message); return }
    setNewClientName('')
    onDataChanged()
  }

  async function toggleClientStatus(id: string, currentStatus: string) {
    const newStatus = currentStatus === 'active' ? 'archived' : 'active'
    await supabase.from('legal_clients').update({ status: newStatus }).eq('id', id)
    onDataChanged()
  }

  function startEditClient(client: LegalClient) {
    setEditingClientId(client.id)
    setEditClientName(client.name)
    setEditClientBilling({
      contact_name: client.contact_name || '',
      contact_email: client.contact_email || '',
      address_line1: client.address_line1 || '',
      address_line2: client.address_line2 || '',
      city: client.city || '',
      county: client.county || '',
      postcode: client.postcode || '',
      country: client.country || 'United Kingdom',
      payment_terms_days: client.payment_terms_days || 30,
    })
    setShowBillingFor(client.id)
  }

  async function saveClientEdit(id: string) {
    if (!editClientName.trim()) return
    await supabase.from('legal_clients').update({
      name: editClientName.trim(),
      contact_name: editClientBilling.contact_name || null,
      contact_email: editClientBilling.contact_email || null,
      address_line1: editClientBilling.address_line1 || null,
      address_line2: editClientBilling.address_line2 || null,
      city: editClientBilling.city || null,
      county: editClientBilling.county || null,
      postcode: editClientBilling.postcode || null,
      country: editClientBilling.country || null,
      payment_terms_days: editClientBilling.payment_terms_days || 30,
    }).eq('id', id)
    setEditingClientId(null)
    setShowBillingFor(null)
    onDataChanged()
  }

  async function addMatter(clientId: string) {
    if (!matterForm.name.trim() || !selectedCompanyId) return
    await supabase.from('legal_matters').insert({
      company_id: selectedCompanyId,
      client_id: clientId,
      name: matterForm.name.trim(),
      status: 'active',
      daily_cap: matterForm.dailyCap ? parseFloat(matterForm.dailyCap) : null,
      rate_card: matterForm.rateCard,
      assigned_employees: matterForm.assigned_employees,
      allowed_codes: matterForm.codes,
    })
    setMatterForm({ name: '', dailyCap: '', rateCard: 'Associate', assigned_employees: [], codes: [] })
    setShowMatterForm(false)
    onDataChanged()
  }

  async function toggleMatterStatus(matterId: string, currentStatus: string) {
    const newStatus = currentStatus === 'active' ? 'archived' : 'active'
    await supabase.from('legal_matters').update({ status: newStatus }).eq('id', matterId)
    onDataChanged()
  }

  function startEditMatter(m: LegalMatter) {
    setEditingMatterId(m.id)
    setEditMatterForm({
      name: m.name,
      daily_cap: m.daily_cap !== null ? String(m.daily_cap) : '',
      rate_card: m.rate_card || 'Associate',
      assigned_employees: m.assigned_employees || [],
      allowed_codes: m.allowed_codes || [],
    })
  }

  async function saveMatterEdit(id: string) {
    if (!editMatterForm.name.trim()) return
    await supabase.from('legal_matters').update({
      name: editMatterForm.name.trim(),
      daily_cap: editMatterForm.daily_cap ? parseFloat(editMatterForm.daily_cap) : null,
      rate_card: editMatterForm.rate_card,
      assigned_employees: editMatterForm.assigned_employees,
      allowed_codes: editMatterForm.allowed_codes,
    }).eq('id', id)
    setEditingMatterId(null)
    onDataChanged()
  }

  return (
    <>
      {/* Add Client */}
      <div className="alt-add-row">
        <input className="admin-input" placeholder="New client name..." value={newClientName} onChange={e => setNewClientName(e.target.value)} style={{ flex: 1 }} />
        <button className="admin-btn alt-btn-primary" onClick={addClient} disabled={!newClientName.trim()}>+ Add Client</button>
      </div>

      {clientsWithMatters.map(client => (
        <div key={client.id} className="alt-client-block">
          <div className="alt-client-header">
            <div className="alt-client-info">
              {editingClientId === client.id ? (
                <>
                  <input className="admin-input" value={editClientName} onChange={e => setEditClientName(e.target.value)} style={{ maxWidth: 260 }} />
                  <button className="admin-btn-sm admin-btn-save" onClick={() => saveClientEdit(client.id)}>Save</button>
                  <button className="admin-btn-sm admin-btn-cancel" onClick={() => { setEditingClientId(null); setShowBillingFor(null) }}>Cancel</button>
                </>
              ) : (
                <>
                  <h3 className="alt-client-name">{client.name}</h3>
                  <span className="admin-badge" style={{ background: STATUS_COLOR[client.status].bg, color: STATUS_COLOR[client.status].text }}>{client.status}</span>
                  <span style={{ fontSize: 12, color: '#8b8fa3' }}>{client.clientMatters.length} matters</span>
                </>
              )}
            </div>
            <div className="alt-client-actions">
              {editingClientId !== client.id && (
                <>
                  <button className="admin-btn-sm" style={{ fontSize: 11 }} onClick={() => setShowBillingFor(showBillingFor === client.id ? null : client.id)}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 4, verticalAlign: -1 }}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>
                    Billing
                  </button>
                  <button className="admin-btn-icon" title="Edit client" onClick={() => startEditClient(client)}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
                  </button>
                </>
              )}
              <button className="admin-btn-sm" style={{ background: client.status === 'active' ? '#ffebee' : '#e8f5e9', color: client.status === 'active' ? '#c62828' : '#2e7d32' }} onClick={() => toggleClientStatus(client.id, client.status)}>
                {client.status === 'active' ? 'Archive' : 'Reactivate'}
              </button>
              <button className="admin-btn-sm alt-btn-add-matter" onClick={() => { setMatterClientId(client.id); setShowMatterForm(true); setMatterForm({ name: '', dailyCap: '', rateCard: 'Associate', assigned_employees: [], codes: [] }) }}>
                + Matter
              </button>
            </div>
          </div>

          {showBillingFor === client.id && (
            <div style={{ padding: '12px 16px', background: '#f8f9fa', borderRadius: 8, margin: '8px 0', fontSize: 13 }}>
              <div style={{ fontWeight: 600, marginBottom: 10, fontSize: 13 }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#00897b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 6, verticalAlign: -2 }}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>
                Billing Details
              </div>
              {editingClientId === client.id ? (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 12px' }}>
                  <div>
                    <label style={{ fontSize: 11, fontWeight: 600, display: 'block', marginBottom: 2 }}>Contact Name</label>
                    <input className="admin-inline-input" style={{ width: '100%' }} value={editClientBilling.contact_name} onChange={e => setEditClientBilling(p => ({ ...p, contact_name: e.target.value }))} />
                  </div>
                  <div>
                    <label style={{ fontSize: 11, fontWeight: 600, display: 'block', marginBottom: 2 }}>Contact Email</label>
                    <input className="admin-inline-input" type="email" style={{ width: '100%' }} value={editClientBilling.contact_email} onChange={e => setEditClientBilling(p => ({ ...p, contact_email: e.target.value }))} />
                  </div>
                  <div>
                    <label style={{ fontSize: 11, fontWeight: 600, display: 'block', marginBottom: 2 }}>Address Line 1</label>
                    <input className="admin-inline-input" style={{ width: '100%' }} value={editClientBilling.address_line1} onChange={e => setEditClientBilling(p => ({ ...p, address_line1: e.target.value }))} />
                  </div>
                  <div>
                    <label style={{ fontSize: 11, fontWeight: 600, display: 'block', marginBottom: 2 }}>Address Line 2</label>
                    <input className="admin-inline-input" style={{ width: '100%' }} value={editClientBilling.address_line2} onChange={e => setEditClientBilling(p => ({ ...p, address_line2: e.target.value }))} />
                  </div>
                  <div>
                    <label style={{ fontSize: 11, fontWeight: 600, display: 'block', marginBottom: 2 }}>City</label>
                    <input className="admin-inline-input" style={{ width: '100%' }} value={editClientBilling.city} onChange={e => setEditClientBilling(p => ({ ...p, city: e.target.value }))} />
                  </div>
                  <div>
                    <label style={{ fontSize: 11, fontWeight: 600, display: 'block', marginBottom: 2 }}>County</label>
                    <input className="admin-inline-input" style={{ width: '100%' }} value={editClientBilling.county} onChange={e => setEditClientBilling(p => ({ ...p, county: e.target.value }))} />
                  </div>
                  <div>
                    <label style={{ fontSize: 11, fontWeight: 600, display: 'block', marginBottom: 2 }}>Postcode</label>
                    <input className="admin-inline-input" style={{ width: '100%' }} value={editClientBilling.postcode} onChange={e => setEditClientBilling(p => ({ ...p, postcode: e.target.value }))} />
                  </div>
                  <div>
                    <label style={{ fontSize: 11, fontWeight: 600, display: 'block', marginBottom: 2 }}>Payment Terms (days)</label>
                    <input className="admin-inline-input" type="number" style={{ width: '100%' }} value={editClientBilling.payment_terms_days} onChange={e => setEditClientBilling(p => ({ ...p, payment_terms_days: Number(e.target.value) }))} />
                  </div>
                </div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 24px', color: '#555' }}>
                  <div><strong>Contact:</strong> {client.contact_name || '—'} {client.contact_email ? `(${client.contact_email})` : ''}</div>
                  <div><strong>Payment Terms:</strong> {client.payment_terms_days || 30} days</div>
                  <div style={{ gridColumn: '1 / -1' }}>
                    <strong>Address:</strong> {[client.address_line1, client.address_line2, client.city, client.county, client.postcode].filter(Boolean).join(', ') || '—'}
                  </div>
                </div>
              )}
            </div>
          )}

          {client.clientMatters.length > 0 && (
            <div className="admin-table-wrap" style={{ marginTop: 8 }}>
              <table className="admin-table alt-dense-table">
                <thead>
                  <tr>
                    <th>Matter / File</th>
                    <th>Status</th>
                    <th>Daily Cap</th>
                    <th>Rate Card</th>
                    <th className="alt-hide-mobile">Fee Earners</th>
                    <th className="alt-hide-mobile">Allowed Codes</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {client.clientMatters.map(m => {
                    if (editingMatterId === m.id) {
                      return (
                        <tr key={m.id}>
                          <td>
                            <input className="admin-inline-input" value={editMatterForm.name} onChange={e => setEditMatterForm(p => ({ ...p, name: e.target.value }))} />
                          </td>
                          <td><span className="admin-badge" style={{ background: STATUS_COLOR[m.status].bg, color: STATUS_COLOR[m.status].text }}>{m.status}</span></td>
                          <td>
                            <input className="admin-inline-input admin-inline-sm" type="number" step="0.5" value={editMatterForm.daily_cap} onChange={e => setEditMatterForm(p => ({ ...p, daily_cap: e.target.value }))} placeholder="No cap" style={{ width: 70 }} />
                          </td>
                          <td>
                            <select className="admin-inline-select" value={editMatterForm.rate_card} onChange={e => setEditMatterForm(p => ({ ...p, rate_card: e.target.value }))}>
                              {RATE_CARDS.map(r => <option key={r} value={r}>{r}</option>)}
                            </select>
                          </td>
                          <td className="alt-hide-mobile">
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                              {employees.filter(emp => emp.is_active).map(emp => {
                                const isAssigned = editMatterForm.assigned_employees.includes(emp.id)
                                return (
                                  <button key={emp.id} className={`alt-assignee-chip ${isAssigned ? 'alt-assignee-chip-active' : ''}`}
                                    style={{ cursor: 'pointer', opacity: isAssigned ? 1 : 0.5 }}
                                    onClick={() => setEditMatterForm(p => ({
                                      ...p,
                                      assigned_employees: isAssigned
                                        ? p.assigned_employees.filter(id => id !== emp.id)
                                        : [...p.assigned_employees, emp.id],
                                    }))}>
                                    {emp.first_name} {emp.last_name}
                                  </button>
                                )
                              })}
                            </div>
                          </td>
                          <td className="alt-hide-mobile">
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
                              {TASK_CODES.map(tc => (
                                <button key={tc.code} className={`alt-code-pick ${editMatterForm.allowed_codes.includes(tc.code) ? 'alt-code-pick-active' : ''}`}
                                  style={{ fontSize: 10, padding: '1px 4px' }}
                                  onClick={() => setEditMatterForm(p => ({
                                    ...p,
                                    allowed_codes: p.allowed_codes.includes(tc.code)
                                      ? p.allowed_codes.filter(c => c !== tc.code)
                                      : [...p.allowed_codes, tc.code],
                                  }))}>
                                  {tc.code}
                                </button>
                              ))}
                            </div>
                          </td>
                          <td className="admin-actions">
                            <button className="admin-btn-sm admin-btn-save" onClick={() => saveMatterEdit(m.id)}>Save</button>
                            <button className="admin-btn-sm admin-btn-cancel" onClick={() => setEditingMatterId(null)}>Cancel</button>
                          </td>
                        </tr>
                      )
                    }
                    return (
                      <tr key={m.id} className={m.status === 'archived' ? 'admin-row-muted' : ''}>
                        <td style={{ fontWeight: 600 }}>{m.name}</td>
                        <td><span className="admin-badge" style={{ background: STATUS_COLOR[m.status].bg, color: STATUS_COLOR[m.status].text }}>{m.status}</span></td>
                        <td>{m.daily_cap ? `${m.daily_cap}h` : '—'}</td>
                        <td><span className="alt-rate-badge">{m.rate_card}</span></td>
                        <td className="alt-hide-mobile">
                          {(m.assigned_employees || []).length > 0
                            ? (m.assigned_employees || []).map(empId => {
                                const emp = employees.find(e => e.id === empId)
                                return <span key={empId} className="alt-assignee-chip">{emp ? `${emp.first_name} ${emp.last_name}` : empId}</span>
                              })
                            : <span style={{ color: '#bbb', fontSize: 12 }}>None</span>
                          }
                        </td>
                        <td className="alt-hide-mobile">
                          {(m.allowed_codes || []).length > 0
                            ? (m.allowed_codes || []).map(c => <span key={c} className="alt-code-badge" style={{ marginRight: 3 }}>{c}</span>)
                            : <span style={{ color: '#bbb', fontSize: 12 }}>All</span>
                          }
                        </td>
                        <td className="admin-actions">
                          <button className="admin-btn-icon" title="Edit matter" onClick={() => startEditMatter(m)}>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
                          </button>
                          <button className="admin-btn-icon" title={m.status === 'active' ? 'Archive' : 'Reactivate'} onClick={() => toggleMatterStatus(m.id, m.status)}>
                            {m.status === 'active' ? (
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="21 8 21 21 3 21 3 8" /><rect x="1" y="3" width="22" height="5" /><line x1="10" y1="12" x2="14" y2="12" /></svg>
                            ) : (
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="1 4 1 10 7 10" /><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" /></svg>
                            )}
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ))}

      {/* Add Matter Modal */}
      {showMatterForm && (
        <div className="admin-modal-overlay" onClick={() => setShowMatterForm(false)}>
          <div className="admin-modal" onClick={ev => ev.stopPropagation()} style={{ maxWidth: 520 }}>
            <h2 style={{ marginBottom: 16 }}>Add Matter to {clients.find(c => c.id === matterClientId)?.name}</h2>
            <div className="admin-form-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
              <div className="admin-form-field admin-form-field-full">
                <label>Matter Name</label>
                <input className="admin-input" value={matterForm.name} onChange={e => setMatterForm(p => ({ ...p, name: e.target.value }))} placeholder="e.g. Contract Dispute" />
              </div>
              <div className="admin-form-field">
                <label>Daily Hour Cap</label>
                <input className="admin-input" type="number" step="0.5" value={matterForm.dailyCap} onChange={e => setMatterForm(p => ({ ...p, dailyCap: e.target.value }))} placeholder="No cap" />
              </div>
              <div className="admin-form-field">
                <label>Rate Card</label>
                <select className="admin-select" value={matterForm.rateCard} onChange={e => setMatterForm(p => ({ ...p, rateCard: e.target.value }))}>
                  {RATE_CARDS.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
              <div className="admin-form-field admin-form-field-full">
                <label>Assigned Fee Earners</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {employees.filter(emp => emp.is_active).map(emp => {
                    const isAssigned = matterForm.assigned_employees.includes(emp.id)
                    return (
                      <button key={emp.id} type="button" className={`alt-assignee-chip ${isAssigned ? 'alt-assignee-chip-active' : ''}`}
                        style={{ cursor: 'pointer', opacity: isAssigned ? 1 : 0.5 }}
                        onClick={() => setMatterForm(p => ({
                          ...p,
                          assigned_employees: isAssigned
                            ? p.assigned_employees.filter(id => id !== emp.id)
                            : [...p.assigned_employees, emp.id],
                        }))}>
                        {emp.first_name} {emp.last_name}
                      </button>
                    )
                  })}
                </div>
              </div>
              <div className="admin-form-field admin-form-field-full">
                <label>Allowed Activity Codes (leave empty for all)</label>
                <div className="alt-code-picker">
                  {TASK_CODES.map(tc => (
                    <button key={tc.code} className={`alt-code-pick ${matterForm.codes.includes(tc.code) ? 'alt-code-pick-active' : ''}`}
                      onClick={() => setMatterForm(p => ({ ...p, codes: p.codes.includes(tc.code) ? p.codes.filter(c => c !== tc.code) : [...p.codes, tc.code] }))}>
                      {tc.code}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
              <button className="admin-btn admin-btn-cancel-lg" onClick={() => setShowMatterForm(false)}>Cancel</button>
              <button className="admin-btn alt-btn-primary" onClick={() => addMatter(matterClientId)} disabled={!matterForm.name.trim()}>Add Matter</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
