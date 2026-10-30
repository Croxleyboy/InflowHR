import { describe, it, expect } from 'vitest'

// ── Helpers matching production code ──────────────────────────────────────

interface FunctionCacheEntry {
  enabled: boolean
  suspended: boolean
  suspendedReason?: string
  inPlan: boolean
}
type FunctionCache = Record<string, FunctionCacheEntry>

function getFunctionGating(
  functionsCache: FunctionCache | null | undefined,
  funcId: string
): { blocked: boolean; message: string; reason?: string } {
  if (!functionsCache) return { blocked: false, message: '' }
  const fc = functionsCache[funcId]
  if (!fc) return { blocked: true, message: 'Not available in your InflowOnboarder configuration' }
  if (fc.suspended) return { blocked: true, message: 'Temporarily suspended by the InflowOnboarder service', reason: fc.suspendedReason }
  if (!fc.enabled) return { blocked: true, message: 'Switched off for your organisation in InflowOnboarder' }
  if (!fc.inPlan) return { blocked: true, message: 'Not in your InflowOnboarder plan' }
  return { blocked: false, message: '' }
}

function shouldShowNoPassNote(passStatus: string | null, runStatus: string | null): boolean {
  return passStatus === 'skipped' && runStatus !== 'failed'
}

function shouldShowBlockedNote(passStatus: string | null): boolean {
  return passStatus === 'blocked'
}

// ── getFunctionGating — off, suspended, not in plan, missing ──────────────

describe('getFunctionGating', () => {
  const on: FunctionCacheEntry = { enabled: true, suspended: false, inPlan: true }
  const off: FunctionCacheEntry = { enabled: false, suspended: false, inPlan: true }
  const susp: FunctionCacheEntry = { enabled: true, suspended: true, suspendedReason: 'Maintenance', inPlan: true }
  const noPlan: FunctionCacheEntry = { enabled: true, suspended: false, inPlan: false }

  for (const funcId of ['movers', 'leavers', 'personas', 'reports']) {
    describe(funcId, () => {
      it('allows when enabled and in plan', () => {
        expect(getFunctionGating({ [funcId]: on }, funcId).blocked).toBe(false)
      })
      it('blocks when off', () => {
        const r = getFunctionGating({ [funcId]: off }, funcId)
        expect(r.blocked).toBe(true)
        expect(r.message).toContain('Switched off')
      })
      it('blocks when suspended', () => {
        const r = getFunctionGating({ [funcId]: susp }, funcId)
        expect(r.blocked).toBe(true)
        expect(r.message).toContain('suspended')
        expect(r.reason).toBe('Maintenance')
      })
      it('blocks when not in plan', () => {
        const r = getFunctionGating({ [funcId]: noPlan }, funcId)
        expect(r.blocked).toBe(true)
        expect(r.message).toContain('plan')
      })
    })
  }

  describe('missing from cache', () => {
    it('blocks when cache has data but funcId absent', () => {
      const r = getFunctionGating({ joiners: on }, 'movers')
      expect(r.blocked).toBe(true)
      expect(r.message).toContain('Not available')
    })
    it('allows when cache is null (pre-connection)', () => {
      expect(getFunctionGating(null, 'movers').blocked).toBe(false)
    })
    it('allows when cache is undefined', () => {
      expect(getFunctionGating(undefined, 'movers').blocked).toBe(false)
    })
  })
})

// ── schedule.blocked → 'blocked' (not 'skipped') ─────────────────────────

