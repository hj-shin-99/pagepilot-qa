import { useMemo, useRef, useState } from 'react'

const INITIAL_ISSUE_LIMIT = 50
const ISSUE_LIMIT_STEP = 50

const metricLabels = [
  { key: 'total', label: '전체' },
  { key: 'high', label: 'High' },
  { key: 'text', label: '텍스트' },
  { key: 'style', label: '스타일' },
  { key: 'layout', label: '위치/크기' },
  { key: 'cta', label: 'CTA' },
]

const filterLabels = [
  { key: 'all', label: '전체' },
  { key: 'text', label: '텍스트' },
  { key: 'style', label: '스타일' },
  { key: 'layout', label: '위치/크기' },
  { key: 'cta', label: 'CTA' },
  { key: 'footer', label: '디스클레이머/푸터' },
]

const statusLabels = {
  ok: '정상',
  error: '차이 있음',
  warn: '확인 필요',
}

function MockupQaPanel({ designImages, designQa, figmaElements, result, webElements }) {
  const [activeFilter, setActiveFilter] = useState('all')
  const [visibleLimit, setVisibleLimit] = useState(INITIAL_ISSUE_LIMIT)
  const [selectedImageId, setSelectedImageId] = useState(designImages[0]?.id || '')
  const [selectedIssueId, setSelectedIssueId] = useState('')
  const webFrameRef = useRef(null)
  const figmaFrameRef = useRef(null)
  const isSyncingScrollRef = useRef(false)

  const actionableIssues = useMemo(
    () => designQa.issues.filter((issue) => issue.status !== 'ok'),
    [designQa.issues],
  )
  const baseIssues = actionableIssues.length > 0 ? actionableIssues : designQa.issues
  const filteredIssues = useMemo(
    () => baseIssues.filter((issue) => matchesFilter(issue, activeFilter)),
    [activeFilter, baseIssues],
  )
  const visibleIssues = filteredIssues.slice(0, visibleLimit)
  const issueGroups = useMemo(() => groupIssuesBySection(visibleIssues), [visibleIssues])
  const firstImageId = designImages[0]?.id || ''
  const firstIssueId = filteredIssues[0]?.id || ''
  const activeImageId = designImages.some((image) => image.id === selectedImageId) ? selectedImageId : firstImageId
  const activeIssueId = filteredIssues.some((issue) => issue.id === selectedIssueId) ? selectedIssueId : firstIssueId
  const selectedImage = designImages.find((image) => image.id === activeImageId) || designImages[0]
  const selectedIssue = filteredIssues.find((issue) => issue.id === activeIssueId) || filteredIssues[0]

  const handleIssueSelect = (issue) => {
    setSelectedIssueId(issue.id)
    document.getElementById('mockup-compare-viewer')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const handleFilterSelect = (filter) => {
    setActiveFilter(filter)
    setVisibleLimit(INITIAL_ISSUE_LIMIT)
  }

  const handleSyncedScroll = (sourceRef, targetRef) => {
    if (isSyncingScrollRef.current || !sourceRef.current || !targetRef.current) return

    const source = sourceRef.current
    const target = targetRef.current
    const sourceMaxScroll = source.scrollHeight - source.clientHeight
    const targetMaxScroll = target.scrollHeight - target.clientHeight
    const ratio = sourceMaxScroll > 0 ? source.scrollTop / sourceMaxScroll : 0

    isSyncingScrollRef.current = true
    target.scrollTop = targetMaxScroll * ratio
    window.requestAnimationFrame(() => {
      isSyncingScrollRef.current = false
    })
  }

  return (
    <section className="section-stack" aria-label="시안 비교 QA 결과">
      <section className="metrics-grid mockup-metrics" aria-label="시안 비교 QA 이슈 요약">
        {metricLabels.map((metric) => (
          <article className={`metric-card ${metric.key === 'high' && designQa.summaryCounts.high > 0 ? 'status-error' : ''}`} key={metric.key}>
            <p className="metric-label">{metric.label}</p>
            <p className="metric-value">{designQa.summaryCounts[metric.key]}</p>
          </article>
        ))}
      </section>

      <article className="detail-card mockup-section-summary-card">
        <div className="section-title-row">
          <h3>섹션 요약</h3>
          <span>{designQa.sectionSummaries.length}개 섹션 · 상위 이슈 {designQa.topIssues.length}개 추적</span>
        </div>
        {designQa.sectionSummaries.length > 0 ? (
          <div className="section-summary-grid">
            {designQa.sectionSummaries.map((section) => (
              <article className="section-summary-pill" key={section.id}>
                <strong>{section.name}</strong>
                <span>총 {section.total} · High {section.high} · 텍스트 {section.text} · 스타일 {section.style} · 위치 {section.layout} · CTA {section.cta}</span>
              </article>
            ))}
          </div>
        ) : (
          <p className="panel-note relaxed-note">섹션별 이슈가 없습니다. Figma JSON과 URL 검사를 함께 실행해 주세요.</p>
        )}
      </article>

      <article className="detail-card mockup-viewer-card" id="mockup-compare-viewer">
        <div className="section-title-row">
          <h3>웹 화면 vs Figma 시안</h3>
          <span>Figma {figmaElements.length}개 · Web {webElements.length}개 · pixel diff 미실행</span>
        </div>

        <div className="mockup-comparison-grid">
          <ComparisonPane
            anchorLabel="web"
            frameRef={webFrameRef}
            highlightRatio={getPanePositionRatio(selectedIssue, 'web')}
            imageAlt="Playwright full-page web screenshot"
            imageSrc={result.webScreenshot?.dataUrl}
            issue={selectedIssue}
            label="Web Screenshot"
            note={formatScreenshotMeta(result.webScreenshot)}
            placeholder={result.webScreenshot ? '히스토리는 웹 screenshot 원본을 저장하지 않아 메타데이터만 표시됩니다.' : 'URL 검사를 실행하면 Playwright full-page screenshot이 표시됩니다.'}
            onScroll={() => handleSyncedScroll(webFrameRef, figmaFrameRef)}
          />
          <ComparisonPane
            anchorLabel="figma"
            frameRef={figmaFrameRef}
            highlightRatio={getPanePositionRatio(selectedIssue, 'figma')}
            imageAlt={selectedImage ? `${selectedImage.name} preview` : 'Figma design mockup'}
            imageSrc={selectedImage?.previewUrl}
            issue={selectedIssue}
            label="Figma 시안 이미지"
            note={selectedImage ? formatImageMeta(selectedImage) : '업로드 대기'}
            placeholder={selectedImage ? '히스토리는 원본 이미지를 저장하지 않아 메타데이터만 표시됩니다.' : '좌측 패널에서 Figma 시안 이미지를 업로드해 주세요.'}
            onScroll={() => handleSyncedScroll(figmaFrameRef, webFrameRef)}
          />
        </div>

        <div className="image-selector" aria-label="Figma 시안 이미지 선택">
          {designImages.length > 0 ? designImages.map((image) => (
            <button
              aria-pressed={activeImageId === image.id}
              className={activeImageId === image.id ? 'is-active' : ''}
              key={image.id}
              type="button"
              onClick={() => setSelectedImageId(image.id)}
            >
              <span>{image.name}</span>
              <small>{formatImageMeta(image)}</small>
            </button>
          )) : <p className="panel-note relaxed-note">업로드된 Figma 시안 이미지가 없습니다.</p>}
        </div>
      </article>

      <article className="detail-card mockup-report-card">
        <div className="section-title-row">
          <h3>플래너용 그룹 이슈</h3>
          <span>우선순위 정렬 · 기본 {INITIAL_ISSUE_LIMIT}개 표시</span>
        </div>

        <div className="mockup-filter-bar" aria-label="시안 비교 이슈 필터">
          {filterLabels.map((filter) => (
            <button
              aria-pressed={activeFilter === filter.key}
              className={activeFilter === filter.key ? 'is-active' : ''}
              key={filter.key}
              type="button"
              onClick={() => handleFilterSelect(filter.key)}
            >
              {filter.label}
            </button>
          ))}
        </div>

        <div className="mockup-section-list">
          {issueGroups.length > 0 ? issueGroups.map((group) => (
            <details className={`mockup-section-card ${group.isFooterDisclaimer ? 'is-footer' : ''}`} key={group.id} open={!group.isFooterDisclaimer}>
              <summary>
                <span>
                  <strong>{group.name}</strong>
                  <small>총 {group.issues.length} · High {group.high} · 텍스트 {group.text} · 스타일 {group.style} · 위치 {group.layout} · CTA {group.cta}</small>
                </span>
                <span className="section-priority-badge">P{group.priority}</span>
              </summary>
              <ul className="mockup-issue-list">
                {group.issues.map((issue) => (
                  <IssueCard
                    issue={issue}
                    isSelected={selectedIssue?.id === issue.id}
                    key={issue.id}
                    onSelect={handleIssueSelect}
                  />
                ))}
              </ul>
            </details>
          )) : <p className="empty-row">선택한 필터에 해당하는 비교 이슈가 없습니다.</p>}
        </div>

        {visibleLimit < filteredIssues.length ? (
          <button className="mockup-more-button" type="button" onClick={() => setVisibleLimit((limit) => limit + ISSUE_LIMIT_STEP)}>
            더 보기 ({filteredIssues.length - visibleLimit}개 남음)
          </button>
        ) : null}
      </article>

      <article className="detail-card">
        <div className="section-title-row">
          <h3>비교 기준</h3>
          <span>정확 매칭 후 0.8 이상 유사 문구만 확인 필요 처리</span>
        </div>
        <p className="panel-note relaxed-note">
          텍스트는 줄바꿈, 특수 공백, 반복 공백, zero-width 문자, 일부 문장부호 차이, 영문 대소문자를 정규화해 먼저 정확 매칭합니다. 정확 매칭되지 않은 6자 이상 문구만 0.8 이상 유사도에서 확인 필요로 표시하며, 픽셀 diff는 실행하지 않습니다.
        </p>
      </article>
    </section>
  )
}

function ComparisonPane({ anchorLabel, frameRef, highlightRatio, imageAlt, imageSrc, issue, label, note, onScroll, placeholder }) {
  return (
    <section className="comparison-pane" aria-label={label}>
      <div className="comparison-pane-head">
        <strong>{label}</strong>
        <span>{note}</span>
      </div>
      {issue ? (
        <p className="comparison-selected-context">
          선택 이슈: {issue.sectionName} · y {formatNumber(issue.anchor.y)} · {formatPercent(highlightRatio)} 지점
        </p>
      ) : null}
      <div
        className="comparison-image-frame"
        data-anchor-scope={anchorLabel}
        ref={frameRef}
        style={{ '--highlight-top': `${highlightRatio * 100}%` }}
        onScroll={onScroll}
      >
        {issue ? <span className="comparison-highlight-line" aria-hidden="true" /> : null}
        {imageSrc ? <img src={imageSrc} alt={imageAlt} /> : <div className="comparison-placeholder">{placeholder}</div>}
      </div>
    </section>
  )
}

function IssueCard({ issue, isSelected, onSelect }) {
  return (
    <li className={`mockup-issue-card ${issue.status} ${isSelected ? 'is-selected' : ''}`}>
      <button type="button" onClick={() => onSelect(issue)}>
        <span className="mockup-issue-meta">
          <span className={`status-chip status-${issue.status}`}>{statusLabels[issue.status]}</span>
          <span className="issue-priority-chip">P{issue.priority}</span>
          <span>{issue.matchType === 'fuzzy' ? '유사 매칭' : issue.matchType}</span>
          <span>x {formatNumber(issue.anchor.x)} · y {formatNumber(issue.anchor.y)}</span>
        </span>
        <strong>{issue.label}</strong>
        <IssueText text={issue.text} />
        {issue.layerPath ? <span className="mockup-layer-path">{issue.layerPath}</span> : null}
        <span className="mockup-issue-detail">{issue.detail}</span>
        {issue.differences.length > 0 ? (
          <span className="mockup-difference-list">
            {issue.differences.map((difference) => (
              <span key={`${issue.id}-${difference.type}-${difference.label}`}>
                {difference.label}: {difference.detail}
              </span>
            ))}
          </span>
        ) : null}
      </button>
    </li>
  )
}

function IssueText({ text }) {
  if (text.length <= 120) return <span className="mockup-issue-text">{text}</span>

  return (
    <details className="mockup-long-text">
      <summary>{text.slice(0, 120)}...</summary>
      <span>{text}</span>
    </details>
  )
}

function matchesFilter(issue, filter) {
  if (filter === 'all') return true
  if (filter === 'footer') return issue.isFooterDisclaimer
  return issue.categories.includes(filter)
}

function groupIssuesBySection(issues) {
  const groups = new Map()

  issues.forEach((issue) => {
    const key = issue.sectionId || issue.sectionName || '기타 섹션'
    const group = groups.get(key) || {
      id: key,
      name: issue.sectionName || key,
      priority: issue.priority,
      high: 0,
      text: 0,
      style: 0,
      layout: 0,
      cta: 0,
      isFooterDisclaimer: Boolean(issue.isFooterDisclaimer),
      issues: [],
    }

    group.priority = Math.min(group.priority, issue.priority)
    group.high += issue.severity === 'high' ? 1 : 0
    group.text += issue.categories.includes('text') ? 1 : 0
    group.style += issue.categories.includes('style') ? 1 : 0
    group.layout += issue.categories.includes('layout') ? 1 : 0
    group.cta += issue.categories.includes('cta') ? 1 : 0
    group.isFooterDisclaimer = group.isFooterDisclaimer || issue.isFooterDisclaimer
    group.issues.push(issue)
    groups.set(key, group)
  })

  return Array.from(groups.values()).sort((first, second) => {
    if (first.priority !== second.priority) return first.priority - second.priority
    return second.issues.length - first.issues.length
  })
}

function getPanePositionRatio(issue, pane) {
  if (!issue) return 0
  const paneRatio = pane === 'web' ? issue.web?.positionRatio : issue.figma?.positionRatio
  return clampRatio(paneRatio ?? issue.anchor.positionRatio)
}

function formatImageMeta(image) {
  if (!image) return ''
  if (!image.size) return 'metadata only'
  return `${Math.round(image.size / 1024)} KB`
}

function formatScreenshotMeta(webScreenshot) {
  if (!webScreenshot) return '캡처 대기'
  if (webScreenshot.error) return webScreenshot.error

  const width = Math.round(Number(webScreenshot.width) || 0)
  const height = Math.round(Number(webScreenshot.height) || 0)
  return `${width} × ${height}px · ${webScreenshot.fullPage ? 'full-page capture' : 'viewport capture'}`
}

function formatNumber(value) {
  return Math.round(Number(value) || 0)
}

function formatPercent(value) {
  return `${Math.round(clampRatio(value) * 100)}%`
}

function clampRatio(value) {
  return Math.max(0, Math.min(1, Number(value) || 0))
}

export default MockupQaPanel
