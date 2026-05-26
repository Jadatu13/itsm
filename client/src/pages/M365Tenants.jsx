import { useEffect, useState } from 'react'
import { apiFetch } from '../utils/api'
import styles from './M365Tenants.module.css'
import ConfirmModal from '../components/ConfirmModal'

function formatDate(d) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' })
}

const SETUP_STEPS = [
  {
    step: '1',
    title: 'Register an Azure AD App',
    body: [
      'Sign in to portal.azure.com with a Global Admin account.',
      'Navigate to Microsoft Entra ID → App registrations → New registration.',
      'Name it something like "ITSM Automation".',
      'Under Supported account types, select "Accounts in any organizational directory (Any Microsoft Entra ID tenant – Multitenant)".',
      'Leave Redirect URI blank for now. Click Register.',
    ],
  },
  {
    step: '2',
    title: 'Add API Permissions',
    body: [
      'In your new app, go to API permissions → Add a permission → Microsoft Graph → Application permissions.',
      'Add these permissions:',
      '  • User.ReadWrite.All (create, update, disable users)',
      '  • Group.ReadWrite.All (add/remove group members)',
      '  • Directory.ReadWrite.All (general directory management)',
      '  • Organization.Read.All (read tenant info)',
      'Click Add permissions, then Grant admin consent for your tenant.',
    ],
  },
  {
    step: '3',
    title: 'Create a Client Secret',
    body: [
      'Go to Certificates & secrets → Client secrets → New client secret.',
      'Set a description (e.g. "ITSM") and expiry (24 months recommended).',
      'Copy the Value immediately — you cannot see it again.',
    ],
  },
  {
    step: '4',
    title: 'Note Your IDs',
    body: [
      'On the app Overview page, copy:',
      '  • Application (client) ID',
      '  • Directory (tenant) ID',
      'You now have everything needed to connect.',
    ],
  },
  {
    step: '5',
    title: 'For Each Charity Tenant',
    body: [
      'Each charity\'s Global Admin must consent to your app.',
      'Send them this URL (replace YOUR_CLIENT_ID):',
      'https://login.microsoftonline.com/common/adminconsent?client_id=YOUR_CLIENT_ID',
      'After they click Accept, the app can act on their tenant.',
      'Then add a connection below using their Tenant ID.',
    ],
  },
]

