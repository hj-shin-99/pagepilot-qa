import { useEffect, useState } from 'react'

const summaryCards = [
  { key: '수정 필요', label: '수정 필요' },
  { key: '확인 필요', label: '확인 필요' },
  { key: '무시 가능', label: '무시 가능' },
]

const issueUserStatuses = ['미확인', '수정 요청', '확인 완료', '무시']

const aiLoadingStages = [
  '페이지 접속 및 캡처 중',
  'Tech QA 분석 중',
  'Figma JSON 힌트 분석 중',
  'AI 시안 비교 중',
  'AI 2차 검증 중',
  '결과 정리 중',
]

function MockupQaPanel({ aiQa, designImages, figmaHintCount, result, webHintCount, onRunAiQa }) {
  const isRunning = aiQa?.state === 'running'
  const [selectedIssueIndex, setSelectedIssueIndex] = useState(0)
  const [showAllIssues, setShowAllIssues] = useState(false)
  const [copyStatus, setCopyStatus] = useState('')
  const [issueStatusState, setIssueStatusState] = useState({ key: '', map: {} })
  const [runningNow, setRunningNow] = useState(() => Date.now())

  useEffect(() => {
    if (!isRunning) return undefined

    const timerId = window.setInterval(() => setRunningNow(Date.now()), 1000)
    return () => window.clearInterval(timerId)
  }, [isRunning])

  const issues = Array.isArray(aiQa?.result?.issues) ? aiQa.result.issues.slice(0, 10) : []
  const summary = aiQa?.result?.summary && typeof aiQa.result.summary === 'object' ? aiQa.result.summary : aiQa?.result?.counts || {}
  const ignoredDifferences = Array.isArray(aiQa?.result?.ignoredDifferences) ? aiQa.result.ignoredDifferences : []
  const removedIssues = Array.isArray(aiQa?.result?.removedIssues) ? aiQa.result.removedIssues : []
  const debugCounts = aiQa?.result?.debug && typeof aiQa.result.debug === 'object' ? aiQa.result.debug : null
  const lowPriorityIssues = issues.filter((issue) => issue.priorityLevel === 'low')
  const actionableIssues = issues.filter((issue) => issue.status !== '무시 가능' && issue.priorityLevel !== 'low')
  const ignoredIssues = issues.filter((issue) => issue.status === '무시 가능')
  const visibleIssues = showAllIssues ? actionableIssues : actionableIssues.slice(0, 5)
  const isComplete = aiQa?.state === 'complete'
  const hasFigmaImage = Boolean(designImages[0]?.previewUrl)
  const hasWebImage = Boolean(result?.webScreenshot?.dataUrl)
  const issueCount = Number(summary.total || issues.length)
  const activeIssueIndex = visibleIssues[selectedIssueIndex] ? selectedIssueIndex : 0
  const selectedIssue = visibleIssues[activeIssueIndex] || actionableIssues[0] || null
  const hasMoreIssues = actionableIssues.length > 5
  const storageKey = getIssueStatusStorageKey(result)
  const deploymentText = getDeploymentSummary({ summary, checks: result?.checks || [] })
  const currentStageIndex = getAiLoadingStageIndex(aiQa?.startedAt, runningNow, isRunning)
  const currentStage = aiLoadingStages[currentStageIndex]
  const progressPercent = Math.round(((currentStageIndex + 1) / aiLoadingStages.length) * 100)

  const issueStatusMap = issueStatusState.key === storageKey ? issueStatusState.map : loadIssueStatusMap(storageKey)

  const handleIssueUserStatusChange = (issue, status) => {
    const issueKey = getIssueKey(issue)
    const nextStatusMap = { ...issueStatusMap, [issueKey]: status }
    setIssueStatusState({ key: storageKey, map: nextStatusMap })
    saveIssueStatusMap(storageKey, nextStatusMap)
  }

  const handleCopyQaComment = async () => {
    const text = createQaCommentText(visibleIssues.length > 0 ? visibleIssues : actionableIssues, summary)
    try {
      await navigator.clipboard.writeText(text)
      setCopyStatus('QA 코멘트를 복사했습니다.')
    } catch {
      setCopyStatus('클립보드 복사에 실패했습니다.')
    }
  }

  return (
    <section className="section-stack" aria-label="시안 비교 QA 결과">
      <article className="detail-card ai-qa-hero-card">
        <div className="section-title-row">
          <div>
            <p className="eyebrow">시안 비교 QA</p>
            <h3>AI QA 체크리스트</h3>
            <p className="panel-note relaxed-note">URL과 시안 이미지를 비교해 실제 수정/확인해야 할 핵심 항목만 정리합니다.</p>
          </div>
          <button className="primary-button ai-run-button" type="button" disabled={isRunning} onClick={onRunAiQa}>
            {isRunning ? 'AI 비교 중...' : isComplete ? '다시 검사하기' : '검사 시작'}
          </button>
        </div>

        <div className="ai-summary-box">
          {isRunning ? (
            <>
              <strong>{currentStage}</strong>
              <span>Playwright 결과는 수집됐고, AI가 시안 이미지/웹 캡처/JSON 힌트를 비교하고 있습니다.</span>
            </>
          ) : isComplete ? (
            <>
              <strong>AI 비교 완료</strong>
              <span>{issueCount > 0 ? `수정 필요 ${summary.fixNeeded || 0}건, 확인 필요 ${summary.checkNeeded || 0}건` : '확인 필요한 차이를 찾지 못했습니다.'}</span>
            </>
          ) : (
            <>
              <strong>검사 대기</strong>
              <span>검사 시작 후 AI가 웹 캡처와 시안을 직접 비교합니다.</span>
            </>
          )}
        </div>

        {isRunning ? <AiLoadingState currentStageIndex={currentStageIndex} progressPercent={progressPercent} /> : null}

        <div className="ai-summary-pills" aria-label="전달 이미지 상태">
          <span>Web 이미지 {hasWebImage ? '있음' : '없음'}</span>
          <span>Figma 이미지 {hasFigmaImage ? '있음' : '없음'}</span>
          <span>AI model: {aiQa?.result?.model || 'unknown'}</span>
          {aiQa?.result?.verification ? <span>{aiQa.result.verification.fallback ? 'AI 검증 fallback 사용' : '2차 AI 검증 완료'}</span> : null}
        </div>

        {isComplete ? <p className="deployment-summary">{deploymentText}</p> : null}

        {aiQa?.error ? <p className="ai-error-message">AI 분석 실패: {aiQa.error} 기존 Tech QA와 기계식 수집 결과는 계속 확인할 수 있습니다.</p> : null}
      </article>

      {isRunning ? <AiSkeletonChecklist /> : null}

      {isComplete ? (
        <article className="detail-card ai-result-card">
          <div className="section-title-row">
            <div>
              <h3>요약</h3>
              <p className="panel-note relaxed-note">기본 목록에는 수정/확인 필요한 핵심 항목만 표시합니다.</p>
            </div>
            <span>전체 {issueCount}건</span>
          </div>
          <div className="mockup-ai-summary-grid">
            {summaryCards.map((card) => (
              <div className="mockup-ai-summary-card" key={card.key}>
                <span>{card.label}</span>
                <strong>{Number(summary[card.key === '수정 필요' ? 'fixNeeded' : card.key === '확인 필요' ? 'checkNeeded' : 'ignored'] || 0)}</strong>
              </div>
            ))}
          </div>
        </article>
      ) : null}

      {isComplete ? (
        <article className="detail-card ai-result-card">
          <div className="section-title-row">
            <div>
              <h3>이미지 비교</h3>
              <p className="panel-note relaxed-note">이미지는 스크롤하여 전체 시안을 확인할 수 있습니다. 부정확한 빨간 박스는 표시하지 않습니다.</p>
            </div>
            <span>{selectedIssue ? `AI 판단 영역: ${selectedIssue.area || 'unknown'}` : '선택 이슈 없음'}</span>
          </div>
          <p className="mockup-ai-location-note">정확한 좌표가 불명확한 경우 마커를 표시하지 않습니다.</p>
          <div className="compare-scroll-shell">
            <div className="compare-grid">
              <ImageComparisonPane
                imageAlt="Figma 시안 이미지"
                imageSrc={designImages[0]?.previewUrl}
                label="Figma 시안"
                placeholder="Figma 시안 이미지를 업로드해 주세요."
                selectedArea={selectedIssue?.area}
              />
              <ImageComparisonPane
                imageAlt="Web 캡처 이미지"
                imageSrc={result?.webScreenshot?.dataUrl}
                label="Web 캡처"
                placeholder="URL 검사를 실행하면 웹 캡처가 표시됩니다."
                selectedArea={selectedIssue?.area}
              />
            </div>
          </div>
        </article>
      ) : null}

      {isComplete ? (
        <article className="detail-card ai-result-card">
          <div className="section-title-row">
            <div>
              <h3>AI QA 체크리스트</h3>
              <p className="panel-note relaxed-note">5초 안에 수정할 내용을 볼 수 있도록 핵심만 표시합니다.</p>
            </div>
            <div className="checklist-actions">
              <button className="secondary-button qa-copy-button" type="button" onClick={handleCopyQaComment}>QA 코멘트 복사</button>
              <span>{visibleIssues.length}/{actionableIssues.length}건</span>
            </div>
          </div>
          {copyStatus ? <p className="copy-status-note">{copyStatus}</p> : null}
          {visibleIssues.length > 0 ? (
            <>
              <ul className="ai-issue-list compact-checklist">
                {visibleIssues.map((issue, index) => (
                <AiIssueCard
                  isSelected={index === activeIssueIndex}
                  issue={issue}
                  userStatus={issueStatusMap[getIssueKey(issue)] || '미확인'}
                  key={`${index}-${issue.title}-${issue.area}`}
                  number={index + 1}
                  onSelect={() => setSelectedIssueIndex(index)}
                  onUserStatusChange={(status) => handleIssueUserStatusChange(issue, status)}
                />
                ))}
              </ul>
              {hasMoreIssues ? (
                <button className="secondary-button show-all-issues-button" type="button" onClick={() => setShowAllIssues((value) => !value)}>
                  {showAllIssues ? '핵심 5건만 보기' : `전체 보기 (${actionableIssues.length}건)`}
                </button>
              ) : null}
            </>
          ) : <p className="empty-row">확인 필요한 차이를 찾지 못했습니다.</p>}
        </article>
      ) : null}

      {isComplete && (lowPriorityIssues.length > 0 || ignoredIssues.length > 0 || removedIssues.length > 0) ? (
        <article className="detail-card ai-result-card ignored-issues-card">
          <details>
            <summary>낮은 우선순위/오탐 의심 항목 보기 ({lowPriorityIssues.length + ignoredIssues.length + removedIssues.length}건)</summary>
            <ul className="ignored-difference-list">
              {lowPriorityIssues.map((issue, index) => <li key={`low-${index}-${issue.title}`}>{issue.title}: {issue.memo || issue.figma || issue.web}</li>)}
              {ignoredIssues.map((issue, index) => <li key={`${index}-${issue.title}`}>{issue.title}: {issue.memo || issue.figma || issue.web}</li>)}
              {removedIssues.map((issue, index) => <li key={`removed-${index}-${issue.title}`}>{issue.title}: {issue.reason}</li>)}
            </ul>
          </details>
        </article>
      ) : null}

      {isComplete ? (
        <article className="detail-card ai-result-card json-reference-card">
          <details>
            <summary>JSON/DOM 참고 결과 보기</summary>
            <p className="panel-note relaxed-note">고급 참고 정보입니다. Figma JSON과 Web DOM은 AI 판단 보조용이며 단독 이슈 기준이 아닙니다.</p>
            <div className="json-reference-meta">
              <span>JSON 힌트 {figmaHintCount || 0}개</span>
              <span>DOM 힌트 {webHintCount || 0}개</span>
            </div>
            {debugCounts ? (
              <div className="json-reference-meta debug-counts" aria-label="AI debug counts">
                <span>webCtaHints {debugCounts.webCtaHints || 0}</span>
                <span>figmaCtaHints {debugCounts.figmaCtaHints || 0}</span>
                <span>visionIssues {debugCounts.visionIssues || 0}</span>
                <span>ctaIssues {debugCounts.ctaIssues || 0}</span>
                <span>imageIssues {debugCounts.imageIssues || 0}</span>
                <span>finalIssues {debugCounts.finalIssues || 0}</span>
              </div>
            ) : null}
            {ignoredDifferences.length > 0 ? (
              <ul className="ignored-difference-list">
                {ignoredDifferences.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}
              </ul>
            ) : <p className="empty-row">무시된 사소한 차이 또는 JSON 단독 이슈가 없습니다.</p>}
          </details>
        </article>
      ) : null}
    </section>
  )
}

