import { useMemo, useRef, useState } from 'react'

const summaryMetricLabels = [
  { key: 'textDifferences', label: '문구 차이' },
  { key: 'figmaOnly', label: '시안에만 있음' },
  { key: 'webOnly', label: '웹에만 있음' },
  { key: 'buttonIssues', label: '버튼/링크 확인' },
  { key: 'styleIssues', label: '스타일 참고' },
  { key: 'imageIssues', label: '이미지 참고' },
]

function MockupQaPanel({ designImages, designQa, result }) {
  const [selectedIssueId, setSelectedIssueId] = useState('')
  const webFrameRef = useRef(null)
  const figmaFrameRef = useRef(null)
  const isSyncingScrollRef = useRef(false)

  const issueSections = useMemo(() => getIssueSections(designQa), [designQa])
  const primaryDisplayIssues = useMemo(() => uniqueIssuesById(issueSections.flatMap((section) => section.items)), [issueSections])
  const referenceIssues = useMemo(() => Array.isArray(designQa?.referenceIssues) ? designQa.referenceIssues : [], [designQa])
  const selectableIssues = useMemo(() => [...primaryDisplayIssues, ...referenceIssues], [primaryDisplayIssues, referenceIssues])
  const waitingIssue = designQa?.waitingIssues?.[0] || null
  const selectedImage = designImages[0]
  const firstIssueId = [...selectableIssues].sort(compareDisplayOrder)[0]?.id || waitingIssue?.id || ''
  const activeIssueId = selectableIssues.some((issue) => issue.id === selectedIssueId) ? selectedIssueId : firstIssueId
  const selectedIssue = selectableIssues.find((issue) => issue.id === activeIssueId) || waitingIssue || null
  const markerMap = useMemo(() => createMarkerMap(primaryDisplayIssues), [primaryDisplayIssues])
  const selectedMarkerLabel = selectedIssue ? markerMap.get(selectedIssue.id) || (selectedIssue.isReference ? '참고' : '') : ''
  const paneMarkers = useMemo(() => createPaneMarkers(primaryDisplayIssues, markerMap), [primaryDisplayIssues, markerMap])
  const sectionCounts = useMemo(() => getSectionCounts(designQa), [designQa])
  const totalIssueCount = primaryDisplayIssues.length

  const handleIssueSelect = (issue) => {
    setSelectedIssueId(issue.id)
    document.getElementById('mockup-compare-viewer')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    scrollPaneToIssue(webFrameRef, issue, 'web')
    scrollPaneToIssue(figmaFrameRef, issue, 'figma')
  }

  const handleMarkerSelect = (issueId) => {
    const issue = selectableIssues.find((item) => item.id === issueId)
    if (!issue) return
    setSelectedIssueId(issue.id)
    document.getElementById(getIssueDomId(issue.id))?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    scrollPaneToIssue(webFrameRef, issue, 'web')
    scrollPaneToIssue(figmaFrameRef, issue, 'figma')
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
      <article className="detail-card mockup-planner-card mockup-hero-card">
        <div className="section-title-row">
          <div>
            <p className="eyebrow">웹·시안 비교</p>
            <h3>시안 비교 QA</h3>
          </div>
          <span>텍스트 중심 비교</span>
        </div>
        <div className="mockup-simple-summary">
          {waitingIssue ? (
            <>
              <strong>Figma JSON을 입력하면 문구 비교를 시작합니다.</strong>
              <span>{waitingIssue.detail}</span>
            </>
          ) : totalIssueCount > 0 ? (
            <>
              <strong>문구와 버튼 확인 {totalIssueCount}건을 찾았습니다.</strong>
              <span>시안 위에서부터 대표 이슈 순서대로 확인하세요.</span>
            </>
          ) : (
            <>
              <strong>{designQa?.emptyMessage || '큰 문구 차이를 찾지 못했습니다.'}</strong>
              <span>줄바꿈, 공백, 마침표 차이만 있는 경우 기본 결과에 올리지 않습니다.</span>
            </>
          )}
        </div>
        {!waitingIssue ? (
          <div className="mockup-summary-pills" aria-label="문구 비교 결과 요약">
            {summaryMetricLabels.map((metric) => (
              <span key={metric.key}>{metric.label} {sectionCounts[metric.key]}건</span>
            ))}
          </div>
        ) : null}
      </article>

      <article className="detail-card mockup-viewer-card" id="mockup-compare-viewer">
        <div className="section-title-row">
          <div>
            <h3>웹 화면과 피그마 시안</h3>
            <p className="panel-note relaxed-note">두 화면은 스크롤 비율로 함께 이동하며, 위치 정보가 있을 때만 마커를 표시합니다.</p>
          </div>
          <span>좌우 비교 뷰 유지</span>
        </div>

        <div className="mockup-comparison-grid">
          <ComparisonPane
            anchorLabel="web"
            frameRef={webFrameRef}
            highlightRatio={getPanePositionRatio(selectedIssue, 'web')}
            imageAlt="웹 화면 캡처 이미지"
            imageSrc={result.webScreenshot?.dataUrl}
            issue={selectedIssue}
            label="Web 1920 캡처"
            markerLabel={selectedMarkerLabel}
            markers={paneMarkers.web}
            note={formatScreenshotMeta(result.webScreenshot)}
            onMarkerSelect={handleMarkerSelect}
            placeholder={result.webScreenshot ? '저장된 기록에는 웹 화면 원본이 없어 화면 정보만 표시됩니다.' : 'URL 검사를 실행하면 웹 화면 캡처가 표시됩니다.'}
            onScroll={() => handleSyncedScroll(webFrameRef, figmaFrameRef)}
          />
          <ComparisonPane
            anchorLabel="figma"
            frameRef={figmaFrameRef}
            highlightRatio={getPanePositionRatio(selectedIssue, 'figma')}
            imageAlt={selectedImage ? `${selectedImage.name} 피그마 시안 미리보기` : '피그마 시안 이미지'}
            imageSrc={selectedImage?.previewUrl}
            issue={selectedIssue}
            label="Figma 시안 이미지"
            markerLabel={selectedMarkerLabel}
            markers={paneMarkers.figma}
            note={selectedImage ? `${formatImageMeta(selectedImage)} · 1920 기준 표시` : '업로드 대기'}
            onMarkerSelect={handleMarkerSelect}
            placeholder={selectedImage ? '저장된 기록에는 원본 이미지가 없어 이미지 정보만 표시됩니다.' : '좌측 패널에서 피그마 시안 이미지를 업로드해 주세요.'}
            onScroll={() => handleSyncedScroll(figmaFrameRef, webFrameRef)}
          />
        </div>
      </article>

      {!waitingIssue ? issueSections.map((section) => (
        <article className="detail-card mockup-report-card" key={section.id}>
          <div className="section-title-row">
            <div>
              <h3>{section.title}</h3>
              <p className="panel-note relaxed-note">대표 이슈는 시안 위치 기준으로 정렬하고, 마커는 최대 10개만 표시합니다.</p>
            </div>
            <span>{section.items.length}건</span>
          </div>
          <ul className="mockup-issue-list">
            {section.items.length > 0 ? section.items.map((issue) => (
              <IssueRow
                issue={issue}
                isSelected={selectedIssue?.id === issue.id}
                key={issue.id}
                markerLabel={markerMap.get(issue.id) || ''}
                onSelect={handleIssueSelect}
              />
            )) : <li className="empty-row">{section.emptyMessage}</li>}
          </ul>
        </article>
      )) : (
        <article className="detail-card mockup-report-card">
          <div className="section-title-row">
            <div>
              <h3>비교 대기</h3>
              <p className="panel-note relaxed-note">Figma JSON과 웹 캡처가 함께 있어야 문구 비교가 생성됩니다.</p>
            </div>
          </div>
          <ul className="mockup-issue-list">
            <IssueRow issue={waitingIssue} isSelected markerLabel="[대기]" onSelect={handleIssueSelect} />
          </ul>
        </article>
      )}

      {!waitingIssue && referenceIssues.length > 0 ? (
        <details className="detail-card mockup-folded-card">
          <summary>
            <span>
              <strong>전체 참고 이슈</strong>
              <small>대표 10개 이후 항목과 참고성 이슈를 접어서 보관합니다.</small>
            </span>
            <span className="section-priority-badge">{referenceIssues.length}건</span>
          </summary>
          <ul className="mockup-issue-list mockup-reference-list">
            {referenceIssues.map((issue) => (
              <IssueRow
                issue={issue}
                isSelected={selectedIssue?.id === issue.id}
                key={issue.id}
                markerLabel="참고"
                onSelect={handleIssueSelect}
              />
            ))}
          </ul>
        </details>
      ) : null}

    </section>
  )
}

