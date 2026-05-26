import { useEffect, useState, useRef } from 'react'
import { apiFetch } from '../utils/api'
import styles from './ServiceCatalog.module.css'

// M365 automation action definitions (mirrors server/graphExecutor.js)
const ACTION_TYPES = {
  none:                    { label: 'No automation',                params: [] },
  create_user:             { label: 'Create Entra ID User',         params: [
    { key: 'first_name',    label: 'First Name',        required: true  },
    { key: 'last_name',     label: 'Last Name',         required: true  },
    { key: 'email',         label: 'Email / UPN',       required: true  },
    { key: 'display_name',  label: 'Display Name',      required: false },
    { key: 'job_title',     label: 'Job Title',         required: false },
    { key: 'department',    label: 'Department',        required: false },
    { key: 'license_sku',   label: 'License SKU',       required: false },
  ]},
  reset_password:          { label: 'Reset User Password',          params: [
    { key: 'email', label: 'User Email / UPN', required: true },
  ]},
  add_mailbox_permission:  { label: 'Add Mailbox Permission',       params: [
    { key: 'mailbox_email',   label: 'Mailbox Email',                       required: true  },
    { key: 'user_email',      label: 'Grant Access To (email)',              required: true  },
    { key: 'permission_type', label: 'Permission (FullAccess / SendAs / SendOnBehalf)', required: true },
  ]},
  remove_mailbox_permission: { label: 'Remove Mailbox Permission',  params: [
    { key: 'mailbox_email',   label: 'Mailbox Email',              required: true  },
    { key: 'user_email',      label: 'Remove Access From (email)', required: true  },
    { key: 'permission_type', label: 'Permission Type',            required: true  },
  ]},
  create_shared_mailbox:   { label: 'Create Shared Mailbox',        params: [
    { key: 'display_name', label: 'Display Name', required: true },
    { key: 'email',        label: 'Email Address', required: true },
  ]},
  add_to_group:            { label: 'Add User to M365 Group / Team', params: [
    { key: 'user_email', label: 'User Email',         required: true },
    { key: 'group_name', label: 'Group or Team Name', required: true },
  ]},
  remove_from_group:       { label: 'Remove User from Group / Team', params: [
    { key: 'user_email', label: 'User Email',         required: true },
    { key: 'group_name', label: 'Group or Team Name', required: true },
  ]},
  disable_account:         { label: 'Disable User Account',          params: [
    { key: 'email', label: 'User Email / UPN', required: true },
  ]},
  enable_account:          { label: 'Enable User Account',           params: [
    { key: 'email', label: 'User Email / UPN', required: true },
  ]},
}

const ICONS = ['📋', '💻', '📧', '👤', '🔒', '🗂', '🖨', '📞', '🌐', '⚙️']
const CATEGORIES = [
  { value: 'general', label: 'General' },
  { value: 'access_permissions', label: 'Access & Permissions' },
  { value: 'hardware', label: 'Hardware' },
  { value: 'software', label: 'Software' },
  { value: 'account_management', label: 'Account Management' },
  { value: 'network', label: 'Network' },
  { value: 'other', label: 'Other' },
]
const PRIORITIES = ['low', 'medium', 'high']
const TICKET_CATEGORIES = ['general', 'access_permissions', 'hardware', 'software', 'account_management', 'network', 'other']

const VALIDATION_TYPES = [
  { value: 'none',        label: 'None' },
  { value: 'email',       label: 'Email address',   pattern: '^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$',  message: 'Please enter a valid email address.' },
  { value: 'phone_nz',    label: 'NZ Phone number', pattern: '^(\\+64|0)[2-9]\\d{7,9}$',        message: 'Please enter a valid NZ phone number.' },
  { value: 'phone',       label: 'Phone number',    pattern: '^[\\+\\d\\s\\-\\(\\)]{7,20}$',    message: 'Please enter a valid phone number.' },
  { value: 'url',         label: 'URL',             pattern: '^https?:\\/\\/.+',                 message: 'Please enter a valid URL starting with http:// or https://.' },
  { value: 'postcode_nz', label: 'NZ Postcode',     pattern: '^\\d{4}$',                         message: 'Please enter a valid 4-digit NZ postcode.' },
  { value: 'custom',      label: 'Custom regex',    pattern: '',                                 message: '' },
]

