import { describe, it, expect } from 'vitest'
import {
  validateNINumber,
  validateSortCode,
  validateAccountNumber,
  formatNINumber,
  formatSortCode,
} from './validators'

describe('validateNINumber', () => {
  it('accepts valid NI number', () => {
    expect(validateNINumber('AB123456C')).toBeNull()
  })

  it('accepts NI with spaces', () => {
    expect(validateNINumber('AB 12 34 56 C')).toBeNull()
  })

  it('accepts lowercase', () => {
    expect(validateNINumber('ab123456c')).toBeNull()
  })

  it('rejects invalid suffix letter (E)', () => {
    expect(validateNINumber('AB123456E')).not.toBeNull()
  })

  it('rejects too few digits', () => {
    expect(validateNINumber('AB12345C')).not.toBeNull()
  })

  it('rejects invalid prefix letters (D, F, I, Q, U, V)', () => {
    expect(validateNINumber('DA123456C')).not.toBeNull()
    expect(validateNINumber('QQ123456A')).not.toBeNull()
  })

  it('returns null for empty string', () => {
    expect(validateNINumber('')).toBeNull()
  })
})

describe('validateSortCode', () => {
  it('accepts 6-digit sort code', () => {
    expect(validateSortCode('010203')).toBeNull()
  })

  it('accepts sort code with hyphens', () => {
    expect(validateSortCode('01-02-03')).toBeNull()
  })

  it('accepts sort code with spaces', () => {
    expect(validateSortCode('01 02 03')).toBeNull()
  })

  it('rejects too few digits', () => {
    expect(validateSortCode('12345')).not.toBeNull()
  })

  it('rejects letters', () => {
    expect(validateSortCode('AB-CD-EF')).not.toBeNull()
  })

  it('returns null for empty string', () => {
    expect(validateSortCode('')).toBeNull()
  })
})

describe('validateAccountNumber', () => {
  it('accepts 8-digit account number', () => {
    expect(validateAccountNumber('12345678')).toBeNull()
  })

  it('accepts account number with spaces', () => {
    expect(validateAccountNumber('1234 5678')).toBeNull()
  })

  it('rejects 7 digits', () => {
    expect(validateAccountNumber('1234567')).not.toBeNull()
  })

  it('rejects 9 digits', () => {
    expect(validateAccountNumber('123456789')).not.toBeNull()
  })

  it('returns null for empty string', () => {
    expect(validateAccountNumber('')).toBeNull()
  })
})

describe('formatNINumber', () => {
  it('formats as AB 12 34 56 C', () => {
    expect(formatNINumber('ab123456c')).toBe('AB 12 34 56 C')
  })

  it('handles already-formatted input', () => {
    expect(formatNINumber('AB 12 34 56 C')).toBe('AB 12 34 56 C')
  })

  it('handles partial input', () => {
    expect(formatNINumber('AB')).toBe('AB')
  })
})

describe('formatSortCode', () => {
  it('formats as 01-02-03', () => {
    expect(formatSortCode('010203')).toBe('01-02-03')
  })

  it('handles already-formatted input', () => {
    expect(formatSortCode('01-02-03')).toBe('01-02-03')
  })

  it('handles partial input', () => {
    expect(formatSortCode('01')).toBe('01')
  })
})
