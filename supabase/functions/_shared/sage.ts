import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

export function getSupabase() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )
}

export const corsHeaders = {
  'Access-Control-Allow-Origin': 'https://app.inflowhr.com',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

export function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

export interface ParsedPayslip {
  employee_name: string
  employee_number: string
  department: string
  ni_number: string
  tax_code: string
  gross_pay: number
  tax: number
  national_insurance: number
  pension: number
  other_deductions: number
  net_pay: number
  pay_period_start: string
  pay_period_end: string
  payment_date: string
}

export function parseSagePayslipText(text: string): ParsedPayslip[] {
  const normalised = text.replace(/Â£/g, '£').replace(/Â£/g, '£')

  const pages = normalised.split(/={10,}|\f/).filter(s => s.trim())
  const payslips: ParsedPayslip[] = []

  for (const page of pages) {
    const lines = page.split('\n').map(l => l.trim()).filter(Boolean)
    const block = lines.join(' ')

    let empName = ''
    let empNo = ''
    let dept = ''
    let niNumber = ''
    let taxCode = ''
    let grossPay = 0
    let tax = 0
    let ni = 0
    let pension = 0
    let netPay = 0
    let payDate = ''

    const namePatterns = [
      /Employee\s+Name:\s*(.+?)\s{2,}/i,
      /Employee\s+Name:\s*(.+?)(?:\s+Employee\s+No)/i,
      /Employee\s+Name:\s*(.+?)$/im,
      /Name:\s*(.+?)\s{2,}/i,
    ]
    for (const pat of namePatterns) {
      const m = block.match(pat) || lines.join('\n').match(pat)
      if (m) { empName = m[1].trim(); break }
    }

    const noPatterns = [
      /Employee\s+No\.?:\s*(\S+)/i,
      /Emp\.?\s+No\.?:\s*(\S+)/i,
      /Employee\s+Number:\s*(\S+)/i,
      /Employee\s+ID:\s*(\S+)/i,
      /Payroll\s+(?:No|Number|ID)\.?:\s*(\S+)/i,
    ]
    for (const pat of noPatterns) {
      const m = block.match(pat)
      if (m) { empNo = m[1].trim(); break }
    }

    if (!empName || !empNo) continue

    const deptM = block.match(/Department:\s*([A-Za-z][A-Za-z0-9 &/-]*?)(?:\s{2,}|$)/i)
    if (deptM) dept = deptM[1].trim()

    const niM = block.match(/NI\s+(?:Number|No\.?):\s*([A-Z]{2}\d{6}[A-D])/i)
    if (niM) niNumber = niM[1].trim()

    const tcM = block.match(/Tax\s+Code:\s*(\S+)/i)
    if (tcM) taxCode = tcM[1].trim()

    const datePatterns = [
      /Pay(?:ment)?\s+Date:\s*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i,
      /Date\s+(?:of\s+)?Pay(?:ment)?:\s*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i,
      /Payment:\s*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i,
    ]
    for (const pat of datePatterns) {
      const m = block.match(pat)
      if (m) { payDate = m[1].trim(); break }
    }

    const moneyRe = (label: string) =>
      new RegExp(label + '\\s*:?\\s*£?([\\d,]+\\.\\d{2})', 'i')

    const grossM = block.match(moneyRe('Gross\\s+Pay'))
    if (grossM) grossPay = parseFloat(grossM[1].replace(/,/g, ''))

    const netM = block.match(/NET\s+PAY\s*:?\s*£?([\d,]+\.\d{2})/i)
      || block.match(/Net\s+Pay\s*:?\s*£?([\d,]+\.\d{2})/i)
    if (netM) netPay = parseFloat(netM[1].replace(/,/g, ''))

    const taxM = block.match(/PAYE\s+(?:Tax)?\s*:?\s*£?([\d,]+\.\d{2})/i)
      || block.match(/Income\s+Tax\s*:?\s*£?([\d,]+\.\d{2})/i)
      || block.match(/Tax\s+Deducted\s*:?\s*£?([\d,]+\.\d{2})/i)
    if (taxM) tax = parseFloat(taxM[1].replace(/,/g, ''))

    const niAmtM = block.match(/National\s+Insurance\s*(?:\(Employee\))?\s*:?\s*£?([\d,]+\.\d{2})/i)
      || block.match(/Employee(?:'s)?\s+NIC?\s*:?\s*£?([\d,]+\.\d{2})/i)
      || block.match(/NI\s+Contribution\s*:?\s*£?([\d,]+\.\d{2})/i)
    if (niAmtM) ni = parseFloat(niAmtM[1].replace(/,/g, ''))

    const penM = block.match(/Pension\s*\(Employee\)\s*:?\s*£?([\d,]+\.\d{2})/i)
      || block.match(/Employee(?:'s)?\s+Pension\s*:?\s*£?([\d,]+\.\d{2})/i)
      || block.match(/Pension\s+Contribution\s*:?\s*£?([\d,]+\.\d{2})/i)
      || block.match(/Pension\s*:?\s*£?([\d,]+\.\d{2})/i)
    if (penM) pension = parseFloat(penM[1].replace(/,/g, ''))

    let periodStart = ''
    let periodEnd = ''
    let payDateISO = ''
    if (payDate) {
      const sep = payDate.includes('/') ? '/' : '-'
      const parts = payDate.split(sep)
      let dd = parseInt(parts[0]), mm = parseInt(parts[1]), yyyy = parseInt(parts[2])
      if (yyyy < 100) yyyy += 2000
      const payDateObj = new Date(yyyy, mm - 1, dd)
      const monthStart = new Date(payDateObj.getFullYear(), payDateObj.getMonth(), 1)
      const monthEnd = new Date(payDateObj.getFullYear(), payDateObj.getMonth() + 1, 0)
      periodStart = `${monthStart.getFullYear()}-${String(monthStart.getMonth() + 1).padStart(2, '0')}-01`
      periodEnd = `${monthEnd.getFullYear()}-${String(monthEnd.getMonth() + 1).padStart(2, '0')}-${String(monthEnd.getDate()).padStart(2, '0')}`
      payDateISO = `${yyyy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`
    }

    const totalNamedDed = tax + ni + pension
    const otherDed = Math.round(Math.max(0, grossPay - netPay - totalNamedDed) * 100) / 100

    payslips.push({
      employee_name: empName,
      employee_number: empNo,
      department: dept,
      ni_number: niNumber,
      tax_code: taxCode,
      gross_pay: grossPay,
      tax,
      national_insurance: ni,
      pension,
      other_deductions: otherDed,
      net_pay: netPay,
      pay_period_start: periodStart,
      pay_period_end: periodEnd,
      payment_date: payDateISO,
    })
  }

  return payslips
}
