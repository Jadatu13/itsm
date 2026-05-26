import { useEffect, useState, useRef, useCallback } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import PageHeader from '../components/PageHeader'
import { StatusBadge, PriorityBadge, CategoryBadge, SourceBadge, CATEGORY_OPTIONS, SOURCE_OPTIONS } from '../components/Badge'
import Modal from '../components/Modal'
import ConfirmModal from '../components/ConfirmModal'
import ContactSelect from '../components/ContactSelect'
import RichTextEditor from '../components/RichTextEditor'
import { formatDate } from '../utils/format'
import { apiFetch } from '../utils/api'
import { SlaChip } from './Dashboard'
import formStyles from '../styles/forms.module.css'
import styles from './TicketDetail.module.css'

export default function TicketDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [ticket, setTicket]     = useState(null)
  const [replies, setReplies]   = useState([])
  const [agents, setAgents]     = useState([])
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState(null)
  const [replyBody, setReplyBody] = useState('')
  const [sending, setSending]   = useState(false)
  const [replyError, setReplyError] = useState(null)
  const [isInternal, setIsInternal] = useState(false)
  const [showEdit, setShowEdit] = useState(false)
  const [showCanned, setShowCanned] = useState(false)
  const [cannedList, setCannedList] = useState([])
  const [showKB, setShowKB] = useState(false)
  const [kbList, setKbList] = useState([])
  const [confirmDelete, setConfirmDelete] = useState(false)

  const isFirstLoad  = useRef(true)
  const repliesEndRef = useRef(null)
  const editorRef = useRef(null)

  function load() {
    return Promise.all([
      apiFetch(`/api/tickets/${id}`).then(r => r.json()),
      apiFetch(`/api/tickets/${id}/replies`).then(r => r.json()),
    ]).then(([t, r]) => {
      if (t.error) throw new Error(t.error)
      setTicket(t)
      setReplies(r)
      setLoading(false)
      isFirstLoad.current = true
    }).catch(err => { setError(err.message); setLoading(false) })
  }

  useEffect(() => {
    load()
    apiFetch('/api/agents').then(r => r.json()).then(d => { if (Array.isArray(d)) setAgents(d) })
  }, [id])

  useEffect(() => {
    if (isFirstLoad.current) { isFirstLoad.current = false; return }
    repliesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [replies])

  async function handleStatusChange(e) {
    const status = e.target.value
    const res = await apiFetch(`/api/tickets/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    })
    if (res.ok) {
      const updated = await res.json()
      setTicket(t => ({ ...t, status: updated.status, updated_at: updated.updated_at }))
    }
  }

  async function handleAssignChange(e) {
    const val = e.target.value
    const res = await apiFetch(`/api/tickets/${id}/assign`, {
      method: 'PATCH',
      body: JSON.stringify({ assigned_to: val || null }),
    })
    if (res.ok) {
      const d = await res.json()
      setTicket(t => ({ ...t, assigned_to: d.assigned_to, assigned_name: d.assigned_name }))
    }
  }

  async function submitReply(body, closeAfter = false) {
    setSending(true)
    setReplyError(null)

    const res = await apiFetch(`/api/tickets/${id}/replies`, {
      method: 'POST',
      body: JSON.stringify({ body, is_agent_reply: true, is_internal: isInternal }),
    })

    if (!res.ok) {
      const d = await res.json()
      setReplyError(d.error)
      setSending(false)
      return
    }

    if (closeAfter) {
      await apiFetch(`/api/tickets/${id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'resolved' }),
      }).then(r => r.json()).then(updated => {
        setTicket(t => ({ ...t, status: 'resolved', updated_at: updated.updated_at }))
      })
    }

    setReplyBody('')   // triggers editor clear via useEffect in RichTextEditor
    const updated = await apiFetch(`/api/tickets/${id}/replies`).then(r => r.json())
    setReplies(updated)
    setTicket(t => ({ ...t, updated_at: new Date().toISOString() }))
    setSending(false)
  }

  async function openCanned() {
    if (!cannedList.length) {
      const d = await apiFetch('/api/canned-responses').then(r => r.json())
      if (Array.isArray(d)) setCannedList(d)
    }
    setShowCanned(true)
  }

  async function openKB() {
    if (!kbList.length) {
      const d = await apiFetch('/api/kb?published=true').then(r => r.json())
      if (Array.isArray(d)) setKbList(d.filter(a => a.published))
    }
    setShowKB(true)
  }

  if (loading) return <div className={styles.page}><PageHeader title="Ticket" /><div className={styles.state}>Loading…</div></div>
  if (error)   return <div className={styles.page}><PageHeader title="Ticket" /><div className={`${styles.state} ${styles.err}`}>{error}</div></div>

  const isResolved = ticket.status === 'resolved'

  return (
    <div className={styles.page}>
      <PageHeader
        title={ticket.reference}
        action={
          <div style={{ display: 'flex', gap: 8 }}>
            <button className={styles.btnEdit} onClick={() => setShowEdit(true)}>Edit Ticket</button>
            <button className={styles.btnDelete} onClick={() => setConfirmDelete(true)}>Delete</button>
          </div>
        }
      />
      <div className={styles.layout}>
        {/* ── Left column ── */}
        <div className={styles.left}>
          <h2 className={styles.subject}>{ticket.subject}</h2>
          <div className={styles.description}>{ticket.description}</div>

          <div className={styles.thread}>
            <h3 className={styles.threadTitle}>Conversation</h3>
            {replies.length === 0 && <div className={styles.noReplies}>No replies yet.</div>}
            {replies.map(r => (
              <div key={r.id} className={`${styles.bubble} ${r.is_internal ? styles.internal : r.is_agent_reply ? styles.agent : styles.contact}`}>
                <div className={styles.bubbleMeta}>
                  <span className={styles.sender}>{r.sender_name}</span>
                  {r.is_internal && <span className={styles.noteTag}>Internal Note</span>}
                  <span className={styles.ts}>{formatDate(r.created_at)}</span>
                </div>
                <div className={styles.bubbleBody} dangerouslySetInnerHTML={{ __html: r.body }} />
              </div>
            ))}
            <div ref={repliesEndRef} />
          </div>

          {isResolved ? (
            <div className={styles.resolvedBanner}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M20 6L9 17l-5-5"/></svg>
              This ticket is resolved. Change the status to reopen it.
            </div>
          ) : (
            <form className={`${styles.replyForm} ${isInternal ? styles.replyFormInternal : ''}`} onSubmit={e => { e.preventDefault(); if (replyBody.trim()) submitReply(replyBody, false) }}>
              <div className={styles.replyToggle}>
                <button type="button" className={`${styles.toggleBtn} ${!isInternal ? styles.toggleActive : ''}`} onClick={() => setIsInternal(false)}>
                  Reply to Contact
                </button>
                <button type="button" className={`${styles.toggleBtn} ${isInternal ? styles.toggleActiveNote : ''}`} onClick={() => setIsInternal(true)}>
                  🔒 Internal Note
                </button>
                <button type="button" className={styles.cannedBtn} onClick={openCanned} title="Insert canned response">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
                  Templates
                </button>
                <button type="button" className={styles.cannedBtn} onClick={openKB} title="Link a knowledge base article">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>
                  KB Article
                </button>
              </div>

              <RichTextEditor
                value={replyBody}
                onChange={setReplyBody}
                placeholder={isInternal ? 'Add a private note (not visible to the contact)…' : 'Write a reply…'}
                internalMode={isInternal}
                ref={editorRef}
              />
              {replyError && <div className={styles.replyError}>{replyError}</div>}
              <div className={styles.replyActions}>
                {!isInternal && (
                  <button type="button" className={styles.sendCloseBtn} disabled={sending || !replyBody.trim()}
                    onClick={e => { e.preventDefault(); if (replyBody.trim()) submitReply(replyBody, true) }}
                    title="Send this reply and mark the ticket as resolved">
                    Send &amp; Close
                  </button>
                )}
                <button type="submit" className={isInternal ? styles.noteBtn : styles.sendBtn} disabled={sending || !replyBody.trim()}>
                  {sending ? 'Saving…' : isInternal ? 'Add Note' : 'Send Reply'}
                </button>
              </div>
            </form>
          )}
        </div>

        {/* ── Right column ── */}
        <div className={styles.right}>
          <div className={styles.panel}>
            <div className={styles.panelRow}>
              <span className={styles.panelLabel}>Reference</span>
              <span className={styles.panelRef}>{ticket.reference}</span>
            </div>
            <div className={styles.panelRow}>
              <span className={styles.panelLabel}>Status</span>
              <select className={styles.statusSelect} value={ticket.status} onChange={handleStatusChange}>
                <option value="open">Open</option>
                <option value="in_progress">In Progress</option>
                <option value="on_hold">On Hold</option>
                <option value="resolved">Resolved</option>
              </select>
            </div>
            <div className={styles.panelRow}>
              <span className={styles.panelLabel}>Assigned To</span>
              <select className={styles.statusSelect} value={ticket.assigned_to ?? ''} onChange={handleAssignChange}>
                <option value="">— Unassigned —</option>
                {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
            <div className={styles.panelRow}>
              <span className={styles.panelLabel}>Priority</span>
              <PriorityBadge priority={ticket.priority} />
            </div>
            {ticket.category && (
              <div className={styles.panelRow}>
                <span className={styles.panelLabel}>Category</span>
                <CategoryBadge category={ticket.category} />
              </div>
            )}
            <div className={styles.panelRow}>
              <span className={styles.panelLabel}>Source</span>
              <SourceBadge source={ticket.source || 'manual'} />
            </div>
            {ticket.sla_due_at && (
              <div className={styles.panelRow}>
                <span className={styles.panelLabel}>SLA</span>
                <SlaChip slaAt={ticket.sla_due_at} />
              </div>
            )}
            <div className={styles.divider} />
            <div className={styles.panelRow}>
              <span className={styles.panelLabel}>Contact</span>
              <Link to={`/contacts/${ticket.contact_id}`} className={styles.panelLink}>{ticket.contact_name}</Link>
            </div>
            <div className={styles.panelRow}>
              <span className={styles.panelLabel}>Email</span>
              <span className={styles.panelValue}>{ticket.contact_email}</span>
            </div>
            {ticket.organisation_name && (
              <div className={styles.panelRow}>
                <span className={styles.panelLabel}>Organisation</span>
                <span className={styles.panelValue}>{ticket.organisation_name}</span>
              </div>
            )}
            <div className={styles.divider} />
            <div className={styles.panelRow}>
              <span className={styles.panelLabel}>Created</span>
              <span className={styles.panelValue}>{formatDate(ticket.created_at)}</span>
            </div>
            <div className={styles.panelRow}>
              <span className={styles.panelLabel}>Updated</span>
              <span className={styles.panelValue}>{formatDate(ticket.updated_at)}</span>
            </div>
          </div>
        </div>
      </div>

      {showEdit && (
        <EditTicketModal ticket={ticket} onClose={() => setShowEdit(false)} onSaved={updated => { setTicket(updated); setShowEdit(false) }} />
      )}

      {showCanned && (
        <CannedPicker
          items={cannedList}
          onSelect={html => {
            editorRef.current?.insertHTMLContent(html)
            setShowCanned(false)
          }}
          onClose={() => setShowCanned(false)}
        />
      )}

      {showKB && (
        <KBPicker
          items={kbList}
          onSelect={html => {
            editorRef.current?.insertHTMLContent(html)
            setShowKB(false)
          }}
          onClose={() => setShowKB(false)}
        />
      )}

      {confirmDelete && (
        <ConfirmModal
          title="Delete ticket?"
          message={`This will permanently delete ${ticket.reference} and all its replies. This cannot be undone.`}
          confirmLabel="Delete Ticket"
          onConfirm={async () => {
            await apiFetch(`/api/tickets/${id}`, { method: 'DELETE' })
            navigate('/tickets')
          }}
          onClose={() => setConfirmDelete(false)}
        />
      )}
    </div>
  )
}

