import { useState, useEffect, useCallback } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useLanguage } from '../context/LanguageContext'
import { useAuth } from '../context/AuthContext'

interface Meeting {
  id: number
  manager_id: string
  employee_id: string
  scheduled_date: string
  scheduled_time: string
  status: string
  summary: string | null
  completed_at: string | null
  created_at: string
}

interface Comment {
  id: number
  author_id: string
  body: string
  created_at: string
  author_name?: string
}

function formatDate(dateStr: string) {
  const d = new Date(dateStr + 'T00:00:00')
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${days[d.getDay()]}, ${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`
}

function formatDateTime(dateStr: string) {
  const d = new Date(dateStr)
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export default function OneToOneDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { t } = useLanguage()
  const { employeeId, companyUser } = useAuth()
  const [meeting, setMeeting] = useState<Meeting | null>(null)
  const [comments, setComments] = useState<Comment[]>([])
  const [managerName, setManagerName] = useState('')
  const [employeeName, setEmployeeName] = useState('')
  const [loading, setLoading] = useState(true)
  const [summary, setSummary] = useState('')
  const [newComment, setNewComment] = useState('')
  const [saving, setSaving] = useState(false)

  const fetchData = useCallback(async () => {
    if (!id) return
    setLoading(true)
    const { data: m } = await supabase.from('one_to_one_meetings')
      .select('*').eq('id', id).single()
    if (!m) { setLoading(false); return }
    const mtg = m as Meeting
    setMeeting(mtg)
    setSummary(mtg.summary || '')

    const empIds = [mtg.manager_id, mtg.employee_id]
    const { data: empData } = await supabase.from('employees')
      .select('id, first_name, last_name').in('id', empIds)
    const nameMap: Record<string, string> = {}
    ;(empData || []).forEach((e: { id: string; first_name: string; last_name: string }) => {
      nameMap[e.id] = `${e.first_name} ${e.last_name}`
    })
    setManagerName(nameMap[mtg.manager_id] || '')
    setEmployeeName(nameMap[mtg.employee_id] || '')

    const { data: cmts } = await supabase.from('one_to_one_comments')
      .select('*').eq('meeting_id', id).order('created_at', { ascending: true })
    if (cmts && cmts.length > 0) {
      const authorIds = new Set((cmts as Comment[]).map(c => c.author_id))
      const { data: authors } = await supabase.from('employees')
        .select('id, first_name, last_name').in('id', Array.from(authorIds))
      const aMap: Record<string, string> = {}
      ;(authors || []).forEach((a: { id: string; first_name: string; last_name: string }) => {
        aMap[a.id] = `${a.first_name} ${a.last_name}`
      })
      setComments((cmts as Comment[]).map(c => ({ ...c, author_name: aMap[c.author_id] || '' })))
    } else {
      setComments([])
    }
    setLoading(false)
  }, [id])

  useEffect(() => { fetchData() }, [fetchData])

  const iAmManager = meeting?.manager_id === employeeId
  const otherName = iAmManager ? employeeName : managerName
  const otherInitials = (otherName || '').split(' ').map(n => n[0]).join('').toUpperCase()

  async function handleSaveSummary() {
    if (!meeting) return
    setSaving(true)
    await supabase.from('one_to_one_meetings').update({
      summary: summary.trim(),
      status: 'completed',
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('id', meeting.id)
    setSaving(false)
    fetchData()
  }

  async function handleAddComment() {
    if (!meeting || !newComment.trim()) return
    setSaving(true)
    await supabase.from('one_to_one_comments').insert({
      meeting_id: meeting.id,
      author_id: employeeId,
      body: newComment.trim(),
      company_id: companyUser?.company_id,
    })
    setNewComment('')
    setSaving(false)
    fetchData()
  }

  async function handleCancel() {
    if (!meeting) return
    if (!confirm(t('one_to_one.confirm_cancel'))) return
    await supabase.from('one_to_one_meetings').update({
      status: 'cancelled',
      updated_at: new Date().toISOString(),
    }).eq('id', meeting.id)
    navigate('/one-to-ones')
  }

  async function handleAccept() {
    if (!meeting) return
    await supabase.from('one_to_one_meetings').update({
      status: 'accepted',
      updated_at: new Date().toISOString(),
    }).eq('id', meeting.id)
    await supabase.from('workflow_tracker')
      .update({ status: 'Complete', approval_status: 'Approved', action: '1:1 meeting accepted' })
      .eq('record_type', 'Meeting')
      .eq('approval_id', meeting.id)
    fetchData()
  }

  async function handleDecline() {
    if (!meeting) return
    await supabase.from('one_to_one_meetings').update({
      status: 'declined',
      updated_at: new Date().toISOString(),
    }).eq('id', meeting.id)
    await supabase.from('workflow_tracker')
      .update({ status: 'Complete', approval_status: 'Declined', action: '1:1 meeting declined' })
      .eq('record_type', 'Meeting')
      .eq('approval_id', meeting.id)
    navigate('/one-to-ones')
  }

  if (loading) return <div className="feature-page"><p className="claims-empty">{t('common.loading')}</p></div>
  if (!meeting) return <div className="feature-page"><p className="claims-empty">{t('one_to_one.not_found')}</p></div>

  const canComplete = iAmManager && ['pending', 'accepted'].includes(meeting.status)
  const canEditSummary = iAmManager && meeting.status === 'completed'
  const isCompleted = meeting.status === 'completed'

  return (
    <div className="feature-page leave-approval-page">
      <header className="leave-approval-header">
        <div className="leave-approval-avatar">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#7c3aed" strokeWidth="1.5">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" />
            <path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
          </svg>
        </div>
        <div className="leave-approval-header-center">
          <h1 className="leave-approval-title">{t('one_to_one.detail_title')}</h1>
          <p className="leave-approval-subtitle">{formatDate(meeting.scheduled_date)}</p>
        </div>
        <button className="leave-approval-back" onClick={() => navigate('/one-to-ones')}>
          <svg width="36" height="36" viewBox="0 0 36 36" fill="none">
            <circle cx="18" cy="18" r="17" stroke="#7c3aed" strokeWidth="2" />
            <path d="M21 12l-6 6 6 6" stroke="#7c3aed" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </header>

      <div className="leave-approval-card">
        <div className="leave-approval-emp-row">
          <div className="leave-approval-emp-avatar">{otherInitials}</div>
          <div className="leave-approval-emp-info">
            <span className="leave-approval-emp-name">{otherName}</span>
            <span className="leave-approval-emp-ref">
              {iAmManager ? t('one_to_one.your_report') : t('one_to_one.your_manager')}
            </span>
          </div>
          <span className={`leave-approval-badge oto-status-${meeting.status}`}>
            {meeting.status === 'pending' ? t('one_to_one.awaiting_response') :
             meeting.status === 'accepted' ? t('one_to_one.confirmed') :
             meeting.status === 'completed' ? t('one_to_one.completed') :
             meeting.status === 'cancelled' ? t('one_to_one.cancelled') :
             meeting.status === 'declined' ? t('one_to_one.declined') : meeting.status}
          </span>
        </div>

        <div className="leave-approval-details">
          <div className="leave-detail-row">
            <span className="leave-detail-label">{t('one_to_one.manager')}</span>
            <span className="leave-detail-value">{managerName}</span>
          </div>
          <div className="leave-detail-row">
            <span className="leave-detail-label">{t('one_to_one.employee')}</span>
            <span className="leave-detail-value">{employeeName}</span>
          </div>
          <div className="leave-detail-row">
            <span className="leave-detail-label">{t('one_to_one.meeting_date')}</span>
            <span className="leave-detail-value">{formatDate(meeting.scheduled_date)}</span>
          </div>
          <div className="leave-detail-row">
            <span className="leave-detail-label">{t('one_to_one.meeting_time')}</span>
            <span className="leave-detail-value">{meeting.scheduled_time.slice(0, 5)}</span>
          </div>
        </div>

        {!iAmManager && meeting.status === 'pending' && (
          <div className="leave-approval-actions">
            <button className="leave-approve-btn" onClick={handleAccept}>{t('one_to_one.accept')}</button>
            <button className="leave-decline-btn" onClick={handleDecline}>{t('one_to_one.decline_btn')}</button>
          </div>
        )}

        {(canComplete || canEditSummary) && (
          <div className="oto-summary-section">
            <label className="oto-summary-label">{t('one_to_one.meeting_summary')}</label>
            <textarea
              className="oto-summary-textarea"
              value={summary}
              onChange={e => setSummary(e.target.value)}
              placeholder={t('one_to_one.summary_placeholder')}
              rows={5}
            />
            <button className="leave-approve-btn" onClick={handleSaveSummary} disabled={saving || !summary.trim()}>
              {saving ? t('common.saving') : (canComplete ? t('one_to_one.complete_meeting') : t('one_to_one.update_summary'))}
            </button>
          </div>
        )}

        {!iAmManager && isCompleted && meeting.summary && (
          <div className="oto-summary-section">
            <label className="oto-summary-label">{t('one_to_one.meeting_summary')}</label>
            <div className="oto-summary-readonly">{meeting.summary}</div>
          </div>
        )}

        {isCompleted && (
          <div className="oto-comments-section">
            <label className="oto-summary-label">{t('one_to_one.comments')} ({comments.length})</label>
            {comments.map(c => (
              <div key={c.id} className="oto-comment">
                <div className="oto-comment-header">
                  <span className="oto-comment-author">{c.author_name}</span>
                  <span className="oto-comment-date">{formatDateTime(c.created_at)}</span>
                </div>
                <p className="oto-comment-body">{c.body}</p>
              </div>
            ))}
            <div className="oto-add-comment">
              <textarea
                className="oto-comment-input"
                value={newComment}
                onChange={e => setNewComment(e.target.value)}
                placeholder={t('one_to_one.comment_placeholder')}
                rows={3}
              />
              <button className="oto-comment-submit" onClick={handleAddComment} disabled={saving || !newComment.trim()}>
                {t('one_to_one.add_comment')}
              </button>
            </div>
          </div>
        )}

        {['pending', 'accepted'].includes(meeting.status) && (
          <div className="manager-delete-section">
            <button className="manager-delete-btn" onClick={handleCancel}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
              {t('one_to_one.cancel_meeting')}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
