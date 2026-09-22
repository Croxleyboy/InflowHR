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
    'Communication': { description: 'Written, verbal and presentation skills', skills: ['Written Communication','Verbal Communication','Presentation Skills','Public Speaking','Active Listening','Stakeholder Management','Facilitation','Negotiation','Report Writing','Conflict Resolution'] },
    'Customer Service': { description: 'Client-facing service, support and retention skills', skills: ['Customer Service','Customer Success','Complaint Handling','Customer Support','Call Handling','Relationship Management','Account Management','Service Delivery','Service Recovery','Client Retention'] },
    'Leadership & Management': { description: 'People management, strategy and decision-making', skills: ['Team Leadership','People Management','Coaching','Mentoring','Delegation','Strategic Planning','Decision Making','Change Management','Workforce Planning','Budget Management','Performance Management','Succession Planning'] },
    'Project & Change': { description: 'Planning, delivery and methodology skills', skills: ['Project Management','Agile','Scrum','Kanban','Risk Management','Business Analysis','Process Mapping','Resource Planning','Change Management','Continuous Improvement','Requirements Gathering','Project Scheduling'] },
    'Finance & Accounting': { description: 'Financial operations, reporting and tools', skills: ['Payroll','Bookkeeping','Accounts Payable','Accounts Receivable','Financial Reporting','Budget Planning','Forecasting','Cash Flow Management','Expense Management','VAT Management','Xero','QuickBooks','Sage'] },
    'HR & People': { description: 'Human resources, talent and employee lifecycle', skills: ['Recruitment','Onboarding','Offboarding','Employee Relations','Employment Law','HR Administration','Learning & Development','Performance Reviews','Policy Development','Employee Engagement','Workforce Planning','Benefits Management'] },
    'Sales': { description: 'Revenue generation and business development', skills: ['Lead Generation','Prospecting','Business Development','Account Management','Sales Negotiation','Sales Forecasting','CRM Management','Pipeline Management','Proposal Writing','Customer Retention'] },
    'Marketing': { description: 'Digital marketing, brand and campaigns', skills: ['SEO','PPC','Content Marketing','Email Marketing','Social Media Marketing','Brand Management','Market Research','Event Management','Website Management','Digital Analytics','Campaign Management','Copywriting'] },
    'Administration': { description: 'Office administration and organisational support', skills: ['Office Administration','Data Entry','Document Management','Diary Management','Scheduling','Minute Taking','Records Management','Procurement Administration','Compliance Administration'] },
    'Data & Analytics': { description: 'Data analysis, visualisation and business intelligence', skills: ['Microsoft Excel','Data Analysis','Power BI','SQL','Data Visualisation','Dashboard Reporting','Data Governance','Data Quality','Reporting & Insights','Business Intelligence'] },
    'IT & Microsoft Technologies': { description: 'IT infrastructure, Microsoft 365 and endpoint management', skills: ['Microsoft 365 Administration','Microsoft Intune','Microsoft Entra ID','Microsoft Azure','Windows Administration','macOS Administration','Networking','Endpoint Management','Mobile Device Management','Technical Support','Power Platform','Power Apps','Power Automate','SharePoint Administration','Exchange Online','Teams Administration'] },
    'Cyber Security': { description: 'Information security, risk and compliance', skills: ['Cyber Security Awareness','Incident Response','Identity Management','Access Management','Vulnerability Management','Security Operations','Risk Assessment','Data Protection','GDPR','Email Security','Endpoint Security'] },
    'AI & Automation': { description: 'Artificial intelligence, automation and modern productivity', skills: ['AI Literacy','Prompt Engineering','Microsoft Copilot','ChatGPT','AI Content Creation','AI Data Analysis','Workflow Automation','Process Automation','AI Governance','AI Change Adoption'] },
    'Operations': { description: 'Supply chain, procurement and operational management', skills: ['Inventory Management','Supplier Management','Procurement','Logistics','Supply Chain','Process Improvement','Quality Assurance','Operational Planning','Resource Management'] },
    'Compliance & Governance': { description: 'Regulatory compliance, auditing and governance', skills: ['GDPR','Audit Management','Policy Compliance','Risk Management','Business Continuity','Information Governance','Regulatory Compliance','Document Retention','ISO Standards'] },
    'Health & Safety': { description: 'Workplace health, safety and wellbeing', skills: ['First Aid','Fire Safety','Manual Handling','Risk Assessment','Health & Safety Management','Safeguarding','Mental Health Awareness','Accident Reporting'] },
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
    await supabase.from('workflow_tracker').update({ status: 'Complete', approval_status: decision === 'approved' ? 'Approved' : 'Declined' }).eq('record_type', 'Skill Validation').eq('extra_info', employeeSkillId).eq('company_id', companyId)
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

