const KEY = 'qn.student-ticket'

export type StoredTicket = {
  clinicIdentifier: string
  queueId: string
  queueNumber: string
}

export function readStoredTicket(): StoredTicket | null {
  try {
    const raw = sessionStorage.getItem(KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as StoredTicket
    if (!parsed.clinicIdentifier || !parsed.queueId || !parsed.queueNumber) return null
    return parsed
  } catch {
    return null
  }
}

export function writeStoredTicket(ticket: StoredTicket) {
  sessionStorage.setItem(KEY, JSON.stringify(ticket))
}

export function clearStoredTicket() {
  sessionStorage.removeItem(KEY)
}
