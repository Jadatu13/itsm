import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import PageHeader from '../components/PageHeader'
import { StatusBadge, PriorityBadge } from '../components/Badge'
import Modal from '../components/Modal'
import ConfirmModal from '../components/ConfirmModal'
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
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [showMerge, setShowMerge] = useState(false)
  const navigate = useNavigate()

  function load() {
    apiFetch(`/api/contacts/${id}`)
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
  if (error)   return <div className={styles.page}><PageHeader title="Contact" /><div className={`${styles.state} ${styles.err}`}>{error}</div></div>

  return (
    <div className={styles.page}>
      <PageHeader
        title={contact.full_name}
        action={
          <div style={{ display: 'flex', gap: 8 }}>
            <button className={styles.btnMerge} onClick={() => setShowMerge(true)}>Merge Contact</button>
            <button className={styles.btnEdit} onClick={() => setShowEdit(true)}>Edit Contact</button>
            <button className={styles.btnDelete} onClick={() => setConfirmDelete(true)}>Delete</button>
          </div>
        }
      />
      <div className={styles.content}>
        {/* ── Profile card ── */}
        <div className={styles.card}>
          <div className={styles.avatar}>{contact.first_name[0]}{contact.last_name[0]}</div>
          <div className={styles.info}>
            <div className={styles.fullName}>{contact.full_name}</div>
            <div className={styles.email}>{contact.email}</div>
            {contact.phone && (
              <div className={styles.phone}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.6 1.24h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.85a16 16 0 0 0 5.33 5.33l.91-.91a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 21 15.53l.02 1.39z"/>
                </svg>
                {contact.phone}
              </div>
            )}
            {contact.organisation_name && (
              <div className={styles.org}>{contact.organisation_name}</div>
            )}
            <div className={styles.joined}>Member since {formatDate(contact.created_at)}</div>
          </div>
        </div>

        {/* ── Notes ── */}
        {contact.notes && (
          <div className={styles.section}>
            <h2 className={styles.sectionTitle}>Notes</h2>
            <div className={styles.notesBox}>{contact.notes}</div>
          </div>
        )}

        {/* ── Ticket history ── */}
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

      {showMerge && (
        <MergeModal
          contact={contact}
          onClose={() => setShowMerge(false)}
          onMerged={targetId => navigate(`/contacts/${targetId}`)}
        />
      )}

      {confirmDelete && (
        <ConfirmModal
          title="Delete contact?"
          message={`This will permanently delete ${contact.full_name}. Their ticket history will be preserved but unlinked. This cannot be undone.`}
          confirmLabel="Delete Contact"
          onConfirm={async () => {
            await apiFetch(`/api/contacts/${id}`, { method: 'DELETE' })
            navigate('/contacts')
          }}
          onClose={() => setConfirmDelete(false)}
        />
      )}
    </div>
  )
}

// ─── Merge modal ──────────────────────────────────────────────────────────────

