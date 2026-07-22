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
}

const PERSONA_TAGS = ['new-starter', 'offboarding', 'sales', 'marketing', 'finance', 'engineering', 'management', 'all-staff', 'compliance', 'hr']

const INITIAL_CATALOG: CatalogItem[] = [
  { id: '1', title: 'Welcome to the Company', description: 'Introduction video covering company history, mission, and values.', type: 'video', duration: '12 min', tags: ['new-starter', 'all-staff'], mandatory: true, active: true },
  { id: '2', title: 'IT Systems Setup Guide', description: 'Step-by-step guide to setting up your laptop, email, VPN and collaboration tools.', type: 'how-to', duration: '8 min', tags: ['new-starter'], mandatory: true, active: true },
  { id: '3', title: 'Data Protection & GDPR', description: 'UK GDPR responsibilities, data handling, breach reporting and secure disposal.', type: 'quiz', duration: '20 min', tags: ['all-staff', 'compliance'], mandatory: true, active: true },
  { id: '4', title: 'Health & Safety Essentials', description: 'Fire safety, first aid, DSE assessments and incident reporting procedures.', type: 'quiz', duration: '25 min', tags: ['all-staff', 'compliance'], mandatory: true, active: true },
  { id: '5', title: 'Anti-Bribery & Ethics', description: 'Understanding the UK Bribery Act, gifts policy and whistleblowing procedures.', type: 'quiz', duration: '15 min', tags: ['all-staff', 'compliance'], mandatory: true, active: true },
  { id: '6', title: 'Employee Handbook Overview', description: 'Key policies including leave, dress code, disciplinary and grievance processes.', type: 'document', duration: '10 min', tags: ['new-starter', 'all-staff'], mandatory: false, active: true },
  { id: '7', title: 'Expenses Policy', description: 'How to submit claims, what is covered, receipt requirements and approval workflows.', type: 'document', duration: '5 min', tags: ['new-starter', 'all-staff'], mandatory: false, active: true },
  { id: '8', title: 'Sales Methodology & CRM', description: 'Our sales process, pipeline management and how to use the CRM effectively.', type: 'video', duration: '30 min', tags: ['sales'], mandatory: false, active: true },
  { id: '9', title: 'Marketing Brand Guidelines', description: 'Brand identity, tone of voice, logo usage and template library access.', type: 'article', duration: '15 min', tags: ['marketing'], mandatory: false, active: true },
  { id: '10', title: 'Finance Month-End Process', description: 'Step-by-step guide to the monthly close process and reporting deadlines.', type: 'how-to', duration: '20 min', tags: ['finance'], mandatory: false, active: true },
  { id: '11', title: 'Agile at Kumonix', description: 'Sprint ceremonies, story writing, estimation and Jira/Confluence workflows.', type: 'video', duration: '30 min', tags: ['engineering'], mandatory: false, active: true },
  { id: '12', title: 'Leadership Foundations', description: 'Delegation, coaching, performance management and building team trust.', type: 'video', duration: '35 min', tags: ['management'], mandatory: false, active: true },
  { id: '13', title: 'Offboarding Checklist', description: 'Steps for returning equipment, handover process and exit interview guidance.', type: 'document', duration: '8 min', tags: ['offboarding', 'hr'], mandatory: false, active: true },
  { id: '14', title: 'What is our EAP?', description: 'How to access the Employee Assistance Programme for mental health and wellbeing support.', type: 'faq', duration: '5 min', tags: ['all-staff'], mandatory: false, active: true },
  { id: '15', title: 'Remote Working Best Practices', description: 'Tips for staying productive, ergonomic setup, and maintaining team connection.', type: 'article', duration: '10 min', tags: ['all-staff'], mandatory: false, active: true },
  { id: '16', title: 'Presentation Skills Workshop', description: 'Slide design, storytelling, handling Q&A and presenting remotely.', type: 'video', duration: '22 min', tags: ['all-staff'], mandatory: false, active: true },
]

const TYPE_ICONS: Record<ContentType, string> = {
  video: '🎬', article: '📄', quiz: '❓', faq: '💬', document: '📋', 'how-to': '🔧',
}

export default function AdminELearning() {
  const [catalog, setCatalog] = useState<CatalogItem[]>(INITIAL_CATALOG)
  const [filterTag, setFilterTag] = useState('')
  const [filterType, setFilterType] = useState('')
  const [search, setSearch] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<Record<string, any>>({})
  const [showAddForm, setShowAddForm] = useState(false)
  const [newItem, setNewItem] = useState<Partial<CatalogItem>>({ title: '', description: '', type: 'article', duration: '', tags: [], mandatory: false, active: true })

  function filteredCatalog() {
    return catalog.filter(item => {
      if (filterTag && !item.tags.includes(filterTag)) return false
      if (filterType && item.type !== filterType) return false
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
    setCatalog(prev => [...prev, { id, title: newItem.title || '', description: newItem.description || '', type: (newItem.type || 'article') as ContentType, duration: newItem.duration || '5 min', tags: newItem.tags || [], mandatory: newItem.mandatory || false, active: true }])
    setNewItem({ title: '', description: '', type: 'article', duration: '', tags: [], mandatory: false, active: true })
    setShowAddForm(false)
  }

  return (
    <div className="admin-section">
      <div className="admin-page-header">
        <h2>E-Learning Content Management</h2>
        <p>{catalog.length} items in catalog · {catalog.filter(c => c.mandatory).length} mandatory</p>
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
            <div className="admin-form-field admin-form-field-full">
              <label>Description</label>
              <textarea className="admin-textarea" value={newItem.description || ''} onChange={e => setNewItem(f => ({...f, description: e.target.value}))} />
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
          </div>
          <button className="admin-btn admin-btn-primary" onClick={addNewItem}>Add to Catalog</button>
        </div>
      )}

      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead><tr><th>Type</th><th>Title</th><th>Duration</th><th>Tags</th><th>Mandatory</th><th>Active</th><th>Actions</th></tr></thead>
          <tbody>
            {filteredCatalog().map(item => (
              <tr key={item.id}>
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
                <td>{editingId === item.id ? <label className="admin-toggle-label"><input type="checkbox" checked={editForm.active} onChange={e => setEditForm(f => ({...f, active: e.target.checked}))} /></label> : (item.active ? '✓' : '—')}</td>
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
