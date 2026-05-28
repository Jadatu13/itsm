import { useEffect, useState } from 'react'
import PageHeader from '../components/PageHeader'
import { apiFetch } from '../utils/api'
import formStyles from '../styles/forms.module.css'
import styles from './Settings.module.css'

const PASS_SENTINEL = '__UNCHANGED__'

export default function Settings() {
  // ── SMTP state ────────────────────────────────────────────────────────────
  const [form, setForm] = useState({
    smtp_host:       '',
    smtp_port:       '587',
    smtp_secure:     'false',
    smtp_user:       '',
    smtp_pass:       '',
    smtp_from_name:  '',
    smtp_from_email: '',
  })
  const [passSet, setPassSet] = useState(false)
  const [loading, setLoading]   = useState(true)
  const [saving, setSaving]     = useState(false)
  const [saveMsg, setSaveMsg]   = useState(null)
  const [testTo, setTestTo]     = useState('')
  const [testing, setTesting]   = useState(false)
  const [testMsg, setTestMsg]   = useState(null)

  // ── AI Assistant state ────────────────────────────────────────────────────
  const [ai, setAi] = useState({ ai_provider: 'grok', ai_model: '', ai_api_key: '' })
  const [aiKeySet, setAiKeySet]       = useState(false)
  const [aiLoading, setAiLoading]     = useState(true)
  const [aiSaving, setAiSaving]       = useState(false)
  const [aiMsg, setAiMsg]             = useState(null)
  const [aiTesting, setAiTesting]     = useState(false)
  const [aiTestMsg, setAiTestMsg]     = useState(null)

  // ── SLA state ─────────────────────────────────────────────────────────────
  const [sla, setSla] = useState({ sla_hours_high: 4, sla_hours_medium: 24, sla_hours_low: 72 })
  const [slaLoading, setSlaLoading]   = useState(true)
  const [slaSaving, setSlaSaving]     = useState(false)
  const [slaMsg, setSlaMsg]           = useState(null)

  // ── Inbound (IMAP) state ──────────────────────────────────────────────────
  const [inbound, setInbound] = useState({
    imap_host:          '',
    imap_port:          '993',
    imap_tls:           'true',
    imap_folder:        'INBOX',
    imap_poll_interval: '60',
    imap_user:          '',
    imap_pass:          '',
  })
  const [imapPassSet, setImapPassSet]       = useState(false)
  const [inboundLoading, setInboundLoading] = useState(true)
  const [inboundSaving, setInboundSaving]   = useState(false)
  const [inboundMsg, setInboundMsg]         = useState(null)
  const [polling, setPolling]               = useState(false)
  const [pollMsg, setPollMsg]               = useState(null)

  useEffect(() => {
    apiFetch('/api/settings/ai')
      .then(r => r.json())
      .then(d => {
        setAi({ ai_provider: d.ai_provider || 'grok', ai_model: d.ai_model || '', ai_api_key: '' })
        setAiKeySet(d.ai_key_set || false)
        setAiLoading(false)
      })
      .catch(() => setAiLoading(false))
  }, [])

  async function handleAiSave(e) {
    e.preventDefault()
    setAiSaving(true)
    setAiMsg(null)
    try {
      const body = { ...ai, ai_api_key: ai.ai_api_key || (aiKeySet ? PASS_SENTINEL : '') }
      const res = await apiFetch('/api/settings/ai', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const d = await res.json()
      if (res.ok) {
        setAiKeySet(d.ai_key_set)
        setAi(a => ({ ...a, ai_api_key: '' }))
        setAiMsg({ ok: true, text: 'AI settings saved.' })
      } else {
        setAiMsg({ ok: false, text: d.error || 'Failed to save.' })
      }
    } catch {
      setAiMsg({ ok: false, text: 'Something went wrong.' })
    }
    setAiSaving(false)
  }

  async function handleAiTest(e) {
    e.preventDefault()
    setAiTesting(true)
    setAiTestMsg(null)
    try {
      const res = await apiFetch('/api/settings/ai/test', { method: 'POST' })
      const d = await res.json()
      setAiTestMsg({ ok: res.ok, text: d.message || d.error || 'Unknown result.' })
    } catch {
      setAiTestMsg({ ok: false, text: 'Request failed — is the server running?' })
    }
    setAiTesting(false)
  }

  useEffect(() => {
    apiFetch('/api/settings/sla')
      .then(r => r.json())
      .then(d => { setSla(d); setSlaLoading(false) })
      .catch(() => setSlaLoading(false))
  }, [])

  async function handleSlaSave(e) {
    e.preventDefault()
    setSlaSaving(true)
    setSlaMsg(null)
    try {
      const res = await apiFetch('/api/settings/sla', {
        method: 'PUT',
        body: JSON.stringify(sla),
      })
      const d = await res.json()
      if (res.ok) {
        setSlaMsg({ ok: true, text: 'SLA settings saved.' })
      } else {
        setSlaMsg({ ok: false, text: d.error || 'Failed to save.' })
      }
    } catch {
      setSlaMsg({ ok: false, text: 'Something went wrong.' })
    }
    setSlaSaving(false)
  }

  useEffect(() => {
    apiFetch('/api/settings/smtp')
      .then(r => r.json())
      .then(d => {
        setForm({
          smtp_host:       d.smtp_host       || '',
          smtp_port:       d.smtp_port       || '587',
          smtp_secure:     d.smtp_secure     || 'false',
          smtp_user:       d.smtp_user       || '',
          smtp_pass:       '',
          smtp_from_name:  d.smtp_from_name  || '',
          smtp_from_email: d.smtp_from_email || '',
        })
        setPassSet(d.smtp_pass_set || false)
        setLoading(false)
      })
      .catch(() => setLoading(false))

    apiFetch('/api/settings/inbound')
      .then(r => r.json())
      .then(d => {
        setInbound({
          imap_host:          d.imap_host          || '',
          imap_port:          d.imap_port          || '993',
          imap_tls:           d.imap_tls           || 'true',
          imap_folder:        d.imap_folder        || 'INBOX',
          imap_poll_interval: d.imap_poll_interval || '60',
          imap_user:          d.imap_user          || '',
          imap_pass:          '',
        })
        setImapPassSet(d.imap_pass_set || false)
        setInboundLoading(false)
      })
      .catch(() => setInboundLoading(false))
  }, [])

  async function handleSave(e) {
    e.preventDefault()
    setSaving(true)
    setSaveMsg(null)
    try {
      // If the password field is empty and one is already saved, send the
      // sentinel so the server knows to keep the existing password.
      const body = {
        ...form,
        smtp_pass: form.smtp_pass || (passSet ? PASS_SENTINEL : ''),
      }
      const res = await apiFetch('/api/settings/smtp', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const d = await res.json()
      if (res.ok) {
        setPassSet(d.smtp_pass_set)
        setForm(f => ({ ...f, smtp_pass: '' }))
        setSaveMsg({ ok: true, text: 'Settings saved.' })
      } else {
        setSaveMsg({ ok: false, text: d.error || 'Failed to save settings.' })
      }
    } catch {
      setSaveMsg({ ok: false, text: 'Something went wrong.' })
    }
    setSaving(false)
  }

  async function handleTest(e) {
    e.preventDefault()
    if (!testTo.trim()) return
    setTesting(true)
    setTestMsg(null)
    try {
      const res = await apiFetch('/api/settings/smtp/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: testTo.trim() }),
      })
      const d = await res.json()
      setTestMsg({ ok: res.ok, text: d.message || d.error || 'Unknown result.' })
    } catch {
      setTestMsg({ ok: false, text: 'Request failed — is the server running?' })
    }
    setTesting(false)
  }

  async function handleInboundSave(e) {
    e.preventDefault()
    setInboundSaving(true)
    setInboundMsg(null)
    try {
      const body = {
        ...inbound,
        imap_pass: inbound.imap_pass || (imapPassSet ? PASS_SENTINEL : ''),
      }
      const res = await apiFetch('/api/settings/inbound', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const d = await res.json()
      if (res.ok) {
        setImapPassSet(d.imap_pass_set)
        setInbound(prev => ({ ...prev, ...d, imap_pass: '' }))
        setInboundMsg({ ok: true, text: 'Inbound settings saved.' })
      } else {
        setInboundMsg({ ok: false, text: d.error || 'Failed to save.' })
      }
    } catch {
      setInboundMsg({ ok: false, text: 'Something went wrong.' })
    }
    setInboundSaving(false)
  }

  async function handlePollNow(e) {
    e.preventDefault()
    setPolling(true)
    setPollMsg(null)
    try {
      const res = await apiFetch('/api/settings/inbound/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      const d = await res.json()
      setPollMsg({ ok: res.ok, text: d.message || d.error || 'Unknown result.' })
    } catch {
      setPollMsg({ ok: false, text: 'Request failed — is the server running?' })
    }
    setPolling(false)
  }

  const isConfigured = !!(form.smtp_host)
  const isInboundConfigured = !!(inbound.imap_host && inbound.imap_user)
  const isAiConfigured = aiKeySet

  if (loading) return (
    <div className={styles.page}>
      <PageHeader title="Settings" />
      <div className={styles.state}>Loading…</div>
    </div>
  )

  return (
    <div className={styles.page}>
      <PageHeader title="Settings" />
      <div className={styles.content}>

        {/* ── Quick links ──────────────────────────────── */}
        <section className={styles.section}>
          <div className={styles.sectionHead}>
            <div>
              <h2 className={styles.sectionTitle}>Team</h2>
              <p className={styles.sectionDesc}>Manage the agents who use this system and configure reply templates.</p>
            </div>
          </div>
          <div className={styles.linkGrid}>
            <a href="/settings/agents" className={styles.linkCard}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
              <div>
                <div className={styles.linkTitle}>Agents</div>
                <div className={styles.linkDesc}>Add and manage support agents</div>
              </div>
            </a>
            <a href="/settings/canned-responses" className={styles.linkCard}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/></svg>
              <div>
                <div className={styles.linkTitle}>Canned Responses</div>
                <div className={styles.linkDesc}>Manage reply templates</div>
              </div>
            </a>
          </div>
        </section>

        {/* ── AI Assistant ─────────────────────────────── */}
        <section className={styles.section}>
          <div className={styles.sectionHead}>
            <div>
              <h2 className={styles.sectionTitle}>AI Assistant</h2>
              <p className={styles.sectionDesc}>
                Configure an AI provider to help agents draft ticket replies. Supports Grok (xAI) and Claude (Anthropic).
                API keys are encrypted before being stored.
              </p>
            </div>
            <span className={isAiConfigured ? styles.badgeOn : styles.badgeOff}>
              {isAiConfigured ? '● Configured' : '○ Not configured'}
            </span>
          </div>

          {aiLoading ? (
            <div className={styles.card}><p className={styles.msgWarn}>Loading…</p></div>
          ) : (
            <form className={styles.card} onSubmit={handleAiSave}>
              <div className={styles.grid2}>
                <div className={formStyles.field}>
                  <label className={formStyles.label}>Provider</label>
                  <select
                    className={formStyles.select}
                    value={ai.ai_provider}
                    onChange={e => setAi(a => ({ ...a, ai_provider: e.target.value }))}
                  >
                    <option value="grok">Grok (xAI)</option>
                    <option value="claude">Claude (Anthropic)</option>
                  </select>
                </div>
                <div className={formStyles.field}>
                  <label className={formStyles.label}>
                    Model <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(optional — leave blank for default)</span>
                  </label>
                  <input
                    className={formStyles.input}
                    placeholder={ai.ai_provider === 'claude' ? 'claude-haiku-4-5' : 'grok-3'}
                    value={ai.ai_model}
                    onChange={e => setAi(a => ({ ...a, ai_model: e.target.value }))}
                  />
                </div>
              </div>

              <div className={formStyles.field}>
                <label className={formStyles.label}>
                  API Key
                  {aiKeySet && <span className={styles.passHint}> — saved (leave blank to keep)</span>}
                </label>
                <input
                  className={formStyles.input}
                  type="password"
                  placeholder={aiKeySet ? '••••••••••••••••' : ai.ai_provider === 'claude' ? 'sk-ant-...' : 'xai-...'}
                  value={ai.ai_api_key}
                  onChange={e => setAi(a => ({ ...a, ai_api_key: e.target.value }))}
                  autoComplete="new-password"
                />
              </div>

              <div className={styles.formFooter}>
                {aiMsg && (
                  <span className={aiMsg.ok ? styles.msgOk : styles.msgErr}>
                    {aiMsg.ok ? '✓ ' : '✕ '}{aiMsg.text}
                  </span>
                )}
                <button type="submit" className={formStyles.btnPrimary} disabled={aiSaving}>
                  {aiSaving ? 'Saving…' : 'Save AI Settings'}
                </button>
              </div>
            </form>
          )}
        </section>

        {/* ── Test AI ──────────────────────────────────── */}
        <section className={styles.section}>
          <div className={styles.sectionHead}>
            <div>
              <h2 className={styles.sectionTitle}>Test AI Connection</h2>
              <p className={styles.sectionDesc}>
                Verify your API key works by sending a quick test request to the provider.
              </p>
            </div>
          </div>
          <div className={styles.card}>
            <div className={styles.testRow}>
              <button
                type="button"
                className={formStyles.btnPrimary}
                onClick={handleAiTest}
                disabled={aiTesting || !isAiConfigured}
              >
                {aiTesting ? 'Testing…' : 'Test Connection'}
              </button>
            </div>
            {!isAiConfigured && (
              <p className={styles.msgWarn}>Save your API key above before testing.</p>
            )}
            {aiTestMsg && (
              <p className={aiTestMsg.ok ? styles.msgOk : styles.msgErr}>
                {aiTestMsg.ok ? '✓ ' : '✕ '}{aiTestMsg.text}
              </p>
            )}
          </div>
        </section>

        {/* ── SLA Configuration ───────────────────────── */}
        <section className={styles.section}>
          <div className={styles.sectionHead}>
            <div>
              <h2 className={styles.sectionTitle}>SLA Targets</h2>
              <p className={styles.sectionDesc}>
                Set how many hours agents have to resolve a ticket based on its priority.
                The SLA clock starts when the ticket is created.
              </p>
            </div>
          </div>
          {slaLoading ? (
            <div className={styles.card}><p className={styles.msgWarn}>Loading…</p></div>
          ) : (
            <form className={styles.card} onSubmit={handleSlaSave}>
              <div className={styles.grid3}>
                <div className={formStyles.field}>
                  <label className={formStyles.label}>
                    🔴 High Priority <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(hours)</span>
                  </label>
                  <input
                    className={formStyles.input}
                    type="number" min="1"
                    value={sla.sla_hours_high}
                    onChange={e => setSla(s => ({ ...s, sla_hours_high: e.target.value }))}
                  />
                </div>
                <div className={formStyles.field}>
                  <label className={formStyles.label}>
                    🟡 Medium Priority <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(hours)</span>
                  </label>
                  <input
                    className={formStyles.input}
                    type="number" min="1"
                    value={sla.sla_hours_medium}
                    onChange={e => setSla(s => ({ ...s, sla_hours_medium: e.target.value }))}
                  />
                </div>
                <div className={formStyles.field}>
                  <label className={formStyles.label}>
                    🟢 Low Priority <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(hours)</span>
                  </label>
                  <input
                    className={formStyles.input}
                    type="number" min="1"
                    value={sla.sla_hours_low}
                    onChange={e => setSla(s => ({ ...s, sla_hours_low: e.target.value }))}
                  />
                </div>
              </div>
              <div className={styles.formFooter}>
                {slaMsg && (
                  <span className={slaMsg.ok ? styles.msgOk : styles.msgErr}>
                    {slaMsg.ok ? '✓ ' : '✕ '}{slaMsg.text}
                  </span>
                )}
                <button type="submit" className={formStyles.btnPrimary} disabled={slaSaving}>
                  {slaSaving ? 'Saving…' : 'Save SLA Settings'}
                </button>
              </div>
            </form>
          )}
        </section>

        {/* ── Email / SMTP ─────────────────────────────── */}
        <section className={styles.section}>
          <div className={styles.sectionHead}>
            <div>
              <h2 className={styles.sectionTitle}>Email / SMTP</h2>
              <p className={styles.sectionDesc}>
                Configure outbound email so contacts receive notifications when tickets are
                opened, replied to, or resolved.
              </p>
            </div>
            <span className={isConfigured ? styles.badgeOn : styles.badgeOff}>
              {isConfigured ? '● Configured' : '○ Not configured'}
            </span>
          </div>

          <form className={styles.card} onSubmit={handleSave}>
            <div className={styles.grid2}>
              <div className={formStyles.field}>
                <label className={formStyles.label}>SMTP Host</label>
                <input
                  className={formStyles.input}
                  placeholder="smtp.example.com"
                  value={form.smtp_host}
                  onChange={e => setForm(f => ({ ...f, smtp_host: e.target.value }))}
                />
              </div>
              <div className={formStyles.field}>
                <label className={formStyles.label}>Port</label>
                <input
                  className={formStyles.input}
                  placeholder="587"
                  value={form.smtp_port}
                  onChange={e => setForm(f => ({ ...f, smtp_port: e.target.value }))}
                />
              </div>
            </div>

            <div className={styles.grid2}>
              <div className={formStyles.field}>
                <label className={formStyles.label}>Username</label>
                <input
                  className={formStyles.input}
                  placeholder="notifications@example.com"
                  value={form.smtp_user}
                  onChange={e => setForm(f => ({ ...f, smtp_user: e.target.value }))}
                  autoComplete="off"
                />
              </div>
              <div className={formStyles.field}>
                <label className={formStyles.label}>
                  Password
                  {passSet && <span className={styles.passHint}> — saved (leave blank to keep)</span>}
                </label>
                <input
                  className={formStyles.input}
                  type="password"
                  placeholder={passSet ? '••••••••' : 'Enter password'}
                  value={form.smtp_pass}
                  onChange={e => setForm(f => ({ ...f, smtp_pass: e.target.value }))}
                  autoComplete="new-password"
                />
              </div>
            </div>

            <div className={styles.grid2}>
              <div className={formStyles.field}>
                <label className={formStyles.label}>From Name</label>
                <input
                  className={formStyles.input}
                  placeholder="ITSM Support"
                  value={form.smtp_from_name}
                  onChange={e => setForm(f => ({ ...f, smtp_from_name: e.target.value }))}
                />
              </div>
              <div className={formStyles.field}>
                <label className={formStyles.label}>From Email</label>
                <input
                  className={formStyles.input}
                  type="email"
                  placeholder="support@example.com"
                  value={form.smtp_from_email}
                  onChange={e => setForm(f => ({ ...f, smtp_from_email: e.target.value }))}
                />
              </div>
            </div>

            <div className={styles.grid2}>
              <div className={formStyles.field}>
                <label className={formStyles.label}>Encryption</label>
                <select
                  className={formStyles.select}
                  value={form.smtp_secure}
                  onChange={e => setForm(f => ({ ...f, smtp_secure: e.target.value }))}
                >
                  <option value="false">STARTTLS (port 587 — recommended)</option>
                  <option value="true">SSL/TLS (port 465)</option>
                </select>
              </div>
            </div>

            <div className={styles.formFooter}>
              {saveMsg && (
                <span className={saveMsg.ok ? styles.msgOk : styles.msgErr}>
                  {saveMsg.ok ? '✓ ' : '✕ '}{saveMsg.text}
                </span>
              )}
              <button type="submit" className={formStyles.btnPrimary} disabled={saving}>
                {saving ? 'Saving…' : 'Save Settings'}
              </button>
            </div>
          </form>
        </section>

        {/* ── Test email ───────────────────────────────── */}
        <section className={styles.section}>
          <div className={styles.sectionHead}>
            <div>
              <h2 className={styles.sectionTitle}>Send Test Email</h2>
              <p className={styles.sectionDesc}>
                Verify your SMTP settings by sending a test email. Save your settings above first.
              </p>
            </div>
          </div>

          <form className={styles.card} onSubmit={handleTest}>
            <div className={styles.testRow}>
              <div className={formStyles.field} style={{ flex: 1 }}>
                <label className={formStyles.label}>Send to</label>
                <input
                  className={formStyles.input}
                  type="email"
                  placeholder="you@example.com"
                  value={testTo}
                  onChange={e => setTestTo(e.target.value)}
                />
              </div>
              <button
                type="submit"
                className={formStyles.btnPrimary}
                style={{ alignSelf: 'flex-end' }}
                disabled={testing || !testTo.trim() || !isConfigured}
              >
                {testing ? 'Sending…' : 'Send Test Email'}
              </button>
            </div>
            {!isConfigured && (
              <p className={styles.msgWarn}>Configure and save your SMTP settings above before sending a test.</p>
            )}
            {testMsg && (
              <p className={testMsg.ok ? styles.msgOk : styles.msgErr}>
                {testMsg.ok ? '✓ ' : '✕ '}{testMsg.text}
              </p>
            )}
          </form>
        </section>

        {/* ── Inbound Email (IMAP) ─────────────────────── */}
        <section className={styles.section}>
          <div className={styles.sectionHead}>
            <div>
              <h2 className={styles.sectionTitle}>Inbound Email</h2>
              <p className={styles.sectionDesc}>
                Poll a mailbox for incoming emails and automatically create tickets.
                Uses the same SMTP username and password configured above for authentication.
              </p>
            </div>
            <span className={isInboundConfigured ? styles.badgeOn : styles.badgeOff}>
              {isInboundConfigured ? '● Configured' : '○ Not configured'}
            </span>
          </div>

          {inboundLoading ? (
            <div className={styles.card}><p className={styles.msgWarn}>Loading…</p></div>
          ) : (
            <form className={styles.card} onSubmit={handleInboundSave}>
              <div className={styles.grid2}>
                <div className={formStyles.field}>
                  <label className={formStyles.label}>IMAP Host</label>
                  <input
                    className={formStyles.input}
                    placeholder="imap.example.com"
                    value={inbound.imap_host}
                    onChange={e => setInbound(f => ({ ...f, imap_host: e.target.value }))}
                  />
                </div>
                <div className={formStyles.field}>
                  <label className={formStyles.label}>Port</label>
                  <input
                    className={formStyles.input}
                    placeholder="993"
                    value={inbound.imap_port}
                    onChange={e => setInbound(f => ({ ...f, imap_port: e.target.value }))}
                  />
                </div>
              </div>

              <div className={styles.grid2}>
                <div className={formStyles.field}>
                  <label className={formStyles.label}>Encryption</label>
                  <select
                    className={formStyles.select}
                    value={inbound.imap_tls}
                    onChange={e => setInbound(f => ({ ...f, imap_tls: e.target.value }))}
                  >
                    <option value="true">SSL/TLS (port 993 — recommended)</option>
                    <option value="false">None / STARTTLS (port 143)</option>
                  </select>
                </div>
                <div className={formStyles.field}>
                  <label className={formStyles.label}>Folder</label>
                  <input
                    className={formStyles.input}
                    placeholder="INBOX"
                    value={inbound.imap_folder}
                    onChange={e => setInbound(f => ({ ...f, imap_folder: e.target.value }))}
                  />
                </div>
              </div>

              <div className={styles.grid2}>
                <div className={formStyles.field}>
                  <label className={formStyles.label}>Username</label>
                  <input
                    className={formStyles.input}
                    placeholder="support@example.com"
                    value={inbound.imap_user}
                    onChange={e => setInbound(f => ({ ...f, imap_user: e.target.value }))}
                    autoComplete="off"
                  />
                </div>
                <div className={formStyles.field}>
                  <label className={formStyles.label}>
                    Password
                    {imapPassSet && <span className={styles.passHint}> — saved (leave blank to keep)</span>}
                  </label>
                  <input
                    className={formStyles.input}
                    type="password"
                    placeholder={imapPassSet ? '••••••••' : 'Enter password'}
                    value={inbound.imap_pass}
                    onChange={e => setInbound(f => ({ ...f, imap_pass: e.target.value }))}
                    autoComplete="new-password"
                  />
                </div>
              </div>

              <div className={styles.grid2}>
                <div className={formStyles.field}>
                  <label className={formStyles.label}>Poll Interval (seconds)</label>
                  <input
                    className={formStyles.input}
                    type="number"
                    min="10"
                    placeholder="60"
                    value={inbound.imap_poll_interval}
                    onChange={e => setInbound(f => ({ ...f, imap_poll_interval: e.target.value }))}
                  />
                </div>
              </div>

              <div className={styles.formFooter}>
                {inboundMsg && (
                  <span className={inboundMsg.ok ? styles.msgOk : styles.msgErr}>
                    {inboundMsg.ok ? '✓ ' : '✕ '}{inboundMsg.text}
                  </span>
                )}
                <button type="submit" className={formStyles.btnPrimary} disabled={inboundSaving}>
                  {inboundSaving ? 'Saving…' : 'Save Settings'}
                </button>
              </div>
            </form>
          )}
        </section>

        {/* ── Test inbound poll ─────────────────────────── */}
        <section className={styles.section}>
          <div className={styles.sectionHead}>
            <div>
              <h2 className={styles.sectionTitle}>Test Inbound / Poll Now</h2>
              <p className={styles.sectionDesc}>
                Trigger an immediate poll of the mailbox. Any unread emails will be processed
                and turned into tickets right away. Save your settings above first.
              </p>
            </div>
          </div>

          <div className={styles.card}>
            <div className={styles.testRow}>
              <button
                type="button"
                className={formStyles.btnPrimary}
                onClick={handlePollNow}
                disabled={polling || !isInboundConfigured}
              >
                {polling ? 'Polling…' : 'Poll Now'}
              </button>
            </div>
            {!isInboundConfigured && (
              <p className={styles.msgWarn}>Configure and save your inbound settings above before polling.</p>
            )}
            {pollMsg && (
              <p className={pollMsg.ok ? styles.msgOk : styles.msgErr}>
                {pollMsg.ok ? '✓ ' : '✕ '}{pollMsg.text}
              </p>
            )}
          </div>
        </section>

        {/* ── Encryption note ──────────────────────────── */}
        <section className={styles.section}>
          <div className={styles.infoBox}>
            <strong>Security note:</strong> Your SMTP password is encrypted before being stored in the
            database using AES-256-GCM. For maximum security, set an{' '}
            <code>ENCRYPTION_KEY</code> environment variable (a 64-character hex string).
            Without it the password is stored with basic obfuscation only.{' '}
            <span className={styles.codeHint}>
              Generate a key: <code>node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"</code>
            </span>
          </div>
        </section>

      </div>
    </div>
  )
}