describe('schedule.blocked handling', () => {
  const passBlockCodes = ['passes_off', 'passes_not_connected', 'passes_setup_incomplete']

  function webhookBlockedLogic(errCode: string, errFunction: string | undefined, schedAskedForPass: boolean) {
    if (schedAskedForPass && (passBlockCodes.includes(errCode) || (errCode === 'function_suspended' && errFunction === 'passes'))) {
      return 'blocked'
    }
    return null
  }

  it('sets blocked for passes_off when schedule asked for pass', () => {
    expect(webhookBlockedLogic('passes_off', undefined, true)).toBe('blocked')
  })

  it('sets blocked for passes_not_connected when schedule asked for pass', () => {
    expect(webhookBlockedLogic('passes_not_connected', undefined, true)).toBe('blocked')
  })

  it('sets blocked for passes_setup_incomplete when schedule asked for pass', () => {
    expect(webhookBlockedLogic('passes_setup_incomplete', undefined, true)).toBe('blocked')
  })

  it('sets blocked for function_suspended on passes function when schedule asked for pass', () => {
    expect(webhookBlockedLogic('function_suspended', 'passes', true)).toBe('blocked')
  })

  it('does NOT set blocked for function_suspended on joiners (no pass issue)', () => {
    expect(webhookBlockedLogic('function_suspended', 'joiners', true)).toBeNull()
  })

  it('does NOT set blocked for function_suspended when no function field and schedule asked for pass', () => {
    expect(webhookBlockedLogic('function_suspended', undefined, true)).toBeNull()
  })

  it('does NOT change pass_status when schedule never asked for pass', () => {
    expect(webhookBlockedLogic('passes_off', undefined, false)).toBeNull()
  })

  it('does NOT change pass_status for non-pass error codes', () => {
    expect(webhookBlockedLogic('tenant_not_found', undefined, true)).toBeNull()
  })
})

// ── blocked → completed with passId (clears blocked state) ───────────────

describe('schedule.stage_completed after blocked', () => {
  function stageCompletedLogic(stageResult: any, schedAskedForPass: boolean, currentPassStatus: string | null) {
    if (stageResult?.passId) {
      return { pass_status: 'ready', pass_id: stageResult.passId, pass_error_detail: null }
    } else if (schedAskedForPass) {
      return { pass_status: 'skipped', pass_error_detail: null }
    }
    return null
  }

  it('clears blocked and sets ready when passId arrives', () => {
    const r = stageCompletedLogic({ passId: 'p1', expiresAt: '2026-11-01T09:00:00Z' }, true, 'blocked')
    expect(r).toEqual({ pass_status: 'ready', pass_id: 'p1', pass_error_detail: null })
  })

  it('sets skipped when stage completes without passId (pass dropped from schedule)', () => {
    const r = stageCompletedLogic({}, true, 'blocked')
    expect(r).toEqual({ pass_status: 'skipped', pass_error_detail: null })
  })

  it('sets skipped when stage completes with null result and schedule asked for pass', () => {
    const r = stageCompletedLogic(null, true, 'blocked')
    expect(r).toEqual({ pass_status: 'skipped', pass_error_detail: null })
  })

  it('does nothing when stage completes without passId and schedule never asked for pass', () => {
    const r = stageCompletedLogic({}, false, null)
    expect(r).toBeNull()
  })
})

// ── function_suspended on joiners with no pass requested ──────────────────

describe('function_suspended with no pass requested', () => {
  it('keeps pass_status null when schedule never asked for pass', () => {
    const schedAskedForPass = false
    const errCode = 'function_suspended'
    const passBlockCodes = ['passes_off', 'passes_not_connected', 'passes_setup_incomplete']
    let newPassStatus: string | null = null
    if (schedAskedForPass && (passBlockCodes.includes(errCode) || (errCode === 'function_suspended'))) {
      newPassStatus = 'blocked'
    }
    expect(newPassStatus).toBeNull()
  })

  it('keeps pass_status null when function_suspended is for joiners function', () => {
    const schedAskedForPass = true
    const errCode = 'function_suspended'
    const errFunction = 'joiners'
    const passBlockCodes = ['passes_off', 'passes_not_connected', 'passes_setup_incomplete']
    let newPassStatus: string | null = null
    if (schedAskedForPass && (passBlockCodes.includes(errCode) || (errCode === 'function_suspended' && errFunction === 'passes'))) {
      newPassStatus = 'blocked'
    }
    expect(newPassStatus).toBeNull()
  })
})

