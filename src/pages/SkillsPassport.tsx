import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { formatDate, toLocalDateStr } from '../lib/formatters'

interface SkillCategory {
  id: string
  name: string
}

interface Skill {
  id: string
  category_id: string
  name: string
  description: string | null
}

interface EmployeeSkill {
  id: string
  skill_id: string
  proficiency: number
  status: string
  validated_by: string | null
  validated_at: string | null
  notes: string | null
  created_at: string
  skill_name?: string
  category_name?: string
}

interface Certification {
  id: string
  name: string
  issuing_body: string
  issue_date: string
  expiry_date: string | null
  credential_id: string | null
  credential_url: string | null
  status: string
}

interface CareerAspiration {
  id: string
  target_role: string | null
  target_department: string | null
  timeframe: string | null
  notes: string | null
}

interface RoleProfile {
  id: string
  title: string
  department: string | null
  description: string | null
}

const PROFICIENCY_LABELS = ['', 'Foundational', 'Developing', 'Proficient', 'Advanced', 'Expert']
const PROFICIENCY_COLORS = ['', '#6b7280', '#3b82f6', '#8b5cf6', '#f59e0b', '#10b981']
const STATUS_LABELS: Record<string, string> = { self_declared: 'Self-declared', pending_validation: 'Pending', validated: 'Validated', rejected: 'Rejected' }
const STATUS_COLORS: Record<string, string> = { self_declared: '#6b7280', pending_validation: '#f59e0b', validated: '#16a34a', rejected: '#dc2626' }
const TIMEFRAME_LABELS: Record<string, string> = { '6_months': 'Within 6 months', '1_year': 'Within 1 year', '2_years': 'Within 2 years', '3_plus_years': '3+ years' }

type Tab = 'skills' | 'certifications' | 'aspirations' | 'matching'

export default function SkillsPassport() {
  const navigate = useNavigate()
  const { companyUser, employeeId } = useAuth()
  const { showSuccess, showError } = useToast()
  const [tab, setTab] = useState<Tab>('skills')
  const [categories, setCategories] = useState<SkillCategory[]>([])
  const [allSkills, setAllSkills] = useState<Skill[]>([])
  const [mySkills, setMySkills] = useState<EmployeeSkill[]>([])
  const [loading, setLoading] = useState(true)

  const companyId = companyUser?.company_id || ''

  const loadData = useCallback(async () => {
    if (!companyId || !employeeId) return
    setLoading(true)
    const [catRes, skillRes, myRes] = await Promise.all([
      supabase.from('skill_categories').select('id, name').eq('company_id', companyId).order('sort_order, name'),
      supabase.from('skills').select('*').eq('company_id', companyId).eq('is_active', true).order('name'),
      supabase.from('employee_skills').select('*').eq('employee_id', employeeId).eq('company_id', companyId),
    ])
    setCategories(catRes.data || [])
    setAllSkills(skillRes.data || [])

    const skillMap = new Map((skillRes.data || []).map(s => [s.id, s]))
    const catMap = new Map((catRes.data || []).map(c => [c.id, c.name]))
    setMySkills((myRes.data || []).map(es => {
      const skill = skillMap.get(es.skill_id)
      return { ...es, skill_name: skill?.name || 'Unknown', category_name: skill ? catMap.get(skill.category_id) || '' : '' }
    }))
    setLoading(false)
  }, [companyId, employeeId])

  useEffect(() => { loadData() }, [loadData])

  return (
    <div className="feature-page">
      <header className="feature-header">
        <button className="feature-back" onClick={() => navigate('/')}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
        </button>
        <h1 className="feature-title">Skills Passport</h1>
        <button className="feature-refresh" onClick={loadData}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M23 4v6h-6M1 20v-6h6"/>
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
          </svg>
        </button>
      </header>

      <div className="feature-tabs">
        {(['skills', 'certifications', 'aspirations', 'matching'] as Tab[]).map(t => (
          <button key={t} className={`feature-tab ${tab === t ? 'feature-tab-active' : ''}`} onClick={() => setTab(t)}>
            {t === 'skills' ? 'My Skills' : t === 'certifications' ? 'Certifications' : t === 'aspirations' ? 'Career Goals' : 'Role Matching'}
          </button>
        ))}
      </div>

      {loading && <p className="claims-empty">Loading...</p>}

      {!loading && tab === 'skills' && (
        <MySkillsTab
          companyId={companyId}
          employeeId={employeeId || ''}
          categories={categories}
          allSkills={allSkills}
          mySkills={mySkills}
          onRefresh={loadData}
          showSuccess={showSuccess}
          showError={showError}
        />
      )}
      {!loading && tab === 'certifications' && (
        <CertificationsTab companyId={companyId} employeeId={employeeId || ''} showSuccess={showSuccess} showError={showError} />
      )}
      {!loading && tab === 'aspirations' && (
        <AspirationsTab companyId={companyId} employeeId={employeeId || ''} showSuccess={showSuccess} showError={showError} />
      )}
      {!loading && tab === 'matching' && (
        <RoleMatchingTab companyId={companyId} employeeId={employeeId || ''} mySkills={mySkills} />
      )}
    </div>
  )
}

