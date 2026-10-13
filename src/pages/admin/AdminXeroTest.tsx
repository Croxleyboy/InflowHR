import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAdminCompany } from '../../context/AdminCompanyContext'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../context/ToastContext'
import { currencySymbol } from '../../lib/formatters'

export default function AdminXeroTest() {
  const { selectedCompanyId: companyId } = useAdminCompany()
  const { company } = useAuth()
  const { showToast } = useToast()
  const currency = company?.currency || 'GBP'

  const [loading, setLoading] = useState<string | null>(null)
  const [payItemsResult, setPayItemsResult] = useState<any>(null)
  const [payRunsResult, setPayRunsResult] = useState<any>(null)
  const [payslipId, setPayslipId] = useState('')
  const [payslipResult, setPayslipResult] = useState<any>(null)
  const [updatePayload, setUpdatePayload] = useState('')
  const [updatePayslipId, setUpdatePayslipId] = useState('')
  const [updatePayRunId, setUpdatePayRunId] = useState('')
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
      showToast(err.message || 'Edge function call failed', 'error')
      return null
    } finally {
      setLoading(null)
    }
  }

  async function fetchPayItems() {
    const result = await callXeroTest('fetch_payitems')
    if (result) setPayItemsResult(result)
  }

  async function fetchPayRuns() {
    const result = await callXeroTest('fetch_payruns')
    if (result) setPayRunsResult(result)
  }

  async function getPayslip() {
    if (!payslipId.trim()) {
      showToast('PayslipID is required', 'error')
      return
    }
    const result = await callXeroTest('get_payslip', {
      payslip_id: payslipId.trim(),
    })
    if (result) {
      setPayslipResult(result)
      const payslipData = result.data?.paySlip || result.data?.Payslip || result.data?.Payslips?.[0]
      if (payslipData) {
        const id = payslipData.paySlipID || payslipData.PayslipID || payslipId.trim()
        setUpdatePayslipId(id)
        if (payslipData.payRunID) setUpdatePayRunId(payslipData.payRunID)

        const existingEarnings = payslipData.earningsLines || payslipData.EarningsLines || []
        const existingDeductions = payslipData.deductionLines || payslipData.DeductionLines || []

        const earningsLines = existingEarnings.length > 0
          ? existingEarnings.map((line: any) => ({
              EarningsRateID: line.earningsRateID || line.EarningsRateID,
              NumberOfUnits: line.numberOfUnits ?? line.NumberOfUnits ?? 0,
              ...(line.ratePerUnit != null || line.RatePerUnit != null
                ? { RatePerUnit: line.ratePerUnit ?? line.RatePerUnit }
                : {}),
            }))
          : [{ EarningsRateID: 'aa5a01de-14de-4bb3-8a91-e7bda9539820', NumberOfUnits: 160, RatePerUnit: 15.00 }]

        const knownOvertimeId = '0cd90943-c327-477f-be98-184121803d4a'
        const hasOvertime = earningsLines.some((l: any) => l.EarningsRateID === knownOvertimeId)
        if (!hasOvertime) {
          earningsLines.push({ EarningsRateID: knownOvertimeId, NumberOfUnits: 10 })
        }

        setUpdatePayload(JSON.stringify({
          PaySlip: {
            PaySlipID: id,
            EarningsLines: earningsLines,
            ...(existingDeductions.length > 0 ? { DeductionLines: existingDeductions } : {}),
          }
        }, null, 2))
      }
    }
  }

  async function updatePayslip() {
    if (!updatePayslipId.trim()) {
      showToast('PayslipID is required', 'error')
      return
    }
    let parsed
    try {
      parsed = JSON.parse(updatePayload)
    } catch {
      showToast('Invalid JSON payload', 'error')
      return
    }
    const result = await callXeroTest('update_payslip', {
      payslip_id: updatePayslipId.trim(),
      pay_run_id: updatePayRunId.trim() || undefined,
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

      {/* ── 0. Fetch Pay Items ────────────────────────────────────────────── */}
      <div style={sectionStyle}>
        <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>0. Fetch Pay Items</h2>
        <p style={{ color: '#6b7280', fontSize: 13, marginBottom: 12 }}>
          GET /payroll.xro/2.0/PayItems — returns all earnings rates, deduction types, reimbursement types
          and benefit types configured in Xero. Use these IDs when building update payloads in section 3.
        </p>
        <button
          style={btnStyle}
          disabled={!!loading}
          onClick={fetchPayItems}
        >
          {loading === 'fetch_payitems' ? 'Fetching…' : 'Fetch Pay Items'}
        </button>

        {payItemsResult && (
          <div>
            <div style={{ marginTop: 12, fontSize: 13 }}>
              <strong>Status:</strong>{' '}
              <span style={{ color: payItemsResult.status === 200 ? '#16a34a' : '#dc2626' }}>
                {payItemsResult.status}
              </span>
              {' · '}
              <strong>URL:</strong> {payItemsResult.url}
            </div>

            {payItemsResult.data?.payItems && (
              <div style={{ marginTop: 12 }}>
                {payItemsResult.data.payItems.earningsRates?.length > 0 && (
                  <details open style={{ marginBottom: 8 }}>
                    <summary style={{ fontSize: 13, fontWeight: 600, cursor: 'pointer', color: '#374151' }}>
                      Earnings Rates ({payItemsResult.data.payItems.earningsRates.length})
                    </summary>
                    <div style={{ marginTop: 6 }}>
                      {payItemsResult.data.payItems.earningsRates.map((er: any) => (
                        <div key={er.earningsRateID} style={{ fontSize: 12, padding: '4px 8px', borderBottom: '1px solid #f3f4f6' }}>
                          <strong>{er.name}</strong>
                          <span style={{ color: '#6b7280', marginLeft: 8 }}>
                            ID: <code style={{ fontSize: 11, background: '#f3f4f6', padding: '1px 4px', borderRadius: 3 }}>{er.earningsRateID}</code>
                          </span>
                          {er.ratePerUnit != null && <span style={{ color: '#6b7280', marginLeft: 8 }}>Rate: {currencySymbol(currency)}{er.ratePerUnit}</span>}
                          {er.earningsType && <span style={{ color: '#9ca3af', marginLeft: 8 }}>({er.earningsType})</span>}
                        </div>
                      ))}
                    </div>
                  </details>
                )}

                {payItemsResult.data.payItems.deductionTypes?.length > 0 && (
                  <details open style={{ marginBottom: 8 }}>
                    <summary style={{ fontSize: 13, fontWeight: 600, cursor: 'pointer', color: '#374151' }}>
                      Deduction Types ({payItemsResult.data.payItems.deductionTypes.length})
                    </summary>
                    <div style={{ marginTop: 6 }}>
                      {payItemsResult.data.payItems.deductionTypes.map((dt: any) => (
                        <div key={dt.deductionTypeID} style={{ fontSize: 12, padding: '4px 8px', borderBottom: '1px solid #f3f4f6' }}>
                          <strong>{dt.name}</strong>
                          <span style={{ color: '#6b7280', marginLeft: 8 }}>
                            ID: <code style={{ fontSize: 11, background: '#f3f4f6', padding: '1px 4px', borderRadius: 3 }}>{dt.deductionTypeID}</code>
                          </span>
                          {dt.deductionCategory && <span style={{ color: '#9ca3af', marginLeft: 8 }}>({dt.deductionCategory})</span>}
                        </div>
                      ))}
                    </div>
                  </details>
                )}

                {payItemsResult.data.payItems.benefitTypes?.length > 0 && (
                  <details open style={{ marginBottom: 8 }}>
                    <summary style={{ fontSize: 13, fontWeight: 600, cursor: 'pointer', color: '#374151' }}>
                      Benefit Types ({payItemsResult.data.payItems.benefitTypes.length})
                    </summary>
                    <div style={{ marginTop: 6 }}>
                      {payItemsResult.data.payItems.benefitTypes.map((bt: any) => (
                        <div key={bt.benefitTypeID} style={{ fontSize: 12, padding: '4px 8px', borderBottom: '1px solid #f3f4f6' }}>
                          <strong>{bt.name}</strong>
                          <span style={{ color: '#6b7280', marginLeft: 8 }}>
                            ID: <code style={{ fontSize: 11, background: '#f3f4f6', padding: '1px 4px', borderRadius: 3 }}>{bt.benefitTypeID}</code>
                          </span>
                        </div>
                      ))}
                    </div>
                  </details>
                )}

                {payItemsResult.data.payItems.reimbursementTypes?.length > 0 && (
                  <details style={{ marginBottom: 8 }}>
                    <summary style={{ fontSize: 13, fontWeight: 600, cursor: 'pointer', color: '#374151' }}>
                      Reimbursement Types ({payItemsResult.data.payItems.reimbursementTypes.length})
                    </summary>
                    <div style={{ marginTop: 6 }}>
                      {payItemsResult.data.payItems.reimbursementTypes.map((rt: any) => (
                        <div key={rt.reimbursementTypeID} style={{ fontSize: 12, padding: '4px 8px', borderBottom: '1px solid #f3f4f6' }}>
                          <strong>{rt.name}</strong>
                          <span style={{ color: '#6b7280', marginLeft: 8 }}>
                            ID: <code style={{ fontSize: 11, background: '#f3f4f6', padding: '1px 4px', borderRadius: 3 }}>{rt.reimbursementTypeID}</code>
                          </span>
                        </div>
                      ))}
                    </div>
                  </details>
                )}
              </div>
            )}

            <details style={{ marginTop: 8 }}>
              <summary style={{ fontSize: 12, color: '#6b7280', cursor: 'pointer' }}>Raw JSON</summary>
              <pre style={preStyle}>{JSON.stringify(payItemsResult.data, null, 2)}</pre>
            </details>
          </div>
        )}
      </div>

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

            {payRunsResult.data?.payRuns?.length > 0 && (
              <div style={{ marginTop: 12 }}>
                {payRunsResult.data.payRuns.map((pr: any) => (
                  <div key={pr.payRunID} style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 12, marginBottom: 10, background: '#fafafa' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                      <div>
                        <strong style={{ fontSize: 13 }}>{pr.calendarType} Pay Run</strong>
                        <span style={{
                          marginLeft: 8, fontSize: 11, padding: '2px 8px', borderRadius: 10, fontWeight: 600,
                          background: pr.payRunStatus === 'Draft' ? '#fff3e0' : '#e8f5e9',
                          color: pr.payRunStatus === 'Draft' ? '#e65100' : '#2e7d32',
                        }}>{pr.payRunStatus}</span>
                      </div>
                      <span style={{ fontSize: 12, color: '#6b7280' }}>
                        {new Date(pr.periodStartDate).toLocaleDateString('en-GB')} – {new Date(pr.periodEndDate).toLocaleDateString('en-GB')}
                      </span>
                    </div>
                    <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>
                      <strong>PayRunID:</strong> <code style={{ fontSize: 11 }}>{pr.payRunID}</code>
                      {' · '}<strong>Total Pay:</strong> {currencySymbol(currency)}{pr.totalPay?.toFixed(2)}
                      {' · '}<strong>Payment:</strong> {new Date(pr.paymentDate).toLocaleDateString('en-GB')}
                    </div>

                    {pr.paySlips?.length > 0 ? (
                      <div style={{ marginTop: 6 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 4 }}>
                          Payslips ({pr.paySlips.length}) — click to load in section 2:
                        </div>
                        {pr.paySlips.map((ps: any) => (
                          <button
                            key={ps.paySlipID}
                            onClick={() => { setPayslipId(ps.paySlipID); setUpdatePayRunId(pr.payRunID) }}
                            style={{
                              display: 'block', width: '100%', textAlign: 'left', padding: '6px 10px', marginBottom: 3,
                              background: payslipId === ps.paySlipID ? '#e0e7ff' : '#fff',
                              border: '1px solid #d1d5db', borderRadius: 6, cursor: 'pointer', fontSize: 12,
                            }}
                          >
                            <strong>{ps.firstName} {ps.lastName}</strong>
                            <span style={{ color: '#6b7280', marginLeft: 8 }}>
                              PayslipID: <code style={{ fontSize: 11 }}>{ps.paySlipID}</code>
                            </span>
                            {ps.netPay != null && (
                              <span style={{ float: 'right', fontWeight: 600, color: '#2e7d32' }}>{currencySymbol(currency)}{ps.netPay?.toFixed(2)}</span>
                            )}
                          </button>
                        ))}
                      </div>
                    ) : (
                      <div style={{ fontSize: 12, color: '#9ca3af', fontStyle: 'italic', marginTop: 4 }}>
                        No payslip details returned for this pay run
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            <details style={{ marginTop: 8 }}>
              <summary style={{ fontSize: 12, color: '#6b7280', cursor: 'pointer' }}>Raw JSON</summary>
              <pre style={preStyle}>{JSON.stringify(payRunsResult.data, null, 2)}</pre>
            </details>
          </div>
        )}
      </div>

      {/* ── 2. Get Payslip ────────────────────────────────────────────────── */}
      <div style={sectionStyle}>
        <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>2. Get Payslip Detail</h2>
        <p style={{ color: '#6b7280', fontSize: 13, marginBottom: 12 }}>
          GET /payroll.xro/2.0/Payslips/&#123;PayslipID&#125; — retrieves an employee's draft payslip.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
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

      {/* ── 3. Push Timesheet Lines ─────────────────────────────────────── */}
      <div style={sectionStyle}>
        <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>3. Push Timesheet Lines</h2>
        <p style={{ color: '#6b7280', fontSize: 13, marginBottom: 12 }}>
          POST /payroll.xro/2.0/Timesheets/&#123;id&#125;/Lines — adds earnings lines to the employee's
          existing draft timesheet. Xero auto-creates timesheets per pay period; this pushes hours/overtime
          into them. Hours are spread across weekdays (max 8hrs/day per line).
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
          <div>
            <label style={labelStyle}>PayslipID <span style={{ fontWeight: 400, color: '#9ca3af' }}>(used to find employee's timesheet)</span></label>
            <input
              style={inputStyle}
              placeholder="e.g. e061a3ee-2f13-..."
              value={updatePayslipId}
              onChange={(e) => setUpdatePayslipId(e.target.value)}
            />
          </div>
          <div>
            <label style={labelStyle}>PayRunID <span style={{ fontWeight: 400, color: '#9ca3af' }}>(auto-filled from section 1)</span></label>
            <input
              style={inputStyle}
              placeholder="e.g. ba97000d-dec5-..."
              value={updatePayRunId}
              onChange={(e) => setUpdatePayRunId(e.target.value)}
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
              placeholder='{"PaySlip": {"PaySlipID": "...", "EarningsLines": [...]}}'
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
          {loading === 'update_payslip' ? 'Pushing lines…' : 'Update Payslip'}
        </button>

        {updateResult && (
          <div>
            {/* Summary banner */}
            {updateResult.note && (
              <div style={{
                marginTop: 12, padding: 12, borderRadius: 8,
                background: updateResult.failures === 0 ? '#ecfdf5' : '#fffbeb',
                border: `1px solid ${updateResult.failures === 0 ? '#86efac' : '#fcd34d'}`,
              }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: updateResult.failures === 0 ? '#16a34a' : '#d97706', marginBottom: 4 }}>
                  {updateResult.failures === 0 ? 'Success' : 'Partial Success'}
                </div>
                <div style={{ fontSize: 13 }}>{updateResult.note}</div>
                {updateResult.timesheetID && (
                  <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>
                    <strong>Timesheet:</strong> <code style={{ fontSize: 11 }}>{updateResult.timesheetID}</code>
                    {' · '}<strong>Period:</strong> {updateResult.timesheetPeriod}
                    {' · '}<strong>Weekdays:</strong> {updateResult.weekdaysAvailable}
                  </div>
                )}
              </div>
            )}

            {/* Individual line results */}
            {updateResult.lineResults?.length > 0 && (
              <div style={{ marginTop: 12 }}>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
                  Timesheet Lines ({updateResult.lineResults.length})
                </div>
                {updateResult.lineResults.map((lr: any, i: number) => (
                  <div key={i} style={{
                    border: `1px solid ${lr.success ? '#86efac' : '#fecaca'}`,
                    borderRadius: 6, padding: 10, marginBottom: 6,
                    background: lr.success ? '#f0fdf4' : '#fef2f2',
                  }}>
                    <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 2 }}>
                      <span style={{ color: lr.success ? '#16a34a' : '#dc2626', marginRight: 6 }}>
                        {lr.success ? '✓' : '✗'}
                      </span>
                      {lr.numberOfUnits}hrs on {new Date(lr.date).toLocaleDateString('en-GB')}
                      <span style={{ color: '#6b7280', fontWeight: 400, marginLeft: 8, fontSize: 12 }}>
                        Rate: <code style={{ fontSize: 11 }}>{lr.earningsRateID?.substring(0, 8)}…</code>
                      </span>
                    </div>
                    <div style={{ fontSize: 12, color: '#6b7280' }}>
                      <strong>Status:</strong>{' '}
                      <span style={{ color: lr.success ? '#16a34a' : '#dc2626' }}>{lr.status}</span>
                    </div>
                    {lr.data?.timesheetLine && (
                      <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>
                        <strong>Line ID:</strong> <code style={{ fontSize: 11 }}>{lr.data.timesheetLine.timesheetLineID}</code>
                      </div>
                    )}
                    <details style={{ marginTop: 4 }}>
                      <summary style={{ fontSize: 11, color: '#9ca3af', cursor: 'pointer' }}>Response</summary>
                      <pre style={{ ...preStyle, maxHeight: 200, fontSize: 11 }}>{JSON.stringify(lr.data, null, 2)}</pre>
                    </details>
                  </div>
                ))}
              </div>
            )}

            {/* Error fallback */}
            {updateResult.error && !updateResult.lineResults && (
              <div style={{ marginTop: 12, padding: 12, background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#dc2626', marginBottom: 4 }}>Error</div>
                <div style={{ fontSize: 13 }}>{updateResult.error}</div>
                <pre style={preStyle}>{JSON.stringify(updateResult, null, 2)}</pre>
              </div>
            )}

            {/* Timesheet detail */}
            {updateResult.timesheetDetail && (
              <details style={{ marginTop: 8 }}>
                <summary style={{ fontSize: 12, color: '#6b7280', cursor: 'pointer' }}>Timesheet Detail (before update)</summary>
                <pre style={preStyle}>{JSON.stringify(updateResult.timesheetDetail, null, 2)}</pre>
              </details>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
