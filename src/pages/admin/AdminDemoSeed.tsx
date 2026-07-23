import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'

export default function AdminDemoSeed() {
  const { user } = useAuth()
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function runSeed() {
    if (!confirm('This will DELETE ALL DATA and reseed with demo data. Are you sure?')) return
    if (!user) return
    setRunning(true)
    setResult(null)
    setError(null)

    const { data, error: err } = await (supabase.rpc as any)('run_demo_seed', {
      p_auth_uid: user.id,
    })

    if (err) {
      setError(err.message || 'Seed failed — check the Supabase logs')
    } else {
      setResult(data || 'Demo seed complete!')
    }
    setRunning(false)
  }

  return (
    <div className="admin-section">
      <div className="admin-page-header">
        <h2>Demo Seed Data</h2>
        <p>Reset all tables and populate with demo data for 2 companies and 11 employees</p>
      </div>

      <div style={{ background: '#fff3cd', border: '1px solid #ffc107', borderRadius: 8, padding: 16, marginBottom: 24 }}>
        <strong style={{ color: '#856404' }}>Warning:</strong>
        <span style={{ color: '#856404' }}> This will delete ALL existing data and replace it with demo data. Your admin login (andy.jones@kumonix.com) will be preserved.</span>
      </div>

      <div style={{ marginBottom: 24 }}>
        <h3 style={{ marginBottom: 12 }}>What gets created:</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 8 }}>
          {[
            '2 Companies (Kumonix + Move2Modern)',
            '11 Employees (5 + 6)',
            '5 Leave types per company',
            '13 Leave requests',
            '10 Expense claims + 14 line items',
            '44 Payslips (4 months × 11)',
            '11 Kudos entries',
            '8 Announcements',
            '5 Benefits + enrolments',
            '6 eLearning courses + 34 enrolments',
            '9 Performance reviews',
            '9 Onboarding records',
            '14 Workflow actions',
            '14 Notifications',
            'App & user settings',
          ].map(item => (
            <div key={item} style={{ padding: '8px 12px', background: '#f0f4f8', borderRadius: 6, fontSize: 13 }}>
              {item}
            </div>
          ))}
        </div>
      </div>

      <button
        className="admin-btn admin-btn-primary"
        onClick={runSeed}
        disabled={running}
        style={{ fontSize: 16, padding: '12px 32px' }}
      >
        {running ? 'Seeding...' : 'Reset & Seed Demo Data'}
      </button>

      {result && (
        <div style={{ marginTop: 20, padding: 16, background: '#d4edda', border: '1px solid #28a745', borderRadius: 8, color: '#155724' }}>
          {result} — reload the page to see fresh data.
        </div>
      )}

      {error && (
        <div style={{ marginTop: 20, padding: 16, background: '#f8d7da', border: '1px solid #dc3545', borderRadius: 8, color: '#721c24' }}>
          <strong>Error:</strong> {error}
        </div>
      )}
    </div>
  )
}