// ─── MY SKILLS TAB ───────────────────────────────────────────────────────────

function MySkillsTab({ companyId, employeeId, categories, allSkills, mySkills, onRefresh, showSuccess, showError }: {
  companyId: string
  employeeId: string
  categories: SkillCategory[]
  allSkills: Skill[]
  mySkills: EmployeeSkill[]
  onRefresh: () => void
  showSuccess: (m: string) => void
  showError: (m: string) => void
}) {
  const [showAdd, setShowAdd] = useState(false)
  const [addSkillId, setAddSkillId] = useState('')
  const [addProficiency, setAddProficiency] = useState(3)
  const [saving, setSaving] = useState(false)

  const existingSkillIds = new Set(mySkills.map(s => s.skill_id))
  const availableSkills = allSkills.filter(s => !existingSkillIds.has(s.id))

  async function addSkill() {
    if (!addSkillId) return
    setSaving(true)
    const { error } = await supabase.from('employee_skills').insert({
      company_id: companyId,
      employee_id: employeeId,
      skill_id: addSkillId,
      proficiency: addProficiency,
      status: 'self_declared',
    })
    setSaving(false)
    if (error) { showError(error.message); return }
    showSuccess('Skill added to your passport')
    setAddSkillId('')
    setAddProficiency(3)
    setShowAdd(false)
    onRefresh()
  }

  async function removeSkill(esId: string) {
    await supabase.from('skill_evidence').delete().eq('employee_skill_id', esId)
    const { error } = await supabase.from('employee_skills').delete().eq('id', esId)
    if (error) { showError(error.message); return }
    showSuccess('Skill removed')
    onRefresh()
  }

  async function requestValidation(es: EmployeeSkill) {
    const { data: emp } = await supabase.from('employees').select('manager_id, first_name, last_name, email').eq('id', employeeId).single()
    if (!emp?.manager_id) { showError('No manager assigned — cannot request validation'); return }
    const { error: esErr } = await supabase.from('employee_skills').update({ status: 'pending_validation' }).eq('id', es.id)
    if (esErr) { showError(esErr.message); return }
    const { error } = await supabase.from('skill_validations').insert({
      company_id: companyId,
      employee_skill_id: es.id,
      requested_by: employeeId,
      assigned_to: emp.manager_id,
    })
    if (error) { showError(error.message); return }

    const { data: mgr } = await supabase.from('employees').select('email').eq('id', emp.manager_id).single()
    if (mgr?.email) {
      await supabase.from('workflow_tracker').insert({
        company_id: companyId,
        emp_display_name: `${emp.first_name} ${emp.last_name}`,
        step: 1,
        status: 'Pending',
        record_type: 'Skill Validation',
        action: `Skill validation requested for ${es.skill_name}`,
        employee_email: emp.email,
        assigned_to: mgr.email,
        task_description: `${emp.first_name} ${emp.last_name} has requested manager validation for the skill "${es.skill_name}".`,
        extra_info: es.id,
      })
      window.dispatchEvent(new Event('notifications-updated'))
    }

    showSuccess('Validation request sent to your manager')
    onRefresh()
  }

  async function updateProficiency(esId: string, proficiency: number) {
    const { error } = await supabase.from('employee_skills').update({ proficiency, updated_at: new Date().toISOString() }).eq('id', esId)
    if (error) { showError(error.message); return }
    onRefresh()
  }

  const grouped = categories
    .map(cat => ({
      ...cat,
      skills: mySkills.filter(s => s.category_name === cat.name),
    }))
    .filter(g => g.skills.length > 0)

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '12px 0' }}>
        <span style={{ fontSize: 14, color: 'var(--text-muted)' }}>{mySkills.length} skill{mySkills.length !== 1 ? 's' : ''} recorded</span>
        <button className="btn btn-primary" onClick={() => setShowAdd(true)} style={{ padding: '8px 16px', borderRadius: 8, fontSize: 14 }}>+ Add Skill</button>
      </div>

      {showAdd && (
        <div className="card" style={{ padding: 16, marginBottom: 16 }}>
          <h3 style={{ marginTop: 0 }}>Add a Skill</h3>
          <div style={{ marginBottom: 12 }}>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 4 }}>Skill</label>
            <select className="form-select" value={addSkillId} onChange={e => setAddSkillId(e.target.value)} style={{ width: '100%', padding: 8, borderRadius: 8, border: '1px solid var(--border)' }}>
              <option value="">Select a skill...</option>
              {categories.map(cat => {
                const catSkills = availableSkills.filter(s => s.category_id === cat.id)
                if (catSkills.length === 0) return null
                return (
                  <optgroup key={cat.id} label={cat.name}>
                    {catSkills.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </optgroup>
                )
              })}
            </select>
          </div>
          <div style={{ marginBottom: 12 }}>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 4 }}>Proficiency Level</label>
            <div style={{ display: 'flex', gap: 6 }}>
              {[1,2,3,4,5].map(n => (
                <button
                  key={n}
                  onClick={() => setAddProficiency(n)}
                  style={{
                    flex: 1, padding: '8px 4px', borderRadius: 8, fontSize: 12, fontWeight: addProficiency === n ? 600 : 400,
                    border: `2px solid ${addProficiency === n ? PROFICIENCY_COLORS[n] : 'var(--border)'}`,
                    background: addProficiency === n ? PROFICIENCY_COLORS[n] + '20' : 'transparent',
                    color: addProficiency === n ? PROFICIENCY_COLORS[n] : 'var(--text-muted)',
                    cursor: 'pointer',
                  }}
                >
                  {PROFICIENCY_LABELS[n]}
                </button>
              ))}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-primary" onClick={addSkill} disabled={saving} style={{ padding: '8px 20px', borderRadius: 8 }}>{saving ? 'Adding...' : 'Add Skill'}</button>
            <button className="btn" onClick={() => setShowAdd(false)} style={{ padding: '8px 20px', borderRadius: 8 }}>Cancel</button>
          </div>
        </div>
      )}

      {mySkills.length === 0 && !showAdd && (
        <div className="card" style={{ padding: 24, textAlign: 'center' }}>
          <p style={{ color: 'var(--text-muted)' }}>You haven't added any skills yet. Start building your skills passport by adding your first skill.</p>
        </div>
      )}

      {grouped.map(group => (
        <div key={group.id} style={{ marginBottom: 16 }}>
          <h3 style={{ fontSize: 14, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '16px 0 8px' }}>{group.name}</h3>
          {group.skills.map(es => (
            <div key={es.id} className="card" style={{ padding: 14, marginBottom: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 8 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600 }}>{es.skill_name}</div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6, flexWrap: 'wrap' }}>
                    <select
                      value={es.proficiency}
                      onChange={e => updateProficiency(es.id, Number(e.target.value))}
                      style={{ padding: '2px 8px', borderRadius: 12, fontSize: 12, border: `1px solid ${PROFICIENCY_COLORS[es.proficiency]}`, color: PROFICIENCY_COLORS[es.proficiency], background: 'transparent', cursor: 'pointer' }}
                    >
                      {[1,2,3,4,5].map(n => <option key={n} value={n}>{PROFICIENCY_LABELS[n]}</option>)}
                    </select>
                    <span style={{ padding: '2px 8px', borderRadius: 12, fontSize: 12, background: STATUS_COLORS[es.status] + '20', color: STATUS_COLORS[es.status] }}>
                      {STATUS_LABELS[es.status]}
                    </span>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  {(es.status === 'self_declared' || es.status === 'rejected') && (
                    <button onClick={() => requestValidation(es)} style={{ padding: '4px 10px', borderRadius: 6, fontSize: 12, border: '1px solid #3b82f6', color: '#3b82f6', background: 'transparent', cursor: 'pointer' }}>
                      Request Validation
                    </button>
                  )}
                  <button onClick={() => removeSkill(es.id)} style={{ padding: '4px 10px', borderRadius: 6, fontSize: 12, border: '1px solid #dc2626', color: '#dc2626', background: 'transparent', cursor: 'pointer' }}>
                    Remove
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

// ─── CERTIFICATIONS TAB ──────────────────────────────────────────────────────

function CertificationsTab({ companyId, employeeId, showSuccess, showError }: {
  companyId: string
  employeeId: string
  showSuccess: (m: string) => void
  showError: (m: string) => void
}) {
  const [certs, setCerts] = useState<Certification[]>([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState({ name: '', issuing_body: '', issue_date: '', expiry_date: '', credential_id: '', credential_url: '' })
  const [saving, setSaving] = useState(false)

  const loadCerts = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase.from('employee_certifications').select('*').eq('employee_id', employeeId).eq('company_id', companyId).order('issue_date', { ascending: false })
    setCerts(data || [])
    setLoading(false)
  }, [companyId, employeeId])

  useEffect(() => { loadCerts() }, [loadCerts])

  async function addCert() {
    if (!form.name.trim() || !form.issuing_body.trim() || !form.issue_date) return
    setSaving(true)
    const today = toLocalDateStr()
    const { error } = await supabase.from('employee_certifications').insert({
      company_id: companyId,
      employee_id: employeeId,
      name: form.name.trim(),
      issuing_body: form.issuing_body.trim(),
      issue_date: form.issue_date,
      expiry_date: form.expiry_date || null,
      credential_id: form.credential_id.trim() || null,
      credential_url: form.credential_url.trim() || null,
      status: form.expiry_date && form.expiry_date < today ? 'expired' : 'active',
    })
    setSaving(false)
    if (error) { showError(error.message); return }
    showSuccess('Certification added')
    setForm({ name: '', issuing_body: '', issue_date: '', expiry_date: '', credential_id: '', credential_url: '' })
    setShowAdd(false)
    loadCerts()
  }

  async function deleteCert(certId: string) {
    const { error } = await supabase.from('employee_certifications').delete().eq('id', certId)
    if (error) { showError(error.message); return }
    showSuccess('Certification removed')
    loadCerts()
  }

  if (loading) return <p className="claims-empty">Loading...</p>

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '12px 0' }}>
        <span style={{ fontSize: 14, color: 'var(--text-muted)' }}>{certs.length} certification{certs.length !== 1 ? 's' : ''}</span>
        <button className="btn btn-primary" onClick={() => setShowAdd(true)} style={{ padding: '8px 16px', borderRadius: 8, fontSize: 14 }}>+ Add Certification</button>
      </div>

      {showAdd && (
        <div className="card" style={{ padding: 16, marginBottom: 16 }}>
          <h3 style={{ marginTop: 0 }}>New Certification</h3>
          <input className="form-input" placeholder="Certification name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} style={{ width: '100%', marginBottom: 8, padding: 8, borderRadius: 8, border: '1px solid var(--border)' }} />
          <input className="form-input" placeholder="Issuing body" value={form.issuing_body} onChange={e => setForm({ ...form, issuing_body: e.target.value })} style={{ width: '100%', marginBottom: 8, padding: 8, borderRadius: 8, border: '1px solid var(--border)' }} />
          <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            <div style={{ flex: 1 }}>
              <label style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>Issue Date</label>
              <input type="date" value={form.issue_date} onChange={e => setForm({ ...form, issue_date: e.target.value })} style={{ width: '100%', padding: 8, borderRadius: 8, border: '1px solid var(--border)' }} />
            </div>
            <div style={{ flex: 1 }}>
              <label style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>Expiry Date (optional)</label>
              <input type="date" value={form.expiry_date} onChange={e => setForm({ ...form, expiry_date: e.target.value })} style={{ width: '100%', padding: 8, borderRadius: 8, border: '1px solid var(--border)' }} />
            </div>
          </div>
          <input className="form-input" placeholder="Credential ID (optional)" value={form.credential_id} onChange={e => setForm({ ...form, credential_id: e.target.value })} style={{ width: '100%', marginBottom: 8, padding: 8, borderRadius: 8, border: '1px solid var(--border)' }} />
          <input className="form-input" placeholder="Credential URL (optional)" value={form.credential_url} onChange={e => setForm({ ...form, credential_url: e.target.value })} style={{ width: '100%', marginBottom: 12, padding: 8, borderRadius: 8, border: '1px solid var(--border)' }} />
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-primary" onClick={addCert} disabled={saving} style={{ padding: '8px 20px', borderRadius: 8 }}>{saving ? 'Saving...' : 'Add'}</button>
            <button className="btn" onClick={() => setShowAdd(false)} style={{ padding: '8px 20px', borderRadius: 8 }}>Cancel</button>
          </div>
        </div>
      )}

      {certs.length === 0 && !showAdd && (
        <div className="card" style={{ padding: 24, textAlign: 'center' }}>
          <p style={{ color: 'var(--text-muted)' }}>No certifications recorded yet.</p>
        </div>
      )}

      {certs.map(cert => (
        <div key={cert.id} className="card" style={{ padding: 14, marginBottom: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={{ fontWeight: 600 }}>{cert.name}</div>
              <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{cert.issuing_body}</div>
              <div style={{ fontSize: 13, marginTop: 4 }}>
                Issued: {formatDate(cert.issue_date)}
                {cert.expiry_date && <span> · Expires: {formatDate(cert.expiry_date)}</span>}
              </div>
              {cert.credential_id && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>ID: {cert.credential_id}</div>}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ padding: '2px 8px', borderRadius: 12, fontSize: 12, background: cert.status === 'active' ? '#dcfce7' : '#fee2e2', color: cert.status === 'active' ? '#16a34a' : '#dc2626' }}>
                {cert.status === 'active' ? 'Active' : cert.status === 'expired' ? 'Expired' : 'Revoked'}
              </span>
              <button onClick={() => deleteCert(cert.id)} style={{ padding: '4px 10px', borderRadius: 6, fontSize: 12, border: '1px solid #dc2626', color: '#dc2626', background: 'transparent', cursor: 'pointer' }}>Remove</button>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

// ─── CAREER ASPIRATIONS TAB ─────────────────────────────────────────────────

function AspirationsTab({ companyId, employeeId, showSuccess, showError }: {
  companyId: string
  employeeId: string
  showSuccess: (m: string) => void
  showError: (m: string) => void
}) {
  const [aspiration, setAspiration] = useState<CareerAspiration | null>(null)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState({ target_role: '', target_department: '', timeframe: '', notes: '' })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    async function load() {
      setLoading(true)
      const { data } = await supabase.from('employee_career_aspirations').select('*').eq('employee_id', employeeId).eq('company_id', companyId).maybeSingle()
      setAspiration(data)
      if (data) setForm({ target_role: data.target_role || '', target_department: data.target_department || '', timeframe: data.timeframe || '', notes: data.notes || '' })
      setLoading(false)
    }
    load()
  }, [companyId, employeeId])

  async function save() {
    setSaving(true)
    const payload = {
      company_id: companyId,
      employee_id: employeeId,
      target_role: form.target_role.trim() || null,
      target_department: form.target_department.trim() || null,
      timeframe: form.timeframe || null,
      notes: form.notes.trim() || null,
      updated_at: new Date().toISOString(),
    }
    let error
    if (aspiration) {
      ({ error } = await supabase.from('employee_career_aspirations').update(payload).eq('id', aspiration.id))
    } else {
      ({ error } = await supabase.from('employee_career_aspirations').insert(payload))
    }
    setSaving(false)
    if (error) { showError(error.message); return }
    showSuccess('Career goals saved')
    setEditing(false)
    const { data } = await supabase.from('employee_career_aspirations').select('*').eq('employee_id', employeeId).eq('company_id', companyId).maybeSingle()
    setAspiration(data)
  }

  if (loading) return <p className="claims-empty">Loading...</p>

  if (!aspiration && !editing) {
    return (
      <div className="card" style={{ padding: 24, textAlign: 'center' }}>
        <p style={{ color: 'var(--text-muted)', marginBottom: 12 }}>You haven't set any career goals yet. Share your aspirations to help your organisation understand your development interests.</p>
        <button className="btn btn-primary" onClick={() => setEditing(true)} style={{ padding: '8px 20px', borderRadius: 8 }}>Set Career Goals</button>
      </div>
    )
  }

  if (editing) {
    return (
      <div className="card" style={{ padding: 16 }}>
        <h3 style={{ marginTop: 0 }}>Career Goals</h3>
        <div style={{ marginBottom: 12 }}>
          <label style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 4 }}>Target Role</label>
          <input value={form.target_role} onChange={e => setForm({ ...form, target_role: e.target.value })} placeholder="e.g. Senior Software Engineer" style={{ width: '100%', padding: 8, borderRadius: 8, border: '1px solid var(--border)' }} />
        </div>
        <div style={{ marginBottom: 12 }}>
          <label style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 4 }}>Target Department</label>
          <input value={form.target_department} onChange={e => setForm({ ...form, target_department: e.target.value })} placeholder="e.g. Engineering" style={{ width: '100%', padding: 8, borderRadius: 8, border: '1px solid var(--border)' }} />
        </div>
        <div style={{ marginBottom: 12 }}>
          <label style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 4 }}>Timeframe</label>
          <select value={form.timeframe} onChange={e => setForm({ ...form, timeframe: e.target.value })} style={{ width: '100%', padding: 8, borderRadius: 8, border: '1px solid var(--border)' }}>
            <option value="">Select timeframe...</option>
            {Object.entries(TIMEFRAME_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div style={{ marginBottom: 12 }}>
          <label style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 4 }}>Notes</label>
          <textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} rows={3} placeholder="Any additional details about your career aspirations..." style={{ width: '100%', padding: 8, borderRadius: 8, border: '1px solid var(--border)' }} />
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-primary" onClick={save} disabled={saving} style={{ padding: '8px 20px', borderRadius: 8 }}>{saving ? 'Saving...' : 'Save'}</button>
          <button className="btn" onClick={() => setEditing(false)} style={{ padding: '8px 20px', borderRadius: 8 }}>Cancel</button>
        </div>
      </div>
    )
  }

  return (
    <div className="card" style={{ padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h3 style={{ margin: 0 }}>Career Goals</h3>
        <button className="btn" onClick={() => setEditing(true)} style={{ padding: '6px 14px', borderRadius: 8, fontSize: 13 }}>Edit</button>
      </div>
      {aspiration?.target_role && (
        <div style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Target Role</div>
          <div style={{ fontWeight: 500 }}>{aspiration.target_role}</div>
        </div>
      )}
      {aspiration?.target_department && (
        <div style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Department</div>
          <div style={{ fontWeight: 500 }}>{aspiration.target_department}</div>
        </div>
      )}
      {aspiration?.timeframe && (
        <div style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Timeframe</div>
          <div style={{ fontWeight: 500 }}>{TIMEFRAME_LABELS[aspiration.timeframe] || aspiration.timeframe}</div>
        </div>
      )}
      {aspiration?.notes && (
        <div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Notes</div>
          <div>{aspiration.notes}</div>
        </div>
      )}
    </div>
  )
}

// ─── ROLE MATCHING TAB ───────────────────────────────────────────────────────

function RoleMatchingTab({ companyId, employeeId, mySkills }: {
  companyId: string
  employeeId: string
  mySkills: EmployeeSkill[]
}) {
  const [roles, setRoles] = useState<(RoleProfile & { match: number; total: number; met: number; gaps: string[] })[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      setLoading(true)
      const [roleRes, reqRes, skillRes] = await Promise.all([
        supabase.from('role_profiles').select('*').eq('company_id', companyId).eq('is_active', true),
        supabase.from('role_skill_requirements').select('*').eq('company_id', companyId),
        supabase.from('skills').select('id, name').eq('company_id', companyId),
      ])

      const skillMap = new Map((skillRes.data || []).map(s => [s.id, s.name]))
      const mySkillMap = new Map(mySkills.map(s => [s.skill_id, s]))

      const results = (roleRes.data || []).map(role => {
        const reqs = (reqRes.data || []).filter(r => r.role_profile_id === role.id)
        if (reqs.length === 0) return { ...role, match: 0, total: 0, met: 0, gaps: [] }

        let met = 0
        const gaps: string[] = []
        reqs.forEach(req => {
          const mySkill = mySkillMap.get(req.skill_id)
          if (mySkill && mySkill.proficiency >= req.min_proficiency) {
            met++
          } else {
            const skillName = skillMap.get(req.skill_id) || 'Unknown'
            const myLevel = mySkill ? PROFICIENCY_LABELS[mySkill.proficiency] : 'Not recorded'
            gaps.push(`${skillName} (need ${PROFICIENCY_LABELS[req.min_proficiency]}, have ${myLevel})`)
          }
        })

        return { ...role, match: Math.round((met / reqs.length) * 100), total: reqs.length, met, gaps }
      }).filter(r => r.total > 0).sort((a, b) => b.match - a.match)

      setRoles(results)
      setLoading(false)
    }
    load()
  }, [companyId, employeeId, mySkills])

  if (loading) return <p className="claims-empty">Loading role matches...</p>

  if (roles.length === 0) {
    return (
      <div className="card" style={{ padding: 24, textAlign: 'center' }}>
        <p style={{ color: 'var(--text-muted)' }}>No role profiles with skill requirements have been defined yet. Check back when your organisation has set up role profiles.</p>
      </div>
    )
  }

  return (
    <div>
      <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '12px 0' }}>
        These scores show how your recorded skills compare to each role's requirements. They are for development planning only and do not represent hiring or promotion decisions.
      </p>
      {roles.map(role => (
        <div key={role.id} className="card" style={{ padding: 14, marginBottom: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <div>
              <div style={{ fontWeight: 600 }}>{role.title}</div>
              {role.department && <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{role.department}</div>}
            </div>
            <div style={{ fontSize: 20, fontWeight: 700, color: role.match >= 80 ? '#16a34a' : role.match >= 50 ? '#f59e0b' : '#dc2626' }}>
              {role.match}%
            </div>
          </div>
          <div style={{ background: 'var(--border)', borderRadius: 4, height: 6, marginBottom: 8 }}>
            <div style={{ background: role.match >= 80 ? '#16a34a' : role.match >= 50 ? '#f59e0b' : '#dc2626', height: '100%', borderRadius: 4, width: `${role.match}%`, transition: 'width 0.3s' }} />
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{role.met} of {role.total} requirements met</div>
          {role.gaps.length > 0 && (
            <details style={{ marginTop: 8, fontSize: 13 }}>
              <summary style={{ cursor: 'pointer', color: 'var(--text-muted)' }}>Skill gaps ({role.gaps.length})</summary>
              <ul style={{ margin: '4px 0 0', paddingLeft: 20 }}>
                {role.gaps.map((g, i) => <li key={i}>{g}</li>)}
              </ul>
            </details>
          )}
        </div>
      ))}
    </div>
  )
}
