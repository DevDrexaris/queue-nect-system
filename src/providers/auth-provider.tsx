import { useEffect, useState, type ReactNode } from 'react'
import { authService } from '../services/api'
import { userMessage } from '../lib/api'
import type { SessionUser } from '../types'
import { AuthContext, type AuthContextValue } from '../hooks/use-auth'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null)
  const [loading, setLoading] = useState(true)

  async function refresh() {
    try {
      const data = await authService.me()
      setUser(data.user)
    } catch {
      setUser(null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refresh()
  }, [])

  const value: AuthContextValue = {
    user,
    loading,
    refresh,
    loginAdmin: async (email, password) => {
      const data = await authService.loginAdmin(email, password)
      setUser(data.user)
      return data.user
    },
    loginSuperAdmin: async (email, password) => {
      const data = await authService.loginSuperAdmin(email, password)
      setUser(data.user)
      return data.user
    },
    logout: async () => {
      try {
        await authService.logout()
      } catch {
        /* still clear local session */
      }
      setUser(null)
    },
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export { userMessage }
