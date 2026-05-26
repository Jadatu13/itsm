import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import PageHeader from '../components/PageHeader'
import { StatusBadge, PriorityBadge, CategoryBadge, SourceBadge, CATEGORY_OPTIONS, SOURCE_OPTIONS } from '../components/Badge'
import Modal from '../components/Modal'
import ContactSelect from '../components/ContactSelect'
import ContactForm from '../components/ContactForm'
import { formatDate } from '../utils/format'
import { apiFetch } from '../utils/api'
import formStyles from '../styles/forms.module.css'
import styles from './TicketList.module.css'

export default function TicketList() {
  const [tickets, setTickets] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [statusFilter, setStatusFilter] = useState('active')
  const [priorityFilter, setPriorityFilter] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [orgFilter, setOrgFilter] = useState('')
  const [sourceFilter, setSourceFilter] = useState('')
  const [orgs, setOrgs] = useState([])
  const [search, setSearch] = useState('')
  const [showModal, setShowModal] = useState(false)
  const navigate = useNavigate()

  useEffect(() => {
    apiFetch('/api/organisations').then(r => r.json()).then(d => { if (Array.isArray(d)) setOrgs(d) }).catch(() => {})
  }, [])

  const fetchTickets = useCallback(() => {
    setLoading(true)
    const params = new URLSearchParams()
    if (statusFilter)   params.set('status',          statusFilter)
    if (search)         params.set('search',           search)
    if (priorityFilter) params.set('priority',         priorityFilter)
    if (categoryFilter) params.set('category',         categoryFilter)
    if (orgFilter)      params.set('organisation_id',  orgFilter)
    if (sourceFilter)   params.set('source',           sourceFilter)
    apiFetch(`/api/tickets?${params}`)
      .then(r => r.json())
      .then(data => { setTickets(Array.isArray(data) ? data : []); setLoading(false) })
      .catch(() => { setError('Failed to load tickets'); setLoading(false) })
  }, [statusFilter, search, priorityFilter, categoryFilter, orgFilter, sourceFilter])

  useEffect(() => { fetchTickets() }, [fetchTickets])

  return (
    <div className={styles.page}>
      <PageHeader
        title="Tickets"
        action={
          <button className={styles.btnNew} onClick={() => setShowModal(true)}>
            + New Ticket
          </button>
        }
      />
      <div className={styles.content}>
        <div className={styles.filters}>
          <select className={styles.filterSelect} value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
            <option value="active">Active (Unresolved)</option>
            <option value="">All Tickets</option>
            <option value="open">Open</option>
            <option value="in_progress">In Progress</option>
            <option value="on_hold">On Hold</option>
            <option value="resolved">Resolved</option>
          </select>

          <select className={styles.filterSelect} value={priorityFilter} onChange={e => setPriorityFilter(e.target.value)}>
            <option value="">All Priorities</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>

          <select className={styles.filterSelect} value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)}>
            <option value="">All Categories</option>
            {CATEGORY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>

          <select className={styles.filterSelect} value={orgFilter} onChange={e => setOrgFilter(e.target.value)}>
            <option value="">All Organisations</option>
            {orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>

          <select className={styles.filterSelect} value={sourceFilter} onChange={e => setSourceFilter(e.target.value)}>
            <option value="">All Sources</option>
            {SOURCE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>

          <input
            className={styles.searchInput}
            type="text"
            placeholder="Search by subject…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        {loading && <div className={styles.state}>Loading…</div>}
        {error && <div className={`${styles.state} ${styles.err}`}>{error}</div>}
        {!loading && !error && (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Reference</th>
                  <th>Subject</th>
                  <th>Contact</th>
                  <th>Organisation</th>
                  <th>Status</th>
                  <th>Priority</th>
                  <th>Category</th>
                  <th>Source</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {tickets.length === 0 && (
                  <tr><td colSpan={9} className={styles.empty}>No tickets found.</td></tr>
                )}
                {tickets.map(t => (
                  <tr key={t.id} className={styles.row} onClick={() => navigate(`/tickets/${t.id}`)}>
                    <td className={styles.ref}>{t.reference}</td>
                    <td className={styles.subject}>{t.subject}</td>
                    <td>{t.contact_name}</td>
                    <td>{t.organisation_name ?? <span className={styles.none}>—</span>}</td>
                    <td><StatusBadge status={t.status} /></td>
                    <td><PriorityBadge priority={t.priority} /></td>
                    <td>{t.category ? <CategoryBadge category={t.category} /> : <span className={styles.none}>—</span>}</td>
                    <td><SourceBadge source={t.source || 'manual'} /></td>
                    <td className={styles.muted}>{formatDate(t.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showModal && (
        <NewTicketModal
          onClose={() => setShowModal(false)}
          onCreated={(ticket) => {
            setShowModal(false)
            navigate(`/tickets/${ticket.id}`)
          }}
        />
      )}
    </div>
  )
}

// ─── New Ticket Modal ─────────────────────────────────────────────────────────

function NewTicketModal({ onClose, onCreated }) {
  const [contacts, setContacts] = useState([])
  const [organisations, setOrganisations] = useState([])
  const [form, setForm] = useState({ contact_id: '', subject: '', description: '', priority: 'low', category: '', source: 'manual' })
  const [errors, setErrors] = useState({})
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState(null)
  const [showNewContact, setShowNewContact] = useState(false)

  useEffect(() => {
    apiFetch('/api/contacts').then(r => r.json()).then(d => { if (Array.isArray(d)) setContacts(d) }).catch(() => {})
    apiFetch('/api/organisations').then(r => r.json()).then(d => { if (Array.isArray(d)) setOrganisations(d) }).catch(() => {})
  }, [])

  function validate() {
    const e = {}
    if (!form.contact_id) e.contact_id = 'Required'
    if (!form.subject.trim()) e.subject = 'Required'
    if (!form.description.trim()) e.description = 'Required'
    setErrors(e)
    return !Object.keys(e).length
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!validate()) return
    setSubmitting(true)
    setSubmitError(null)
    try {
      const res = await apiFetch('/api/tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      if (!res.ok) { const d = await res.json(); throw new Error(d.error) }
      onCreated(await res.json())
    } catch (err) {
      setSubmitError(err.message || 'Failed to create ticket')
      setSubmitting(false)
    }
  }

  async function handleContactCreated(created) {
    try {
      const updated = await apiFetch('/api/contacts').then(r => r.json())
      if (Array.isArray(updated)) setContacts(updated)
    } catch { /* use existing list */ }
    setForm(f => ({ ...f, contact_id: String(created.id) }))
    setShowNewContact(false)
  }

  return (
    <Modal title={showNewContact ? 'New Contact' : 'New Ticket'} onClose={onClose}>
      {showNewContact ? (
        <ContactForm
          organisations={organisations}
          onOrgsUpdated={setOrganisations}
          onCreated={handleContactCreated}
          onBack={() => setShowNewContact(false)}
          note="Create a new contact, then continue with the ticket."
        />
      ) : (
        <form className={formStyles.form} onSubmit={handleSubmit}>
          <div className={formStyles.field}>
            <div className={formStyles.labelRow}>
              <label className={formStyles.label}>Contact <span className={formStyles.required}>*</span></label>
              <button type="button" className={formStyles.addLink} onClick={() => setShowNewContact(true)}>
                + New contact
              </button>
            </div>
            <ContactSelect
              contacts={contacts}
              value={form.contact_id}
              onChange={id => setForm(f => ({ ...f, contact_id: id }))}
            />
            {errors.contact_id && <span className={formStyles.error}>{errors.contact_id}</span>}
          </div>

          <div className={formStyles.field}>
            <label className={formStyles.label}>Subject <span className={formStyles.required}>*</span></label>
            <input
              className={formStyles.input}
              value={form.subject}
              onChange={e => setForm(f => ({ ...f, subject: e.target.value }))}
            />
            {errors.subject && <span className={formStyles.error}>{errors.subject}</span>}
          </div>

          <div className={formStyles.field}>
            <label className={formStyles.label}>Description <span className={formStyles.required}>*</span></label>
            <textarea
              className={formStyles.textarea}
              value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
            />
            {errors.description && <span className={formStyles.error}>{errors.description}</span>}
          </div>

          <div className={formStyles.inlineRow}>
            <div className={formStyles.field}>
              <label className={formStyles.label}>Priority</label>
              <select className={formStyles.select} value={form.priority} onChange={e => setForm(f => ({ ...f, priority: e.target.value }))}>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </div>
            <div className={formStyles.field}>
              <label className={formStyles.label}>Category</label>
              <select className={formStyles.select} value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}>
                <option value="">— None —</option>
                {CATEGORY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          </div>

          <div className={formStyles.field}>
            <label className={formStyles.label}>Source</label>
            <select className={formStyles.select} value={form.source} onChange={e => setForm(f => ({ ...f, source: e.target.value }))}>
              {SOURCE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>

          {submitError && <div className={formStyles.error}>{submitError}</div>}

          <div className={formStyles.actions}>
            <button type="button" className={formStyles.btnSecondary} onClick={onClose}>Cancel</button>
            <button type="submit" className={formStyles.btnPrimary} disabled={submitting}>
              {submitting ? 'Creating…' : 'Create Ticket'}
            </button>
          </div>
        </form>
      )}
    </Modal>
  )
}
