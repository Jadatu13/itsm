import { useEffect, useState } from 'react'
import PageHeader from '../components/PageHeader'
import Modal from '../components/Modal'
import { apiFetch } from '../utils/api'
import formStyles from '../styles/forms.module.css'
import styles from './CannedResponses.module.css'

export default function CannedResponses() {
  const [items, setItems]       = useState([])
  const [loading, setLoading]   = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing]   = useState(null)
  const [deleteId, setDeleteId] = useState(null)

  function load() {
    apiFetch('/api/canned-responses').then(r => r.json()).then(d => { if (Array.isArray(d)) setItems(d); setLoading(false) })
  }

  useEffect(() => { load() }, [])

  async function handleDelete(id) {
    await apiFetch(`/api/canned-responses/${id}`, { method: 'DELETE' })
    setDeleteId(null)
    load()
  }

  return (
    <div className={styles.page}>
      <PageHeader
        title="Canned Responses"
        action={<button className={styles.btnNew} onClick={() => { setEditing(null); setShowModal(true) }}>+ New Template</button>}
      />
      <div className={styles.content}>
        {loading ? <div className={styles.state}>Loading…</div> : (
          items.length === 0 ? (
            <div className={styles.empty}>
              <p>No canned responses yet.</p>
              <p>Create templates for common replies — insert them with one click when responding to tickets.</p>
            </div>
          ) : (
            <div className={styles.list}>
              {items.map(item => (
                <div key={item.id} className={styles.card}>
                  <div className={styles.cardHeader}>
                    <span className={styles.cardTitle}>{item.title}</span>
                    <div className={styles.cardActions}>
                      <button className={styles.btnEdit} onClick={() => { setEditing(item); setShowModal(true) }}>Edit</button>
                      <button className={styles.btnDelete} onClick={() => setDeleteId(item.id)}>Delete</button>
                    </div>
                  </div>
                  <div className={styles.cardBody}>{item.body}</div>
                </div>
              ))}
            </div>
          )
        )}
      </div>

      {showModal && (
        <CannedModal
          item={editing}
          onClose={() => setShowModal(false)}
          onSaved={() => { setShowModal(false); load() }}
        />
      )}

      {deleteId && (
        <Modal title="Delete Template" onClose={() => setDeleteId(null)}>
          <div className={formStyles.form}>
            <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 14 }}>
              This template will be permanently deleted.
            </p>
            <div className={formStyles.actions}>
              <button className={formStyles.btnSecondary} onClick={() => setDeleteId(null)}>Cancel</button>
              <button className={styles.btnDanger} onClick={() => handleDelete(deleteId)}>Delete</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

function CannedModal({ item, onClose, onSaved }) {
  const [form, setForm]         = useState({ title: item?.title || '', body: item?.body || '' })
  const [errors, setErrors]     = useState({})
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState(null)

  function validate() {
    const e = {}
    if (!form.title.trim()) e.title = 'Required'
    if (!form.body.trim())  e.body  = 'Required'
    setErrors(e)
    return !Object.keys(e).length
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!validate()) return
    setSubmitting(true)
    setSubmitError(null)
    try {
      const url    = item ? `/api/canned-responses/${item.id}` : '/api/canned-responses'
      const method = item ? 'PUT' : 'POST'
      const res = await apiFetch(url, { method, body: JSON.stringify(form) })
      if (!res.ok) { const d = await res.json(); setSubmitError(d.error); setSubmitting(false); return }
      onSaved()
    } catch {
      setSubmitError('Something went wrong.')
      setSubmitting(false)
    }
  }

  return (
    <Modal title={item ? 'Edit Template' : 'New Template'} onClose={onClose}>
      <form className={formStyles.form} onSubmit={handleSubmit}>
        <div className={formStyles.field}>
          <label className={formStyles.label}>Title <span className={formStyles.required}>*</span></label>
          <input className={formStyles.input} value={form.title} autoFocus
            placeholder="e.g. Password reset instructions"
            onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
          {errors.title && <span className={formStyles.error}>{errors.title}</span>}
        </div>
        <div className={formStyles.field}>
          <label className={formStyles.label}>Body <span className={formStyles.required}>*</span></label>
          <textarea className={formStyles.textarea} rows={8} value={form.body}
            placeholder="Write the reply template here…"
            onChange={e => setForm(f => ({ ...f, body: e.target.value }))} />
          {errors.body && <span className={formStyles.error}>{errors.body}</span>}
        </div>
        {submitError && <div className={formStyles.error}>{submitError}</div>}
        <div className={formStyles.actions}>
          <button type="button" className={formStyles.btnSecondary} onClick={onClose}>Cancel</button>
          <button type="submit" className={formStyles.btnPrimary} disabled={submitting}>{submitting ? 'Saving…' : 'Save Template'}</button>
        </div>
      </form>
    </Modal>
  )
}
