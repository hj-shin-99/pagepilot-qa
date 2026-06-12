const designStatusLabels = {
  ok: '정상',
  error: '차이 있음',
  warn: '확인 필요',
}

function DesignQaPanel({ designQa, figmaElements, webElements }) {
  return (
    <section className="section-stack" aria-label="Design QA 결과">
      <div className="metrics-grid compact-metrics">
        <article className="metric-card status-ok">
          <p className="metric-label">정상</p>
          <p className="metric-value">{designQa.counts.ok}</p>
        </article>
        <article className="metric-card status-error">
          <p className="metric-label">차이 있음</p>
          <p className="metric-value">{designQa.counts.error}</p>
        </article>
        <article className="metric-card status-warn">
          <p className="metric-label">확인 필요</p>
          <p className="metric-value">{designQa.counts.warn}</p>
        </article>
      </div>

      <article className="detail-card">
        <div className="section-title-row">
          <h3>Figma vs Web 비교</h3>
          <span>Figma {figmaElements.length}개 · Web {webElements.length}개</span>
        </div>
        <div className="qa-table design-table">
          <div className="qa-table-head">
            <span>구분</span>
            <span>상태</span>
            <span>문구</span>
            <span>플래너 메모</span>
          </div>
          {designQa.issues.map((issue, index) => (
            <div className="qa-table-row" key={`${issue.label}-${issue.text}-${index}`}>
              <strong>{issue.label}</strong>
              <span className={`status-chip status-${issue.status}`}>{designStatusLabels[issue.status]}</span>
              <span className="check-value-inline">{issue.text}</span>
              <span className="check-detail-inline">{issue.detail}</span>
            </div>
          ))}
        </div>
      </article>

      <article className="detail-card">
        <div className="section-title-row">
          <h3>판정 기준</h3>
          <span>{designStatusLabels.error}은 누락, {designStatusLabels.warn}는 리뷰 항목</span>
        </div>
        <p className="panel-note relaxed-note">
          텍스트는 공백과 대소문자를 정규화해 비교합니다. 누락 문구는 오류로, 폰트/컬러/CTA/레이아웃 차이는 기획자가 판단할 검토 필요 항목으로 표시합니다.
        </p>
      </article>
    </section>
  )
}

export default DesignQaPanel
