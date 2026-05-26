import { useEffect, useState } from 'react'
import PageHeader from '../components/PageHeader'
import { apiFetch } from '../utils/api'
import styles from './PortalBranding.module.css'

const DEFAULTS = {
  brand_name: 'Help Centre',
  logo_url: '',
  primary_color: '#4F46E5',
  nav_bg: '#FFFFFF',
  nav_text: '#111827',
  nav_active_bg: '#EEF2FF',
  nav_active_text: '#4F46E5',
  page_bg: '#F8F9FB',
  button_bg: '#4F46E5',
  button_text: '#FFFFFF',
  login_title: 'Welcome to the Help Centre',
  login_subtitle: 'Sign in with your work email address',
  footer_text: '',
}

function ColorRow({ label, fieldKey, value, onChange }) {
  return (
    <div className={styles.colorRow}>
      <label className={styles.colorLabel}>{label}</label>
      <div className={styles.colorInputs}>
        <input
          type="color"
          className={styles.colorSwatch}
          value={value}
          onChange={e => onChange(fieldKey, e.target.value)}
        />
        <input
          type="text"
          className={styles.colorHex}
          value={value}
          onChange={e => onChange(fieldKey, e.target.value)}
          maxLength={7}
          spellCheck={false}
        />
      </div>
    </div>
  )
}

