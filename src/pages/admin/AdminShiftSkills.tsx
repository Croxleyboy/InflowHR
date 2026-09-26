import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../../lib/supabase'
import { useAdminCompany } from '../../context/AdminCompanyContext'
import { useToast } from '../../context/ToastContext'

interface ShiftSkill {
  id: string
  company_id: string
  name: string
  is_active: boolean
  created_at: string
}

export default function AdminShiftSkills() {
  const { selectedCompanyId } = useAdminCompany()
  const { showError, showSuccess } = useToast()
  const [skills, setSkills] = useState<ShiftSkill[]>([])
  const [loading, setLoading] = useState(true)
  const [newName, setNewName] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')

  useEffect(() => { if (selectedCompanyId) load() }, [selectedCompanyId])

  async function load() {
    setLoading(true)
    const { data } = await supabase
      .from('shift_skills')
      .select('*')
      .eq('company_id', selectedCompanyId)
      .order('name')
    setSkills((data as ShiftSkill[]) || [])
    setLoading(false)
  }

  async function addSkill() {
    const trimmed = newName.trim()
    if (!trimmed) return
    if (skills.some(s => s.name.toLowerCase() === trimmed.toLowerCase())) {
      showError('A skill with this name already exists')
      return
    }
    const { error } = await supabase.from('shift_skills').insert({ company_id: selectedCompanyId, name: trimmed })
    if (error) { showError('Failed to add skill: ' + error.message); return }
    setNewName('')
    showSuccess('Skill added')
    load()
  }

  async function saveEdit(id: string) {
    const trimmed = editName.trim()
    if (!trimmed) return
    const { error } = await supabase.from('shift_skills').update({ name: trimmed }).eq('id', id)
    if (error) { showError('Failed to update skill: ' + error.message); return }
    setEditingId(null)
    showSuccess('Skill updated')
    load()
  }

  async function toggleActive(skill: ShiftSkill) {
    const { error } = await supabase.from('shift_skills').update({ is_active: !skill.is_active }).eq('id', skill.id)
    if (error) { showError('Failed to update skill: ' + error.message); return }
    setSkills(prev => prev.map(s => s.id === skill.id ? { ...s, is_active: !s.is_active } : s))
  }

  async function deleteSkill(id: string) {
    const { data: usedInTemplates } = await supabase.from('shift_template_skills').select('id').eq('shift_skill_id', id).limit(1)
    const { data: usedByEmployees } = await supabase.from('employee_shift_skills').select('id').eq('shift_skill_id', id).limit(1)
    if ((usedInTemplates && usedInTemplates.length > 0) || (usedByEmployees && usedByEmployees.length > 0)) {
      showError('Cannot delete: this skill is assigned to shifts or employees. Disable it instead.')
      return
    }
    if (!confirm('Delete this skill permanently?')) return
    const { error } = await supabase.from('shift_skills').delete().eq('id', id)
    if (error) { showError('Failed to delete skill: ' + error.message); return }
    showSuccess('Skill deleted')
    load()
  }

  const stats = useMemo(() => ({
    total: skills.length,
    active: skills.filter(s => s.is_active).length,
    inactive: skills.filter(s => !s.is_active).length,
  }), [skills])

  return (
    <>
      <div className="admin-info-banner" style={{ marginBottom: 16 }}>
        <strong>Shift Skills</strong> — Create skills that can be required on shift templates. Employees with matching skills will be eligible for assignment. Skills can also be assigned to employee profiles.
      </div>

      <div className="admin-mini-stats">
        <div className="admin-mini-stat"><span className="admin-mini-value">{stats.total}</span><span>Total Skills</span></div>
        <div className="admin-mini-stat"><span className="admin-mini-value" style={{ color: '#43a047' }}>{stats.active}</span><span>Active</span></div>
        <div className="admin-mini-stat"><span className="admin-mini-value" style={{ color: '#e53935' }}>{stats.inactive}</span><span>Inactive</span></div>
      </div>

      <div className="admin-filters" style={{ gap: 8 }}>
        <input
          className="admin-select"
          style={{ flex: 1, maxWidth: 300 }}
          placeholder="New skill name..."
          value={newName}
          onChange={e => setNewName(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') addSkill() }}
        />
        <button className="admin-btn-sm admin-btn-save" onClick={addSkill} disabled={!newName.trim()}>+ Add Skill</button>
      </div>

      {loading ? <div className="admin-loading">Loading...</div> : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Skill Name</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {skills.map(s => (
                <tr key={s.id}>
                  <td>
                    {editingId === s.id ? (
                      <input
                        className="admin-inline-input"
                        value={editName}
                        onChange={e => setEditName(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') saveEdit(s.id) }}
                        autoFocus
                      />
                    ) : s.name}
                  </td>
                  <td>
                    <span className={`admin-badge ${s.is_active ? 'admin-badge-approved' : 'admin-badge-rejected'}`}>
                      {s.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="admin-actions">
                    {editingId === s.id ? (
                      <>
                        <button className="admin-btn-sm admin-btn-save" onClick={() => saveEdit(s.id)}>Save</button>
                        <button className="admin-btn-sm admin-btn-cancel" onClick={() => setEditingId(null)}>Cancel</button>
                      </>
                    ) : (
                      <>
                        <button className="admin-btn-icon" title="Edit" onClick={() => { setEditingId(s.id); setEditName(s.name) }}>
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                        </button>
                        <button className="admin-btn-icon" title={s.is_active ? 'Disable' : 'Enable'} onClick={() => toggleActive(s)}>
                          {s.is_active ? (
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#e53935" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>
                          ) : (
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#43a047" strokeWidth="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
                          )}
                        </button>
                        <button className="admin-btn-icon admin-btn-danger" title="Delete" onClick={() => deleteSkill(s.id)}>
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
              {skills.length === 0 && (
                <tr><td colSpan={3} style={{ textAlign: 'center', padding: 32, color: '#999' }}>No shift skills created yet. Add one above to get started.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}
