import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import PageHeader from '../components/PageHeader'
import ConfirmModal from '../components/ConfirmModal'
import { apiFetch } from '../utils/api'
import formStyles from '../styles/forms.module.css'
import styles from './CustomFields.module.css'

const FIELD_TYPES = [
  { value: 'text',     label: 'Text' },
  { value: 'number',   label: 'Number' },
  { value: 'select',   label: 'Select (dropdown)' },
  { value: 'date',     label: 'Date' },
  { value: 'checkbox', label: 'Checkbox (yes/no)' },
]

export default function CustomFields() {
  const [fields, setFields]   = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState(null)   // field being edited, or null for new
  const [confirmDelete, setConfirmDelete] = useState(null)

  function load() {
    setLoading(true)
    apiFetch('/api/custom-fields')
      .then(r => r.json())
      .then(d => { if (Array.isArray(d)) setFields(d); setLoading(false) })
      .catch(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  function openNew() {
    setEditing(null)
    setShowForm(true)
  }

  function openEdit(field) {
    setEditing(field)
    setShowForm(true)
  }

  async function handleDelete(field) {
    await apiFetch(`/api/custom-fields/${field.id}`, { method: 'DELETE' })
    setConfirmDelete(null)
    load()
  }

  return (
    <div className={styles.page}>
      <PageHeader
        title="Custom Ticket Fields"
        action={
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <Link to="/settings" className={styles.btnBack}>← Back to Settings</Link>
            <button className={styles.btnNew} onClick={openNew}>+ New Field</button>
          </div>
        }
      />
      <div className={styles.content}>
        <p className={styles.desc}>
          Custom fields appear on every ticket's detail page. Agents can fill them in inline.
          Select and checkbox fields support structured data.
        </p>

        {loading && <div className={styles.state}>Loading…</div>}

        {!loading && fields.length === 0 && (
          <div className={styles.empty}>
            No custom fields yet.{' '}
            <button className={styles.emptyLink} onClick={openNew}>Create your first field.</button>
          </div>
        )}

        {!loading && fields.length > 0 && (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Label</th>
                  <th>Key</th>
                  <th>Type</th>
                  <th>Required</th>
                  <th>Order</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {fields.map(f => (
                  <tr key={f.id}>
                    <td className={styles.label}>{f.label}</td>
                    <td className={styles.key}>{f.field_key}</td>
                    <td>{FIELD_TYPES.find(t => t.value === f.field_type)?.label ?? f.field_type}</td>
                    <td>{f.required ? <span className={styles.badgeReq}>Required</span> : <span className={styles.badgeOpt}>Optional</span>}</td>
                    <td>{f.sort_order}</td>
                    <td className={styles.actions}>
                      <button className={styles.btnEdit} onClick={() => openEdit(f)}>Edit</button>
                      <button className={styles.btnDelete} onClick={() => setConfirmDelete(f)}>Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showForm && (
        <FieldForm
          field={editing}
          onClose={() => setShowForm(false)}
          onSaved={() => { setShowForm(false); load() }}
        />
      )}

      {confirmDelete && (
        <ConfirmModal
          title={`Delete "${confirmDelete.label}"?`}
          message="This will remove the field and all values stored against it on existing tickets."
          confirmLabel="Delete Field"
          onConfirm={() => handleDelete(confirmDelete)}
          onClose={() => setConfirmDelete(null)}
        />
      )}
    </div>
  )
}

// ─── Create / Edit field form (inline) ───────────────────────────────────────

function FieldForm({ field, onClose, onSaved }) {
  const isEdit = !!field
  const [form, setForm] = useState({
    label:      field?.label      ?? '',
    field_key:  field?.field_key  ?? '',
    field_type: field?.field_type ?? 'text',
    options:    Array.isArray(field?.options) ? field.options.join(', ') : '',
    required:   field?.required   ?? false,
    sort_order: field?.sort_order ?? 0,
  })
  const [errors, setErrors] = useState({})
  const [saving, setSaving] = useState(false)
  const [saveErr, setSaveErr] = useState(null)

  // Auto-generate field_key from label on new fields
  function handleLabelChange(val) {
    setForm(f => ({
      ...f,
      label: val,
      field_key: isEdit ? f.field_key : val.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''),
    }))
  }

  function validate() {
    const e = {}
    if (!form.label.trim())     e.label     = 'Required'
    if (!form.field_key.trim()) e.field_key = 'Required'
    if (form.field_type === 'select' && !form.options.trim()) e.options = 'Add at least one option'
    setErrors(e)
    return !Object.keys(e).length
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!validate()) return
    setSaving(true)
    setSaveErr(null)
    const optionsArr = form.field_type === 'select'
      ? form.options.split(',').map(o => o.trim()).filter(Boolean)
      : []
    const payload = {
      label:      form.label.trim(),
      field_key:  form.field_key.trim(),
      field_type: form.field_type,
      options:    optionsArr,
      required:   form.required,
      sort_order: parseInt(form.sort_order) || 0,
    }
    try {
      const url = isEdit ? `/api/custom-fields/${field.id}` : '/api/custom-fields'
      const method = isEdit ? 'PUT' : 'POST'
      const res = await apiFetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) { const d = await res.json(); setSaveErr(d.error || 'Failed'); setSaving(false); return }
      onSaved()
    } catch {
      setSaveErr('Something went wrong.')
      setSaving(false)
    }
  }

  return (
    <div className={styles.formOverlay}>
      <div className={styles.formCard}>
        <div className={styles.formHead}>
          <h2 className={styles.formTitle}>{isEdit ? 'Edit Field' : 'New Custom Field'}</h2>
          <button className={styles.formClose} onClick={onClose}>✕</button>
        </div>
        <form className={formStyles.form} onSubmit={handleSubmit}>
          <div className={formStyles.field}>
            <label className={formStyles.label}>Label <span className={formStyles.required}>*</span></label>
            <input
              className={formStyles.input}
              value={form.label}
              autoFocus
              onChange={e => handleLabelChange(e.target.value)}
            />
            {errors.label && <span className={formStyles.error}>{errors.label}</span>}
          </div>

          <div className={formStyles.field}>
            <label className={formStyles.label}>Field Key <span className={formStyles.required}>*</span></label>
            <input
              className={formStyles.input}
              value={form.field_key}
              disabled={isEdit}
              onChange={e => setForm(f => ({ ...f, field_key: e.target.value }))}
              placeholder="e.g. asset_tag"
            />
            {isEdit && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Key cannot be changed after creation.</span>}
            {errors.field_key && <span className={formStyles.error}>{errors.field_key}</span>}
          </div>

          <div className={formStyles.field}>
            <label className={formStyles.label}>Field Type</label>
            <select
              className={formStyles.select}
              value={form.field_type}
              onChange={e => setForm(f => ({ ...f, field_type: e.target.value }))}
            >
              {FIELD_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>

          {form.field_type === 'select' && (
            <div className={formStyles.field}>
              <label className={formStyles.label}>Options <span className={formStyles.required}>*</span></label>
              <input
                className={formStyles.input}
                value={form.options}
                onChange={e => setForm(f => ({ ...f, options: e.target.value }))}
                placeholder="Option A, Option B, Option C"
              />
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Comma-separated list of options.</span>
              {errors.options && <span className={formStyles.error}>{errors.options}</span>}
            </div>
          )}

          <div className={formStyles.row}>
            <div className={formStyles.field}>
              <label className={formStyles.label}>Sort Order</label>
              <input
                className={formStyles.input}
                type="number"
                min="0"
                value={form.sort_order}
                onChange={e => setForm(f => ({ ...f, sort_order: e.target.value }))}
              />
            </div>
            <div className={formStyles.field}>
              <label className={formStyles.label}>Required?</label>
              <label className={styles.checkLabel}>
                <input
                  type="checkbox"
                  checked={form.required}
                  onChange={e => setForm(f => ({ ...f, required: e.target.checked }))}
                />
                <span>This field is required</span>
              </label>
            </div>
          </div>

          {saveErr && <div className={formStyles.error}>{saveErr}</div>}

          <div className={formStyles.actions}>
            <button type="button" className={formStyles.btnSecondary} onClick={onClose}>Cancel</button>
            <button type="submit" className={formStyles.btnPrimary} disabled={saving}>
              {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Field'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