export default function PortalBranding() {
  const [form, setForm] = useState(DEFAULTS)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState(null)
  const [contacts, setContacts] = useState([])
  const [previewModalOpen, setPreviewModalOpen] = useState(false)
  const [selectedContactId, setSelectedContactId] = useState('')
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewError, setPreviewError] = useState('')

  useEffect(() => {
    fetch('/api/branding')
      .then(r => r.json())
      .then(data => {
        setForm({
          brand_name:     data.brand_name     || DEFAULTS.brand_name,
          logo_url:       data.logo_url       || '',
          primary_color:  data.primary_color  || DEFAULTS.primary_color,
          nav_bg:         data.nav_bg         || DEFAULTS.nav_bg,
          nav_text:       data.nav_text       || DEFAULTS.nav_text,
          nav_active_bg:  data.nav_active_bg  || DEFAULTS.nav_active_bg,
          nav_active_text: data.nav_active_text || DEFAULTS.nav_active_text,
          page_bg:        data.page_bg        || DEFAULTS.page_bg,
          button_bg:      data.button_bg      || DEFAULTS.button_bg,
          button_text:    data.button_text    || DEFAULTS.button_text,
          login_title:    data.login_title    || DEFAULTS.login_title,
          login_subtitle: data.login_subtitle || DEFAULTS.login_subtitle,
          footer_text:    data.footer_text    || '',
        })
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  function handleChange(key, val) {
    setForm(prev => ({ ...prev, [key]: val }))
  }

  function handleInput(e) {
    handleChange(e.target.name, e.target.value)
  }

  async function handleSave(e) {
    e.preventDefault()
    setSaving(true)
    setSaveMsg(null)
    try {
      const res = await apiFetch('/api/branding', {
        method: 'PUT',
        body: JSON.stringify({
          ...form,
          logo_url: form.logo_url || null,
          footer_text: form.footer_text || null,
        }),
      })
      if (res.ok) {
        setSaveMsg({ ok: true, text: 'Branding saved.' })
      } else {
        const d = await res.json()
        setSaveMsg({ ok: false, text: d.error || 'Failed to save.' })
      }
    } catch {
      setSaveMsg({ ok: false, text: 'Something went wrong.' })
    }
    setSaving(false)
  }

  async function openPreviewModal() {
    setPreviewError('')
    setSelectedContactId('')
    setPreviewModalOpen(true)
    try {
      const res = await apiFetch('/api/contacts')
      const data = await res.json()
      setContacts(Array.isArray(data) ? data : (data.contacts || []))
    } catch {
      setPreviewError('Failed to load contacts.')
    }
  }

  async function handleOpenPreview() {
    if (!selectedContactId) return
    setPreviewLoading(true)
    setPreviewError('')
    try {
      const res = await apiFetch('/api/portal/preview-token', {
        method: 'POST',
        body: JSON.stringify({ contact_id: parseInt(selectedContactId, 10) }),
      })
      const data = await res.json()
      if (!res.ok) {
        setPreviewError(data.error || 'Failed to generate preview token.')
        setPreviewLoading(false)
        return
      }
      window.open(`/portal?portal_token=${data.token}`, '_blank')
      setPreviewModalOpen(false)
    } catch {
      setPreviewError('Something went wrong.')
    }
    setPreviewLoading(false)
  }

  if (loading) return <div className={styles.page}><div className={styles.state}>Loading…</div></div>

  return (
    <div className={styles.page}>
      <PageHeader
        title="Portal Branding"
        action={
          <div style={{ display: 'flex', gap: 10 }}>
            <button className={styles.btnSecondary} type="button" onClick={openPreviewModal}>
              👁 Preview Portal
            </button>
            <button className={styles.btnPrimary} type="button" onClick={handleSave} disabled={saving}>
              {saving ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        }
      />

      <div className={styles.layout}>
        {/* ── Settings panel ── */}
        <form className={styles.settingsPanel} onSubmit={handleSave}>

          {/* Brand Identity */}
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Brand Identity</h2>
            <div className={styles.field}>
              <label className={styles.label}>Brand Name</label>
              <input
                className={styles.input}
                type="text"
                name="brand_name"
                value={form.brand_name}
                onChange={handleInput}
                placeholder="Help Centre"
              />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Logo URL</label>
              <input
                className={styles.input}
                type="url"
                name="logo_url"
                value={form.logo_url}
                onChange={handleInput}
                placeholder="https://example.com/logo.png"
              />
              {form.logo_url && (
                <img
                  src={form.logo_url}
                  alt="Logo preview"
                  className={styles.logoPreview}
                  onError={e => { e.target.style.display = 'none' }}
                  onLoad={e => { e.target.style.display = 'block' }}
                />
              )}
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Login Page Title</label>
              <input
                className={styles.input}
                type="text"
                name="login_title"
                value={form.login_title}
                onChange={handleInput}
              />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Login Page Subtitle</label>
              <input
                className={styles.input}
                type="text"
                name="login_subtitle"
                value={form.login_subtitle}
                onChange={handleInput}
              />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Footer Text <span className={styles.optional}>(optional)</span></label>
              <input
                className={styles.input}
                type="text"
                name="footer_text"
                value={form.footer_text}
                onChange={handleInput}
                placeholder="© 2025 Acme Corp. All rights reserved."
              />
            </div>
          </section>

          {/* Colours */}
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Colours</h2>
            <ColorRow label="Accent Colour" fieldKey="primary_color" value={form.primary_color} onChange={handleChange} />
            <ColorRow label="Navigation Background" fieldKey="nav_bg" value={form.nav_bg} onChange={handleChange} />
            <ColorRow label="Navigation Text" fieldKey="nav_text" value={form.nav_text} onChange={handleChange} />
            <ColorRow label="Active Nav Background" fieldKey="nav_active_bg" value={form.nav_active_bg} onChange={handleChange} />
            <ColorRow label="Active Nav Text" fieldKey="nav_active_text" value={form.nav_active_text} onChange={handleChange} />
            <ColorRow label="Page Background" fieldKey="page_bg" value={form.page_bg} onChange={handleChange} />
            <ColorRow label="Button Colour" fieldKey="button_bg" value={form.button_bg} onChange={handleChange} />
            <ColorRow label="Button Text Colour" fieldKey="button_text" value={form.button_text} onChange={handleChange} />
          </section>

          {saveMsg && (
            <div className={saveMsg.ok ? styles.successMsg : styles.errorMsg}>
              {saveMsg.text}
            </div>
          )}
        </form>

        {/* ── Live preview panel ── */}
        <div className={styles.previewPanel}>
          <div className={styles.previewLabel}>Live Preview</div>

          {/* Portal preview */}
          <div className={styles.previewPortal} style={{ background: form.page_bg }}>
            {/* Nav */}
            <div className={styles.previewNav} style={{ background: form.nav_bg, color: form.nav_text }}>
              <div className={styles.previewBrand} style={{ color: form.nav_text }}>
                {form.logo_url
                  ? <img src={form.logo_url} alt="" style={{ height: 18, objectFit: 'contain' }} onError={() => {}} />
                  : '🎫'
                }
                <span>{form.brand_name}</span>
              </div>
              <div className={styles.previewNavLinks}>
                <span className={styles.previewNavLinkActive} style={{ background: form.nav_active_bg, color: form.nav_active_text }}>Dashboard</span>
                <span className={styles.previewNavLink} style={{ color: form.nav_text }}>My Tickets</span>
                <span className={styles.previewNavLink} style={{ color: form.nav_text }}>KB</span>
                <span className={styles.previewNavLink} style={{ color: form.nav_text }}>SC</span>
              </div>
            </div>
            {/* Body */}
            <div className={styles.previewBody}>
              <div className={styles.previewGreeting} style={{ color: form.nav_text }}>Hello, Contact 👋</div>
              <div className={styles.previewStats}>
                <div className={styles.previewStatCard}>
                  <div className={styles.previewStatValue} style={{ color: form.primary_color }}>3</div>
                  <div className={styles.previewStatLabel}>Open</div>
                </div>
                <div className={styles.previewStatCard}>
                  <div className={styles.previewStatValue} style={{ color: form.primary_color }}>12</div>
                  <div className={styles.previewStatLabel}>Done</div>
                </div>
              </div>
              <button
                className={styles.previewBtn}
                style={{ background: form.button_bg, color: form.button_text }}
              >
                Submit a Request
              </button>
            </div>
          </div>

          {/* Login preview */}
          <div className={styles.previewLabel} style={{ marginTop: 16 }}>Login Page Preview</div>
          <div className={styles.previewLoginWrap} style={{ background: form.page_bg }}>
            <div className={styles.previewLoginCard}>
              <div className={styles.previewLoginLogo}>
                {form.logo_url
                  ? <img src={form.logo_url} alt="" style={{ height: 32, objectFit: 'contain' }} onError={() => {}} />
                  : '🎫'
                }
              </div>
              <div className={styles.previewLoginTitle}>{form.login_title || 'Login Title'}</div>
              <div className={styles.previewLoginSubtitle}>{form.login_subtitle || 'Subtitle'}</div>
              <div className={styles.previewLoginInput}>you@company.com</div>
              <button className={styles.previewLoginBtn} style={{ background: form.button_bg, color: form.button_text }}>
                Sign In
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Preview Modal */}
      {previewModalOpen && (
        <div className={styles.modalOverlay} onClick={() => setPreviewModalOpen(false)}>
          <div className={styles.modal} onClick={e => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h3 className={styles.modalTitle}>Preview Portal as…</h3>
              <button className={styles.modalClose} onClick={() => setPreviewModalOpen(false)}>✕</button>
            </div>
            <div className={styles.modalBody}>
              <div className={styles.field}>
                <label className={styles.label}>Select a contact</label>
                <select
                  className={styles.select}
                  value={selectedContactId}
                  onChange={e => setSelectedContactId(e.target.value)}
                >
                  <option value="">— Choose contact —</option>
                  {contacts.map(c => (
                    <option key={c.id} value={c.id}>
                      {c.first_name} {c.last_name} ({c.email})
                    </option>
                  ))}
                </select>
              </div>
              {previewError && <div className={styles.errorMsg}>{previewError}</div>}
            </div>
            <div className={styles.modalFooter}>
              <button className={styles.btnSecondary} onClick={() => setPreviewModalOpen(false)}>
                Cancel
              </button>
              <button
                className={styles.btnPrimary}
                onClick={handleOpenPreview}
                disabled={!selectedContactId || previewLoading}
              >
                {previewLoading ? 'Opening…' : 'Open Preview'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
