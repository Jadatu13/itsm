import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { portalFetch } from '../../utils/portalApi'
import styles from './Portal.module.css'

const CATALOG_CATEGORIES = [
  { value: 'all',                label: 'All Services',           icon: '📋' },
  { value: 'account_management', label: 'Account Management',     icon: '👤' },
  { value: 'access_permissions', label: 'Access & Permissions',   icon: '🔐' },
  { value: 'hardware',           label: 'Hardware',               icon: '💻' },
  { value: 'incidents',          label: 'Report an Issue',        icon: '🚨' },
  { value: 'network',            label: 'Network',                icon: '🌐' },
  { value: 'software',           label: 'Software',               icon: '📦' },
  { value: 'general',            label: 'General',                icon: '🗂️' },
  { value: 'other',              label: 'Other',                  icon: '⚙️' },
]

export default function PortalServiceCatalog() {
  const [forms, setForms] = useState([])
  const [loading, setLoading] = useState(true)
  const [activeCategory, setActiveCategory] = useState('all')
  const navigate = useNavigate()

  useEffect(() => {
    portalFetch('/api/portal/service-catalog')
      .then(r => r.json())
      .then(data => setForms(Array.isArray(data) ? data : []))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div className={styles.loadingState}>Loading…</div>

  const visibleCategories = CATALOG_CATEGORIES.filter(cat =>
    cat.value === 'all' || forms.some(f => f.category === cat.value)
  )

  const filteredForms = activeCategory === 'all'
    ? forms
    : forms.filter(f => f.category === activeCategory)

  return (
    <div className={styles.catalogLayout}>
      <aside className={styles.catalogSidebar}>
        {visibleCategories.map(cat => (
          <button
            key={cat.value}
            className={`${styles.catalogSidebarItem}${activeCategory === cat.value ? ` ${styles.catalogSidebarItemActive}` : ''}`}
            onClick={() => setActiveCategory(cat.value)}
          >
            {cat.icon} {cat.label}
          </button>
        ))}
      </aside>

      <div className={styles.catalogMain}>
        <div className={styles.pageHeader}>
          <h1 className={styles.pageTitle}>Service Catalog</h1>
        </div>
        <p style={{ color: 'var(--portal-text-muted)', marginBottom: 24, fontSize: '0.9rem' }}>
          Submit a request using one of the forms below.
        </p>
        {filteredForms.length === 0 ? (
          <div className={styles.emptyState}>No services available at this time.</div>
        ) : (
          <div className={styles.catalogGrid}>
            {filteredForms.map(f => (
              <div
                key={f.id}
                className={styles.catalogCard}
                onClick={() => navigate(`/portal/service-catalog/${f.id}`)}
                role="button"
                tabIndex={0}
                onKeyDown={e => e.key === 'Enter' && navigate(`/portal/service-catalog/${f.id}`)}
              >
                <div className={styles.catalogIcon}>{f.icon || '📋'}</div>
                <h3 className={styles.catalogName}>{f.name}</h3>
                {f.description && <p className={styles.catalogDesc}>{f.description}</p>}
                <span className={styles.categoryBadge}>{f.category?.replace('_', ' ')}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
