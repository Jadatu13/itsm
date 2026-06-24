import { useState, useEffect } from 'react'
import { apiFetch } from '../utils/api'
import formStyles from '../styles/forms.module.css'
import styles from './ContactForm.module.css'

/**
 * Reusable contact creation form.
 * Props:
 *  - organisations: array  (pass in; parent owns the list)
 *  - onOrgsUpdated: fn(orgs) — called after an inline org is created
 *  - onCreated: fn(contact) — called after the contact is saved
 *  - onBack: fn | null — if provided, shows a "Back" button
 *  - note: string | null — optional note shown at the top
 */
export default function ContactForm({ organisations, onOrgsUpdated, onCreated, onBack, note }) {
  const [form, setForm] = useState({ first_name: '', last_name: '', email: '', organisation_id: '' })
  const [errors, setErrors] = useState({})
  const [submitting, setSubmitting] = useState(false)
  const [orgSuggestion, setOrgSuggestion] = useState(null)
  const [showNewOrg, setShowNewOrg] = useState(false)
  const [newOrgName, setNewOrgName] = useState('')

  // Domain auto-suggest (debounced + race-safe)
  useEffect(() => {
    const domain = form.email.split('@')[1]
    if (!domain || !domain.includes('.')) { setOrgSuggestion(null); return }
    let ignore = false
    const t = setTimeout(() => {
      apiFetch(`/api/organisations/by-domain?domain=${encodeURIComponent(domain)}`)
        .then(r => r.json())
        .then(match => {
          if (ignore) return
          setOrgSuggestion(match && String(match.id) !== String(form.organisation_id) ? match : null)
        })
        .catch(() => { if (!ignore) setOrgSuggestion(null) })
    }, 300)
    return () => { ignore = true; clearTimeout(t) }
  }, [form.email, form.organisation_id])

  function validate() {
    const e = {}
    if (!form.first_name.trim()) e.first_name = 'Required'
    if (!form.last_name.trim()) e.last_name = 'Required'
    if (!form.email.trim()) e.email = 'Required'
    setErrors(e)
    return !Object.keys(e).length
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!validate()) return
    setSubmitting(true)
    try {
      const res = await apiFetch('/api/contacts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, organisation_id: form.organisation_id || null }),
      })
      if (!res.ok) {
        const d = await res.json()
        setErrors({ email: d.error })
        setSubmitting(false)
        return
      }
      onCreated(await res.json())
    } catch {
      setErrors({ email: 'Something went wrong. Please try again.' })
      setSubmitting(false)
    }
  }

  async function handleCreateOrg(e) {
    e.preventDefault()
    if (!newOrgName.trim()) return
    try {
      const res = await apiFetch('/api/organisations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newOrgName }),
      })
      if (!res.ok) return
      const org = await res.json()
      const updated = await apiFetch('/api/organisations').then(r => r.json())
      onOrgsUpdated(updated)
      setForm(f => ({ ...f, organisation_id: String(org.id) }))
      setNewOrgName('')
      setShowNewOrg(false)
    } catch {
      // silently ignore — org list already loaded
    }
  }

  return (
    <form className={formStyles.form} onSubmit={handleSubmit}>
      {note && <p className={styles.note}>{note}</p>}

      <div className={formStyles.field}>
        <label className={formStyles.label}>First Name <span className={formStyles.required}>*</span></label>
        <input
          className={formStyles.input}
          value={form.first_name}
          onChange={e => setForm(f => ({ ...f, first_name: e.target.value }))}
        />
        {errors.first_name && <span className={formStyles.error}>{errors.first_name}</span>}
      </div>

      <div className={formStyles.field}>
        <label className={formStyles.label}>Last Name <span className={formStyles.required}>*</span></label>
        <input
          className={formStyles.input}
          value={form.last_name}
          onChange={e => setForm(f => ({ ...f, last_name: e.target.value }))}
        />
        {errors.last_name && <span className={formStyles.error}>{errors.last_name}</span>}
      </div>

      <div className={formStyles.field}>
        <label className={formStyles.label}>Email <span className={formStyles.required}>*</span></label>
        <input
          className={formStyles.input}
          type="email"
          value={form.email}
          onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
        />
        {errors.email && <span className={formStyles.error}>{errors.email}</span>}
        {orgSuggestion && (
          <div className={formStyles.suggestion}>
            <span>Domain matches <strong>{orgSuggestion.name}</strong></span>
            <button
              type="button"
              className={formStyles.suggestionBtn}
              onClick={() => {
                setForm(f => ({ ...f, organisation_id: String(orgSuggestion.id) }))
                setOrgSuggestion(null)
              }}
            >
              Set organisation
            </button>
          </div>
        )}
      </div>

      <div className={formStyles.field}>
        <div className={formStyles.labelRow}>
          <label className={formStyles.label}>Organisation</label>
          <button type="button" className={formStyles.addLink} onClick={() => setShowNewOrg(v => !v)}>
            {showNewOrg ? '− Cancel' : '+ New org'}
          </button>
        </div>
        {showNewOrg ? (
          <div className={formStyles.inlineOrgRow}>
            <input
              className={formStyles.input}
              placeholder="Organisation name"
              value={newOrgName}
              onChange={e => setNewOrgName(e.target.value)}
            />
            <button
              type="button"
              className={formStyles.btnPrimary}
              style={{ whiteSpace: 'nowrap', padding: '8px 14px' }}
              onClick={handleCreateOrg}
            >
              Create
            </button>
          </div>
        ) : (
          <select
            className={formStyles.select}
            value={form.organisation_id}
            onChange={e => setForm(f => ({ ...f, organisation_id: e.target.value }))}
          >
            <option value="">None</option>
            {organisations.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        )}
      </div>

      <div className={formStyles.actions}>
        {onBack && (
          <button type="button" className={formStyles.btnSecondary} onClick={onBack}>
            Back
          </button>
        )}
        <button type="submit" className={formStyles.btnPrimary} disabled={submitting}>
          {submitting ? 'Creating…' : 'Create Contact'}
        </button>
      </div>
    </form>
  )
}
