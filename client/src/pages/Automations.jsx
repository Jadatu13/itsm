import { useEffect, useState, useCallback } from 'react'
import PageHeader from '../components/PageHeader'
import Modal from '../components/Modal'
import { apiFetch } from '../utils/api'
import styles from './Automations.module.css'

// ─── Constants ────────────────────────────────────────────────────────────────

const TRIGGERS = [
  { value: 'ticket_created',  label: 'Ticket is created' },
  { value: 'reply_received',  label: 'Reply received from contact' },
  { value: 'status_changed',  label: 'Ticket status changes' },
]

const CONDITION_FIELDS = [
  { value: 'priority',    label: 'Priority' },
  { value: 'status',      label: 'Status' },
  { value: 'category',    label: 'Category' },
  { value: 'source',      label: 'Source' },
  { value: 'subject',     label: 'Subject' },
  { value: 'assigned_to', label: 'Assigned To' },
  { value: 'org_id',      label: 'Organisation' },
]

const OPERATORS = [
  { value: 'equals',       label: 'equals' },
  { value: 'not_equals',   label: 'not equals' },
  { value: 'contains',     label: 'contains' },
  { value: 'is_empty',     label: 'is empty' },
  { value: 'is_not_empty', label: 'is not empty' },
]

const ACTION_TYPES = [
  { value: 'set_status',   label: 'Set Status' },
  { value: 'assign_to',    label: 'Assign To' },
  { value: 'set_priority', label: 'Set Priority' },
  { value: 'add_note',     label: 'Add Internal Note' },
  { value: 'send_canned',  label: 'Send Canned Reply' },
]

const STATUS_OPTIONS   = ['open', 'in_progress', 'on_hold', 'resolved']
const PRIORITY_OPTIONS = ['low', 'medium', 'high']
const CATEGORY_OPTIONS = ['question', 'incident', 'problem', 'feature_request', 'other']
const SOURCE_OPTIONS   = ['email', 'manual', 'portal']

const NOVALUE_OPERATORS = ['is_empty', 'is_not_empty']

const TRIGGER_COLORS = {
  ticket_created:  styles.badgeBlue,
  reply_received:  styles.badgeGreen,
  status_changed:  styles.badgePurple,
}

function triggerLabel(v) {
  return TRIGGERS.find(t => t.value === v)?.label ?? v
}

function summariseConditions(conditions) {
  if (!conditions || conditions.length === 0) return '—'
  return conditions
    .map(c => {
      const field = CONDITION_FIELDS.find(f => f.value === c.field)?.label ?? c.field
      const op    = OPERATORS.find(o => o.value === c.operator)?.label ?? c.operator
      const val   = NOVALUE_OPERATORS.includes(c.operator) ? '' : ` "${c.value}"`
      return `${field} ${op}${val}`
    })
    .join(', ')
}

function summariseActions(actions) {
  if (!actions || actions.length === 0) return '—'
  return actions
    .map(a => ACTION_TYPES.find(t => t.value === a.type)?.label ?? a.type)
    .join(', ')
}

// ─── Condition value input ─────────────────────────────────────────────────────

