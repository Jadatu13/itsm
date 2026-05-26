import { useEffect, useState } from 'react'
import { apiFetch } from '../utils/api'
import styles from './ApprovalQueue.module.css'

function formatDate(d) {
  if (!d) return '—'
  return new Date(d).toLocaleString('en-NZ', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

const STATUS_META = {
  pending:      { label: 'Pending Approval', color: '#F59E0B', bg: '#FEF3C7' },
  approved:     { label: 'Approved',         color: '#059669', bg: '#D1FAE5' },
  rejected:     { label: 'Rejected',         color: '#DC2626', bg: '#FEE2E2' },
  executing:    { label: 'Executing…',       color: '#6366F1', bg: '#EEF2FF' },
  completed:    { label: 'Completed',        color: '#059669', bg: '#D1FAE5' },
  failed:       { label: 'Failed',           color: '#DC2626', bg: '#FEE2E2' },
  not_required: { label: 'No Approval Needed', color: '#6B7280', bg: '#F3F4F6' },
}

function StatusBadge({ status }) {
  const m = STATUS_META[status] || STATUS_META.not_required
  return (
    <span className={styles.badge} style={{ background: m.bg, color: m.color }}>
      {m.label}
    </span>
  )
}

function LogViewer({ log }) {
  if (!log?.length) return null
  return (
    <div className={styles.logViewer}>
      {log.map((entry, i) => (
        <div key={i} className={`${styles.logEntry} ${styles[`logEntry_${entry.level}`] || ''}`}>
          <span className={styles.logTime}>{new Date(entry.time).toLocaleTimeString('en-NZ')}</span>
          <span className={styles.logMsg}>{entry.message}</span>
        </div>
      ))}
    </div>
  )
}

function RejectModal({ request, onClose, onConfirm }) {
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)

  async function submit() {
    setSaving(true)
    await onConfirm(request.id, reason)
    setSaving(false)
    onClose()
  }

  return (
    <div className={styles.overlay} onClick={e => e.target === e.currentTarget && onClose()}>
      <div className={styles.rejectModal}>
        <h3 className={styles.rejectTitle}>Reject Request</h3>
        <p className={styles.rejectSub}>
          Rejecting <strong>{request.form_name}</strong> from <strong>{request.contact_name}</strong>.
          The ticket will be marked as resolved.
        </p>
        <textarea
          className={styles.rejectReason}
          value={reason}
          onChange={e => setReason(e.target.value)}
          placeholder="Reason for rejection (optional — shown on ticket)"
          rows={4}
        />
        <div className={styles.rejectActions}>
          <button className={styles.btnSecondary} onClick={onClose}>Cancel</button>
          <button className={styles.btnReject} onClick={submit} disabled={saving}>
            {saving ? 'Rejecting…' : 'Confirm Rejection'}
          </button>
        </div>
      </div>
    </div>
  )
}

// Build a label-keyed map of field values from UUID-keyed raw values + form field definitions
function resolveFieldValues(rawValues, formFields) {
  if (!rawValues || typeof rawValues !== 'object') return []
  const fieldDefs = Array.isArray(formFields) ? formFields : []
  return Object.entries(rawValues)
    .filter(([, val]) => val !== '' && val !== null && val !== undefined)
    .map(([key, val]) => {
      const def = fieldDefs.find(f => f.id === key)
      return { label: def?.label || key, value: String(val) }
    })
}

function RequestCard({ request, onApprove, onReject, onRefresh }) {
  const [expanded, setExpanded] = useState(false)
  const [approving, setApproving] = useState(false)

  const resolvedFields = resolveFieldValues(request.field_values, request.form_fields)
  const automationAction = request.automation_action
  const hasAutomation = automationAction?.type && automationAction.type !== 'none'

  async function handleApprove() {
    setApproving(true)
    await onApprove(request.id)
    setApproving(false)
  }

  return (
    <div className={`${styles.card} ${request.approval_status === 'pending' ? styles.cardPending : ''}`}>
      <div className={styles.cardHeader}>
        <div className={styles.cardLeft}>
          <span className={styles.formIcon}>{request.form_icon || '📋'}</span>
          <div>
            <div className={styles.cardTitle}>{request.form_name}</div>
            <div className={styles.cardMeta}>
              <span className={styles.contactName}>{request.contact_name}</span>
              {request.contact_email && (
                <span className={styles.contactEmail}>{request.contact_email}</span>
              )}
              <span className={styles.submittedAt}>{formatDate(request.created_at)}</span>
            </div>
          </div>
        </div>
        <div className={styles.cardRight}>
          {request.ticket_reference && (
            <span className={styles.ticketRef}>{request.ticket_reference}</span>
          )}
          <StatusBadge status={request.approval_status} />
          {hasAutomation && (
            <span className={styles.actionBadge}>
              ⚙️ {automationAction.type?.replace(/_/g, ' ')}
            </span>
          )}
        </div>
      </div>

      {/* Field values */}
      <div className={styles.fieldValues}>
        {resolvedFields.map(({ label, value }) => (
          <div key={label} className={styles.fieldRow}>
            <span className={styles.fieldKey}>{label}</span>
            <span className={styles.fieldVal}>{value}</span>
          </div>
        ))}
        {resolvedFields.length === 0 && (
          <span className={styles.noFields}>No field values submitted.</span>
        )}
      </div>

      {/* Rejection reason */}
      {request.approval_status === 'rejected' && request.rejection_reason && (
        <div className={styles.rejectionNote}>
          <strong>Rejection reason:</strong> {request.rejection_reason}
        </div>
      )}

      {/* Execution log toggle */}
      {(request.execution_log?.length > 0 || request.execution_status) && (
        <div>
          <button className={styles.logToggle} onClick={() => setExpanded(e => !e)}>
            {expanded ? '▲ Hide' : '▼ Show'} execution log
            {request.execution_status === 'failed' && ' ⚠️'}
            {request.execution_status === 'completed' && ' ✅'}
          </button>
          {expanded && <LogViewer log={request.execution_log} />}
        </div>
      )}

      {/* Action buttons */}
      {request.approval_status === 'pending' && (
        <div className={styles.cardActions}>
          <button
            className={styles.btnApprove}
            onClick={handleApprove}
            disabled={approving}
          >
            {approving ? '⏳ Approving…' : '✓ Approve & Execute'}
          </button>
          <button className={styles.btnRejectCard} onClick={() => onReject(request)}>
            ✗ Reject
          </button>
        </div>
      )}
    </div>
  )
}

export default function ApprovalQueue() {
  const [submissions, setSubmissions] = useState([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('pending')
  const [rejectTarget, setRejectTarget] = useState(null)
  const [refreshing, setRefreshing] = useState(false)

  async function load() {
    setRefreshing(true)
    try {
      const res = await apiFetch('/api/service-catalog/submissions')
      const data = await res.json()
      setSubmissions(Array.isArray(data) ? data : [])
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  useEffect(() => { load() }, [])

  // Poll for executing requests every 3s
  useEffect(() => {
    const hasExecuting = submissions.some(s => s.execution_status === 'executing' || s.approval_status === 'executing')
    if (!hasExecuting) return
    const t = setTimeout(load, 3000)
    return () => clearTimeout(t)
  }, [submissions])

  async function handleApprove(id) {
    await apiFetch(`/api/service-catalog/submissions/${id}/approve`, { method: 'POST' })
    // Optimistically update
    setSubmissions(prev => prev.map(s =>
      s.id === id ? { ...s, approval_status: 'approved', execution_status: 'executing' } : s
    ))
    // Then reload after a moment to pick up execution result
    setTimeout(load, 2000)
    setTimeout(load, 5000)
  }

  async function handleReject(id, reason) {
    await apiFetch(`/api/service-catalog/submissions/${id}/reject`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    })
    setSubmissions(prev => prev.map(s =>
      s.id === id ? { ...s, approval_status: 'rejected', rejection_reason: reason } : s
    ))
  }

  const pending = submissions.filter(s => s.approval_status === 'pending')
  const all = submissions

  const displayed = tab === 'pending' ? pending : all

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Approval Queue</h1>
          <p className={styles.subtitle}>Review and approve service requests before they execute in M365.</p>
        </div>
        <button className={styles.refreshBtn} onClick={load} disabled={refreshing}>
          {refreshing ? '⟳ Refreshing…' : '⟳ Refresh'}
        </button>
      </div>

      <div className={styles.tabs}>
        <button
          className={`${styles.tab} ${tab === 'pending' ? styles.tabActive : ''}`}
          onClick={() => setTab('pending')}
        >
          Pending Approval
          {pending.length > 0 && (
            <span className={styles.tabBadge}>{pending.length}</span>
          )}
        </button>
        <button
          className={`${styles.tab} ${tab === 'all' ? styles.tabActive : ''}`}
          onClick={() => setTab('all')}
        >
          All Requests
          <span className={styles.tabBadge} style={{ background: '#E5E7EB', color: '#374151' }}>
            {all.length}
          </span>
        </button>
      </div>

      {loading ? (
        <div className={styles.empty}>Loading…</div>
      ) : displayed.length === 0 ? (
        <div className={styles.empty}>
          {tab === 'pending'
            ? '🎉 No requests pending approval.'
            : 'No service requests submitted yet.'}
        </div>
      ) : (
        <div className={styles.list}>
          {displayed.map(req => (
            <RequestCard
              key={req.id}
              request={req}
              onApprove={handleApprove}
              onReject={setRejectTarget}
              onRefresh={load}
            />
          ))}
        </div>
      )}

      {rejectTarget && (
        <RejectModal
          request={rejectTarget}
          onClose={() => setRejectTarget(null)}
          onConfirm={handleReject}
        />
      )}
    </div>
  )
}
