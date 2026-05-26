import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { portalFetch } from '../../utils/portalApi'
import styles from './Portal.module.css'

function statusBadgeClass(status) {
  switch (status) {
    case 'open': return styles.badgeOpen
    case 'in_progress': return styles.badgeInProgress
    case 'on_hold': return styles.badgeOnHold
    case 'resolved': return styles.badgeResolved
    default: return styles.badge
  }
}

function formatDate(d) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

export default function PortalDashboard() {
  const [tickets, setTickets] = useState([])
  const [contact, setContact] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      portalFetch('/api/portal/me').then(r => r.json()),
      portalFetch('/api/portal/tickets').then(r => r.json()),
    ]).then(([me, tix]) => {
      setContact(me)
      setTickets(Array.isArray(tix) ? tix : [])
    }).finally(() => setLoading(false))
  }, [])

  const openCount = tickets.filter(t => t.status === 'open' || t.status === 'in_progress' || t.status === 'on_hold').length
  const resolvedCount = tickets.filter(t => t.status === 'resolved').length
  const recent = tickets.slice(0, 5)

  if (loading) return <div className={styles.loadingState}>Loading…</div>

  return (
    <div>
      <h1 className={styles.greeting}>
        Hello, {contact?.first_name} 👋
      </h1>

      <div className={styles.statsRow}>
        <div className={styles.statCard}>
          <div className={styles.statValue}>{openCount}</div>
          <div className={styles.statLabel}>Open Tickets</div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statValue}>{resolvedCount}</div>
          <div className={styles.statLabel}>Resolved</div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statValue}>{tickets.length}</div>
          <div className={styles.statLabel}>Total</div>
        </div>
      </div>

      <div className={styles.grid2}>
        <div>
          <div className={styles.card}>
            <p className={styles.sectionTitle}>Recent Tickets</p>
            {recent.length === 0 ? (
              <div className={styles.emptyState}>No tickets yet.</div>
            ) : (
              recent.map(t => (
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
                  </div>
                </Link>
              ))
            )}
          </div>
        </div>
        <div>
          <div className={styles.card}>
            <p className={styles.sectionTitle}>Quick Actions</p>
            <div className={styles.quickActions}>
              <Link to="/portal/service-catalog" className={styles.quickActionLink}>
                📋 New Service Request
              </Link>
              <Link to="/portal/kb" className={styles.quickActionLink}>
                📚 Knowledge Base
              </Link>
              <Link to="/portal/tickets" className={styles.quickActionLink}>
                🎫 View All Tickets
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