// ─── Canned response picker ───────────────────────────────────────────────────

function plainToHtml(text) {
  return text.split(/\n\n+/).map(para => `<p>${para.replace(/\n/g, '<br>')}</p>`).join('')
}

function CannedPicker({ items, onSelect, onClose }) {
  const [search, setSearch] = useState('')
  const filtered = items.filter(i => i.title.toLowerCase().includes(search.toLowerCase()) || i.body.toLowerCase().includes(search.toLowerCase()))
  return (
    <Modal title="Insert Template" onClose={onClose}>
      <div className={styles.cannedPicker}>
        <input className={formStyles.input} placeholder="Search templates…" value={search} autoFocus onChange={e => setSearch(e.target.value)} />
        {filtered.length === 0 && <div className={styles.cannedEmpty}>No templates found.</div>}
        <div className={styles.cannedList}>
          {filtered.map(item => (
            <div key={item.id} className={styles.cannedItem} onClick={() => onSelect(plainToHtml(item.body))}>
              <div className={styles.cannedTitle}>{item.title}</div>
              <div className={styles.cannedPreview}>{item.body}</div>
            </div>
          ))}
        </div>
      </div>
    </Modal>
  )
}

// ─── KB article picker ────────────────────────────────────────────────────────

function KBPicker({ items, onSelect, onClose }) {
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(null)
  const filtered = items.filter(a =>
    a.title.toLowerCase().includes(search.toLowerCase()) ||
    (a.excerpt || '').toLowerCase().includes(search.toLowerCase()) ||
    (a.folder_name || '').toLowerCase().includes(search.toLowerCase())
  )

  async function handleSelect(article) {
    setLoading(article.id)
    const full = await apiFetch(`/api/kb/${article.id}`).then(r => r.json()).catch(() => null)
    const portalUrl = `${window.location.origin}/portal/kb/${article.id}`
    let html = `<h2>📖 ${article.title}</h2>`
    if (full?.body) {
      html += full.body
    } else if (article.excerpt) {
      html += `<p>${article.excerpt.trim()}</p>`
    }
    html += `<p><a href="${portalUrl}">Read the full article →</a></p>`
    onSelect(html)
  }

  return (
    <Modal title="Insert KB Article" onClose={onClose}>
      <div className={styles.cannedPicker}>
        <input className={formStyles.input} placeholder="Search articles…" value={search} autoFocus onChange={e => setSearch(e.target.value)} />
        {filtered.length === 0 && <div className={styles.cannedEmpty}>No articles found{search ? ` matching "${search}"` : ''}.</div>}
        <div className={styles.cannedList}>
          {filtered.map(article => (
            <div key={article.id} className={`${styles.kbItem} ${loading === article.id ? styles.kbItemLoading : ''}`}
              onClick={() => !loading && handleSelect(article)}>
              <div className={styles.kbItemHeader}>
                <span className={styles.cannedTitle}>{article.title}</span>
                {article.folder_name && (
                  <span className={styles.kbFolder}>{article.folder_icon || '📁'} {article.folder_name}</span>
                )}
              </div>
              {article.excerpt && (
                <div className={styles.cannedPreview}>{article.excerpt}</div>
              )}
            </div>
          ))}
        </div>
      </div>
    </Modal>
  )
}

