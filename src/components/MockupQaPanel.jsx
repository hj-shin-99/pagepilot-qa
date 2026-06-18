import { useMemo, useRef, useState } from 'react'

const summaryMetricLabels = [
  { key: 'textDifferences', label: '문구 차이' },
  { key: 'figmaOnly', label: '시안에만' },
  { key: 'webOnly', label: '웹에만' },
  { key: 'buttonIssues', label: '버튼/링크' },
]

function MockupQaPanel({ designImages, designQa, result }) {
  const [selectedIssueId, setSelectedIssueId] = useState('')
  const webFrameRef = useRef(null)
  const figmaFrameRef = useRef(null)
  const isSyncingScrollRef = useRef(false)

  const issueSections = useMemo(() => getIssueSections(designQa), [designQa])
  const selectableIssues = useMemo(() => issueSections.flatMap((section) => section.items), [issueSections])
  const waitingIssue = designQa?.waitingIssues?.[0] || null
  const selectedImage = designImages[0]
  const firstIssueId = selectableIssues[0]?.id || waitingIssue?.id || ''
  const activeIssueId = selectableIssues.some((issue) => issue.id === selectedIssueId) ? selectedIssueId : firstIssueId
  const selectedIssue = selectableIssues.find((issue) => issue.id === activeIssueId) || waitingIssue || null
  const markerMap = useMemo(() => createMarkerMap(selectableIssues), [selectableIssues])
  const selectedMarkerLabel = selectedIssue ? markerMap.get(selectedIssue.id) || '' : ''
  const paneMarkers = useMemo(() => createPaneMarkers(selectableIssues, markerMap, selectedIssue), [selectableIssues, markerMap, selectedIssue])
  const sectionCounts = useMemo(() => getSectionCounts(designQa), [designQa])
  const totalIssueCount = selectableIssues.length

  const handleIssueSelect = (issue) => {
    setSelectedIssueId(issue.id)
    document.getElementById('mockup-compare-viewer')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
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
              <span>문구 차이, 누락, 버튼/링크만 먼저 확인하세요.</span>
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
              <p className="panel-note relaxed-note">위치 영역, Figma 문구, Web 문구, 확인 유형만 간단히 표시합니다.</p>
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

      <details className="detail-card mockup-folded-card">
        <summary>
          <span>
            <strong>스타일 참고</strong>
            <small>기본 접힘 · 글씨 크기, 컬러, 위치 차이는 이번 결과 기본 목록에서 제외했습니다.</small>
          </span>
          <span className="section-priority-badge">참고</span>
        </summary>
        <p className="panel-note relaxed-note">필요하면 상단 비교 뷰어에서 직접 확인해 주세요. 이번 결과 생성은 문구와 버튼 비교를 우선합니다.</p>
      </details>

      <details className="detail-card mockup-folded-card">
        <summary>
          <span>
            <strong>이미지 참고</strong>
            <small>기본 접힘 · 시안 이미지와 웹 이미지는 비교 뷰어에서 위치 참고용으로만 유지합니다.</small>
          </span>
          <span className="section-priority-badge">참고</span>
        </summary>
        <p className="panel-note relaxed-note">위치 정보가 없는 경우 마커를 억지로 만들지 않습니다.</p>
      </details>
    </section>
  )
}

