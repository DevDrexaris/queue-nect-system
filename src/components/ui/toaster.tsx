import { Toaster } from 'sonner'

export function AppToaster() {
  return (
    <Toaster
      position="top-right"
      toastOptions={{
        className: 'border border-border bg-card text-foreground shadow-md',
      }}
    />
  )
}
