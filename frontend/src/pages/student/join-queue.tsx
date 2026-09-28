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
import { useQueueSnapshot } from '../../hooks/use-queue-snapshot'
import { queueSessionLabel } from '../../lib/queue-session'

export function JoinQueuePage() {
  const { clinicId = '' } = useParams()
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token') ?? ''
  const navigate = useNavigate()
  const [queueAccess, setQueueAccess] = useState<Awaited<ReturnType<typeof queueService.validateAccessToken>> | null>(null)
  const { data: queueSnapshot, loading: availabilityLoading } = useQueueSnapshot(clinicId || undefined, undefined, queueAccess?.queueId)
  const [accessValid, setAccessValid] = useState(false)
  const [checkingAccess, setCheckingAccess] = useState(Boolean(token))

  useEffect(() => {
    async function validateAccess() {
      if (!clinicId || !token) {
        setAccessValid(false)
        setCheckingAccess(false)
        navigate('/queue/access-required', { replace: true })
        return
      }

      try {
        const details = await queueService.validateAccessToken(token)
        setQueueAccess(details)
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
    if (queueSnapshot?.clinic.sessionStatus !== 'ACTIVE') {
      toast.error(queueSnapshot?.clinic.sessionStatus === 'ENDED'
        ? "Today's queue session has ended. Please contact staff."
        : queueSnapshot?.clinic.sessionStatus === 'NOT_STARTED'
          ? "Today's queue session has not started. Please wait for staff to start it."
          : 'Queue session status could not be verified. Please try again shortly.')
      return
    }
    if (queueSnapshot?.clinic.availability !== 'OPEN') {
      toast.error(queueSnapshot?.clinic.availability === 'PAUSED'
        ? 'Queue Temporarily Paused. New queue entries are unavailable right now.'
        : 'Queue Currently Closed. Please ask staff for assistance.')
      return
    }
    try {
      const entry = await queueService.join(clinicId, token, values)
      writeStoredTicket({
        clinicIdentifier: clinicId,
        queueId: entry.id,
        serviceQueueId: entry.queueId ?? queueAccess?.queueId,
        queueNumber: entry.queueNumber,
        statusToken: entry.statusToken,
      })
      toast.success('You joined the queue.')
      navigate(`/queue/${clinicId}/confirmed`, { state: { entry } })
    } catch (error) {
      toast.error(userMessage(error))
    }
  }

  const queueScopeMatches = Boolean(queueAccess && queueSnapshot?.clinic.queueId === queueAccess.queueId)
  if (checkingAccess || availabilityLoading || (queueAccess && !queueScopeMatches)) return <LoadingState label="Checking queue access..." />
  if (!accessValid) return null

  const availability = queueSnapshot?.clinic.availability ?? 'UNKNOWN'
  const sessionStatus = queueSnapshot?.clinic.sessionStatus ?? 'UNKNOWN'
  if (sessionStatus !== 'ACTIVE' || availability !== 'OPEN') {
    const isPaused = availability === 'PAUSED'
    const sessionNotReady = sessionStatus === 'NOT_STARTED' || sessionStatus === 'ENDED'
    return (
      <div className="space-y-4 text-center">
        <div className="rounded-xl border border-border bg-card p-6">
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{queueSnapshot?.clinic.name || 'Queue-Nect'}</p>
          <p className="mt-2 text-sm font-medium text-muted-foreground">{queueSnapshot?.clinic.queueName || 'Queue'} · {availability}</p>
          <h1 className="mt-3 text-2xl font-semibold">{sessionNotReady ? queueSessionLabel(sessionStatus) : sessionStatus === 'UNKNOWN' ? 'Queue Session Unavailable' : isPaused ? 'Queue Temporarily Paused' : availability === 'CLOSED' ? 'Queue Currently Closed' : 'Queue Availability Unavailable'}</h1>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            {sessionNotReady
              ? sessionStatus === 'ENDED'
                ? "Today's session has ended. Please ask staff when the next session will be available."
                : "The queue is configured OPEN, but today's session has not started. Please wait for staff to start it."
              : sessionStatus === 'UNKNOWN'
                ? 'Queue session status could not be verified. Please try again shortly or ask staff for assistance.'
              : isPaused
              ? 'New queue entries are temporarily unavailable. Please check again shortly.'
              : availability === 'CLOSED'
                ? 'The clinic is not accepting new queue entries at this time. Please ask staff for assistance.'
                : 'Queue availability could not be verified. Please try again shortly or ask staff for assistance.'}
          </p>
        </div>
        <Link to={`/queue/${clinicId}`} className={cn(buttonVariants({ variant: 'outline' }), 'w-full')}>
          Back
        </Link>
      </div>
    )
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Join {queueAccess?.queueName || 'the Queue'}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{queueAccess?.locationName ? `${queueAccess.locationName} · ` : ''}{queueAccess?.clinicName || 'Enter your details to receive a queue number.'}</p>

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
