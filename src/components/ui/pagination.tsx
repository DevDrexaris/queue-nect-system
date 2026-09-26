import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from './button'

export function Pagination({
  page,
  pageCount,
  onPageChange,
}: {
  page: number
  pageCount: number
  onPageChange: (page: number) => void
}) {
  if (pageCount <= 1) return null
  return (
    <div className="flex items-center justify-end gap-2 pt-4">
      <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
        <ChevronLeft className="size-4" />
        Previous
      </Button>
      <span className="text-sm text-muted-foreground">
        Page {page} of {pageCount}
      </span>
      <Button variant="outline" size="sm" disabled={page >= pageCount} onClick={() => onPageChange(page + 1)}>
        Next
        <ChevronRight className="size-4" />
      </Button>
    </div>
  )
}
