import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { portalFetch } from '../../utils/portalApi'
import styles from './Portal.module.css'

const BRANDING_DEFAULTS = {
  brand_name: 'Help Centre',
  logo_url: null,
  login_title: 'Welcome to the Help Centre',
  login_subtitle: 'Sign in with your work email address',
  page_bg: '#F8F9FB',
  button_bg: '#4F46E5',
  button_text: '#FFFFFF',
}

export default function PortalLogin() {
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [branding, setBranding] = useState(BRANDING_DEFAULTS)
  const navigate = useNavigate()

  useEffect(() => {
    fetch('/api/branding')
      .then(r => r.json())
      .then(data => setBranding(data))
      .catch(() => {})
  }, [])

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = await portalFetch('/api/portal/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Sign in failed.')
        return
      }
      localStorage.setItem('portal_token', data.token)
      localStorage.setItem('portal_contact', JSON.stringify(data.contact))
      navigate('/portal/dashboard')
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className={styles.loginPage} style={{ background: branding.page_bg }}>
      <div className={styles.loginCard}>
        <div className={styles.loginHeader}>
          <div className={styles.loginLogo}>
            {branding.logo_url
              ? <img src={branding.logo_url} alt={branding.brand_name} style={{ height: 48, objectFit: 'contain' }} />
              : '🎫'
            }
          </div>
          {branding.logo_url && (
            <div style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: 8 }}>
              {branding.brand_name}
            </div>
          )}
          <h1 className={styles.loginTitle}>{branding.login_title}</h1>
          <p className={styles.loginSubtitle}>{branding.login_subtitle}</p>
        </div>
        <form onSubmit={handleSubmit}>
          <div className={styles.formGroup}>
            <label className={styles.formLabel} htmlFor="email">Email address</label>
            <input
              id="email"
              type="email"
              className={styles.formInput}
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="you@company.com"
              required
              autoFocus
            />
          </div>
          <button
            type="submit"
            className={styles.btnPrimary}
            disabled={loading}
            style={{ background: branding.button_bg, color: branding.button_text }}
          >
            {loading ? 'Signing in…' : 'Sign In'}
          </button>
          {error && <div className={styles.errorMsg}>{error}</div>}
        </form>
      </div>
    </div>
  )
}
