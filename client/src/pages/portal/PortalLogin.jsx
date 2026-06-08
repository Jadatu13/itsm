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
  const [sent, setSent] = useState(false)
  const [verifying, setVerifying] = useState(false)
  const [branding, setBranding] = useState(BRANDING_DEFAULTS)
  const navigate = useNavigate()

  useEffect(() => {
    fetch('/api/branding')
      .then(r => r.json())
      .then(data => setBranding(data))
      .catch(() => {})
  }, [])

  // If we arrived via a magic link (?token=…), exchange it for a session.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const token = params.get('token')
    if (!token) return
    setVerifying(true)
    portalFetch('/api/portal/auth/verify', {
      method: 'POST',
      body: JSON.stringify({ token }),
    })
      .then(async res => {
        const data = await res.json()
        if (!res.ok) { setError(data.error || 'Sign in failed.'); return }
        localStorage.setItem('portal_token', data.token)
        localStorage.setItem('portal_contact', JSON.stringify(data.contact))
        // Strip the token from the URL before navigating.
        window.history.replaceState({}, '', '/portal/login')
        navigate('/portal/dashboard')
      })
      .catch(() => setError('Something went wrong verifying your sign-in link.'))
      .finally(() => setVerifying(false))
  }, [navigate])

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = await portalFetch('/api/portal/auth/request-link', {
        method: 'POST',
        body: JSON.stringify({ email }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Could not send sign-in link.')
        return
      }
      setSent(true)
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
        {verifying ? (
          <p className={styles.loginSubtitle} style={{ textAlign: 'center' }}>Signing you in…</p>
        ) : sent ? (
          <div style={{ textAlign: 'center' }}>
            <p style={{ fontSize: '1rem', fontWeight: 600, marginBottom: 8 }}>Check your email 📬</p>
            <p className={styles.loginSubtitle}>
              If an account exists for <strong>{email}</strong>, we've sent a secure sign-in
              link. It's valid for 15 minutes.
            </p>
            <button
              type="button"
              className={styles.btnSecondary}
              style={{ marginTop: 12 }}
              onClick={() => { setSent(false); setEmail('') }}
            >
              Use a different email
            </button>
          </div>
        ) : (
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
              {loading ? 'Sending link…' : 'Email me a sign-in link'}
            </button>
            {error && <div className={styles.errorMsg}>{error}</div>}
          </form>
        )}
      </div>
    </div>
  )
}
