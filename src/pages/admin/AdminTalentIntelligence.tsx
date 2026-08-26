import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { useAdminCompany } from '../../context/AdminCompanyContext'
import { useToast } from '../../context/ToastContext'
import { formatDate } from '../../lib/formatters'

interface SkillCategory {
  id: string
  name: string
  description: string | null
  is_system: boolean
  sort_order: number
}

interface Skill {
  id: string
  category_id: string
  name: string
  description: string | null
  is_system: boolean
  is_active: boolean
}

interface ValidationRequest {
  id: string
  employee_skill_id: string
  requested_by: string
  assigned_to: string
  status: string
  response_note: string | null
  created_at: string
  responded_at: string | null
  requester_name?: string
  skill_name?: string
  proficiency?: number
}

interface RoleProfile {
  id: string
  title: string
  department: string | null
  description: string | null
  is_active: boolean
  requirements?: RoleRequirement[]
}

interface RoleRequirement {
  id: string
  skill_id: string
  min_proficiency: number
  is_essential: boolean
  skill_name?: string
}

const PROFICIENCY_LABELS = ['', 'Foundational', 'Developing', 'Proficient', 'Advanced', 'Expert']
const PROFICIENCY_COLORS = ['', '#6b7280', '#3b82f6', '#8b5cf6', '#f59e0b', '#10b981']

type Tab = 'library' | 'requests' | 'roles' | 'analytics'

export default function AdminTalentIntelligence() {
  const { selectedCompanyId } = useAdminCompany()
  const { showSuccess, showError } = useToast()
  const [tab, setTab] = useState<Tab>('library')
  const [categories, setCategories] = useState<SkillCategory[]>([])
  const [skills, setSkills] = useState<Skill[]>([])
  const [loading, setLoading] = useState(true)

  const loadLibrary = useCallback(async () => {
    if (!selectedCompanyId) return
    setLoading(true)
    const [catRes, skillRes] = await Promise.all([
      supabase.from('skill_categories').select('*').eq('company_id', selectedCompanyId).order('sort_order, name'),
      supabase.from('skills').select('*').eq('company_id', selectedCompanyId).order('name'),
    ])
    setCategories(catRes.data || [])
    setSkills(skillRes.data || [])
    setLoading(false)
  }, [selectedCompanyId])

  useEffect(() => { loadLibrary() }, [loadLibrary])

  return (
    <div className="admin-page">
      <div className="admin-page-header">
        <h1>Talent Intelligence</h1>
        <p className="admin-page-subtitle">Skills library, validation requests, role profiles and workforce analytics</p>
      </div>

      <div className="admin-tabs">
        {(['library', 'requests', 'roles', 'analytics'] as Tab[]).map(t => (
          <button key={t} className={`admin-tab ${tab === t ? 'admin-tab-active' : ''}`} onClick={() => setTab(t)}>
            {t === 'library' ? 'Skills Library' : t === 'requests' ? 'Validation Requests' : t === 'roles' ? 'Role Profiles' : 'Analytics'}
          </button>
        ))}
      </div>

      {tab === 'library' && (
        <SkillsLibraryTab
          companyId={selectedCompanyId}
          categories={categories}
          skills={skills}
          loading={loading}
          onRefresh={loadLibrary}
          showSuccess={showSuccess}
          showError={showError}
        />
      )}
      {tab === 'requests' && <ValidationRequestsTab companyId={selectedCompanyId} showSuccess={showSuccess} showError={showError} />}
      {tab === 'roles' && <RoleProfilesTab companyId={selectedCompanyId} skills={skills} categories={categories} showSuccess={showSuccess} showError={showError} />}
      {tab === 'analytics' && <AnalyticsTab companyId={selectedCompanyId} />}
    </div>
  )
}

// ─── SKILLS LIBRARY TAB ──────────────────────────────────────────────────────

