import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../../hooks/use-auth'
import { LoadingState } from '../ui/states'
import type { UserRole } from '../../types'

export function RequireRole({ roles }: { roles: UserRole[] }) {
  const { user, loading } = useAuth()
  const location = useLocation()

  if (loading) return <LoadingState label="Checking session..." />
  if (!user) {
    const login = location.pathname.startsWith('/super-admin') ? '/super-admin/login' : '/clinic/login'
    return <Navigate to={login} replace state={{ from: location.pathname }} />
  }
  if (!roles.includes(user.role)) {
    return <Navigate to={user.role === 'SUPER_ADMIN' ? '/super-admin' : '/admin'} replace />
  }
  return <Outlet />
}
