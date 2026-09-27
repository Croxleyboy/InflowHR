import { supabase } from './supabase'

export interface TimeBlock {
  source: 'timesheet' | 'shift' | 'legal_timesheet'
  label: string
  date: string
  startMins: number
  endMins: number
}

function timeToMins(t: string): number {
  const [h, m] = t.split(':').map(Number)
  return h * 60 + (m || 0)
}

export interface OverlapResult {
  hasOverlap: boolean
  conflicts: { existing: TimeBlock; message: string }[]
}

const SOURCE_LABELS: Record<string, string> = {
  timesheet: 'Timesheet',
  shift: 'Shift',
  legal_timesheet: 'Legal Timesheet',
}

const MAX_DAILY_HRS = 10

export async function checkTimeOverlap(
  employeeId: string,
  companyId: string,
  dates: string[],
  startTime: string,
  endTime: string,
  enabledFeatures: { timesheets: boolean; shifts: boolean; legal_timesheets: boolean },
  excludeSource?: { type: 'timesheet' | 'shift' | 'legal_timesheet'; id?: string },
): Promise<OverlapResult> {
  const newStart = timeToMins(startTime)
  const newEnd = timeToMins(endTime)
  const newHrs = (newEnd - newStart) / 60
  const existing: TimeBlock[] = []

  const queries: Promise<void>[] = []

  if (enabledFeatures.timesheets) {
    queries.push((async () => {
      let q = supabase
        .from('timesheets')
        .select('id, date, end_date, start_time, end_time, location, status')
        .eq('employee_id', employeeId)
        .eq('company_id', companyId)
        .neq('status', 'rejected')
      if (dates.length === 1) {
        q = q.lte('date', dates[0]).gte('end_date', dates[0])
      } else {
        q = q.lte('date', dates[dates.length - 1]).gte('end_date', dates[0])
      }
      const { data } = await q
      if (data) {
        for (const row of data) {
          if (excludeSource?.type === 'timesheet' && excludeSource.id === row.id) continue
          const rowStart = row.date
          const rowEnd = row.end_date || row.date
          for (const d of dates) {
            if (d >= rowStart && d <= rowEnd) {
              existing.push({
                source: 'timesheet',
                label: `${row.location} (${row.start_time?.slice(0, 5)}-${row.end_time?.slice(0, 5)})`,
                date: d,
                startMins: timeToMins(row.start_time),
                endMins: timeToMins(row.end_time),
              })
            }
          }
        }
      }
    })())
  }

  if (enabledFeatures.shifts) {
    queries.push((async () => {
      let q = supabase
        .from('shift_assignments')
        .select('id, date, shift_template_id, shift_templates(name, start_time, end_time), rota_id, rotas(status)')
        .eq('employee_id', employeeId)
        .eq('company_id', companyId)
        .in('date', dates)
      const { data } = await q
      if (data) {
        for (const row of data as any[]) {
          if (excludeSource?.type === 'shift' && excludeSource.id === row.id) continue
          const rota = row.rotas as any
          if (rota?.status === 'draft') continue
          const tmpl = row.shift_templates as any
          if (!tmpl) continue
          existing.push({
            source: 'shift',
            label: `${tmpl.name} (${tmpl.start_time?.slice(0, 5)}-${tmpl.end_time?.slice(0, 5)})`,
            date: row.date,
            startMins: timeToMins(tmpl.start_time),
            endMins: timeToMins(tmpl.end_time),
          })
        }
      }
    })())
  }

  if (enabledFeatures.legal_timesheets) {
    queries.push((async () => {
      let q = supabase
        .from('legal_timesheet_entries')
        .select('id, date, duration_hrs, task_code, status')
        .eq('employee_id', employeeId)
        .eq('company_id', companyId)
        .neq('status', 'rejected')
        .in('date', dates)
      const { data } = await q
      if (data) {
        for (const row of data) {
          if (excludeSource?.type === 'legal_timesheet' && excludeSource.id === row.id) continue
          const durationMins = Math.round(Number(row.duration_hrs) * 60)
          existing.push({
            source: 'legal_timesheet',
            label: `${row.task_code} (${Number(row.duration_hrs).toFixed(1)}h)`,
            date: row.date,
            startMins: 0,
            endMins: durationMins,
          })
        }
      }
    })())
  }

  await Promise.all(queries)

  const conflicts: { existing: TimeBlock; message: string }[] = []

  for (const block of existing) {
    if (block.source === 'legal_timesheet') continue

    for (const d of dates) {
      if (block.date !== d) continue
      if (newStart < block.endMins && newEnd > block.startMins) {
        conflicts.push({
          existing: block,
          message: `Overlaps with ${SOURCE_LABELS[block.source]}: ${block.label} on ${new Date(d + 'T00:00:00').toLocaleDateString('en-GB')}`,
        })
      }
    }
  }

  for (const d of dates) {
    const dayBlocks = existing.filter(b => b.date === d)
    let dayHrs = 0
    for (const b of dayBlocks) {
      if (b.source === 'legal_timesheet') {
        dayHrs += b.endMins / 60
      } else {
        dayHrs += (b.endMins - b.startMins) / 60
      }
    }
    if (dayHrs + newHrs > MAX_DAILY_HRS) {
      const parts: string[] = []
      const legalHrs = dayBlocks.filter(b => b.source === 'legal_timesheet').reduce((s, b) => s + b.endMins / 60, 0)
      const tsHrs = dayBlocks.filter(b => b.source === 'timesheet').reduce((s, b) => s + (b.endMins - b.startMins) / 60, 0)
      const shiftHrs = dayBlocks.filter(b => b.source === 'shift').reduce((s, b) => s + (b.endMins - b.startMins) / 60, 0)
      if (tsHrs > 0) parts.push(`Timesheets: ${tsHrs.toFixed(1)}h`)
      if (shiftHrs > 0) parts.push(`Shifts: ${shiftHrs.toFixed(1)}h`)
      if (legalHrs > 0) parts.push(`Legal: ${legalHrs.toFixed(1)}h`)
      conflicts.push({
        existing: dayBlocks[0],
        message: `Adding ${newHrs.toFixed(1)}h on ${new Date(d + 'T00:00:00').toLocaleDateString('en-GB')} would exceed ${MAX_DAILY_HRS}h daily limit. Current: ${dayHrs.toFixed(1)}h (${parts.join(', ')})`,
      })
    }
  }

  return { hasOverlap: conflicts.length > 0, conflicts }
}

