import { useState } from 'react'
import AdminShiftTemplates from './AdminShifts'
import AdminRotaManager from './AdminRotas'
import AdminShiftReports from './AdminShiftReports'
import AdminLabourDemand from './AdminLabourDemand'
import AdminAvailabilityOverview from './AdminAvailabilityOverview'
import CheckInSettingsPanel from './CheckInSettings'
import CheckInDashboardPanel from './CheckInDashboard'

export default function AdminShiftsRotas() {
  const [tab, setTab] = useState<'rotas' | 'templates' | 'demand' | 'availability' | 'reports' | 'checkin'>('rotas')

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
        <button
          onClick={() => setTab('demand')}
          style={{
            padding: '10px 24px',
            border: 'none',
            background: 'none',
            fontWeight: 700,
            fontSize: 14,
            cursor: 'pointer',
            borderBottom: tab === 'demand' ? '3px solid #5c6bc0' : '3px solid transparent',
            color: tab === 'demand' ? '#5c6bc0' : 'var(--text-muted, #8b8fa3)',
            marginBottom: -2,
          }}
        >
          Labour Demand
        </button>
        <button
          onClick={() => setTab('availability')}
          style={{
            padding: '10px 24px',
            border: 'none',
            background: 'none',
            fontWeight: 700,
            fontSize: 14,
            cursor: 'pointer',
            borderBottom: tab === 'availability' ? '3px solid #5c6bc0' : '3px solid transparent',
            color: tab === 'availability' ? '#5c6bc0' : 'var(--text-muted, #8b8fa3)',
            marginBottom: -2,
          }}
        >
          Availability
        </button>
        <button
          onClick={() => setTab('reports')}
          style={{
            padding: '10px 24px',
            border: 'none',
            background: 'none',
            fontWeight: 700,
            fontSize: 14,
            cursor: 'pointer',
            borderBottom: tab === 'reports' ? '3px solid #5c6bc0' : '3px solid transparent',
            color: tab === 'reports' ? '#5c6bc0' : 'var(--text-muted, #8b8fa3)',
            marginBottom: -2,
          }}
        >
          Reports &amp; Analytics
        </button>
        <button
          className={`admin-tab ${tab === 'checkin' ? 'admin-tab-active' : ''}`}
          onClick={() => setTab('checkin')}
          style={{
            padding: '10px 24px',
            border: 'none',
            background: 'none',
            fontWeight: 700,
            fontSize: 14,
            cursor: 'pointer',
            borderBottom: tab === 'checkin' ? '3px solid #5c6bc0' : '3px solid transparent',
            color: tab === 'checkin' ? '#5c6bc0' : 'var(--text-muted, #8b8fa3)',
            marginBottom: -2,
          }}
        >
          Check-In
        </button>
      </div>

      {tab === 'rotas' && <AdminRotaManager />}
      {tab === 'templates' && <AdminShiftTemplates />}
      {tab === 'demand' && <AdminLabourDemand />}
      {tab === 'availability' && <AdminAvailabilityOverview />}
      {tab === 'reports' && <AdminShiftReports />}
      {tab === 'checkin' && (
        <div>
          <CheckInSettingsPanel source="shifts" />
          <CheckInDashboardPanel source="shifts" />
        </div>
      )}
    </div>
  )
}
