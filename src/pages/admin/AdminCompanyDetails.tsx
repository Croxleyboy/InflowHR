import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { useAdminCompany } from '../../context/AdminCompanyContext'
import { useToast } from '../../context/ToastContext'

interface CompanyDetails {
  name: string
  company_registration_number: string
  vat_number: string
  billing_address_line1: string
  billing_address_line2: string
  billing_city: string
  billing_county: string
  billing_postcode: string
  billing_country: string
  billing_phone: string
  billing_email: string
  office_phone: string
  website_url: string
  staff_count: number | null
}

const EMPTY: CompanyDetails = {
  name: '',
  company_registration_number: '',
  vat_number: '',
  billing_address_line1: '',
  billing_address_line2: '',
  billing_city: '',
  billing_county: '',
  billing_postcode: '',
  billing_country: 'United Kingdom',
  billing_phone: '',
  billing_email: '',
  office_phone: '',
  website_url: '',
  staff_count: null,
}

const cardStyle: React.CSSProperties = {
  background: 'var(--card-bg, #fff)',
  borderRadius: 16,
  padding: 28,
  boxShadow: '0 1px 4px rgba(0,0,0,.06)',
  border: '1px solid var(--border, #e2e8f0)',
}

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 13,
  fontWeight: 600,
  color: 'var(--text-muted, #64748b)',
  marginBottom: 6,
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 14px',
  borderRadius: 10,
  border: '1px solid var(--border, #d1d5db)',
  fontSize: 14,
  color: 'var(--text, #1a1a2e)',
  background: 'var(--input-bg, #fff)',
  outline: 'none',
  boxSizing: 'border-box',
}