function AiLoadingState({ currentStageIndex, progressPercent }) {
  return (
    <div className="ai-loading-card" role="status" aria-label="AI 분석 진행 상태">
      <div className="ai-progress-track" aria-hidden="true">
        <span style={{ width: `${progressPercent}%` }} />
      </div>
      <ol className="ai-stage-list">
        {aiLoadingStages.map((stage, index) => (
          <li className={index === currentStageIndex ? 'is-active' : index < currentStageIndex ? 'is-complete' : ''} key={stage}>
            {stage}
          </li>
        ))}
      </ol>
    </div>
  )
}

function AiSkeletonChecklist() {
  return (
    <article className="detail-card ai-result-card ai-skeleton-card" aria-label="AI QA 결과 준비 중">
      <div className="section-title-row">
        <div>
          <h3>AI QA 체크리스트 준비 중</h3>
          <p className="panel-note relaxed-note">결과가 비어 보이지 않도록 분석 후보를 정리하는 동안 임시 카드를 표시합니다.</p>
        </div>
        <span>AI 분석 중</span>
      </div>
      <div className="ai-skeleton-list" aria-hidden="true">
        {[0, 1, 2].map((item) => (
          <div className="ai-skeleton-row" key={item}>
            <span />
            <strong />
            <p />
          </div>
        ))}
      </div>
    </article>
  )
}

