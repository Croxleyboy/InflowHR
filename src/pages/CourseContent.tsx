import { useState, useMemo } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useLanguage } from '../context/LanguageContext'
import { useAuth } from '../context/AuthContext'

type CourseType = 'video' | 'article' | 'quiz' | 'policy' | 'how-to'

interface Section {
  heading: string
  body: string
}

interface QuizQuestion {
  question: string
  options: string[]
  correct: number
}

function toEmbedUrl(url: string): string {
  if (!url) return ''
  try {
    const u = new URL(url)
    if (u.hostname === 'www.youtube.com' || u.hostname === 'youtube.com') {
      const v = u.searchParams.get('v')
      if (v) return `https://www.youtube.com/embed/${v}`
    }
    if (u.hostname === 'youtu.be') {
      return `https://www.youtube.com/embed${u.pathname}`
    }
    if (u.hostname === 'vimeo.com' && /^\/\d+/.test(u.pathname)) {
      return `https://player.vimeo.com/video${u.pathname}`
    }
  } catch {}
  return url
}


function generateSections(_title: string, description: string, type: CourseType): Section[] {
  if (type === 'quiz') return []

  return [
    { heading: 'Overview', body: description },
    { heading: 'Key Learning Objectives', body: 'By the end of this module you will understand the core concepts, be able to apply them in your day-to-day role, and know where to find further guidance.' },
    { heading: 'What You Need to Know', body: 'This content is designed to be completed in one sitting. Take notes as you go and refer back to company policies where referenced. If you have questions, contact your manager or the L&D team.' },
    { heading: 'Summary', body: 'You have now covered the key points. Use the Mark Complete button below when you are ready to record your completion.' },
  ]
}

function shuffleOptions(options: string[], correctIndex: number): { options: string[]; correct: number } {
  const entries = options.map((text, i) => ({ text, wasCorrect: i === correctIndex }))
  for (let i = entries.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[entries[i], entries[j]] = [entries[j], entries[i]]
  }
  return { options: entries.map(e => e.text), correct: entries.findIndex(e => e.wasCorrect) }
}

function generateQuiz(title: string): QuizQuestion[] {
  const raw = [
    {
      question: `Which of the following best describes a key objective of "${title}"?`,
      options: [
        'Understanding the core principles and your responsibilities',
        'Only applicable to senior management',
        'Optional awareness with no follow-up required',
        'Relevant only to the HR department',
      ],
      correct: 0,
    },
    {
      question: 'What should you do if you are unsure about a policy or procedure?',
      options: [
        'Ignore it and move on',
        'Ask a colleague who might know',
        'Refer to the company handbook or contact your manager',
        'Wait until the next training session',
      ],
      correct: 2,
    },
    {
      question: 'How often should you review and refresh your knowledge on this topic?',
      options: [
        'Only during onboarding',
        'Whenever there is a policy update or annually if required',
        'Every five years',
        'Never, once completed it lasts forever',
      ],
      correct: 1,
    },
  ]
  return raw.map(q => {
    const shuffled = shuffleOptions(q.options, q.correct)
    return { question: q.question, options: shuffled.options, correct: shuffled.correct }
  })
}

