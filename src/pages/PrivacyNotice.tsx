import { useNavigate } from 'react-router-dom'

export default function PrivacyNotice() {
  const navigate = useNavigate()

  return (
    <div style={{ maxWidth: 780, margin: '0 auto', padding: '40px 24px 80px', fontFamily: 'var(--font-sans, system-ui, sans-serif)', color: 'var(--text-primary, #1a1a2e)', lineHeight: 1.7 }}>
      <button onClick={() => navigate(-1)} style={{ background: 'none', border: 'none', color: 'var(--primary, #6C4FBF)', cursor: 'pointer', fontSize: 14, padding: 0, marginBottom: 24, display: 'flex', alignItems: 'center', gap: 4 }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
        Back
      </button>

      <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 8 }}>Privacy Notice</h1>
      <p style={{ color: 'var(--text-secondary, #555)', fontSize: 14, marginBottom: 32 }}>Last updated: September 2026 &middot; Version 1.0</p>

      <section style={{ marginBottom: 28 }}>
        <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>1. Who we are</h2>
        <p>InflowHR is a cloud-based HR management platform operated by Kumonix Ltd ("we", "us", "our"). We act as a <strong>data processor</strong> on behalf of your employer (the "data controller"), who determines how and why your personal data is processed.</p>
        <p style={{ marginTop: 8 }}>Contact: <a href="mailto:privacy@inflowhr.com" style={{ color: 'var(--primary, #6C4FBF)' }}>privacy@inflowhr.com</a></p>
      </section>

      <section style={{ marginBottom: 28 }}>
        <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>2. What data we process</h2>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14, marginTop: 8 }}>
          <thead>
            <tr style={{ borderBottom: '2px solid var(--border, #e0e0e0)', textAlign: 'left' }}>
              <th style={{ padding: '8px 12px 8px 0' }}>Category</th>
              <th style={{ padding: '8px 12px' }}>Examples</th>
              <th style={{ padding: '8px 12px' }}>Lawful basis</th>
            </tr>
          </thead>
          <tbody>
            <tr style={{ borderBottom: '1px solid var(--border, #eee)' }}>
              <td style={{ padding: '8px 12px 8px 0', fontWeight: 500 }}>Identity &amp; contact</td>
              <td style={{ padding: '8px 12px' }}>Name, email, phone, address, date of birth, employee number</td>
              <td style={{ padding: '8px 12px' }}>Performance of contract (Art. 6(1)(b))</td>
            </tr>
            <tr style={{ borderBottom: '1px solid var(--border, #eee)' }}>
              <td style={{ padding: '8px 12px 8px 0', fontWeight: 500 }}>Payroll &amp; financial</td>
              <td style={{ padding: '8px 12px' }}>Salary, bank details, NI number, tax code, payslips</td>
              <td style={{ padding: '8px 12px' }}>Legal obligation (Art. 6(1)(c))</td>
            </tr>
            <tr style={{ borderBottom: '1px solid var(--border, #eee)' }}>
              <td style={{ padding: '8px 12px 8px 0', fontWeight: 500 }}>Employment records</td>
              <td style={{ padding: '8px 12px' }}>Job title, department, start/end dates, timesheets, leave</td>
              <td style={{ padding: '8px 12px' }}>Performance of contract (Art. 6(1)(b))</td>
            </tr>
            <tr style={{ borderBottom: '1px solid var(--border, #eee)' }}>
              <td style={{ padding: '8px 12px 8px 0', fontWeight: 500 }}>Performance</td>
              <td style={{ padding: '8px 12px' }}>Reviews, 1:1 meeting notes, goals</td>
              <td style={{ padding: '8px 12px' }}>Legitimate interest (Art. 6(1)(f))</td>
            </tr>
            <tr style={{ borderBottom: '1px solid var(--border, #eee)' }}>
              <td style={{ padding: '8px 12px 8px 0', fontWeight: 500 }}>Religion or belief</td>
              <td style={{ padding: '8px 12px' }}>Religion (optional field for accommodating religious observance)</td>
              <td style={{ padding: '8px 12px' }}>Explicit consent (Art. 9(2)(a))</td>
            </tr>
            <tr style={{ borderBottom: '1px solid var(--border, #eee)' }}>
              <td style={{ padding: '8px 12px 8px 0', fontWeight: 500 }}>Location data</td>
              <td style={{ padding: '8px 12px' }}>Check-in/check-out GPS coordinates (when feature enabled)</td>
              <td style={{ padding: '8px 12px' }}>Legitimate interest + explicit consent</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section style={{ marginBottom: 28 }}>
        <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>3. How we protect your data</h2>
        <ul style={{ paddingLeft: 20 }}>
          <li><strong>Encryption at rest:</strong> AES-256 for all database storage</li>
          <li><strong>Encryption in transit:</strong> TLS 1.2+ for all connections</li>
          <li><strong>Access control:</strong> Role-based access — payroll data is restricted to authorised payroll users only</li>
          <li><strong>Audit logging:</strong> All access to personal data is logged in an immutable audit trail</li>
          <li><strong>Multi-factor authentication:</strong> SSO via your organisation's identity provider (e.g. Microsoft Azure AD)</li>
          <li><strong>Data hosting:</strong> Employee data is stored on Supabase servers. No personal data is cached at the CDN edge.</li>
        </ul>
      </section>

      <section style={{ marginBottom: 28 }}>
        <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>4. Data retention</h2>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14, marginTop: 8 }}>
          <thead>
            <tr style={{ borderBottom: '2px solid var(--border, #e0e0e0)', textAlign: 'left' }}>
              <th style={{ padding: '8px 12px 8px 0' }}>Data type</th>
              <th style={{ padding: '8px 12px' }}>Retention period</th>
              <th style={{ padding: '8px 12px' }}>Reason</th>
            </tr>
          </thead>
          <tbody>
            <tr style={{ borderBottom: '1px solid var(--border, #eee)' }}>
              <td style={{ padding: '8px 12px 8px 0' }}>Payroll records</td>
              <td style={{ padding: '8px 12px' }}>7 years</td>
              <td style={{ padding: '8px 12px' }}>HMRC / Finance Act</td>
            </tr>
            <tr style={{ borderBottom: '1px solid var(--border, #eee)' }}>
              <td style={{ padding: '8px 12px 8px 0' }}>Working time / timesheets</td>
              <td style={{ padding: '8px 12px' }}>2 years</td>
              <td style={{ padding: '8px 12px' }}>Working Time Regulations</td>
            </tr>
            <tr style={{ borderBottom: '1px solid var(--border, #eee)' }}>
              <td style={{ padding: '8px 12px 8px 0' }}>Performance reviews</td>
              <td style={{ padding: '8px 12px' }}>5 years</td>
              <td style={{ padding: '8px 12px' }}>Employment tribunal limitation</td>
            </tr>
            <tr style={{ borderBottom: '1px solid var(--border, #eee)' }}>
              <td style={{ padding: '8px 12px 8px 0' }}>Contact details</td>
              <td style={{ padding: '8px 12px' }}>Employment + 1 year</td>
              <td style={{ padding: '8px 12px' }}>Reference requests</td>
            </tr>
            <tr style={{ borderBottom: '1px solid var(--border, #eee)' }}>
              <td style={{ padding: '8px 12px 8px 0' }}>Location / check-in data</td>
              <td style={{ padding: '8px 12px' }}>12 months</td>
              <td style={{ padding: '8px 12px' }}>Coordinates anonymised after 12 months</td>
            </tr>
            <tr style={{ borderBottom: '1px solid var(--border, #eee)' }}>
              <td style={{ padding: '8px 12px 8px 0' }}>Notifications</td>
              <td style={{ padding: '8px 12px' }}>90 days</td>
              <td style={{ padding: '8px 12px' }}>No statutory requirement</td>
            </tr>
          </tbody>
        </table>
        <p style={{ fontSize: 14, color: 'var(--text-secondary, #555)', marginTop: 8 }}>After the retention period, data is automatically anonymised or deleted. Anonymised records retain aggregate values for statutory reporting but all personal identifiers are permanently removed.</p>
      </section>

      <section style={{ marginBottom: 28 }}>
        <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>5. Your rights</h2>
        <p>Under UK GDPR, you have the right to:</p>
        <ul style={{ paddingLeft: 20 }}>
          <li><strong>Access your data</strong> — use the "Download My Data" button in Settings to export all your personal data as a JSON file</li>
          <li><strong>Rectification</strong> — contact your HR administrator to correct inaccurate data</li>
          <li><strong>Erasure</strong> — request deletion of your data (subject to statutory retention requirements)</li>
          <li><strong>Restrict processing</strong> — ask your employer to limit how your data is used</li>
          <li><strong>Data portability</strong> — receive your data in a structured, machine-readable format</li>
          <li><strong>Withdraw consent</strong> — for religion/belief data and geolocation, withdraw consent at any time via Settings</li>
        </ul>
        <p style={{ marginTop: 8 }}>To exercise these rights, contact your employer's HR department or email us at <a href="mailto:privacy@inflowhr.com" style={{ color: 'var(--primary, #6C4FBF)' }}>privacy@inflowhr.com</a>. We will respond within 30 days.</p>
      </section>

      <section style={{ marginBottom: 28 }}>
        <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>6. Sub-processors</h2>
        <p>We use the following third-party services to operate InflowHR:</p>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14, marginTop: 8 }}>
          <thead>
            <tr style={{ borderBottom: '2px solid var(--border, #e0e0e0)', textAlign: 'left' }}>
              <th style={{ padding: '8px 12px 8px 0' }}>Service</th>
              <th style={{ padding: '8px 12px' }}>Purpose</th>
              <th style={{ padding: '8px 12px' }}>Data processed</th>
            </tr>
          </thead>
          <tbody>
            <tr style={{ borderBottom: '1px solid var(--border, #eee)' }}>
              <td style={{ padding: '8px 12px 8px 0' }}>Supabase</td>
              <td style={{ padding: '8px 12px' }}>Database, authentication, file storage</td>
              <td style={{ padding: '8px 12px' }}>All employee data</td>
            </tr>
            <tr style={{ borderBottom: '1px solid var(--border, #eee)' }}>
              <td style={{ padding: '8px 12px 8px 0' }}>Cloudflare</td>
              <td style={{ padding: '8px 12px' }}>CDN, application delivery</td>
              <td style={{ padding: '8px 12px' }}>Static assets only (no PII)</td>
            </tr>
            <tr style={{ borderBottom: '1px solid var(--border, #eee)' }}>
              <td style={{ padding: '8px 12px 8px 0' }}>Brevo</td>
              <td style={{ padding: '8px 12px' }}>Email notifications</td>
              <td style={{ padding: '8px 12px' }}>Employee email addresses, notification content</td>
            </tr>
            <tr style={{ borderBottom: '1px solid var(--border, #eee)' }}>
              <td style={{ padding: '8px 12px 8px 0' }}>Microsoft Azure AD</td>
              <td style={{ padding: '8px 12px' }}>Single Sign-On authentication</td>
              <td style={{ padding: '8px 12px' }}>Email address, name (for SSO companies)</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section style={{ marginBottom: 28 }}>
        <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>7. Cookies and tracking</h2>
        <p>InflowHR does not use third-party analytics, advertising cookies, or tracking scripts. We use only:</p>
        <ul style={{ paddingLeft: 20 }}>
          <li>Authentication session cookies (essential, set by Supabase Auth)</li>
          <li>Local storage for UI preferences (theme, language — no personal data)</li>
        </ul>
      </section>

      <section style={{ marginBottom: 28 }}>
        <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>8. Data breach notification</h2>
        <p>In the event of a personal data breach, we will:</p>
        <ul style={{ paddingLeft: 20 }}>
          <li>Notify the ICO within 72 hours where the breach poses a risk to individuals</li>
          <li>Notify affected data controllers (your employer) without undue delay</li>
          <li>Notify affected individuals where the breach poses a high risk to their rights and freedoms</li>
        </ul>
      </section>

      <section>
        <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>9. Complaints</h2>
        <p>If you are not satisfied with how your data is handled, you can contact the Information Commissioner's Office (ICO):</p>
        <p style={{ marginTop: 8, fontSize: 14, color: 'var(--text-secondary, #555)' }}>
          Information Commissioner's Office<br />
          Wycliffe House, Water Lane, Wilmslow, Cheshire, SK9 5AF<br />
          Tel: 0303 123 1113<br />
          Website: ico.org.uk
        </p>
      </section>
    </div>
  )
}
