import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import PageHeader from '../components/PageHeader'
import { StatusBadge, PriorityBadge } from '../components/Badge'
import { formatDate, timeAgo } from '../utils/format'
import { apiFetch } from '../utils/api'
import styles from './Dashboard.module.css'

export default function Dashboard() {
  const [stats, setStats]   = useState(null)
  const [recent, setRecent] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError]   = useState(null)
  const navigate = useNavigate()

  useEffect(() => {
    Promise.all([
      apiFetch('/api/dashboard/stats').then(r => r.json()),
      apiFetch('/api/dashboard/recent').then(r => r.json()),
    ])
      .then(([s, r]) => { setStats(s); setRecent(Array.isArray(r) ? r : []); setLoading(false) })
      .catch(() => { setError('Failed to load dashboard data'); setLoading(false) })
  }, [])

  if (loading) return <div className={styles.page}><PageHeader title="Dashboard" /><div className={styles.loading}>Loading…</div></div>
  if (error)   return <div className={styles.page}><PageHeader title="Dashboard" /><div className={styles.error}>{error}</div></div>

  return (
    <div className={styles.page}>
      <PageHeader title="Dashboard" />
      <div className={styles.content}>
        <div className={styles.cards}>
          <StatCard label="Open"           value={stats.open}             color="#22C55E" />
          <StatCard label="In Progress"    value={stats.in_progress}      color="#F59E0B" />
          <StatCard label="On Hold"        value={stats.on_hold}          color="#94A3B8" />
          <StatCard label="Resolved (30d)" value={stats.resolved_last_30} color="#6B7280" />
          <StatCard label="Unassigned"     value={stats.unassigned}       color="#6366F1" />
          <StatCard label="SLA Breached"   value={stats.sla_breached}     color="#EF4444" />
        </div>

        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>Active Tickets</h2>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Reference</th>
                  <th>Subject</th>
                  <th>Contact</th>
                  <th>Assigned</th>
                  <th>Status</th>
                  <th>Priority</th>
                  <th>SLA</th>
                  <th>Updated</th>
                </tr>
              </thead>
              <tbody>
                {recent.length === 0 && (
                  <tr><td colSpan={8} className={styles.empty}>No active tickets.</td></tr>
                )}
                {recent.map(t => (
                  <tr key={t.id} className={styles.row} onClick={() => navigate(`/tickets/${t.id}`)}>
                    <td className={styles.ref}>{t.reference}</td>
                    <td className={styles.subject}>{t.subject}</td>
                    <td>{t.contact_name}</td>
                    <td className={styles.muted}>{t.assigned_name ?? <span style={{ color: '#94A3B8' }}>—</span>}</td>
                    <td><StatusBadge status={t.status} /></td>
                    <td><PriorityBadge priority={t.priority} /></td>
                    <td><SlaChip slaAt={t.sla_due_at} /></td>
                    <td className={styles.muted}>{timeAgo(t.updated_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}

function StatCard({ label, value, color }) {
  return (
    <div className={styles.card}>
      <div className={styles.cardValue} style={{ color }}>{value ?? 0}</div>
      <div className={styles.cardLabel}>{label}</div>
    </div>
  )
}

export function SlaChip({ slaAt }) {
  if (!slaAt) return <span style={{ color: '#94A3B8' }}>—</span>
  const now     = Date.now()
  const due     = new Date(slaAt).getTime()
  const diffMs  = due - now
  const diffH   = diffMs / 3_600_000

  if (diffMs < 0) return <span className={styles.slaBad}>Breached</span>
  if (diffH < 2)  return <span className={styles.slaWarn}>{Math.round(diffMs / 60000)}m left</span>
  if (diffH < 8)  return <span className={styles.slaWarn}>{Math.round(diffH)}h left</span>
  return <span className={styles.slaOk}>{Math.round(diffH)}h left</span>
}
