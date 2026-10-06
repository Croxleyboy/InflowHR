import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAdminCompany } from '../../context/AdminCompanyContext'
import { useToast } from '../../context/ToastContext'

export default function AdminXeroTest() {
  const { companyId } = useAdminCompany()
  const { addToast } = useToast()

  const [loading, setLoading] = useState<string | null>(null)
  const [payRunsResult, setPayRunsResult] = useState<any>(null)
  const [payRunId, setPayRunId] = useState('')
  const [payslipId, setPayslipId] = useState('')
  const [payslipResult, setPayslipResult] = useState<any>(null)
  const [updatePayload, setUpdatePayload] = useState('')
  const [updatePayslipId, setUpdatePayslipId] = useState('')
  const [updateResult, setUpdateResult] = useState<any>(null)

  async function callXeroTest(action: string, extra: Record<string, any> = {}) {
    setLoading(action)
    try {
      const { data, error } = await supabase.functions.invoke('xero-api-test', {
        body: { action, company_id: companyId, ...extra },
      })
      if (error) throw error
      return data
    } catch (err: any) {
      addToast(err.message || 'Edge function call failed', 'error')
      return null
    } finally {
      setLoading(null)
    }
  }

  async function fetchPayRuns() {
    const result = await callXeroTest('fetch_payruns')
    if (result) setPayRunsResult(result)
  }

  async function getPayslip() {
    if (!payRunId.trim() || !payslipId.trim()) {
      addToast('Both PayRunID and PayslipID are required', 'error')
      return
    }
    const result = await callXeroTest('get_payslip', {
      pay_run_id: payRunId.trim(),
      payslip_id: payslipId.trim(),
    })
    if (result) {
      setPayslipResult(result)
      if (result.data?.Payslip || result.data?.Payslips) {
        const payslipData = result.data.Payslip || result.data.Payslips?.[0]
        if (payslipData) {
          setUpdatePayslipId(payslipData.PayslipID || payslipId.trim())
          setUpdatePayload(JSON.stringify({
            Payslips: [{
              PayslipID: payslipData.PayslipID || payslipId.trim(),
              DeductionLines: payslipData.DeductionLines || [],
              EarningsLines: payslipData.EarningsLines || [],
            }]
          }, null, 2))
        }
      }
    }
  }

  async function updatePayslip() {
    if (!updatePayslipId.trim()) {
      addToast('PayslipID is required', 'error')
      return
    }
    let parsed
    try {
      parsed = JSON.parse(updatePayload)
    } catch {
      addToast('Invalid JSON payload', 'error')
      return
    }
    const result = await callXeroTest('update_payslip', {
      payslip_id: updatePayslipId.trim(),
      payload: parsed,
    })
    if (result) setUpdateResult(result)
  }

  const sectionStyle: React.CSSProperties = {
    background: '#fff',
    border: '1px solid #e5e7eb',
    borderRadius: 8,
    padding: 20,
    marginBottom: 20,
  }

  const inputStyle: React.CSSProperties = {
    padding: '8px 12px',
    border: '1px solid #d1d5db',
    borderRadius: 6,
    fontSize: 14,
    width: '100%',
    maxWidth: 500,
    fontFamily: 'monospace',
  }

  const btnStyle: React.CSSProperties = {
    padding: '10px 20px',
    background: '#4f46e5',
    color: '#fff',
    border: 'none',
    borderRadius: 6,
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
    opacity: loading ? 0.6 : 1,
  }

  const preStyle: React.CSSProperties = {
    background: '#1e1e2e',
    color: '#a6e3a1',
    padding: 16,
    borderRadius: 8,
    fontSize: 12,
    fontFamily: 'monospace',
    overflow: 'auto',
    maxHeight: 500,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    marginTop: 12,
  }

  const labelStyle: React.CSSProperties = {
    display: 'block',
    fontSize: 13,
    fontWeight: 600,
    color: '#374151',
    marginBottom: 4,
  }

  return (
    <div style={{ maxWidth: 900, margin: '0 auto' }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>Xero API Test Console</h1>
      <p style={{ color: '#6b7280', fontSize: 14, marginBottom: 24 }}>
        Super admin only — make direct Xero AU Payroll v2 API calls for debugging.
        Company: <strong>{companyId}</strong>
      </p>

      {/* ── 1. Fetch Pay Runs ─────────────────────────────────────────────── */}
      <div style={sectionStyle}>
        <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>1. Fetch All Pay Runs</h2>
        <p style={{ color: '#6b7280', fontSize: 13, marginBottom: 12 }}>
          GET /payroll.xro/2.0/PayRuns — returns all pay runs with their statuses and payslip IDs.
        </p>
        <button
          style={btnStyle}
          disabled={!!loading}
          onClick={fetchPayRuns}
        >
          {loading === 'fetch_payruns' ? 'Fetching…' : 'Fetch Pay Runs'}
        </button>

        {payRunsResult && (
          <div>
            <div style={{ marginTop: 12, fontSize: 13 }}>
              <strong>Status:</strong>{' '}
              <span style={{ color: payRunsResult.status === 200 ? '#16a34a' : '#dc2626' }}>
                {payRunsResult.status}
              </span>
              {' · '}
              <strong>URL:</strong> {payRunsResult.url}
            </div>
            <pre style={preStyle}>{JSON.stringify(payRunsResult.data, null, 2)}</pre>
          </div>
        )}
      </div>

      {/* ── 2. Get Payslip ────────────────────────────────────────────────── */}
      <div style={sectionStyle}>
        <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>2. Get Payslip Detail</h2>
        <p style={{ color: '#6b7280', fontSize: 13, marginBottom: 12 }}>
          GET /payroll.xro/2.0/PayRuns/&#123;PayRunID&#125;/Payslips/&#123;PayslipID&#125; — retrieves an employee's draft payslip.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
          <div>
            <label style={labelStyle}>PayRunID</label>
            <input
              style={inputStyle}
              placeholder="e.g. a1b2c3d4-5678-..."
              value={payRunId}
              onChange={(e) => setPayRunId(e.target.value)}
            />
          </div>
          <div>
            <label style={labelStyle}>PayslipID</label>
            <input
              style={inputStyle}
              placeholder="e.g. e061a3ee-2f13-..."
              value={payslipId}
              onChange={(e) => setPayslipId(e.target.value)}
            />
          </div>
        </div>
        <button
          style={btnStyle}
          disabled={!!loading}
          onClick={getPayslip}
        >
          {loading === 'get_payslip' ? 'Fetching…' : 'Get Payslip'}
        </button>

        {payslipResult && (
          <div>
            <div style={{ marginTop: 12, fontSize: 13 }}>
              <strong>Status:</strong>{' '}
              <span style={{ color: payslipResult.status === 200 ? '#16a34a' : '#dc2626' }}>
                {payslipResult.status}
              </span>
              {' · '}
              <strong>URL:</strong> {payslipResult.url}
            </div>
            <pre style={preStyle}>{JSON.stringify(payslipResult.data, null, 2)}</pre>
          </div>
        )}
      </div>

      {/* ── 3. Update Payslip ─────────────────────────────────────────────── */}
      <div style={sectionStyle}>
        <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>3. Update Payslip (POST)</h2>
        <p style={{ color: '#6b7280', fontSize: 13, marginBottom: 12 }}>
          POST /payroll.xro/2.0/Payslip/&#123;PayslipID&#125; — update a draft payslip with earnings/deduction lines.
          The payload auto-populates from a fetched payslip above, or edit the JSON directly.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
          <div>
            <label style={labelStyle}>PayslipID</label>
            <input
              style={inputStyle}
              placeholder="e.g. e061a3ee-2f13-..."
              value={updatePayslipId}
              onChange={(e) => setUpdatePayslipId(e.target.value)}
            />
          </div>
          <div>
            <label style={labelStyle}>JSON Payload</label>
            <textarea
              style={{
                ...inputStyle,
                maxWidth: '100%',
                minHeight: 200,
                resize: 'vertical',
              }}
              placeholder='{"Payslips": [{"PayslipID": "...", "EarningsLines": [...], "DeductionLines": [...]}]}'
              value={updatePayload}
              onChange={(e) => setUpdatePayload(e.target.value)}
            />
          </div>
        </div>
        <button
          style={{ ...btnStyle, background: '#dc2626' }}
          disabled={!!loading}
          onClick={updatePayslip}
        >
          {loading === 'update_payslip' ? 'Posting…' : 'POST Payslip Update'}
        </button>

        {updateResult && (
          <div>
            <div style={{ marginTop: 12, fontSize: 13 }}>
              <strong>Status:</strong>{' '}
              <span style={{ color: updateResult.status === 200 ? '#16a34a' : '#dc2626' }}>
                {updateResult.status}
              </span>
              {' · '}
              <strong>URL:</strong> {updateResult.url}
            </div>
            <pre style={preStyle}>{JSON.stringify(updateResult.data, null, 2)}</pre>
          </div>
        )}
      </div>
    </div>
  )
}
