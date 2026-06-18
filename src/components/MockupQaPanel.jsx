import { useMemo, useRef, useState } from 'react'

const TOP_ISSUE_LIMIT = 5

const topMetricLabels = [
  { key: 'text', label: '문구' },
  { key: 'cta', label: '버튼' },
  { key: 'design', label: '디자인' },
]

const statusLabels = {
  ok: '정상',
  error: '확인 필요',
  warn: '확인 필요',
}

function MockupQaPanel({ designImages, designQa, result }) {
  const [selectedIssueId, setSelectedIssueId] = useState('')
  const webFrameRef = useRef(null)
  const figmaFrameRef = useRef(null)
  const isSyncingScrollRef = useRef(false)

  const primaryIssues = useMemo(() => getPrimaryIssues(designQa), [designQa])
  const referenceIssues = useMemo(() => getReferenceIssues(designQa, primaryIssues), [designQa, primaryIssues])
  const visiblePrimaryIssues = useMemo(() => primaryIssues.slice(0, TOP_ISSUE_LIMIT), [primaryIssues])
  const foldedIssues = useMemo(() => [...primaryIssues.slice(TOP_ISSUE_LIMIT), ...referenceIssues], [primaryIssues, referenceIssues])
  const foldedIssueGroups = useMemo(() => groupIssuesBySection(foldedIssues), [foldedIssues])
  const markerMap = useMemo(() => createMarkerMap(visiblePrimaryIssues, foldedIssues), [visiblePrimaryIssues, foldedIssues])
  const topCounts = useMemo(() => getTopCounts(visiblePrimaryIssues), [visiblePrimaryIssues])
  const selectableIssues = [...primaryIssues, ...referenceIssues]
  const firstIssueId = visiblePrimaryIssues[0]?.id || referenceIssues[0]?.id || ''
  const activeIssueId = selectableIssues.some((issue) => issue.id === selectedIssueId) ? selectedIssueId : firstIssueId
  const selectedImage = designImages[0]
  const selectedIssue = selectableIssues.find((issue) => issue.id === activeIssueId) || primaryIssues[0] || referenceIssues[0]
  const selectedMarkerLabel = selectedIssue ? markerMap.get(selectedIssue.id) : ''
  const paneMarkers = useMemo(() => createPaneMarkers(visiblePrimaryIssues, markerMap, selectedIssue), [visiblePrimaryIssues, markerMap, selectedIssue])

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
          <span>1920 기준 대조</span>
        </div>
        <div className="mockup-simple-summary">
          <strong>우선 확인할 항목 {visiblePrimaryIssues.length}개를 찾았습니다.</strong>
          <span>1번부터 {visiblePrimaryIssues.length}번 표시된 위치만 먼저 확인하세요.</span>
        </div>
        <div className="mockup-summary-pills" aria-label="우선 확인 항목 유형">
          {topMetricLabels.map((metric) => (
            <span key={metric.key}>{metric.label} {topCounts[metric.key]}건</span>
          ))}
        </div>
      </article>

      <article className="detail-card mockup-viewer-card" id="mockup-compare-viewer">
        <div className="section-title-row">
          <div>
            <h3>웹 화면과 피그마 시안</h3>
            <p className="panel-note relaxed-note">두 화면은 현재 위치 비율로 함께 스크롤되며, 위치 보기를 누르면 해당 영역으로 이동합니다.</p>
          </div>
          <span>같은 표시 폭으로 축소 표시</span>
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

      <article className="detail-card mockup-report-card">
        <div className="section-title-row">
          <div>
            <h3>확인 필요 TOP 5</h3>
            <p className="panel-note relaxed-note">번호, 영역, 확인할 부분과 이유만 먼저 확인하세요.</p>
          </div>
          <span>현재 {visiblePrimaryIssues.length}개 표시</span>
        </div>

        <ul className="mockup-issue-list mockup-top-list">
          {visiblePrimaryIssues.length > 0 ? visiblePrimaryIssues.map((issue) => (
            <IssueCard
              issue={issue}
              isReference={false}
              isSelected={selectedIssue?.id === issue.id}
              key={issue.id}
              markerLabel={markerMap.get(issue.id)}
              onSelect={handleIssueSelect}
            />
          )) : <li className="empty-row">먼저 확인할 주요 비교 이슈가 없습니다.</li>}
        </ul>
      </article>

      <details className="detail-card mockup-folded-card">
        <summary>
          <span>
            <strong>전체 참고 이슈 보기</strong>
            <small>기본 접힘 · 나머지 주요 후보와 푸터/디스클레이머 포함 {foldedIssues.length}건</small>
          </span>
          <span className="section-priority-badge">참고</span>
        </summary>
        <div className="mockup-section-list mockup-reference-list">
          {foldedIssueGroups.length > 0 ? foldedIssueGroups.map((group) => (
            <details className={`mockup-section-card ${group.isFooterDisclaimer ? 'is-footer' : ''}`} key={group.id}>
              <summary>
                <span>
                  <strong>{group.isFooterDisclaimer ? '푸터/디스클레이머' : group.name}</strong>
                  <small>{group.issues.length}건 · 참고 확인</small>
                </span>
                <span className="section-priority-badge">접힘</span>
              </summary>
              <ul className="mockup-issue-list">
                {group.isFooterDisclaimer ? (
                  <FooterReferenceCard
                    count={group.issues.length}
                    issue={group.issues[0]}
                    isSelected={selectedIssue?.id === group.issues[0]?.id}
                    markerLabel={group.issues[0] ? markerMap.get(group.issues[0].id) : '참고'}
                    onSelect={handleIssueSelect}
                  />
                ) : group.issues.map((issue) => (
                  <IssueCard
                    issue={issue}
                    isReference
                    isSelected={selectedIssue?.id === issue.id}
                    key={issue.id}
                    markerLabel={markerMap.get(issue.id)}
                    onSelect={handleIssueSelect}
                  />
                ))}
              </ul>
            </details>
          )) : <p className="empty-row">접힌 참고 이슈가 없습니다.</p>}
        </div>
      </details>

      <details className="detail-card mockup-folded-card">
        <summary>
          <span>
            <strong>상세 데이터</strong>
            <small>기본 접힘 · 원문과 위치 데이터는 내부 비교용으로만 사용</small>
          </span>
          <span className="section-priority-badge">상세</span>
        </summary>
        <p className="panel-note relaxed-note">
          줄바꿈, 공백, 마침표, 글꼴 이름 차이는 기본 확인 항목으로 보지 않습니다. 상세 좌표와 원문 데이터는 각 카드의 상세 보기에서만 확인할 수 있습니다.
        </p>
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
          선택 이슈 {markerLabel} · {getSafeSectionName(issue)} · {highlightRatio === null ? '위치 정보 없음' : `${formatPercent(highlightRatio)} 지점`}
        </p>
      ) : null}
      <div
        className="comparison-image-frame"
        data-anchor-scope={anchorLabel}
        ref={frameRef}
        style={{ '--highlight-top': `${(highlightRatio || 0) * 100}%` }}
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

