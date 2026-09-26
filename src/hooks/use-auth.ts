import { createContext, useContext } from 'react'
import type { SessionUser } from '../types'

export type AuthContextValue = {
  user: SessionUser | null
  loading: boolean
  loginAdmin: (email: string, password: string) => Promise<SessionUser>
  loginSuperAdmin: (email: string, password: string) => Promise<SessionUser>
  logout: () => Promise<void>
  refresh: () => Promise<void>
}

export const AuthContext = createContext<AuthContextValue | null>(null)

export function useAuth() {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth must be used within AuthProvider')
  return value
}
