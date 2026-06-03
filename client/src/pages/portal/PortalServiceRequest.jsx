import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { portalFetch } from '../../utils/portalApi'
import styles from './Portal.module.css'

function UserPickerField({ multi, value, onChange, users, loading }) {
  const [search, setSearch] = useState('')
  const [focused, setFocused] = useState(false)
  const selectedEmails = multi ? (Array.isArray(value) ? value : []) : (value ? [value] : [])
  const selectedUsers = selectedEmails.map(e => users.find(u => u.email === e)).filter(Boolean)
  const filtered = search
    ? users.filter(u => {
        const q = search.toLowerCase()
        return u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)
      })
    : users
  function toggle(email) {
    if (multi) {
      const cur = Array.isArray(value) ? value : []
      onChange(cur.includes(email) ? cur.filter(e => e !== email) : [...cur, email])
    } else {
      onChange(value === email ? '' : email)
      setFocused(false)
      setSearch('')
    }
  }
  return (
    <div className={styles.userPickerWrap}>
      {selectedUsers.length > 0 && (
        <div className={styles.userPickerTags}>
          {selectedUsers.map(u => (
            <span key={u.email} className={styles.userPickerTag}>
              {u.name}
              <button type="button" className={styles.userPickerTagRemove} onClick={() => toggle(u.email)}>×</button>
            </span>
          ))}
        </div>
      )}
      <input
        type="text"
        className={styles.userPickerSearch}
        placeholder={loading ? 'Loading staff list…' : `Click to browse ${users.length} staff, or type to search…`}
        value={search}
        onChange={e => setSearch(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setTimeout(() => setFocused(false), 150)}
        disabled={loading}
        autoComplete="off"
      />
      {focused && (
        <div className={styles.userPickerList}>
          {filtered.length === 0 && (
            <div className={styles.userPickerEmpty}>No staff found{search ? ` matching "${search}"` : ''}</div>
          )}
          {filtered.map(u => {
            const sel = multi ? selectedEmails.includes(u.email) : value === u.email
            return (
              <div key={u.email} className={`${styles.userPickerItem} ${sel ? styles.userPickerItemSelected : ''}`} onMouseDown={() => toggle(u.email)}>
                <div className={styles.userPickerItemInfo}>
                  <span className={styles.userPickerItemName}>{u.name}</span>
                  <span className={styles.userPickerItemEmail}>{u.email}</span>
                </div>
                {sel && <span className={styles.userPickerCheck}>✓</span>}
              </div>
            )
          })}
        </div>
      )}
      {!loading && users.length === 0 && (
        <p className={styles.userPickerEmpty}>No users available — check your M365 tenant is connected.</p>
      )}
    </div>
  )
}