interface AnalyticsData {
  totalSkills: number
  totalEmployees: number
  totalEmployeeSkills: number
  validated: number
  pending: number
  avgProficiency: number
  participationRate: number
  topSkills: { name: string; count: number }[]
  heatmap: { dept: string; categories: Record<string, number> }[]
  heatmapCategories: string[]
  skillGaps: { role: string; dept: string; gaps: { skill: string; required: number; actual: number; holders: number; essential: boolean }[] }[]
  busFactorRisks: { skill: string; holders: string[]; category: string }[]
  certsDashboard: { active: number; expiringSoon: number; expired: number; upcoming: { name: string; employee: string; expiry: string }[] }
  trainingNeeds: { skill: string; category: string; avgProf: number; count: number; belowProficient: number }[]
  silentDepts: string[]
  roleMatches: { employee: string; dept: string; role: string; matchPct: number; met: number; total: number }[]
  aiAdoption: { total: number; employees: number; avgProf: number; skills: { name: string; count: number }[] }
}

function AnalyticsTab({ companyId }: { companyId: string }) {
  const [data, setData] = useState<AnalyticsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [section, setSection] = useState<'overview' | 'heatmap' | 'gaps' | 'bus' | 'certs' | 'training' | 'matching' | 'ai'>('overview')

  useEffect(() => {
    if (!companyId) return
    async function load() {
      setLoading(true)
      const [catRes, skRes, esRes, empRes, certRes, roleRes, reqRes] = await Promise.all([
        supabase.from('skill_categories').select('id, name').eq('company_id', companyId).order('sort_order'),
        supabase.from('skills').select('id, name, category_id').eq('company_id', companyId).eq('is_active', true),
        supabase.from('employee_skills').select('*').eq('company_id', companyId),
        supabase.from('employees').select('id, first_name, last_name, department, job_title').eq('company_id', companyId).eq('is_active', true),
        supabase.from('employee_certifications').select('*').eq('company_id', companyId),
        supabase.from('role_profiles').select('*').eq('company_id', companyId).eq('is_active', true),
        supabase.from('role_skill_requirements').select('*').eq('company_id', companyId),
      ])

      const cats = catRes.data || []
      const skills = skRes.data || []
      const allEs = esRes.data || []
      const emps = empRes.data || []
      const certs = certRes.data || []
      const roles = roleRes.data || []
      const reqs = reqRes.data || []

      const catMap = new Map(cats.map((c: any) => [c.id, c.name]))
      const skillMap = new Map(skills.map((s: any) => [s.id, s]))
      const empMap = new Map(emps.map((e: any) => [e.id, e]))
      const empName = (id: string) => { const e = empMap.get(id); return e ? `${e.first_name} ${e.last_name}` : 'Unknown' }

      const validated = allEs.filter((e: any) => e.status === 'validated').length
      const pending = allEs.filter((e: any) => e.status === 'pending_validation').length
      const avgProf = allEs.length > 0 ? allEs.reduce((sum: number, e: any) => sum + e.proficiency, 0) / allEs.length : 0

      const empsWithSkills = new Set(allEs.map((e: any) => e.employee_id))
      const participationRate = emps.length > 0 ? Math.round((empsWithSkills.size / emps.length) * 100) : 0

      // Top skills
      const skillCounts: Record<string, number> = {}
      allEs.forEach((e: any) => {
        const sk = skillMap.get(e.skill_id)
        const name = sk?.name || 'Unknown'
        skillCounts[name] = (skillCounts[name] || 0) + 1
      })
      const topSkills = Object.entries(skillCounts).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([name, count]) => ({ name, count }))

      // Department skills heatmap
      const depts = [...new Set(emps.map((e: any) => e.department || 'Unassigned'))].sort()
      const catNames = cats.map((c: any) => c.name)
      const heatmap = depts.map(dept => {
        const deptEmpIds = new Set(emps.filter((e: any) => (e.department || 'Unassigned') === dept).map((e: any) => e.id))
        const deptEs = allEs.filter((e: any) => deptEmpIds.has(e.employee_id))
        const categories: Record<string, number> = {}
        catNames.forEach(cn => { categories[cn] = 0 })
        deptEs.forEach((e: any) => {
          const sk = skillMap.get(e.skill_id)
          if (sk) {
            const cn = catMap.get(sk.category_id)
            if (cn) categories[cn] = (categories[cn] || 0) + 1
          }
        })
        return { dept, categories }
      })

      // Skill gap analysis
      const skillGaps = roles.map((role: any) => {
        const roleReqs = reqs.filter((r: any) => r.role_profile_id === role.id)
        const deptEmps = role.department ? emps.filter((e: any) => e.department === role.department) : emps
        const deptEmpIds = new Set(deptEmps.map((e: any) => e.id))
        const gaps = roleReqs.map((req: any) => {
          const sk = skillMap.get(req.skill_id)
          const holders = allEs.filter((e: any) => e.skill_id === req.skill_id && deptEmpIds.has(e.employee_id))
          const qualified = holders.filter((e: any) => e.proficiency >= req.min_proficiency)
          const avgActual = holders.length > 0 ? Math.round(holders.reduce((s: number, e: any) => s + e.proficiency, 0) / holders.length * 10) / 10 : 0
          return { skill: sk?.name || 'Unknown', required: req.min_proficiency, actual: avgActual, holders: qualified.length, essential: req.is_essential }
        }).filter(g => g.holders < deptEmps.length * 0.5 || g.actual < g.required)
        return { role: role.title, dept: role.department || 'All', gaps }
      }).filter(r => r.gaps.length > 0)

      // Bus factor risk — skills held by ≤ 2 employees
      const skillHolders: Record<string, Set<string>> = {}
      allEs.forEach((e: any) => {
        if (!skillHolders[e.skill_id]) skillHolders[e.skill_id] = new Set()
        skillHolders[e.skill_id].add(e.employee_id)
      })
      const busFactorRisks = Object.entries(skillHolders)
        .filter(([, holders]) => holders.size <= 2 && holders.size > 0)
        .map(([skillId, holders]) => {
          const sk = skillMap.get(skillId)
          return { skill: sk?.name || 'Unknown', holders: [...holders].map(empName), category: sk ? catMap.get(sk.category_id) || '' : '' }
        })
        .sort((a, b) => a.holders.length - b.holders.length)

      // Certification dashboard
      const now = new Date()
      const in90 = new Date(now.getTime() + 90 * 86400000)
      const activeCerts = certs.filter((c: any) => c.status === 'active')
      const expiringSoon = activeCerts.filter((c: any) => c.expiry_date && new Date(c.expiry_date) <= in90 && new Date(c.expiry_date) > now)
      const expired = certs.filter((c: any) => c.status === 'expired' || (c.expiry_date && new Date(c.expiry_date) <= now))
      const upcoming = expiringSoon
        .map((c: any) => ({ name: c.name, employee: empName(c.employee_id), expiry: new Date(c.expiry_date).toLocaleDateString('en-GB') }))
        .sort((a: any, b: any) => a.expiry.localeCompare(b.expiry))

      // Training needs — skills with avg proficiency < 3
      const skillProfAgg: Record<string, { total: number; count: number; belowProf: number }> = {}
      allEs.forEach((e: any) => {
        if (!skillProfAgg[e.skill_id]) skillProfAgg[e.skill_id] = { total: 0, count: 0, belowProf: 0 }
        skillProfAgg[e.skill_id].total += e.proficiency
        skillProfAgg[e.skill_id].count++
        if (e.proficiency < 3) skillProfAgg[e.skill_id].belowProf++
      })
      const trainingNeeds = Object.entries(skillProfAgg)
        .map(([skillId, agg]) => {
          const sk = skillMap.get(skillId)
          return { skill: sk?.name || 'Unknown', category: sk ? catMap.get(sk.category_id) || '' : '', avgProf: Math.round(agg.total / agg.count * 10) / 10, count: agg.count, belowProficient: agg.belowProf }
        })
        .filter(t => t.avgProf < 3 || t.belowProficient > 0)
        .sort((a, b) => a.avgProf - b.avgProf)
        .slice(0, 15)

      // Silent departments — departments with zero skills submitted
      const deptsWithSkills = new Set<string>()
      allEs.forEach((e: any) => {
        const emp = empMap.get(e.employee_id)
        if (emp) deptsWithSkills.add(emp.department || 'Unassigned')
      })
      const silentDepts = depts.filter(d => !deptsWithSkills.has(d))

      // Internal role matching — best employee matches for each role
      const roleMatches: AnalyticsData['roleMatches'] = []
      roles.forEach((role: any) => {
        const roleReqs = reqs.filter((r: any) => r.role_profile_id === role.id)
        if (roleReqs.length === 0) return
        emps.forEach((emp: any) => {
          const empEs = allEs.filter((e: any) => e.employee_id === emp.id)
          const empSkillMap = new Map(empEs.map((e: any) => [e.skill_id, e.proficiency]))
          let met = 0
          roleReqs.forEach((req: any) => {
            const prof = empSkillMap.get(req.skill_id)
            if (prof && prof >= req.min_proficiency) met++
          })
          const matchPct = Math.round((met / roleReqs.length) * 100)
          if (matchPct >= 50) {
            roleMatches.push({ employee: `${emp.first_name} ${emp.last_name}`, dept: emp.department || 'Unassigned', role: role.title, matchPct, met, total: roleReqs.length })
          }
        })
      })
      roleMatches.sort((a, b) => b.matchPct - a.matchPct)

      // AI & Automation adoption
      const aiCat = cats.find((c: any) => c.name.toLowerCase().includes('ai'))
      const aiSkillIds = aiCat ? new Set(skills.filter((s: any) => s.category_id === aiCat.id).map((s: any) => s.id)) : new Set<string>()
      const aiEs = allEs.filter((e: any) => aiSkillIds.has(e.skill_id))
      const aiEmps = new Set(aiEs.map((e: any) => e.employee_id))
      const aiSkillCounts: Record<string, number> = {}
      aiEs.forEach((e: any) => {
        const name = skillMap.get(e.skill_id)?.name || 'Unknown'
        aiSkillCounts[name] = (aiSkillCounts[name] || 0) + 1
      })
      const aiAdoption = {
        total: aiEs.length,
        employees: aiEmps.size,
        avgProf: aiEs.length > 0 ? Math.round(aiEs.reduce((s: number, e: any) => s + e.proficiency, 0) / aiEs.length * 10) / 10 : 0,
        skills: Object.entries(aiSkillCounts).sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count })),
      }

      setData({
        totalSkills: skills.length, totalEmployees: emps.length, totalEmployeeSkills: allEs.length,
        validated, pending, avgProficiency: Math.round(avgProf * 10) / 10, participationRate,
        topSkills, heatmap, heatmapCategories: catNames, skillGaps, busFactorRisks,
        certsDashboard: { active: activeCerts.length, expiringSoon: expiringSoon.length, expired: expired.length, upcoming },
        trainingNeeds, silentDepts, roleMatches, aiAdoption,
      })
      setLoading(false)
    }
    load()
  }, [companyId])

  if (loading) return <p className="admin-empty">Loading analytics...</p>
  if (!data) return <p className="admin-empty">No data available.</p>

  const sections: { key: typeof section; label: string; icon: string }[] = [
    { key: 'overview', label: 'Overview', icon: '📊' },
    { key: 'heatmap', label: 'Skills Heatmap', icon: '🗺' },
    { key: 'gaps', label: 'Skill Gaps', icon: '⚠' },
    { key: 'bus', label: 'Risk & Succession', icon: '🚨' },
    { key: 'certs', label: 'Certifications', icon: '📜' },
    { key: 'training', label: 'Training Needs', icon: '📚' },
    { key: 'matching', label: 'Role Matching', icon: '🎯' },
    { key: 'ai', label: 'AI Adoption', icon: '🤖' },
  ]

  return (
    <div className="admin-section">
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 20 }}>
        {sections.map(s => (
          <button key={s.key} className={`admin-tab ${section === s.key ? 'admin-tab-active' : ''}`} onClick={() => setSection(s.key)} style={{ fontSize: 13, padding: '6px 12px' }}>
            {s.icon} {s.label}
          </button>
        ))}
      </div>

      {section === 'overview' && <OverviewSection data={data} />}
      {section === 'heatmap' && <HeatmapSection data={data} />}
      {section === 'gaps' && <GapSection data={data} />}
      {section === 'bus' && <BusFactorSection data={data} />}
      {section === 'certs' && <CertsSection data={data} />}
      {section === 'training' && <TrainingSection data={data} />}
      {section === 'matching' && <MatchingSection data={data} />}
      {section === 'ai' && <AISection data={data} />}
    </div>
  )
}

