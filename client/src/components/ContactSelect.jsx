import { useState, useRef, useEffect } from 'react'
import styles from './ContactSelect.module.css'

/**
 * A searchable contact picker.
 * Props:
 *  - contacts: array of contact objects (id, full_name, email, organisation_name)
 *  - value: currently selected contact id (string or number)
 *  - onChange: (id: string) => void — called with '' to clear
 */
export default function ContactSelect({ contacts, value, onChange }) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const wrapRef = useRef(null)
  const inputRef = useRef(null)

  const selected = contacts.find(c => String(c.id) === String(value))

  const filtered = (
    query.trim()
      ? contacts.filter(c =>
          `${c.full_name} ${c.email} ${c.organisation_name ?? ''}`.toLowerCase()
            .includes(query.toLowerCase())
        )
      : [...contacts]
  ).sort((a, b) => a.full_name.localeCompare(b.full_name))

  // Close on outside click
  useEffect(() => {
    function handleOutside(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setOpen(false)
        setQuery('')
      }
    }
    document.addEventListener('mousedown', handleOutside)
    return () => document.removeEventListener('mousedown', handleOutside)
  }, [])

  function handleSelect(contact) {
    onChange(String(contact.id))
    setOpen(false)
    setQuery('')
  }

  function handleClear(e) {
    e.stopPropagation()
    onChange('')
    setQuery('')
    setOpen(false)
  }

  function handleInputChange(e) {
    setQuery(e.target.value)
    if (!e.target.value) onChange('')
    setOpen(true)
  }

  function openDropdown() {
    setOpen(true)
    setQuery('')
    setTimeout(() => inputRef.current?.focus(), 0)
  }

  return (
    <div className={styles.wrap} ref={wrapRef}>
      {/* Trigger / selected display */}
      {selected && !open ? (
        <div className={styles.pill} onClick={openDropdown}>
          <span className={styles.pillName}>{selected.full_name}</span>
          <span className={styles.pillEmail}>{selected.email}</span>
          <button type="button" className={styles.clearBtn} onClick={handleClear} title="Clear">×</button>
        </div>
      ) : (
        <input
          ref={inputRef}
          className={styles.input}
          type="text"
          value={query}
          onChange={handleInputChange}
          onFocus={() => setOpen(true)}
          placeholder={selected ? selected.full_name : 'Type a name or email…'}
          autoComplete="off"
        />
      )}

      {/* Dropdown */}
      {open && (
        <div className={styles.dropdown}>
          {filtered.length === 0 ? (
            <div className={styles.empty}>No contacts match "{query}"</div>
          ) : (
            filtered.slice(0, 60).map(c => (
              <div
                key={c.id}
                className={`${styles.option} ${String(c.id) === String(value) ? styles.optionActive : ''}`}
                onMouseDown={() => handleSelect(c)}
              >
                <span className={styles.optName}>{c.full_name}</span>
                <span className={styles.optMeta}>
                  {c.email}
                  {c.organisation_name && <> · {c.organisation_name}</>}
                </span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}