// ─── Edit Ticket Modal ────────────────────────────────────────────────────────

function EditTicketModal({ ticket, onClose, onSaved }) {
  const [contacts, setContacts] = useState([])
  const [form, setForm] = useState({
    subject:     ticket.subject,
    description: ticket.description,
    contact_id:  String(ticket.contact_id),
    priority:    ticket.priority,
    category:    ticket.category ?? '',
    source:      ticket.source   ?? 'manual',
  })
  const [errors, setErrors]         = useState({})
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState(null)

  useEffect(() => {
    apiFetch('/api/contacts').then(r => r.json()).then(d => { if (Array.isArray(d)) setContacts(d) }).catch(() => {})
  }, [])

  function validate() {
    const e = {}
    if (!form.subject.trim())     e.subject     = 'Required'
    if (!form.description.trim()) e.description = 'Required'
    if (!form.contact_id)         e.contact_id  = 'Required'
    setErrors(e)
    return !Object.keys(e).length
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!validate()) return
    setSubmitting(true)
    setSubmitError(null)
    try {
      const res = await apiFetch(`/api/tickets/${ticket.id}`, {
        method: 'PUT',
        body: JSON.stringify({ ...form, category: form.category || null }),
      })
      if (!res.ok) { const d = await res.json().catch(() => ({})); setSubmitError(d.error || 'Failed to update ticket'); setSubmitting(false); return }
      onSaved(await res.json())
    } catch {
      setSubmitError('Something went wrong. Please try again.')
      setSubmitting(false)
    }
  }

  return (
    <Modal title="Edit Ticket" onClose={onClose}>
      <form className={formStyles.form} onSubmit={handleSubmit}>
        <div className={formStyles.field}>
          <label className={formStyles.label}>Contact <span className={formStyles.required}>*</span></label>
          <ContactSelect contacts={contacts} value={form.contact_id} onChange={id => setForm(f => ({ ...f, contact_id: id }))} />
          {errors.contact_id && <span className={formStyles.error}>{errors.contact_id}</span>}
        </div>
        <div className={formStyles.field}>
          <label className={formStyles.label}>Subject <span className={formStyles.required}>*</span></label>
          <input className={formStyles.input} value={form.subject} autoFocus onChange={e => setForm(f => ({ ...f, subject: e.target.value }))} />
          {errors.subject && <span className={formStyles.error}>{errors.subject}</span>}
        </div>
        <div className={formStyles.field}>
          <label className={formStyles.label}>Description <span className={formStyles.required}>*</span></label>
          <textarea className={formStyles.textarea} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
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
          <button type="submit" className={formStyles.btnPrimary} disabled={submitting}>{submitting ? 'Saving…' : 'Save Changes'}</button>
        </div>
      </form>
    </Modal>
  )
}
