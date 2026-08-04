import { useState, useEffect, useCallback } from 'react'
import { useFeatures } from '../../context/FeatureContext'
import { useAdminCompany } from '../../context/AdminCompanyContext'
import { useToast } from '../../context/ToastContext'
import { supabase } from '../../lib/supabase'
import { seedBenefitDefaults } from '../../lib/benefitDefaults'

interface BenefitOption {
  id: number
  option_key: string
  icon: string
  title: string
  description: string
  is_enabled: boolean
  sort_order: number
}

interface BenefitType {
  id: number
  benefit_key: string
  title: string
  description: string
  icon: string
  color: string
  intro: string
  eligibility: string
  cost_description: string
  monthly_cost: number
  lock_period: 'none' | 'month' | 'year'
  is_enabled: boolean
  sort_order: number
  options: BenefitOption[]
}

export default function AdminBenefits() {
  const { features } = useFeatures()
  const { selectedCompanyId: companyId } = useAdminCompany()
  const { showError } = useToast()
  const payrollEnabled = features.payslips
  const [benefits, setBenefits] = useState<BenefitType[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editForm, setEditForm] = useState<Record<string, any>>({})
  const [editingOptionId, setEditingOptionId] = useState<number | null>(null)
  const [optionForm, setOptionForm] = useState<Record<string, any>>({})
  const [showNewBenefit, setShowNewBenefit] = useState(false)
  const [newBenefit, setNewBenefit] = useState({ title: '', description: '', icon: '🎁', color: '#4f46e5', intro: '', eligibility: '', cost_description: '£0', monthly_cost: 0, lock_period: 'none' as 'none' | 'month' | 'year' })
  const [showNewOption, setShowNewOption] = useState<number | null>(null)
  const [newOption, setNewOption] = useState({ icon: '✨', title: '', description: '' })

  const loadBenefits = useCallback(async () => {
    if (!companyId) return
    setLoading(true)

    const { data: types } = await supabase
      .from('benefit_types')
      .select('*')
      .eq('company_id', companyId)
      .order('sort_order')

    if (!types || types.length === 0) {
      await seedBenefitDefaults(companyId)
      // Re-fetch after seeding
      const { data: seeded } = await supabase
        .from('benefit_types')
        .select('*')
        .eq('company_id', companyId)
        .order('sort_order')

      if (seeded) {
        const withOptions = await attachOptions(seeded, companyId)
        setBenefits(withOptions)
      }
    } else {
      const withOptions = await attachOptions(types, companyId)
      setBenefits(withOptions)
    }
    setLoading(false)
  }, [companyId])

  useEffect(() => { loadBenefits() }, [loadBenefits])

  async function attachOptions(types: any[], cId: string): Promise<BenefitType[]> {
    const typeIds = types.map((t: any) => t.id)
    const { data: opts } = await supabase
      .from('benefit_options')
      .select('*')
      .eq('company_id', cId)
      .in('benefit_type_id', typeIds)
      .order('sort_order')

    const optMap = new Map<number, BenefitOption[]>()
    for (const o of (opts || [])) {
      const list = optMap.get(o.benefit_type_id) || []
      list.push(o as BenefitOption)
      optMap.set(o.benefit_type_id, list)
    }

    return types.map((t: any) => ({
      ...t,
      options: optMap.get(t.id) || [],
    }))
  }

  async function toggleBenefitEnabled(id: number) {
    const b = benefits.find(x => x.id === id)
    if (!b || !companyId) return
    const { error } = await supabase.from('benefit_types').update({ is_enabled: !b.is_enabled }).eq('id', id).eq('company_id', companyId)
    if (error) { showError('Failed to toggle benefit: ' + error.message); return }
    setBenefits(prev => prev.map(x => x.id === id ? { ...x, is_enabled: !x.is_enabled } : x))
  }

  async function toggleOptionEnabled(benefitId: number, optionId: number) {
    const b = benefits.find(x => x.id === benefitId)
    const opt = b?.options.find(o => o.id === optionId)
    if (!opt) return
    const { error } = await supabase.from('benefit_options').update({ is_enabled: !opt.is_enabled }).eq('id', optionId)
    if (error) { showError('Failed to toggle option: ' + error.message); return }
    setBenefits(prev => prev.map(x => x.id === benefitId ? {
      ...x, options: x.options.map(o => o.id === optionId ? { ...o, is_enabled: !o.is_enabled } : o)
    } : x))
  }

  function startEditBenefit(b: BenefitType) {
    setEditingId(b.id)
    setExpandedId(b.id)
    setEditForm({ title: b.title, description: b.description, icon: b.icon, color: b.color, intro: b.intro, eligibility: b.eligibility, cost_description: b.cost_description, monthly_cost: b.monthly_cost ?? 0, lock_period: b.lock_period ?? 'none' })
  }

  async function saveEditBenefit(id: number) {
    const { error } = await supabase.from('benefit_types').update({
      title: editForm.title,
      description: editForm.description,
      icon: editForm.icon,
      color: editForm.color,
      intro: editForm.intro,
      eligibility: editForm.eligibility,
      cost_description: editForm.cost_description,
      monthly_cost: editForm.monthly_cost,
      lock_period: editForm.lock_period,
    }).eq('id', id)
    if (error) { showError('Failed to save benefit: ' + error.message); return }
    setBenefits(prev => prev.map(b => b.id === id ? { ...b, ...editForm } : b))
    setEditingId(null)
  }

  async function deleteBenefit(id: number) {
    if (!confirm('Delete this benefit type and all its options?')) return
    const { error: e1 } = await supabase.from('benefit_options').delete().eq('benefit_type_id', id)
    if (e1) { showError('Failed to delete benefit options: ' + e1.message); return }
    const { error: e2 } = await supabase.from('benefit_enrollments').delete().eq('benefit_type_id', id)
    if (e2) { showError('Failed to delete benefit enrollments: ' + e2.message); return }
    const { error: e3 } = await supabase.from('benefit_types').delete().eq('id', id)
    if (e3) { showError('Failed to delete benefit type: ' + e3.message); return }
    setBenefits(prev => prev.filter(b => b.id !== id))
    if (expandedId === id) setExpandedId(null)
  }

  function startEditOption(opt: BenefitOption) {
    setEditingOptionId(opt.id)
    setOptionForm({ icon: opt.icon, title: opt.title, description: opt.description })
  }

  async function saveEditOption(optionId: number) {
    const { error } = await supabase.from('benefit_options').update({
      icon: optionForm.icon,
      title: optionForm.title,
      description: optionForm.description,
    }).eq('id', optionId)
    if (error) { showError('Failed to save option: ' + error.message); return }
    setBenefits(prev => prev.map(b => ({
      ...b, options: b.options.map(o => o.id === optionId ? { ...o, ...optionForm } : o)
    })))
    setEditingOptionId(null)
  }

  async function deleteOption(benefitId: number, optionId: number) {
    if (!confirm('Delete this option?')) return
    const { error: e1 } = await supabase.from('benefit_enrollments').delete().eq('option_id', optionId)
    if (e1) { showError('Failed to delete option enrollments: ' + e1.message); return }
    const { error: e2 } = await supabase.from('benefit_options').delete().eq('id', optionId)
    if (e2) { showError('Failed to delete option: ' + e2.message); return }
    setBenefits(prev => prev.map(b => b.id === benefitId ? {
      ...b, options: b.options.filter(o => o.id !== optionId)
    } : b))
  }

  async function addNewBenefit() {
    if (!newBenefit.title || !companyId) return
    const key = newBenefit.title.toLowerCase().replace(/[^a-z0-9]+/g, '_')
    const nextSort = benefits.length
    const { data: inserted, error } = await supabase.from('benefit_types').insert({
      company_id: companyId,
      benefit_key: key,
      title: newBenefit.title,
      description: newBenefit.description,
      icon: newBenefit.icon,
      color: newBenefit.color,
      intro: newBenefit.intro,
      eligibility: newBenefit.eligibility,
      cost_description: newBenefit.cost_description,
      monthly_cost: newBenefit.monthly_cost,
      lock_period: newBenefit.lock_period,
      is_enabled: true,
      sort_order: nextSort,
    }).select('*').single()

    if (error) { showError('Failed to add benefit type: ' + error.message); return }
    if (inserted) {
      setBenefits(prev => [...prev, { ...inserted, options: [] } as BenefitType])
    }
    setNewBenefit({ title: '', description: '', icon: '🎁', color: '#4f46e5', intro: '', eligibility: '', cost_description: '£0', monthly_cost: 0, lock_period: 'none' })
    setShowNewBenefit(false)
  }

  async function addNewOption(benefitId: number) {
    if (!newOption.title || !companyId) return
    const key = newOption.title.toLowerCase().replace(/[^a-z0-9]+/g, '_')
    const b = benefits.find(x => x.id === benefitId)
    const nextSort = b ? b.options.length : 0
    const { data: inserted, error } = await supabase.from('benefit_options').insert({
      company_id: companyId,
      benefit_type_id: benefitId,
      option_key: key,
      icon: newOption.icon,
      title: newOption.title,
      description: newOption.description,
      is_enabled: true,
      sort_order: nextSort,
    }).select('*').single()

    if (error) { showError('Failed to add option: ' + error.message); return }
    if (inserted) {
      setBenefits(prev => prev.map(x => x.id === benefitId ? {
        ...x, options: [...x.options, inserted as BenefitOption]
      } : x))
    }
    setNewOption({ icon: '✨', title: '', description: '' })
    setShowNewOption(null)
  }

  if (loading) return <div className="admin-section"><p>Loading benefits...</p></div>

  return (
    <div className="admin-section">
      <div className="admin-page-header">
        <h2>Benefits Management</h2>
        <p>{benefits.length} benefit types · {benefits.reduce((s, b) => s + b.options.length, 0)} options</p>
      </div>

      <div className="admin-mini-stats">
        <div className="admin-mini-stat"><span className="admin-mini-value">{benefits.length}</span><span>Types</span></div>
        <div className="admin-mini-stat"><span className="admin-mini-value" style={{color:'#43a047'}}>{benefits.filter(b => b.is_enabled).length}</span><span>Active</span></div>
        <div className="admin-mini-stat"><span className="admin-mini-value" style={{color:'#e53935'}}>{benefits.filter(b => !b.is_enabled).length}</span><span>Disabled</span></div>
        <div className="admin-mini-stat"><span className="admin-mini-value" style={{color:'#5b9bd5'}}>{benefits.reduce((s, b) => s + b.options.length, 0)}</span><span>Options</span></div>
      </div>

      <div style={{marginBottom: '16px'}}>
        <button className="admin-btn admin-btn-primary" onClick={() => setShowNewBenefit(true)}>+ Add Benefit Type</button>
      </div>

      {showNewBenefit && (
        <div className="admin-add-form" style={{marginBottom: '16px'}}>
          <h3>Create New Benefit Type</h3>
          <div className="admin-form-grid">
            <div className="admin-form-field"><label>Icon (emoji)</label><input className="admin-input" value={newBenefit.icon} onChange={e => setNewBenefit(p => ({...p, icon: e.target.value}))} /></div>
            <div className="admin-form-field"><label>Title</label><input className="admin-input" value={newBenefit.title} onChange={e => setNewBenefit(p => ({...p, title: e.target.value}))} /></div>
            <div className="admin-form-field"><label>Short Description</label><input className="admin-input" value={newBenefit.description} onChange={e => setNewBenefit(p => ({...p, description: e.target.value}))} /></div>
            <div className="admin-form-field"><label>Colour</label><input type="color" className="admin-input" value={newBenefit.color} onChange={e => setNewBenefit(p => ({...p, color: e.target.value}))} style={{height:'40px',padding:'2px'}} /></div>
            <div className="admin-form-field" style={{gridColumn:'1/-1'}}><label>Introduction Text</label><textarea className="admin-input" rows={2} value={newBenefit.intro} onChange={e => setNewBenefit(p => ({...p, intro: e.target.value}))} /></div>
            <div className="admin-form-field"><label>Eligibility</label><input className="admin-input" value={newBenefit.eligibility} onChange={e => setNewBenefit(p => ({...p, eligibility: e.target.value}))} /></div>
            <div className="admin-form-field"><label>Cost Description</label><input className="admin-input" value={newBenefit.cost_description} onChange={e => setNewBenefit(p => ({...p, cost_description: e.target.value}))} disabled={!payrollEnabled} style={!payrollEnabled ? {opacity: 0.5, cursor: 'not-allowed'} : undefined} /></div>
            <div className="admin-form-field"><label>Monthly Cost (£)</label><input type="number" min="0" step="0.01" className="admin-input" value={newBenefit.monthly_cost} onChange={e => setNewBenefit(p => ({...p, monthly_cost: parseFloat(e.target.value) || 0}))} disabled={!payrollEnabled} style={!payrollEnabled ? {opacity: 0.5, cursor: 'not-allowed'} : undefined} /></div>
            <div className="admin-form-field"><label>Lock Period</label>
              <select className="admin-input" value={newBenefit.lock_period} onChange={e => setNewBenefit(p => ({...p, lock_period: e.target.value as 'none' | 'month' | 'year'}))}>
                <option value="none">None</option>
                <option value="month">Monthly (until end of month)</option>
                <option value="year">Yearly (until end of financial year)</option>
              </select>
            </div>
          </div>
          <div style={{display:'flex', gap:'8px', marginTop:'12px'}}>
            <button className="admin-btn admin-btn-primary" onClick={addNewBenefit}>Create Benefit</button>
            <button className="admin-btn admin-btn-cancel" onClick={() => setShowNewBenefit(false)}>Cancel</button>
          </div>
        </div>
      )}

      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead><tr><th style={{width:'40px'}}></th><th>Benefit Type</th><th>Description</th><th>Options</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>
            {benefits.map(b => (
              <>
                <tr key={b.id} className={expandedId === b.id ? 'admin-row-active' : ''}>
                  <td><span style={{fontSize:'20px'}}>{b.icon}</span></td>
                  <td>
                    {editingId === b.id
                      ? <input className="admin-inline-input" value={editForm.title} onChange={e => setEditForm(f => ({...f, title: e.target.value}))} />
                      : <strong>{b.title}</strong>}
                  </td>
                  <td>
                    {editingId === b.id
                      ? <input className="admin-inline-input" value={editForm.description} onChange={e => setEditForm(f => ({...f, description: e.target.value}))} />
                      : b.description}
                  </td>
                  <td>{b.options.length} ({b.options.filter(o => o.is_enabled).length} active)</td>
                  <td>
                    <label className="admin-toggle">
                      <input type="checkbox" checked={b.is_enabled} onChange={() => toggleBenefitEnabled(b.id)} />
                      <span className="admin-toggle-slider" />
                    </label>
                  </td>
                  <td className="admin-actions">
                    {editingId === b.id ? (
                      <>
                        <button className="admin-btn-sm admin-btn-save" onClick={() => saveEditBenefit(b.id)}>Save</button>
                        <button className="admin-btn-sm admin-btn-cancel" onClick={() => setEditingId(null)}>Cancel</button>
                      </>
                    ) : (
                      <>
                        <button className="admin-btn-icon" onClick={() => setExpandedId(expandedId === b.id ? null : b.id)}>
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points={expandedId === b.id ? "18 15 12 9 6 15" : "6 9 12 15 18 9"}/></svg>
                        </button>
                        <button className="admin-btn-icon" onClick={() => startEditBenefit(b)}>
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                        </button>
                        <button className="admin-btn-icon admin-btn-danger" onClick={() => deleteBenefit(b.id)}>
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                        </button>
                      </>
                    )}
                  </td>
                </tr>
                {expandedId === b.id && (
                  <tr key={`exp-${b.id}`} className="admin-expanded-row">
                    <td colSpan={6}>
                      <div className="admin-expanded-content">
                        {editingId === b.id ? (
                          <div className="admin-benefit-edit-extras">
                            <div className="admin-form-grid">
                              <div className="admin-form-field"><label>Title</label><input className="admin-input" value={editForm.title} onChange={e => setEditForm(f => ({...f, title: e.target.value}))} /></div>
                              <div className="admin-form-field"><label>Description</label><input className="admin-input" value={editForm.description} onChange={e => setEditForm(f => ({...f, description: e.target.value}))} /></div>
                              <div className="admin-form-field"><label>Icon</label><input className="admin-input" value={editForm.icon} onChange={e => setEditForm(f => ({...f, icon: e.target.value}))} /></div>
                              <div className="admin-form-field"><label>Colour</label><input type="color" className="admin-input" value={editForm.color} onChange={e => setEditForm(f => ({...f, color: e.target.value}))} style={{height:'40px',padding:'2px'}} /></div>
                              <div className="admin-form-field" style={{gridColumn:'1/-1'}}><label>Introduction</label><textarea className="admin-input" rows={2} value={editForm.intro} onChange={e => setEditForm(f => ({...f, intro: e.target.value}))} /></div>
                              <div className="admin-form-field"><label>Eligibility</label><input className="admin-input" value={editForm.eligibility} onChange={e => setEditForm(f => ({...f, eligibility: e.target.value}))} /></div>
                              <div className="admin-form-field"><label>Cost Description</label><input className="admin-input" value={editForm.cost_description} onChange={e => setEditForm(f => ({...f, cost_description: e.target.value}))} disabled={!payrollEnabled} style={!payrollEnabled ? {opacity: 0.5, cursor: 'not-allowed'} : undefined} /></div>
                              <div className="admin-form-field"><label>Monthly Cost (£)</label><input type="number" min="0" step="0.01" className="admin-input" value={editForm.monthly_cost ?? 0} onChange={e => setEditForm(f => ({...f, monthly_cost: parseFloat(e.target.value) || 0}))} disabled={!payrollEnabled} style={!payrollEnabled ? {opacity: 0.5, cursor: 'not-allowed'} : undefined} /></div>
                              <div className="admin-form-field"><label>Lock Period</label>
                                <select className="admin-input" value={editForm.lock_period ?? 'none'} onChange={e => setEditForm(f => ({...f, lock_period: e.target.value}))}>
                                  <option value="none">None</option>
                                  <option value="month">Monthly (until end of month)</option>
                                  <option value="year">Yearly (until end of financial year)</option>
                                </select>
                              </div>
                            </div>
                            {!payrollEnabled && <p style={{color:'#e53935', fontSize:'12px', margin:'8px 0 0'}}>Payroll feature is disabled — cost fields are read-only</p>}
                          </div>
                        ) : (
                          <div className="admin-benefit-meta">
                            <div><strong>Eligibility:</strong> {b.eligibility}</div>
                            <div><strong>Cost:</strong> {b.cost_description}</div>
                            <div><strong>Monthly Cost:</strong> £{(b.monthly_cost ?? 0).toFixed(2)}</div>
                            <div><strong>Lock Period:</strong> {(b.lock_period ?? 'none') === 'none' ? 'None' : b.lock_period === 'month' ? 'Monthly' : 'Financial Year'}</div>
                          </div>
                        )}

                        <div className="admin-benefit-options-header">
                          <h4>Options ({b.options.length})</h4>
                          <button className="admin-btn-sm admin-btn-save" onClick={() => { setShowNewOption(b.id); setNewOption({ icon: '✨', title: '', description: '' }) }}>+ Add Option</button>
                        </div>

                        {showNewOption === b.id && (
                          <div className="admin-benefit-new-option">
                            <input className="admin-input" placeholder="Icon" value={newOption.icon} onChange={e => setNewOption(p => ({...p, icon: e.target.value}))} style={{width:'60px'}} />
                            <input className="admin-input" placeholder="Title" value={newOption.title} onChange={e => setNewOption(p => ({...p, title: e.target.value}))} style={{flex:1}} />
                            <input className="admin-input" placeholder="Description" value={newOption.description} onChange={e => setNewOption(p => ({...p, description: e.target.value}))} style={{flex:2}} />
                            <button className="admin-btn-sm admin-btn-save" onClick={() => addNewOption(b.id)}>Add</button>
                            <button className="admin-btn-sm admin-btn-cancel" onClick={() => setShowNewOption(null)}>Cancel</button>
                          </div>
                        )}

                        <table className="admin-table admin-table-nested">
                          <thead><tr><th style={{width:'36px'}}></th><th>Option</th><th>Description</th><th>Visible</th><th>Actions</th></tr></thead>
                          <tbody>
                            {b.options.map(opt => (
                              <tr key={opt.id} style={{opacity: opt.is_enabled ? 1 : 0.5}}>
                                <td><span style={{fontSize:'16px'}}>{editingOptionId === opt.id ? <input className="admin-inline-input" value={optionForm.icon} onChange={e => setOptionForm(f => ({...f, icon: e.target.value}))} style={{width:'40px',textAlign:'center'}} /> : opt.icon}</span></td>
                                <td>{editingOptionId === opt.id ? <input className="admin-inline-input" value={optionForm.title} onChange={e => setOptionForm(f => ({...f, title: e.target.value}))} /> : opt.title}</td>
                                <td>{editingOptionId === opt.id ? <input className="admin-inline-input" value={optionForm.description} onChange={e => setOptionForm(f => ({...f, description: e.target.value}))} /> : opt.description}</td>
                                <td>
                                  <label className="admin-toggle">
                                    <input type="checkbox" checked={opt.is_enabled} onChange={() => toggleOptionEnabled(b.id, opt.id)} />
                                    <span className="admin-toggle-slider" />
                                  </label>
                                </td>
                                <td className="admin-actions">
                                  {editingOptionId === opt.id ? (
                                    <>
                                      <button className="admin-btn-sm admin-btn-save" onClick={() => saveEditOption(opt.id)}>Save</button>
                                      <button className="admin-btn-sm admin-btn-cancel" onClick={() => setEditingOptionId(null)}>Cancel</button>
                                    </>
                                  ) : (
                                    <>
                                      <button className="admin-btn-icon" onClick={() => startEditOption(opt)}>
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                                      </button>
                                      <button className="admin-btn-icon admin-btn-danger" onClick={() => deleteOption(b.id, opt.id)}>
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                                      </button>
                                    </>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        {b.options.length === 0 && <div className="admin-empty">No options configured</div>}
                      </div>
                    </td>
                  </tr>
                )}
              </>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