function MergeModal({ contact, onClose, onMerged }) {
  const [search, setSearch] = useState('')
  const [results, setResults] = useState([])
  const [selected, setSelected] = useState(null)
  const [merging, setMerging] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!search.trim()) { setResults([]); return }
    const t = setTimeout(() => {
      apiFetch(`/api/contacts?q=${encodeURIComponent(search)}`)
        .then(r => r.json())
        .then(d => {
          if (Array.isArray(d)) setResults(d.filter(c => c.id !== contact.id))
        })
        .catch(() => {})
    }, 250)
    return () => clearTimeout(t)
  }, [search])

  async function handleMerge() {
    if (!selected) return
    setMerging(true)
    setError(null)
    const res = await apiFetch(`/api/contacts/${contact.id}/merge`, {
      method: 'POST',
      body: JSON.stringify({ target_id: selected.id }),
    })
    const data = await res.json()
    if (!res.ok) { setError(data.error); setMerging(false); return }
    onMerged(selected.id)
  }

  return (
    <Modal title="Merge Contact" onClose={onClose}>
      <div className={styles.mergeModal}>
        <p className={styles.mergeInfo}>
          All tickets from <strong>{contact.full_name}</strong> will be moved to the selected contact, then this contact will be deleted.
        </p>
        <div className={formStyles.field}>
          <label className={formStyles.label}>Search for target contact</label>
          <input
            className={formStyles.input}
            placeholder="Search by name or email…"
            value={search}
            autoFocus
            onChange={e => { setSearch(e.target.value); setSelected(null) }}
          />
        </div>
        {results.length > 0 && !selected && (
          <div className={styles.mergeResults}>
            {results.map(c => (
              <div key={c.id} className={styles.mergeResult} onClick={() => setSelected(c)}>
                <div className={styles.mergeResultName}>{c.first_name} {c.last_name}</div>
                <div className={styles.mergeResultMeta}>{c.email}{c.organisation_name ? ` · ${c.organisation_name}` : ''}</div>
              </div>
            ))}
          </div>
        )}
        {selected && (
          <div className={styles.mergeSelected}>
            <div className={styles.mergeSelectedLabel}>Merging into:</div>
            <div className={styles.mergeResult} style={{ cursor: 'default' }}>
              <div className={styles.mergeResultName}>{selected.first_name} {selected.last_name}</div>
              <div className={styles.mergeResultMeta}>{selected.email}{selected.organisation_name ? ` · ${selected.organisation_name}` : ''}</div>
            </div>
            <button type="button" className={styles.mergeChange} onClick={() => setSelected(null)}>Change</button>
          </div>
        )}
        {error && <div className={formStyles.error}>{error}</div>}
        <div className={formStyles.actions}>
          <button type="button" className={formStyles.btnSecondary} onClick={onClose}>Cancel</button>
          <button type="button" className={styles.btnMergeConfirm} disabled={!selected || merging} onClick={handleMerge}>
            {merging ? 'Merging…' : 'Merge Contacts'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

// ─── Edit Contact Modal ───────────────────────────────────────────────────────

function EditContactModal({ contact, onClose, onSaved }) {
  const [orgs, setOrgs] = useState([])
  const [form, setForm] = useState({
    first_name:      contact.first_name,
    last_name:       contact.last_name,
    email:           contact.email,
    phone:           contact.phone || '',
    notes:           contact.notes || '',
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

  useEffect(() => {
    const domain = form.email.split('@')[1]
    if (!domain || !domain.includes('.')) { setOrgSuggestion(null); return }
    apiFetch(`/api/organisations/by-domain?domain=${encodeURIComponent(domain)}`)
      .then(r => r.json())
      .then(match => {
        if (match && String(match.id) !== form.organisation_id) setOrgSuggestion(match)
        else setOrgSuggestion(null)
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
    const res = await apiFetch(`/api/contacts/${contact.id}`, {
      method: 'PUT',
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
        body: JSON.stringify({ name: newOrgName }),
      })
      if (!res.ok) return
      const org = await res.json()
      if (newOrgDomain.trim()) {
        await apiFetch(`/api/organisations/${org.id}/domains`, {
          method: 'POST',
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
        <div className={formStyles.row}>
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
        </div>

        <div className={formStyles.field}>
          <label className={formStyles.label}>Email <span className={formStyles.required}>*</span></label>
          <input className={formStyles.input} type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
          {errors.email && <span className={formStyles.error}>{errors.email}</span>}
          {orgSuggestion && (
            <div className={formStyles.suggestion}>
              <span>Domain matches <strong>{orgSuggestion.name}</strong></span>
              <button type="button" className={formStyles.suggestionBtn}
                onClick={() => { setForm(f => ({ ...f, organisation_id: String(orgSuggestion.id) })); setOrgSuggestion(null) }}>
                Set organisation
              </button>
            </div>
          )}
        </div>

        <div className={formStyles.field}>
          <label className={formStyles.label}>Phone</label>
          <input className={formStyles.input} type="tel" placeholder="e.g. +64 9 123 4567" value={form.phone}
            onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} />
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
                <input className={formStyles.input} placeholder="e.g. Google" value={newOrgName} onChange={e => setNewOrgName(e.target.value)} />
              </div>
              <div className={formStyles.field}>
                <label className={formStyles.label}>Email domain (optional)</label>
                <input className={formStyles.input} placeholder="e.g. google.com" value={newOrgDomain} onChange={e => setNewOrgDomain(e.target.value)} />
              </div>
              <button type="button" className={formStyles.btnPrimary} style={{ alignSelf: 'flex-start' }} onClick={handleCreateOrg}>
                Create Organisation
              </button>
            </div>
          ) : (
            <select className={formStyles.select} value={form.organisation_id}
              onChange={e => setForm(f => ({ ...f, organisation_id: e.target.value }))}>
              <option value="">None</option>
              {orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          )}
        </div>

        <div className={formStyles.field}>
          <label className={formStyles.label}>Notes</label>
          <textarea className={formStyles.input} rows={4} placeholder="Internal notes about this contact…"
            value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
            style={{ resize: 'vertical', fontFamily: 'inherit' }} />
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
