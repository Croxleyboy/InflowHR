// UK PII format validators — returns error message or null if valid

export function validateNINumber(value: string): string | null {
  if (!value) return null
  const cleaned = value.replace(/\s/g, '').toUpperCase()
  // UK NI format: 2 letters, 6 digits, 1 letter (A-D)
  if (!/^[A-CEGHJ-PR-TW-Z]{2}\d{6}[A-D]$/.test(cleaned)) {
    return 'Invalid NI number format (e.g. AB123456C)'
  }
  return null
}

export function validateSortCode(value: string): string | null {
  if (!value) return null
  const cleaned = value.replace(/[-\s]/g, '')
  if (!/^\d{6}$/.test(cleaned)) {
    return 'Invalid sort code (6 digits, e.g. 01-02-03)'
  }
  return null
}

export function validateAccountNumber(value: string): string | null {
  if (!value) return null
  const cleaned = value.replace(/\s/g, '')
  if (!/^\d{8}$/.test(cleaned)) {
    return 'Invalid account number (8 digits)'
  }
  return null
}

export function formatNINumber(value: string): string {
  const cleaned = value.replace(/\s/g, '').toUpperCase()
  if (cleaned.length <= 2) return cleaned
  // Format as AB 12 34 56 C
  return cleaned.replace(/^([A-Z]{2})(\d{2})(\d{2})(\d{2})([A-D]?)$/, '$1 $2 $3 $4 $5').trim()
}

export function formatSortCode(value: string): string {
  const cleaned = value.replace(/[-\s]/g, '')
  if (cleaned.length <= 2) return cleaned
  return cleaned.replace(/^(\d{2})(\d{2})?(\d{2})?$/, (_, a, b, c) =>
    [a, b, c].filter(Boolean).join('-')
  )
}
