import { useState } from 'react'
import AdminShiftTemplates from './AdminShifts'
import AdminRotaManager from './AdminRotas'

export default function AdminShiftsRotas() {
  const [tab, setTab] = useState<'rotas' | 'templates'>('rotas')

  return (
    <div className="admin-section">
      <div className="admin-page-header">
        <h2>Shifts &amp; Rotas</h2>
        <p>Manage shift templates, rotas, and employee scheduling</p>
      </div>

      <div style={{ display: 'flex', gap: 0, marginBottom: 20, borderBottom: '2px solid var(--border, #e5e7eb)' }}>
        <button
          onClick={() => setTab('rotas')}
          style={{
            padding: '10px 24px',
            border: 'none',
            background: 'none',
            fontWeight: 700,
            fontSize: 14,
            cursor: 'pointer',
            borderBottom: tab === 'rotas' ? '3px solid #5c6bc0' : '3px solid transparent',
            color: tab === 'rotas' ? '#5c6bc0' : 'var(--text-muted, #8b8fa3)',
            marginBottom: -2,
          }}
        >
          Rotas &amp; Scheduling
        </button>
        <button
          onClick={() => setTab('templates')}
          style={{
            padding: '10px 24px',
            border: 'none',
            background: 'none',
            fontWeight: 700,
            fontSize: 14,
            cursor: 'pointer',
            borderBottom: tab === 'templates' ? '3px solid #5c6bc0' : '3px solid transparent',
            color: tab === 'templates' ? '#5c6bc0' : 'var(--text-muted, #8b8fa3)',
            marginBottom: -2,
          }}
        >
          Shift Templates
        </button>
      </div>

      {tab === 'rotas' && <AdminRotaManager />}
      {tab === 'templates' && <AdminShiftTemplates />}
    </div>
  )
}