function ComparisonPane({ anchorLabel, frameRef, highlightRatio, imageAlt, imageSrc, issue, label, markerLabel, markers, note, onScroll, placeholder }) {
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
            {markers.filter((marker) => marker.ratio !== null).map((marker) => (
              <span
                className={`comparison-highlight-line ${marker.issueId === issue?.id ? 'is-active' : ''}`}
                aria-hidden="true"
                key={`${anchorLabel}-${marker.issueId}`}
                style={{ '--highlight-top': `${marker.ratio * 100}%` }}
              >
                <span className="comparison-marker-badge">{marker.label}</span>
              </span>
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
    <li className={`mockup-issue-card ${issue.status} ${isSelected ? 'is-selected' : ''}`}>
      <button type="button" onClick={() => onSelect(issue)}>
        <span className="mockup-issue-meta">
          <span className="issue-marker-chip">{markerLabel || '[선택]'}</span>
          <span>{issue.label}</span>
        </span>
        <strong>{getSafeSectionName(issue)}</strong>
        <dl className="mockup-card-fields">
          <div>
            <dt>위치 영역</dt>
            <dd>{getSafeSectionName(issue)}</dd>
          </div>
          <div>
            <dt>Figma</dt>
            <dd><IssueText text={issue.figma?.text || (issue.matchType === 'waiting' ? '피그마 기준 없음' : '없음')} /></dd>
          </div>
          <div>
            <dt>Web</dt>
            <dd><IssueText text={issue.web?.text || (issue.matchType === 'waiting' ? '웹 기준 대기' : '없음')} /></dd>
          </div>
          <div>
            <dt>확인 유형</dt>
            <dd>{issue.label}</dd>
          </div>
        </dl>
        <span className="mockup-location-action">{hasReliableLocation(issue) ? '위치 보기' : '위치 정보 없음'}</span>
      </button>
      <IssueRawDetails issue={issue} />
    </li>
  )
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
  return [
    {
      id: 'text-differences',
      title: '문구 차이',
      items: Array.isArray(designQa.textDifferences) ? designQa.textDifferences : [],
      emptyMessage: '큰 문구 차이를 찾지 못했습니다.',
    },
    {
      id: 'figma-only',
      title: '시안에만 있음',
      items: Array.isArray(designQa.figmaOnly) ? designQa.figmaOnly : [],
      emptyMessage: '시안에만 남은 문구를 찾지 못했습니다.',
    },
    {
      id: 'web-only',
      title: '웹에만 있음',
      items: Array.isArray(designQa.webOnly) ? designQa.webOnly : [],
      emptyMessage: '웹에만 남은 문구를 찾지 못했습니다.',
    },
    {
      id: 'buttons',
      title: '버튼/링크 확인',
      items: Array.isArray(designQa.buttonIssues) ? designQa.buttonIssues : [],
      emptyMessage: '버튼/링크 확인 항목이 없습니다.',
    },
  ]
}

function getSectionCounts(designQa = {}) {
  return {
    textDifferences: Array.isArray(designQa.textDifferences) ? designQa.textDifferences.length : 0,
    figmaOnly: Array.isArray(designQa.figmaOnly) ? designQa.figmaOnly.length : 0,
    webOnly: Array.isArray(designQa.webOnly) ? designQa.webOnly.length : 0,
    buttonIssues: Array.isArray(designQa.buttonIssues) ? designQa.buttonIssues.length : 0,
  }
}

function createPaneMarkers(issues, markerMap, selectedIssue) {
  const markerIssues = selectedIssue && !issues.some((issue) => issue.id === selectedIssue.id)
    ? [...issues, selectedIssue]
    : issues

  return markerIssues.reduce((markers, issue) => ({
    web: [...markers.web, { issueId: issue.id, label: markerMap.get(issue.id) || '[선택]', ratio: getPanePositionRatio(issue, 'web') }],
    figma: [...markers.figma, { issueId: issue.id, label: markerMap.get(issue.id) || '[선택]', ratio: getPanePositionRatio(issue, 'figma') }],
  }), { web: [], figma: [] })
}

function createMarkerMap(issues) {
  const markerMap = new Map()
  issues.forEach((issue, index) => markerMap.set(issue.id, `[${String(index + 1).padStart(2, '0')}]`))
  return markerMap
}

function getIssueRawRows(issue) {
  return [
    ['확인 유형', issue.label],
    ['상세', formatPlannerCopy(issue.detail || '-')],
    ['위치 영역', getSafeSectionName(issue)],
    ['similarityScore', issue.similarityScore ?? '-'],
    ['matchedBy', issue.matchedBy || '-'],
  ]
}

function getRawEvidenceRows(evidence) {
  if (!evidence) return [['상태', '-']]
  return [
    ['텍스트', evidence.text || '-'],
    ['href', evidence.href || '-'],
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
