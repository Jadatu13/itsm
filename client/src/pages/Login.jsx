import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import styles from './Login.module.css'

export default function Login() {
  const [error, setError]         = useState(null)
  const [requires2fa, setRequires2fa] = useState(false)
  const [tempToken, setTempToken] = useState(null)
  const [code, setCode]           = useState('')
  const [verifying, setVerifying] = useState(false)
  const [ssoEnabled, setSsoEnabled] = useState(false)
  const [passwordEnabled, setPasswordEnabled] = useState(true)
  const [email, setEmail]         = useState('')
  const [password, setPassword]   = useState('')
  const [signingIn, setSigningIn] = useState(false)
  const codeRef = useRef(null)
  const { login }                 = useAuth()
  const navigate                  = useNavigate()

  // Discover which login methods the backend offers (SSO is optional).
  useEffect(() => {
    fetch('/api/auth/config')
      .then(r => r.json())
      .then(cfg => {
        setSsoEnabled(!!cfg.ssoEnabled)
        setPasswordEnabled(cfg.passwordEnabled !== false)
      })
      .catch(() => {})
  }, [])

  async function handlePasswordSubmit(e) {
    e.preventDefault()
    if (!email.trim() || !password) return
    setSigningIn(true)
    setError(null)
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password }),
      })
      const d = await res.json()
      if (!res.ok) {
        setError(d.error || 'Sign in failed. Please try again.')
        setSigningIn(false)
        return
      }
      if (d.requires2fa && d.tempToken) {
        setRequires2fa(true)
        setTempToken(d.tempToken)
        setSigningIn(false)
        setTimeout(() => codeRef.current?.focus(), 100)
        return
      }
      login(d.token, d.agent)
      navigate('/dashboard', { replace: true })
    } catch {
      setError('Something went wrong. Please try again.')
      setSigningIn(false)
    }
  }

  // Handle SSO callback: /login?token=... or /login?error=...
  // Also handle 2FA redirect: /login?requires2fa=true&tempToken=...
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const token  = params.get('token')
    const err    = params.get('error')
    const r2fa   = params.get('requires2fa')
    const temp   = params.get('tempToken')

    if (r2fa === 'true' && temp) {
      setRequires2fa(true)
      setTempToken(temp)
      window.history.replaceState({}, '', '/login')
      setTimeout(() => codeRef.current?.focus(), 100)
      return
    }

    if (token) {
      try {
        const payload = JSON.parse(atob(token.split('.')[1]))
        login(token, { id: payload.id, name: payload.name, email: payload.email, role: payload.role })
        window.history.replaceState({}, '', '/login')
        navigate('/dashboard', { replace: true })
      } catch {
        setError('Invalid login token. Please try again.')
        window.history.replaceState({}, '', '/login')
      }
      return
    }

    if (err) {
      setError(decodeURIComponent(err))
      window.history.replaceState({}, '', '/login')
    }
  }, [])

  async function handle2faSubmit(e) {
    e.preventDefault()
    if (!code.trim()) return
    setVerifying(true)
    setError(null)
    try {
      const res = await fetch('/api/auth/2fa/challenge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tempToken, code: code.trim() }),
      })
      const d = await res.json()
      if (res.ok) {
        login(d.token, d.agent)
        navigate('/dashboard', { replace: true })
      } else {
        setError(d.error || 'Invalid code. Please try again.')
        setCode('')
        codeRef.current?.focus()
      }
    } catch {
      setError('Something went wrong. Please try again.')
    }
    setVerifying(false)
  }

  if (requires2fa) {
    return (
      <div className={styles.page}>
        <div className={styles.card}>
          <div className={styles.brand}>
            <span className={styles.brandIcon}>⚙</span>
            <span className={styles.brandName}>ITSM</span>
          </div>

          <h1 className={styles.title}>Two-factor authentication</h1>
          <p className={styles.subtitle}>Enter the 6-digit code from your authenticator app.</p>

          {error && <div className={styles.error}>{error}</div>}

          <form onSubmit={handle2faSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 8 }}>
            <input
              ref={codeRef}
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={6}
              placeholder="000000"
              value={code}
              onChange={e => setCode(e.target.value.replace(/\D/g, ''))}
              style={{
                fontSize: 28,
                letterSpacing: 8,
                textAlign: 'center',
                padding: '12px 16px',
                borderRadius: 8,
                border: '1px solid #D1D5DB',
                outline: 'none',
                fontFamily: 'monospace',
              }}
              autoComplete="one-time-code"
              autoFocus
            />
            <button
              type="submit"
              className={styles.msBtn}
              disabled={verifying || code.length < 6}
              style={{ justifyContent: 'center' }}
            >
              {verifying ? 'Verifying…' : 'Verify Code'}
            </button>
          </form>

          <button
            onClick={() => { setRequires2fa(false); setTempToken(null); setError(null) }}
            style={{ marginTop: 16, background: 'none', border: 'none', color: '#6B7280', fontSize: 13, cursor: 'pointer' }}
          >
            Back to sign in
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <div className={styles.brand}>
          <span className={styles.brandIcon}>⚙</span>
          <span className={styles.brandName}>ITSM</span>
        </div>

        <h1 className={styles.title}>Sign in</h1>
        <p className={styles.subtitle}>
          {passwordEnabled
            ? 'Enter your email and password to continue.'
            : 'Use your Microsoft account to continue.'}
        </p>

        {error && <div className={styles.error}>{error}</div>}

        {passwordEnabled && (
          <form onSubmit={handlePasswordSubmit} className={styles.form}>
            <input
              type="email"
              className={styles.input}
              placeholder="Email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              autoComplete="username"
              autoFocus
            />
            <input
              type="password"
              className={styles.input}
              placeholder="Password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              autoComplete="current-password"
            />
            <button
              type="submit"
              className={styles.primaryBtn}
              disabled={signingIn || !email.trim() || !password}
            >
              {signingIn ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        )}

        {ssoEnabled && (
          <>
            {passwordEnabled && <div className={styles.divider}><span>or</span></div>}
            <a href="/api/auth/azure/login" className={styles.msBtn}>
              <MicrosoftLogo />
              Sign in with Microsoft
            </a>
          </>
        )}

        {!passwordEnabled && !ssoEnabled && (
          <div className={styles.error}>No sign-in method is available. Contact your administrator.</div>
        )}
      </div>
    </div>
  )
}

function MicrosoftLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 21 21" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="1"  y="1"  width="9" height="9" fill="#F25022"/>
      <rect x="11" y="1"  width="9" height="9" fill="#7FBA00"/>
      <rect x="1"  y="11" width="9" height="9" fill="#00A4EF"/>
      <rect x="11" y="11" width="9" height="9" fill="#FFB900"/>
    </svg>
  )
}
