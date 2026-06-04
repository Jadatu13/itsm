import { useEffect, useState, useCallback } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import PageHeader from '../components/PageHeader'
import { StatusBadge, PriorityBadge, CategoryBadge, SourceBadge, CATEGORY_OPTIONS, SOURCE_OPTIONS } from '../components/Badge'
import Modal from '../components/Modal'
import ConfirmModal from '../components/ConfirmModal'
import ContactSelect from '../components/ContactSelect'
import ContactForm from '../components/ContactForm'
import { formatDate } from '../utils/format'
import { apiFetch } from '../utils/api'
import formStyles from '../styles/forms.module.css'
import styles from './TicketList.module.css'

// ─── Built-in saved views ─────────────────────────────────────────────────────

const BUILT_IN_VIEWS = [
  { id: 'all-open',      label: 'All Open',      params: { status: 'active' } },
  { id: 'my-tickets',    label: 'My Tickets',     params: { status: 'active', assigned_to: 'me' } },
  { id: 'unassigned',    label: 'Unassigned',     params: { status: 'active', assigned_to: 'none' } },
  { id: 'high-priority', label: 'High Priority',  params: { status: 'active', priority: 'high' } },
  { id: 'sla-breached',  label: 'SLA Breached',   params: { status: 'active', sla: 'breached' } },
]

function loadCustomViews() {
  try {
    return JSON.parse(localStorage.getItem('ticketSavedViews') || '[]')
  } catch {
    return []
  }
}

