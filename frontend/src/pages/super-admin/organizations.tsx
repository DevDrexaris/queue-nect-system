import { useEffect, useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { Button } from '../../components/ui/button'
import { Dialog } from '../../components/ui/dialog'
import { FieldError, Label } from '../../components/ui/field'
import { Input } from '../../components/ui/input'
import { PageHeader } from '../../components/ui/page-header'
import { Badge } from '../../components/ui/badge'
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/states'
import { TBody, TD, TH, THead, TR, Table } from '../../components/ui/table'
import { organizationSchema } from '../../lib/schemas'
import { userMessage } from '../../lib/api'
import { formatDate } from '../../lib/format'
import { superAdminService } from '../../services/api'
import type { Organization } from '../../types'
import type { z } from 'zod'

type Values = z.infer<typeof organizationSchema>

export function SuperAdminOrganizationsPage() {
  const [orgs, setOrgs] = useState<Organization[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)
  const [editingOrg, setEditingOrg] = useState<Organization | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Organization | null>(null)
  const form = useForm<Values>({ resolver: zodResolver(organizationSchema) })

  async function load() {
    setLoading(true)
    try {
      const data = await superAdminService.organizations()
      setOrgs(data.organizations)
      setError(null)
    } catch (caught) {
      setOrgs([])
      setError(userMessage(caught))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  function openCreate() {
    setEditingOrg(null)
    form.reset({
      schoolName: '',
      clinicName: '',
      address: '',
      contact: '',
      adminName: '',
      adminEmail: '',
    })
    setOpen(true)
  }

  function openEdit(item: Organization) {
    setEditingOrg(item)
    form.reset({
      schoolName: item.schoolName,
      clinicName: item.clinicName,
      address: '',
      contact: '',
      adminName: item.adminName ?? '',
      adminEmail: '',
    })
    setOpen(true)
  }

  async function onSubmit(values: Values) {
    try {
      if (editingOrg) {
        await superAdminService.updateOrganization(editingOrg.id, {
          schoolName: values.schoolName,
          clinicName: values.clinicName,
          address: values.address,
          contact: values.contact,
        })
        toast.success('Organization updated.')
      } else {
        await superAdminService.createOrganization(values)
        toast.success('Organization created. Clinic QR is now available to that clinic.')
      }
      setOpen(false)
      setEditingOrg(null)
      form.reset()
      await load()
    } catch (caught) {
      toast.error(userMessage(caught))
    }
  }

  async function handleDeleteConfirm() {
    if (!deleteTarget) return

    try {
      await superAdminService.deleteOrganization(deleteTarget.id)
      toast.success(`Organization ${deleteTarget.schoolName} removed.`)
      setDeleteTarget(null)
      await load()
    } catch (caught) {
      toast.error(userMessage(caught))
    }
  }

  return (
    <div>
      <PageHeader
        title="Organizations"
        actions={
          <Button onClick={openCreate}>+ Create organization</Button>
        }
      />
      {loading ? (
        <LoadingState label="Loading organizations..." />
      ) : error ? (
        <ErrorState title="Unable to load organizations." description={error} onRetry={() => void load()} />
      ) : orgs.length === 0 ? (
        <EmptyState title="No organizations yet." description="Create a school clinic to provision an admin and QR code." />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Organization</TH>
              <TH>Clinic</TH>
              <TH>Admin</TH>
              <TH>Status</TH>
              <TH>Created</TH>
              <TH>Action</TH>
            </TR>
          </THead>
          <TBody>
            {orgs.map((item) => (
              <TR key={item.id}>
                <TD>{item.schoolName}</TD>
                <TD>{item.clinicName}</TD>
                <TD>{item.adminName || '—'}</TD>
                <TD>
                  <Badge variant={item.status === 'active' ? 'success' : 'outline'}>{item.status}</Badge>
                </TD>
                <TD>{formatDate(item.createdAt)}</TD>
                <TD>
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={() => openEdit(item)}>
                      Edit
                    </Button>
                    <Button variant="destructive" size="sm" onClick={() => setDeleteTarget(item)}>
                      Delete
                    </Button>
                  </div>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}

      <Dialog
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        title="Delete organization"
        description={`This will permanently remove ${deleteTarget?.schoolName ?? 'this organization'} and its associated clinic data. This action cannot be undone.`}
        footer={
          <>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDeleteConfirm}>
              Delete organization
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted-foreground">
          Confirm deleting <span className="font-medium text-foreground">{deleteTarget?.clinicName}</span> and all of its queued clinic data.
        </p>
      </Dialog>

      <Dialog
        open={open}
        onClose={() => {
          setOpen(false)
          setEditingOrg(null)
          form.reset()
        }}
        title={editingOrg ? 'Edit organization' : 'Create organization'}
        description={
          editingOrg
            ? 'Update the organization details for this clinic.'
            : 'This creates the clinic, initial admin account, and clinic identifier for QR codes.'
        }
        className="max-w-lg"
        footer={
          <>
            <Button
              variant="outline"
              onClick={() => {
                setOpen(false)
                setEditingOrg(null)
                form.reset()
              }}
            >
              Cancel
            </Button>
            <Button onClick={form.handleSubmit(onSubmit)} loading={form.formState.isSubmitting}>
              {editingOrg ? 'Save changes' : 'Create'}
            </Button>
          </>
        }
      >
        <form className="grid gap-3 sm:grid-cols-2" onSubmit={form.handleSubmit(onSubmit)}>
          <div className="sm:col-span-2">
            <Label htmlFor="schoolName">School Name</Label>
            <Input id="schoolName" {...form.register('schoolName')} />
            <FieldError message={form.formState.errors.schoolName?.message} />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="clinicName">Clinic Name</Label>
            <Input id="clinicName" {...form.register('clinicName')} />
            <FieldError message={form.formState.errors.clinicName?.message} />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="address">Address</Label>
            <Input id="address" {...form.register('address')} />
            <FieldError message={form.formState.errors.address?.message} />
          </div>
          <div>
            <Label htmlFor="contact">Contact Information</Label>
            <Input id="contact" {...form.register('contact')} />
            <FieldError message={form.formState.errors.contact?.message} />
          </div>
          <div>
            <Label htmlFor="adminName">Initial Admin Name</Label>
            <Input id="adminName" {...form.register('adminName')} />
            <FieldError message={form.formState.errors.adminName?.message} />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="adminEmail">Initial Admin Email</Label>
            <Input id="adminEmail" type="email" {...form.register('adminEmail')} />
            <FieldError message={form.formState.errors.adminEmail?.message} />
          </div>
        </form>
      </Dialog>
    </div>
  )
}