function getAiLoadingStageIndex(startedAt, now, isRunning) {
  if (!isRunning) return 0
  const elapsedSeconds = Math.max(0, (Number(now) - Number(startedAt || now)) / 1000)
  if (elapsedSeconds < 1.5) return 2
  if (elapsedSeconds < 12) return 3
  if (elapsedSeconds < 32) return 4
  return 5
}

function ImageComparisonPane({ imageAlt, imageSrc, label, placeholder, selectedArea }) {
  return (
    <section className="comparison-pane" aria-label={label}>
      <div className="comparison-pane-head">
        <strong>{label}</strong>
        <span>AI 판단 영역: {selectedArea || 'unknown'}</span>
      </div>
      <div className="comparison-image-frame mockup-ai-image-frame">
        {imageSrc ? (
          <div className="comparison-image-stage mockup-ai-image-stage">
            <img src={imageSrc} alt={imageAlt} />
          </div>
        ) : <div className="comparison-placeholder mockup-ai-image-placeholder">{placeholder}</div>}
      </div>
    </section>
  )
}

function AiIssueCard({ isSelected, issue, number, onSelect, onUserStatusChange, userStatus }) {
  return (
    <li className={`ai-issue-row mockup-ai-issue-card ${getStatusClass(issue.status)} ${isSelected ? 'is-selected' : ''}`}>
      <span className="ai-issue-number">{number}</span>
      <div className="mockup-ai-issue-content">
        <button className="mockup-ai-issue-main" type="button" onClick={onSelect}>
          <span className={`status-badge ${getStatusClass(issue.status)}`}>{issue.status || '확인 필요'}</span>
          <span className="issue-type-badge">{issue.type || '레이아웃'}</span>
          <strong>{issue.title || '확인 필요 항목입니다.'}</strong>
          <span className="checklist-value"><b>시안</b>{issue.figma || '확인 필요'}</span>
          <span className="checklist-value"><b>현재</b>{issue.web || '확인 필요'}</span>
        </button>
        <details className="mockup-ai-issue-detail">
          <summary>자세히</summary>
          <dl>
            <div><dt>영역/유형</dt><dd>{issue.area || 'unknown'} / {issue.type || '레이아웃'}</dd></div>
            <div><dt>메모</dt><dd>{issue.memo || '추가 메모 없음'}</dd></div>
            <div><dt>Confidence</dt><dd>{formatConfidence(issue.confidence)}</dd></div>
          </dl>
        </details>
        <div className="issue-status-actions" aria-label="이슈 상태 변경">
          {issueUserStatuses.map((status) => (
            <button
              className={userStatus === status ? 'is-active' : ''}
              key={status}
              type="button"
              onClick={() => onUserStatusChange(status)}
            >
              {status}
            </button>
          ))}
        </div>
      </div>
    </li>
  )
}