function ComparisonPane({ anchorLabel, frameRef, highlightRatio, imageAlt, imageSrc, issue, label, markerLabel, markers, note, onMarkerSelect, onScroll, placeholder }) {
  return (
    <section className="comparison-pane" aria-label={label}>
      <div className="comparison-pane-head">
        <strong>{label}</strong>
        <span>{note}</span>
      </div>
      {issue ? (
        <p className="comparison-selected-context">
          선택 항목 {markerLabel || '[선택]'} · {getSafeSectionName(issue)} · {highlightRatio === null ? '위치 정보 없음' : `${formatPercent(highlightRatio)} 지점`}
        </p>
      ) : null}
      <div
        className="comparison-image-frame"
        data-anchor-scope={anchorLabel}
        ref={frameRef}
        style={{ '--highlight-top': highlightRatio === null ? undefined : `${highlightRatio * 100}%` }}
        tabIndex="-1"
        onScroll={onScroll}
      >
        {imageSrc ? (
          <div className="comparison-image-stage">
            {highlightRatio !== null ? (
              <span
                className="comparison-selected-line"
                aria-hidden="true"
                style={{ '--highlight-top': `${highlightRatio * 100}%` }}
              />
            ) : null}
            {markers.filter((marker) => marker.ratio !== null).map((marker) => (
              <button
                type="button"
                className={`comparison-highlight-line ${marker.issueId === issue?.id ? 'is-active' : ''}`}
                aria-label={`${marker.label} 이슈로 이동`}
                key={`${anchorLabel}-${marker.issueId}`}
                style={{ '--highlight-top': `${marker.ratio * 100}%` }}
                onClick={() => onMarkerSelect(marker.issueId)}
              >
                <span className="comparison-marker-badge">{marker.label}</span>
              </button>
            ))}
            <img src={imageSrc} alt={imageAlt} />
          </div>
        ) : <div className="comparison-placeholder">{placeholder}</div>}
      </div>
    </section>
  )
}

