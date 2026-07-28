import { useState } from 'react'

type ContentType = 'video' | 'article' | 'quiz' | 'faq' | 'document' | 'how-to'

interface CatalogItem {
  id: string
  title: string
  description: string
  type: ContentType
  duration: string
  tags: string[]
  mandatory: boolean
  active: boolean
  annualReminder: boolean
  industry: string
  externalUrl: string
}

const PERSONA_TAGS = ['new-starter', 'offboarding', 'sales', 'marketing', 'finance', 'engineering', 'management', 'all-staff', 'compliance', 'hr']
const INDUSTRY_OPTIONS = ['', 'legal', 'education', 'accountancy']

const INITIAL_CATALOG: CatalogItem[] = [
  // ── Common / All Industries ──
  { id: '1', title: 'Welcome to the Company', description: 'Introduction video covering company history, mission, and values.', type: 'video', duration: '12 min', tags: ['new-starter', 'all-staff'], mandatory: true, active: true, annualReminder: false, industry: '', externalUrl: '' },
  { id: '2', title: 'IT Systems Setup Guide', description: 'Step-by-step guide to setting up your laptop, email, VPN and collaboration tools.', type: 'how-to', duration: '8 min', tags: ['new-starter'], mandatory: true, active: true, annualReminder: false, industry: '', externalUrl: '' },
  { id: '3', title: 'Our Culture & Ways of Working', description: 'How we collaborate, flexible working policy, meeting etiquette and team behaviours.', type: 'video', duration: '15 min', tags: ['new-starter', 'all-staff'], mandatory: true, active: true, annualReminder: false, industry: '', externalUrl: '' },
  { id: '4', title: 'Data Protection & GDPR', description: 'UK GDPR responsibilities, data handling, breach reporting and secure disposal.', type: 'quiz', duration: '20 min', tags: ['all-staff', 'compliance'], mandatory: true, active: true, annualReminder: true, industry: '', externalUrl: '' },
  { id: '5', title: 'Health & Safety Essentials', description: 'Fire safety, first aid, DSE assessments and incident reporting procedures.', type: 'quiz', duration: '25 min', tags: ['all-staff', 'compliance'], mandatory: true, active: true, annualReminder: true, industry: '', externalUrl: '' },
  { id: '6', title: 'Anti-Bribery & Ethics', description: 'Understanding the UK Bribery Act, gifts policy and whistleblowing procedures.', type: 'quiz', duration: '15 min', tags: ['all-staff', 'compliance'], mandatory: true, active: true, annualReminder: true, industry: '', externalUrl: '' },
  { id: '7', title: 'Cyber Security Awareness', description: 'Phishing, password hygiene, social engineering, device security and reporting incidents.', type: 'quiz', duration: '20 min', tags: ['all-staff', 'compliance'], mandatory: true, active: true, annualReminder: true, industry: '', externalUrl: '' },
  { id: '8', title: 'Diversity, Equity & Inclusion', description: 'Unconscious bias, inclusive behaviours, microaggressions and fostering belonging.', type: 'video', duration: '25 min', tags: ['all-staff', 'compliance'], mandatory: true, active: true, annualReminder: true, industry: '', externalUrl: '' },
  { id: '9', title: 'Modern Slavery Awareness', description: 'Recognising signs of modern slavery, reporting obligations and supply chain due diligence.', type: 'quiz', duration: '15 min', tags: ['all-staff', 'compliance'], mandatory: true, active: true, annualReminder: true, industry: '', externalUrl: '' },
  { id: '10', title: 'Fire Safety & Evacuation', description: 'Fire prevention, evacuation procedures, assembly points and fire warden responsibilities.', type: 'quiz', duration: '15 min', tags: ['all-staff', 'compliance'], mandatory: true, active: true, annualReminder: true, industry: '', externalUrl: '' },
  { id: '11', title: 'Mental Health First Aid', description: 'Recognising mental health warning signs, supportive conversations and signposting resources.', type: 'video', duration: '30 min', tags: ['all-staff', 'compliance'], mandatory: false, active: true, annualReminder: false, industry: '', externalUrl: '' },
  { id: '12', title: 'Environmental Awareness', description: 'Sustainability policy, waste management, energy reduction and green commuting.', type: 'article', duration: '15 min', tags: ['all-staff', 'compliance'], mandatory: false, active: true, annualReminder: false, industry: '', externalUrl: '' },
  { id: '13', title: 'Employee Handbook Overview', description: 'Key policies including leave, dress code, disciplinary and grievance processes.', type: 'document', duration: '10 min', tags: ['new-starter', 'all-staff'], mandatory: false, active: true, annualReminder: false, industry: '', externalUrl: '' },
  { id: '14', title: 'Expenses Policy', description: 'How to submit claims, what is covered, receipt requirements and approval workflows.', type: 'document', duration: '5 min', tags: ['new-starter', 'all-staff'], mandatory: false, active: true, annualReminder: false, industry: '', externalUrl: '' },
  { id: '15', title: 'Remote Working Best Practices', description: 'Productivity tips, ergonomic setup, maintaining team connection and work-life balance.', type: 'article', duration: '10 min', tags: ['all-staff'], mandatory: false, active: true, annualReminder: false, industry: '', externalUrl: '' },
  { id: '16', title: 'Social Media Policy', description: 'Acceptable use, representing the company online, confidentiality and personal vs professional accounts.', type: 'document', duration: '8 min', tags: ['all-staff'], mandatory: false, active: true, annualReminder: false, industry: '', externalUrl: '' },
  { id: '17', title: 'Agile Methodology', description: 'Sprint ceremonies, story writing, estimation and Jira/Confluence workflows.', type: 'video', duration: '30 min', tags: ['engineering'], mandatory: false, active: true, annualReminder: false, industry: '', externalUrl: '' },
  { id: '18', title: 'Presentation Skills Workshop', description: 'Slide design, storytelling, handling Q&A and presenting remotely.', type: 'video', duration: '22 min', tags: ['all-staff'], mandatory: false, active: true, annualReminder: false, industry: '', externalUrl: '' },
  { id: '19', title: 'Time Management & Prioritisation', description: 'Eisenhower matrix, time-boxing, managing competing priorities and saying no effectively.', type: 'article', duration: '12 min', tags: ['all-staff'], mandatory: false, active: true, annualReminder: false, industry: '', externalUrl: '' },
  { id: '20', title: 'Conflict Resolution', description: 'De-escalation techniques, mediation basics and having difficult conversations professionally.', type: 'video', duration: '18 min', tags: ['all-staff', 'management'], mandatory: false, active: true, annualReminder: false, industry: '', externalUrl: '' },
  { id: '21', title: 'Leadership Foundations', description: 'Delegation, coaching, performance management and building team trust.', type: 'video', duration: '35 min', tags: ['management'], mandatory: false, active: true, annualReminder: false, industry: '', externalUrl: '' },
  { id: '22', title: 'Giving & Receiving Feedback', description: 'The SBI model, constructive feedback, receiving feedback gracefully and continuous improvement.', type: 'article', duration: '12 min', tags: ['all-staff'], mandatory: false, active: true, annualReminder: false, industry: '', externalUrl: '' },
  { id: '23', title: 'Coaching Skills for Managers', description: 'GROW model, active listening, asking powerful questions and developing your team members.', type: 'video', duration: '25 min', tags: ['management'], mandatory: false, active: true, annualReminder: false, industry: '', externalUrl: '' },
  { id: '24', title: 'Project Management Essentials', description: 'Planning, risk management, stakeholder communication, PRINCE2 and Agile hybrid approaches.', type: 'video', duration: '30 min', tags: ['management', 'all-staff'], mandatory: false, active: true, annualReminder: false, industry: '', externalUrl: '' },
  { id: '25', title: 'Managing Stress & Resilience', description: 'Strategies for workplace stress, building resilience, recognising burnout and EAP access.', type: 'video', duration: '18 min', tags: ['all-staff'], mandatory: false, active: true, annualReminder: false, industry: '', externalUrl: '' },
  { id: '26', title: 'Workspace Ergonomics', description: 'Desk, chair and monitor setup at home and in the office. Self-assessment checklist included.', type: 'article', duration: '8 min', tags: ['all-staff'], mandatory: false, active: true, annualReminder: false, industry: '', externalUrl: '' },
  { id: '27', title: 'Financial Wellbeing', description: 'Pension basics, budgeting, employee benefits, salary sacrifice and financial support resources.', type: 'article', duration: '15 min', tags: ['all-staff'], mandatory: false, active: true, annualReminder: false, industry: '', externalUrl: '' },
  { id: '28', title: 'Offboarding Checklist', description: 'Returning equipment, handover process, exit interview and final pay guidance.', type: 'document', duration: '8 min', tags: ['offboarding', 'hr'], mandatory: false, active: true, annualReminder: false, industry: '', externalUrl: '' },

  // ── Legal Industry ──
  { id: '100', title: 'SRA Standards & Regulations', description: 'Core SRA principles, Codes of Conduct for solicitors and firms, and reporting obligations.', type: 'quiz', duration: '30 min', tags: ['compliance'], mandatory: true, active: true, annualReminder: true, industry: 'legal', externalUrl: '' },
  { id: '101', title: 'Anti-Money Laundering (Legal)', description: 'MLR 2017 obligations, client due diligence, suspicious activity reports and firm-wide risk assessments.', type: 'quiz', duration: '25 min', tags: ['compliance'], mandatory: true, active: true, annualReminder: true, industry: 'legal', externalUrl: '' },
  { id: '102', title: 'Conflicts of Interest', description: 'Identifying conflicts, information barriers, client consent and SRA reporting requirements.', type: 'quiz', duration: '20 min', tags: ['compliance'], mandatory: true, active: true, annualReminder: true, industry: 'legal', externalUrl: '' },
  { id: '103', title: 'Client Money Handling', description: 'SRA Accounts Rules, client vs office accounts, interest policies and reconciliation procedures.', type: 'quiz', duration: '20 min', tags: ['compliance', 'finance'], mandatory: true, active: true, annualReminder: true, industry: 'legal', externalUrl: '' },
  { id: '104', title: 'Professional Ethics in Law', description: 'Duty of confidentiality, legal privilege, duty to the court and ethical dilemma case studies.', type: 'video', duration: '25 min', tags: ['compliance'], mandatory: false, active: true, annualReminder: false, industry: 'legal', externalUrl: '' },
  { id: '105', title: 'CPD Requirements (Legal)', description: 'SRA competence statement, reflective practice, recording CPD and annual declaration process.', type: 'article', duration: '10 min', tags: ['compliance'], mandatory: false, active: true, annualReminder: false, industry: 'legal', externalUrl: '' },

  // ── Education Industry ──
  { id: '200', title: 'Safeguarding Children & Young People', description: 'KCSIE guidance, recognising abuse indicators, referral procedures and designated safeguarding lead role.', type: 'quiz', duration: '35 min', tags: ['compliance'], mandatory: true, active: true, annualReminder: true, industry: 'education', externalUrl: '' },
  { id: '201', title: 'Prevent Duty Training', description: 'Counter-terrorism obligations, radicalisation indicators, Channel programme referrals and British Values.', type: 'quiz', duration: '25 min', tags: ['compliance'], mandatory: true, active: true, annualReminder: true, industry: 'education', externalUrl: '' },
  { id: '202', title: 'SEND Awareness', description: 'SEND Code of Practice, EHC plans, reasonable adjustments, inclusive teaching strategies and graduated approach.', type: 'video', duration: '30 min', tags: ['compliance'], mandatory: true, active: true, annualReminder: true, industry: 'education', externalUrl: '' },
  { id: '203', title: 'Online Safety in Education', description: 'Filtering and monitoring, social media risks, sexting protocols and age-appropriate content policies.', type: 'quiz', duration: '20 min', tags: ['compliance'], mandatory: true, active: true, annualReminder: true, industry: 'education', externalUrl: '' },
  { id: '204', title: 'Behaviour Management', description: 'Positive behaviour strategies, de-escalation techniques, restorative practice and sanctions frameworks.', type: 'video', duration: '25 min', tags: ['all-staff'], mandatory: false, active: true, annualReminder: false, industry: 'education', externalUrl: '' },
  { id: '205', title: 'Ofsted Readiness', description: 'Inspection framework, quality of education judgements, evidence gathering and preparation checklist.', type: 'article', duration: '20 min', tags: ['management'], mandatory: false, active: true, annualReminder: false, industry: 'education', externalUrl: '' },

  // ── Accountancy Industry ──
  { id: '300', title: 'Anti-Money Laundering (Accountancy)', description: 'MLR 2017 for accountants, client due diligence, suspicious activity reports and firm procedures.', type: 'quiz', duration: '25 min', tags: ['compliance'], mandatory: true, active: true, annualReminder: true, industry: 'accountancy', externalUrl: '' },
  { id: '301', title: 'Professional Ethics (ICAEW/ACCA)', description: 'Fundamental principles, threats and safeguards, independence requirements and ethical dilemmas.', type: 'quiz', duration: '20 min', tags: ['compliance'], mandatory: true, active: true, annualReminder: true, industry: 'accountancy', externalUrl: '' },
  { id: '302', title: 'Tax Legislation Update', description: 'Annual tax changes, HMRC guidance updates, Making Tax Digital requirements and key compliance deadlines.', type: 'video', duration: '30 min', tags: ['compliance'], mandatory: true, active: true, annualReminder: true, industry: 'accountancy', externalUrl: '' },
  { id: '303', title: 'Auditing Standards Update', description: 'ISA revisions, going concern requirements, audit quality indicators and FRC expectations.', type: 'quiz', duration: '25 min', tags: ['compliance'], mandatory: true, active: true, annualReminder: true, industry: 'accountancy', externalUrl: '' },
  { id: '304', title: 'Client Confidentiality & Data', description: 'Duty of confidentiality, data sharing protocols, engagement letters and conflict checks for accountants.', type: 'quiz', duration: '15 min', tags: ['compliance'], mandatory: true, active: true, annualReminder: true, industry: 'accountancy', externalUrl: '' },
  { id: '305', title: 'CPD Requirements (Accountancy)', description: 'ICAEW/ACCA CPD policy, verifiable and non-verifiable hours, recording and annual return submission.', type: 'article', duration: '10 min', tags: ['compliance'], mandatory: false, active: true, annualReminder: false, industry: 'accountancy', externalUrl: '' },
]