function OverviewSection({ data }: { data: AnalyticsData }) {
  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 12, marginBottom: 24 }}>
        {[
          { v: data.totalSkills, l: 'Skills in Library', c: '' },
          { v: data.totalEmployeeSkills, l: 'Skills Recorded', c: '' },
          { v: data.validated, l: 'Validated', c: '#16a34a' },
          { v: data.pending, l: 'Pending Validation', c: '#f59e0b' },
          { v: data.avgProficiency, l: 'Avg Proficiency', c: '' },
          { v: `${data.participationRate}%`, l: 'Participation Rate', c: data.participationRate < 50 ? '#dc2626' : '#16a34a' },
          { v: data.silentDepts.length, l: 'Depts Not Submitting', c: data.silentDepts.length > 0 ? '#dc2626' : '#16a34a' },
          { v: data.busFactorRisks.length, l: 'Single-Point Risks', c: data.busFactorRisks.filter(r => r.holders.length === 1).length > 0 ? '#dc2626' : '#f59e0b' },
        ].map((m, i) => (
          <div key={i} className="admin-card" style={{ padding: 14, textAlign: 'center' }}>
            <div style={{ fontSize: 26, fontWeight: 700, color: m.c || 'var(--text)' }}>{m.v}</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{m.l}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16 }}>
        <div className="admin-card" style={{ padding: 16 }}>
          <h3 style={{ marginTop: 0, fontSize: 15 }}>Top 10 Skills</h3>
          {data.topSkills.length === 0 && <p className="admin-empty">No data yet.</p>}
          {data.topSkills.map((s, i) => {
            const pct = data.topSkills[0] ? Math.round((s.count / data.topSkills[0].count) * 100) : 0
            return (
              <div key={i} style={{ padding: '5px 0' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 3 }}>
                  <span>{s.name}</span><strong>{s.count}</strong>
                </div>
                <div style={{ height: 6, borderRadius: 3, background: 'var(--border)' }}>
                  <div style={{ height: '100%', borderRadius: 3, width: `${pct}%`, background: '#3b82f6' }} />
                </div>
              </div>
            )
          })}
        </div>

        <div className="admin-card" style={{ padding: 16 }}>
          <h3 style={{ marginTop: 0, fontSize: 15 }}>Department Engagement</h3>
          {data.silentDepts.length > 0 && (
            <div style={{ padding: 10, borderRadius: 8, background: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b', marginBottom: 12, fontSize: 13 }}>
              <strong>No skills submitted:</strong> {data.silentDepts.join(', ')}
            </div>
          )}
          {data.heatmap.map((row, i) => {
            const total = Object.values(row.categories).reduce((a, b) => a + b, 0)
            return (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--border)', fontSize: 13 }}>
                <span>{row.dept}</span>
                <strong>{total} skills</strong>
              </div>
            )
          })}
        </div>
      </div>
    </>
  )
}

