export const QUEUE_STATUSES = [
  'WAITING',
  'CALLED',
  'SERVING',
  'COMPLETED',
  'SERVED',
  'CANCELLED',
  'NO_SHOW',
] as const

export type QueueStatus = (typeof QUEUE_STATUSES)[number]

export function formatQueueStatusLabel(status: QueueStatus) {
  const labels: Record<QueueStatus, string> = {
    WAITING: 'Waiting',
    CALLED: 'Called',
    SERVING: 'Currently serving',
    COMPLETED: 'Served',
    SERVED: 'Served',
    CANCELLED: 'Cancelled',
    NO_SHOW: 'No show',
  }

  return labels[status]
}

export const VISIT_PURPOSES = [
  'Consultation',
  'Check-up',
  'Dental Check Up',
  'First Aid',
  'Medicine',
  'Medical Certificate',
  'Other',
] as const

export type VisitPurpose = (typeof VISIT_PURPOSES)[number]

export const YEAR_LEVELS = ['1st Year', '2nd Year', '3rd Year', '4th Year', '5th Year+', 'Other'] as const

export type YearLevel = (typeof YEAR_LEVELS)[number]

export const USER_ROLES = ['ADMIN', 'ORG_ADMIN', 'STAFF', 'SUPER_ADMIN'] as const
export type UserRole = (typeof USER_ROLES)[number]

export type Clinic = {
  id: string
  identifier: string
  name: string
  schoolName?: string
  address?: string
  contact?: string
  queuePrefix?: string
  announcement?: string
  announcementsEnabled?: boolean
  announcementUseCustom?: boolean
  announcementTemplate?: string
  announcementServiceArea?: string
  announcementVoice?: string
  announcementRate?: number
  announcementVolume?: number
}

export type QueueEntry = {
  id: string
  clinicId: string
  queueNumber: string
  studentId?: string
  studentName?: string
  course?: string
  yearLevel?: string
  purpose?: VisitPurpose | string
  status: QueueStatus
  cancellationSource?: 'STUDENT' | 'ADMIN' | null
  joinedAt: string
  calledAt?: string | null
  servedAt?: string | null
  peopleAhead?: number
  estimatedWaitMinutes?: number | null
}

export type QueueSnapshot = {
  clinic: Clinic
  nowServing: QueueEntry | null
  upNext: QueueEntry[]
  waitingCount: number
  servingCount: number
  completedCount: number
  todayCount: number
  entries: QueueEntry[]
}

export type StudentRecord = {
  id: string
  studentId: string
  fullName: string
  course: string
  yearLevel: string
  queueActivity: number
  status: 'active' | 'inactive'
}

export type Organization = {
  id: string
  schoolName: string
  clinicName: string
  clinicIdentifier: string
  adminName?: string
  status: 'active' | 'disabled'
  createdAt: string
}

export type AdminAccount = {
  id: string
  name: string
  email: string
  role: UserRole
  organizationId?: string
  clinicName?: string
  status: 'active' | 'disabled'
}

export type SessionUser = {
  id: string
  name: string
  email: string
  role: UserRole
  clinic?: Clinic
}