const TYPE_ICONS: Record<ContentType, string> = {
  video: '🎬', article: '📄', quiz: '❓', faq: '💬', document: '📋', 'how-to': '🔧',
}

const INDUSTRY_LABELS: Record<string, string> = {
  '': 'All Industries',
  legal: 'Legal',
  education: 'Education',
  accountancy: 'Accountancy',
}

export default function AdminELearning() {
  const [catalog, setCatalog] = useState<CatalogItem[]>(INITIAL_CATALOG)
  const [filterTag, setFilterTag] = useState('')
  const [filterType, setFilterType] = useState('')
  const [filterIndustry, setFilterIndustry] = useState('')
  const [search, setSearch] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<Record<string, any>>({})
  const [showAddForm, setShowAddForm] = useState(false)
  const [newItem, setNewItem] = useState<Partial<CatalogItem>>({ title: '', description: '', type: 'article', duration: '', tags: [], mandatory: false, active: true, annualReminder: false, industry: '', externalUrl: '' })

  function filteredCatalog() {
    return catalog.filter(item => {
      if (filterTag && !item.tags.includes(filterTag)) return false
      if (filterType && item.type !== filterType) return false
      if (filterIndustry && item.industry !== filterIndustry) return false
      if (search && !`${item.title} ${item.description}`.toLowerCase().includes(search.toLowerCase())) return false
      return true
    })
  }

  function startEdit(item: CatalogItem) {
    setEditingId(item.id)
    setEditForm({ ...item, tags: [...item.tags] })
  }

  function saveEdit(id: string) {
    setCatalog(prev => prev.map(item => item.id === id ? { ...item, ...editForm } as CatalogItem : item))
    setEditingId(null)
  }

  function deleteItem(id: string) {
    if (!confirm('Remove this content from the catalog?')) return
    setCatalog(prev => prev.filter(item => item.id !== id))
  }

  function toggleTag(tag: string) {
    setEditForm(f => {
      const tags = f.tags as string[]
      return { ...f, tags: tags.includes(tag) ? tags.filter((t: string) => t !== tag) : [...tags, tag] }
    })
  }

  function toggleNewTag(tag: string) {
    setNewItem(f => {
      const tags = f.tags || []
      return { ...f, tags: tags.includes(tag) ? tags.filter(t => t !== tag) : [...tags, tag] }
    })
  }

  function addNewItem() {
    if (!newItem.title?.trim()) return
    const id = String(Date.now())
    setCatalog(prev => [...prev, { id, title: newItem.title || '', description: newItem.description || '', type: (newItem.type || 'article') as ContentType, duration: newItem.duration || '5 min', tags: newItem.tags || [], mandatory: newItem.mandatory || false, active: true, annualReminder: newItem.annualReminder || false, industry: newItem.industry || '', externalUrl: newItem.externalUrl || '' }])
    setNewItem({ title: '', description: '', type: 'article', duration: '', tags: [], mandatory: false, active: true, annualReminder: false, industry: '', externalUrl: '' })
    setShowAddForm(false)
  }

  const [selected, setSelected] = useState<Set<string>>(new Set())

  function toggleActive(id: string) {
    setCatalog(prev => prev.map(item => item.id === id ? { ...item, active: !item.active } : item))
  }

  function toggleSelect(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  function toggleSelectAll() {
    const visible = filteredCatalog()
    const allSelected = visible.every(item => selected.has(item.id))
    if (allSelected) {
      setSelected(prev => {
        const next = new Set(prev)
        visible.forEach(item => next.delete(item.id))
        return next
      })
    } else {
      setSelected(prev => {
        const next = new Set(prev)
        visible.forEach(item => next.add(item.id))
        return next
      })
    }
  }

  function bulkSetActive(active: boolean) {
    setCatalog(prev => prev.map(item => selected.has(item.id) ? { ...item, active } : item))
    setSelected(new Set())
  }

  const annualCount = catalog.filter(c => c.annualReminder && c.active).length
  const industryCount = catalog.filter(c => c.industry && c.active).length
  const visibleItems = filteredCatalog()
  const allVisibleSelected = visibleItems.length > 0 && visibleItems.every(item => selected.has(item.id))
  const someVisibleSelected = visibleItems.some(item => selected.has(item.id))

  return (
    <div className="admin-section">
      <div className="admin-page-header">
        <h2>E-Learning Content Management</h2>
        <p>{catalog.length} items in catalog · {catalog.filter(c => c.mandatory).length} mandatory · {annualCount} annual renewal · {industryCount} industry-specific</p>
      </div>

      <div className="admin-filters">
        <input placeholder="Search content..." value={search} onChange={e => setSearch(e.target.value)} className="admin-input admin-search" />
        <select value={filterTag} onChange={e => setFilterTag(e.target.value)} className="admin-select">
          <option value="">All Personas</option>
          {PERSONA_TAGS.map(t => <option key={t} value={t}>{t.replace('-', ' ')}</option>)}
        </select>
        <select value={filterType} onChange={e => setFilterType(e.target.value)} className="admin-select">
          <option value="">All Types</option>
          <option value="video">Video</option><option value="article">Article</option><option value="quiz">Quiz</option>
          <option value="faq">FAQ</option><option value="document">Document</option><option value="how-to">How-To</option>
        </select>
        <select value={filterIndustry} onChange={e => setFilterIndustry(e.target.value)} className="admin-select">
          {INDUSTRY_OPTIONS.map(i => <option key={i} value={i}>{INDUSTRY_LABELS[i]}</option>)}
        </select>
        <button className="admin-btn admin-btn-primary" onClick={() => setShowAddForm(!showAddForm)}>
          {showAddForm ? 'Cancel' : '+ Add Content'}
        </button>
      </div>

      {showAddForm && (
        <div className="admin-add-form">
          <h3>Add New Content</h3>
          <div className="admin-form-grid">
            <div className="admin-form-field">
              <label>Title</label>
              <input className="admin-input" value={newItem.title || ''} onChange={e => setNewItem(f => ({...f, title: e.target.value}))} />
            </div>
            <div className="admin-form-field">
              <label>Type</label>
              <select className="admin-select" value={newItem.type} onChange={e => setNewItem(f => ({...f, type: e.target.value as ContentType}))}>
                <option value="video">Video</option><option value="article">Article</option><option value="quiz">Quiz</option>
                <option value="faq">FAQ</option><option value="document">Document</option><option value="how-to">How-To</option>
              </select>
            </div>
            <div className="admin-form-field">
              <label>Duration</label>
              <input className="admin-input" placeholder="e.g. 15 min" value={newItem.duration || ''} onChange={e => setNewItem(f => ({...f, duration: e.target.value}))} />
            </div>
            <div className="admin-form-field">
              <label>Industry</label>
              <select className="admin-select" value={newItem.industry || ''} onChange={e => setNewItem(f => ({...f, industry: e.target.value}))}>
                {INDUSTRY_OPTIONS.map(i => <option key={i} value={i}>{INDUSTRY_LABELS[i]}</option>)}
              </select>
            </div>
            <div className="admin-form-field admin-form-field-full">
              <label>Description</label>
              <textarea className="admin-textarea" value={newItem.description || ''} onChange={e => setNewItem(f => ({...f, description: e.target.value}))} />
            </div>
            <div className="admin-form-field admin-form-field-full">
              <label>External URL <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>(leave blank to use built-in content viewer)</span></label>
              <input className="admin-input" placeholder="https://..." value={newItem.externalUrl || ''} onChange={e => setNewItem(f => ({...f, externalUrl: e.target.value}))} />
            </div>
            <div className="admin-form-field admin-form-field-full">
              <label>Persona Tags</label>
              <div className="admin-tag-picker">
                {PERSONA_TAGS.map(tag => (
                  <button key={tag} className={`admin-tag-pick ${(newItem.tags || []).includes(tag) ? 'admin-tag-pick-active' : ''}`} onClick={() => toggleNewTag(tag)}>
                    {tag.replace('-', ' ')}
                  </button>
                ))}
              </div>
            </div>
            <div className="admin-form-field">
              <label className="admin-toggle-label"><input type="checkbox" checked={newItem.mandatory || false} onChange={e => setNewItem(f => ({...f, mandatory: e.target.checked}))} /> Mandatory</label>
            </div>
            <div className="admin-form-field">
              <label className="admin-toggle-label"><input type="checkbox" checked={newItem.annualReminder || false} onChange={e => setNewItem(f => ({...f, annualReminder: e.target.checked}))} /> Annual Renewal</label>
            </div>
          </div>
          <button className="admin-btn admin-btn-primary" onClick={addNewItem}>Add to Catalog</button>
        </div>
      )}

      {selected.size > 0 && (
        <div className="admin-bulk-bar">
          <span>{selected.size} selected</span>
          <button className="admin-btn-sm admin-btn-activate" onClick={() => bulkSetActive(true)}>Activate</button>
          <button className="admin-btn-sm admin-btn-deactivate" onClick={() => bulkSetActive(false)}>Deactivate</button>
          <button className="admin-btn-sm admin-btn-cancel" onClick={() => setSelected(new Set())}>Clear</button>
        </div>
      )}

      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead><tr>
            <th className="admin-th-check"><input type="checkbox" checked={allVisibleSelected} ref={el => { if (el) el.indeterminate = someVisibleSelected && !allVisibleSelected }} onChange={toggleSelectAll} /></th>
            <th>Type</th><th>Title</th><th>Duration</th><th>Industry</th><th>External URL</th><th>Tags</th><th>Mandatory</th><th>Annual</th><th>Active</th><th>Actions</th>
          </tr></thead>
          <tbody>
            {visibleItems.map(item => (
              <tr key={item.id} className={!item.active ? 'admin-row-inactive' : ''}>
                <td className="admin-td-check"><input type="checkbox" checked={selected.has(item.id)} onChange={() => toggleSelect(item.id)} /></td>
                <td><span className="admin-type-icon">{TYPE_ICONS[item.type]}</span> {editingId === item.id ? (
                  <select className="admin-inline-select" value={editForm.type} onChange={e => setEditForm(f => ({...f, type: e.target.value}))}>
                    <option value="video">Video</option><option value="article">Article</option><option value="quiz">Quiz</option>
                    <option value="faq">FAQ</option><option value="document">Document</option><option value="how-to">How-To</option>
                  </select>
                ) : item.type}</td>
                <td>{editingId === item.id ? (
                  <div>
                    <input className="admin-inline-input" value={editForm.title} onChange={e => setEditForm(f => ({...f, title: e.target.value}))} />
                    <textarea className="admin-inline-textarea" value={editForm.description} onChange={e => setEditForm(f => ({...f, description: e.target.value}))} />
                  </div>
                ) : (
                  <div><strong>{item.title}</strong><br/><span className="admin-td-desc">{item.description}</span></div>
                )}</td>
                <td>{editingId === item.id ? <input className="admin-inline-input admin-inline-sm" value={editForm.duration} onChange={e => setEditForm(f => ({...f, duration: e.target.value}))} /> : item.duration}</td>
                <td>{editingId === item.id ? (
                  <select className="admin-inline-select" value={editForm.industry || ''} onChange={e => setEditForm(f => ({...f, industry: e.target.value}))}>
                    {INDUSTRY_OPTIONS.map(i => <option key={i} value={i}>{INDUSTRY_LABELS[i] || 'Common'}</option>)}
                  </select>
                ) : (item.industry ? <span className="admin-tag-mini">{item.industry}</span> : <span style={{ opacity: 0.4 }}>—</span>)}</td>
                <td>{editingId === item.id ? (
                  <input className="admin-inline-input" placeholder="https://..." value={editForm.externalUrl || ''} onChange={e => setEditForm(f => ({...f, externalUrl: e.target.value}))} />
                ) : (item.externalUrl ? <a href={item.externalUrl} target="_blank" rel="noopener noreferrer" className="admin-external-link" title={item.externalUrl}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                </a> : <span style={{ opacity: 0.4, fontSize: 11 }}>Built-in</span>)}</td>
                <td>{editingId === item.id ? (
                  <div className="admin-tag-picker admin-tag-picker-sm">
                    {PERSONA_TAGS.map(tag => (
                      <button key={tag} className={`admin-tag-pick admin-tag-pick-sm ${(editForm.tags as string[]).includes(tag) ? 'admin-tag-pick-active' : ''}`} onClick={() => toggleTag(tag)}>
                        {tag.replace('-', ' ')}
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="admin-tag-list-inline">{item.tags.map(t => <span key={t} className="admin-tag-mini">{t.replace('-', ' ')}</span>)}</div>
                )}</td>
                <td>{editingId === item.id ? <label className="admin-toggle-label"><input type="checkbox" checked={editForm.mandatory} onChange={e => setEditForm(f => ({...f, mandatory: e.target.checked}))} /></label> : (item.mandatory ? '✓' : '—')}</td>
                <td>{editingId === item.id ? <label className="admin-toggle-label"><input type="checkbox" checked={editForm.annualReminder} onChange={e => setEditForm(f => ({...f, annualReminder: e.target.checked}))} /></label> : (item.annualReminder ? '🔔' : '—')}</td>
                <td><label className="admin-toggle-switch"><input type="checkbox" checked={item.active} onChange={() => toggleActive(item.id)} /><span className="admin-toggle-slider" /></label></td>
                <td className="admin-actions">
                  {editingId === item.id ? (
                    <>
                      <button className="admin-btn-sm admin-btn-save" onClick={() => saveEdit(item.id)}>Save</button>
                      <button className="admin-btn-sm admin-btn-cancel" onClick={() => setEditingId(null)}>Cancel</button>
                    </>
                  ) : (
                    <>
                      <button className="admin-btn-icon" onClick={() => startEdit(item)}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                      </button>
                      <button className="admin-btn-icon admin-btn-danger" onClick={() => deleteItem(item.id)}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                      </button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filteredCatalog().length === 0 && <div className="admin-empty">No content matches your filters</div>}
      </div>
    </div>
  )
}
