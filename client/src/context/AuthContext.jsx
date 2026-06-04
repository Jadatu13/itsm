import { createContext, useContext, useState, useEffect } from 'react'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [agent, setAgent]   = useState(() => {
    try { return JSON.parse(localStorage.getItem('agent')) } catch { return null }
  })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const token = localStorage.getItem('token')
    if (!token) { setLoading(false); return }
    fetch('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data) {
          setAgent(data)
          localStorage.setItem('agent', JSON.stringify(data))
        } else {
          localStorage.removeItem('token')
          localStorage.removeItem('agent')
          setAgent(null)
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  function login(token, agentData) {
    localStorage.setItem('token', token)
    localStorage.setItem('agent', JSON.stringify(agentData))
    setAgent(agentData)
  }

  function logout() {
    localStorage.removeItem('token')
    localStorage.removeItem('agent')
    setAgent(null)
  }

  return (
    <AuthContext.Provider value={{ agent, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}

/** Returns true if the currently signed-in agent has the admin role */
export function useIsAdmin() {
  const { agent } = useContext(AuthContext)
  return agent?.role === 'admin'
}
