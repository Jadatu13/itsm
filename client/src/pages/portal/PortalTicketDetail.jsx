import { useEffect, useState, useRef } from 'react'
import { useParams, Link } from 'react-router-dom'
import { portalFetch } from '../../utils/portalApi'
import RichTextEditor from '../../components/RichTextEditor'
import styles from './Portal.module.css'
import { sanitizeEmailHtml } from '../../utils/sanitizeHtml'

function statusBadgeClass(status) {
  switch (status) {
    case 'open': return styles.badgeOpen
    case 'in_progress': return styles.badgeInProgress
    case 'on_hold': return styles.badgeOnHold
    case 'resolved': return styles.badgeResolved
    default: return styles.badge
  }
}

function formatDate(d) {
  if (!d) return '—'
  return new Date(d).toLocaleString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

export default function PortalTicketDetail() {
  const { id } = useParams()
  const [ticket, setTicket] = useState(null)
  const [replies, setReplies] = useState([])
  const [loading, setLoading] = useState(true)
  const [replyBody, setReplyBody] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [pendingFiles, setPendingFiles] = useState([])
  const bottomRef = useRef(null)
  const editorRef = useRef(null)
  const fileInputRef = useRef(null)

  const contact = (() => {
    try { return JSON.parse(localStorage.getItem('portal_contact') || 'null') } catch { return null }
  })()

  useEffect(() => {
    portalFetch(`/api/portal/tickets/${id}`)
      .then(r => r.json())
      .then(data => {
        setTicket(data)
        setReplies(data.replies || [])
      })
      .finally(() => setLoading(false))
  }, [id])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [replies])

  async function handleReply(e) {
    e.preventDefault()
    if (!replyBody.trim() || replyBody === '<p></p>') return
    setSending(true)
    setError('')
    try {
      const token = sessionStorage.getItem('portal_preview_token') || localStorage.getItem('portal_token')
      let res
      if (pendingFiles.length > 0) {
        const fd = new FormData()
        fd.append('body', replyBody)
        pendingFiles.forEach(f => fd.append('files', f))
        res = await fetch(`/api/portal/tickets/${id}/reply`, {
          method: 'POST',
          headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          body: fd,
        })
      } else {
        res = await portalFetch(`/api/portal/tickets/${id}/reply`, {
          method: 'POST',
          body: JSON.stringify({ body: replyBody }),
        })
      }
      const data = await res.json()
      if (!res.ok) { setError(data.error || 'Failed to send reply.'); return }
      setReplies(prev => [...prev, data])
      setReplyBody('')
      setPendingFiles([])
    } catch {
      setError('Failed to send reply.')
    } finally {
      setSending(false)
    }
  }

  if (loading) return <div className={styles.loadingState}>Loading…</div>
  if (!ticket) return <div className={styles.emptyState}>Ticket not found.</div>

  return (
    <div>
      <Link to="/portal/tickets" className={styles.backLink}>← Back to Tickets</Link>

      <div className={styles.detailLayout} style={{ marginTop: 20 }}>
        <div>
          <div className={`${styles.card} ${styles.detailHeader}`} style={{ marginBottom: 20 }}>
            <h1 className={styles.detailTitle}>{ticket.subject}</h1>
            <div className={styles.detailMeta}>
              <span style={{ fontFamily: 'monospace', fontSize: '0.85rem', color: 'var(--portal-text-muted)' }}>
                {ticket.reference}
              </span>
              <span className={`${styles.badge} ${statusBadgeClass(ticket.status)}`}>
                {ticket.status?.replace('_', ' ')}
              </span>
            </div>
          </div>

          <div className={styles.card} style={{ marginBottom: 20 }}>
            <p className={styles.sectionTitle}>Description</p>
            <div className={styles.descriptionBox} dangerouslySetInnerHTML={{ __html: sanitizeEmailHtml(ticket.description) }} />
          </div>

          <div className={`${styles.card} ${styles.conversationSection}`}>
            <p className={styles.conversationTitle}>Conversation</p>
            <div className={styles.messageList}>
              {replies.length === 0 && (
                <div className={styles.emptyState} style={{ padding: '16px 0' }}>
                  No replies yet.
                </div>
              )}
              {replies.map(r => {
                const isAgent = r.is_agent_reply
                return (
                  <div
                    key={r.id}
                    className={`${styles.messageBubble} ${isAgent ? styles.messageAgent : styles.messageContact}`}
                  >
                    <div className={styles.messageSender}>
                      {r.sender_name || (isAgent ? 'Support Agent' : 'You')}
                    </div>
                    <div dangerouslySetInnerHTML={{ __html: sanitizeEmailHtml(r.body) }} />
                    {r.attachments?.length > 0 && (
                      <div className={styles.portalAttachmentList}>
                        {r.attachments.map(att => (
                          <a key={att.id} href={`/api/attachments/${att.id}?token=${encodeURIComponent(localStorage.getItem('portal_token') || sessionStorage.getItem('portal_preview_token') || '')}`} target="_blank" rel="noopener noreferrer" className={styles.portalAttachmentLink}>
                            📎 {att.original_name}
                            <span className={styles.portalAttachmentSize}>{att.size_bytes ? ` (${Math.round(att.size_bytes / 1024)}KB)` : ''}</span>
                          </a>
                        ))}
                      </div>
                    )}
                    <div className={styles.messageTime}>{formatDate(r.created_at)}</div>
                  </div>
                )
              })}
              <div ref={bottomRef} />
            </div>

            {ticket.status !== 'resolved' && (
              <form onSubmit={handleReply} className={styles.replyForm} style={{ marginTop: 20 }}>
                <RichTextEditor
                  ref={editorRef}
                  value={replyBody}
                  onChange={setReplyBody}
                  placeholder="Write a reply…"
                />
                {pendingFiles.length > 0 && (
                  <div className={styles.portalPendingFiles}>
                    {pendingFiles.map((f, i) => (
                      <span key={i} className={styles.portalFileChip}>
                        📎 {f.name}
                        <button type="button" onClick={() => setPendingFiles(prev => prev.filter((_, j) => j !== i))}>✕</button>
                      </span>
                    ))}
                  </div>
                )}
                {error && <div className={styles.errorMsg}>{error}</div>}
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'flex-end' }}>
                  <button type="button" className={styles.portalAttachBtn} onClick={() => fileInputRef.current?.click()} title="Attach files">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>
                    </svg>
                    Attach
                  </button>
                  <input ref={fileInputRef} type="file" multiple style={{ display: 'none' }}
                    onChange={e => setPendingFiles(prev => [...prev, ...Array.from(e.target.files)])}
                  />
                  <button type="submit" className={styles.btnPrimarySmall}
                    disabled={sending || !replyBody.trim() || replyBody === '<p></p>'}>
                    {sending ? 'Sending…' : 'Send Reply'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>

        <div>
          <div className={styles.card}>
            <p className={styles.sectionTitle}>Details</p>
            <div className={styles.metaPanel}>
              <div className={styles.metaItem}>
                <span className={styles.metaLabel}>Status</span>
                <span className={`${styles.badge} ${statusBadgeClass(ticket.status)}`}>
                  {ticket.status?.replace('_', ' ')}
                </span>
              </div>
              <div className={styles.metaItem}>
                <span className={styles.metaLabel}>Priority</span>
                <span className={styles.metaValue} style={{ textTransform: 'capitalize' }}>
                  {ticket.priority}
                </span>
              </div>
              {ticket.assigned_name && (
                <div className={styles.metaItem}>
                  <span className={styles.metaLabel}>Assigned To</span>
                  <span className={styles.metaValue}>{ticket.assigned_name}</span>
                </div>
              )}
              <div className={styles.metaItem}>
                <span className={styles.metaLabel}>Created</span>
                <span className={styles.metaValue}>{formatDate(ticket.created_at)}</span>
              </div>
              {ticket.sla_due_at && (
                <div className={styles.metaItem}>
                  <span className={styles.metaLabel}>SLA Due</span>
                  <span className={styles.metaValue}>{formatDate(ticket.sla_due_at)}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