function IssueCard({ issue, isReference, isSelected, markerLabel, onSelect }) {
  return (
    <li className={`mockup-issue-card ${issue.status} ${isSelected ? 'is-selected' : ''}`}>
      <button type="button" onClick={() => onSelect(issue)}>
        <span className="mockup-issue-meta">
          <span className="issue-marker-chip">{markerLabel}</span>
          <span>{isReference ? '참고' : statusLabels[issue.status]}</span>
        </span>
        <strong>{markerLabel} {getSafeSectionName(issue)} - {getIssueTypeLabel(issue)}</strong>
        <dl className="mockup-card-fields">
          <div>
            <dt>확인할 부분</dt>
            <dd><IssueText text={getIssueItemText(issue)} /></dd>
          </div>
          {hasTextDifference(issue) ? (
            <>
              <div>
                <dt>Figma</dt>
                <dd><IssueText text={issue.figma?.text || '피그마 문구 없음'} /></dd>
              </div>
              <div>
                <dt>Web</dt>
                <dd><IssueText text={issue.web?.text || '웹 문구 없음'} /></dd>
              </div>
            </>
          ) : null}
          <div>
            <dt>왜 확인해야 하나요?</dt>
            <dd>{getConfirmText(issue)}</dd>
          </div>
        </dl>
        <span className="mockup-location-action">위치 보기</span>
      </button>
      <IssueRawDetails issue={issue} />
    </li>
  )
}

