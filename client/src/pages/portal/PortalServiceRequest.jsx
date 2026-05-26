import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { portalFetch } from '../../utils/portalApi'
import styles from './Portal.module.css'

export default function PortalServiceRequest() {
  const { id } = useParams()
  const [form, setForm] = useState(null)
  const [loading, setLoading] = useState(true)
  const [values, setValues] = useState({})
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(null)

  useEffect(() => {
    portalFetch(`/api/portal/service-catalog/${id}`)
      .then(r => r.json())
      .then(data => {
        setForm(data)
        // Init default values
        const init = {}
        if (Array.isArray(data.fields)) {
          data.fields.forEach(f => {
            init[f.id] = f.type === 'checkbox' ? false : ''
          })
        }
        setValues(init)
      })
      .finally(() => setLoading(false))
  }, [id])

  function setValue(fieldId, val) {
    setValues(prev => ({ ...prev, [fieldId]: val }))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')

    // Validate required fields
    for (const field of form.fields || []) {
      if (field.required) {
        const val = values[field.id]
        if (val === undefined || val === null || val === '' || val === false) {
          setError(`"${field.label}" is required.`)
          return
        }
      }
    }

    // Validate format (regex) rules
    for (const field of form.fields || []) {
      const val = values[field.id]
      if (!val || val === '' || val === false) continue // already caught by required check
      const vRule = field.validation
      if (!vRule || vRule.type === 'none') continue
      const pattern = vRule.pattern
      if (!pattern) continue
      try {
        const regex = new RegExp(pattern)
        if (!regex.test(String(val))) {
          setError(vRule.message || `"${field.label}" format is invalid.`)
          return
        }
      } catch {
        // bad regex — skip silently
      }
    }

    setSubmitting(true)
    try {
      const res = await portalFetch(`/api/portal/service-catalog/${id}/submit`, {
        method: 'POST',
        body: JSON.stringify({ field_values: values }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error || 'Submission failed.'); return }
      setSuccess(data)
    } catch {
      setError('Submission failed. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  function groupFieldsIntoRows(fields) {
    const rows = []
    let i = 0
    while (i < fields.length) {
      const field = fields[i]
      if (field.layout === 'half' && i + 1 < fields.length && fields[i + 1].layout === 'half') {
        rows.push({ type: 'pair', fields: [field, fields[i + 1]] })
        i += 2
      } else {
        rows.push({ type: 'single', fields: [field] })
        i++
      }
    }
    return rows
  }

  function renderField(field) {
    return (
      <div key={field.id} className={styles.fieldGroup}>
        {field.type !== 'checkbox' && (
          <label className={styles.fieldLabel} htmlFor={field.id}>
            {field.label}
            {field.required && <span className={styles.requiredStar}>*</span>}
          </label>
        )}

        {field.type === 'text' && (
          <input
            id={field.id}
            type="text"
            className={styles.fieldInput}
            placeholder={field.placeholder || ''}
            value={values[field.id] || ''}
            onChange={e => setValue(field.id, e.target.value)}
            required={field.required}
          />
        )}

        {field.type === 'textarea' && (
          <textarea
            id={field.id}
            className={styles.fieldTextarea}
            placeholder={field.placeholder || ''}
            value={values[field.id] || ''}
            onChange={e => setValue(field.id, e.target.value)}
            required={field.required}
          />
        )}

        {field.type === 'select' && (
          <select
            id={field.id}
            className={styles.fieldSelect}
            value={values[field.id] || ''}
            onChange={e => setValue(field.id, e.target.value)}
            required={field.required}
          >
            <option value="">Select an option…</option>
            {(field.options || []).map((opt, i) => (
              <option key={i} value={opt.label}>{opt.label}</option>
            ))}
          </select>
        )}

        {field.type === 'checkbox' && (
          <label className={styles.checkboxItem} htmlFor={field.id}>
            <input
              id={field.id}
              type="checkbox"
              checked={!!values[field.id]}
              onChange={e => setValue(field.id, e.target.checked)}
            />
            {field.label}
            {field.required && <span className={styles.requiredStar}>*</span>}
          </label>
        )}

        {field.type === 'date' && (
          <>
            <input
              id={field.id}
              type="date"
              className={styles.fieldInput}
              value={values[field.id] || ''}
              onChange={e => setValue(field.id, e.target.value)}
              required={field.required}
            />
            <p className={styles.fieldHelpText} style={{ marginTop: 4 }}>Format: DD/MM/YYYY</p>
          </>
        )}

        {field.type === 'number' && (
          <input
            id={field.id}
            type="number"
            className={styles.fieldInput}
            placeholder={field.placeholder || ''}
            value={values[field.id] || ''}
            onChange={e => setValue(field.id, e.target.value)}
            required={field.required}
          />
        )}

        {field.type === 'radio' && (
          <div className={styles.radioGroup}>
            {(field.options || []).map((opt, i) => (
              <label key={i} className={styles.radioItem}>
                <input
                  type="radio"
                  name={field.id}
                  value={opt.label}
                  checked={values[field.id] === opt.label}
                  onChange={() => setValue(field.id, opt.label)}
                  required={field.required && !values[field.id]}
                />
                {opt.label}
              </label>
            ))}
          </div>
        )}

        {field.helpText && (
          <p className={styles.fieldHelpText}>{field.helpText}</p>
        )}
      </div>
    )
  }

  if (loading) return <div className={styles.loadingState}>Loading…</div>
  if (!form) return <div className={styles.emptyState}>Form not found.</div>

  if (success) {
    return (
      <div className={styles.card}>
        <div className={styles.successScreen}>
          <div className={styles.successIcon}>{success.approval_required ? '⏳' : '✅'}</div>
          <h2 className={styles.successTitle}>
            {success.approval_required ? 'Request Received!' : 'Request Submitted!'}
          </h2>
          <p className={styles.successText}>
            {success.approval_required
              ? 'Your request is pending review by our team. We\'ll action it shortly — you\'ll be able to track progress on your ticket.'
              : 'Your service request has been submitted and a ticket has been created.'}
          </p>
          {success.reference && (
            <div className={styles.successRef}>{success.reference}</div>
          )}
          <div style={{ display: 'flex', gap: 16, justifyContent: 'center', flexWrap: 'wrap' }}>
            <Link to={`/portal/tickets/${success.ticket_id}`} className={styles.btnPrimary} style={{ width: 'auto', textDecoration: 'none', display: 'inline-block' }}>
              View Ticket
            </Link>
            <Link to="/portal/service-catalog" className={styles.backLink}>
              ← Back to Catalog
            </Link>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.requestForm}>
      <Link to="/portal/service-catalog" className={styles.backLink} style={{ marginBottom: 20, display: 'inline-block' }}>
        ← Back to Catalog
      </Link>

      <div className={styles.card}>
        <div className={styles.requestFormHeader}>
          <h1 className={styles.requestFormTitle}>
            <span>{form.icon || '📋'}</span> {form.name}
          </h1>
          {form.description && <p className={styles.requestFormDesc}>{form.description}</p>}
        </div>

        <form onSubmit={handleSubmit}>
          {groupFieldsIntoRows(form.fields || []).map((row, ri) => (
            <div key={ri} className={row.type === 'pair' ? styles.fieldRowPair : styles.fieldRowSingle}>
              {row.fields.map(field => renderField(field))}
            </div>
          ))}

          {error && <div className={styles.errorMsg}>{error}</div>}

          <button type="submit" className={styles.btnPrimary} disabled={submitting} style={{ marginTop: 8 }}>
            {submitting ? 'Submitting…' : 'Submit Request'}
          </button>
        </form>
      </div>
    </div>
  )
}
