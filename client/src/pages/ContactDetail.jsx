import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import PageHeader from '../components/PageHeader'
import { StatusBadge, PriorityBadge } from '../components/Badge'
import Modal from '../components/Modal'
import { formatDate } from '../utils/format'
import { apiFetch } from '../utils/api'
import formStyles from '../styles/forms.module.css'
import styles from './ContactDetail.module.css'

export default function ContactDetail() {
  const { id } = useParams()
  const [contact, setContact] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [showEdit, setShowEdit] = useState(false)
  const navigate = useNavigate()

  function load() {
    fetch(`/api/contacts/${id}`)
      .then(r => r.json())
      .then(data => {
        if (data.error) throw new Error(data.error)
        setContact(data)
        setLoading(false)
      })
      .catch(err => { setError(err.message); setLoading(false) })
  }

  useEffect(() => { load() }, [id])

  if (loading) return <div className={styles.page}><PageHeader title="Contact" /><div className={styles.state}>Loading…</div></div>
  if (error) return <div className={styles.page}><PageHeader title="Contact" /><div className={`${styles.state} ${styles.err}`}>{error}</div></div>

  return (
    <div className={styles.page}>
      <PageHeader
        title={contact.full_name}
        action={
          <button className={styles.btnEdit} onClick={() => setShowEdit(true)}>
            Edit Contact
          </button>
        }
      />
      <div className={styles.content}>
        <div className={styles.card}>
          <div className={styles.avatar}>{contact.first_name[0]}{contact.last_name[0]}</div>
          <div className={styles.info}>
            <div className={styles.fullName}>{contact.full_name}</div>
            <div className={styles.email}>{contact.email}</div>
            {contact.organisation_name && (
              <div className={styles.org}>{contact.organisation_name}</div>
            )}
            <div className={styles.joined}>Member since {formatDate(contact.created_at)}</div>
          </div>
        </div>

        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>Tickets ({contact.tickets.length})</h2>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Reference</th>
                  <th>Subject</th>
                  <th>Status</th>
                  <th>Priority</th>
                  <th>Created</th>
                  <th>Updated</th>
                </tr>
              </thead>
              <tbody>
                {contact.tickets.length === 0 && (
                  <tr><td colSpan={6} className={styles.empty}>No tickets.</td></tr>
                )}
                {contact.tickets.map(t => (
                  <tr key={t.id} className={styles.row} onClick={() => navigate(`/tickets/${t.id}`)}>
                    <td className={styles.ref}>{t.reference}</td>
                    <td className={styles.subject}>{t.subject}</td>
                    <td><StatusBadge status={t.status} /></td>
                    <td><PriorityBadge priority={t.priority} /></td>
                    <td className={styles.muted}>{formatDate(t.created_at)}</td>
                    <td className={styles.muted}>{formatDate(t.updated_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {showEdit && (
        <EditContactModal
          contact={contact}
          onClose={() => setShowEdit(false)}
          onSaved={() => { setShowEdit(false); load() }}
        />
      )}
    </div>
  )
}

// ─── Edit Contact Modal ───────────────────────────────────────────────────────

function EditContactModal({ contact, onClose, onSaved }) {
  const [orgs, setOrgs] = useState([])
  const [form, setForm] = useState({
    first_name: contact.first_name,
    last_name: contact.last_name,
    email: contact.email,
    organisation_id: contact.organisation_id ? String(contact.organisation_id) : '',
  })
  const [errors, setErrors] = useState({})
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState(null)
  const [orgSuggestion, setOrgSuggestion] = useState(null)
  const [showNewOrg, setShowNewOrg] = useState(false)
  const [newOrgName, setNewOrgName] = useState('')
  const [newOrgDomain, setNewOrgDomain] = useState('')

  useEffect(() => {
    apiFetch('/api/organisations')
      .then(r => r.json())
      .then(d => { if (Array.isArray(d)) setOrgs(d) })
      .catch(() => {})
  }, [])

  // Domain auto-suggest when email changes
  useEffect(() => {
    const domain = form.email.split('@')[1]
    if (!domain || !domain.includes('.')) { setOrgSuggestion(null); return }
    fetch(`/api/organisations/by-domain?domain=${encodeURIComponent(domain)}`)
      .then(r => r.json())
      .then(match => {
        if (match && String(match.id) !== form.organisation_id) {
          setOrgSuggestion(match)
        } else {
          setOrgSuggestion(null)
        }
      })
      .catch(() => setOrgSuggestion(null))
  }, [form.email])

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
    setSubmitError(null)
    const res = await fetch(`/api/contacts/${contact.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...form, organisation_id: form.organisation_id || null }),
    })
    if (res.ok) {
      onSaved()
    } else {
      const d = await res.json()
      setSubmitError(d.error)
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

      if (newOrgDomain.trim()) {
        await fetch(`/api/organisations/${org.id}/domains`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ domain: newOrgDomain }),
        }).catch(() => {})
      }

      const updated = await apiFetch('/api/organisations').then(r => r.json())
      if (Array.isArray(updated)) setOrgs(updated)
      setForm(f => ({ ...f, organisation_id: String(org.id) }))
      setNewOrgName('')
      setNewOrgDomain('')
      setShowNewOrg(false)
    } catch { /* ignore */ }
  }

  return (
    <Modal title="Edit Contact" onClose={onClose}>
      <form className={formStyles.form} onSubmit={handleSubmit}>
        <div className={formStyles.field}>
          <label className={formStyles.label}>First Name <span className={formStyles.required}>*</span></label>
          <input className={formStyles.input} value={form.first_name} onChange={e => setForm(f => ({ ...f, first_name: e.target.value }))} />
          {errors.first_name && <span className={formStyles.error}>{errors.first_name}</span>}
        </div>

        <div className={formStyles.field}>
          <label className={formStyles.label}>Last Name <span className={formStyles.required}>*</span></label>
          <input className={formStyles.input} value={form.last_name} onChange={e => setForm(f => ({ ...f, last_name: e.target.value }))} />
          {errors.last_name && <span className={formStyles.error}>{errors.last_name}</span>}
        </div>

        <div className={formStyles.field}>
          <label className={formStyles.label}>Email <span className={formStyles.required}>*</span></label>
          <input className={formStyles.input} type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
          {errors.email && <span className={formStyles.error}>{errors.email}</span>}
          {orgSuggestion && (
            <div className={formStyles.suggestion}>
              <span>Domain matches <strong>{orgSuggestion.name}</strong></span>
              <button
                type="button"
                className={formStyles.suggestionBtn}
                onClick={() => { setForm(f => ({ ...f, organisation_id: String(orgSuggestion.id) })); setOrgSuggestion(null) }}
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
            <div className={styles.newOrgBox}>
              <div className={formStyles.field}>
                <label className={formStyles.label}>Organisation name</label>
                <input
                  className={formStyles.input}
                  placeholder="e.g. Google"
                  value={newOrgName}
                  onChange={e => setNewOrgName(e.target.value)}
                />
              </div>
              <div className={formStyles.field}>
                <label className={formStyles.label}>Email domain (optional)</label>
                <input
                  className={formStyles.input}
                  placeholder="e.g. google.com"
                  value={newOrgDomain}
                  onChange={e => setNewOrgDomain(e.target.value)}
                />
              </div>
              <button type="button" className={formStyles.btnPrimary} style={{ alignSelf: 'flex-start' }} onClick={handleCreateOrg}>
                Create Organisation
              </button>
            </div>
          ) : (
            <select
              className={formStyles.select}
              value={form.organisation_id}
              onChange={e => setForm(f => ({ ...f, organisation_id: e.target.value }))}
            >
              <option value="">None</option>
              {orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          )}
        </div>

        {submitError && <div className={formStyles.error}>{submitError}</div>}

        <div className={formStyles.actions}>
          <button type="button" className={formStyles.btnSecondary} onClick={onClose}>Cancel</button>
          <button type="submit" className={formStyles.btnPrimary} disabled={submitting}>
            {submitting ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
