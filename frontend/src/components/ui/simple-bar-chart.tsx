export function SimpleBarChart({
  data,
  emptyLabel = 'No analytics data available.',
}: {
  data: { label: string; value: number }[]
  emptyLabel?: string
}) {
  if (!data.length) {
    return <p className="py-10 text-center text-sm text-muted-foreground">{emptyLabel}</p>
  }

  const max = Math.max(...data.map((item) => item.value), 1)

  return (
    <div className="flex h-48 items-end gap-2">
      {data.map((item) => (
        <div key={item.label} className="flex min-w-0 flex-1 flex-col items-center gap-2">
          <div
            className="w-full max-w-10 rounded-t-md bg-accent/80"
            style={{ height: `${Math.max(6, (item.value / max) * 100)}%` }}
            title={`${item.label}: ${item.value}`}
          />
          <span className="truncate text-[11px] text-muted-foreground">{item.label}</span>
        </div>
      ))}
    </div>
  )
}