function IssueRow({ issue, isSelected, markerLabel, onSelect }) {
  return (
    <li className={`mockup-issue-card ${issue.status} ${isSelected ? 'is-selected' : ''}`} id={getIssueDomId(issue.id)}>
      <button type="button" onClick={() => onSelect(issue)}>
        <span className="mockup-issue-meta">
          <span className="issue-marker-chip">{markerLabel || '[선택]'}</span>
          {issue.mergedIssueCount > 1 ? <span>{issue.mergedIssueCount}개 이슈 병합</span> : null}
        </span>
        <dl className="mockup-card-fields">
          <div>
            <dt>위치</dt>
            <dd>{getSafeSectionName(issue)}</dd>
          </div>
          <div>
            <dt>항목</dt>
            <dd><IssueText text={issue.itemTitle || issue.text} /></dd>
          </div>
          <div>
            <dt>확인 내용</dt>
            <dd><IssueChecks issue={issue} /></dd>
          </div>
          <div>
            <dt>Figma 문구</dt>
            <dd><IssueText text={issue.figma?.text || (issue.matchType === 'waiting' ? '피그마 기준 없음' : '없음')} /></dd>
          </div>
          <div>
            <dt>Web 문구</dt>
            <dd><IssueText text={issue.web?.text || (issue.matchType === 'waiting' ? '웹 기준 대기' : '없음')} /></dd>
          </div>
          <div>
            <dt>위치 보기</dt>
            <dd>{hasReliableLocation(issue) ? '가능' : '위치 정보 없음'}</dd>
          </div>
        </dl>
      </button>
      <IssueRawDetails issue={issue} />
    </li>
  )
}

function IssueChecks({ issue }) {
  const checks = Array.isArray(issue.checkSummary) && issue.checkSummary.length > 0
    ? issue.checkSummary
    : [issue.label]

  return <span className="mockup-check-list">{checks.join(' · ')}</span>
}

function IssueText({ text }) {
  if (!text) return <span className="mockup-issue-text">없음</span>
  if (text.length <= 140) return <span className="mockup-issue-text">{text}</span>

  return <span className="mockup-issue-text">{text.slice(0, 140)}...</span>
}

