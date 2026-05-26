import { useEffect, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { portalFetch } from '../../utils/portalApi'
import PortalLayout from './PortalLayout'
import { BrandingContext } from './BrandingContext'

const BRANDING_DEFAULTS = {
  brand_name: 'Help Centre',
  logo_url: null,
  primary_color: '#4F46E5',
  nav_bg: '#FFFFFF',
  nav_text: '#111827',
  nav_active_bg: '#EEF2FF',
  nav_active_text: '#4F46E5',
  page_bg: '#F8F9FB',
  button_bg: '#4F46E5',
  button_text: '#FFFFFF',
  login_title: 'Welcome to the Help Centre',
  login_subtitle: 'Sign in with your work email address',
  footer_text: null,
}

function injectBrandingVars(b) {
  let el = document.getElementById('portal-branding-vars')
  if (!el) {
    el = document.createElement('style')
    el.id = 'portal-branding-vars'
    document.head.appendChild(el)
  }
  el.textContent = `:root {
    --portal-bg: ${b.page_bg};
    --portal-nav-bg: ${b.nav_bg};
    --portal-accent: ${b.primary_color};
    --portal-accent-hover: ${b.primary_color};
    --portal-button-bg: ${b.button_bg};
    --portal-button-text: ${b.button_text};
    --portal-nav-active-bg: ${b.nav_active_bg};
    --portal-nav-active-text: ${b.nav_active_text};
  }`
}

export default function PortalApp() {
  // Handle preview token from URL
  const searchParams = new URLSearchParams(window.location.search)
  const urlToken = searchParams.get('portal_token')
  if (urlToken) {
    sessionStorage.setItem('portal_preview_token', urlToken)
    searchParams.delete('portal_token')
    const newSearch = searchParams.toString()
    const newUrl = window.location.pathname + (newSearch ? '?' + newSearch : '')
    window.history.replaceState(null, '', newUrl)
  }

  const isPreview = Boolean(sessionStorage.getItem('portal_preview_token'))
  const token = sessionStorage.getItem('portal_preview_token') || localStorage.getItem('portal_token')

  const [contact, setContact] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('portal_contact') || 'null')
    } catch {
      return null
    }
  })
  const [branding, setBranding] = useState(BRANDING_DEFAULTS)
  const navigate = useNavigate()

  // Fetch branding on mount (public endpoint)
  useEffect(() => {
    fetch('/api/branding')
      .then(r => r.json())
      .then(data => {
        setBranding(data)
        injectBrandingVars(data)
      })
      .catch(() => {
        injectBrandingVars(BRANDING_DEFAULTS)
      })
  }, [])

  useEffect(() => {
    if (!token) return
    portalFetch('/api/portal/me').then(async res => {
      if (res.status === 401) {
        localStorage.removeItem('portal_token')
        localStorage.removeItem('portal_contact')
        sessionStorage.removeItem('portal_preview_token')
        navigate('/portal/login')
        return
      }
      const data = await res.json()
      setContact(data)
      if (!isPreview) {
        localStorage.setItem('portal_contact', JSON.stringify(data))
      }
    }).catch(() => {
      // network errors — leave token in place, will retry
    })
  }, [token, navigate, isPreview])

  if (!token) {
    return <Navigate to="/portal/login" replace />
  }

  function handleLogout() {
    localStorage.removeItem('portal_token')
    localStorage.removeItem('portal_contact')
    setContact(null)
  }

  return (
    <BrandingContext.Provider value={branding}>
      <PortalLayout contact={contact} onLogout={handleLogout} isPreview={isPreview} />
    </BrandingContext.Provider>
  )
}