const PALETTE_TYPES = [
  { type: 'text', label: 'Short Text', icon: '📝' },
  { type: 'textarea', label: 'Long Text', icon: '📄' },
  { type: 'checkbox', label: 'Checkbox', icon: '☑️' },
  { type: 'date', label: 'Date', icon: '📅' },
  { type: 'number', label: 'Number', icon: '🔢' },
  { type: 'select', label: 'Dropdown', icon: '🔽' },
  { type: 'radio', label: 'Radio Buttons', icon: '⚫' },
]

function makeField(type) {
  return {
    id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()),
    type,
    label: PALETTE_TYPES.find(p => p.type === type)?.label || 'Field',
    placeholder: '',
    helpText: '',
    required: false,
    layout: 'full',
    validation: { type: 'none', pattern: '', message: '' },
    options: type === 'select' || type === 'radio' ? [{ label: 'Option 1' }] : [],
  }
}

function formatDate(d) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

// ── FormBuilder Modal ─────────────────────────────────────────────────────────
function FormBuilderModal({ form, onClose, onSave }) {
  const [name, setName] = useState(form?.name || '')
  const [description, setDescription] = useState(form?.description || '')
  const [icon, setIcon] = useState(form?.icon || '📋')
  const [category, setCategory] = useState(form?.category || 'general')
  const [fields, setFields] = useState(form?.fields || [])
  const [ticketPriority, setTicketPriority] = useState(form?.ticket_priority || 'medium')
  const [ticketCategory, setTicketCategory] = useState(form?.ticket_category || '')
  const [subjectTemplate, setSubjectTemplate] = useState(form?.ticket_subject_template || '')
  const [requiresApproval, setRequiresApproval] = useState(form?.requires_approval || false)
  const [automationAction, setAutomationAction] = useState(
    form?.automation_action || { type: 'none', field_map: {}, fixed_values: {} }
  )
  const [tenants, setTenants] = useState([])
  const [automationTenantId, setAutomationTenantId] = useState(form?.automation_tenant_id || '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [pendingFocus, setPendingFocus] = useState(null) // { fieldId, idx }

  // Load tenants for automation config
  useEffect(() => {
    apiFetch('/api/tenants').then(r => r.json()).then(d => setTenants(Array.isArray(d) ? d : [])).catch(() => {})
  }, [])

  // Auto-focus newly added options
  useEffect(() => {
    if (!pendingFocus) return
    const el = document.getElementById(`opt-${pendingFocus.fieldId}-${pendingFocus.idx}`)
    if (el) { el.focus(); el.select() }
    setPendingFocus(null)
  }, [pendingFocus, fields])

  // Drag state
  const dragSourceRef = useRef(null) // { source: 'palette'|'canvas', type?, index? }
  const [dragOverIndex, setDragOverIndex] = useState(null)
  const [canvasOver, setCanvasOver] = useState(false)

  function handlePaletteDragStart(e, type) {
    dragSourceRef.current = { source: 'palette', type }
    e.dataTransfer.effectAllowed = 'copy'
  }

  function handleFieldDragStart(e, index) {
    dragSourceRef.current = { source: 'canvas', index }
    e.dataTransfer.effectAllowed = 'move'
  }

  function handleCanvasDragOver(e) {
    e.preventDefault()
    setCanvasOver(true)
  }

  function handleCanvasDragLeave(e) {
    if (!e.currentTarget.contains(e.relatedTarget)) {
      setCanvasOver(false)
      setDragOverIndex(null)
    }
  }

  function handleFieldDragOver(e, index) {
    e.preventDefault()
    e.stopPropagation()
    setDragOverIndex(index)
  }

  function handleCanvasDrop(e) {
    e.preventDefault()
    setCanvasOver(false)
    setDragOverIndex(null)
    const src = dragSourceRef.current
    if (!src) return

    if (src.source === 'palette') {
      setFields(prev => [...prev, makeField(src.type)])
    }
    dragSourceRef.current = null
  }

  function handleFieldDrop(e, dropIndex) {
    e.preventDefault()
    e.stopPropagation()
    setCanvasOver(false)
    setDragOverIndex(null)
    const src = dragSourceRef.current
    if (!src) return

    if (src.source === 'palette') {
      const newField = makeField(src.type)
      setFields(prev => {
        const next = [...prev]
        next.splice(dropIndex, 0, newField)
        return next
      })
    } else if (src.source === 'canvas' && src.index !== dropIndex) {
      setFields(prev => {
        const next = [...prev]
        const [moved] = next.splice(src.index, 1)
        const insertAt = src.index < dropIndex ? dropIndex - 1 : dropIndex
        next.splice(insertAt, 0, moved)
        return next
      })
    }
    dragSourceRef.current = null
  }

  function updateField(id, patch) {
    setFields(prev => prev.map(f => f.id === id ? { ...f, ...patch } : f))
  }

  function deleteField(id) {
    setFields(prev => prev.filter(f => f.id !== id))
  }

  function addOption(fieldId) {
    setFields(prev => prev.map(f => f.id === fieldId
      ? { ...f, options: [...f.options, { label: `Option ${f.options.length + 1}` }] }
      : f
    ))
  }

  function updateOption(fieldId, optIdx, label) {
    setFields(prev => prev.map(f => {
      if (f.id !== fieldId) return f
      const options = f.options.map((o, i) => i === optIdx ? { label } : o)
      return { ...f, options }
    }))
  }

  function removeOption(fieldId, optIdx) {
    setFields(prev => prev.map(f => {
      if (f.id !== fieldId) return f
      return { ...f, options: f.options.filter((_, i) => i !== optIdx) }
    }))
  }

  async function handleSave() {
    if (!name.trim()) { setError('Form name is required.'); return }
    setSaving(true)
    setError('')
    try {
      const body = JSON.stringify({
        name, description, icon, category, fields,
        ticket_priority: ticketPriority,
        ticket_category: ticketCategory || null,
        ticket_subject_template: subjectTemplate || null,
        enabled: form?.enabled !== false,
        sort_order: form?.sort_order || 0,
        requires_approval: requiresApproval,
        automation_action: automationAction.type !== 'none' ? automationAction : null,
        automation_tenant_id: automationTenantId || null,
      })
      const url = form?.id ? `/api/service-catalog/${form.id}` : '/api/service-catalog'
      const method = form?.id ? 'PUT' : 'POST'
      const res = await apiFetch(url, { method, body })
      const data = await res.json()
      if (!res.ok) { setError(data.error || 'Save failed.'); return }
      onSave(data)
    } catch {
      setError('Save failed.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className={styles.modalOverlay} onClick={e => e.target === e.currentTarget && onClose()}>
      <div className={styles.modal}>
        <div className={styles.modalHeader}>
          <h2 className={styles.modalTitle}>{form?.id ? 'Edit Form' : 'New Service Request Form'}</h2>
          <button className={styles.modalClose} onClick={onClose}>×</button>
        </div>

        <div className={styles.modalBody}>
          {/* Palette */}
          <div className={styles.palette}>
            <p className={styles.paletteTitle}>Add Fields</p>
            {PALETTE_TYPES.map(pt => (
              <div
                key={pt.type}
                className={styles.paletteItem}
                draggable
                onDragStart={e => handlePaletteDragStart(e, pt.type)}
                onClick={() => setFields(prev => [...prev, makeField(pt.type)])}
                title={`Click or drag to add ${pt.label}`}
              >
                <span>{pt.icon}</span>
                <span>{pt.label}</span>
              </div>
            ))}
          </div>

          {/* Canvas */}
          <div className={styles.canvas}>
            {/* Form metadata */}
            <div className={styles.canvasRow}>
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>Form Name *</label>
                <input
                  className={styles.formInput}
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="e.g. New Software Request"
                />
              </div>
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>Category</label>
                <select className={styles.formSelect} value={category} onChange={e => setCategory(e.target.value)}>
                  {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              </div>
            </div>

            <div className={styles.canvasFullRow}>
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>Description</label>
                <textarea className={styles.formTextarea} value={description} onChange={e => setDescription(e.target.value)} placeholder="Brief description shown on the catalog card" />
              </div>
            </div>

            <div className={styles.canvasFullRow}>
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>Icon</label>
                <div className={styles.iconPicker}>
                  {ICONS.map(i => (
                    <button
                      key={i}
                      type="button"
                      className={`${styles.iconBtn} ${icon === i ? styles.iconBtnActive : ''}`}
                      onClick={() => setIcon(i)}
                    >
                      {i}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <hr className={styles.sectionDivider} />
            <p className={styles.sectionLabel}>Form Fields</p>

            <div
              className={`${styles.fieldsArea} ${canvasOver ? styles.fieldsAreaOver : ''}`}
              onDragOver={handleCanvasDragOver}
              onDragLeave={handleCanvasDragLeave}
              onDrop={handleCanvasDrop}
            >
              {fields.length === 0 && (
                <div className={styles.emptyFieldsHint}>
                  Click or drag fields from the left panel to add them here.
                </div>
              )}
              {fields.map((field, idx) => (
                <div
                  key={field.id}
                  className={`${styles.fieldCard} ${dragOverIndex === idx ? styles.fieldCardDragging : ''}`}
                  onDragOver={e => handleFieldDragOver(e, idx)}
                  onDrop={e => handleFieldDrop(e, idx)}
                >
                  <span
                    className={styles.dragHandle}
                    draggable
                    onDragStart={e => handleFieldDragStart(e, idx)}
                    title="Drag to reorder"
                  >
                    ⠿
                  </span>
                  <div className={styles.fieldCardBody}>
                    {/* Row 1: label | type badge | layout | required | delete */}
                    <div className={styles.fieldCardRow}>
                      <input
                        className={styles.fieldLabelInput}
                        value={field.label}
                        onChange={e => updateField(field.id, { label: e.target.value })}
                        placeholder="Field label"
                      />
                      <span className={styles.fieldTypeBadge}>
                        {PALETTE_TYPES.find(p => p.type === field.type)?.icon} {field.type}
                      </span>
                      <div className={styles.layoutToggle}>
                        <button type="button"
                          className={`${styles.layoutBtn} ${(field.layout || 'full') === 'full' ? styles.layoutBtnActive : ''}`}
                          onClick={() => updateField(field.id, { layout: 'full' })}
                          title="Full width">■ Full</button>
                        <button type="button"
                          className={`${styles.layoutBtn} ${field.layout === 'half' ? styles.layoutBtnActive : ''}`}
                          onClick={() => updateField(field.id, { layout: 'half' })}
                          title="Half width">▪▪ Half</button>
                      </div>
                      <label className={styles.requiredToggle}>
                        <input type="checkbox" checked={field.required}
                          onChange={e => updateField(field.id, { required: e.target.checked })} />
                        Req
                      </label>
                      <button type="button" className={styles.fieldDeleteBtn}
                        onClick={() => deleteField(field.id)} title="Remove">×</button>
                    </div>

                    {/* Row 2: placeholder + validation (text fields) */}
                    {(field.type === 'text' || field.type === 'textarea' || field.type === 'number') && (
                      <div className={styles.fieldCardRow}>
                        <input className={styles.fieldSmInput}
                          value={field.placeholder}
                          onChange={e => updateField(field.id, { placeholder: e.target.value })}
                          placeholder="Placeholder (optional)" />
                        <select className={styles.fieldSmSelect}
                          value={field.validation?.type || 'none'}
                          onChange={e => {
                            const vt = VALIDATION_TYPES.find(v => v.value === e.target.value)
                            updateField(field.id, { validation: {
                              type: e.target.value,
                              pattern: vt?.value !== 'custom' ? (vt?.pattern || '') : '',
                              message: vt?.value !== 'custom' ? (vt?.message || '') : '',
                            }})
                          }}>
                          {VALIDATION_TYPES.map(v => <option key={v.value} value={v.value}>{v.label}</option>)}
                        </select>
                      </div>
                    )}

                    {/* Row 3: custom regex pattern + error message */}
                    {(field.type === 'text' || field.type === 'textarea' || field.type === 'number') && field.validation?.type === 'custom' && (
                      <div className={styles.fieldCardRow}>
                        <input className={styles.fieldSmInput}
                          value={field.validation?.pattern || ''}
                          onChange={e => updateField(field.id, { validation: { ...field.validation, pattern: e.target.value } })}
                          placeholder="Regex, e.g. ^[A-Z]{3}\\d{4}$" />
                        <input className={styles.fieldSmInput}
                          value={field.validation?.message || ''}
                          onChange={e => updateField(field.id, { validation: { ...field.validation, message: e.target.value } })}
                          placeholder="Error message" />
                      </div>
                    )}

                    {/* Options list for select/radio */}
                    {(field.type === 'select' || field.type === 'radio') && (
                      <div className={styles.optionsList}>
                        {field.options.map((opt, oi) => (
                          <div key={oi} className={styles.optionRow}>
                            <input
                              id={`opt-${field.id}-${oi}`}
                              className={styles.optionInput}
                              value={opt.label}
                              onChange={e => updateOption(field.id, oi, e.target.value)}
                              placeholder={`Option ${oi + 1}`}
                              onKeyDown={e => {
                                if (e.key === 'Enter') {
                                  e.preventDefault()
                                  addOption(field.id)
                                  setPendingFocus({ fieldId: field.id, idx: field.options.length })
                                }
                              }}
                            />
                            <button type="button" className={`${styles.btnXs} ${styles.btnXsDanger}`}
                              onClick={() => removeOption(field.id, oi)}>×</button>
                          </div>
                        ))}
                        <button type="button" className={styles.btnXs} onClick={() => {
                          addOption(field.id)
                          setPendingFocus({ fieldId: field.id, idx: field.options.length })
                        }}>
                          + Add option
                        </button>
                      </div>
                    )}

                    {/* Help text — always last */}
                    <div className={styles.fieldCardRow}>
                      <input className={styles.fieldSmInput}
                        value={field.helpText}
                        onChange={e => updateField(field.id, { helpText: e.target.value })}
                        placeholder="Help text (optional)" />
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <hr className={styles.sectionDivider} />
            <p className={styles.sectionLabel}>Ticket Settings</p>

            <div className={styles.canvasRow}>
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>Default Priority</label>
                <select className={styles.formSelect} value={ticketPriority} onChange={e => setTicketPriority(e.target.value)}>
                  {PRIORITIES.map(p => <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>)}
                </select>
              </div>
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>Ticket Category</label>
                <select className={styles.formSelect} value={ticketCategory} onChange={e => setTicketCategory(e.target.value)}>
                  <option value="">None</option>
                  {TICKET_CATEGORIES.map(c => <option key={c} value={c}>{c.replace('_', ' ')}</option>)}
                </select>
              </div>
            </div>

            <div className={styles.canvasFullRow}>
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>Subject Template</label>
                <input
                  className={styles.formInput}
                  value={subjectTemplate}
                  onChange={e => setSubjectTemplate(e.target.value)}
                  placeholder="e.g. New request: {{Software Name}}"
                />
                <p className={styles.hintText}>Use {'{{Field Label}}'} to include field values in the subject.</p>
              </div>
            </div>

            <hr className={styles.sectionDivider} />
            <p className={styles.sectionLabel}>⚙️ M365 Automation</p>

            {/* Requires approval toggle */}
            <div className={styles.canvasFullRow} style={{ marginBottom: 12 }}>
              <label className={styles.approvalToggleRow}>
                <input
                  type="checkbox"
                  checked={requiresApproval}
                  onChange={e => setRequiresApproval(e.target.checked)}
                />
                <span>
                  <strong>Require admin approval before executing</strong>
                  <span className={styles.toggleHint}> — submission goes to Approval Queue; you review and click Approve to run the action.</span>
                </span>
              </label>
            </div>

            {/* Action type select */}
            <div className={styles.canvasRow}>
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>Automation Action</label>
                <select
                  className={styles.formSelect}
                  value={automationAction.type}
                  onChange={e => setAutomationAction({ type: e.target.value, field_map: {}, fixed_values: {} })}
                >
                  {Object.entries(ACTION_TYPES).map(([key, def]) => (
                    <option key={key} value={key}>{def.label}</option>
                  ))}
                </select>
              </div>
              {tenants.length > 0 && (
                <div className={styles.formGroup}>
                  <label className={styles.formLabel}>Execute on Tenant</label>
                  <select
                    className={styles.formSelect}
                    value={automationTenantId}
                    onChange={e => setAutomationTenantId(e.target.value)}
                  >
                    <option value="">First connected tenant</option>
                    {tenants.map(t => (
                      <option key={t.id} value={t.id}>{t.display_name}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            {/* Parameter mapping — only when action selected */}
            {automationAction.type && automationAction.type !== 'none' && (
              <div className={styles.paramMapping}>
                <p className={styles.paramMappingTitle}>
                  Map form fields → action parameters
                </p>
                <p className={styles.paramMappingHint}>
                  For each parameter, choose a form field to use as the value, or enter a fixed value.
                </p>
                {ACTION_TYPES[automationAction.type]?.params.map(param => {
                  const mappedFieldId = automationAction.field_map?.[param.key] || ''
                  const fixedVal = automationAction.fixed_values?.[param.key] || ''
                  return (
                    <div key={param.key} className={styles.paramRow}>
                      <div className={styles.paramLabel}>
                        {param.label}
                        {param.required && <span className={styles.paramRequired}> *</span>}
                      </div>
                      <div className={styles.paramControls}>
                        <select
                          className={styles.paramSelect}
                          value={mappedFieldId}
                          onChange={e => setAutomationAction(prev => ({
                            ...prev,
                            field_map: { ...prev.field_map, [param.key]: e.target.value },
                          }))}
                        >
                          <option value="">— fixed value —</option>
                          {fields.map(f => (
                            <option key={f.id} value={f.id}>{f.label}</option>
                          ))}
                        </select>
                        {!mappedFieldId && (
                          <input
                            className={styles.paramFixed}
                            value={fixedVal}
                            onChange={e => setAutomationAction(prev => ({
                              ...prev,
                              fixed_values: { ...prev.fixed_values, [param.key]: e.target.value },
                            }))}
                            placeholder={`Fixed: ${param.label}`}
                          />
                        )}
                      </div>
                    </div>
                  )
                })}
                {tenants.length === 0 && (
                  <div className={styles.noTenantNote}>
                    🔌 No M365 tenant connected — actions will run in simulation mode.
                    <a href="/m365-tenants" target="_blank" rel="noopener noreferrer" style={{ marginLeft: 6 }}>
                      Connect a tenant →
                    </a>
                  </div>
                )}
              </div>
            )}

            {error && <div style={{ color: '#DC2626', fontSize: '0.875rem', marginTop: 8 }}>{error}</div>}
          </div>
        </div>

        <div className={styles.modalFooter}>
          <button className={styles.btnSecondary} onClick={onClose}>Cancel</button>
          <button className={styles.btnPrimary} onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save Form'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function ServiceCatalog() {
  const [forms, setForms] = useState([])
  const [submissions, setSubmissions] = useState([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('forms')
  const [editForm, setEditForm] = useState(null)     // null = closed, {} = new, form = edit
  const [showModal, setShowModal] = useState(false)

  useEffect(() => {
    Promise.all([
      apiFetch('/api/service-catalog').then(r => r.json()),
      apiFetch('/api/service-catalog/submissions').then(r => r.json()),
    ]).then(([f, s]) => {
      setForms(Array.isArray(f) ? f : [])
      setSubmissions(Array.isArray(s) ? s : [])
    }).finally(() => setLoading(false))
  }, [])

  function openNew() {
    setEditForm({})
    setShowModal(true)
  }

  function openEdit(form) {
    setEditForm(form)
    setShowModal(true)
  }

  function handleSave(saved) {
    setForms(prev => {
      const exists = prev.find(f => f.id === saved.id)
      return exists ? prev.map(f => f.id === saved.id ? saved : f) : [...prev, saved]
    })
    setShowModal(false)
  }

  async function handleDelete(id) {
    if (!confirm('Delete this form?')) return
    await apiFetch(`/api/service-catalog/${id}`, { method: 'DELETE' })
    setForms(prev => prev.filter(f => f.id !== id))
  }

  async function handleToggle(id) {
    const res = await apiFetch(`/api/service-catalog/${id}/toggle`, { method: 'PATCH' })
    const data = await res.json()
    setForms(prev => prev.map(f => f.id === id ? data : f))
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>Service Catalog</h1>
        <button className={styles.btnPrimary} onClick={openNew}>+ New Form</button>
      </div>

      <div className={styles.tabs}>
        <button
          className={`${styles.tab} ${activeTab === 'forms' ? styles.tabActive : ''}`}
          onClick={() => setActiveTab('forms')}
        >
          Forms
        </button>
        <button
          className={`${styles.tab} ${activeTab === 'submissions' ? styles.tabActive : ''}`}
          onClick={() => setActiveTab('submissions')}
        >
          Submissions
        </button>
      </div>

      {loading ? (
        <div className={styles.emptyState}>Loading…</div>
      ) : activeTab === 'forms' ? (
        forms.length === 0 ? (
          <div className={styles.emptyState}>No forms yet. Create one with "New Form".</div>
        ) : (
          <div className={styles.formsGrid}>
            {forms.map(f => (
              <div key={f.id} className={styles.formCard}>
                <div className={styles.formCardHeader}>
                  <span className={styles.formIcon}>{f.icon || '📋'}</span>
                  <div className={styles.formMeta}>
                    <p className={styles.formName}>{f.name}</p>
                    {f.description && <p className={styles.formDesc}>{f.description}</p>}
                  </div>
                </div>
                <div className={styles.formCardFooter}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <span className={`${styles.badge} ${f.enabled ? styles.badgeEnabled : styles.badgeDisabled}`}>
                      {f.enabled ? 'Enabled' : 'Disabled'}
                    </span>
                    <span className={styles.fieldCount}>
                      {Array.isArray(f.fields) ? f.fields.length : 0} fields
                    </span>
                    {f.automation_action?.type && f.automation_action.type !== 'none' && (
                      <span className={styles.automationBadge} title={`Auto: ${f.automation_action.type.replace(/_/g, ' ')}`}>
                        ⚙️ {f.automation_action.type.replace(/_/g, ' ')}
                      </span>
                    )}
                    {f.requires_approval && (
                      <span className={styles.approvalBadge}>⏳ Approval</span>
                    )}
                  </div>
                  <div className={styles.formCardActions}>
                    <button className={styles.btnIconSm} onClick={() => handleToggle(f.id)}>
                      {f.enabled ? 'Disable' : 'Enable'}
                    </button>
                    <button className={styles.btnIconSm} onClick={() => openEdit(f)}>Edit</button>
                    <button className={`${styles.btnIconSm} ${styles.btnDanger}`} onClick={() => handleDelete(f.id)}>Delete</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )
      ) : (
        submissions.length === 0 ? (
          <div className={styles.emptyState}>No submissions yet.</div>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Contact</th>
                <th>Form</th>
                <th>Ticket</th>
                <th>Status</th>
                <th>Submitted</th>
              </tr>
            </thead>
            <tbody>
              {submissions.map(s => (
                <tr key={s.id}>
                  <td>{s.contact_name || '—'}</td>
                  <td>{s.form_name || '—'}</td>
                  <td>
                    {s.ticket_reference
                      ? <span className={styles.ticketRef}>{s.ticket_reference}</span>
                      : '—'}
                  </td>
                  <td>{s.ticket_status || '—'}</td>
                  <td>{formatDate(s.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      )}

      {showModal && (
        <FormBuilderModal
          form={editForm}
          onClose={() => setShowModal(false)}
          onSave={handleSave}
        />
      )}
    </div>
  )
}