function getDeploymentSummary({ summary, checks }) {
  const techNeedsAttention = checks.some((check) => ['access', 'http-status', 'console-errors', 'images'].includes(check.id) && check.status === 'error')
  const designText = Number(summary.fixNeeded || 0) > 0
    ? '배포 전 수정 권장'
    : Number(summary.checkNeeded || 0) > 0 ? '확인 후 배포 가능' : '특이사항 없음'
  return techNeedsAttention ? `${designText} · 기술 QA 확인 필요` : designText
}

function createQaCommentText(issues, summary) {
  const lines = [
    '[PagePilot QA 결과]',
    `수정 필요 ${summary.fixNeeded || 0}건 / 확인 필요 ${summary.checkNeeded || 0}건`,
    '',
  ]

  issues.filter((issue) => issue.status !== '무시 가능').slice(0, 5).forEach((issue, index) => {
    lines.push(`${index + 1}. ${issue.title || '확인 필요 항목입니다.'}`)
    lines.push(`- 시안: ${issue.figma || '확인 필요'}`)
    lines.push(`- 현재: ${issue.web || '확인 필요'}`)
    lines.push('')
  })

  return lines.join('\n').trim()
}

function getIssueStatusStorageKey(result) {
  return `pagepilot-ai-issue-status:${result?.targetUrl || 'unknown'}:${result?.scannedAt || 'latest'}`
}

function getIssueKey(issue) {
  return `${issue.area || 'unknown'}:${issue.type || 'unknown'}:${issue.title || ''}:${issue.figma || ''}:${issue.web || ''}`
}

function loadIssueStatusMap(storageKey) {
  try {
    return JSON.parse(window.localStorage.getItem(storageKey) || '{}')
  } catch {
    return {}
  }
}

function saveIssueStatusMap(storageKey, value) {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(value))
  } catch {
    // localStorage may be unavailable in private or restricted contexts.
  }
}

function getStatusClass(status) {
  if (status === '수정 필요') return 'needs-fix'
  if (status === '무시 가능') return 'can-ignore'
  return 'needs-check'
}

function formatConfidence(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return '0.50'
  return number.toFixed(2)
}

export default MockupQaPanel
