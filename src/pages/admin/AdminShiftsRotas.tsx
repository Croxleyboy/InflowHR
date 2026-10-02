import { useState } from 'react'
import AdminShiftTemplates from './AdminShifts'
import AdminRotaManager from './AdminRotas'
import AdminShiftReports from './AdminShiftReports'
import AdminLabourDemand from './AdminLabourDemand'
import AdminAvailabilityOverview from './AdminAvailabilityOverview'
import CheckInSettingsPanel from './CheckInSettings'
import CheckInDashboardPanel from './CheckInDashboard'
import AdminShiftSkills from './AdminShiftSkills'
import AdminShiftCorrections from './AdminShiftCorrections'

export default function AdminShiftsRotas() {
  const [tab, setTab] = useState<'rotas' | 'templates' | 'skills' | 'demand' | 'availability' | 'reports' | 'checkin' | 'corrections'>('rotas')

  return (
    <div className="admin-section">
      <div className="admin-page-header">
        <h2>Shifts &amp; Rotas</h2>
        <p>Manage shift templates, rotas, and employee scheduling</p>
      </div>

      <div className="admin-tabs">
        <button className={`admin-tab ${tab === 'rotas' ? 'admin-tab-active' : ''}`} onClick={() => setTab('rotas')}>Rotas &amp; Scheduling</button>
        <button className={`admin-tab ${tab === 'templates' ? 'admin-tab-active' : ''}`} onClick={() => setTab('templates')}>Shift Templates</button>
        <button className={`admin-tab ${tab === 'skills' ? 'admin-tab-active' : ''}`} onClick={() => setTab('skills')}>Shift Skills</button>
        <button className={`admin-tab ${tab === 'demand' ? 'admin-tab-active' : ''}`} onClick={() => setTab('demand')}>Labour Demand</button>
        <button className={`admin-tab ${tab === 'availability' ? 'admin-tab-active' : ''}`} onClick={() => setTab('availability')}>Availability</button>
        <button className={`admin-tab ${tab === 'reports' ? 'admin-tab-active' : ''}`} onClick={() => setTab('reports')}>Reports &amp; Analytics</button>
        <button className={`admin-tab ${tab === 'checkin' ? 'admin-tab-active' : ''}`} onClick={() => setTab('checkin')}>Check-In</button>
        <button className={`admin-tab ${tab === 'corrections' ? 'admin-tab-active' : ''}`} onClick={() => setTab('corrections')}>Corrections</button>
      </div>

      {tab === 'rotas' && <AdminRotaManager />}
      {tab === 'templates' && <AdminShiftTemplates />}
      {tab === 'skills' && <AdminShiftSkills />}
      {tab === 'demand' && <AdminLabourDemand />}
      {tab === 'availability' && <AdminAvailabilityOverview />}
      {tab === 'reports' && <AdminShiftReports />}
      {tab === 'checkin' && (
        <div>
          <CheckInSettingsPanel source="shifts" />
          <CheckInDashboardPanel source="shifts" />
        </div>
      )}
      {tab === 'corrections' && <AdminShiftCorrections />}
    </div>
  )
}
