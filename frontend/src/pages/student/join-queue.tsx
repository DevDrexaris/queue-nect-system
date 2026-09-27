import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { zodResolver } from '@hookform/resolvers/zod'
import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { Button, buttonVariants } from '../../components/ui/button'
import { FieldError, Label } from '../../components/ui/field'
import { Input } from '../../components/ui/input'
import { Select } from '../../components/ui/select'
import { joinQueueSchema, type JoinQueueValues } from '../../lib/schemas'
import { userMessage } from '../../lib/api'
import { writeStoredTicket } from '../../lib/ticket'
import { queueService } from '../../services/api'
import { VISIT_PURPOSES, YEAR_LEVELS } from '../../types'
import { cn } from '../../lib/utils'
import { LoadingState } from '../../components/ui/states'

export function JoinQueuePage() {
  const { clinicId = '' } = useParams()
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token') ?? ''
  const navigate = useNavigate()
  const [accessValid, setAccessValid] = useState(false)
  const [checkingAccess, setCheckingAccess] = useState(Boolean(token))

  useEffect(() => {
    async function validateAccess() {
      if (!clinicId) {
        setAccessValid(false)
        setCheckingAccess(false)
        navigate('/queue/access-required', { replace: true })
        return
      }

      if (!token) {
        setAccessValid(true)
        setCheckingAccess(false)
        return
      }

      try {
        const details = await queueService.validateAccessToken(token)
        setAccessValid(details.clinicIdentifier === clinicId)
        if (details.clinicIdentifier !== clinicId) {
          navigate('/queue/access-required', { replace: true })
        }
      } catch {
        navigate('/queue/access-required', { replace: true })
      } finally {
        setCheckingAccess(false)
      }
    }

    void validateAccess()
  }, [clinicId, navigate, token])

  const form = useForm<JoinQueueValues>({
    resolver: zodResolver(joinQueueSchema),
    mode: 'onTouched',
    defaultValues: {
      studentId: '',
      fullName: '',
      course: '',
      yearLevel: '',
      purpose: '',
    },
  })

  async function onSubmit(values: JoinQueueValues) {
    try {
      const entry = await queueService.join(clinicId, values)
      writeStoredTicket({
        clinicIdentifier: clinicId,
        queueId: entry.id,
        queueNumber: entry.queueNumber,
      })
      toast.success('You joined the queue.')
      navigate(`/queue/${clinicId}/confirmed`, { state: { entry } })
    } catch (error) {
      toast.error(userMessage(error))
    }
  }

  if (checkingAccess) return <LoadingState label="Checking queue access..." />
  if (!accessValid) return null

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Join the Queue</h1>
      <p className="mt-1 text-sm text-muted-foreground">Enter your details to receive a queue number.</p>

      <form className="mt-6 space-y-4" onSubmit={form.handleSubmit(onSubmit)} noValidate>
        <div>
          <Label htmlFor="studentId">Student ID</Label>
          <Input id="studentId" autoComplete="off" {...form.register('studentId')} />
          <FieldError message={form.formState.errors.studentId?.message} />
        </div>
        <div>
          <Label htmlFor="fullName">Full Name</Label>
          <Input id="fullName" autoComplete="name" {...form.register('fullName')} />
          <FieldError message={form.formState.errors.fullName?.message} />
        </div>
        <div>
          <Label htmlFor="course">Course / Program</Label>
          <Input id="course" {...form.register('course')} />
          <FieldError message={form.formState.errors.course?.message} />
        </div>
        <div>
          <Label htmlFor="yearLevel">Year Level</Label>
          <Select id="yearLevel" defaultValue="" {...form.register('yearLevel')}>
            <option value="" disabled>
              Select year level
            </option>
            {YEAR_LEVELS.map((level) => (
              <option key={level} value={level}>
                {level}
              </option>
            ))}
          </Select>
          <FieldError message={form.formState.errors.yearLevel?.message} />
        </div>
        <div>
          <Label htmlFor="purpose">Purpose of Visit</Label>
          <Select id="purpose" defaultValue="" {...form.register('purpose')}>
            <option value="" disabled>
              Select purpose
            </option>
            {VISIT_PURPOSES.map((purpose) => (
              <option key={purpose} value={purpose}>
                {purpose}
              </option>
            ))}
          </Select>
          <FieldError message={form.formState.errors.purpose?.message} />
        </div>
        <Button type="submit" className="h-12 w-full" size="lg" loading={form.formState.isSubmitting}>
          {form.formState.isSubmitting ? 'Joining queue...' : 'Join queue'}
        </Button>
      </form>
      <Link to={`/queue/${clinicId}`} className={cn(buttonVariants({ variant: 'ghost' }), 'mt-3 w-full')}>
        Back
      </Link>
    </div>
  )
}
