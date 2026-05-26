import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { portalFetch } from '../../utils/portalApi'
import styles from './Portal.module.css'

export default function PortalArticle() {
  const { id } = useParams()
  const [article, setArticle] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    portalFetch(`/api/portal/kb/${id}`)
      .then(r => r.json())
      .then(setArticle)
      .finally(() => setLoading(false))
  }, [id])

  if (loading) return <div className={styles.loadingState}>Loading…</div>
  if (!article) return <div className={styles.emptyState}>Article not found.</div>

  return (
    <div className={styles.articlePage}>
      <div className={styles.breadcrumb}>
        <Link to="/portal/kb">Knowledge Base</Link>
        {article.folder_name && (
          <>
            <span>›</span>
            <span>{article.folder_icon || '📁'} {article.folder_name}</span>
          </>
        )}
        <span>›</span>
        <span>{article.title}</span>
      </div>

      <div className={styles.card}>
        <h1 style={{ fontSize: '1.6rem', fontWeight: 700, margin: '0 0 24px', color: 'var(--portal-text)' }}>
          {article.title}
        </h1>
        <div
          className={styles.articleBody}
          dangerouslySetInnerHTML={{ __html: article.body }}
        />
      </div>

      <div style={{ marginTop: 20 }}>
        <Link to="/portal/kb" className={styles.backLink}>← Back to Knowledge Base</Link>
      </div>
    </div>
  )
}
