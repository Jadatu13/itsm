import { useEffect, useState, useRef, useCallback, Fragment } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import PageHeader from '../components/PageHeader'
import { StatusBadge, PriorityBadge, CategoryBadge, SourceBadge, CATEGORY_OPTIONS, SOURCE_OPTIONS } from '../components/Badge'
import Modal from '../components/Modal'
import ConfirmModal from '../components/ConfirmModal'
import ContactSelect from '../components/ContactSelect'
import RichTextEditor from '../components/RichTextEditor'
import { formatDate } from '../utils/format'
import { apiFetch } from '../utils/api'
import { sanitizeEmailHtml } from '../utils/sanitizeHtml'
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
  const [showMerge, setShowMerge] = useState(false)
  const [draftingAi, setDraftingAi] = useState(false)
  const [aiError, setAiError]       = useState(null)
  const [pendingFiles, setPendingFiles] = useState([])
  const [dtToken, setDtToken] = useState('')

  const isFirstLoad  = useRef(true)
  const repliesEndRef = useRef(null)
  const editorRef = useRef(null)
  const fileInputRef = useRef(null)

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
    // Mint a short-lived, ticket-scoped download token for attachment URLs
    // (so the session JWT is never placed in a URL).
    apiFetch(`/api/attachments/ticket/${id}/token`)
      .then(r => (r.ok ? r.json() : { token: '' }))
      .then(d => setDtToken(d.token || ''))
      .catch(() => setDtToken(''))
  }, [id])

  // Build an attachment URL using the ticket-scoped download token.
  const attachmentUrl = attId => `/api/attachments/${attId}?dt=${encodeURIComponent(dtToken)}`
  // Append the download token to inline <img src="/api/attachments/N"> in email bodies.
  const withTokenisedAttachments = html =>
    sanitizeEmailHtml(html).replace(
      /(\/api\/attachments\/\d+)(?![?\w])/g,
      `$1?dt=${encodeURIComponent(dtToken)}`
    )

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

    let res
    if (pendingFiles.length > 0) {
      const fd = new FormData()
      fd.append('body', body)
      fd.append('is_agent_reply', 'true')
      fd.append('is_internal', isInternal ? 'true' : 'false')
      pendingFiles.forEach(f => fd.append('files', f))
      const token = localStorage.getItem('token') || sessionStorage.getItem('token')
      res = await fetch(`/api/tickets/${id}/replies`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      })
    } else {
      res = await apiFetch(`/api/tickets/${id}/replies`, {
        method: 'POST',
        body: JSON.stringify({ body, is_agent_reply: true, is_internal: isInternal }),
      })
    }

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
    setPendingFiles([])
    const updated = await apiFetch(`/api/tickets/${id}/replies`).then(r => r.json())
    setReplies(updated)
    setTicket(t => ({ ...t, updated_at: new Date().toISOString() }))
    setSending(false)
  }

  async function draftWithAi() {
    setDraftingAi(true)
    setAiError(null)
    try {
      const res = await apiFetch('/api/ai/draft-reply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticket_id: id }),
      })
      const d = await res.json()
      if (!res.ok) {
        setAiError(d.error || 'AI draft failed.')
      } else {
        editorRef.current?.insertHTMLContent(d.html)
      }
    } catch {
      setAiError('Failed to reach the server.')
    }
    setDraftingAi(false)
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
            <button className={styles.btnMerge} onClick={() => setShowMerge(true)}>Merge Ticket</button>
            <button className={styles.btnEdit} onClick={() => setShowEdit(true)}>Edit Ticket</button>
            <button className={styles.btnDelete} onClick={() => setConfirmDelete(true)}>Delete</button>
          </div>
        }
      />
      <div className={styles.layout}>
        {/* ── Left column ── */}
        <div className={styles.left}>
          <h2 className={styles.subject}>{ticket.subject}</h2>
          <div className={styles.description} dangerouslySetInnerHTML={{ __html: withTokenisedAttachments(ticket.description) }} />

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
                <div className={styles.bubbleBody} dangerouslySetInnerHTML={{ __html: withTokenisedAttachments(r.body) }} />
                {r.attachments?.length > 0 && (
                  <div className={styles.attachmentList}>
                    {r.attachments.map(att => (
                      <a key={att.id} href={attachmentUrl(att.id)} target="_blank" rel="noopener noreferrer" className={styles.attachmentLink}>
                        📎 {att.original_name}
                        <span className={styles.attachmentSize}>{att.size_bytes ? ` (${Math.round(att.size_bytes / 1024)}KB)` : ''}</span>
                      </a>
                    ))}
                  </div>
                )}
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
                <button type="button" className={styles.cannedBtn} onClick={() => fileInputRef.current?.click()} title="Attach files">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>
                  </svg>
                  Attach
                </button>
                <input ref={fileInputRef} type="file" multiple style={{ display: 'none' }}
                  onChange={e => setPendingFiles(prev => [...prev, ...Array.from(e.target.files)])}
                />
                <button type="button" className={styles.aiBtn} onClick={draftWithAi} disabled={draftingAi} title="Draft a reply using AI">
                  {draftingAi
                    ? <><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg> Drafting…</>
                    : <><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg> Draft with AI</>
                  }
                </button>
              </div>

              <RichTextEditor
                value={replyBody}
                onChange={setReplyBody}
                placeholder={isInternal ? 'Add a private note (not visible to the contact)…' : 'Write a reply…'}
                internalMode={isInternal}
                ref={editorRef}
              />
              {pendingFiles.length > 0 && (
                <div className={styles.pendingFiles}>
                  {pendingFiles.map((f, i) => (
                    <span key={i} className={styles.fileChip}>
                      📎 {f.name}
                      <button type="button" onClick={() => setPendingFiles(prev => prev.filter((_, j) => j !== i))}>✕</button>
                    </span>
                  ))}
                </div>
              )}
              {replyError && <div className={styles.replyError}>{replyError}</div>}
              {aiError && <div className={styles.replyError}>✕ {aiError}</div>}
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

          {/* ── Custom Fields panel ──────────────────────────────────────────── */}
          <CustomFieldsPanel ticketId={id} />

          {/* ── Time Tracking panel ──────────────────────────────────────────── */}
          <TimeTrackingPanel ticketId={id} />
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

      {showMerge && (
        <MergeTicketModal
          ticket={ticket}
          onClose={() => setShowMerge(false)}
          onMerged={targetId => { setShowMerge(false); navigate(`/tickets/${targetId}`) }}
        />
      )}
    </div>
  )
}