function ConnectModal({ onClose, onConnected, orgs }) {
  const [displayName, setDisplayName] = useState('')
  const [tenantId, setTenantId] = useState('')
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [orgId, setOrgId] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function handleConnect() {
    if (!displayName.trim() || !tenantId.trim() || !clientId.trim() || !clientSecret.trim()) {
      setError('All fields are required.')
      return
    }
    setSaving(true)
    setError('')
    try {
      const res = await apiFetch('/api/tenants', {
        method: 'POST',
        body: JSON.stringify({ display_name: displayName, tenant_id: tenantId, client_id: clientId, client_secret: clientSecret, organisation_id: orgId || null }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Connection failed.')
        return
      }
      onConnected(data)
    } catch (err) {
      setError(err.message || 'Connection failed.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className={styles.overlay} onClick={e => e.target === e.currentTarget && onClose()}>
      <div className={styles.modal}>
        <div className={styles.modalHeader}>
          <h2 className={styles.modalTitle}>Connect Microsoft 365 Tenant</h2>
          <button className={styles.closeBtn} onClick={onClose}>×</button>
        </div>

        <div className={styles.modalBody}>
          {/* Setup guide */}
          <div className={styles.setupGuide}>
            <p className={styles.setupIntro}>
              Follow these steps to register an Azure app and generate the credentials needed below.
            </p>
            {SETUP_STEPS.map(s => (
              <details key={s.step} className={styles.step}>
                <summary className={styles.stepTitle}>
                  <span className={styles.stepNum}>{s.step}</span>
                  {s.title}
                </summary>
                <div className={styles.stepBody}>
                  {s.body.map((line, i) => (
                    line.startsWith('http') ? (
                      <code key={i} className={styles.codeBlock}>{line}</code>
                    ) : (
                      <p key={i} className={styles.stepLine}>{line}</p>
                    )
                  ))}
                </div>
              </details>
            ))}
          </div>

          <hr className={styles.divider} />

          {/* Credential form */}
          <div className={styles.credForm}>
            <div className={styles.formGroup}>
              <label className={styles.label}>Organisation Name *</label>
              <input
                className={styles.input}
                value={displayName}
                onChange={e => setDisplayName(e.target.value)}
                placeholder="e.g. Charity A"
              />
            </div>
            <div className={styles.formGroup}>
              <label className={styles.label}>Tenant ID (Directory ID) *</label>
              <input
                className={styles.input}
                value={tenantId}
                onChange={e => setTenantId(e.target.value)}
                placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                spellCheck={false}
              />
            </div>
            <div className={styles.formGroup}>
              <label className={styles.label}>Client ID (Application ID) *</label>
              <input
                className={styles.input}
                value={clientId}
                onChange={e => setClientId(e.target.value)}
                placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                spellCheck={false}
              />
            </div>
            <div className={styles.formGroup}>
              <label className={styles.label}>Client Secret *</label>
              <input
                className={styles.input}
                type="password"
                value={clientSecret}
                onChange={e => setClientSecret(e.target.value)}
                placeholder="Paste the secret value from Azure"
              />
              <p className={styles.hint}>Stored securely. The secret is used to authenticate automation actions.</p>
            </div>
            <div className={styles.formGroup}>
              <label className={styles.label}>Link to Organisation</label>
              <select className={styles.input} value={orgId} onChange={e => setOrgId(e.target.value)}>
                <option value="">— Not linked —</option>
                {orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
              <p className={styles.hint}>When linked, service requests from this organisation's contacts will automatically use this tenant for automation.</p>
            </div>
          </div>

          {error && <div className={styles.error}>{error}</div>}
        </div>

        <div className={styles.modalFooter}>
          <button className={styles.btnSecondary} onClick={onClose}>Cancel</button>
          <button className={styles.btnPrimary} onClick={handleConnect} disabled={saving}>
            {saving ? '⏳ Verifying & Connecting…' : '🔗 Connect Tenant'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function M365Tenants() {
  const [tenants, setTenants] = useState([])
  const [orgs, setOrgs] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [confirmDisconnect, setConfirmDisconnect] = useState(null) // tenant to disconnect
  const [testing, setTesting] = useState(null)
  const [testResult, setTestResult] = useState({})
  const [linkingOrg, setLinkingOrg] = useState({}) // tenantId → orgId being saved

  useEffect(() => {
    Promise.all([
      apiFetch('/api/tenants').then(r => r.json()),
      apiFetch('/api/organisations').then(r => r.json()),
    ]).then(([t, o]) => {
      setTenants(Array.isArray(t) ? t : [])
      setOrgs(Array.isArray(o) ? o : [])
    }).finally(() => setLoading(false))
  }, [])

  async function handleOrgLink(tenantId, orgId) {
    setLinkingOrg(prev => ({ ...prev, [tenantId]: orgId }))
    const res = await apiFetch(`/api/tenants/${tenantId}/organisation`, {
      method: 'PATCH',
      body: JSON.stringify({ organisation_id: orgId || null }),
    })
    const data = await res.json()
    if (res.ok) {
      setTenants(prev => prev.map(t => t.id === tenantId
        ? { ...t, organisation_id: data.organisation_id, organisation_name: data.organisation_name }
        : t
      ))
    }
    setLinkingOrg(prev => { const n = { ...prev }; delete n[tenantId]; return n })
  }

  function handleConnected(tenant) {
    setTenants(prev => [tenant, ...prev])
    setShowModal(false)
  }

  async function handleTest(id) {
    setTesting(id)
    setTestResult(prev => ({ ...prev, [id]: null }))
    try {
      const res = await apiFetch(`/api/tenants/${id}/test`, { method: 'POST' })
      const data = await res.json()
      setTestResult(prev => ({
        ...prev,
        [id]: res.ok
          ? { ok: true, msg: '✅ ' + data.message }
          : { ok: false, msg: data.error }
      }))
    } catch (err) {
      setTestResult(prev => ({ ...prev, [id]: { ok: false, msg: err.message } }))
    } finally {
      setTesting(null)
    }
  }

  async function handleDelete(id) {
    await apiFetch(`/api/tenants/${id}`, { method: 'DELETE' })
    setTenants(prev => prev.filter(t => t.id !== id))
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Microsoft 365 Tenants</h1>
          <p className={styles.subtitle}>
            Connect your clients' M365 tenants to automate Entra ID actions from service requests.
          </p>
        </div>
        <button className={styles.btnPrimary} onClick={() => setShowModal(true)}>
          + Connect Tenant
        </button>
      </div>

      {/* How it works callout */}
      <div className={styles.howItWorks}>
        <div className={styles.howTitle}>⚡ How automation works</div>
        <div className={styles.howSteps}>
          <span className={styles.howStep}>1. Client submits a service request</span>
          <span className={styles.howArrow}>→</span>
          <span className={styles.howStep}>2. You review & click Approve</span>
          <span className={styles.howArrow}>→</span>
          <span className={styles.howStep}>3. ITSM runs the action in M365 automatically</span>
          <span className={styles.howArrow}>→</span>
          <span className={styles.howStep}>4. Ticket closes with execution log</span>
        </div>
      </div>

      {loading ? (
        <div className={styles.empty}>Loading…</div>
      ) : tenants.length === 0 ? (
        <div className={styles.emptyState}>
          <div className={styles.emptyIcon}>🏢</div>
          <div className={styles.emptyTitle}>No tenants connected</div>
          <div className={styles.emptyText}>
            Connect your first M365 tenant to start automating service requests.
            Automation actions will run in simulation mode until a tenant is connected.
          </div>
          <button className={styles.btnPrimary} onClick={() => setShowModal(true)}>
            + Connect Your First Tenant
          </button>
        </div>
      ) : (
        <div className={styles.tenantList}>
          {tenants.map(t => (
            <div key={t.id} className={styles.tenantCard}>
              <div className={styles.tenantIcon}>🏢</div>
              <div className={styles.tenantInfo}>
                <div className={styles.tenantName}>{t.display_name}</div>
                <div className={styles.tenantMeta}>
                  <span className={styles.tenantId} title="Tenant ID">{t.tenant_id}</span>
                  <span className={styles.tenantDate}>Connected {formatDate(t.connected_at || t.created_at)}</span>
                </div>
                <div className={styles.tenantCreds}>
                  Client ID: <code>{t.client_id}</code>
                  &nbsp;|&nbsp;Secret: <code>{t.client_secret_hint}</code>
                </div>
                <div className={styles.tenantOrgRow}>
                  <span className={styles.tenantOrgLabel}>Linked organisation:</span>
                  <select
                    className={styles.tenantOrgSelect}
                    value={t.organisation_id ?? ''}
                    onChange={e => handleOrgLink(t.id, e.target.value)}
                    disabled={t.id in linkingOrg}
                  >
                    <option value="">— Not linked —</option>
                    {orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                  </select>
                  {t.id in linkingOrg && <span className={styles.tenantOrgSaving}>Saving…</span>}
                </div>
                {testResult[t.id] && (
                  <div className={testResult[t.id].ok ? styles.testOk : styles.testFail}>
                    {testResult[t.id].msg}
                    {testResult[t.id].ok && (
                      <span className={styles.testHint}> — Token refreshed. Ready to execute actions.</span>
                    )}
                  </div>
                )}
              </div>
              <div className={styles.tenantStatus}>
                <span className={`${styles.connectedBadge} ${t.connected ? styles.connected : styles.disconnected}`}>
                  {t.connected ? '● Connected' : '● Disconnected'}
                </span>
              </div>
              <div className={styles.tenantActions}>
                <button
                  className={styles.btnSm}
                  onClick={() => handleTest(t.id)}
                  disabled={testing === t.id}
                  title="Verify connection and refresh the access token"
                >
                  {testing === t.id ? '⏳…' : '🔄 Test & Refresh'}
                </button>
                <button
                  className={`${styles.btnSm} ${styles.btnDanger}`}
                  onClick={() => setConfirmDisconnect(t)}
                >
                  Disconnect
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showModal && (
        <ConnectModal
          onClose={() => setShowModal(false)}
          onConnected={handleConnected}
          orgs={orgs}
        />
      )}

      {confirmDisconnect && (
        <ConfirmModal
          title="Disconnect tenant?"
          message={`This will remove the connection to ${confirmDisconnect.display_name}. Any automation actions configured for this tenant will stop working until reconnected.`}
          confirmLabel="Disconnect"
          onConfirm={() => handleDelete(confirmDisconnect.id)}
          onClose={() => setConfirmDisconnect(null)}
        />
      )}
    </div>
  )
}
