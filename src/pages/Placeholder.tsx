import { useNavigate } from 'react-router-dom'
import { useLanguage } from '../context/LanguageContext'

export default function Placeholder({ title }: { title: string }) {
  const navigate = useNavigate()
  const { t } = useLanguage()
  return (
    <div className="placeholder-page">
      <button className="back-btn" onClick={() => navigate(-1)}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
        {t('common.back')}
      </button>
      <h1>{title}</h1>
      <p>{t('common.coming_soon')}</p>
    </div>
  )
}
