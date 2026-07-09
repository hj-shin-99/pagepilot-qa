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
  meta: '검색/공유 시 노출되는 기본 정보가 설정되어 있는지 확인합니다.',
  'image-alt': '접근성과 검색 최적화를 위해 이미지 대체 텍스트가 있는지 확인합니다.',
  forms: '구매상담/신청 폼에서 입력 항목의 접근성 및 기본 설정을 확인합니다.',
  'external-links': '새 창으로 열리는 외부 링크의 보안 속성이 설정되어 있는지 확인합니다.',
  'duplicate-ids': '중복 ID는 스크립트 오류나 접근성 문제를 만들 수 있습니다.',
  headings: '페이지 구조와 접근성, SEO 기본 구조를 확인합니다.',
  'resource-size': '페이지 로딩 속도에 영향을 줄 수 있는 무거운 리소스를 확인합니다.',
  'network-failures': '페이지 구성 리소스 중 불러오지 못한 파일이 있는지 확인합니다.',
  'mobile-overflow': '모바일에서 화면이 옆으로 밀리거나 깨지는 문제가 있는지 확인합니다.',
  'unlabeled-clickables': '아이콘 버튼 등 사용자와 보조기기가 목적을 알기 어려운 클릭 요소를 확인합니다.',
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
            <strong>{check.title}</strong>
            <StatusChip status={check.status} />
            <span className="check-value-inline">{check.value}</span>
            <span className="check-detail-inline">
              {checkDescriptions[check.id] ? <em>{checkDescriptions[check.id]}</em> : null}
              {check.detail}
              {Array.isArray(check.items) && check.items.length > 0 ? (
                <details className="check-detail-expander">
                  <summary>{getDetailSummaryLabel(check)} {check.items.length}개</summary>
                  <ul>
                    {check.items.map((item, index) => (
                      <li key={`${index}-${item.selector || item.domPath || item.source || item.src || item.url || item.message}`}>
                        <strong>{formatItemTitle(item, index)}</strong>
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

function getDetailSummaryLabel(check) {
  if (['console-errors', 'network-failures'].includes(check.id)) return '기술 로그 보기'
  return '수집된 상세 데이터 보기'
}

function formatItemTitle(item, index) {
  return item.label || item.alt || item.id || item.name || item.source || item.src || item.url || item.selector || `Item ${index + 1}`
}

function formatItemLocation(item) {
  const parts = []
  if (item.statusCode !== null && item.statusCode !== undefined) parts.push(`status: ${item.statusCode}`)
  if (item.type) parts.push(`type: ${item.type}`)
  if (item.name) parts.push(`name: ${item.name}`)
  if (item.required !== undefined) parts.push(`required: ${item.required ? 'true' : 'false'}`)
  if (item.url) parts.push(`url: ${item.url}`)
  if (item.src) parts.push(`src: ${item.src}`)
  if (item.selector) parts.push(`selector: ${item.selector}`)
  if (item.domPath) parts.push(`DOM: ${item.domPath}`)
  if (item.section) parts.push(`section: ${item.section}`)
  if (Number.isFinite(Number(item.y))) parts.push(`y: ${Math.round(Number(item.y))}px`)
  if (item.boundingBox) parts.push(`box: ${formatBox(item.boundingBox)}`)
  if (item.target) parts.push(`target: ${item.target}`)
  if (item.rel) parts.push(`rel: ${item.rel}`)
  if (Number.isFinite(Number(item.sizeBytes))) parts.push(`size: ${formatBytes(item.sizeBytes)}`)
  if (item.lineNumber !== null && item.lineNumber !== undefined) parts.push(`line: ${item.lineNumber}`)
  if (item.message) parts.push(item.message)
  return parts.join(' · ') || '위치 정보 없음'
}

function formatBox(box) {
  if (!box || typeof box !== 'object') return '정보 없음'
  return ['x', 'y', 'width', 'height']
    .filter((key) => Number.isFinite(Number(box[key])))
    .map((key) => `${key} ${Math.round(Number(box[key]))}`)
    .join(', ')
}

function formatBytes(value) {
  const bytes = Number(value)
  if (!Number.isFinite(bytes)) return '정보 없음'
  if (bytes >= 1024 * 1024) return `${Math.round((bytes / 1024 / 1024) * 10) / 10}MB`
  return `${Math.round(bytes / 1024)}KB`
}

export default CheckList