function SkillsLibraryTab({ companyId, categories, skills, loading, onRefresh, showSuccess, showError }: {
  companyId: string
  categories: SkillCategory[]
  skills: Skill[]
  loading: boolean
  onRefresh: () => void
  showSuccess: (m: string) => void
  showError: (m: string) => void
}) {
  const [showAddCat, setShowAddCat] = useState(false)
  const [newCatName, setNewCatName] = useState('')
  const [newCatDesc, setNewCatDesc] = useState('')
  const [showAddSkill, setShowAddSkill] = useState<string | null>(null)
  const [newSkillName, setNewSkillName] = useState('')
  const [newSkillDesc, setNewSkillDesc] = useState('')
  const [saving, setSaving] = useState(false)
  const [expandedCat, setExpandedCat] = useState<string | null>(null)
  const [seeding, setSeeding] = useState(false)
  const [showDisabled, setShowDisabled] = useState(false)

  const DEFAULT_LIBRARY: Record<string, { description: string; skills: string[] }> = {
    'Technical': { description: 'Software, data, infrastructure and engineering skills', skills: ['Python','JavaScript / TypeScript','SQL & Database Management','Cloud Computing (AWS / Azure / GCP)','API Design & Integration','DevOps & CI/CD','Data Analysis & Visualisation','Cybersecurity Fundamentals'] },
    'Leadership & Management': { description: 'People management, strategy and decision-making', skills: ['Team Leadership','Strategic Planning','Performance Management','Change Management','Coaching & Mentoring','Conflict Resolution','Delegation','Budget Management'] },
    'Communication': { description: 'Written, verbal and presentation skills', skills: ['Report Writing','Presentation Skills','Stakeholder Communication','Active Listening','Meeting Facilitation','Technical Writing'] },
    'Digital & IT': { description: 'Digital literacy, tools and platforms', skills: ['Microsoft 365 Suite','Google Workspace','CRM Systems (Salesforce / HubSpot)','ERP Systems','Business Intelligence Tools','Video Conferencing & Collaboration'] },
    'Project Management': { description: 'Planning, delivery and methodology skills', skills: ['Agile / Scrum','Waterfall Methodology','Risk Management','Requirements Gathering','Stakeholder Management','Resource Planning','PRINCE2'] },
    'Industry Knowledge': { description: 'Sector-specific expertise and regulations', skills: ['Regulatory Compliance','Health & Safety','GDPR & Data Protection','Financial Regulations','Industry Standards & Frameworks','Procurement & Supply Chain'] },
    'Interpersonal': { description: 'Teamwork, collaboration and emotional intelligence', skills: ['Teamwork & Collaboration','Emotional Intelligence','Negotiation','Networking','Cross-cultural Awareness','Customer Service'] },
    'Analytical': { description: 'Problem solving, data analysis and critical thinking', skills: ['Critical Thinking','Problem Solving','Statistical Analysis','Process Improvement','Root Cause Analysis','Decision Making'] },
  }

  async function seedDefaults() {
    setSeeding(true)
    const catEntries = Object.entries(DEFAULT_LIBRARY)
    const { data: catData, error: catErr } = await supabase.from('skill_categories').insert(
      catEntries.map(([name, val], i) => ({ company_id: companyId, name, description: val.description, sort_order: i, is_system: true }))
    ).select('id, name')
    if (catErr || !catData) { showError(catErr?.message || 'Failed to seed categories'); setSeeding(false); return }

    const skillRows: { company_id: string; category_id: string; name: string; is_system: boolean }[] = []
    catData.forEach(cat => {
      const entry = DEFAULT_LIBRARY[cat.name]
      if (entry) entry.skills.forEach(s => skillRows.push({ company_id: companyId, category_id: cat.id, name: s, is_system: true }))
    })
    const { error: skErr } = await supabase.from('skills').insert(skillRows)
    setSeeding(false)
    if (skErr) { showError(skErr.message); return }
    showSuccess(`Seeded ${catData.length} categories with ${skillRows.length} skills`)
    onRefresh()
  }

  async function addCategory() {
    if (!newCatName.trim()) return
    setSaving(true)
    const { error } = await supabase.from('skill_categories').insert({
      company_id: companyId,
      name: newCatName.trim(),
      description: newCatDesc.trim() || null,
      sort_order: categories.length,
    })
    setSaving(false)
    if (error) { showError(error.message); return }
    showSuccess('Category added')
    setNewCatName('')
    setNewCatDesc('')
    setShowAddCat(false)
    onRefresh()
  }

  async function addSkill(categoryId: string) {
    if (!newSkillName.trim()) return
    setSaving(true)
    const { error } = await supabase.from('skills').insert({
      company_id: companyId,
      category_id: categoryId,
      name: newSkillName.trim(),
      description: newSkillDesc.trim() || null,
    })
    setSaving(false)
    if (error) { showError(error.message); return }
    showSuccess('Skill added')
    setNewSkillName('')
    setNewSkillDesc('')
    setShowAddSkill(null)
    onRefresh()
  }

  async function toggleSkillActive(skillId: string, currentlyActive: boolean) {
    const { error } = await supabase.from('skills').update({ is_active: !currentlyActive }).eq('id', skillId)
    if (error) { showError(error.message); return }
    showSuccess(currentlyActive ? 'Skill disabled' : 'Skill enabled')
    onRefresh()
  }

  async function deleteSkill(skillId: string) {
    const { count } = await supabase.from('employee_skills').select('id', { count: 'exact', head: true }).eq('skill_id', skillId)
    if (count && count > 0) { showError(`Cannot delete — ${count} employee(s) have this skill recorded. Disable it instead.`); return }
    const { error } = await supabase.from('skills').delete().eq('id', skillId)
    if (error) { showError(error.message); return }
    showSuccess('Skill deleted')
    onRefresh()
  }

  async function deleteCategory(catId: string) {
    const catSkills = skills.filter(s => s.category_id === catId)
    if (catSkills.length > 0) { showError('Remove all skills from this category first'); return }
    const { error } = await supabase.from('skill_categories').delete().eq('id', catId)
    if (error) { showError(error.message); return }
    showSuccess('Category removed')
    onRefresh()
  }

  if (loading) return <p className="admin-empty">Loading skills library...</p>

  return (
    <div className="admin-section">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <h2 style={{ margin: 0 }}>Categories &amp; Skills</h2>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <label style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
            <input type="checkbox" checked={showDisabled} onChange={e => setShowDisabled(e.target.checked)} />
            Show disabled
          </label>
          <button className="admin-btn admin-btn-primary" onClick={() => setShowAddCat(true)}>+ Add Category</button>
        </div>
      </div>

      {showAddCat && (
        <div className="admin-card" style={{ marginBottom: 16, padding: 16 }}>
          <h3 style={{ marginTop: 0 }}>New Category</h3>
          <input className="admin-input" placeholder="Category name" value={newCatName} onChange={e => setNewCatName(e.target.value)} style={{ marginBottom: 8 }} />
          <input className="admin-input" placeholder="Description (optional)" value={newCatDesc} onChange={e => setNewCatDesc(e.target.value)} style={{ marginBottom: 12 }} />
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="admin-btn admin-btn-primary" onClick={addCategory} disabled={saving}>{saving ? 'Saving...' : 'Add'}</button>
            <button className="admin-btn" onClick={() => setShowAddCat(false)}>Cancel</button>
          </div>
        </div>
      )}

      {categories.length === 0 && (
        <div className="admin-card" style={{ padding: 24, textAlign: 'center' }}>
          <p style={{ color: 'var(--text-muted)', marginBottom: 12 }}>No skill categories yet. Seed the default library to get started with 8 categories and 50+ skills, or add your own.</p>
          <button className="admin-btn admin-btn-primary" onClick={seedDefaults} disabled={seeding}>{seeding ? 'Seeding...' : 'Seed Default Library'}</button>
        </div>
      )}

      {categories.map(cat => {
        const catSkills = skills.filter(s => s.category_id === cat.id && (showDisabled || s.is_active))
        const disabledCount = skills.filter(s => s.category_id === cat.id && !s.is_active).length
        const isExpanded = expandedCat === cat.id
        return (
          <div key={cat.id} className="admin-card" style={{ marginBottom: 12, padding: 0 }}>
            <div
              style={{ display: 'flex', alignItems: 'center', padding: '12px 16px', cursor: 'pointer', gap: 12 }}
              onClick={() => setExpandedCat(isExpanded ? null : cat.id)}
            >
              <span style={{ transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.2s', fontSize: 12 }}>▶</span>
              <div style={{ flex: 1 }}>
                <strong>{cat.name}</strong>
                {cat.description && <span style={{ color: 'var(--text-muted)', marginLeft: 8, fontSize: 13 }}>{cat.description}</span>}
              </div>
              <span className="admin-badge" style={{ background: 'var(--bg)', fontSize: 12 }}>
                {catSkills.length} skill{catSkills.length !== 1 ? 's' : ''}
                {!showDisabled && disabledCount > 0 && <span style={{ color: 'var(--text-muted)' }}> (+{disabledCount} disabled)</span>}
              </span>
              <button className="admin-btn-icon" onClick={e => { e.stopPropagation(); deleteCategory(cat.id) }} title="Delete category" style={{ color: '#dc2626', fontSize: 14 }}>✕</button>
            </div>
            {isExpanded && (
              <div style={{ borderTop: '1px solid var(--border)', padding: 16 }}>
                {catSkills.length === 0 && <p style={{ color: 'var(--text-muted)', margin: '0 0 12px' }}>No {showDisabled ? '' : 'active '}skills in this category.</p>}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {catSkills.map(skill => (
                    <div key={skill.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 0', opacity: skill.is_active ? 1 : 0.5 }}>
                      <div>
                        <span style={{ fontWeight: 500 }}>{skill.name}</span>
                        {skill.description && <span style={{ color: 'var(--text-muted)', marginLeft: 8, fontSize: 13 }}>— {skill.description}</span>}
                        {!skill.is_active && <span style={{ marginLeft: 8, fontSize: 11, color: '#dc2626', fontStyle: 'italic' }}>disabled</span>}
                      </div>
                      <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                        <button
                          className="admin-btn-icon"
                          onClick={() => toggleSkillActive(skill.id, skill.is_active)}
                          title={skill.is_active ? 'Disable skill' : 'Enable skill'}
                          style={{ fontSize: 14 }}
                        >
                          {skill.is_active ? '🚫' : '✅'}
                        </button>
                        <button className="admin-btn-icon" onClick={() => deleteSkill(skill.id)} title="Delete skill" style={{ color: '#dc2626', fontSize: 12 }}>✕</button>
                      </div>
                    </div>
                  ))}
                </div>
                {showAddSkill === cat.id ? (
                  <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <input className="admin-input" placeholder="Skill name" value={newSkillName} onChange={e => setNewSkillName(e.target.value)} style={{ flex: 1, minWidth: 160 }} />
                    <input className="admin-input" placeholder="Description (optional)" value={newSkillDesc} onChange={e => setNewSkillDesc(e.target.value)} style={{ flex: 1, minWidth: 160 }} />
                    <button className="admin-btn admin-btn-primary" onClick={() => addSkill(cat.id)} disabled={saving}>{saving ? 'Saving...' : 'Add'}</button>
                    <button className="admin-btn" onClick={() => setShowAddSkill(null)}>Cancel</button>
                  </div>
                ) : (
                  <button className="admin-btn" style={{ marginTop: 12 }} onClick={() => { setShowAddSkill(cat.id); setNewSkillName(''); setNewSkillDesc('') }}>+ Add Skill</button>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ─── VALIDATION REQUESTS TAB ─────────────────────────────────────────────────

function ValidationRequestsTab({ companyId, showSuccess, showError }: {
  companyId: string
  showSuccess: (m: string) => void
  showError: (m: string) => void
}) {
  const [requests, setRequests] = useState<ValidationRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'pending' | 'all'>('pending')

  const loadRequests = useCallback(async () => {
    if (!companyId) return
    setLoading(true)
    let query = supabase.from('skill_validations').select('*').eq('company_id', companyId).order('created_at', { ascending: false })
    if (filter === 'pending') query = query.eq('status', 'pending')
    const { data } = await query
    if (!data) { setRequests([]); setLoading(false); return }

    const empIds = [...new Set(data.flatMap(r => [r.requested_by, r.assigned_to]))]
    const skillIds = [...new Set(data.map(r => r.employee_skill_id))]

    const [empRes, esRes] = await Promise.all([
      empIds.length > 0 ? supabase.from('employees').select('id, first_name, last_name').in('id', empIds) : { data: [] },
      skillIds.length > 0 ? supabase.from('employee_skills').select('id, skill_id, proficiency').in('id', skillIds) : { data: [] },
    ])

    const empMap = new Map((empRes.data || []).map((e: any) => [e.id, `${e.first_name} ${e.last_name}`]))
    const esMap = new Map((esRes.data || []).map((es: any) => [es.id, es]))

    const skillIdsFromEs = [...new Set((esRes.data || []).map((es: any) => es.skill_id))]
    const skillRes = skillIdsFromEs.length > 0 ? await supabase.from('skills').select('id, name').in('id', skillIdsFromEs) : { data: [] }
    const skillMap = new Map((skillRes.data || []).map((s: any) => [s.id, s.name]))

    setRequests(data.map(r => {
      const es = esMap.get(r.employee_skill_id)
      return {
        ...r,
        requester_name: empMap.get(r.requested_by) || 'Unknown',
        skill_name: es ? skillMap.get(es.skill_id) || 'Unknown' : 'Unknown',
        proficiency: es?.proficiency,
      }
    }))
    setLoading(false)
  }, [companyId, filter])

  useEffect(() => { loadRequests() }, [loadRequests])

  async function respond(requestId: string, employeeSkillId: string, decision: 'approved' | 'rejected') {
    const newStatus = decision === 'approved' ? 'validated' : 'rejected'
    const [valRes, esRes] = await Promise.all([
      supabase.from('skill_validations').update({ status: decision, responded_at: new Date().toISOString() }).eq('id', requestId),
      supabase.from('employee_skills').update({ status: newStatus, validated_at: decision === 'approved' ? new Date().toISOString() : null }).eq('id', employeeSkillId),
    ])
    if (valRes.error || esRes.error) { showError('Failed to update'); return }
    showSuccess(`Skill ${decision}`)
    loadRequests()
  }

  if (loading) return <p className="admin-empty">Loading validation requests...</p>

  return (
    <div className="admin-section">
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <button className={`admin-tab ${filter === 'pending' ? 'admin-tab-active' : ''}`} onClick={() => setFilter('pending')}>Pending</button>
        <button className={`admin-tab ${filter === 'all' ? 'admin-tab-active' : ''}`} onClick={() => setFilter('all')}>All</button>
      </div>

      {requests.length === 0 && <p className="admin-empty">No {filter === 'pending' ? 'pending ' : ''}validation requests.</p>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {requests.map(req => (
          <div key={req.id} className="admin-card" style={{ padding: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 8 }}>
              <div>
                <strong>{req.requester_name}</strong> requested validation for <strong>{req.skill_name}</strong>
                {req.proficiency && (
                  <span style={{ marginLeft: 8, padding: '2px 8px', borderRadius: 12, fontSize: 12, background: PROFICIENCY_COLORS[req.proficiency] + '20', color: PROFICIENCY_COLORS[req.proficiency] }}>
                    {PROFICIENCY_LABELS[req.proficiency]}
                  </span>
                )}
                <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>{formatDate(req.created_at.split('T')[0])}</div>
              </div>
              {req.status === 'pending' ? (
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="admin-btn admin-btn-primary" onClick={() => respond(req.id, req.employee_skill_id, 'approved')}>Approve</button>
                  <button className="admin-btn" style={{ color: '#dc2626' }} onClick={() => respond(req.id, req.employee_skill_id, 'rejected')}>Reject</button>
                </div>
              ) : (
                <span className="admin-badge" style={{ background: req.status === 'approved' ? '#dcfce7' : '#fee2e2', color: req.status === 'approved' ? '#16a34a' : '#dc2626' }}>
                  {req.status === 'approved' ? 'Approved' : 'Rejected'}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── ROLE PROFILES TAB ───────────────────────────────────────────────────────

function RoleProfilesTab({ companyId, skills, categories, showSuccess, showError }: {
  companyId: string
  skills: Skill[]
  categories: SkillCategory[]
  showSuccess: (m: string) => void
  showError: (m: string) => void
}) {
  const [roles, setRoles] = useState<RoleProfile[]>([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [newDept, setNewDept] = useState('')
  const [newDesc, setNewDesc] = useState('')
  const [saving, setSaving] = useState(false)
  const [selectedRole, setSelectedRole] = useState<RoleProfile | null>(null)
  const [requirements, setRequirements] = useState<RoleRequirement[]>([])
  const [addSkillId, setAddSkillId] = useState('')
  const [addMinProf, setAddMinProf] = useState(3)
  const [addEssential, setAddEssential] = useState(true)

  const loadRoles = useCallback(async () => {
    if (!companyId) return
    setLoading(true)
    const { data } = await supabase.from('role_profiles').select('*').eq('company_id', companyId).order('title')
    setRoles(data || [])
    setLoading(false)
  }, [companyId])

  useEffect(() => { loadRoles() }, [loadRoles])

  async function loadRequirements(roleId: string) {
    const { data } = await supabase.from('role_skill_requirements').select('*').eq('role_profile_id', roleId)
    const reqs = (data || []).map(r => ({
      ...r,
      skill_name: skills.find(s => s.id === r.skill_id)?.name || 'Unknown',
    }))
    setRequirements(reqs)
  }

  async function addRole() {
    if (!newTitle.trim()) return
    setSaving(true)
    const { error } = await supabase.from('role_profiles').insert({
      company_id: companyId,
      title: newTitle.trim(),
      department: newDept.trim() || null,
      description: newDesc.trim() || null,
    })
    setSaving(false)
    if (error) { showError(error.message); return }
    showSuccess('Role profile created')
    setNewTitle('')
    setNewDept('')
    setNewDesc('')
    setShowAdd(false)
    loadRoles()
  }

  async function deleteRole(roleId: string) {
    await supabase.from('role_skill_requirements').delete().eq('role_profile_id', roleId)
    const { error } = await supabase.from('role_profiles').delete().eq('id', roleId)
    if (error) { showError(error.message); return }
    showSuccess('Role profile deleted')
    if (selectedRole?.id === roleId) setSelectedRole(null)
    loadRoles()
  }

  async function addRequirement() {
    if (!addSkillId || !selectedRole) return
    const { error } = await supabase.from('role_skill_requirements').insert({
      company_id: companyId,
      role_profile_id: selectedRole.id,
      skill_id: addSkillId,
      min_proficiency: addMinProf,
      is_essential: addEssential,
    })
    if (error) { showError(error.message); return }
    showSuccess('Requirement added')
    setAddSkillId('')
    loadRequirements(selectedRole.id)
  }

  async function removeRequirement(reqId: string) {
    await supabase.from('role_skill_requirements').delete().eq('id', reqId)
    if (selectedRole) loadRequirements(selectedRole.id)
  }

  if (loading) return <p className="admin-empty">Loading role profiles...</p>

  if (selectedRole) {
    return (
      <div className="admin-section">
        <button className="admin-btn" onClick={() => setSelectedRole(null)} style={{ marginBottom: 16 }}>&larr; Back to Roles</button>
        <div className="admin-card" style={{ padding: 16, marginBottom: 16 }}>
          <h2 style={{ marginTop: 0 }}>{selectedRole.title}</h2>
          {selectedRole.department && <p style={{ color: 'var(--text-muted)', margin: '4px 0' }}>{selectedRole.department}</p>}
          {selectedRole.description && <p style={{ margin: '8px 0 0' }}>{selectedRole.description}</p>}
        </div>

        <h3>Skill Requirements</h3>
        {requirements.length === 0 && <p className="admin-empty">No skill requirements defined yet.</p>}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 16 }}>
          {requirements.map(req => (
            <div key={req.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', background: 'var(--bg-card)', borderRadius: 8, border: '1px solid var(--border)' }}>
              <div>
                <strong>{req.skill_name}</strong>
                <span style={{ marginLeft: 8, padding: '2px 8px', borderRadius: 12, fontSize: 12, background: PROFICIENCY_COLORS[req.min_proficiency] + '20', color: PROFICIENCY_COLORS[req.min_proficiency] }}>
                  Min: {PROFICIENCY_LABELS[req.min_proficiency]}
                </span>
                <span style={{ marginLeft: 8, fontSize: 12, color: req.is_essential ? '#dc2626' : 'var(--text-muted)' }}>
                  {req.is_essential ? 'Essential' : 'Desirable'}
                </span>
              </div>
              <button className="admin-btn-icon" onClick={() => removeRequirement(req.id)} style={{ color: '#dc2626', fontSize: 12 }}>✕</button>
            </div>
          ))}
        </div>

        <div className="admin-card" style={{ padding: 16 }}>
          <h4 style={{ marginTop: 0 }}>Add Requirement</h4>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div style={{ flex: 1, minWidth: 200 }}>
              <label className="admin-label">Skill</label>
              <select className="admin-input" value={addSkillId} onChange={e => setAddSkillId(e.target.value)}>
                <option value="">Select skill...</option>
                {categories.map(cat => (
                  <optgroup key={cat.id} label={cat.name}>
                    {skills.filter(s => s.category_id === cat.id).map(s => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>
            <div style={{ minWidth: 140 }}>
              <label className="admin-label">Min Proficiency</label>
              <select className="admin-input" value={addMinProf} onChange={e => setAddMinProf(Number(e.target.value))}>
                {[1,2,3,4,5].map(n => <option key={n} value={n}>{PROFICIENCY_LABELS[n]}</option>)}
              </select>
            </div>
            <div style={{ minWidth: 100 }}>
              <label className="admin-label">Type</label>
              <select className="admin-input" value={addEssential ? 'essential' : 'desirable'} onChange={e => setAddEssential(e.target.value === 'essential')}>
                <option value="essential">Essential</option>
                <option value="desirable">Desirable</option>
              </select>
            </div>
            <button className="admin-btn admin-btn-primary" onClick={addRequirement}>Add</button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="admin-section">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2 style={{ margin: 0 }}>Role Profiles</h2>
        <button className="admin-btn admin-btn-primary" onClick={() => setShowAdd(true)}>+ Add Role Profile</button>
      </div>

      {showAdd && (
        <div className="admin-card" style={{ marginBottom: 16, padding: 16 }}>
          <h3 style={{ marginTop: 0 }}>New Role Profile</h3>
          <input className="admin-input" placeholder="Role title" value={newTitle} onChange={e => setNewTitle(e.target.value)} style={{ marginBottom: 8 }} />
          <input className="admin-input" placeholder="Department (optional)" value={newDept} onChange={e => setNewDept(e.target.value)} style={{ marginBottom: 8 }} />
          <textarea className="admin-input" placeholder="Description (optional)" value={newDesc} onChange={e => setNewDesc(e.target.value)} rows={3} style={{ marginBottom: 12 }} />
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="admin-btn admin-btn-primary" onClick={addRole} disabled={saving}>{saving ? 'Saving...' : 'Create'}</button>
            <button className="admin-btn" onClick={() => setShowAdd(false)}>Cancel</button>
          </div>
        </div>
      )}

      {roles.length === 0 && <p className="admin-empty">No role profiles yet.</p>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12 }}>
        {roles.map(role => (
          <div key={role.id} className="admin-card" style={{ padding: 16, cursor: 'pointer' }} onClick={() => { setSelectedRole(role); loadRequirements(role.id) }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <strong>{role.title}</strong>
                {role.department && <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{role.department}</div>}
              </div>
              <button className="admin-btn-icon" onClick={e => { e.stopPropagation(); deleteRole(role.id) }} style={{ color: '#dc2626', fontSize: 12 }}>✕</button>
            </div>
            {role.description && <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '8px 0 0' }}>{role.description}</p>}
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── ANALYTICS TAB ───────────────────────────────────────────────────────────

function AnalyticsTab({ companyId }: { companyId: string }) {
  const [stats, setStats] = useState<{ totalSkills: number; totalEmployeeSkills: number; validated: number; pending: number; avgProficiency: number; topSkills: { name: string; count: number }[]; deptBreakdown: { dept: string; count: number }[] }>({
    totalSkills: 0, totalEmployeeSkills: 0, validated: 0, pending: 0, avgProficiency: 0, topSkills: [], deptBreakdown: [],
  })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!companyId) return
    async function load() {
      setLoading(true)
      const [skillsRes, esRes, empRes, skRes] = await Promise.all([
        supabase.from('skills').select('id', { count: 'exact', head: true }).eq('company_id', companyId),
        supabase.from('employee_skills').select('*').eq('company_id', companyId),
        supabase.from('employees').select('id, department').eq('company_id', companyId).eq('is_active', true),
        supabase.from('skills').select('id, name').eq('company_id', companyId),
      ])

      const allEs = esRes.data || []
      const validated = allEs.filter(e => e.status === 'validated').length
      const pending = allEs.filter(e => e.status === 'pending_validation').length
      const avgProf = allEs.length > 0 ? allEs.reduce((sum, e) => sum + e.proficiency, 0) / allEs.length : 0

      const skillMap = new Map((skRes.data || []).map((s: any) => [s.id, s.name]))
      const skillCounts: Record<string, number> = {}
      allEs.forEach(e => {
        const name = skillMap.get(e.skill_id) || 'Unknown'
        skillCounts[name] = (skillCounts[name] || 0) + 1
      })
      const topSkills = Object.entries(skillCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([name, count]) => ({ name, count }))

      const empMap = new Map((empRes.data || []).map((e: any) => [e.id, e.department || 'Unassigned']))
      const deptCounts: Record<string, number> = {}
      allEs.forEach(e => {
        const dept = empMap.get(e.employee_id) || 'Unknown'
        deptCounts[dept] = (deptCounts[dept] || 0) + 1
      })
      const deptBreakdown = Object.entries(deptCounts)
        .sort((a, b) => b[1] - a[1])
        .map(([dept, count]) => ({ dept, count }))

      setStats({
        totalSkills: skillsRes.count || 0,
        totalEmployeeSkills: allEs.length,
        validated,
        pending,
        avgProficiency: Math.round(avgProf * 10) / 10,
        topSkills,
        deptBreakdown,
      })
      setLoading(false)
    }
    load()
  }, [companyId])

  if (loading) return <p className="admin-empty">Loading analytics...</p>

  return (
    <div className="admin-section">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12, marginBottom: 24 }}>
        <div className="admin-card" style={{ padding: 16, textAlign: 'center' }}>
          <div style={{ fontSize: 28, fontWeight: 700 }}>{stats.totalSkills}</div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Skills in Library</div>
        </div>
        <div className="admin-card" style={{ padding: 16, textAlign: 'center' }}>
          <div style={{ fontSize: 28, fontWeight: 700 }}>{stats.totalEmployeeSkills}</div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Employee Skills Recorded</div>
        </div>
        <div className="admin-card" style={{ padding: 16, textAlign: 'center' }}>
          <div style={{ fontSize: 28, fontWeight: 700, color: '#16a34a' }}>{stats.validated}</div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Validated</div>
        </div>
        <div className="admin-card" style={{ padding: 16, textAlign: 'center' }}>
          <div style={{ fontSize: 28, fontWeight: 700, color: '#f59e0b' }}>{stats.pending}</div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Pending Validation</div>
        </div>
        <div className="admin-card" style={{ padding: 16, textAlign: 'center' }}>
          <div style={{ fontSize: 28, fontWeight: 700 }}>{stats.avgProficiency}</div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Avg Proficiency</div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16 }}>
        <div className="admin-card" style={{ padding: 16 }}>
          <h3 style={{ marginTop: 0 }}>Top Skills</h3>
          {stats.topSkills.length === 0 && <p className="admin-empty">No data yet.</p>}
          {stats.topSkills.map((s, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
              <span>{s.name}</span>
              <strong>{s.count}</strong>
            </div>
          ))}
        </div>
        <div className="admin-card" style={{ padding: 16 }}>
          <h3 style={{ marginTop: 0 }}>Skills by Department</h3>
          {stats.deptBreakdown.length === 0 && <p className="admin-empty">No data yet.</p>}
          {stats.deptBreakdown.map((d, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
              <span>{d.dept}</span>
              <strong>{d.count}</strong>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
