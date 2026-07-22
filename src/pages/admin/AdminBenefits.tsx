import { useState, useEffect } from 'react'

const ADMIN_BENEFITS_KEY = 'inflowhr-admin-benefits'

interface BenefitOption {
  id: string
  icon: string
  title: string
  description: string
  enabled: boolean
}

interface BenefitType {
  id: string
  title: string
  description: string
  icon: string
  color: string
  intro: string
  eligibility: string
  cost: string
  monthlyCost: number
  lockPeriod: 'none' | 'month' | 'year'
  enabled: boolean
  options: BenefitOption[]
}

const DEFAULT_BENEFITS: BenefitType[] = [
  {
    id: 'vacation', title: 'Vacation / Salary Sacrifice', description: 'Flexible leave options and salary sacrifice schemes',
    icon: '📦', color: '#7b1fa2', intro: 'Take control of your work-life balance with our flexible vacation and salary sacrifice options.',
    eligibility: 'Available to all permanent employees who have completed their probation period (typically 6 months).', cost: 'Costs vary by option — see individual items below.',
    monthlyCost: 0, lockPeriod: 'none',
    enabled: true,
    options: [
      { id: 'buy_leave', icon: '🛒', title: 'Buy Additional Leave', description: 'Purchase up to 5 extra days annual leave per year via salary sacrifice', enabled: true },
      { id: 'sell_leave', icon: '💷', title: 'Sell Leave', description: 'Sell up to 3 days unused annual leave back for extra pay', enabled: true },
      { id: 'carry_over', icon: '📦', title: 'Carry Over', description: 'Carry up to 5 unused days into the next holiday year', enabled: true },
      { id: 'sabbatical', icon: '🌍', title: 'Sabbatical Programme', description: 'Apply for 1–3 months unpaid sabbatical after 3 years service', enabled: true },
      { id: 'compressed_hours', icon: '⏰', title: 'Compressed Hours', description: 'Work your weekly hours across 4 days instead of 5', enabled: true },
    ],
  },
  {
    id: 'health', title: 'Health Insurance', description: 'Comprehensive private medical cover for you and your family',
    icon: '🏥', color: '#e53935', intro: 'Comprehensive private medical insurance provided through our partnership with leading UK health insurers.',
    eligibility: 'Available to all permanent employees from day one. Family cover available after probation.', cost: 'Employer-funded for individual cover. Family add-on: £45/month via salary sacrifice.',
    monthlyCost: 45, lockPeriod: 'year',
    enabled: true,
    options: [
      { id: 'hospital', icon: '🏥', title: 'Private Hospital Treatment', description: 'Access to private hospitals and specialists with no NHS waiting lists', enabled: true },
      { id: 'gp', icon: '👨‍⚕️', title: '24/7 GP Access', description: 'Round-the-clock access to a GP via phone or video consultation', enabled: true },
      { id: 'dental', icon: '🦷', title: 'Dental Cover', description: 'Routine and emergency dental treatment covered', enabled: true },
      { id: 'optical', icon: '👁️', title: 'Optical Cover', description: 'Eye tests and contribution towards glasses or contact lenses', enabled: true },
      { id: 'prescriptions', icon: '💊', title: 'Prescription Cover', description: 'Outpatient prescription costs fully covered', enabled: true },
      { id: 'wellness', icon: '🏆', title: 'Wellness Programme', description: 'Access to gym discounts, mental health support and wellbeing resources', enabled: true },
      { id: 'family', icon: '👨‍👩‍👧', title: 'Family Cover', description: 'Extend cover to partner and dependants at reduced rates', enabled: true },
    ],
  },
  {
    id: 'car', title: 'Car Insurance', description: 'Discounted group car insurance through salary sacrifice',
    icon: '🚗', color: '#1565c0', intro: 'Take advantage of our corporate group car insurance scheme offering competitive rates and comprehensive cover.',
    eligibility: 'Available to all permanent employees after 3 months of service. Must hold a valid UK driving licence.', cost: 'From £35/month via salary sacrifice — exact rate based on vehicle and driving history.',
    monthlyCost: 35, lockPeriod: 'year',
    enabled: true,
    options: [
      { id: 'comprehensive', icon: '🚗', title: 'Fully Comprehensive Cover', description: 'Full cover for damage, theft, third party and fire', enabled: true },
      { id: 'breakdown', icon: '🛡️', title: 'Breakdown Assistance', description: 'Roadside recovery and home start included as standard', enabled: true },
      { id: 'windscreen', icon: '🔧', title: 'Windscreen & Glass', description: 'Windscreen repair and replacement without affecting no-claims', enabled: true },
      { id: 'discount', icon: '💰', title: 'Group Discount Rate', description: 'Up to 20% discount vs individual policies through group scheme', enabled: true },
      { id: 'legal', icon: '⚖️', title: 'Legal Expenses Cover', description: 'Motor legal protection up to £100,000 included', enabled: true },
      { id: 'courtesy', icon: '🚙', title: 'Courtesy Car', description: 'Replacement vehicle provided while yours is being repaired', enabled: true },
    ],
  },
  {
    id: 'cycle', title: 'Cycle to Work Scheme', description: 'Save on a new bike and accessories through salary sacrifice',
    icon: '🚲', color: '#43a047', intro: 'Save up to 42% on a new bicycle and cycling accessories through the government-backed Cycle to Work scheme.',
    eligibility: 'Open to all employees on PAYE. You must use the bike primarily for commuting to work.', cost: 'Tax-free salary sacrifice over 12 months. Typical saving: 32–42% vs retail.',
    monthlyCost: 48, lockPeriod: 'month',
    enabled: true,
    options: [
      { id: 'bike', icon: '🚲', title: 'Bicycle Purchase', description: 'Any bike up to £1,000 (standard) or £5,000 (enhanced scheme)', enabled: true },
      { id: 'tax_free', icon: '💷', title: 'Tax-Free Saving', description: 'Save on Income Tax and National Insurance contributions', enabled: true },
      { id: 'green', icon: '🌱', title: 'Eco-Friendly Commute', description: 'Reduce your carbon footprint and improve your health', enabled: true },
      { id: 'accessories', icon: '🔄', title: 'Accessories Included', description: 'Helmets, locks, lights, panniers and clothing can be included', enabled: true },
      { id: 'insurance', icon: '🛡️', title: 'Cycle Insurance', description: 'Theft and damage cover available as an add-on', enabled: true },
      { id: 'maintenance', icon: '📋', title: 'Servicing Package', description: 'Optional annual service plan included in salary sacrifice', enabled: true },
    ],
  },
]

