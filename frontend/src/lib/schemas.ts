import { z } from 'zod'

export const joinQueueSchema = z.object({
  studentId: z.string().trim().min(1, 'Enter your student ID.').max(32, 'Student ID is too long.'),
  fullName: z.string().trim().min(2, 'Enter your full name.').max(120, 'Name is too long.'),
  course: z.string().trim().min(2, 'Enter your course or program.').max(120, 'Course is too long.'),
  yearLevel: z.string().min(1, 'Select your year level.'),
  purpose: z.string().min(1, 'Select the purpose of your visit.'),
})

export type JoinQueueValues = z.infer<typeof joinQueueSchema>

export const loginSchema = z.object({
  email: z.string().trim().email('Enter a valid email address.'),
  password: z.string().min(1, 'Enter your password.'),
})

export type LoginValues = z.infer<typeof loginSchema>

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Enter your current password.'),
    newPassword: z.string().min(8, 'Use at least 8 characters.'),
    confirmPassword: z.string().min(1, 'Confirm your new password.'),
  })
  .refine((value) => value.newPassword === value.confirmPassword, {
    message: 'Passwords do not match.',
    path: ['confirmPassword'],
  })

export const clinicSettingsSchema = z.object({
  name: z.string().trim().min(2, 'Enter the clinic name.'),
  schoolName: z.string().trim().min(2, 'Enter the school name.'),
  address: z.string().trim().max(240).optional().or(z.literal('')),
  contact: z.string().trim().max(80).optional().or(z.literal('')),
  queuePrefix: z
    .string()
    .trim()
    .min(1, 'Enter a queue prefix.')
    .max(3, 'Use up to 3 characters.')
    .regex(/^[A-Za-z]+$/, 'Use letters only.'),
  announcement: z.string().trim().max(280).optional().or(z.literal('')),
  announcementsEnabled: z.boolean(),
  announcementUseCustom: z.boolean(),
  announcementTemplate: z.string().trim().min(1).max(280),
  announcementServiceArea: z.string().trim().min(1).max(100),
  announcementVoice: z.string().max(160),
  announcementRate: z.number().min(0.5).max(1.5),
  announcementVolume: z.number().min(0).max(1),
})

export const organizationSchema = z.object({
  schoolName: z.string().trim().min(2, 'Enter the school name.'),
  clinicName: z.string().trim().min(2, 'Enter the clinic name.'),
  address: z.string().trim().min(2, 'Enter the address.'),
  contact: z.string().trim().min(2, 'Enter contact information.'),
  adminName: z.string().trim().min(2, 'Enter the initial admin name.'),
  adminEmail: z.string().trim().email('Enter a valid admin email.'),
})

export const createAdminSchema = z.object({
  name: z.string().trim().min(2, 'Enter the full name.'),
  email: z.string().trim().email('Enter a valid email.'),
  temporaryPassword: z.string().min(8, 'Use at least 8 characters.'),
  organizationId: z.string().min(1, 'Select an organization.'),
  role: z.literal('ADMIN'),
})
