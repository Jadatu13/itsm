import { useEffect, useState } from 'react'
import PageHeader from '../components/PageHeader'
import Modal from '../components/Modal'
import { formatDate } from '../utils/format'
import { apiFetch } from '../utils/api'
import formStyles from '../styles/forms.module.css'
import styles from './Organisations.module.css'

export default function Organisations() {
  const [orgs, setOrgs] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [showNewOrg, setShowNewOrg] = useState(false)
  const [managingDomains, setManagingDomains] = useState(null) // org object
  const [editingOrg, setEditingOrg] = useState(null)           // org object

  function load() {
    setLoading(true)
    apiFetch('/api/organisations')
      .then(r => r.json())
      .then(data => {
        const rows = Array.isArray(data) ? data : []
        setOrgs(rows.map(o => ({ ...o, domains: Array.isArray(o.domains) ? o.domains : [] })))
        setLoading(false)
      })
      .catch(() => { setError('Failed to load organisations'); setLoading(false) })
  }

  useEffect(() => { load() }, [])

  return (
    <div className={styles.page}>
      <PageHeader
        title="Organisations"
        action={
          <button className={styles.btnNew} onClick={() => setShowNewOrg(true)}>+ New Organisation</button>
        }
      />
      <div className={styles.content}>
        {loading && <div className={styles.state}>Loading…</div>}
        {error && <div className={`${styles.state} ${styles.err}`}>{error}</div>}
        {!loading && !error && (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email Domains</th>
                  <th>Contacts</th>
                  <th>Created</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {orgs.length === 0 && (
                  <tr><td colSpan={5} className={styles.empty}>No organisations yet.</td></tr>
                )}
                {orgs.map(o => (
                  <tr key={o.id} className={styles.row}>
                    <td className={styles.name}>
                      {o.name}
                      <button
                        className={styles.btnRename}
                        onClick={() => setEditingOrg(o)}
                        title="Rename organisation"
                      >
                        ✎
                      </button>
                    </td>
                    <td>
                      <div className={styles.domains}>
                        {o.domains.length === 0 ? (
                          <span className={styles.noDomains}>None</span>
                        ) : (
                          o.domains.map(d => (
                            <span key={d.id} className={styles.domainChip}>@{d.domain}</span>
                          ))
                        )}
                      </div>
                    </td>
                    <td className={styles.count}>{o.contact_count}</td>
                    <td className={styles.muted}>{formatDate(o.created_at)}</td>
                    <td>
                      <button
                        className={styles.btnDomains}
                        onClick={() => setManagingDomains(o)}
                      >
                        Manage Domains
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showNewOrg && (
        <NewOrgModal
          onClose={() => setShowNewOrg(false)}
          onCreated={() => { setShowNewOrg(false); load() }}
        />
      )}

      {managingDomains && (
        <DomainModal
          org={managingDomains}
          onClose={() => { setManagingDomains(null); load() }}
        />
      )}

      {editingOrg && (
        <EditOrgModal
          org={editingOrg}
          onClose={() => setEditingOrg(null)}
          onSaved={() => { setEditingOrg(null); load() }}
        />
      )}
    </div>
  )
}

// ─── New Organisation Modal ───────────────────────────────────────────────────

function NewOrgModal({ onClose, onCreated }) {
  const [name, setName] = useState('')
  const [domains, setDomains] = useState([])
  const [domainInput, setDomainInput] = useState('')
  const [domainError, setDomainError] = useState('')
  const [nameError, setNameError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState(null)

  function addDomain() {
    const cleaned = domainInput.trim().replace(/^@/, '').toLowerCase()
    if (!cleaned) return
    if (domains.includes(cleaned)) { setDomainError('Already added'); return }
    setDomains(d => [...d, cleaned])
    setDomainInput('')
    setDomainError('')
  }

  function removeDomain(d) {
    setDomains(ds => ds.filter(x => x !== d))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!name.trim()) { setNameError('Required'); return }
    setNameError('')
    setSubmitting(true)
    try {
      const res = await apiFetch('/api/organisations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setSubmitError(d.error || 'Failed to create organisation')
        setSubmitting(false)
        return
      }
      const org = await res.json()
      for (const domain of domains) {
        await fetch(`/api/organisations/${org.id}/domains`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ domain }),
        }).catch(() => {})
      }
      onCreated()
    } catch {
      setSubmitError('Something went wrong. Please try again.')
      setSubmitting(false)
    }
  }

  return (
    <Modal title="New Organisation" onClose={onClose}>
      <form className={formStyles.form} onSubmit={handleSubmit}>
        <div className={formStyles.field}>
          <label className={formStyles.label}>Name <span className={formStyles.required}>*</span></label>
          <input
            className={formStyles.input}
            value={name}
            onChange={e => setName(e.target.value)}
            autoFocus
          />
          {nameError && <span className={formStyles.error}>{nameError}</span>}
        </div>

        <div className={formStyles.field}>
          <label className={formStyles.label}>Email Domains <span className={styles.optional}>(optional)</span></label>

          {domains.length > 0 && (
            <div className={styles.domainTags}>
              {domains.map(d => (
                <span key={d} className={styles.domainTag}>
                  @{d}
                  <button type="button" className={styles.domainTagRemove} onClick={() => removeDomain(d)}>×</button>
                </span>
              ))}
            </div>
          )}

          <div className={styles.domainAddRow}>
            <input
              className={`${formStyles.input} ${styles.domainAddInput}`}
              placeholder="@domain.com"
              value={domainInput}
              onChange={e => { setDomainInput(e.target.value.replace(/^@/, '')); setDomainError('') }}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addDomain() } }}
            />
            <button type="button" className={styles.btnAddDomain} onClick={addDomain} disabled={!domainInput.trim()}>
              Add
            </button>
          </div>
          {domainError && <span className={formStyles.error}>{domainError}</span>}
          <span className={styles.domainHint}>Contacts with a matching email domain will auto-suggest this organisation.</span>
        </div>

        {submitError && <div className={formStyles.error}>{submitError}</div>}
        <div className={formStyles.actions}>
          <button type="button" className={formStyles.btnSecondary} onClick={onClose}>Cancel</button>
          <button type="submit" className={formStyles.btnPrimary} disabled={submitting}>
            {submitting ? 'Creating…' : 'Create Organisation'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

// ─── Edit Organisation Name Modal ─────────────────────────────────────────────

function EditOrgModal({ org, onClose, onSaved }) {
  const [name, setName] = useState(org.name)
  const [nameError, setNameError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState(null)

  async function handleSubmit(e) {
    e.preventDefault()
    if (!name.trim()) { setNameError('Required'); return }
    if (name.trim() === org.name) { onClose(); return }
    setNameError('')
    setSubmitting(true)
    try {
      const res = await fetch(`/api/organisations/${org.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() }),
      })
      if (res.ok) {
        onSaved()
      } else {
        const d = await res.json().catch(() => ({}))
        setSubmitError(d.error || 'Failed to update organisation')
        setSubmitting(false)
      }
    } catch {
      setSubmitError('Something went wrong. Please try again.')
      setSubmitting(false)
    }
  }

  return (
    <Modal title="Rename Organisation" onClose={onClose}>
      <form className={formStyles.form} onSubmit={handleSubmit}>
        <div className={formStyles.field}>
          <label className={formStyles.label}>Name <span className={formStyles.required}>*</span></label>
          <input
            className={formStyles.input}
            value={name}
            onChange={e => setName(e.target.value)}
            autoFocus
          />
          {nameError && <span className={formStyles.error}>{nameError}</span>}
        </div>
        {submitError && <div className={formStyles.error}>{submitError}</div>}
        <div className={formStyles.actions}>
          <button type="button" className={formStyles.btnSecondary} onClick={onClose}>Cancel</button>
          <button type="submit" className={formStyles.btnPrimary} disabled={submitting}>
            {submitting ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

// ─── Domain Management Modal ──────────────────────────────────────────────────

function DomainModal({ org, onClose }) {
  const [domains, setDomains] = useState(org.domains || [])
  const [newDomain, setNewDomain] = useState('')
  const [addError, setAddError] = useState(null)
  const [adding, setAdding] = useState(false)

  async function handleAdd(e) {
    e.preventDefault()
    const cleaned = newDomain.trim().replace(/^@/, '')
    if (!cleaned) return
    setAdding(true)
    setAddError(null)
    try {
      const res = await fetch(`/api/organisations/${org.id}/domains`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain: cleaned }),
      })
      if (res.ok) {
        const added = await res.json()
        setDomains(d => [...d, added])
        setNewDomain('')
      } else {
        const d = await res.json().catch(() => ({}))
        setAddError(d.error || 'Failed to add domain')
      }
    } catch {
      setAddError('Something went wrong. Please try again.')
    }
    setAdding(false)
  }

  async function handleRemove(domainId) {
    try {
      await fetch(`/api/organisations/${org.id}/domains/${domainId}`, { method: 'DELETE' })
      setDomains(d => d.filter(x => x.id !== domainId))
    } catch { /* ignore */ }
  }

  return (
    <Modal title={`Domains — ${org.name}`} onClose={onClose}>
      <div className={styles.domainModalBody}>
        <p className={styles.domainDesc}>
          Contacts whose email matches one of these domains will be auto-suggested this organisation when creating or editing a contact.
        </p>

        <div className={styles.domainList}>
          {domains.length === 0 && (
            <div className={styles.domainEmpty}>No domains configured yet.</div>
          )}
          {domains.map(d => (
            <div key={d.id} className={styles.domainRow}>
              <span className={styles.domainChip}>@{d.domain}</span>
              <button
                className={styles.removeBtn}
                onClick={() => handleRemove(d.id)}
                title="Remove domain"
              >
                ×
              </button>
            </div>
          ))}
        </div>

        <form className={styles.addDomainForm} onSubmit={handleAdd}>
          <input
            className={`${formStyles.input} ${styles.domainAddInput}`}
            placeholder="@domain.com"
            value={newDomain}
            onChange={e => setNewDomain(e.target.value.replace(/^@/, ''))}
          />
          <button type="submit" className={formStyles.btnPrimary} disabled={adding || !newDomain.trim()}>
            {adding ? 'Adding…' : 'Add Domain'}
          </button>
        </form>
        {addError && <div className={formStyles.error} style={{ marginTop: 6 }}>{addError}</div>}

        <div className={formStyles.actions} style={{ paddingTop: 16 }}>
          <button type="button" className={formStyles.btnSecondary} onClick={onClose}>Done</button>
        </div>
      </div>
    </Modal>
  )
}
