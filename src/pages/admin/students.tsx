import { useEffect, useState } from 'react'
import { Users } from 'lucide-react'
import { PageHeader } from '../../components/ui/page-header'
import { SearchInput } from '../../components/ui/search-input'
import { Select } from '../../components/ui/select'
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/states'
import { TBody, TD, TH, THead, TR, Table } from '../../components/ui/table'
import { Badge } from '../../components/ui/badge'
import { studentsService } from '../../services/api'
import { userMessage } from '../../lib/api'
import { YEAR_LEVELS, type StudentRecord } from '../../types'

export function AdminStudentsPage() {
  const [query, setQuery] = useState('')
  const [course, setCourse] = useState('all')
  const [year, setYear] = useState('all')
  const [students, setStudents] = useState<StudentRecord[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  async function load() {
    setLoading(true)
    try {
      const data = await studentsService.list(query)
      setStudents(data.students)
      setError(null)
    } catch (caught) {
      setStudents([])
      setError(userMessage(caught))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load()
    }, 250)
    return () => window.clearTimeout(timer)
    // eslint is not configured; reload when query changes
  }, [query])

  const courses = Array.from(new Set(students.map((item) => item.course))).sort()
  const visible = students.filter((item) => {
    const matchesCourse = course === 'all' || item.course === course
    const matchesYear = year === 'all' || item.yearLevel === year
    return matchesCourse && matchesYear
  })

  return (
    <div>
      <PageHeader title="Students" description="Search clinic visitors by name or student ID." />
      <div className="mb-4 flex flex-col gap-3 md:flex-row">
        <SearchInput
          placeholder="Search by name or student ID"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="md:max-w-sm md:flex-1"
        />
        <Select value={course} onChange={(event) => setCourse(event.target.value)} aria-label="Filter by course" className="md:w-48">
          <option value="all">All courses</option>
          {courses.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </Select>
        <Select value={year} onChange={(event) => setYear(event.target.value)} aria-label="Filter by year" className="md:w-48">
          <option value="all">All years</option>
          {YEAR_LEVELS.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </Select>
      </div>
      {loading ? (
        <LoadingState label="Loading students..." />
      ) : error ? (
        <ErrorState title="Unable to load students." description={error} onRetry={() => void load()} />
      ) : visible.length === 0 ? (
        <EmptyState icon={Users} title="No students found." description="Try a different search or filter." />
      ) : (
        <>
          <div className="hidden md:block">
            <Table>
              <THead>
                <TR>
                  <TH>Student ID</TH>
                  <TH>Name</TH>
                  <TH>Course</TH>
                  <TH>Year</TH>
                  <TH>Queue activity</TH>
                  <TH>Status</TH>
                </TR>
              </THead>
              <TBody>
                {visible.map((item) => (
                  <TR key={item.id}>
                    <TD className="font-mono">{item.studentId}</TD>
                    <TD>{item.fullName}</TD>
                    <TD>{item.course}</TD>
                    <TD>{item.yearLevel}</TD>
                    <TD>{item.queueActivity}</TD>
                    <TD>
                      <Badge variant={item.status === 'active' ? 'success' : 'outline'}>{item.status}</Badge>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>
          <div className="space-y-3 md:hidden">
            {visible.map((item) => (
              <div key={item.id} className="rounded-xl border border-border bg-card p-4">
                <p className="font-medium">{item.fullName}</p>
                <p className="font-mono text-sm text-muted-foreground">{item.studentId}</p>
                <p className="mt-2 text-sm">
                  {item.course} · {item.yearLevel}
                </p>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