function saveCustomViews(views) {
  localStorage.setItem('ticketSavedViews', JSON.stringify(views))
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function TicketList() {
  const [tickets, setTickets]             = useState([])
  const [loading, setLoading]             = useState(true)
  const [error, setError]                 = useState(null)
  const [orgs, setOrgs]                   = useState([])
  const [agents, setAgents]               = useState([])
  const [showModal, setShowModal]         = useState(false)
  const [selected, setSelected]           = useState(new Set())
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false)
  const [customViews, setCustomViews]     = useState(loadCustomViews)
  const [savingView, setSavingView]       = useState(false)
  const [newViewName, setNewViewName]     = useState('')

  // ── Bulk action bar state ──────────────────────────────────────────────────
  const [bulkAssignAgent, setBulkAssignAgent] = useState('')
  const [bulkStatus, setBulkStatus]           = useState('')
  const [bulkPriority, setBulkPriority]       = useState('')
  const [bulkWorking, setBulkWorking]         = useState(false)

  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()

  // ── Filter state is URL-driven ─────────────────────────────────────────────
  const statusFilter   = searchParams.get('status')   ?? 'active'
  const priorityFilter = searchParams.get('priority') ?? ''
  const categoryFilter = searchParams.get('category') ?? ''
  const orgFilter      = searchParams.get('organisation_id') ?? ''
  const sourceFilter   = searchParams.get('source')   ?? ''
  const search         = searchParams.get('search')   ?? ''
  const assignedFilter = searchParams.get('assigned_to') ?? ''
  const slaFilter      = searchParams.get('sla')      ?? ''

  function setFilter(key, value) {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev)
      if (value) next.set(key, value)
      else next.delete(key)
      return next
    }, { replace: true })
  }

  function applyView(params) {
    setSearchParams(params, { replace: true })
  }

  useEffect(() => {
    apiFetch('/api/organisations').then(r => r.json()).then(d => { if (Array.isArray(d)) setOrgs(d) }).catch(() => {})
    apiFetch('/api/agents').then(r => r.json()).then(d => { if (Array.isArray(d)) setAgents(d) }).catch(() => {})
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
    if (assignedFilter) params.set('assigned_to',      assignedFilter)
    if (slaFilter)      params.set('sla',              slaFilter)
    apiFetch(`/api/tickets?${params}`)
      .then(r => r.json())
      .then(data => { setTickets(Array.isArray(data) ? data : []); setLoading(false) })
      .catch(() => { setError('Failed to load tickets'); setLoading(false) })
  }, [statusFilter, search, priorityFilter, categoryFilter, orgFilter, sourceFilter, assignedFilter, slaFilter])

  useEffect(() => { fetchTickets() }, [fetchTickets])
  useEffect(() => { setSelected(new Set()) }, [tickets])

  function toggleSelect(id) {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function toggleSelectAll() {
    if (selected.size === tickets.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(tickets.map(t => t.id)))
    }
  }

  async function handleBulkDelete() {
    await Promise.all([...selected].map(id => apiFetch(`/api/tickets/${id}`, { method: 'DELETE' })))
    setSelected(new Set())
    fetchTickets()
  }

  async function runBulkAction(action, value) {
    if (selected.size === 0) return
    setBulkWorking(true)
    try {
      await apiFetch('/api/tickets/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [...selected], action, value }),
      })
      setSelected(new Set())
      fetchTickets()
    } catch {
      // ignore — refetch anyway
      fetchTickets()
    }
    setBulkWorking(false)
  }

  function handleSaveView() {
    const name = newViewName.trim()
    if (!name) return
    const params = {}
    if (statusFilter)   params.status          = statusFilter
    if (priorityFilter) params.priority        = priorityFilter
    if (categoryFilter) params.category        = categoryFilter
    if (orgFilter)      params.organisation_id = orgFilter
    if (sourceFilter)   params.source          = sourceFilter
    if (search)         params.search          = search
    if (assignedFilter) params.assigned_to     = assignedFilter
    if (slaFilter)      params.sla             = slaFilter
    const newView = { id: Date.now().toString(), label: name, params }
    const updated = [...customViews, newView]
    setCustomViews(updated)
    saveCustomViews(updated)
    setNewViewName('')
    setSavingView(false)
  }

  function deleteCustomView(id) {
    const updated = customViews.filter(v => v.id !== id)
    setCustomViews(updated)
    saveCustomViews(updated)
  }

  const activeFiltersCount = [statusFilter !== 'active' ? 1 : 0, priorityFilter, categoryFilter, orgFilter, sourceFilter, search, assignedFilter, slaFilter].filter(Boolean).length

  return (
    <div className={styles.page}>
      <PageHeader
        title="Tickets"
        action={
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {selected.size > 0 && (
              <button className={styles.btnDelete} onClick={() => setConfirmBulkDelete(true)}>
                Delete {selected.size} ticket{selected.size !== 1 ? 's' : ''}
              </button>
            )}
            <button className={styles.btnNew} onClick={() => setShowModal(true)}>
              + New Ticket
            </button>
          </div>
        }
      />
      <div className={styles.content}>

        {/* ── Saved views sidebar row ───────────────────────────────────────── */}
        <div className={styles.viewsBar}>
          <div className={styles.viewsGroup}>
            <span className={styles.viewsLabel}>Views</span>
            {BUILT_IN_VIEWS.map(v => (
              <button
                key={v.id}
                className={`${styles.viewBtn} ${isViewActive(v.params, searchParams) ? styles.viewBtnActive : ''}`}
                onClick={() => applyView(v.params)}
              >
                {v.label}
              </button>
            ))}
            {customViews.map(v => (
              <span key={v.id} className={styles.viewBtnWrap}>
                <button
                  className={`${styles.viewBtn} ${isViewActive(v.params, searchParams) ? styles.viewBtnActive : ''}`}
                  onClick={() => applyView(v.params)}
                >
                  {v.label}
                </button>
                <button className={styles.viewBtnDelete} title="Remove saved view" onClick={() => deleteCustomView(v.id)}>✕</button>
              </span>
            ))}
          </div>
          <div className={styles.viewsSave}>
            {savingView ? (
              <span className={styles.viewSaveInline}>
                <input
                  className={styles.viewNameInput}
                  placeholder="View name…"
                  value={newViewName}
                  autoFocus
                  onChange={e => setNewViewName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleSaveView(); if (e.key === 'Escape') setSavingView(false) }}
                />
                <button className={styles.viewSaveBtn} onClick={handleSaveView} disabled={!newViewName.trim()}>Save</button>
                <button className={styles.viewCancelBtn} onClick={() => setSavingView(false)}>Cancel</button>
              </span>
            ) : (
              <button className={styles.viewSaveLink} onClick={() => setSavingView(true)} title="Save current filters as a view">
                + Save view{activeFiltersCount > 0 ? ` (${activeFiltersCount} filter${activeFiltersCount !== 1 ? 's' : ''})` : ''}
              </button>
            )}
          </div>
        </div>

        {/* ── Filters row ──────────────────────────────────────────────────── */}
        <div className={styles.filters}>
          <select className={styles.filterSelect} value={statusFilter} onChange={e => setFilter('status', e.target.value)}>
            <option value="active">Active (Unresolved)</option>
            <option value="">All Tickets</option>
            <option value="open">Open</option>
            <option value="in_progress">In Progress</option>
            <option value="on_hold">On Hold</option>
            <option value="resolved">Resolved</option>
          </select>

          <select className={styles.filterSelect} value={priorityFilter} onChange={e => setFilter('priority', e.target.value)}>
            <option value="">All Priorities</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>

          <select className={styles.filterSelect} value={categoryFilter} onChange={e => setFilter('category', e.target.value)}>
            <option value="">All Categories</option>
            {CATEGORY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>

          <select className={styles.filterSelect} value={orgFilter} onChange={e => setFilter('organisation_id', e.target.value)}>
            <option value="">All Organisations</option>
            {orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>

          <select className={styles.filterSelect} value={sourceFilter} onChange={e => setFilter('source', e.target.value)}>
            <option value="">All Sources</option>
            {SOURCE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>

          <input
            className={styles.searchInput}
            type="text"
            placeholder="Search by subject…"
            value={search}
            onChange={e => setFilter('search', e.target.value)}
          />
        </div>

        {loading && <div className={styles.state}>Loading…</div>}
        {error && <div className={`${styles.state} ${styles.err}`}>{error}</div>}
        {!loading && !error && (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th className={styles.checkCol}>
                    <input
                      type="checkbox"
                      checked={tickets.length > 0 && selected.size === tickets.length}
                      onChange={toggleSelectAll}
                      title="Select all"
                    />
                  </th>
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
                  <tr><td colSpan={10} className={styles.empty}>No tickets found.</td></tr>
                )}
                {tickets.map(t => (
                  <tr
                    key={t.id}
                    className={`${styles.row} ${selected.has(t.id) ? styles.rowSelected : ''}`}
                    onClick={() => navigate(`/tickets/${t.id}`)}
                  >
                    <td className={styles.checkCol} onClick={e => { e.stopPropagation(); toggleSelect(t.id) }}>
                      <input type="checkbox" checked={selected.has(t.id)} onChange={() => toggleSelect(t.id)} />
                    </td>
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

      {/* ── Floating bulk action bar ─────────────────────────────────────────── */}
      {selected.size > 0 && (
        <div className={styles.bulkBar}>
          <span className={styles.bulkCount}>{selected.size} selected</span>

          <span className={styles.bulkSep} />

          <label className={styles.bulkLabel}>Assign To</label>
          <select
            className={styles.bulkSelect}
            value={bulkAssignAgent}
            onChange={e => setBulkAssignAgent(e.target.value)}
          >
            <option value="">— Agent —</option>
            <option value="__unassign__">Unassign</option>
            {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          <button
            className={styles.bulkBtn}
            disabled={!bulkAssignAgent || bulkWorking}
            onClick={() => {
              runBulkAction('assign', bulkAssignAgent === '__unassign__' ? null : bulkAssignAgent)
              setBulkAssignAgent('')
            }}
          >
            Apply
          </button>

          <span className={styles.bulkSep} />

          <label className={styles.bulkLabel}>Set Status</label>
          <select
            className={styles.bulkSelect}
            value={bulkStatus}
            onChange={e => setBulkStatus(e.target.value)}
          >
            <option value="">— Status —</option>
            <option value="open">Open</option>
            <option value="in_progress">In Progress</option>
            <option value="on_hold">On Hold</option>
            <option value="resolved">Resolved</option>
          </select>
          <button
            className={styles.bulkBtn}
            disabled={!bulkStatus || bulkWorking}
            onClick={() => { runBulkAction('status', bulkStatus); setBulkStatus('') }}
          >
            Apply
          </button>

          <span className={styles.bulkSep} />

          <label className={styles.bulkLabel}>Set Priority</label>
          <select
            className={styles.bulkSelect}
            value={bulkPriority}
            onChange={e => setBulkPriority(e.target.value)}
          >
            <option value="">— Priority —</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
          <button
            className={styles.bulkBtn}
            disabled={!bulkPriority || bulkWorking}
            onClick={() => { runBulkAction('priority', bulkPriority); setBulkPriority('') }}
          >
            Apply
          </button>

          <span className={styles.bulkSep} />

          <button
            className={`${styles.bulkBtn} ${styles.bulkBtnResolve}`}
            disabled={bulkWorking}
            onClick={() => runBulkAction('resolve', null)}
          >
            Close (Resolve)
          </button>

          <button className={styles.bulkClearBtn} onClick={() => setSelected(new Set())}>
            Clear
          </button>
        </div>
      )}

      {showModal && (
        <NewTicketModal
          onClose={() => setShowModal(false)}
          onCreated={(ticket) => {
            setShowModal(false)
            navigate(`/tickets/${ticket.id}`)
          }}
        />
      )}

      {confirmBulkDelete && (
        <ConfirmModal
          title={`Delete ${selected.size} ticket${selected.size !== 1 ? 's' : ''}?`}
          message="This will permanently delete the selected tickets and all their replies. This cannot be undone."
          confirmLabel={`Delete ${selected.size} Ticket${selected.size !== 1 ? 's' : ''}`}
          onConfirm={handleBulkDelete}
          onClose={() => setConfirmBulkDelete(false)}
        />
      )}
    </div>
  )
}

// ─── Helper: check if a view's params match the current URL params ────────────

// Keys that define a "view" — any of these being set beyond what the view declares means it's a different view
const VIEW_DEFINING_KEYS = ['status', 'assigned_to', 'priority', 'sla', 'source', 'category']

function isViewActive(viewParams, searchParams) {
  const keys = Object.keys(viewParams)
  if (keys.length === 0) return false
  // All params in this view must match
  if (!keys.every(k => searchParams.get(k) === String(viewParams[k]))) return false
  // No extra view-defining keys should be set that this view doesn't declare
  const extra = VIEW_DEFINING_KEYS.filter(k => !viewParams[k] && searchParams.get(k))
  return extra.length === 0
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
