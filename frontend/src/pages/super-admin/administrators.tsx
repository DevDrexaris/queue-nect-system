import { useEffect, useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { Button } from '../../components/ui/button'
import { Dialog } from '../../components/ui/dialog'
import { FieldError, Label } from '../../components/ui/field'
import { Input } from '../../components/ui/input'
import { Select } from '../../components/ui/select'
import { PageHeader } from '../../components/ui/page-header'
import { Badge } from '../../components/ui/badge'
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/states'
import { TBody, TD, TH, THead, TR, Table } from '../../components/ui/table'
import { createAdminSchema } from '../../lib/schemas'
import { userMessage } from '../../lib/api'
import { superAdminService } from '../../services/api'
import type { AdminAccount, Organization } from '../../types'
import type { z } from 'zod'

type Values = z.infer<typeof createAdminSchema>

export function SuperAdminAdministratorsPage() {
  const [users, setUsers] = useState<AdminAccount[]>([])
  const [orgs, setOrgs] = useState<Organization[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)
  const [editingUser, setEditingUser] = useState<AdminAccount | null>(null)
  const form = useForm<Values>({
    resolver: zodResolver(createAdminSchema),
    defaultValues: { role: 'ADMIN', name: '', email: '', temporaryPassword: '', organizationId: '' },
  })

  async function load() {
    setLoading(true)
    try {
      const [adminData, orgData] = await Promise.all([superAdminService.administrators(), superAdminService.organizations()])
      setUsers(adminData.users)
      setOrgs(orgData.organizations)
      setError(null)
    } catch (caught) {
      setUsers([])
      setError(userMessage(caught))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  function openCreate() {
    setEditingUser(null)
    form.reset({ role: 'ADMIN', name: '', email: '', temporaryPassword: '', organizationId: '' })
    setOpen(true)
  }

  function openEdit(item: AdminAccount) {
    setEditingUser(item)
    form.reset({
      role: 'ADMIN',
      name: item.name,
      email: item.email,
      temporaryPassword: '',
      organizationId: item.organizationId ?? '',
    })
    setOpen(true)
  }

  async function onSubmit(values: Values) {
    try {
      if (editingUser) {
        await superAdminService.updateAdmin(editingUser.id, {
          name: values.name,
          email: values.email,
          role: values.role,
          organizationId: values.organizationId,
        })
        toast.success('Administrator updated.')
      } else {
        await superAdminService.createAdmin(values)
        toast.success('Administrator created. They should change their password after signing in.')
      }
      setOpen(false)
      setEditingUser(null)
      form.reset({ role: 'ADMIN' })
      await load()
    } catch (caught) {
      toast.error(userMessage(caught))
    }
  }

  return (
    <div>
      <PageHeader title="Administrators" actions={<Button onClick={openCreate}>Create admin</Button>} />
      {loading ? (
        <LoadingState label="Loading administrators..." />
      ) : error ? (
        <ErrorState title="Unable to load administrators." description={error} onRetry={() => void load()} />
      ) : users.length === 0 ? (
        <EmptyState title="No administrator accounts yet." />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Name</TH>
              <TH>Email</TH>
              <TH>Clinic</TH>
              <TH>Role</TH>
              <TH>Status</TH>
              <TH>Action</TH>
            </TR>
          </THead>
          <TBody>
            {users.map((item) => (
              <TR key={item.id}>
                <TD>{item.name}</TD>
                <TD>{item.email}</TD>
                <TD>{item.clinicName || '—'}</TD>
                <TD>{item.role}</TD>
                <TD>
                  <Badge variant={item.status === 'active' ? 'success' : 'outline'}>{item.status}</Badge>
                </TD>
                <TD>
                  <Button variant="outline" size="sm" onClick={() => openEdit(item)}>
                    Edit
                  </Button>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}

      <Dialog
        open={open}
        onClose={() => {
          setOpen(false)
          setEditingUser(null)
          form.reset({ role: 'ADMIN' })
        }}
        title={editingUser ? 'Edit clinic admin' : 'Create clinic admin'}
        description={
          editingUser
            ? 'Update this administrator’s details and assignment.'
            : 'Role is limited to ADMIN. Super Admin cannot be assigned from this form.'
        }
        footer={
          <>
            <Button
              variant="outline"
              onClick={() => {
                setOpen(false)
                setEditingUser(null)
                form.reset({ role: 'ADMIN' })
              }}
            >
              Cancel
            </Button>
            <Button onClick={form.handleSubmit(onSubmit)} loading={form.formState.isSubmitting}>
              {editingUser ? 'Save changes' : 'Create'}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <div>
            <Label htmlFor="name">Full Name</Label>
            <Input id="name" {...form.register('name')} />
            <FieldError message={form.formState.errors.name?.message} />
          </div>
          <div>
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" {...form.register('email')} />
            <FieldError message={form.formState.errors.email?.message} />
          </div>
          <div>
            <Label htmlFor="temporaryPassword">Temporary Password</Label>
            <Input id="temporaryPassword" type="password" {...form.register('temporaryPassword')} />
            <FieldError message={form.formState.errors.temporaryPassword?.message} />
          </div>
          <div>
            <Label htmlFor="organizationId">Organization / Clinic</Label>
            <Select id="organizationId" {...form.register('organizationId')}>
              <option value="">Select organization</option>
              {orgs.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.schoolName} — {item.clinicName}
                </option>
              ))}
            </Select>
            <FieldError message={form.formState.errors.organizationId?.message} />
          </div>
          <div>
            <Label htmlFor="role">Role</Label>
            <Select id="role" {...form.register('role')}>
              <option value="ADMIN">ADMIN</option>
            </Select>
          </div>
        </div>
      </Dialog>
    </div>
  )
}