// GroupPickerField — Option C: live debounced search from portal's connected Entra ID tenant
function GroupPickerField({ value, onChange, formId }) {
  const [search, setSearch] = useState('')
  const [focused, setFocused] = useState(false)
  const [results, setResults] = useState([])
  const [searching, setSearching] = useState(false)
  const debounceRef = useRef(null)

  const doSearch = useCallback((q) => {
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(async () => {
      setSearching(true)
      try {
        const url = q.trim()
          ? `/api/portal/graph/groups?form_id=${formId}&q=${encodeURIComponent(q.trim())}`
          : `/api/portal/graph/groups?form_id=${formId}`
        const res = await portalFetch(url)
        const data = await res.json()
        setResults(Array.isArray(data.groups) ? data.groups : [])
      } catch {
        setResults([])
      } finally {
        setSearching(false)
      }
    }, 300)
  }, [formId])

  function handleFocus() {
    setFocused(true)
    if (!results.length) doSearch(search)
  }

  function handleChange(e) {
    setSearch(e.target.value)
    setFocused(true)
    doSearch(e.target.value)
  }

  function select(name) {
    onChange(name)
    setSearch('')
    setFocused(false)
  }

  return (
    <div className={styles.userPickerWrap}>
      {value && !focused ? (
        <div className={styles.userPickerTags}>
          <span className={styles.userPickerTag}>
            {value}
            <button type="button" className={styles.userPickerTagRemove} onClick={() => { onChange(''); setSearch(''); setResults([]) }}>×</button>
          </span>
        </div>
      ) : (
        <>
          <input
            type="text"
            className={styles.userPickerSearch}
            placeholder={searching ? 'Searching groups…' : 'Type to search Entra ID groups…'}
            value={search}
            onChange={handleChange}
            onFocus={handleFocus}
            onBlur={() => setTimeout(() => setFocused(false), 150)}
            autoComplete="off"
          />
          {focused && (
            <div className={styles.userPickerList}>
              {searching && <div className={styles.userPickerEmpty}>Searching…</div>}
              {!searching && results.length === 0 && (
                <div className={styles.userPickerEmpty}>
                  {search ? `No groups found matching "${search}"` : 'Type to search groups'}
                </div>
              )}
              {!searching && results.map(g => (
                <div
                  key={g.id}
                  className={`${styles.userPickerItem} ${value === g.name ? styles.userPickerItemSelected : ''}`}
                  onMouseDown={() => select(g.name)}
                >
                  <span className={styles.userPickerItemName}>{g.name}</span>
                  {value === g.name && <span className={styles.userPickerCheck}>✓</span>}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}

export default function PortalServiceRequest() {
  const { id } = useParams()
  const [form, setForm] = useState(null)
  const [loading, setLoading] = useState(true)
  const [values, setValues] = useState({})
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(null)
  const [upnCheck, setUpnCheck] = useState({ checking: false, exists: null, checked: false })
  const upnCheckTimer = useRef(null)
  const [graphUsers, setGraphUsers] = useState([])
  const [graphUsersLoading, setGraphUsersLoading] = useState(false)

  useEffect(() => {
    portalFetch(`/api/portal/service-catalog/${id}`)
      .then(r => r.json())
      .then(data => {
        setForm(data)
        const init = {}
        if (Array.isArray(data.fields)) {
          data.fields.forEach(f => {
            init[f.id] = f.type === 'checkbox' ? false : (f.type === 'user_picker' && f.multi ? [] : '')
          })
          // Fetch Graph users if any user_picker fields exist
          if (data.fields.some(f => f.type === 'user_picker')) {
            setGraphUsersLoading(true)
            portalFetch(`/api/portal/graph/users?form_id=${id}`)
              .then(r => r.json())
              .then(d => setGraphUsers(d.users || []))
              .catch(() => setGraphUsers([]))
              .finally(() => setGraphUsersLoading(false))
          }
          // group_picker fields now do live debounced search internally — no upfront fetch needed
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
        const empty = val === undefined || val === null || val === '' || val === false
          || (Array.isArray(val) && val.length === 0)
        if (empty) {
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

    if (upnCheck.exists && activeUpn) {
      setError(`${activeUpn} is already taken. Please choose a different email address.`)
      return
    }

    // For split-email fields, combine the local part with the contact's domain
    // so field_values always stores a complete email address
    const submittedValues = { ...values }
    for (const field of form.fields || []) {
      const isSplit = contactDomain && (
        (isCreateUser && field.id === emailFieldId) ||
        (isCreateSharedMailbox && field.id === mailboxEmailFieldId)
      )
      if (isSplit) {
        const local = (submittedValues[field.id] || '').trim()
        if (local && !local.includes('@')) {
          submittedValues[field.id] = `${local}@${contactDomain}`
        }
      }
    }

    setSubmitting(true)
    try {
      const res = await portalFetch(`/api/portal/service-catalog/${id}/submit`, {
        method: 'POST',
        body: JSON.stringify({ field_values: submittedValues }),
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
    const isSplitEmail = contactDomain && (
      (isCreateUser && field.id === emailFieldId) ||
      (isCreateSharedMailbox && field.id === mailboxEmailFieldId)
    )

    return (
      <div key={field.id} className={styles.fieldGroup}>
        {field.type !== 'checkbox' && (
          <label className={styles.fieldLabel} htmlFor={field.id}>
            {field.label}
            {field.required && <span className={styles.requiredStar}>*</span>}
          </label>
        )}

        {isSplitEmail && (
          <div className={styles.splitEmailWrap}>
            <input
              id={field.id}
              type="text"
              className={styles.splitEmailLocal}
              placeholder="e.g. jane"
              value={values[field.id] || ''}
              onChange={e => setValue(field.id, e.target.value.toLowerCase().replace(/[^a-z0-9._-]/g, ''))}
              autoComplete="off"
              spellCheck={false}
            />
            <span className={styles.splitEmailDomain}>@{contactDomain}</span>
          </div>
        )}

        {!isSplitEmail && field.type === 'text' && (
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
              <option key={i} value={opt.value || opt.label}>{opt.label}</option>
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

        {field.type === 'user_picker' && (
          <UserPickerField
            multi={field.multi || false}
            value={values[field.id]}
            onChange={val => setValue(field.id, val)}
            users={graphUsers}
            loading={graphUsersLoading}
          />
        )}

        {field.type === 'group_picker' && (
          <GroupPickerField
            value={values[field.id] || ''}
            onChange={val => setValue(field.id, val)}
            formId={id}
          />
        )}

        {field.helpText && (
          <p className={styles.fieldHelpText}>{field.helpText}</p>
        )}
      </div>
    )
  }

  // Contact domain for UPN preview and split email
  const contact = useMemo(() => {
    try { return JSON.parse(localStorage.getItem('portal_contact') || 'null') } catch { return null }
  }, [])
  const contactDomain = contact?.email?.split('@')[1] || null
  const isCreateUser = form?.automation_action?.type === 'create_user'
  const isCreateSharedMailbox = form?.automation_action?.type === 'create_shared_mailbox'
  const firstNameFieldId = isCreateUser ? form?.automation_action?.field_map?.first_name : null
  const lastNameFieldId  = isCreateUser ? form?.automation_action?.field_map?.last_name  : null
  const emailFieldId     = isCreateUser ? form?.automation_action?.field_map?.email       : null
  const mailboxEmailFieldId = isCreateSharedMailbox ? form?.automation_action?.field_map?.email : null

  const previewUpn = useMemo(() => {
    if (!isCreateUser || !contactDomain || !firstNameFieldId) return null
    const emailVal = emailFieldId ? (values[emailFieldId] || '') : ''
    if (emailVal.trim()) return null
    const firstName = values[firstNameFieldId] || ''
    const local = firstName.toLowerCase().replace(/[^a-z0-9]/g, '')
    if (!local) return null
    return `${local}@${contactDomain}`
  }, [isCreateUser, contactDomain, firstNameFieldId, emailFieldId, values])

  // Suggested fallback UPN using last name initial (shown when previewUpn is taken)
  const suggestedUpn = useMemo(() => {
    if (!previewUpn || !lastNameFieldId) return null
    const lastName = values[lastNameFieldId] || ''
    const lastLocal = lastName.toLowerCase().replace(/[^a-z0-9]/g, '')
    if (!lastLocal) return null
    const firstName = values[firstNameFieldId] || ''
    const firstLocal = firstName.toLowerCase().replace(/[^a-z0-9]/g, '')
    return `${firstLocal}${lastLocal[0]}@${contactDomain}`
  }, [previewUpn, lastNameFieldId, firstNameFieldId, contactDomain, values])

  // The UPN we're actually going to use — local-part typed, full email typed, or auto-derived
  const explicitEmail = emailFieldId ? (values[emailFieldId] || '').trim() : ''
  const activeUpn = explicitEmail.includes('@')
    ? explicitEmail
    : (explicitEmail && contactDomain ? `${explicitEmail}@${contactDomain}` : previewUpn)

  // Debounced real-time UPN existence check against whichever UPN is active
  useEffect(() => {
    if (!activeUpn) {
      setUpnCheck({ checking: false, exists: null, checked: false })
      return
    }
    setUpnCheck(prev => ({ ...prev, checking: true }))
    clearTimeout(upnCheckTimer.current)
    upnCheckTimer.current = setTimeout(async () => {
      try {
        const res = await portalFetch(`/api/portal/check-upn?upn=${encodeURIComponent(activeUpn)}&form_id=${id}`)
        const data = await res.json()
        setUpnCheck({ checking: false, exists: data.exists, checked: data.checked })
      } catch {
        setUpnCheck({ checking: false, exists: null, checked: false })
      }
    }, 600)
    return () => clearTimeout(upnCheckTimer.current)
  }, [activeUpn, id])

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

          {activeUpn && upnCheck.checking && (
            <div className={styles.upnPreview}>
              <span className={styles.upnPreviewIcon}>⏳</span>
              <span>Checking availability of <strong>{activeUpn}</strong>…</span>
            </div>
          )}
          {activeUpn && !upnCheck.checking && upnCheck.exists === false && (
            <div className={styles.upnPreview}>
              <span className={styles.upnPreviewIcon}>📧</span>
              <span>Account will be created as <strong>{activeUpn}</strong></span>
            </div>
          )}
          {activeUpn && !upnCheck.checking && upnCheck.exists === true && (
            <div className={styles.upnPreviewTaken}>
              <span className={styles.upnPreviewIcon}>⚠️</span>
              <span>
                <strong>{activeUpn}</strong> is already in use.
                {previewUpn && suggestedUpn && <> Try <strong>{suggestedUpn}</strong> — or type a different email above.</>}
                {(!previewUpn || !suggestedUpn) && <> Please type a different email address above.</>}
              </span>
            </div>
          )}

          {error && <div className={styles.errorMsg}>{error}</div>}

          <button type="submit" className={styles.btnPrimary} disabled={submitting} style={{ marginTop: 8 }}>
            {submitting ? 'Submitting…' : 'Submit Request'}
          </button>
        </form>
      </div>
    </div>
  )
}