function FooterReferenceCard({ count, issue, isSelected, markerLabel, onSelect }) {
  if (!issue) return null

  return (
    <li className={`mockup-issue-card warn ${isSelected ? 'is-selected' : ''}`}>
      <button type="button" onClick={() => onSelect(issue)}>
        <span className="mockup-issue-meta">
          <span className="issue-marker-chip">참고</span>
          <span>참고</span>
        </span>
        <strong>[참고] 푸터/디스클레이머 영역</strong>
        <p className="mockup-footer-note">긴 문구 영역입니다. 필요 시 별도로 확인해 주세요. 관련 참고 항목 {count}건은 한 카드로 묶었습니다.</p>
        <span className="mockup-location-action">위치 보기</span>
      </button>
      <IssueRawDetails issue={issue} markerLabel={markerLabel} />
    </li>
  )
}

function IssueText({ text }) {
  if (!text) return <span className="mockup-issue-text">문구 없음</span>
  if (text.length <= 120) return <span className="mockup-issue-text">{text}</span>

  return <span className="mockup-issue-text">{text.slice(0, 120)}...</span>
}

function IssueRawDetails({ issue }) {
  return (
    <details className="mockup-raw-details">
      <summary>상세 보기</summary>
      <div className="mockup-raw-grid">
        <RawEvidence title="이슈 원문" rows={getIssueRawRows(issue)} />
        <RawEvidence title="피그마 값" rows={getRawEvidenceRows(issue.figma)} />
        <RawEvidence title="웹 값" rows={getRawEvidenceRows(issue.web)} />
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

function getIssueRawRows(issue) {
  return [
    ['상세', formatPlannerCopy(issue.detail)],
    ['피그마 문구', issue.figma?.text || '-'],
    ['웹 문구', issue.web?.text || '-'],
    ['similarityScore', issue.similarityScore ?? '-'],
    ['matchedBy', issue.matchedBy || '-'],
    ['레이어 경로', issue.layerPath || issue.figma?.layerPath || issue.web?.layerPath || '-'],
  ]
}

function getPrimaryIssues(designQa = {}) {
  const primaryIssues = Array.isArray(designQa.primaryIssues) ? designQa.primaryIssues : []
  const topIssues = Array.isArray(designQa.topIssues) ? designQa.topIssues.filter((issue) => !issue.isReference) : []
  if (primaryIssues.length > 0) {
    const topIssueIds = new Set(topIssues.map((issue) => issue.id))
    return [...topIssues, ...primaryIssues.filter((issue) => !topIssueIds.has(issue.id))]
  }

  if (topIssues.length > 0) return topIssues

  return (designQa.issues || []).filter((issue) => issue.status !== 'ok' && !issue.isReference)
}

function getReferenceIssues(designQa = {}, primaryIssues) {
  if (Array.isArray(designQa.referenceIssues)) return designQa.referenceIssues

  const primaryIds = new Set(primaryIssues.map((issue) => issue.id))
  return (designQa.issues || []).filter((issue) => issue.status !== 'ok' && (issue.isReference || issue.isFooterDisclaimer) && !primaryIds.has(issue.id))
}

function getTopCounts(issues) {
  return issues.reduce((counts, issue) => {
    const categories = getCategories(issue)
    return {
      text: counts.text + (categories.includes('text') ? 1 : 0),
      cta: counts.cta + (categories.includes('cta') ? 1 : 0),
      design: counts.design + (categories.some((category) => ['style', 'layout', 'image'].includes(category)) ? 1 : 0),
    }
  }, { text: 0, cta: 0, design: 0 })
}

function createPaneMarkers(issues, markerMap, selectedIssue) {
  const markerIssues = selectedIssue && !issues.some((issue) => issue.id === selectedIssue.id)
    ? [...issues, selectedIssue]
    : issues

  return markerIssues.reduce((markers, issue) => ({
    web: [...markers.web, { issueId: issue.id, label: markerMap.get(issue.id), ratio: getPanePositionRatio(issue, 'web') }],
    figma: [...markers.figma, { issueId: issue.id, label: markerMap.get(issue.id), ratio: getPanePositionRatio(issue, 'figma') }],
  }), { web: [], figma: [] })
}

function createMarkerMap(primaryIssues, referenceIssues) {
  const markerMap = new Map()
  primaryIssues.forEach((issue, index) => markerMap.set(issue.id, `[${String(index + 1).padStart(2, '0')}]`))
  referenceIssues.forEach((issue, index) => markerMap.set(issue.id, `[R${String(index + 1).padStart(2, '0')}]`))
  return markerMap
}

function groupIssuesBySection(issues) {
  const groups = new Map()

  issues.forEach((issue) => {
    const key = issue.sectionId || issue.sectionName || '기타 섹션'
    const group = groups.get(key) || {
      id: key,
      name: getSafeSectionName(issue),
      priority: issue.priority ?? 9,
      text: 0,
      cta: 0,
      design: 0,
      isFooterDisclaimer: Boolean(issue.isFooterDisclaimer),
      positionRatio: getPanePositionRatio(issue, 'figma') ?? getPanePositionRatio(issue, 'web') ?? 1,
      issues: [],
    }

    const categories = getCategories(issue)
    group.priority = Math.min(group.priority, issue.priority ?? group.priority)
    group.positionRatio = Math.min(group.positionRatio, getPanePositionRatio(issue, 'figma') ?? getPanePositionRatio(issue, 'web') ?? group.positionRatio)
    group.text += categories.includes('text') ? 1 : 0
    group.cta += categories.includes('cta') ? 1 : 0
    group.design += categories.some((category) => ['style', 'layout', 'image'].includes(category)) ? 1 : 0
    group.isFooterDisclaimer = group.isFooterDisclaimer || issue.isFooterDisclaimer
    group.issues.push(issue)
    groups.set(key, group)
  })

  return Array.from(groups.values()).sort((first, second) => {
    if (first.positionRatio !== second.positionRatio) return first.positionRatio - second.positionRatio
    return second.issues.length - first.issues.length
  })
}

function getSafeSectionName(issue) {
  if (issue.isFooterDisclaimer) return '푸터/디스클레이머'
  const sectionName = issue.sectionName || issue.region
  if (sectionName && !isRawSectionName(sectionName)) return sectionName

  return getPlannerSectionNameByRatio(issue.anchor?.positionRatio ?? issue.figma?.positionRatio ?? issue.web?.positionRatio)
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
  const ratio = clampRatio(positionRatio)
  if (ratio < 0.22) return '상단 영역'
  if (ratio < 0.74) return '주요 콘텐츠 영역'
  if (ratio < 0.9) return '하단 안내 영역'
  return '푸터/디스클레이머'
}

function getConfirmText(issue) {
  const categories = getCategories(issue)
  if (categories.includes('cta')) return hasTextDifference(issue) ? '버튼 문구가 다릅니다.' : '버튼 문구와 연결 의도가 시안과 같은지 확인하세요.'
  if (categories.includes('text')) return hasTextDifference(issue) ? '문구가 다릅니다.' : '문구가 시안 의도와 동일한지 확인하세요.'
  if (categories.includes('layout')) return '이미지의 표시 위치와 크기 차이가 허용 가능한지 확인하세요.'
  if (categories.includes('style') || categories.includes('image')) return '시안과 웹 화면의 시각 차이가 의도된 것인지 확인하세요.'
  return '선택한 영역을 웹/피그마 이미지에서 비교해 확인하세요.'
}

function getCategories(issue) {
  return Array.isArray(issue.categories) ? issue.categories : []
}

function hasTextDifference(issue) {
  return Boolean(issue.figma?.text && issue.web?.text && getCategories(issue).includes('text'))
}

function getIssueTypeLabel(issue) {
  const categories = getCategories(issue)
  if (categories.includes('cta')) return '버튼 확인'
  if (categories.includes('text')) return '문구 확인'
  if (categories.includes('image')) return '이미지 확인'
  return '확인 필요'
}

function getIssueItemText(issue) {
  return formatPlannerCopy(sanitizeDefaultDisplayText(issue.text, getPlannerFallbackText(issue, 'item')))
}

function sanitizeDefaultDisplayText(value, fallback) {
  const text = typeof value === 'string' ? value.trim() : ''
  if (!text) return fallback
  if (isRawPlannerText(text)) return fallback
  return text
}

function formatPlannerCopy(value) {
  return String(value)
    .replace(/\bFigma\b/g, '피그마')
    .replace(/\bWeb\b/g, '웹')
    .replace(/\bCTA\b/g, '버튼')
    .replace(/\bcon\b/gi, '주요 콘텐츠 영역')
    .replace(/\bHigh\b/g, '확인 필요')
    .replace(/\bfontFamily\b/g, '글꼴 정보')
    .replace(/\bxRatio\b/g, '가로 위치')
    .replace(/\blayerPath\b/g, '레이어 경로')
    .replace(/\bnormalizedText\b/g, '정리된 문구')
    .replace(/Main_visual/gi, '상단 영역')
}

function isRawPlannerText(value) {
  const text = String(value).trim()
  const normalizedText = text.toLowerCase()
  const compactText = normalizedText.replace(/\s+/g, '')

  return normalizedText === 'con'
    || normalizedText.includes('hero/kv')
    || normalizedText.includes('hero / kv')
    || normalizedText.includes('main_visual')
    || normalizedText.includes('main visual')
    || normalizedText.includes('section_')
    || /(^|\s|[-_])con($|\s|[-_])/.test(normalizedText)
    || /\s\/\s|\/|>/.test(text)
    || /^section[_-]?\d*/i.test(text)
    || /^frame[_-]?\d*/i.test(text)
    || /^(vector|path|shape|rectangle|ellipse|line|group|frame|blende|blend|logo|icon|icon frame)([_\s-]?\d*)?$/i.test(text)
    || /^(main[_\s-]?visual|hero|kv|con)([_\s-]?(image|img|graphic|candidate|copy|text))*$/i.test(text)
    || /^(image|img|graphic|icon)[_\s-]?\d*$/i.test(text)
    || compactText === 'mainvisualimage'
}

function getPlannerFallbackText(issue, source) {
  if (source === 'figma') return getCategories(issue).includes('image') ? '시안 이미지' : '피그마 확인 항목'
  if (source === 'web') return getCategories(issue).includes('image') ? '웹 이미지' : '웹 확인 항목'
  if (getCategories(issue).includes('image')) return issue.label && !isRawPlannerText(issue.label) ? issue.label : '이미지 후보'
  return issue.label && !isRawPlannerText(issue.label) ? issue.label : '확인 항목'
}

function getRawEvidenceRows(evidence) {
  if (!evidence) return [['상태', '-']]
  return [
    ['텍스트', evidence.text || '-'],
    ['글자 크기', evidence.fontSize],
    ['색상', evidence.color],
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
  const ratio = paneRatio ?? issue.anchor?.positionRatio
  return ratio === null || ratio === undefined ? null : clampRatio(ratio)
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

function clampRatio(value) {
  return Math.max(0, Math.min(1, Number(value) || 0))
}

export default MockupQaPanel
