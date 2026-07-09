function EmptyState({ scanState, scanError }) {
  const isScanning = scanState === 'scanning'
  const isFailed = scanState === 'failed'

  return (
    <section className={`empty-state ${isScanning ? 'is-scanning' : ''} ${isFailed ? 'is-failed' : ''}`}>
      <div>
        <div className="state-indicator" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <p className="state-label">{isFailed ? '검사 실패' : isScanning ? '검사 중' : '검사 전'}</p>
        <h2>{isFailed ? '검사 요청을 완료하지 못했습니다.' : isScanning ? 'AI가 페이지를 분석하고 있습니다.' : '테스트 URL을 입력하고 검사를 시작하세요.'}</h2>
        <p>{isFailed ? scanError : '로컬 API 서버가 입력 URL에만 접속하며, 결과는 저장하지 않습니다.'}</p>
        {isScanning ? (
          <ol className="scan-stage-list" aria-label="검사 진행 단계">
            <li className="is-active">페이지 접속 및 캡처 중</li>
            <li>Tech QA 분석 중</li>
            <li>AI 시안 비교 준비 중</li>
          </ol>
        ) : null}
      </div>
    </section>
  )
}

export default EmptyState