export default function CourseContent() {
  const navigate = useNavigate()
  const { courseId } = useParams<{ courseId: string }>()
  const { t } = useLanguage()
  const { companyUser, employeeId } = useAuth()

  const title = courseId ? t(`elearning.c_${courseId.replace(/^(onb|comp|pol|role|dev|wellbeing|legal|edu|acc)-/, (_, p) => `${p}_`).replace(/-/g, '_')}_title`.replace(/_title$/, '_title')) : ''
  const rawTitle = courseId || ''

  const searchParams = new URLSearchParams(window.location.search)
  const type = (searchParams.get('type') || 'article') as CourseType
  const courseTitle = searchParams.get('title') || title || rawTitle
  const courseDesc = searchParams.get('desc') || ''
  const duration = searchParams.get('duration') || ''
  const rawUrl = searchParams.get('url') || ''
  const externalUrl = toEmbedUrl(rawUrl)

  const sections = generateSections(courseTitle, courseDesc, type)
  const quizQuestions = useMemo(() => type === 'quiz' ? generateQuiz(courseTitle) : [], [type, courseTitle])

  const [currentSection, setCurrentSection] = useState(0)
  const [quizAnswers, setQuizAnswers] = useState<Record<number, number>>({})
  const [quizSubmitted, setQuizSubmitted] = useState(false)
  const [completed, setCompleted] = useState(false)

  async function handleComplete() {
    if (!courseId || !companyUser?.company_id || !employeeId) return
    await supabase.from('elearning_completions').upsert({
      company_id: companyUser.company_id,
      employee_id: employeeId,
      course_id: courseId,
      completed_at: new Date().toISOString(),
    }, { onConflict: 'company_id,employee_id,course_id' })
    setCompleted(true)
    setTimeout(() => navigate('/elearning'), 1500)
  }

  function handleQuizSubmit() {
    setQuizSubmitted(true)
    const allCorrect = quizQuestions.every((q, i) => quizAnswers[i] === q.correct)
    if (allCorrect) {
      setTimeout(() => handleComplete(), 1000)
    }
  }

  const quizScore = quizQuestions.filter((q, i) => quizAnswers[i] === q.correct).length
  const allAnswered = quizQuestions.every((_, i) => quizAnswers[i] !== undefined)

  return (
    <div className="feature-page course-content-page">
      <header className="course-content-header">
        <button className="course-content-back" onClick={() => navigate('/elearning')}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <div className="course-content-header-info">
          <h1>{courseTitle}</h1>
          <div className="course-content-meta">
            <span className="course-content-type-badge" data-type={type}>{type}</span>
            {duration && <span className="course-content-duration">{duration}</span>}
          </div>
        </div>
      </header>

      {completed && (
        <div className="course-content-complete-overlay">
          <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
          <span>{t('elearning.well_done')}</span>
        </div>
      )}

      {type === 'quiz' ? (
        <div className="course-content-quiz">
          <div className="course-content-quiz-intro">
            <p>{courseDesc}</p>
            <p className="course-content-quiz-instructions">{t('elearning.quiz_instructions')}</p>
          </div>
          {quizQuestions.map((q, qi) => (
            <div key={qi} className={`course-content-quiz-card ${quizSubmitted ? (quizAnswers[qi] === q.correct ? 'quiz-correct' : 'quiz-incorrect') : ''}`}>
              <h3>{t('elearning.question')} {qi + 1}</h3>
              <p>{q.question}</p>
              <div className="course-content-quiz-options">
                {q.options.map((opt, oi) => (
                  <button
                    key={oi}
                    className={`course-content-quiz-option ${quizAnswers[qi] === oi ? 'quiz-option-selected' : ''} ${quizSubmitted && oi === q.correct ? 'quiz-option-correct' : ''} ${quizSubmitted && quizAnswers[qi] === oi && oi !== q.correct ? 'quiz-option-wrong' : ''}`}
                    onClick={() => !quizSubmitted && setQuizAnswers(a => ({ ...a, [qi]: oi }))}
                    disabled={quizSubmitted}
                  >
                    <span className="quiz-option-letter">{String.fromCharCode(65 + oi)}</span>
                    {opt}
                  </button>
                ))}
              </div>
            </div>
          ))}
          {!quizSubmitted ? (
            <button className="course-content-submit-btn" disabled={!allAnswered} onClick={handleQuizSubmit}>
              {t('elearning.submit_quiz')}
            </button>
          ) : (
            <div className="course-content-quiz-result">
              <p>{t('elearning.quiz_score')}: {quizScore}/{quizQuestions.length}</p>
              {quizScore === quizQuestions.length ? (
                <p className="quiz-result-pass">{t('elearning.quiz_pass')}</p>
              ) : (
                <>
                  <p className="quiz-result-fail">{t('elearning.quiz_fail')}</p>
                  <button className="course-content-retry-btn" onClick={() => { setQuizAnswers({}); setQuizSubmitted(false) }}>
                    {t('elearning.quiz_retry')}
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      ) : type === 'video' ? (
        <div className="course-content-video">
          {externalUrl ? (
            <div className="course-content-video-embed">
              <iframe
                src={externalUrl}
                title={courseTitle}
                allowFullScreen
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              />
            </div>
          ) : (
            <div className="course-content-video-placeholder">
              <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="5 3 19 12 5 21 5 3"/>
              </svg>
              <span>{t('elearning.video_placeholder')}</span>
            </div>
          )}
          <div className="course-content-sections">
            <div className="course-content-section">
              <h2>{t('elearning.content_overview')}</h2>
              <p>{courseDesc}</p>
            </div>
            <div className="course-content-section">
              <h2>{t('elearning.content_key_points')}</h2>
              <p>{t('elearning.content_key_points_body')}</p>
            </div>
          </div>
          <button className="course-content-complete-btn" onClick={handleComplete}>
            {t('elearning.mark_complete')}
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
          </button>
        </div>
      ) : (
        <div className="course-content-article">
          <div className="course-content-progress-dots">
            {sections.map((_, i) => (
              <button
                key={i}
                className={`course-content-dot ${i === currentSection ? 'dot-active' : ''} ${i < currentSection ? 'dot-done' : ''}`}
                onClick={() => setCurrentSection(i)}
              />
            ))}
          </div>
          <div className="course-content-sections">
            <div className="course-content-section">
              <h2>{sections[currentSection]?.heading}</h2>
              <p>{sections[currentSection]?.body}</p>
            </div>
          </div>
          <div className="course-content-nav">
            {currentSection > 0 && (
              <button className="course-content-nav-btn course-content-prev" onClick={() => setCurrentSection(s => s - 1)}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
                {t('elearning.content_previous')}
              </button>
            )}
            {currentSection < sections.length - 1 ? (
              <button className="course-content-nav-btn course-content-next" onClick={() => setCurrentSection(s => s + 1)}>
                {t('elearning.content_next')}
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
              </button>
            ) : (
              <button className="course-content-complete-btn" onClick={handleComplete}>
                {t('elearning.mark_complete')}
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
