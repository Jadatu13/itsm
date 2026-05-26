import { useEffect, useState } from 'react'
import PageHeader from '../components/PageHeader'
import Modal from '../components/Modal'
import { formatDate } from '../utils/format'
import { apiFetch } from '../utils/api'
import formStyles from '../styles/forms.module.css'
import styles from './Agents.module.css'

export default function Agents() {
  const [agents, setAgents] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [deleteId, setDeleteId] = useState(null)

  function load() {
    apiFetch('/api/agents').then(r => r.json()).then(d => { if (Array.isArray(d)) setAgents(d); setLoading(false) })
  }

  useEffect(() => { load() }, [])

  async function handleDelete(id) {
    await apiFetch(`/api/agents/${id}`, { method: 'DELETE' })
    setDeleteId(null)
    load()
  }

  return (
    <div className={styles.page}>
      <PageHeader
        title="Agents"
        action={<button className={styles.btnNew} onClick={() => { setEditing(null); setShowModal(true) }}>+ New Agent</button>}
      />
      <div className={styles.content}>
        {loading ? <div className={styles.state}>Loading…</div> : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr><th>Name</th><th>Email</th><th>Role</th><th>Created</th><th></th></tr>
              </thead>
              <tbody>
                {agents.length === 0 && (
                  <tr><td colSpan={5} className={styles.empty}>No agents found.</td></tr>
                )}
                {agents.map(a => (
                  <tr key={a.id}>
                    <td className={styles.name}>
                      <div className={styles.avatar}>{a.name[0].toUpperCase()}</div>
                      {a.name}
                    </td>
                    <td>{a.email}</td>
                    <td><span className={a.role === 'admin' ? styles.roleAdmin : styles.roleAgent}>{a.role}</span></td>
                    <td className={styles.muted}>{formatDate(a.created_at)}</td>
                    <td className={styles.actions}>
                      <button className={styles.btnEdit} onClick={() => { setEditing(a); setShowModal(true) }}>Edit</button>
                      <button className={styles.btnDelete} onClick={() => setDeleteId(a.id)}>Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showModal && (
        <AgentModal
          agent={editing}
          onClose={() => setShowModal(false)}
          onSaved={() => { setShowModal(false); load() }}
        />
      )}

      {deleteId && (
        <Modal title="Delete Agent" onClose={() => setDeleteId(null)}>
          <div className={formStyles.form}>
            <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 14 }}>
              This agent will be removed and any assigned tickets will become unassigned. This cannot be undone.
            </p>
            <div className={formStyles.actions}>
              <button className={formStyles.btnSecondary} onClick={() => setDeleteId(null)}>Cancel</button>
              <button className={styles.btnDanger} onClick={() => handleDelete(deleteId)}>Delete Agent</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

function AgentModal({ agent, onClose, onSaved }) {
  const [form, setForm] = useState({
    name:     agent?.name     || '',
    email:    agent?.email    || '',
    password: '',
    role:     agent?.role     || 'agent',
  })
  const [errors, setErrors] = useState({})
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState(null)

  function validate() {
    const e = {}
    if (!form.name.trim())  e.name  = 'Required'
    if (!form.email.trim()) e.email = 'Required'
    if (!agent && !form.password.trim()) e.password = 'Required for new agents'
    setErrors(e)
    return !Object.keys(e).length
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!validate()) return
    setSubmitting(true)
    setSubmitError(null)
    try {
      const url    = agent ? `/api/agents/${agent.id}` : '/api/agents'
      const method = agent ? 'PUT' : 'POST'
      const body   = { ...form }
      if (agent && !form.password) delete body.password
      const res = await apiFetch(url, { method, body: JSON.stringify(body) })
      if (!res.ok) { const d = await res.json(); setSubmitError(d.error); setSubmitting(false); return }
      onSaved()
    } catch {
      setSubmitError('Something went wrong.')
      setSubmitting(false)
    }
  }

  return (
    <Modal title={agent ? 'Edit Agent' : 'New Agent'} onClose={onClose}>
      <form className={formStyles.form} onSubmit={handleSubmit}>
        <div className={formStyles.field}>
          <label className={formStyles.label}>Name <span className={formStyles.required}>*</span></label>
          <input className={formStyles.input} value={form.name} autoFocus onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
          {errors.name && <span className={formStyles.error}>{errors.name}</span>}
        </div>
        <div className={formStyles.field}>
          <label className={formStyles.label}>Email <span className={formStyles.required}>*</span></label>
          <input className={formStyles.input} type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
          {errors.email && <span className={formStyles.error}>{errors.email}</span>}
        </div>
        <div className={formStyles.field}>
          <label className={formStyles.label}>
            Password {agent && <span style={{ fontWeight: 400, color: 'var(--text-muted)', fontSize: 12 }}> — leave blank to keep existing</span>}
            {!agent && <span className={formStyles.required}>*</span>}
          </label>
          <input className={formStyles.input} type="password" value={form.password} autoComplete="new-password" onChange={e => setForm(f => ({ ...f, password: e.target.value }))} />
          {errors.password && <span className={formStyles.error}>{errors.password}</span>}
        </div>
        <div className={formStyles.field}>
          <label className={formStyles.label}>Role</label>
          <select className={formStyles.select} value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))}>
            <option value="agent">Agent</option>
            <option value="admin">Admin</option>
          </select>
        </div>
        {submitError && <div className={formStyles.error}>{submitError}</div>}
        <div className={formStyles.actions}>
          <button type="button" className={formStyles.btnSecondary} onClick={onClose}>Cancel</button>
          <button type="submit" className={formStyles.btnPrimary} disabled={submitting}>{submitting ? 'Saving…' : 'Save Agent'}</button>
        </div>
      </form>
    </Modal>
  )
}
