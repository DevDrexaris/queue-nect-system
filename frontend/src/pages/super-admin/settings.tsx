import { PageHeader } from '../../components/ui/page-header'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card'

export function SuperAdminSettingsPage() {
  const publicUrl = import.meta.env.VITE_PUBLIC_URL || 'https://your-production-domain.com'

  return (
    <div>
      <PageHeader title="System Settings" description="Manage the public-facing configuration for queue access and QR generation." />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Public URL</CardTitle>
            <CardDescription>Queue access and clinic QR links are generated from this value.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200">
              {publicUrl}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Environment note</CardTitle>
            <CardDescription>Use the production domain only in deployment environments.</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-slate-600 dark:text-slate-300">
              This value is used to create queue entry links and QR codes for each clinic. Do not hardcode a local URL in production.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
