import StatusChip from './StatusChip'

function CheckList({ checks }) {
  return (
    <section className="detail-card" aria-label="상세 검사 테이블">
      <div className="section-title-row">
        <h3>상세 검사 테이블</h3>
        <span>{checks.length}개 항목</span>
      </div>
      <div className="qa-table">
        <div className="qa-table-head">
          <span>검사 항목</span>
          <span>상태</span>
          <span>결과</span>
          <span>세부 내용</span>
        </div>
        {checks.map((check) => (
          <div className="qa-table-row" key={check.id}>
            <strong>{check.title}</strong>
            <StatusChip status={check.status} />
            <span className="check-value-inline">{check.value}</span>
            <span className="check-detail-inline">
              {check.detail}
              {Array.isArray(check.items) && check.items.length > 0 ? (
                <details className="check-detail-expander">
                  <summary>상세 위치 {check.items.length}개</summary>
                  <ul>
                    {check.items.slice(0, 8).map((item, index) => (
                      <li key={`${index}-${item.selector || item.source || item.src || item.url || item.message}`}>
                        <strong>{item.label || item.alt || item.source || item.src || item.url || `Item ${index + 1}`}</strong>
                        <span>{formatItemLocation(item)}</span>
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </span>
          </div>
        ))}
      </div>
    </section>
  )
}

function formatItemLocation(item) {
  const parts = []
  if (item.selector) parts.push(`selector: ${item.selector}`)
  if (item.domPath) parts.push(`DOM: ${item.domPath}`)
  if (item.section) parts.push(`section: ${item.section}`)
  if (Number.isFinite(Number(item.y))) parts.push(`y: ${Math.round(Number(item.y))}px`)
  if (item.lineNumber !== null && item.lineNumber !== undefined) parts.push(`line: ${item.lineNumber}`)
  if (item.message) parts.push(item.message)
  return parts.join(' · ') || '위치 정보 없음'
}

export default CheckList
