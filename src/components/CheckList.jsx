import StatusChip from './StatusChip'

const checkDescriptions = {
  access: '검사 대상 URL이 정상적으로 열리는지 확인합니다.',
  'http-status': '서버가 정상 응답했는지 확인합니다. 200은 정상, 404/500 계열은 오류 가능성이 있습니다.',
  title: '브라우저 탭과 검색 결과에 표시되는 제목입니다. 비어 있으면 기본 설정 누락 가능성이 있습니다.',
  'console-errors': '페이지 실행 중 브라우저에서 발생한 JavaScript 오류입니다. 기능 오류 가능성이 있습니다.',
  images: '페이지 안의 이미지가 정상으로 불러와졌는지 확인합니다. 실패 시 깨진 이미지가 노출될 수 있습니다.',
  links: '페이지 내 주요 링크 URL을 수집하고 접근 가능 여부를 확인합니다.',
  'missing-href': '클릭 가능해 보이는 요소에 이동 URL이 없는 상태입니다. 단순 스크립트 버튼이면 정상일 수 있으나 CTA라면 확인이 필요합니다.',
  'bad-links': '연결된 페이지나 리소스 중 없는 페이지 또는 서버 오류가 있는지 확인합니다.',
  'interaction-count': '페이지 내 버튼과 a 태그 개수를 수집해 클릭 가능한 요소 규모를 파악합니다.',
  mobile: '모바일 화면 대응을 위한 viewport 설정 여부를 확인합니다.',
}

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
            <strong className="check-title-with-help">
              {check.title}
              {checkDescriptions[check.id] ? (
                <span className="check-help" tabIndex="0" aria-label={`${check.title} 설명: ${checkDescriptions[check.id]}`}>
                  ?
                  <span className="check-help-tooltip" role="tooltip">{checkDescriptions[check.id]}</span>
                </span>
              ) : null}
            </strong>
            <StatusChip status={check.status} />
            <span className="check-value-inline">{check.value}</span>
            <span className="check-detail-inline">
              {checkDescriptions[check.id] ? <em>{checkDescriptions[check.id]}</em> : null}
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