export default function AdminCompanyDetails() {
  const { selectedCompanyId } = useAdminCompany()
  const { showToast } = useToast()
  const [form, setForm] = useState<CompanyDetails>(EMPTY)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    if (!selectedCompanyId) return
    const { data } = await supabase
      .from('companies')
      .select('name, company_registration_number, vat_number, billing_address_line1, billing_address_line2, billing_city, billing_county, billing_postcode, billing_country, billing_phone, billing_email, office_phone, website_url, staff_count')
      .eq('id', selectedCompanyId)
      .single()
    if (data) {
      setForm({
        name: data.name || '',
        company_registration_number: data.company_registration_number || '',
        vat_number: data.vat_number || '',
        billing_address_line1: data.billing_address_line1 || '',
        billing_address_line2: data.billing_address_line2 || '',
        billing_city: data.billing_city || '',
        billing_county: data.billing_county || '',
        billing_postcode: data.billing_postcode || '',
        billing_country: data.billing_country || 'United Kingdom',
        billing_phone: data.billing_phone || '',
        billing_email: data.billing_email || '',
        office_phone: data.office_phone || '',
        website_url: data.website_url || '',
        staff_count: data.staff_count ?? null,
      })
    }
  }, [selectedCompanyId])

  useEffect(() => { load() }, [load])

  function set(key: keyof CompanyDetails, value: string | number | null) {
    setForm(prev => ({ ...prev, [key]: value }))
  }

  async function handleSave() {
    if (!selectedCompanyId) return
    setSaving(true)
    const { error } = await supabase
      .from('companies')
      .update({
        name: form.name.trim(),
        company_registration_number: form.company_registration_number.trim() || null,
        vat_number: form.vat_number.trim() || null,
        billing_address_line1: form.billing_address_line1.trim() || null,
        billing_address_line2: form.billing_address_line2.trim() || null,
        billing_city: form.billing_city.trim() || null,
        billing_county: form.billing_county.trim() || null,
        billing_postcode: form.billing_postcode.trim() || null,
        billing_country: form.billing_country.trim() || 'United Kingdom',
        billing_phone: form.billing_phone.trim() || null,
        billing_email: form.billing_email.trim() || null,
        office_phone: form.office_phone.trim() || null,
        website_url: form.website_url.trim() || null,
        staff_count: form.staff_count,
      })
      .eq('id', selectedCompanyId)
    setSaving(false)
    if (error) {
      showToast('Failed to save company details', 'error')
    } else {
      showToast('Company details saved', 'success')
    }
  }

  return (
    <div style={{ maxWidth: 820, margin: '0 auto' }}>
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: 'var(--text, #1a1a2e)' }}>Company Details</h1>
        <p style={{ margin: '4px 0 0', fontSize: 14, color: 'var(--text-muted, #64748b)' }}>
          Manage your company's core information, registration details, and office address.
        </p>
      </div>

      {/* Company Identity */}
      <div style={{ ...cardStyle, marginBottom: 20 }}>
        <h3 style={{ margin: '0 0 18px', fontSize: 15, fontWeight: 700, color: 'var(--text, #1a1a2e)' }}>Company Identity</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16 }}>
          <div>
            <label style={labelStyle}>Company Name *</label>
            <input style={inputStyle} value={form.name} onChange={e => set('name', e.target.value)} placeholder="e.g. Acme Ltd" />
          </div>
          <div>
            <label style={labelStyle}>Registered Business Number</label>
            <input style={inputStyle} value={form.company_registration_number} onChange={e => set('company_registration_number', e.target.value)} placeholder="e.g. 12345678" />
          </div>
          <div>
            <label style={labelStyle}>VAT Number</label>
            <input style={inputStyle} value={form.vat_number} onChange={e => set('vat_number', e.target.value)} placeholder="e.g. GB123456789" />
          </div>
          <div>
            <label style={labelStyle}>Number of Staff</label>
            <input style={inputStyle} type="number" min={0} value={form.staff_count ?? ''} onChange={e => set('staff_count', e.target.value ? Number(e.target.value) : null)} placeholder="e.g. 25" />
          </div>
        </div>
      </div>

      {/* Office Address */}
      <div style={{ ...cardStyle, marginBottom: 20 }}>
        <h3 style={{ margin: '0 0 18px', fontSize: 15, fontWeight: 700, color: 'var(--text, #1a1a2e)' }}>Registered Office Address</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16 }}>
          <div style={{ gridColumn: '1 / -1' }}>
            <label style={labelStyle}>Address Line 1</label>
            <input style={inputStyle} value={form.billing_address_line1} onChange={e => set('billing_address_line1', e.target.value)} placeholder="e.g. 10 Downing Street" />
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <label style={labelStyle}>Address Line 2</label>
            <input style={inputStyle} value={form.billing_address_line2} onChange={e => set('billing_address_line2', e.target.value)} placeholder="e.g. Floor 2, Suite 4" />
          </div>
          <div>
            <label style={labelStyle}>City / Town</label>
            <input style={inputStyle} value={form.billing_city} onChange={e => set('billing_city', e.target.value)} placeholder="e.g. London" />
          </div>
          <div>
            <label style={labelStyle}>County</label>
            <input style={inputStyle} value={form.billing_county} onChange={e => set('billing_county', e.target.value)} placeholder="e.g. Greater London" />
          </div>
          <div>
            <label style={labelStyle}>Postcode</label>
            <input style={inputStyle} value={form.billing_postcode} onChange={e => set('billing_postcode', e.target.value)} placeholder="e.g. SW1A 2AA" />
          </div>
          <div>
            <label style={labelStyle}>Country</label>
            <input style={inputStyle} value={form.billing_country} onChange={e => set('billing_country', e.target.value)} placeholder="United Kingdom" />
          </div>
        </div>
      </div>

      {/* Contact Details */}
      <div style={{ ...cardStyle, marginBottom: 28 }}>
        <h3 style={{ margin: '0 0 18px', fontSize: 15, fontWeight: 700, color: 'var(--text, #1a1a2e)' }}>Contact Details</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16 }}>
          <div>
            <label style={labelStyle}>Office Phone</label>
            <input style={inputStyle} type="tel" value={form.office_phone} onChange={e => set('office_phone', e.target.value)} placeholder="e.g. 020 7123 4567" />
          </div>
          <div>
            <label style={labelStyle}>Billing Phone</label>
            <input style={inputStyle} type="tel" value={form.billing_phone} onChange={e => set('billing_phone', e.target.value)} placeholder="e.g. 020 7123 4568" />
          </div>
          <div>
            <label style={labelStyle}>Billing Email</label>
            <input style={inputStyle} type="email" value={form.billing_email} onChange={e => set('billing_email', e.target.value)} placeholder="e.g. accounts@acme.co.uk" />
          </div>
          <div>
            <label style={labelStyle}>Website</label>
            <input style={inputStyle} type="url" value={form.website_url} onChange={e => set('website_url', e.target.value)} placeholder="e.g. https://www.acme.co.uk" />
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button
          className="admin-btn admin-btn-primary"
          onClick={handleSave}
          disabled={saving || !form.name.trim()}
          style={{ padding: '10px 32px', fontSize: 14, fontWeight: 600, borderRadius: 10 }}
        >
          {saving ? 'Saving...' : 'Save Changes'}
        </button>
      </div>
    </div>
  )
}
