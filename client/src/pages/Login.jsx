import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import styles from './Login.module.css'

export default function Login() {
  const [error, setError]   = useState(null)
  const { login }           = useAuth()
  const navigate            = useNavigate()

  // Handle SSO callback: /login?token=... or /login?error=...
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const token  = params.get('token')
    const err    = params.get('error')

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

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <div className={styles.brand}>
          <span className={styles.brandIcon}>⚙</span>
          <span className={styles.brandName}>ITSM</span>
        </div>

        <h1 className={styles.title}>Sign in</h1>
        <p className={styles.subtitle}>Use your Microsoft account to continue.</p>

        {error && <div className={styles.error}>{error}</div>}

        <a href="/api/auth/azure/login" className={styles.msBtn}>
          <MicrosoftLogo />
          Sign in with Microsoft
        </a>
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
