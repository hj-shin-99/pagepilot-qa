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
            <span className="check-detail-inline">{check.detail}</span>
          </div>
        ))}
      </div>
    </section>
  )
}

export default CheckList
