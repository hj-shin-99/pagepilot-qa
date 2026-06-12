function SummaryCards({ counts, result }) {
  const metrics = [
    { label: '정상', value: counts.ok, className: 'status-ok' },
    { label: '오류', value: counts.error, className: 'status-error' },
    { label: '확인 필요', value: counts.warn, className: 'status-warn' },
    { label: 'HTTP 상태', value: result.httpStatus || '-', className: '' },
    { label: '수집 링크', value: result.counts.anchors, className: '' },
    { label: '버튼', value: result.counts.buttons, className: '' },
  ]

  return (
    <section className="metrics-grid" aria-label="QA 결과 요약">
      {metrics.map((metric) => (
        <article className={`metric-card ${metric.className}`} key={metric.label}>
          <p className="metric-label">{metric.label}</p>
          <p className="metric-value">{metric.value}</p>
        </article>
      ))}
    </section>
  )
}

export default SummaryCards
