import { useId, useState } from 'react'

export function SimpleBarChart({
  data,
  emptyLabel = 'No analytics data available.',
  chartLabel = 'Visitors',
  hourly = false,
}: {
  data: { label: string; value: number }[]
  emptyLabel?: string
  chartLabel?: string
  hourly?: boolean
}) {
  if (!data.length) {
    return <p className="py-10 text-center text-sm text-muted-foreground">{emptyLabel}</p>
  }

  return <TrafficSvgChart data={data} chartLabel={chartLabel} hourly={hourly} />
}

function TrafficSvgChart({
  data,
  chartLabel,
  hourly,
}: {
  data: { label: string; value: number }[]
  chartLabel: string
  hourly: boolean
}) {
  const chartId = useId()
  const [activeIndex, setActiveIndex] = useState<number | null>(null)
  const width = 720
  const height = 280
  const margin = { top: 24, right: 18, bottom: 58, left: 48 }
  const plotWidth = width - margin.left - margin.right
  const plotHeight = height - margin.top - margin.bottom
  const max = Math.max(...data.map((item) => item.value), 1)
  const tickCount = 4
  const slotWidth = plotWidth / data.length
  const barWidth = Math.min(52, Math.max(10, slotWidth * 0.64))
  const labelStep = data.length > 12 ? Math.ceil(data.length / 8) : 1
  const activeItem = activeIndex === null ? null : data[activeIndex]

  function displayLabel(label: string) {
    if (!hourly) return label
    const match = /^(\d{1,2}):00$/.exec(label)
    if (!match) return label
    const hour = Number(match[1])
    const suffix = hour >= 12 ? 'PM' : 'AM'
    const displayHour = hour % 12 || 12
    return `${displayHour}:00 ${suffix}`
  }

  function valueY(value: number) {
    return margin.top + plotHeight - (value / max) * plotHeight
  }

  return (
    <div className="relative w-full" aria-label={`${chartLabel} by ${hourly ? 'hour' : 'day'}`}>
      <svg
        className="h-64 w-full overflow-visible"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-labelledby={`${chartId}-title ${chartId}-description`}
      >
        <title id={`${chartId}-title`}>{chartLabel}</title>
        <desc id={`${chartId}-description`}>Number of queue entries created during each {hourly ? 'hour' : 'day'}.</desc>

        {Array.from({ length: tickCount + 1 }, (_, index) => {
          const value = Math.round((max / tickCount) * index)
          const y = valueY(value)
          return (
            <g key={`tick-${value}`}>
              <line x1={margin.left} x2={width - margin.right} y1={y} y2={y} className="stroke-border" strokeWidth="1" />
              <text x={margin.left - 10} y={y + 4} textAnchor="end" className="fill-muted-foreground text-[12px]">{value}</text>
            </g>
          )
        })}

        <line x1={margin.left} x2={width - margin.right} y1={margin.top + plotHeight} y2={margin.top + plotHeight} className="stroke-foreground/30" strokeWidth="1" />
        <text x={margin.left} y={14} className="fill-muted-foreground text-[12px]">Visitors</text>

        {data.map((item, index) => {
          const center = margin.left + index * slotWidth + slotWidth / 2
          const x = center - barWidth / 2
          const y = valueY(item.value)
          const barHeight = Math.max(item.value > 0 ? 2 : 0, margin.top + plotHeight - y)
          const isActive = activeIndex === index
          return (
            <g key={`${item.label}-${index}`}>
              <rect
                x={x}
                y={y}
                width={barWidth}
                height={barHeight}
                rx="4"
                className={isActive ? 'fill-accent' : 'fill-accent/75'}
                role="img"
                tabIndex={0}
                aria-label={`${displayLabel(item.label)}, ${item.value} visitors`}
                onMouseEnter={() => setActiveIndex(index)}
                onMouseLeave={() => setActiveIndex(null)}
                onFocus={() => setActiveIndex(index)}
                onBlur={() => setActiveIndex(null)}
                onClick={() => setActiveIndex(isActive ? null : index)}
              >
                <title>{`${displayLabel(item.label)}: ${item.value} visitors`}</title>
              </rect>
              {(index % labelStep === 0 || index === data.length - 1) ? (
                <text x={center} y={height - 24} textAnchor="middle" className="fill-muted-foreground text-[11px]">
                  {displayLabel(item.label)}
                </text>
              ) : null}
            </g>
          )
        })}

        {activeItem && activeIndex !== null ? (() => {
          const center = margin.left + activeIndex * slotWidth + slotWidth / 2
          const tooltipWidth = 132
          const tooltipX = Math.min(width - margin.right - tooltipWidth, Math.max(margin.left, center - tooltipWidth / 2))
          const tooltipY = Math.max(2, valueY(activeItem.value) - 44)
          return (
            <g pointerEvents="none">
              <rect x={tooltipX} y={tooltipY} width={tooltipWidth} height="34" rx="6" className="fill-foreground" />
              <text x={tooltipX + tooltipWidth / 2} y={tooltipY + 14} textAnchor="middle" className="fill-background text-[11px] font-medium">
                {displayLabel(activeItem.label)}
              </text>
              <text x={tooltipX + tooltipWidth / 2} y={tooltipY + 27} textAnchor="middle" className="fill-background text-[11px]">
                {activeItem.value} visitors
              </text>
            </g>
          )
        })() : null}
      </svg>
    </div>
  )
}
