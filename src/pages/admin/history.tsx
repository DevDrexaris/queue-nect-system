import { useEffect, useState } from 'react'
import { History } from 'lucide-react'
import { PageHeader } from '../../components/ui/page-header'
import { SearchInput } from '../../components/ui/search-input'
import { Select } from '../../components/ui/select'
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/states'
import { QueueNumber } from '../../components/ui/queue-number'
import { QueueStatusBadge } from '../../components/ui/queue-status-badge'
import { TBody, TD, TH, THead, TR, Table } from '../../components/ui/table'
import { historyService } from '../../services/api'
import { userMessage } from '../../lib/api'
import { formatDateTime, formatDuration, formatTime } from '../../lib/format'
import { QUEUE_STATUSES, VISIT_PURPOSES, type QueueEntry } from '../../types'

export function AdminHistoryPage() {
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [status, setStatus] = useState('all')
  const [purpose, setPurpose] = useState('all')
  const [student, setStudent] = useState('')
  const [entries, setEntries] = useState<QueueEntry[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  async function load() {
    setLoading(true)
    const params = new URLSearchParams({ date, status, purpose, student })
    try {
      const data = await historyService.list(params.toString())
      setEntries(data.entries)
      setError(null)
    } catch (caught) {
      setEntries([])
      setError(userMessage(caught))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [date, status, purpose, student])

  return (
    <div>
      <PageHeader title="Queue History" description="Completed and closed queue records." />
      <div className="mb-4 grid gap-3 md:grid-cols-4">
        <label className="text-sm">
          <span className="mb-1.5 block font-medium">Date</span>
          <input
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
            className="h-11 w-full rounded-lg border border-border bg-card px-3 text-sm"
          />
        </label>
        <label className="text-sm">
          <span className="mb-1.5 block font-medium">Status</span>
          <Select value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="all">All</option>
            {QUEUE_STATUSES.map((item) => (
              <option key={item} value={item}>
                {item.replace('_', ' ')}
              </option>
            ))}
          </Select>
        </label>
        <label className="text-sm">
          <span className="mb-1.5 block font-medium">Purpose</span>
          <Select value={purpose} onChange={(event) => setPurpose(event.target.value)}>
            <option value="all">All</option>
            {VISIT_PURPOSES.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </Select>
        </label>
        <label className="text-sm">
          <span className="mb-1.5 block font-medium">Student</span>
          <SearchInput value={student} onChange={(event) => setStudent(event.target.value)} placeholder="Name or ID" />
        </label>
      </div>
      {loading ? (
        <LoadingState label="Loading history..." />
      ) : error ? (
        <ErrorState title="Unable to load history." description={error} onRetry={() => void load()} />
      ) : entries.length === 0 ? (
        <EmptyState icon={History} title="No queue history for this period." />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Queue #</TH>
              <TH>Student</TH>
              <TH>Purpose</TH>
              <TH>Joined</TH>
              <TH>Called</TH>
              <TH>Served</TH>
              <TH>Duration</TH>
              <TH>Status</TH>
            </TR>
          </THead>
          <TBody>
            {entries.map((item) => (
              <TR key={item.id}>
                <TD>
                  <QueueNumber value={item.queueNumber} size="sm" />
                </TD>
                <TD>{item.studentName}</TD>
                <TD>{item.purpose}</TD>
                <TD>{formatTime(item.joinedAt)}</TD>
                <TD>{formatTime(item.calledAt)}</TD>
                <TD>{formatDateTime(item.servedAt)}</TD>
                <TD>{formatDuration(item.calledAt, item.servedAt)}</TD>
                <TD>
                  <QueueStatusBadge status={item.status} />
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
    </div>
  )
}