function IssueRawDetails({ issue }) {
  return (
    <details className="mockup-raw-details">
      <summary>상세 보기</summary>
      <div className="mockup-raw-grid">
        <RawEvidence title="이슈 정보" rows={getIssueRawRows(issue)} />
        <RawEvidence title="Figma 값" rows={getRawEvidenceRows(issue.figma)} />
        <RawEvidence title="Web 값" rows={getRawEvidenceRows(issue.web)} />
      </div>
      {(issue.differences || []).length > 0 ? (
        <ul className="mockup-difference-list">
          {issue.differences.map((difference) => (
            <li key={`${issue.id}-${difference.type}-${difference.label}`}>
              <strong>{difference.label}</strong>
              <span>{formatPlannerCopy(difference.detail)}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </details>
  )
}

function RawEvidence({ title, rows }) {
  return (
    <dl className="mockup-raw-evidence">
      <dt>{title}</dt>
      {rows.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{formatRawValue(value)}</dd>
        </div>
      ))}
    </dl>
  )
}

function getIssueSections(designQa = {}) {
  const primaryIssues = Array.isArray(designQa.primaryIssues) ? designQa.primaryIssues : []
  const sections = [
    { id: 'text-differences', title: '문구 차이', items: primaryIssues.filter((issue) => issue.issueType === 'text-difference'), emptyMessage: '문구 차이 없음' },
    { id: 'figma-only', title: '시안에만 있음', items: primaryIssues.filter((issue) => issue.issueType === 'figma-only'), emptyMessage: '시안 전용 문구 없음' },
    { id: 'web-only', title: '웹에만 있음', items: primaryIssues.filter((issue) => issue.issueType === 'web-only'), emptyMessage: '웹 전용 문구 없음' },
    { id: 'button-issues', title: '버튼/링크 확인', items: primaryIssues.filter((issue) => issue.issueType === 'button'), emptyMessage: '버튼/링크 확인 없음' },
    { id: 'style-issues', title: '스타일 참고', items: primaryIssues.filter((issue) => issue.categories?.includes('style') || issue.categories?.includes('layout')), emptyMessage: '스타일 참고 없음' },
    { id: 'image-issues', title: '이미지 참고', items: primaryIssues.filter((issue) => issue.categories?.includes('image')), emptyMessage: '이미지 참고 없음' },
  ]

  const nonEmptySections = sections.filter((section) => section.items.length > 0)
  return nonEmptySections.length > 0 ? nonEmptySections : [sections[0]]
}

function uniqueIssuesById(issues) {
  const seen = new Set()
  return issues.filter((issue) => {
    if (seen.has(issue.id)) return false
    seen.add(issue.id)
    return true
  })
}

function getSectionCounts(designQa = {}) {
  return {
    textDifferences: Array.isArray(designQa.textDifferences) ? designQa.textDifferences.length : 0,
    figmaOnly: Array.isArray(designQa.figmaOnly) ? designQa.figmaOnly.length : 0,
    webOnly: Array.isArray(designQa.webOnly) ? designQa.webOnly.length : 0,
    buttonIssues: Array.isArray(designQa.buttonIssues) ? designQa.buttonIssues.length : 0,
    styleIssues: Array.isArray(designQa.primaryIssues) ? designQa.primaryIssues.filter((issue) => issue.categories?.includes('style') || issue.categories?.includes('layout')).length : 0,
    imageIssues: Array.isArray(designQa.primaryIssues) ? designQa.primaryIssues.filter((issue) => issue.categories?.includes('image')).length : 0,
  }
}

function createPaneMarkers(issues, markerMap) {
  const markerIssues = getVisibleMarkerIssues(issues)

  return markerIssues.reduce((markers, issue) => ({
    web: [...markers.web, { issueId: issue.id, label: markerMap.get(issue.id) || '[선택]', ratio: getPanePositionRatio(issue, 'web') }],
    figma: [...markers.figma, { issueId: issue.id, label: markerMap.get(issue.id) || '[선택]', ratio: getPanePositionRatio(issue, 'figma') }],
  }), { web: [], figma: [] })
}

function getVisibleMarkerIssues(issues) {
  const seen = new Set()
  const markerIssues = []
  const sortedIssues = [...issues].sort(compareDisplayOrder)

  sortedIssues.forEach((issue) => {
    if (markerIssues.length >= 10 || !hasReliableLocation(issue)) return
    const key = getMarkerAreaKey(issue)
    if (seen.has(key)) return
    seen.add(key)
    markerIssues.push(issue)
  })

  return markerIssues
}

function compareDisplayOrder(first, second) {
  return (first.displayIndex || 9999) - (second.displayIndex || 9999)
}

function getMarkerAreaKey(issue) {
  const ratio = issue.figma?.positionRatio ?? issue.web?.positionRatio ?? issue.anchor?.positionRatio ?? 1
  const section = issue.qaGroupId || issue.sectionId || getSafeSectionName(issue)
  return `${section}:${Math.round(clampRatio(ratio) * 30)}`
}

function createMarkerMap(issues) {
  const markerMap = new Map()
  issues.forEach((issue, index) => markerMap.set(issue.id, issue.displayLabel || `[${String(index + 1).padStart(2, '0')}]`))
  return markerMap
}

function getIssueDomId(issueId) {
  return `mockup-issue-${String(issueId || '').replace(/[^A-Za-z0-9_-]/g, '-')}`
}

function getIssueRawRows(issue) {
  return [
    ['확인 유형', issue.label],
    ['상세', formatPlannerCopy(issue.detail || '-')],
    ['위치 영역', getSafeSectionName(issue)],
    ['qaGroupId', issue.qaGroupId || '-'],
    ['병합 이슈 수', issue.mergedIssueCount || 1],
    ['similarityScore', issue.similarityScore ?? '-'],
    ['matchedBy', issue.matchedBy || '-'],
  ]
}

function getRawEvidenceRows(evidence) {
  if (!evidence) return [['상태', '-']]
  return [
    ['텍스트', evidence.text || '-'],
    ['compareText', evidence.compareText || '-'],
    ['qaGroupId', evidence.qaGroupId || '-'],
    ['href', evidence.href || '-'],
    ['fontSize', evidence.fontSize || '-'],
    ['color', evidence.color || '-'],
    ['위치', `${formatRawNumber(evidence.x)} / ${formatRawNumber(evidence.y)}`],
    ['영역 크기', `${formatRawNumber(evidence.width)} / ${formatRawNumber(evidence.height)}`],
    ['레이어 경로', evidence.layerPath || '-'],
  ]
}

function scrollPaneToIssue(frameRef, issue, pane) {
  window.requestAnimationFrame(() => {
    const frame = frameRef.current
    if (!frame) return

    const ratio = getPanePositionRatio(issue, pane)
    if (ratio === null) return

    const maxScroll = frame.scrollHeight - frame.clientHeight
    frame.scrollTop = Math.max(0, maxScroll * ratio)
    frame.focus({ preventScroll: true })
  })
}

function getPanePositionRatio(issue, pane) {
  if (!issue) return null

  const paneRatio = pane === 'web' ? issue.web?.positionRatio : issue.figma?.positionRatio
  if (isFiniteRatio(paneRatio)) return clampRatio(paneRatio)
  return null
}

function hasReliableLocation(issue) {
  return getPanePositionRatio(issue, 'figma') !== null || getPanePositionRatio(issue, 'web') !== null
}

function getSafeSectionName(issue) {
  if (!issue) return '위치 정보 없음'
  if (issue.isFooterDisclaimer) return '푸터/디스클레이머'

  const sectionName = issue.sectionName || issue.region || issue.figma?.sectionName || issue.web?.sectionName
  if (sectionName && !isRawSectionName(sectionName)) return sectionName

  const ratio = issue.figma?.positionRatio ?? issue.web?.positionRatio ?? issue.anchor?.positionRatio
  return getPlannerSectionNameByRatio(ratio)
}

function isRawSectionName(sectionName) {
  const normalizedName = String(sectionName).trim().toLowerCase()
  return normalizedName === 'con'
    || normalizedName.includes('hero')
    || normalizedName.includes('kv')
    || normalizedName.includes('main_visual')
    || normalizedName.includes('main visual')
    || normalizedName.includes('/')
}

function getPlannerSectionNameByRatio(positionRatio) {
  if (!isFiniteRatio(positionRatio)) return '위치 정보 없음'

  const ratio = clampRatio(positionRatio)
  if (ratio < 0.22) return '상단 영역'
  if (ratio < 0.74) return '주요 콘텐츠 영역'
  if (ratio < 0.9) return '하단 안내 영역'
  return '푸터/디스클레이머'
}

function formatPlannerCopy(value) {
  return String(value)
    .replace(/\bFigma\b/g, '피그마')
    .replace(/\bWeb\b/g, '웹')
    .replace(/\bCTA\b/g, '버튼')
}

function formatImageMeta(image) {
  if (!image) return ''
  if (!image.size) return '이미지 정보만 있음'
  return `${Math.round(image.size / 1024)} KB`
}

function formatScreenshotMeta(webScreenshot) {
  if (!webScreenshot) return '캡처 대기'
  if (webScreenshot.error) return webScreenshot.error

  const width = Math.round(Number(webScreenshot.width) || 0)
  const height = Math.round(Number(webScreenshot.height) || 0)
  return `${width} × ${height}px · ${webScreenshot.fullPage ? '전체 화면 캡처' : '현재 화면 캡처'}`
}

function formatPercent(value) {
  return `${Math.round(clampRatio(value) * 100)}%`
}

function formatRawNumber(value) {
  return Number.isFinite(Number(value)) ? Math.round(Number(value)) : '-'
}

function formatRawValue(value) {
  if (value === undefined || value === null || value === '') return '-'
  return formatPlannerCopy(String(value))
}

function isFiniteRatio(value) {
  return Number.isFinite(Number(value))
}

function clampRatio(value) {
  return Math.max(0, Math.min(1, Number(value) || 0))
}

export default MockupQaPanel
