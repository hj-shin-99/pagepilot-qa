function EmptyState({ scanState, scanError, mode = 'visual', combined = false, scanStage = 'idle' }) {
  const isScanning = scanState === 'scanning' || scanState === 'loading'
  const isFailed = scanState === 'failed' || scanState === 'error'
  const isSkipped = scanState === 'skipped'
  const isTech = mode === 'tech'
  const isOverview = mode === 'overview'

  return (
    <section className={`empty-state ${isScanning ? 'is-scanning' : ''} ${isFailed ? 'is-failed' : ''}`}>
      <div>
        <div className="state-indicator" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <p className="state-label">{isFailed ? '검사 실패' : isScanning ? '검사 중' : isSkipped ? '미실행' : '검사 전'}</p>
        <h2>{getTitle({ isFailed, isScanning, isSkipped, isTech, isOverview, combined })}</h2>
        <p>{isFailed ? scanError : getDescription({ isTech, isSkipped, isScanning, isOverview, combined })}</p>
        {isScanning ? (
          <ol className="scan-stage-list" aria-label="검사 진행 단계">
            {getStages({ isTech, combined }).map((stage, index) => (
              <li className={`scan-stage-row ${getStageClassName(index, getActiveStageIndex({ isTech, combined, scanStage }))}`} key={stage}>
                <span className="scan-stage-dot" aria-hidden="true" />
                <span className="scan-stage-text">{stage}</span>
              </li>
            ))}
          </ol>
        ) : null}
      </div>
    </section>
  )
}

function getTitle({ isFailed, isScanning, isSkipped, isTech, isOverview, combined }) {
  if (isFailed) return '검사 요청을 완료하지 못했습니다.'
  if (isScanning && combined) return 'Web 페이지와 Figma 시안을 분석하고 있습니다.'
  if (isScanning) return 'Web 페이지를 분석하고 있습니다.'
  if (isSkipped) return 'Figma URL을 입력하면 Visual QA를 함께 실행합니다.'
  if (isOverview) return 'PagePilot QA'
  return isTech ? 'Tech QA' : 'Visual QA'
}

function getDescription({ isTech, isSkipped, isScanning, isOverview, combined }) {
  if (isOverview) return <>Web URL만 입력하면 Tech QA를 실행합니다.<br />Figma URL을 함께 입력하면 Visual QA도 같이 실행합니다.</>
  if (isSkipped) return '왼쪽 입력 영역에 Figma Frame URL을 추가하고 검사 시작을 누르면 Visual QA도 실행됩니다.'
  if (!isScanning) return isTech ? 'Web URL을 입력하고 검사를 시작하세요. 페이지 접속 상태와 기술 항목을 검사합니다.' : 'Web URL과 Figma URL을 입력하세요. Figma 시안과 Web 페이지를 비교합니다.'
  if (combined) return 'Visual QA와 Tech QA를 함께 검사하고 결과를 정리하고 있습니다.'
  return isTech
    ? 'Tech QA 항목을 검사하고 있습니다.'
    : 'Figma와 Web을 수집해 canonical Visual QA 결과를 생성합니다.'
}

function getStages({ isTech, combined }) {
  if (combined) return [
    'Web 페이지와 검사 데이터를 수집하고 있습니다.',
    '시안 정보와 Web 데이터를 비교하고 있습니다.',
    '구조와 콘텐츠의 차이를 검증하고 있습니다.',
    'AI가 확인된 차이를 최종 검토하고 있습니다.',
    '최종 QA 결과를 정리하고 있습니다.',
  ]
  return isTech
    ? [
      'Web 페이지를 수집하고 있습니다.',
      '접속, 링크, 이미지 및 메타 정보를 검사하고 있습니다.',
      '모바일과 기술 품질 항목을 확인하고 있습니다.',
      '최종 QA 결과를 정리하고 있습니다.',
    ]
    : [
      '시안 화면을 준비하고 있습니다.',
      'Web 화면을 수집하고 있습니다.',
      '비교 기준 데이터를 생성하고 있습니다.',
    ]
}

function getActiveStageIndex({ isTech, combined, scanStage }) {
  if (combined) {
    if (scanStage === 'ai-review') return 3
    if (scanStage === 'finalizing') return 4
    return 0
  }
  if (scanStage === 'finalizing') return isTech ? 3 : 2
  return 0
}

function getStageClassName(index, activeIndex) {
  if (index === activeIndex) return 'is-active'
  if (index < activeIndex) return 'is-complete'
  return ''
}

export default EmptyState
