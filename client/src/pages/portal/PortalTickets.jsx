import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { portalFetch } from '../../utils/portalApi'
import styles from './Portal.module.css'

const STATUS_TABS = ['All', 'Open', 'In Progress', 'On Hold', 'Resolved']

function statusBadgeClass(status) {
  switch (status) {
    case 'open': return styles.badgeOpen
    case 'in_progress': return styles.badgeInProgress
    case 'on_hold': return styles.badgeOnHold
    case 'resolved': return styles.badgeResolved
    default: return styles.badge
  }
}

function priorityBadgeClass(priority) {
  switch (priority) {
    case 'high': return styles.badgeHigh
    case 'medium': return styles.badgeMedium
    default: return styles.badgeLow
  }
}

function formatDate(d) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

export default function PortalTickets() {
  const [tickets, setTickets] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [activeTab, setActiveTab] = useState('All')

  useEffect(() => {
    portalFetch('/api/portal/tickets')
      .then(r => r.json())
      .then(data => setTickets(Array.isArray(data) ? data : []))
      .finally(() => setLoading(false))
  }, [])

  const filtered = tickets.filter(t => {
    const matchSearch = !search ||
      t.subject?.toLowerCase().includes(search.toLowerCase()) ||
      t.reference?.toLowerCase().includes(search.toLowerCase())

    const tabStatus = activeTab.toLowerCase().replace(' ', '_')
    const matchTab = activeTab === 'All' || t.status === tabStatus

    return matchSearch && matchTab
  })

  if (loading) return <div className={styles.loadingState}>Loading…</div>

  return (
    <div>
      <div className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>My Tickets</h1>
        <input
          className={styles.searchInput}
          type="text"
          placeholder="Search tickets…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      <div className={styles.filterTabs}>
        {STATUS_TABS.map(tab => (
          <button
            key={tab}
            className={`${styles.filterTab} ${activeTab === tab ? styles.filterTabActive : ''}`}
            onClick={() => setActiveTab(tab)}
          >
            {tab}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className={styles.emptyState}>No tickets found.</div>
      ) : (
        filtered.map(t => (
          <Link to={`/portal/tickets/${t.id}`} key={t.id} className={styles.ticketCard}>
            <div>
              <div className={styles.ticketRef}>{t.reference}</div>
              <div className={styles.ticketSubject}>{t.subject}</div>
              <div className={styles.ticketMeta}>Updated {formatDate(t.updated_at)}</div>
            </div>
            <div className={styles.ticketRight}>
              <span className={`${styles.badge} ${statusBadgeClass(t.status)}`}>
                {t.status?.replace('_', ' ')}
              </span>
              <span className={`${styles.badge} ${priorityBadgeClass(t.priority)}`}>
                {t.priority}
              </span>
            </div>
          </Link>
        ))
      )}
    </div>
  )
}