function ConditionValueInput({ field, value, onChange, agents, orgs }) {
  if (field === 'priority') {
    return (
      <select className={styles.select} value={value} onChange={e => onChange(e.target.value)}>
        <option value="">Select…</option>
        {PRIORITY_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    )
  }
  if (field === 'status') {
    return (
      <select className={styles.select} value={value} onChange={e => onChange(e.target.value)}>
        <option value="">Select…</option>
        {STATUS_OPTIONS.map(o => <option key={o} value={o}>{o.replace('_', ' ')}</option>)}
      </select>
    )
  }
  if (field === 'category') {
    return (
      <select className={styles.select} value={value} onChange={e => onChange(e.target.value)}>
        <option value="">Select…</option>
        {CATEGORY_OPTIONS.map(o => <option key={o} value={o}>{o.replace('_', ' ')}</option>)}
      </select>
    )
  }
  if (field === 'source') {
    return (
      <select className={styles.select} value={value} onChange={e => onChange(e.target.value)}>
        <option value="">Select…</option>
        {SOURCE_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    )
  }
  if (field === 'assigned_to') {
    return (
      <select className={styles.select} value={value} onChange={e => onChange(e.target.value)}>
        <option value="">Select agent…</option>
        {agents.map(a => <option key={a.id} value={String(a.id)}>{a.name}</option>)}
      </select>
    )
  }
  if (field === 'org_id') {
    return (
      <select className={styles.select} value={value} onChange={e => onChange(e.target.value)}>
        <option value="">Select organisation…</option>
        {orgs.map(o => <option key={o.id} value={String(o.id)}>{o.name}</option>)}
      </select>
    )
  }
  // subject — text
  return (
    <input
      className={styles.input}
      type="text"
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder="Value…"
    />
  )
}

// ─── Action value input ────────────────────────────────────────────────────────

function ActionValueInput({ type, value, onChange, agents, canned }) {
  if (type === 'set_status') {
    return (
      <select className={styles.select} value={value} onChange={e => onChange(e.target.value)}>
        <option value="">Select status…</option>
        {STATUS_OPTIONS.map(o => <option key={o} value={o}>{o.replace('_', ' ')}</option>)}
      </select>
    )
  }
  if (type === 'set_priority') {
    return (
      <select className={styles.select} value={value} onChange={e => onChange(e.target.value)}>
        <option value="">Select priority…</option>
        {PRIORITY_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    )
  }
  if (type === 'assign_to') {
    return (
      <select className={styles.select} value={value} onChange={e => onChange(e.target.value)}>
        <option value="">— Nobody (unassign) —</option>
        {agents.map(a => <option key={a.id} value={String(a.id)}>{a.name}</option>)}
      </select>
    )
  }
  if (type === 'add_note') {
    return (
      <textarea
        className={styles.textarea}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder="Note text…"
        rows={3}
      />
    )
  }
  if (type === 'send_canned') {
    return (
      <select className={styles.select} value={value} onChange={e => onChange(e.target.value)}>
        <option value="">Select canned response…</option>
        {canned.map(c => <option key={c.id} value={String(c.id)}>{c.title}</option>)}
      </select>
    )
  }
  return null
}

// ─── Default blank rows ────────────────────────────────────────────────────────

const blankCondition = () => ({ field: 'priority', operator: 'equals', value: '' })
const blankAction    = () => ({ type: 'set_status', value: '' })

// ─── Rule editor modal ─────────────────────────────────────────────────────────

function RuleModal({ rule, agents, orgs, canned, onSave, onClose }) {
  const isNew = !rule?.id
  const [name,       setName]       = useState(rule?.name || '')
  const [trigger,    setTrigger]    = useState(rule?.trigger_type || 'ticket_created')
  const [matchAll,   setMatchAll]   = useState(rule?.match_all !== false)
  const [conditions, setConditions] = useState(rule?.conditions || [])
  const [actions,    setActions]    = useState(rule?.actions || [])
  const [saving,     setSaving]     = useState(false)
  const [error,      setError]      = useState(null)

  function updateCondition(i, field, val) {
    setConditions(prev => {
      const next = [...prev]
      next[i] = { ...next[i], [field]: val }
      // Reset value when operator changes to no-value type
      if (field === 'operator' && NOVALUE_OPERATORS.includes(val)) {
        next[i].value = ''
      }
      return next
    })
  }

  function updateAction(i, field, val) {
    setActions(prev => {
      const next = [...prev]
      next[i] = { ...next[i], [field]: val }
      if (field === 'type') next[i].value = ''
      return next
    })
  }

  async function handleSave() {
    if (!name.trim()) { setError('Name is required'); return }
    setSaving(true)
    setError(null)
    try {
      const payload = {
        name: name.trim(),
        trigger_type: trigger,
        match_all: matchAll,
        conditions,
        actions,
        enabled: rule?.enabled !== undefined ? rule.enabled : true,
      }
      const url    = isNew ? '/api/automations' : `/api/automations/${rule.id}`
      const method = isNew ? 'POST' : 'PUT'
      const res    = await apiFetch(url, { method, body: JSON.stringify(payload) })
      const data   = await res.json()
      if (!res.ok) { setError(data.error || 'Failed to save'); setSaving(false); return }
      onSave(data, isNew)
    } catch {
      setError('Something went wrong')
      setSaving(false)
    }
  }

  return (
    <Modal title={isNew ? 'New Automation Rule' : 'Edit Automation Rule'} onClose={onClose} wide>
      <div className={styles.form}>
        {error && <div className={styles.formError}>{error}</div>}

        <div className={styles.field}>
          <label className={styles.label}>Rule Name</label>
          <input
            className={styles.input}
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="e.g. Auto-assign high priority tickets"
          />
        </div>

        <div className={styles.field}>
          <label className={styles.label}>Trigger</label>
          <select className={styles.select} value={trigger} onChange={e => setTrigger(e.target.value)}>
            {TRIGGERS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>

        {/* Conditions */}
        <div className={styles.section}>
          <div className={styles.sectionHeader}>
            <span className={styles.sectionTitle}>Conditions</span>
            {conditions.length >= 2 && (
              <label className={styles.matchToggle}>
                <input
                  type="checkbox"
                  checked={matchAll}
                  onChange={e => setMatchAll(e.target.checked)}
                />
                {matchAll ? 'Match ALL conditions (AND)' : 'Match ANY condition (OR)'}
              </label>
            )}
          </div>

          <div className={styles.rowList}>
            {conditions.map((cond, i) => (
              <div key={i} className={styles.row}>
                <select
                  className={styles.select}
                  value={cond.field}
                  onChange={e => updateCondition(i, 'field', e.target.value)}
                >
                  {CONDITION_FIELDS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
                </select>

                <select
                  className={styles.select}
                  value={cond.operator}
                  onChange={e => updateCondition(i, 'operator', e.target.value)}
                >
                  {OPERATORS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>

                {!NOVALUE_OPERATORS.includes(cond.operator) && (
                  <ConditionValueInput
                    field={cond.field}
                    value={cond.value}
                    onChange={v => updateCondition(i, 'value', v)}
                    agents={agents}
                    orgs={orgs}
                  />
                )}

                <button
                  className={styles.removeBtn}
                  onClick={() => setConditions(prev => prev.filter((_, j) => j !== i))}
                  title="Remove"
                >
                  ×
                </button>
              </div>
            ))}
          </div>

          <button
            className={styles.addRowBtn}
            onClick={() => setConditions(prev => [...prev, blankCondition()])}
          >
            + Add Condition
          </button>
        </div>

        {/* Actions */}
        <div className={styles.section}>
          <div className={styles.sectionHeader}>
            <span className={styles.sectionTitle}>Actions</span>
          </div>

          <div className={styles.rowList}>
            {actions.map((action, i) => (
              <div key={i} className={styles.row}>
                <select
                  className={styles.select}
                  value={action.type}
                  onChange={e => updateAction(i, 'type', e.target.value)}
                >
                  {ACTION_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>

                <div className={styles.actionValue}>
                  <ActionValueInput
                    type={action.type}
                    value={action.value}
                    onChange={v => updateAction(i, 'value', v)}
                    agents={agents}
                    canned={canned}
                  />
                </div>

                <button
                  className={styles.removeBtn}
                  onClick={() => setActions(prev => prev.filter((_, j) => j !== i))}
                  title="Remove"
                >
                  ×
                </button>
              </div>
            ))}
          </div>

          <button
            className={styles.addRowBtn}
            onClick={() => setActions(prev => [...prev, blankAction()])}
          >
            + Add Action
          </button>
        </div>

        <div className={styles.formFooter}>
          <button className={styles.btnCancel} onClick={onClose} disabled={saving}>Cancel</button>
          <button className={styles.btnSave} onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save Rule'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function Automations() {
  const [automations, setAutomations] = useState([])
  const [loading,     setLoading]     = useState(true)
  const [agents,      setAgents]      = useState([])
  const [orgs,        setOrgs]        = useState([])
  const [canned,      setCanned]      = useState([])
  const [editing,     setEditing]     = useState(null)   // null=closed, false=new, obj=edit
  const [deleting,    setDeleting]    = useState(null)   // id to confirm delete

  const load = useCallback(() => {
    setLoading(true)
    apiFetch('/api/automations')
      .then(r => r.json())
      .then(d => { setAutomations(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  useEffect(() => {
    load()
    apiFetch('/api/agents').then(r => r.json()).then(setAgents).catch(() => {})
    apiFetch('/api/organisations').then(r => r.json()).then(setOrgs).catch(() => {})
    apiFetch('/api/canned-responses').then(r => r.json()).then(setCanned).catch(() => {})
  }, [load])

  async function handleToggle(id) {
    const res  = await apiFetch(`/api/automations/${id}/toggle`, { method: 'PATCH' })
    const data = await res.json()
    if (res.ok) {
      setAutomations(prev => prev.map(a => a.id === id ? data : a))
    }
  }

  async function handleDelete(id) {
    const res = await apiFetch(`/api/automations/${id}`, { method: 'DELETE' })
    if (res.ok) {
      setAutomations(prev => prev.filter(a => a.id !== id))
      setDeleting(null)
    }
  }

  function handleSaved(saved, isNew) {
    if (isNew) {
      setAutomations(prev => [saved, ...prev])
    } else {
      setAutomations(prev => prev.map(a => a.id === saved.id ? saved : a))
    }
    setEditing(null)
  }

  return (
    <div className={styles.page}>
      <PageHeader
        title="Automation Rules"
        action={
          <button className={styles.btnNew} onClick={() => setEditing(false)}>
            + New Rule
          </button>
        }
      />

      <div className={styles.content}>
        {loading ? (
          <p className={styles.state}>Loading…</p>
        ) : automations.length === 0 ? (
          <div className={styles.empty}>
            <p>No automation rules yet.</p>
            <p>Create your first rule to automatically act on tickets based on triggers and conditions.</p>
          </div>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.thEnabled}>On</th>
                <th>Name</th>
                <th>Trigger</th>
                <th>Conditions</th>
                <th>Actions</th>
                <th className={styles.thActions}></th>
              </tr>
            </thead>
            <tbody>
              {automations.map(a => (
                <tr key={a.id} className={a.enabled ? '' : styles.rowDisabled}>
                  <td className={styles.tdEnabled}>
                    <label className={styles.toggle}>
                      <input
                        type="checkbox"
                        checked={a.enabled}
                        onChange={() => handleToggle(a.id)}
                      />
                      <span className={styles.toggleSlider}></span>
                    </label>
                  </td>
                  <td className={styles.tdName}>{a.name}</td>
                  <td>
                    <span className={`${styles.badge} ${TRIGGER_COLORS[a.trigger_type] || ''}`}>
                      {triggerLabel(a.trigger_type)}
                    </span>
                  </td>
                  <td className={styles.tdSummary}>{summariseConditions(a.conditions)}</td>
                  <td className={styles.tdSummary}>{summariseActions(a.actions)}</td>
                  <td className={styles.tdActions}>
                    <button className={styles.btnEdit} onClick={() => setEditing(a)}>Edit</button>
                    <button className={styles.btnDelete} onClick={() => setDeleting(a.id)}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Rule editor modal */}
      {editing !== null && (
        <RuleModal
          rule={editing || null}
          agents={agents}
          orgs={orgs}
          canned={canned}
          onSave={handleSaved}
          onClose={() => setEditing(null)}
        />
      )}

      {/* Delete confirmation modal */}
      {deleting !== null && (
        <Modal title="Delete Rule" onClose={() => setDeleting(null)}>
          <div className={styles.confirmBody}>
            <p>Are you sure you want to delete this rule? This cannot be undone.</p>
            <div className={styles.confirmFooter}>
              <button className={styles.btnCancel} onClick={() => setDeleting(null)}>Cancel</button>
              <button className={styles.btnDanger} onClick={() => handleDelete(deleting)}>Delete</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
