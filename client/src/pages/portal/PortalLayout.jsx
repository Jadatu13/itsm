import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import styles from './Portal.module.css'
import { useBranding } from './BrandingContext'

export default function PortalLayout({ contact, onLogout, isPreview }) {
  const navigate = useNavigate()
  const branding = useBranding()

  function handleLogout() {
    onLogout()
    navigate('/portal/login')
  }

  function handleExitPreview() {
    sessionStorage.removeItem('portal_preview_token')
    navigate('/portal/login')
  }

  return (
    <div className={styles.shell}>
      <nav
        className={styles.navbar}
        style={{ background: branding.nav_bg, color: branding.nav_text }}
      >
        <NavLink to="/portal/dashboard" className={styles.brand} style={{ color: branding.nav_text }}>
          {branding.logo_url
            ? <img src={branding.logo_url} alt={branding.brand_name} style={{ height: 28, objectFit: 'contain' }} />
            : '🎫'
          }
          {branding.brand_name}
        </NavLink>
        <div className={styles.navLinks}>
          <NavLink
            to="/portal/dashboard"
            className={({ isActive }) =>
              isActive ? `${styles.navLink} ${styles.navLinkActive}` : styles.navLink
            }
            style={({ isActive }) => isActive
              ? { background: branding.nav_active_bg, color: branding.nav_active_text }
              : { color: branding.nav_text }
            }
          >
            Dashboard
          </NavLink>
          <NavLink
            to="/portal/tickets"
            className={({ isActive }) =>
              isActive ? `${styles.navLink} ${styles.navLinkActive}` : styles.navLink
            }
            style={({ isActive }) => isActive
              ? { background: branding.nav_active_bg, color: branding.nav_active_text }
              : { color: branding.nav_text }
            }
          >
            My Tickets
          </NavLink>
          <NavLink
            to="/portal/kb"
            className={({ isActive }) =>
              isActive ? `${styles.navLink} ${styles.navLinkActive}` : styles.navLink
            }
            style={({ isActive }) => isActive
              ? { background: branding.nav_active_bg, color: branding.nav_active_text }
              : { color: branding.nav_text }
            }
          >
            Knowledge Base
          </NavLink>
          <NavLink
            to="/portal/service-catalog"
            className={({ isActive }) =>
              isActive ? `${styles.navLink} ${styles.navLinkActive}` : styles.navLink
            }
            style={({ isActive }) => isActive
              ? { background: branding.nav_active_bg, color: branding.nav_active_text }
              : { color: branding.nav_text }
            }
          >
            Service Catalog
          </NavLink>
        </div>
        <div className={styles.navRight}>
          {contact && (
            <span className={styles.contactName} style={{ color: branding.nav_text }}>
              {contact.first_name} {contact.last_name}
            </span>
          )}
          {!isPreview && (
            <button
              className={styles.logoutBtn}
              onClick={handleLogout}
              style={{ background: branding.button_bg, color: branding.button_text, border: 'none' }}
            >
              Logout
            </button>
          )}
        </div>
      </nav>
      <div className={styles.pageContent} style={{ paddingBottom: isPreview ? '60px' : undefined }}>
        <Outlet />
      </div>
      {isPreview && (
        <div className={styles.previewBanner}>
          <span>👁 Admin Preview — viewing as {contact ? `${contact.first_name} ${contact.last_name}` : 'Contact'}</span>
          <button className={styles.previewBannerBtn} onClick={handleExitPreview}>
            Exit Preview
          </button>
        </div>
      )}
    </div>
  )
}
