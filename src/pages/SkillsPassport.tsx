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
const STATUS_BADGE_CLASS: Record<string, string> = { self_declared: 'sp-badge-self', pending_validation: 'sp-badge-pending', validated: 'sp-badge-validated', rejected: 'sp-badge-rejected' }
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

  const validatedCount = mySkills.filter(s => s.status === 'validated').length
  const pendingCount = mySkills.filter(s => s.status === 'pending_validation').length

  return (
    <div className="sp-page">
      <header className="sp-header">
        <button className="sp-header-back" onClick={() => navigate('/')}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
        </button>
        <h1 className="sp-header-title">Skills Passport</h1>
        <button className="sp-header-refresh" onClick={loadData}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M23 4v6h-6M1 20v-6h6"/>
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
          </svg>
        </button>
      </header>

      {!loading && tab === 'skills' && (
        <div className="sp-summary">
          <div className="sp-stat">
            <div className="sp-stat-value">{mySkills.length}</div>
            <div className="sp-stat-label">Total Skills</div>
          </div>
          <div className="sp-stat">
            <div className="sp-stat-value" style={{ color: '#16a34a' }}>{validatedCount}</div>
            <div className="sp-stat-label">Validated</div>
          </div>
          <div className="sp-stat">
            <div className="sp-stat-value" style={{ color: '#f59e0b' }}>{pendingCount}</div>
            <div className="sp-stat-label">Pending</div>
          </div>
        </div>
      )}

      <div className="sp-tabs">
        {(['skills', 'certifications', 'aspirations', 'matching'] as Tab[]).map(t => (
          <button key={t} className={`sp-tab ${tab === t ? 'sp-tab-active' : ''}`} onClick={() => setTab(t)}>
            {t === 'skills' ? 'My Skills' : t === 'certifications' ? 'Certs' : t === 'aspirations' ? 'Goals' : 'Matching'}
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

function ProficiencyBar({ level }: { level: number }) {
  return (
    <div className="sp-proficiency-bar" title={PROFICIENCY_LABELS[level]}>
      {[1,2,3,4,5].map(n => (
        <div
          key={n}
          className="sp-proficiency-seg"
          style={{ background: n <= level ? PROFICIENCY_COLORS[level] : undefined }}
        />
      ))}
      <span style={{ fontSize: 11, fontWeight: 600, marginLeft: 4, color: PROFICIENCY_COLORS[level] }}>
        {PROFICIENCY_LABELS[level]}
      </span>
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
    const { data: empCheck } = await supabase.from('employees').select('is_active').eq('id', employeeId).single()
    if (!empCheck?.is_active) { alert('Your account is inactive — adding skills is disabled'); return }
    setSaving(true)

    const { data: emp } = await supabase.from('employees').select('manager_id, first_name, last_name, email').eq('id', employeeId).single()
    let hasManager = !!emp?.manager_id
    if (hasManager && emp?.manager_id) {
      const { data: mgrCheck } = await supabase.from('employees').select('id').eq('id', emp.manager_id).maybeSingle()
      if (!mgrCheck) hasManager = false
    }

    const now = new Date().toISOString()
    const insertPayload: Record<string, unknown> = {
      company_id: companyId,
      employee_id: employeeId,
      skill_id: addSkillId,
      proficiency: addProficiency,
      status: hasManager ? 'self_declared' : 'validated',
    }
    if (!hasManager) {
      insertPayload.validated_by = employeeId
      insertPayload.validated_at = now
    }

    const { data: inserted, error } = await supabase.from('employee_skills').insert(insertPayload).select('id, status').single()
    if (error) { setSaving(false); showError(error.message); return }

    if (!hasManager && inserted && inserted.status !== 'validated') {
      const { error: updErr } = await supabase.from('employee_skills').update({
        status: 'validated',
        validated_by: employeeId,
        validated_at: now,
      }).eq('id', inserted.id)
      if (updErr) { setSaving(false); showError('Skill added but self-validation failed: ' + updErr.message); onRefresh(); return }
    }

    if (!hasManager && emp) {
      const skill = allSkills.find(s => s.id === addSkillId)
      await supabase.from('workflow_tracker').insert({
        company_id: companyId,
        emp_display_name: `${emp.first_name} ${emp.last_name}`,
        step: 1,
        status: 'Completed',
        record_type: 'Skill Validation',
        action: `Skill self-validated for ${skill?.name || 'Unknown'} (no manager assigned)`,
        employee_email: emp.email,
        assigned_to: emp.email,
        task_description: `${emp.first_name} ${emp.last_name} self-validated the skill "${skill?.name || 'Unknown'}" — no manager assigned for review.`,
      })
    }

    setSaving(false)
    const { data: verify } = await supabase.from('employee_skills').select('status').eq('id', inserted.id).single()
    const finalStatus = verify?.status || inserted.status
    if (!hasManager && finalStatus !== 'validated') {
      showError(`Self-validation failed — status is "${finalStatus}" (manager_id: ${emp?.manager_id || 'null'}, hasManager: ${hasManager})`)
      onRefresh()
      return
    }
    showSuccess(hasManager ? 'Skill added to your passport' : 'Skill added and self-validated — no manager assigned')
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
    if (!emp) { showError('Employee record not found'); return }
    let mgrValid = !!emp.manager_id
    if (mgrValid) {
      const { data: mgrCheck } = await supabase.from('employees').select('id').eq('id', emp.manager_id!).maybeSingle()
      if (!mgrCheck) mgrValid = false
    }
    if (!mgrValid) {
      const { error } = await supabase.from('employee_skills').update({ status: 'validated', validated_at: new Date().toISOString(), validated_by: employeeId }).eq('id', es.id)
      if (error) { showError(error.message); return }
      await supabase.from('workflow_tracker').insert({
        company_id: companyId,
        emp_display_name: `${emp.first_name} ${emp.last_name}`,
        step: 1,
        status: 'Completed',
        record_type: 'Skill Validation',
        action: `Skill self-validated for ${es.skill_name} (no manager assigned)`,
        employee_email: emp.email,
        assigned_to: emp.email,
        task_description: `${emp.first_name} ${emp.last_name} self-validated the skill "${es.skill_name}" — no manager assigned for review.`,
        extra_info: es.id,
      })
      showSuccess('Skill self-validated — no manager assigned')
      onRefresh()
      return
    }
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
      <div className="sp-section-bar">
        <span className="sp-section-count">{mySkills.length} skill{mySkills.length !== 1 ? 's' : ''} recorded</span>
        <button className="sp-add-btn" onClick={() => setShowAdd(true)}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 5v14M5 12h14"/></svg>
          Add Skill
        </button>
      </div>

      {showAdd && (
        <div className="sp-form">
          <div className="sp-form-title">Add a Skill</div>
          <div className="sp-form-field">
            <label className="sp-form-label">Skill</label>
            <select className="sp-form-input" value={addSkillId} onChange={e => setAddSkillId(e.target.value)}>
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
          <div className="sp-form-field">
            <label className="sp-form-label">Proficiency Level</label>
            <div className="sp-proficiency-picker">
              {[1,2,3,4,5].map(n => (
                <button
                  key={n}
                  className="sp-proficiency-opt"
                  onClick={() => setAddProficiency(n)}
                  style={{
                    borderColor: addProficiency === n ? PROFICIENCY_COLORS[n] : undefined,
                    background: addProficiency === n ? PROFICIENCY_COLORS[n] + '18' : undefined,
                    color: addProficiency === n ? PROFICIENCY_COLORS[n] : undefined,
                    fontWeight: addProficiency === n ? 600 : undefined,
                  }}
                >
                  {PROFICIENCY_LABELS[n]}
                </button>
              ))}
            </div>
          </div>
          <div className="sp-form-actions">
            <button className="sp-btn-submit" onClick={addSkill} disabled={saving}>{saving ? 'Adding...' : 'Add Skill'}</button>
            <button className="sp-btn-cancel" onClick={() => setShowAdd(false)}>Cancel</button>
          </div>
        </div>
      )}

      {mySkills.length === 0 && !showAdd && (
        <div className="sp-empty">
          <div className="sp-empty-icon">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#0891b2" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>
            </svg>
          </div>
          <p className="sp-empty-text">You haven't added any skills yet. Start building your skills passport by adding your first skill.</p>
          <button className="sp-add-btn" onClick={() => setShowAdd(true)}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 5v14M5 12h14"/></svg>
            Add Your First Skill
          </button>
        </div>
      )}

      {grouped.map(group => (
        <div key={group.id}>
          <div className="sp-category-label">{group.name}</div>
          {group.skills.map(es => (
            <div key={es.id} className="sp-card">
              <div className="sp-card-top">
                <div className="sp-card-info">
                  <div className="sp-card-name">{es.skill_name}</div>
                  <div className="sp-card-meta">
                    <select
                      className="sp-proficiency-select"
                      value={es.proficiency}
                      onChange={e => updateProficiency(es.id, Number(e.target.value))}
                      style={{ color: PROFICIENCY_COLORS[es.proficiency], borderColor: PROFICIENCY_COLORS[es.proficiency] + '60' }}
                    >
                      {[1,2,3,4,5].map(n => <option key={n} value={n}>{PROFICIENCY_LABELS[n]}</option>)}
                    </select>
                    <span className={`sp-badge ${STATUS_BADGE_CLASS[es.status] || 'sp-badge-self'}`}>
                      {STATUS_LABELS[es.status]}
                    </span>
                  </div>
                  <ProficiencyBar level={es.proficiency} />
                </div>
                <div className="sp-card-actions">
                  {(es.status === 'self_declared' || es.status === 'rejected') && (
                    <button className="sp-btn-validate" onClick={() => requestValidation(es)}>Validate</button>
                  )}
                  <button className="sp-btn-remove" onClick={() => removeSkill(es.id)}>Remove</button>
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
      <div className="sp-section-bar">
        <span className="sp-section-count">{certs.length} certification{certs.length !== 1 ? 's' : ''}</span>
        <button className="sp-add-btn" onClick={() => setShowAdd(true)}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 5v14M5 12h14"/></svg>
          Add Certification
        </button>
      </div>

      {showAdd && (
        <div className="sp-form">
          <div className="sp-form-title">New Certification</div>
          <div className="sp-form-field">
            <label className="sp-form-label">Certification Name</label>
            <input className="sp-form-input" placeholder="e.g. CIPD Level 5" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
          </div>
          <div className="sp-form-field">
            <label className="sp-form-label">Issuing Body</label>
            <input className="sp-form-input" placeholder="e.g. CIPD" value={form.issuing_body} onChange={e => setForm({ ...form, issuing_body: e.target.value })} />
          </div>
          <div className="sp-form-row">
            <div className="sp-form-field">
              <label className="sp-form-label">Issue Date</label>
              <input type="date" className="sp-form-input" value={form.issue_date} onChange={e => setForm({ ...form, issue_date: e.target.value })} />
            </div>
            <div className="sp-form-field">
              <label className="sp-form-label">Expiry Date</label>
              <input type="date" className="sp-form-input" value={form.expiry_date} onChange={e => setForm({ ...form, expiry_date: e.target.value })} />
            </div>
          </div>
          <div className="sp-form-field">
            <label className="sp-form-label">Credential ID (optional)</label>
            <input className="sp-form-input" placeholder="e.g. ABC-12345" value={form.credential_id} onChange={e => setForm({ ...form, credential_id: e.target.value })} />
          </div>
          <div className="sp-form-field">
            <label className="sp-form-label">Credential URL (optional)</label>
            <input className="sp-form-input" placeholder="https://..." value={form.credential_url} onChange={e => setForm({ ...form, credential_url: e.target.value })} />
          </div>
          <div className="sp-form-actions">
            <button className="sp-btn-submit" onClick={addCert} disabled={saving}>{saving ? 'Saving...' : 'Add'}</button>
            <button className="sp-btn-cancel" onClick={() => setShowAdd(false)}>Cancel</button>
          </div>
        </div>
      )}

      {certs.length === 0 && !showAdd && (
        <div className="sp-empty">
          <div className="sp-empty-icon">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#0891b2" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="8" r="6"/><path d="M15.477 12.89L17 22l-5-3-5 3 1.523-9.11"/>
            </svg>
          </div>
          <p className="sp-empty-text">No certifications recorded yet. Add your professional qualifications and certificates.</p>
          <button className="sp-add-btn" onClick={() => setShowAdd(true)}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 5v14M5 12h14"/></svg>
            Add Certification
          </button>
        </div>
      )}

      {certs.map(cert => (
        <div key={cert.id} className="sp-cert-card">
          <div className="sp-cert-header">
            <div>
              <div className="sp-cert-name">{cert.name}</div>
              <div className="sp-cert-issuer">{cert.issuing_body}</div>
              <div className="sp-cert-dates">
                Issued: {formatDate(cert.issue_date)}
                {cert.expiry_date && <span> &middot; Expires: {formatDate(cert.expiry_date)}</span>}
              </div>
              {cert.credential_id && <div className="sp-cert-id">ID: {cert.credential_id}</div>}
            </div>
            <div className="sp-cert-actions">
              <span className={`sp-badge ${cert.status === 'active' ? 'sp-badge-active' : cert.status === 'expired' ? 'sp-badge-expired' : 'sp-badge-revoked'}`}>
                {cert.status === 'active' ? 'Active' : cert.status === 'expired' ? 'Expired' : 'Revoked'}
              </span>
              <button className="sp-btn-remove" style={{ padding: '5px 12px', borderRadius: 8, fontSize: 12, border: '1px solid transparent', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer' }} onClick={() => deleteCert(cert.id)}>Remove</button>
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
      <div className="sp-empty">
        <div className="sp-empty-icon">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#0891b2" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>
          </svg>
        </div>
        <p className="sp-empty-text">You haven't set any career goals yet. Share your aspirations to help your organisation understand your development interests.</p>
        <button className="sp-add-btn" onClick={() => setEditing(true)}>Set Career Goals</button>
      </div>
    )
  }

  if (editing) {
    return (
      <div className="sp-form">
        <div className="sp-form-title">Career Goals</div>
        <div className="sp-form-field">
          <label className="sp-form-label">Target Role</label>
          <input className="sp-form-input" value={form.target_role} onChange={e => setForm({ ...form, target_role: e.target.value })} placeholder="e.g. Senior Software Engineer" />
        </div>
        <div className="sp-form-field">
          <label className="sp-form-label">Target Department</label>
          <input className="sp-form-input" value={form.target_department} onChange={e => setForm({ ...form, target_department: e.target.value })} placeholder="e.g. Engineering" />
        </div>
        <div className="sp-form-field">
          <label className="sp-form-label">Timeframe</label>
          <select className="sp-form-input" value={form.timeframe} onChange={e => setForm({ ...form, timeframe: e.target.value })}>
            <option value="">Select timeframe...</option>
            {Object.entries(TIMEFRAME_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div className="sp-form-field">
          <label className="sp-form-label">Notes</label>
          <textarea className="sp-form-input" value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} rows={3} placeholder="Any additional details about your career aspirations..." style={{ resize: 'vertical' }} />
        </div>
        <div className="sp-form-actions">
          <button className="sp-btn-submit" onClick={save} disabled={saving}>{saving ? 'Saving...' : 'Save'}</button>
          <button className="sp-btn-cancel" onClick={() => setEditing(false)}>Cancel</button>
        </div>
      </div>
    )
  }

  return (
    <div className="sp-goals-card">
      <div className="sp-goals-header">
        <div className="sp-goals-title">Career Goals</div>
        <button className="sp-goals-edit" onClick={() => setEditing(true)}>Edit</button>
      </div>
      {aspiration?.target_role && (
        <div className="sp-goals-field">
          <div className="sp-goals-label">Target Role</div>
          <div className="sp-goals-value">{aspiration.target_role}</div>
        </div>
      )}
      {aspiration?.target_department && (
        <div className="sp-goals-field">
          <div className="sp-goals-label">Department</div>
          <div className="sp-goals-value">{aspiration.target_department}</div>
        </div>
      )}
      {aspiration?.timeframe && (
        <div className="sp-goals-field">
          <div className="sp-goals-label">Timeframe</div>
          <div className="sp-goals-value">{TIMEFRAME_LABELS[aspiration.timeframe] || aspiration.timeframe}</div>
        </div>
      )}
      {aspiration?.notes && (
        <div className="sp-goals-field">
          <div className="sp-goals-label">Notes</div>
          <div className="sp-goals-value" style={{ fontWeight: 400 }}>{aspiration.notes}</div>
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
      <div className="sp-empty">
        <div className="sp-empty-icon">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#0891b2" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="7" width="20" height="14" rx="2" ry="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>
          </svg>
        </div>
        <p className="sp-empty-text">No role profiles with skill requirements have been defined yet. Check back when your organisation has set up role profiles.</p>
      </div>
    )
  }

  const matchColor = (pct: number) => pct >= 80 ? '#16a34a' : pct >= 50 ? '#f59e0b' : '#dc2626'

  return (
    <div>
      <p className="sp-match-note">
        These scores show how your recorded skills compare to each role's requirements. They are for development planning only and do not represent hiring or promotion decisions.
      </p>
      {roles.map(role => (
        <div key={role.id} className="sp-match-card">
          <div className="sp-match-top">
            <div>
              <div className="sp-match-role">{role.title}</div>
              {role.department && <div className="sp-match-dept">{role.department}</div>}
            </div>
            <div className="sp-match-pct" style={{ color: matchColor(role.match) }}>
              {role.match}%
            </div>
          </div>
          <div className="sp-match-bar">
            <div className="sp-match-fill" style={{ width: `${role.match}%`, background: matchColor(role.match) }} />
          </div>
          <div className="sp-match-reqs">{role.met} of {role.total} requirements met</div>
          {role.gaps.length > 0 && (
            <details className="sp-match-gaps">
              <summary>Skill gaps ({role.gaps.length})</summary>
              <ul>
                {role.gaps.map((g, i) => <li key={i}>{g}</li>)}
              </ul>
            </details>
          )}
        </div>
      ))}
    </div>
  )
}