function HeatmapSection({ data }: { data: AnalyticsData }) {
  if (data.heatmap.length === 0) return <p className="admin-empty">No department data available.</p>
  const maxVal = Math.max(1, ...data.heatmap.flatMap(r => Object.values(r.categories)))
  function cellColor(val: number) {
    if (val === 0) return 'var(--bg-card)'
    const intensity = Math.min(val / maxVal, 1)
    return `rgba(59, 130, 246, ${0.15 + intensity * 0.7})`
  }
  return (
    <div className="admin-card" style={{ padding: 16 }}>
      <h3 style={{ marginTop: 0, fontSize: 15 }}>Department × Skill Category Heatmap</h3>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '2px solid var(--border)', position: 'sticky', left: 0, background: 'var(--bg-card)', zIndex: 1 }}>Department</th>
              {data.heatmapCategories.map(c => (
                <th key={c} style={{ padding: '6px 4px', borderBottom: '2px solid var(--border)', whiteSpace: 'nowrap', writingMode: 'vertical-rl', transform: 'rotate(180deg)', maxWidth: 32, fontSize: 11 }}>{c}</th>
              ))}
              <th style={{ padding: '6px 8px', borderBottom: '2px solid var(--border)', fontWeight: 700 }}>Total</th>
            </tr>
          </thead>
          <tbody>
            {data.heatmap.map((row, i) => {
              const total = Object.values(row.categories).reduce((a, b) => a + b, 0)
              return (
                <tr key={i}>
                  <td style={{ padding: '6px 8px', borderBottom: '1px solid var(--border)', fontWeight: 500, position: 'sticky', left: 0, background: 'var(--bg-card)', zIndex: 1, whiteSpace: 'nowrap' }}>{row.dept}</td>
                  {data.heatmapCategories.map(c => (
                    <td key={c} style={{ padding: '4px 6px', textAlign: 'center', borderBottom: '1px solid var(--border)', background: cellColor(row.categories[c] || 0), color: (row.categories[c] || 0) > maxVal * 0.5 ? '#fff' : 'var(--text)', fontWeight: (row.categories[c] || 0) > 0 ? 600 : 400 }}>
                      {row.categories[c] || '—'}
                    </td>
                  ))}
                  <td style={{ padding: '4px 8px', textAlign: 'center', borderBottom: '1px solid var(--border)', fontWeight: 700 }}>{total}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function GapSection({ data }: { data: AnalyticsData }) {
  if (data.skillGaps.length === 0) return (
    <div className="admin-card" style={{ padding: 16 }}>
      <h3 style={{ marginTop: 0, fontSize: 15 }}>Skill Gap Analysis</h3>
      <p className="admin-empty">No skill gaps detected. Add role profiles with skill requirements to enable gap analysis.</p>
    </div>
  )
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {data.skillGaps.map((role, ri) => (
        <div key={ri} className="admin-card" style={{ padding: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <h3 style={{ margin: 0, fontSize: 15 }}>{role.role}</h3>
            <span style={{ fontSize: 12, color: 'var(--text-muted)', padding: '2px 8px', borderRadius: 12, background: 'var(--bg-card)', border: '1px solid var(--border)' }}>{role.dept}</span>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '2px solid var(--border)' }}>
                  <th style={{ textAlign: 'left', padding: '6px 8px' }}>Skill</th>
                  <th style={{ textAlign: 'center', padding: '6px 8px' }}>Required</th>
                  <th style={{ textAlign: 'center', padding: '6px 8px' }}>Avg Actual</th>
                  <th style={{ textAlign: 'center', padding: '6px 8px' }}>Qualified Staff</th>
                  <th style={{ textAlign: 'center', padding: '6px 8px' }}>Priority</th>
                </tr>
              </thead>
              <tbody>
                {role.gaps.map((g, gi) => (
                  <tr key={gi} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '6px 8px' }}>{g.skill}</td>
                    <td style={{ textAlign: 'center', padding: '6px 8px' }}>{PROFICIENCY_LABELS[g.required]}</td>
                    <td style={{ textAlign: 'center', padding: '6px 8px', color: g.actual < g.required ? '#dc2626' : '#16a34a', fontWeight: 600 }}>{g.actual || '—'}</td>
                    <td style={{ textAlign: 'center', padding: '6px 8px', color: g.holders === 0 ? '#dc2626' : 'var(--text)' }}>{g.holders}</td>
                    <td style={{ textAlign: 'center', padding: '6px 8px' }}>
                      <span style={{ padding: '2px 8px', borderRadius: 12, fontSize: 11, background: g.essential && g.holders === 0 ? '#fef2f2' : g.essential ? '#fef9c3' : '#f0f9ff', color: g.essential && g.holders === 0 ? '#dc2626' : g.essential ? '#92400e' : '#1e40af' }}>
                        {g.essential && g.holders === 0 ? 'Critical' : g.essential ? 'High' : 'Medium'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  )
}

function BusFactorSection({ data }: { data: AnalyticsData }) {
  const soloRisks = data.busFactorRisks.filter(r => r.holders.length === 1)
  const dualRisks = data.busFactorRisks.filter(r => r.holders.length === 2)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="admin-card" style={{ padding: 16 }}>
        <h3 style={{ marginTop: 0, fontSize: 15, color: '#dc2626' }}>Single-Point-of-Failure Skills ({soloRisks.length})</h3>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 12px' }}>Skills held by only one employee — if they leave, the capability is lost.</p>
        {soloRisks.length === 0 ? <p className="admin-empty">No single-point risks detected.</p> : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead><tr style={{ borderBottom: '2px solid var(--border)' }}><th style={{ textAlign: 'left', padding: '6px 8px' }}>Skill</th><th style={{ textAlign: 'left', padding: '6px 8px' }}>Category</th><th style={{ textAlign: 'left', padding: '6px 8px' }}>Sole Holder</th></tr></thead>
              <tbody>
                {soloRisks.map((r, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid var(--border)', background: '#fef2f2' }}>
                    <td style={{ padding: '6px 8px', fontWeight: 500 }}>{r.skill}</td>
                    <td style={{ padding: '6px 8px', color: 'var(--text-muted)' }}>{r.category}</td>
                    <td style={{ padding: '6px 8px' }}>{r.holders[0]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <div className="admin-card" style={{ padding: 16 }}>
        <h3 style={{ marginTop: 0, fontSize: 15, color: '#f59e0b' }}>Limited Coverage Skills ({dualRisks.length})</h3>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 12px' }}>Skills held by only two employees — succession risk if either leaves.</p>
        {dualRisks.length === 0 ? <p className="admin-empty">No limited-coverage risks detected.</p> : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead><tr style={{ borderBottom: '2px solid var(--border)' }}><th style={{ textAlign: 'left', padding: '6px 8px' }}>Skill</th><th style={{ textAlign: 'left', padding: '6px 8px' }}>Category</th><th style={{ textAlign: 'left', padding: '6px 8px' }}>Holders</th></tr></thead>
              <tbody>
                {dualRisks.map((r, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '6px 8px', fontWeight: 500 }}>{r.skill}</td>
                    <td style={{ padding: '6px 8px', color: 'var(--text-muted)' }}>{r.category}</td>
                    <td style={{ padding: '6px 8px' }}>{r.holders.join(', ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

function CertsSection({ data }: { data: AnalyticsData }) {
  const d = data.certsDashboard
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12 }}>
        <div className="admin-card" style={{ padding: 14, textAlign: 'center' }}>
          <div style={{ fontSize: 28, fontWeight: 700, color: '#16a34a' }}>{d.active}</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Active Certifications</div>
        </div>
        <div className="admin-card" style={{ padding: 14, textAlign: 'center' }}>
          <div style={{ fontSize: 28, fontWeight: 700, color: '#f59e0b' }}>{d.expiringSoon}</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Expiring within 90 days</div>
        </div>
        <div className="admin-card" style={{ padding: 14, textAlign: 'center' }}>
          <div style={{ fontSize: 28, fontWeight: 700, color: '#dc2626' }}>{d.expired}</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Expired</div>
        </div>
      </div>
      {d.upcoming.length > 0 && (
        <div className="admin-card" style={{ padding: 16 }}>
          <h3 style={{ marginTop: 0, fontSize: 15 }}>Expiring Soon</h3>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead><tr style={{ borderBottom: '2px solid var(--border)' }}><th style={{ textAlign: 'left', padding: '6px 8px' }}>Certification</th><th style={{ textAlign: 'left', padding: '6px 8px' }}>Employee</th><th style={{ textAlign: 'left', padding: '6px 8px' }}>Expiry Date</th></tr></thead>
            <tbody>
              {d.upcoming.map((c, i) => (
                <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '6px 8px', fontWeight: 500 }}>{c.name}</td>
                  <td style={{ padding: '6px 8px' }}>{c.employee}</td>
                  <td style={{ padding: '6px 8px', color: '#f59e0b', fontWeight: 500 }}>{c.expiry}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function TrainingSection({ data }: { data: AnalyticsData }) {
  return (
    <div className="admin-card" style={{ padding: 16 }}>
      <h3 style={{ marginTop: 0, fontSize: 15 }}>Training Needs Analysis</h3>
      <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 12px' }}>Skills where employees are below Proficient level — candidates for targeted training investment.</p>
      {data.trainingNeeds.length === 0 ? <p className="admin-empty">No training gaps detected.</p> : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '2px solid var(--border)' }}>
                <th style={{ textAlign: 'left', padding: '6px 8px' }}>Skill</th>
                <th style={{ textAlign: 'left', padding: '6px 8px' }}>Category</th>
                <th style={{ textAlign: 'center', padding: '6px 8px' }}>Avg Proficiency</th>
                <th style={{ textAlign: 'center', padding: '6px 8px' }}>Total Holders</th>
                <th style={{ textAlign: 'center', padding: '6px 8px' }}>Below Proficient</th>
              </tr>
            </thead>
            <tbody>
              {data.trainingNeeds.map((t, i) => (
                <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '6px 8px', fontWeight: 500 }}>{t.skill}</td>
                  <td style={{ padding: '6px 8px', color: 'var(--text-muted)' }}>{t.category}</td>
                  <td style={{ textAlign: 'center', padding: '6px 8px' }}>
                    <span style={{ padding: '2px 8px', borderRadius: 12, fontSize: 12, background: t.avgProf < 2 ? '#fef2f2' : t.avgProf < 3 ? '#fef9c3' : '#f0fdf4', color: t.avgProf < 2 ? '#dc2626' : t.avgProf < 3 ? '#92400e' : '#16a34a' }}>
                      {t.avgProf} — {PROFICIENCY_LABELS[Math.round(t.avgProf)] || 'Foundational'}
                    </span>
                  </td>
                  <td style={{ textAlign: 'center', padding: '6px 8px' }}>{t.count}</td>
                  <td style={{ textAlign: 'center', padding: '6px 8px', color: t.belowProficient > 0 ? '#dc2626' : 'var(--text)', fontWeight: t.belowProficient > 0 ? 600 : 400 }}>{t.belowProficient}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function MatchingSection({ data }: { data: AnalyticsData }) {
  return (
    <div className="admin-card" style={{ padding: 16 }}>
      <h3 style={{ marginTop: 0, fontSize: 15 }}>Internal Role Matching</h3>
      <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 12px' }}>Employees who meet 50%+ of a role profile's skill requirements — candidates for internal mobility or succession.</p>
      {data.roleMatches.length === 0 ? <p className="admin-empty">No matches found. Add role profiles with skill requirements to enable matching.</p> : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '2px solid var(--border)' }}>
                <th style={{ textAlign: 'left', padding: '6px 8px' }}>Employee</th>
                <th style={{ textAlign: 'left', padding: '6px 8px' }}>Current Dept</th>
                <th style={{ textAlign: 'left', padding: '6px 8px' }}>Matching Role</th>
                <th style={{ textAlign: 'center', padding: '6px 8px' }}>Match</th>
                <th style={{ textAlign: 'center', padding: '6px 8px' }}>Skills Met</th>
              </tr>
            </thead>
            <tbody>
              {data.roleMatches.slice(0, 20).map((m, i) => (
                <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '6px 8px', fontWeight: 500 }}>{m.employee}</td>
                  <td style={{ padding: '6px 8px', color: 'var(--text-muted)' }}>{m.dept}</td>
                  <td style={{ padding: '6px 8px' }}>{m.role}</td>
                  <td style={{ textAlign: 'center', padding: '6px 8px' }}>
                    <span style={{ padding: '2px 8px', borderRadius: 12, fontSize: 12, fontWeight: 600, background: m.matchPct >= 80 ? '#dcfce7' : m.matchPct >= 60 ? '#fef9c3' : '#fee2e2', color: m.matchPct >= 80 ? '#16a34a' : m.matchPct >= 60 ? '#92400e' : '#dc2626' }}>
                      {m.matchPct}%
                    </span>
                  </td>
                  <td style={{ textAlign: 'center', padding: '6px 8px' }}>{m.met}/{m.total}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function AISection({ data }: { data: AnalyticsData }) {
  const ai = data.aiAdoption
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12 }}>
        <div className="admin-card" style={{ padding: 14, textAlign: 'center' }}>
          <div style={{ fontSize: 28, fontWeight: 700 }}>{ai.total}</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>AI Skills Recorded</div>
        </div>
        <div className="admin-card" style={{ padding: 14, textAlign: 'center' }}>
          <div style={{ fontSize: 28, fontWeight: 700 }}>{ai.employees}</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Employees with AI Skills</div>
        </div>
        <div className="admin-card" style={{ padding: 14, textAlign: 'center' }}>
          <div style={{ fontSize: 28, fontWeight: 700 }}>{ai.avgProf}</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Avg AI Proficiency</div>
        </div>
        <div className="admin-card" style={{ padding: 14, textAlign: 'center' }}>
          <div style={{ fontSize: 28, fontWeight: 700, color: data.totalEmployees > 0 ? (ai.employees / data.totalEmployees >= 0.5 ? '#16a34a' : '#f59e0b') : '' }}>
            {data.totalEmployees > 0 ? Math.round((ai.employees / data.totalEmployees) * 100) : 0}%
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>AI Adoption Rate</div>
        </div>
      </div>
      <div className="admin-card" style={{ padding: 16 }}>
        <h3 style={{ marginTop: 0, fontSize: 15 }}>AI & Automation Skills Breakdown</h3>
        {ai.skills.length === 0 ? <p className="admin-empty">No AI skills recorded yet.</p> : ai.skills.map((s, i) => {
          const pct = ai.skills[0] ? Math.round((s.count / ai.skills[0].count) * 100) : 0
          return (
            <div key={i} style={{ padding: '5px 0' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 3 }}>
                <span>{s.name}</span><strong>{s.count}</strong>
              </div>
              <div style={{ height: 6, borderRadius: 3, background: 'var(--border)' }}>
                <div style={{ height: '100%', borderRadius: 3, width: `${pct}%`, background: '#8b5cf6' }} />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