// ─── Merge ticket modal ───────────────────────────────────────────────────────

function MergeTicketModal({ ticket, onClose, onMerged }) {
  const [search, setSearch] = useState('')
  const [results, setResults] = useState([])
  const [selected, setSelected] = useState(null)
  const [merging, setMerging] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!search.trim()) { setResults([]); return }
    const t = setTimeout(() => {
      apiFetch(`/api/tickets?search=${encodeURIComponent(search)}`)
        .then(r => r.json())
        .then(d => {
          const list = Array.isArray(d) ? d : (Array.isArray(d.tickets) ? d.tickets : [])
          setResults(list.filter(t => String(t.id) !== String(ticket.id)))
        })
        .catch(() => {})
    }, 250)
    return () => clearTimeout(t)
  }, [search])

  async function handleMerge() {
    if (!selected) return
    setMerging(true)
    setError(null)
    const res = await apiFetch(`/api/tickets/${ticket.id}/merge`, {
      method: 'POST',
      body: JSON.stringify({ target_id: selected.id }),
    })
    const data = await res.json()
    if (!res.ok) { setError(data.error); setMerging(false); return }
    onMerged(selected.id)
  }

  return (
    <Modal title="Merge Ticket" onClose={onClose}>
      <div className={styles.mergeModal}>
        <p className={styles.mergeInfo}>
          All replies from <strong>{ticket.reference}</strong> will be moved into the selected ticket, then this ticket will be closed and deleted.
        </p>
        <div className={formStyles.field}>
          <label className={formStyles.label}>Search for target ticket</label>
          <input
            className={formStyles.input}
            placeholder="Search by reference or subject…"
            value={search}
            autoFocus
            onChange={e => { setSearch(e.target.value); setSelected(null) }}
          />
        </div>
        {results.length > 0 && !selected && (
          <div className={styles.mergeResults}>
            {results.map(t => (
              <div key={t.id} className={styles.mergeResult} onClick={() => setSelected(t)}>
                <div className={styles.mergeResultName}>{t.reference} — {t.subject}</div>
                <div className={styles.mergeResultMeta}>{t.contact_name ? `${t.contact_name} · ` : ''}{t.status}</div>
              </div>
            ))}
          </div>
        )}
        {selected && (
          <div className={styles.mergeSelected}>
            <div className={styles.mergeSelectedLabel}>Merging into:</div>
            <div className={styles.mergeResult} style={{ cursor: 'default' }}>
              <div className={styles.mergeResultName}>{selected.reference} — {selected.subject}</div>
              <div className={styles.mergeResultMeta}>{selected.contact_name ? `${selected.contact_name} · ` : ''}{selected.status}</div>
            </div>
            <button type="button" className={styles.mergeChange} onClick={() => setSelected(null)}>Change</button>
          </div>
        )}
        {error && <div className={formStyles.error} style={{ marginTop: 4 }}>{error}</div>}
        <div className={formStyles.actions}>
          <button type="button" className={formStyles.btnSecondary} onClick={onClose}>Cancel</button>
          <button type="button" className={styles.btnMergeConfirm} disabled={!selected || merging} onClick={handleMerge}>
            {merging ? 'Merging…' : 'Merge Tickets'}
          </button>
        </div>
      </div>
    </Modal>
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
  const filtered = items.filter(a =>
    a.title.toLowerCase().includes(search.toLowerCase()) ||
    (a.excerpt || '').toLowerCase().includes(search.toLowerCase()) ||
    (a.folder_name || '').toLowerCase().includes(search.toLowerCase())
  )

  function handleSelect(article) {
    const portalUrl = `${window.location.origin}/portal/kb/${article.id}`
    onSelect(`<a href="${portalUrl}">${article.title}</a>`)
  }

  return (
    <Modal title="Insert KB Article" onClose={onClose}>
      <div className={styles.cannedPicker}>
        <input className={formStyles.input} placeholder="Search articles…" value={search} autoFocus onChange={e => setSearch(e.target.value)} />
        {filtered.length === 0 && <div className={styles.cannedEmpty}>No articles found{search ? ` matching "${search}"` : ''}.</div>}
        <div className={styles.cannedList}>
          {filtered.map(article => (
            <div key={article.id} className={styles.kbItem} onClick={() => handleSelect(article)}>
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

// ─── Custom Fields panel ──────────────────────────────────────────────────────

function CustomFieldsPanel({ ticketId }) {
  const [fields, setFields]     = useState([])   // field definitions
  const [values, setValues]     = useState({})   // { field_key: value }
  const [dirty, setDirty]       = useState({})   // { field_key: true } — which fields have unsaved edits
  const [saving, setSaving]     = useState(false)
  const [msg, setMsg]           = useState(null)

  useEffect(() => {
    apiFetch('/api/custom-fields')
      .then(r => r.json())
      .then(d => { if (Array.isArray(d)) setFields(d) })
      .catch(() => {})

    apiFetch(`/api/tickets/${ticketId}/custom-fields`)
      .then(r => r.json())
      .then(d => {
        if (Array.isArray(d)) {
          const v = {}
          d.forEach(row => { v[row.field_key] = row.value ?? '' })
          setValues(v)
        }
      })
      .catch(() => {})
  }, [ticketId])

  function handleChange(key, val) {
    setValues(prev => ({ ...prev, [key]: val }))
    setDirty(prev => ({ ...prev, [key]: true }))
    setMsg(null)
  }

  async function handleSave() {
    const payload = {}
    Object.keys(dirty).forEach(k => { payload[k] = values[k] })
    if (!Object.keys(payload).length) return
    setSaving(true)
    setMsg(null)
    try {
      const res = await apiFetch(`/api/tickets/${ticketId}/custom-fields`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (res.ok) {
        setDirty({})
        setMsg({ ok: true, text: 'Saved.' })
      } else {
        setMsg({ ok: false, text: 'Failed to save.' })
      }
    } catch {
      setMsg({ ok: false, text: 'Something went wrong.' })
    }
    setSaving(false)
  }

  if (!fields.length) return null

  const hasDirty = Object.keys(dirty).length > 0

  return (
    <div className={styles.panel} style={{ marginTop: 12 }}>
      <div className={styles.panelSectionHead}>
        <span className={styles.panelSectionTitle}>Custom Fields</span>
        {hasDirty && (
          <button className={styles.panelSaveBtn} onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        )}
      </div>
      {fields.map(field => (
        <div key={field.field_key} className={styles.customFieldRow}>
          <span className={styles.panelLabel}>{field.label}{field.required && <span style={{ color: 'var(--priority-high)' }}> *</span>}</span>
          <CustomFieldInput
            field={field}
            value={values[field.field_key] ?? ''}
            onChange={val => handleChange(field.field_key, val)}
          />
        </div>
      ))}
      {msg && (
        <span style={{ fontSize: 12, color: msg.ok ? '#15803d' : 'var(--priority-high)' }}>
          {msg.ok ? '✓ ' : '✕ '}{msg.text}
        </span>
      )}
    </div>
  )
}

function CustomFieldInput({ field, value, onChange }) {
  const cls = styles.customFieldInput
  if (field.field_type === 'checkbox') {
    return (
      <input
        type="checkbox"
        checked={value === 'true' || value === true}
        onChange={e => onChange(e.target.checked ? 'true' : 'false')}
        className={styles.customFieldCheck}
      />
    )
  }
  if (field.field_type === 'select') {
    const opts = Array.isArray(field.options) ? field.options : []
    return (
      <select className={cls} value={value} onChange={e => onChange(e.target.value)}>
        <option value="">— Select —</option>
        {opts.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    )
  }
  if (field.field_type === 'date') {
    return <input type="date" className={cls} value={value} onChange={e => onChange(e.target.value)} />
  }
  if (field.field_type === 'number') {
    return <input type="number" className={cls} value={value} onChange={e => onChange(e.target.value)} />
  }
  return <input type="text" className={cls} value={value} onChange={e => onChange(e.target.value)} />
}

// ─── Time Tracking panel ──────────────────────────────────────────────────────

function TimeTrackingPanel({ ticketId }) {
  const [data, setData]       = useState({ entries: [], total_minutes: 0 })
  const [showForm, setShowForm] = useState(false)
  const [minutes, setMinutes]  = useState('')
  const [note, setNote]        = useState('')
  const [logging, setLogging]  = useState(false)
  const [err, setErr]          = useState(null)

  function load() {
    apiFetch(`/api/tickets/${ticketId}/time`)
      .then(r => r.json())
      .then(d => { if (d.entries) setData(d) })
      .catch(() => {})
  }

  useEffect(() => { load() }, [ticketId])

  async function handleLog(e) {
    e.preventDefault()
    const mins = parseInt(minutes)
    if (!mins || mins < 1) { setErr('Enter a positive number of minutes.'); return }
    setLogging(true)
    setErr(null)
    try {
      const res = await apiFetch(`/api/tickets/${ticketId}/time`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ minutes: mins, note: note.trim() || null }),
      })
      if (!res.ok) { const d = await res.json(); setErr(d.error || 'Failed'); setLogging(false); return }
      setMinutes('')
      setNote('')
      setShowForm(false)
      load()
    } catch {
      setErr('Something went wrong.')
    }
    setLogging(false)
  }

  function fmtMins(m) {
    if (!m) return '0m'
    const h = Math.floor(m / 60)
    const rem = m % 60
    return h > 0 ? `${h}h ${rem}m` : `${rem}m`
  }

  return (
    <div className={styles.panel} style={{ marginTop: 12 }}>
      <div className={styles.panelSectionHead}>
        <span className={styles.panelSectionTitle}>Time Logged</span>
        <span className={styles.timeTotal}>{fmtMins(data.total_minutes)}</span>
        <button className={styles.logTimeBtn} onClick={() => setShowForm(v => !v)}>
          {showForm ? 'Cancel' : '+ Log Time'}
        </button>
      </div>

      {showForm && (
        <form className={styles.logTimeForm} onSubmit={handleLog}>
          <input
            type="number"
            className={styles.logTimeInput}
            placeholder="Minutes"
            min="1"
            value={minutes}
            onChange={e => setMinutes(e.target.value)}
            autoFocus
          />
          <input
            type="text"
            className={styles.logTimeInput}
            placeholder="Note (optional)"
            value={note}
            onChange={e => setNote(e.target.value)}
          />
          {err && <span className={styles.logTimeErr}>{err}</span>}
          <button type="submit" className={styles.logTimeSave} disabled={logging}>
            {logging ? 'Saving…' : 'Save'}
          </button>
        </form>
      )}

      {data.entries.length === 0 && !showForm && (
        <div className={styles.timeEmpty}>No time logged yet.</div>
      )}

      {data.entries.map(entry => (
        <div key={entry.id} className={styles.timeEntry}>
          <span className={styles.timeEntryMins}>{fmtMins(entry.minutes)}</span>
          <span className={styles.timeEntryAgent}>{entry.agent_name || 'Unknown'}</span>
          {entry.note && <span className={styles.timeEntryNote}>{entry.note}</span>}
          <span className={styles.timeEntryDate}>{formatDate(entry.logged_at)}</span>
        </div>
      ))}
    </div>
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
