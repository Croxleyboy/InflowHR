import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useLanguage } from '../context/LanguageContext'
import { useAuth } from '../context/AuthContext'
import { currencySymbol } from '../lib/formatters'

interface MonthlyStat {
  month: string
  submitted: number
  approved: number
  declined: number
}

const monthNames: Record<string, string[]> = {
  en: ['Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec','Jan','Feb','Mar'],
  de: ['Apr','Mai','Jun','Jul','Aug','Sep','Okt','Nov','Dez','Jan','Feb','Mär'],
}

const COLORS = {
  submitted: '#2196f3',
  approved: '#4caf50',
  declined: '#f44336',
}

export default function ExpenseGraph({ onClose }: { onClose: () => void }) {
  const { t, fyStartMonth } = useLanguage()
  const { companyUser, company } = useAuth()
  const currency = company?.currency || 'GBP'
  const [stats, setStats] = useState<MonthlyStat[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      const now = new Date()
      const fyYear = now.getMonth() + 1 >= fyStartMonth ? now.getFullYear() : now.getFullYear() - 1
      const startDate = `${fyYear}-${String(fyStartMonth).padStart(2, '0')}-01`
      const endMonth = fyStartMonth === 1 ? 12 : fyStartMonth - 1
      const endYear = fyStartMonth === 1 ? fyYear : fyYear + 1
      const endDate = `${endYear}-${String(endMonth).padStart(2, '0')}-31`

      if (!companyUser?.company_id) return
      const { data } = await supabase.from('expense_claims')
        .select('status, amount, created_at')
        .eq('company_id', companyUser.company_id)
        .gte('created_at', startDate)
        .lte('created_at', endDate)

      const months: MonthlyStat[] = []
      for (let i = 0; i < 12; i++) {
        const m = ((fyStartMonth - 1 + i) % 12) + 1
        months.push({ month: String(m), submitted: 0, approved: 0, declined: 0 })
      }

      if (data) {
        for (const claim of data) {
          const d = new Date(claim.created_at)
          const m = d.getMonth() + 1
          const slot = months.find(s => Number(s.month) === m)
          if (!slot) continue
          const amt = claim.amount || 0
          if (claim.status === 'submitted') slot.submitted += amt
          else if (claim.status === 'approved') slot.approved += amt
          else if (claim.status === 'rejected') slot.declined += amt
        }
      }

      setStats(months)
      setLoading(false)
    }
    load()
  }, [fyStartMonth])

  const { lang } = useLanguage()
  const labels = monthNames[lang] || monthNames.en
  const maxVal = Math.max(1, ...stats.map(s => s.submitted + s.approved + s.declined))

  const chartW = 420
  const chartH = 200
  const barGroupW = chartW / 12
  const barW = 8
  const gap = 2

  return (
    <div className="expense-graph-overlay" onClick={onClose}>
      <div className="expense-graph-modal" onClick={e => e.stopPropagation()}>
        <div className="expense-graph-header">
          <h2 className="expense-graph-title">{t('expenses.graph_title')}</h2>
          <button className="expense-graph-close" onClick={onClose}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--text)" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {loading ? (
          <p style={{ textAlign: 'center', padding: 20, color: 'var(--text-muted)' }}>{t('common.loading')}</p>
        ) : (
          <>
            <div className="expense-graph-chart">
              <svg viewBox={`0 0 ${chartW} ${chartH + 30}`} width="100%" preserveAspectRatio="xMidYMid meet">
                {[0, 0.25, 0.5, 0.75, 1].map(frac => {
                  const y = chartH - frac * chartH
                  return (
                    <g key={frac}>
                      <line x1="0" y1={y} x2={chartW} y2={y} stroke="var(--border)" strokeWidth="0.5" />
                      <text x="-2" y={y + 3} fontSize="8" fill="var(--text-muted)" textAnchor="end">
                        {currencySymbol(currency)}{Math.round(maxVal * frac)}
                      </text>
                    </g>
                  )
                })}

                {stats.map((s, i) => {
                  const cx = i * barGroupW + barGroupW / 2
                  const h1 = (s.submitted / maxVal) * chartH
                  const h2 = (s.approved / maxVal) * chartH
                  const h3 = (s.declined / maxVal) * chartH
                  return (
                    <g key={i}>
                      <rect x={cx - barW * 1.5 - gap} y={chartH - h1} width={barW} height={h1} rx="2" fill={COLORS.submitted} />
                      <rect x={cx - barW / 2} y={chartH - h2} width={barW} height={h2} rx="2" fill={COLORS.approved} />
                      <rect x={cx + barW / 2 + gap} y={chartH - h3} width={barW} height={h3} rx="2" fill={COLORS.declined} />
                      <text x={cx} y={chartH + 14} fontSize="9" fill="var(--text-muted)" textAnchor="middle">
                        {labels[i]}
                      </text>
                    </g>
                  )
                })}
              </svg>
            </div>

            <div className="expense-graph-legend">
              <span className="legend-item"><span className="legend-dot" style={{ background: COLORS.submitted }} />{t('expenses.submitted')}</span>
              <span className="legend-item"><span className="legend-dot" style={{ background: COLORS.approved }} />{t('expenses.approved')}</span>
              <span className="legend-item"><span className="legend-dot" style={{ background: COLORS.declined }} />{t('approval.decline')}</span>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
