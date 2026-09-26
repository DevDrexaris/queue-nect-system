import { PageHeader } from '../../components/ui/page-header'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card'

export function SuperAdminSettingsPage() {
  return (
    <div>
      <PageHeader title="System Settings" />
      <Card>
        <CardHeader>
          <CardTitle>Public URL</CardTitle>
          <CardDescription>Clinic QR codes use VITE_PUBLIC_URL. Do not hardcode the production domain.</CardDescription>
        </CardHeader>
        <CardContent>
          <code className="rounded-lg bg-muted px-3 py-2 text-sm">{import.meta.env.VITE_PUBLIC_URL || 'https://YOUR-FUTURE-DOMAIN.com'}</code>
        </CardContent>
      </Card>
    </div>
  )
}
