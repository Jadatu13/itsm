import { useEffect, useState } from 'react'
import PageHeader from '../components/PageHeader'
import { apiFetch } from '../utils/api'
import styles from './Reports.module.css'

export default function Reports() {
  const [overview, setOverview] = useState(null)
  const [volume, setVolume]     = useState([])
  const [agents, setAgents]     = useState([])
  const [loading, setLoading]   = useState(true)
  const [days, setDays]         = useState(30)

  useEffect(() => {
    setLoading(true)
    Promise.all([
      apiFetch('/api/reports/overview').then(r => r.json()),
      apiFetch(`/api/reports/volume?days=${days}`).then(r => r.json()),
      apiFetch('/api/reports/agents').then(r => r.json()),
    ]).then(([ov, vol, ag]) => {
      setOverview(ov)
      setVolume(Array.isArray(vol) ? vol : [])
      setAgents(Array.isArray(ag) ? ag : [])
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [days])

  if (loading) return <div className={styles.page}><PageHeader title="Reports" /><div className={styles.state}>Loading…</div></div>
  if (!overview) return null

  const maxVol = Math.max(...volume.map(v => parseInt(v.created)), 1)

  return (
    <div className={styles.page}>
      <PageHeader title="Reports" />
      <div className={styles.content}>

        {/* ── Top stat cards ── */}
        <div className={styles.statGrid}>
          <StatCard label="Total Tickets"    value={overview.totals.total}       />
          <StatCard label="Active"           value={overview.totals.active}      color="#F59E0B" />
          <StatCard label="Unassigned"       value={overview.totals.unassigned}  color="#EF4444" />
          <StatCard label="Avg Resolution"   value={overview.avgResolutionHours != null ? `${overview.avgResolutionHours}h` : '—'} color="#22C55E" />
        </div>

        <div className={styles.row}>
          {/* ── Volume chart ── */}
          <div className={styles.panel}>
            <div className={styles.panelHead}>
              <h2 className={styles.panelTitle}>Ticket Volume</h2>
              <select className={styles.daysSelect} value={days} onChange={e => setDays(Number(e.target.value))}>
                <option value={7}>Last 7 days</option>
                <option value={30}>Last 30 days</option>
                <option value={90}>Last 90 days</option>
              </select>
            </div>
            {volume.length === 0 ? (
              <div className={styles.empty}>No tickets in this period.</div>
            ) : (
              <div className={styles.barChart}>
                {volume.map(v => (
                  <div key={v.date} className={styles.barCol}>
                    <div className={styles.barWrap}>
                      <div
                        className={styles.bar}
                        style={{ height: `${(parseInt(v.created) / maxVol) * 100}%` }}
                        title={`${v.created} ticket(s)`}
                      />
                    </div>
                    <span className={styles.barLabel}>{formatShortDate(v.date)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── By priority ── */}
          <div className={styles.panel} style={{ flex: '0 0 220px' }}>
            <h2 className={styles.panelTitle}>By Priority (active)</h2>
            <div className={styles.breakdown}>
              {overview.byPriority.length === 0
                ? <div className={styles.empty}>None</div>
                : overview.byPriority.map(r => (
                  <BreakdownRow key={r.priority} label={r.priority} value={r.count}
                    color={r.priority === 'high' ? '#EF4444' : r.priority === 'medium' ? '#F59E0B' : '#22C55E'}
                    total={overview.totals.active} />
                ))
              }
            </div>
          </div>
        </div>

        <div className={styles.row}>
          {/* ── By category ── */}
          <div className={styles.panel}>
            <h2 className={styles.panelTitle}>By Category (active)</h2>
            <div className={styles.breakdown}>
              {overview.byCategory.length === 0
                ? <div className={styles.empty}>None</div>
                : overview.byCategory.map(r => (
                  <BreakdownRow key={r.category} label={r.category} value={r.count}
                    color="var(--accent)" total={overview.totals.active} />
                ))
              }
            </div>
          </div>

          {/* ── By source ── */}
          <div className={styles.panel}>
            <h2 className={styles.panelTitle}>By Source (all time)</h2>
            <div className={styles.breakdown}>
              {overview.bySource.length === 0
                ? <div className={styles.empty}>None</div>
                : overview.bySource.map(r => (
                  <BreakdownRow key={r.source} label={r.source} value={r.count}
                    color="#6366F1" total={overview.totals.total} />
                ))
              }
            </div>
          </div>
        </div>

        {/* ── Agent performance ── */}
        {agents.length > 0 && (
          <div className={styles.panel}>
            <h2 className={styles.panelTitle}>Agent Performance</h2>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Agent</th>
                    <th>Total Assigned</th>
                    <th>Open</th>
                    <th>Resolved</th>
                    <th>Avg Resolution</th>
                  </tr>
                </thead>
                <tbody>
                  {agents.map(a => (
                    <tr key={a.id}>
                      <td className={styles.agentName}>
                        <div className={styles.agentAvatar}>{a.name[0].toUpperCase()}</div>
                        {a.name}
                      </td>
                      <td>{a.total_assigned}</td>
                      <td>{a.open_tickets}</td>
                      <td>{a.resolved_tickets}</td>
                      <td>{a.avg_resolution_hours != null ? `${a.avg_resolution_hours}h` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

      </div>
    </div>
  )
}

function StatCard({ label, value, color }) {
  return (
    <div className={styles.statCard}>
      <div className={styles.statValue} style={{ color: color || 'var(--text-primary)' }}>{value ?? 0}</div>
      <div className={styles.statLabel}>{label}</div>
    </div>
  )
}

function BreakdownRow({ label, value, color, total }) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0
  return (
    <div className={styles.breakdownRow}>
      <span className={styles.breakdownLabel}>{label}</span>
      <div className={styles.breakdownBar}>
        <div className={styles.breakdownFill} style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className={styles.breakdownVal}>{value}</span>
    </div>
  )
}

function formatShortDate(dateStr) {
  const d = new Date(dateStr)
  return `${d.getMonth() + 1}/${d.getDate()}`
}