export async function getDailyTimeTotal(
  employeeId: string,
  companyId: string,
  date: string,
  enabledFeatures: { timesheets: boolean; shifts: boolean; legal_timesheets: boolean },
): Promise<{ timesheetHrs: number; shiftHrs: number; legalHrs: number; totalHrs: number }> {
  let timesheetHrs = 0
  let shiftHrs = 0
  let legalHrs = 0

  const queries: Promise<void>[] = []

  if (enabledFeatures.timesheets) {
    queries.push((async () => {
      const { data } = await supabase
        .from('timesheets')
        .select('start_time, end_time')
        .eq('employee_id', employeeId)
        .eq('company_id', companyId)
        .neq('status', 'rejected')
        .lte('date', date)
        .gte('end_date', date)
      if (data) {
        for (const row of data) {
          const s = timeToMins(row.start_time)
          const e = timeToMins(row.end_time)
          timesheetHrs += (e - s) / 60
        }
      }
    })())
  }

  if (enabledFeatures.shifts) {
    queries.push((async () => {
      const { data } = await supabase
        .from('shift_assignments')
        .select('shift_templates(start_time, end_time, break_minutes)')
        .eq('employee_id', employeeId)
        .eq('company_id', companyId)
        .eq('date', date)
      if (data) {
        for (const row of data as any[]) {
          const tmpl = row.shift_templates as any
          if (!tmpl) continue
          const s = timeToMins(tmpl.start_time)
          const e = timeToMins(tmpl.end_time)
          shiftHrs += (e - s - (tmpl.break_minutes || 0)) / 60
        }
      }
    })())
  }

  if (enabledFeatures.legal_timesheets) {
    queries.push((async () => {
      const { data } = await supabase
        .from('legal_timesheet_entries')
        .select('duration_hrs')
        .eq('employee_id', employeeId)
        .eq('company_id', companyId)
        .neq('status', 'rejected')
        .eq('date', date)
      if (data) {
        for (const row of data) {
          legalHrs += Number(row.duration_hrs)
        }
      }
    })())
  }

  await Promise.all(queries)
  return { timesheetHrs, shiftHrs, legalHrs, totalHrs: timesheetHrs + shiftHrs + legalHrs }
}
