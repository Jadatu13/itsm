import { useEffect, useRef, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiFetch } from '../utils/api'
import styles from './GlobalSearch.module.css'

const GROUPS = [
  { key: 'tickets',       label: 'Tickets',       icon: '🎫' },
  { key: 'contacts',      label: 'Contacts',       icon: '👤' },
  { key: 'organisations', label: 'Organisations',  icon: '🏢' },
  { key: 'articles',      label: 'KB Articles',    icon: '📚' },
]

function resultPath(group, item) {
  if (group === 'tickets')       return `/tickets/${item.id}`
  if (group === 'contacts')      return `/contacts/${item.id}`
  if (group === 'organisations') return `/organisations/${item.id}`
  if (group === 'articles')      return `/kb` // KB doesn't have a per-article page in the agent UI
  return '/'
}

function resultLabel(group, item) {
  if (group === 'tickets')       return `${item.reference} — ${item.subject}`
  if (group === 'contacts')      return item.full_name + (item.email ? ` (${item.email})` : '')
  if (group === 'organisations') return item.name
  if (group === 'articles')      return item.title + (item.folder_name ? ` · ${item.folder_name}` : '')
  return ''
}

function resultMeta(group, item) {
  if (group === 'tickets') return `${item.status?.replace('_', ' ')} · ${item.priority}${item.contact_name ? ` · ${item.contact_name}` : ''}`
  if (group === 'contacts') return item.organisation_name || null
  return null
}

export default function GlobalSearch({ onClose }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState({ tickets: [], contacts: [], organisations: [], articles: [] })
  const [loading, setLoading] = useState(false)
  const [activeIdx, setActiveIdx] = useState(-1)
  const navigate = useNavigate()
  const inputRef = useRef(null)
  const timerRef = useRef(null)

  // Build a flat list of all results for keyboard nav
  const flatResults = GROUPS.flatMap(g =>
    (results[g.key] || []).map(item => ({ group: g.key, item }))
  )

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const doSearch = useCallback((q) => {
    if (q.trim().length < 2) {
      setResults({ tickets: [], contacts: [], organisations: [], articles: [] })
      setLoading(false)
      return
    }
    setLoading(true)
    apiFetch(`/api/search?q=${encodeURIComponent(q.trim())}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data) setResults(data)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  function handleChange(e) {
    const q = e.target.value
    setQuery(q)
    setActiveIdx(-1)
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => doSearch(q), 250)
  }

  function handleNavigate(group, item) {
    navigate(resultPath(group, item))
    onClose()
  }

  function handleKeyDown(e) {
    if (e.key === 'Escape') {
      onClose()
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIdx(i => Math.min(i + 1, flatResults.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIdx(i => Math.max(i - 1, 0))
    } else if (e.key === 'Enter' && activeIdx >= 0 && flatResults[activeIdx]) {
      e.preventDefault()
      const { group, item } = flatResults[activeIdx]
      handleNavigate(group, item)
    }
  }

  const hasResults = GROUPS.some(g => (results[g.key] || []).length > 0)
  const showEmpty  = query.trim().length >= 2 && !loading && !hasResults

  // Track flat index per group/item for active highlight
  let flatCounter = -1

  return (
    <>
      <div className={styles.overlay} onClick={onClose} />
      <div className={styles.modal} role="dialog" aria-label="Global search">
        <div className={styles.inputRow}>
          <svg className={styles.searchIcon} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input
            ref={inputRef}
            className={styles.input}
            placeholder="Search tickets, contacts, orgs, KB articles…"
            value={query}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            autoComplete="off"
            spellCheck={false}
          />
          {loading && <span className={styles.spinner} />}
          <kbd className={styles.esc} onClick={onClose}>Esc</kbd>
        </div>

        {(hasResults || showEmpty) && (
          <div className={styles.results}>
            {showEmpty && (
              <div className={styles.empty}>No results for <strong>"{query.trim()}"</strong></div>
            )}

            {GROUPS.map(g => {
              const items = results[g.key] || []
              if (!items.length) return null
              return (
                <div key={g.key} className={styles.group}>
                  <div className={styles.groupLabel}>{g.icon} {g.label}</div>
                  {items.map(item => {
                    flatCounter++
                    const idx = flatCounter
                    const isActive = idx === activeIdx
                    const meta = resultMeta(g.key, item)
                    return (
                      <div
                        key={item.id}
                        className={`${styles.resultItem} ${isActive ? styles.active : ''}`}
                        onClick={() => handleNavigate(g.key, item)}
                        onMouseEnter={() => setActiveIdx(idx)}
                      >
                        <span className={styles.resultLabel}>{resultLabel(g.key, item)}</span>
                        {meta && <span className={styles.resultMeta}>{meta}</span>}
                      </div>
                    )
                  })}
                </div>
              )
            })}
          </div>
        )}

        {query.trim().length < 2 && !hasResults && (
          <div className={styles.hint}>
            Type at least 2 characters to search&nbsp;&mdash;&nbsp;
            <span>use &uarr;&darr; to navigate, Enter to open, Esc to close</span>
          </div>
        )}
      </div>
    </>
  )
}
