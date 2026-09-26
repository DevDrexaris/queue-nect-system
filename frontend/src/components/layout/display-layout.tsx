import { Outlet } from 'react-router-dom'

export function DisplayLayout() {
  return (
    <div className="min-h-dvh bg-[#07111f] text-white">
      <Outlet />
    </div>
  )
}