function loadBenefits(): BenefitType[] {
  try {
    const raw = localStorage.getItem(ADMIN_BENEFITS_KEY)
    if (!raw) return DEFAULT_BENEFITS
    const stored: BenefitType[] = JSON.parse(raw)
    return stored.map(b => {
      const def = DEFAULT_BENEFITS.find(d => d.id === b.id)
      return {
        ...b,
        monthlyCost: b.monthlyCost ?? def?.monthlyCost ?? 0,
        lockPeriod: b.lockPeriod ?? def?.lockPeriod ?? 'none',
      }
    })
  } catch { return DEFAULT_BENEFITS }
}

function saveBenefits(benefits: BenefitType[]) {
  localStorage.setItem(ADMIN_BENEFITS_KEY, JSON.stringify(benefits))
}

export default function AdminBenefits() {
  const [benefits, setBenefits] = useState<BenefitType[]>(loadBenefits)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<Record<string, any>>({})
  const [editingOptionId, setEditingOptionId] = useState<string | null>(null)
  const [optionForm, setOptionForm] = useState<Record<string, any>>({})
  const [showNewBenefit, setShowNewBenefit] = useState(false)
  const [newBenefit, setNewBenefit] = useState({ title: '', description: '', icon: '🎁', color: '#4f46e5', intro: '', eligibility: '', cost: '£0', monthlyCost: 0, lockPeriod: 'none' as 'none' | 'month' | 'year' })
  const [showNewOption, setShowNewOption] = useState<string | null>(null)
  const [newOption, setNewOption] = useState({ icon: '✨', title: '', description: '' })

  useEffect(() => { saveBenefits(benefits) }, [benefits])

  function toggleBenefitEnabled(id: string) {
    setBenefits(prev => prev.map(b => b.id === id ? { ...b, enabled: !b.enabled } : b))
  }

  function toggleOptionEnabled(benefitId: string, optionId: string) {
    setBenefits(prev => prev.map(b => b.id === benefitId ? {
      ...b, options: b.options.map(o => o.id === optionId ? { ...o, enabled: !o.enabled } : o)
    } : b))
  }

  function startEditBenefit(b: BenefitType) {
    setEditingId(b.id)
    setEditForm({ title: b.title, description: b.description, icon: b.icon, color: b.color, intro: b.intro, eligibility: b.eligibility, cost: b.cost, monthlyCost: b.monthlyCost ?? 0, lockPeriod: b.lockPeriod ?? 'none' })
  }

  function saveEditBenefit(id: string) {
    setBenefits(prev => prev.map(b => b.id === id ? { ...b, ...editForm } : b))
    setEditingId(null)
  }

  function deleteBenefit(id: string) {
    if (!confirm('Delete this benefit type and all its options?')) return
    setBenefits(prev => prev.filter(b => b.id !== id))
    if (expandedId === id) setExpandedId(null)
  }

  function startEditOption(opt: BenefitOption) {
    setEditingOptionId(opt.id)
    setOptionForm({ icon: opt.icon, title: opt.title, description: opt.description })
  }

  function saveEditOption(benefitId: string, optionId: string) {
    setBenefits(prev => prev.map(b => b.id === benefitId ? {
      ...b, options: b.options.map(o => o.id === optionId ? { ...o, ...optionForm } : o)
    } : b))
    setEditingOptionId(null)
  }

  function deleteOption(benefitId: string, optionId: string) {
    if (!confirm('Delete this option?')) return
    setBenefits(prev => prev.map(b => b.id === benefitId ? {
      ...b, options: b.options.filter(o => o.id !== optionId)
    } : b))
  }

  function addNewBenefit() {
    if (!newBenefit.title) return
    const id = newBenefit.title.toLowerCase().replace(/[^a-z0-9]+/g, '_')
    setBenefits(prev => [...prev, { ...newBenefit, id, enabled: true, options: [] }])
    setNewBenefit({ title: '', description: '', icon: '🎁', color: '#4f46e5', intro: '', eligibility: '', cost: '£0', monthlyCost: 0, lockPeriod: 'none' })
    setShowNewBenefit(false)
  }

  function addNewOption(benefitId: string) {
    if (!newOption.title) return
    const id = newOption.title.toLowerCase().replace(/[^a-z0-9]+/g, '_')
    setBenefits(prev => prev.map(b => b.id === benefitId ? {
      ...b, options: [...b.options, { ...newOption, id, enabled: true }]
    } : b))
    setNewOption({ icon: '✨', title: '', description: '' })
    setShowNewOption(null)
  }

  return (
    <div className="admin-section">
      <div className="admin-page-header">
        <h2>Benefits Management</h2>
        <p>{benefits.length} benefit types · {benefits.reduce((s, b) => s + b.options.length, 0)} options</p>
      </div>

      <div className="admin-mini-stats">
        <div className="admin-mini-stat"><span className="admin-mini-value">{benefits.length}</span><span>Types</span></div>
        <div className="admin-mini-stat"><span className="admin-mini-value" style={{color:'#43a047'}}>{benefits.filter(b => b.enabled).length}</span><span>Active</span></div>
        <div className="admin-mini-stat"><span className="admin-mini-value" style={{color:'#e53935'}}>{benefits.filter(b => !b.enabled).length}</span><span>Disabled</span></div>
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
            <div className="admin-form-field"><label>Cost Description</label><input className="admin-input" value={newBenefit.cost} onChange={e => setNewBenefit(p => ({...p, cost: e.target.value}))} /></div>
            <div className="admin-form-field"><label>Monthly Cost (£)</label><input type="number" min="0" step="0.01" className="admin-input" value={newBenefit.monthlyCost} onChange={e => setNewBenefit(p => ({...p, monthlyCost: parseFloat(e.target.value) || 0}))} /></div>
            <div className="admin-form-field"><label>Lock Period</label>
              <select className="admin-input" value={newBenefit.lockPeriod} onChange={e => setNewBenefit(p => ({...p, lockPeriod: e.target.value as 'none' | 'month' | 'year'}))}>
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
                  <td>{b.options.length} ({b.options.filter(o => o.enabled).length} active)</td>
                  <td>
                    <label className="admin-toggle">
                      <input type="checkbox" checked={b.enabled} onChange={() => toggleBenefitEnabled(b.id)} />
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
                        {editingId === b.id && (
                          <div className="admin-benefit-edit-extras">
                            <div className="admin-form-grid">
                              <div className="admin-form-field"><label>Icon</label><input className="admin-input" value={editForm.icon} onChange={e => setEditForm(f => ({...f, icon: e.target.value}))} /></div>
                              <div className="admin-form-field"><label>Colour</label><input type="color" className="admin-input" value={editForm.color} onChange={e => setEditForm(f => ({...f, color: e.target.value}))} style={{height:'40px',padding:'2px'}} /></div>
                              <div className="admin-form-field" style={{gridColumn:'1/-1'}}><label>Introduction</label><textarea className="admin-input" rows={2} value={editForm.intro} onChange={e => setEditForm(f => ({...f, intro: e.target.value}))} /></div>
                              <div className="admin-form-field"><label>Eligibility</label><input className="admin-input" value={editForm.eligibility} onChange={e => setEditForm(f => ({...f, eligibility: e.target.value}))} /></div>
                              <div className="admin-form-field"><label>Cost Description</label><input className="admin-input" value={editForm.cost} onChange={e => setEditForm(f => ({...f, cost: e.target.value}))} /></div>
                              <div className="admin-form-field"><label>Monthly Cost (£)</label><input type="number" min="0" step="0.01" className="admin-input" value={editForm.monthlyCost ?? 0} onChange={e => setEditForm(f => ({...f, monthlyCost: parseFloat(e.target.value) || 0}))} /></div>
                              <div className="admin-form-field"><label>Lock Period</label>
                                <select className="admin-input" value={editForm.lockPeriod ?? 'none'} onChange={e => setEditForm(f => ({...f, lockPeriod: e.target.value}))}>
                                  <option value="none">None</option>
                                  <option value="month">Monthly (until end of month)</option>
                                  <option value="year">Yearly (until end of financial year)</option>
                                </select>
                              </div>
                            </div>
                          </div>
                        )}

                        <div className="admin-benefit-meta">
                          <div><strong>Eligibility:</strong> {b.eligibility}</div>
                          <div><strong>Cost:</strong> {b.cost}</div>
                          <div><strong>Monthly Cost:</strong> £{(b.monthlyCost ?? 0).toFixed(2)}</div>
                          <div><strong>Lock Period:</strong> {(b.lockPeriod ?? 'none') === 'none' ? 'None' : b.lockPeriod === 'month' ? 'Monthly' : 'Financial Year'}</div>
                        </div>

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
                              <tr key={opt.id} style={{opacity: opt.enabled ? 1 : 0.5}}>
                                <td><span style={{fontSize:'16px'}}>{editingOptionId === opt.id ? <input className="admin-inline-input" value={optionForm.icon} onChange={e => setOptionForm(f => ({...f, icon: e.target.value}))} style={{width:'40px',textAlign:'center'}} /> : opt.icon}</span></td>
                                <td>{editingOptionId === opt.id ? <input className="admin-inline-input" value={optionForm.title} onChange={e => setOptionForm(f => ({...f, title: e.target.value}))} /> : opt.title}</td>
                                <td>{editingOptionId === opt.id ? <input className="admin-inline-input" value={optionForm.description} onChange={e => setOptionForm(f => ({...f, description: e.target.value}))} /> : opt.description}</td>
                                <td>
                                  <label className="admin-toggle">
                                    <input type="checkbox" checked={opt.enabled} onChange={() => toggleOptionEnabled(b.id, opt.id)} />
                                    <span className="admin-toggle-slider" />
                                  </label>
                                </td>
                                <td className="admin-actions">
                                  {editingOptionId === opt.id ? (
                                    <>
                                      <button className="admin-btn-sm admin-btn-save" onClick={() => saveEditOption(b.id, opt.id)}>Save</button>
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