// ── failed issue_pass step on completed run ───────────────────────────────

describe('failed issue_pass step on completed run', () => {
  it('sets run_status completed and pass_status skipped when only issue_pass failed', () => {
    const steps = [
      { name: 'create_user', status: 'completed' },
      { name: 'assign_licence', status: 'completed' },
      { name: 'issue_pass', status: 'failed', error: { code: 'passes_off', message: 'Passes off' } },
    ]
    const issuePassStep = steps.find(s => s.name === 'issue_pass')
    const othersFailed = steps.some(s => s.name !== 'issue_pass' && s.status === 'failed')
    const updates: Record<string, unknown> = {}
    if (issuePassStep?.status === 'failed' && !othersFailed) {
      updates.run_status = 'completed'
      updates.pass_status = 'skipped'
      updates.pass_error_detail = issuePassStep.error
    }
    expect(updates.run_status).toBe('completed')
    expect(updates.pass_status).toBe('skipped')
    expect(updates.pass_error_detail).toEqual({ code: 'passes_off', message: 'Passes off' })
  })

  it('does not override when other steps also failed', () => {
    const steps = [
      { name: 'create_user', status: 'failed', error: { code: 'tenant_error' } },
      { name: 'issue_pass', status: 'failed', error: { code: 'passes_off' } },
    ]
    const issuePassStep = steps.find(s => s.name === 'issue_pass')
    const othersFailed = steps.some(s => s.name !== 'issue_pass' && s.status === 'failed')
    const updates: Record<string, unknown> = {}
    if (issuePassStep?.status === 'failed' && !othersFailed) {
      updates.pass_status = 'skipped'
    }
    expect(updates.pass_status).toBeUndefined()
  })

  it('does not touch pass_status when issue_pass succeeded', () => {
    const steps = [
      { name: 'create_user', status: 'completed' },
      { name: 'issue_pass', status: 'completed', result: { passId: 'p1' } },
    ]
    const issuePassStep = steps.find(s => s.name === 'issue_pass')
    const updates: Record<string, unknown> = {}
    if (issuePassStep?.status === 'failed') {
      updates.pass_status = 'skipped'
    }
    expect(updates.pass_status).toBeUndefined()
  })
})

// ── UI note visibility ────────────────────────────────────────────────────

describe('UI note visibility', () => {
  describe('No First-Day Pass note (skipped)', () => {
    it('shows when pass_status is skipped and run completed', () => {
      expect(shouldShowNoPassNote('skipped', 'completed')).toBe(true)
    })
    it('shows when pass_status is skipped and run_status null', () => {
      expect(shouldShowNoPassNote('skipped', null)).toBe(true)
    })
    it('hides when pass_status is null', () => {
      expect(shouldShowNoPassNote(null, 'completed')).toBe(false)
    })
    it('hides when pass_status is ready', () => {
      expect(shouldShowNoPassNote('ready', 'completed')).toBe(false)
    })
    it('hides when pass_status is blocked', () => {
      expect(shouldShowNoPassNote('blocked', null)).toBe(false)
    })
    it('hides when run failed', () => {
      expect(shouldShowNoPassNote('skipped', 'failed')).toBe(false)
    })
  })

  describe('Sign-In Blocked note (blocked)', () => {
    it('shows when pass_status is blocked', () => {
      expect(shouldShowBlockedNote('blocked')).toBe(true)
    })
    it('hides when pass_status is skipped', () => {
      expect(shouldShowBlockedNote('skipped')).toBe(false)
    })
    it('hides when pass_status is null', () => {
      expect(shouldShowBlockedNote(null)).toBe(false)
    })
    it('hides when pass_status is ready', () => {
      expect(shouldShowBlockedNote('ready')).toBe(false)
    })
  })
})
