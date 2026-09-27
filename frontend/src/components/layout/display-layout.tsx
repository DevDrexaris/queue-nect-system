import { Outlet } from 'react-router-dom'

export function DisplayLayout() {
  return (
    <div className="dark min-h-dvh bg-background text-foreground">
      <Outlet />
    </div>
  )
}
