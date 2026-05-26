import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { portalFetch } from '../../utils/portalApi'
import styles from './Portal.module.css'

// Strip any residual HTML tags and decode common entities
function stripHtml(html) {
  if (!html) return ''
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

export default function PortalKB() {
  const [articles, setArticles] = useState([])
  const [folders, setFolders] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [activeFolder, setActiveFolder] = useState(null)

  useEffect(() => {
    Promise.all([
      portalFetch('/api/portal/kb').then(r => r.json()),
      portalFetch('/api/portal/kb/folders').then(r => r.json()),
    ]).then(([arts, fols]) => {
      setArticles(Array.isArray(arts) ? arts : [])
      setFolders(Array.isArray(fols) ? fols : [])
    }).finally(() => setLoading(false))
  }, [])

  // When search changes, fetch fresh from server
  useEffect(() => {
    const params = new URLSearchParams()
    if (search) params.set('search', search)
    if (activeFolder) params.set('folder_id', activeFolder)
    const qs = params.toString()
    portalFetch(`/api/portal/kb${qs ? '?' + qs : ''}`)
      .then(r => r.json())
      .then(data => setArticles(Array.isArray(data) ? data : []))
  }, [search, activeFolder])

  if (loading) return <div className={styles.loadingState}>Loading…</div>

  return (
    <div>
      <div className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>Knowledge Base</h1>
        <input
          className={styles.searchInput}
          type="text"
          placeholder="Search articles…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      <div className={styles.kbLayout}>
        <div>
          <div className={styles.card}>
            <p className={styles.sectionTitle}>Folders</p>
            <ul className={styles.folderList}>
              <li
                className={`${styles.folderItem} ${activeFolder === null ? styles.folderItemActive : ''}`}
                onClick={() => setActiveFolder(null)}
              >
                📂 All Articles
              </li>
              {folders.map(f => (
                <li
                  key={f.id}
                  className={`${styles.folderItem} ${activeFolder === f.id ? styles.folderItemActive : ''}`}
                  onClick={() => setActiveFolder(activeFolder === f.id ? null : f.id)}
                >
                  {f.icon || '📁'} {f.name}
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div>
          {articles.length === 0 ? (
            <div className={styles.emptyState}>No articles found.</div>
          ) : (
            <div className={styles.articleGrid}>
              {articles.map(a => (
                <Link to={`/portal/kb/${a.id}`} key={a.id} className={styles.articleCard}>
                  {a.folder_name && (
                    <span className={styles.folderBadge}>
                      {a.folder_icon || '📁'} {a.folder_name}
                    </span>
                  )}
                  <h3 className={styles.articleTitle}>{a.title}</h3>
                  <p className={styles.articleExcerpt}>{stripHtml(a.excerpt)}</p>
                  <span className={styles.articleReadMore}>Read article →</span>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
