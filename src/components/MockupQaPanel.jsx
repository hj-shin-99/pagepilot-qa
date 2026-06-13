import { useMemo, useRef, useState } from 'react'

const INITIAL_ISSUE_LIMIT = 10
const ISSUE_LIMIT_STEP = 10

const plannerMetricLabels = [
  { key: 'checkRequired', legacyKey: 'total', label: '확인 필요', className: 'status-warn' },
  { key: 'textCheck', legacyKey: 'text', label: '문구 확인', className: '' },
  { key: 'ctaCheck', legacyKey: 'cta', label: '버튼/링크 확인', className: '' },
  { key: 'designCheck', legacyKey: 'style', label: '디자인 확인', className: '' },
]

const filterLabels = [
  { key: 'all', label: '전체' },
  { key: 'text', label: '문구' },
  { key: 'cta', label: '버튼/링크' },
  { key: 'style', label: '스타일' },
  { key: 'layout', label: '위치/크기' },
]

const statusLabels = {
  ok: '정상',
  error: '차이 있음',
  warn: '확인 필요',
}

const matchTypeLabels = {
  exact: '정확 매칭',
  fuzzy: '유사 문구 확인',
  'missing-web': '웹 화면 누락',
  'missing-web-image': '웹 이미지 누락',
  'web-only': '웹 추가 항목',
  'image-position': '이미지 위치 확인',
  'footer-aggregate': '참고 이슈 묶음',
  waiting: '비교 대기',
}

function MockupQaPanel({ designImages, designQa, figmaElements, result, webElements }) {
  const [activeFilter, setActiveFilter] = useState('all')
  const [visibleLimit, setVisibleLimit] = useState(INITIAL_ISSUE_LIMIT)
  const [selectedImageId, setSelectedImageId] = useState(designImages[0]?.id || '')
  const [selectedIssueId, setSelectedIssueId] = useState('')
  const webFrameRef = useRef(null)
  const figmaFrameRef = useRef(null)
  const isSyncingScrollRef = useRef(false)

  const primaryIssues = useMemo(() => getPrimaryIssues(designQa), [designQa])
  const referenceIssues = useMemo(() => getReferenceIssues(designQa, primaryIssues), [designQa, primaryIssues])
  const filteredPrimaryIssues = useMemo(
    () => primaryIssues.filter((issue) => matchesFilter(issue, activeFilter)),
    [activeFilter, primaryIssues],
  )
  const visiblePrimaryIssues = filteredPrimaryIssues.slice(0, visibleLimit)
  const primaryIssueGroups = useMemo(() => groupIssuesBySection(visiblePrimaryIssues), [visiblePrimaryIssues])
  const referenceIssueGroups = useMemo(() => groupIssuesBySection(referenceIssues), [referenceIssues])
  const markerMap = useMemo(() => createMarkerMap(primaryIssues, referenceIssues), [primaryIssues, referenceIssues])
  const selectableIssues = [...filteredPrimaryIssues, ...referenceIssues]
  const firstImageId = designImages[0]?.id || ''
  const firstIssueId = filteredPrimaryIssues[0]?.id || referenceIssues[0]?.id || ''
  const activeImageId = designImages.some((image) => image.id === selectedImageId) ? selectedImageId : firstImageId
  const activeIssueId = selectableIssues.some((issue) => issue.id === selectedIssueId) ? selectedIssueId : firstIssueId
  const selectedImage = designImages.find((image) => image.id === activeImageId) || designImages[0]
  const selectedIssue = selectableIssues.find((issue) => issue.id === activeIssueId) || filteredPrimaryIssues[0] || referenceIssues[0]
  const selectedMarkerLabel = selectedIssue ? markerMap.get(selectedIssue.id) : ''
  const plannerCounts = getPlannerCounts(designQa?.summaryCounts, primaryIssues)

  const handleIssueSelect = (issue) => {
    setSelectedIssueId(issue.id)
    document.getElementById('mockup-compare-viewer')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    scrollPaneToIssue(webFrameRef, issue, 'web')
    scrollPaneToIssue(figmaFrameRef, issue, 'figma')
  }

  const handleFilterSelect = (filter) => {
    setActiveFilter(filter)
    setVisibleLimit(INITIAL_ISSUE_LIMIT)
    setSelectedIssueId('')
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
      <article className="detail-card mockup-planner-card">
        <div className="section-title-row">
          <div>
            <p className="eyebrow">웹·시안 비교</p>
            <h3>시안 비교 QA</h3>
          </div>
          <span>먼저 아래 {Math.min(filteredPrimaryIssues.length, INITIAL_ISSUE_LIMIT)}건만 확인하세요</span>
        </div>
        <section className="metrics-grid mockup-metrics" aria-label="시안 비교 QA 플래너 요약">
          {plannerMetricLabels.map((metric) => (
            <article className={`metric-card ${metric.className}`} key={metric.key}>
              <p className="metric-label">{metric.label}</p>
              <p className="metric-value">{plannerCounts[metric.key]}</p>
            </article>
          ))}
        </section>
        <p className="panel-note relaxed-note">
          주요 이슈 {primaryIssues.length}건 중 우선순위가 높은 항목만 먼저 펼쳤습니다. 참고 이슈 {referenceIssues.length}건과 비교 기준은 접힌 영역에서 필요할 때만 확인하세요.
        </p>
      </article>

      <article className="detail-card mockup-viewer-card" id="mockup-compare-viewer">
        <div className="section-title-row">
          <div>
            <h3>웹 화면과 피그마 시안</h3>
            <p className="panel-note relaxed-note">선택한 이슈 번호가 두 이미지의 같은 높이 지점에 표시됩니다.</p>
          </div>
          <span>피그마 항목 {figmaElements.length}개 · 웹 항목 {webElements.length}개</span>
        </div>

        <div className="mockup-comparison-grid">
          <ComparisonPane
            anchorLabel="web"
            frameRef={webFrameRef}
            highlightRatio={getPanePositionRatio(selectedIssue, 'web')}
            imageAlt="웹 화면 캡처 이미지"
            imageSrc={result.webScreenshot?.dataUrl}
            issue={selectedIssue}
            label="웹 화면"
            markerLabel={selectedMarkerLabel}
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
            label="피그마 시안"
            markerLabel={selectedMarkerLabel}
            note={selectedImage ? formatImageMeta(selectedImage) : '업로드 대기'}
            placeholder={selectedImage ? '저장된 기록에는 원본 이미지가 없어 이미지 정보만 표시됩니다.' : '좌측 패널에서 피그마 시안 이미지를 업로드해 주세요.'}
            onScroll={() => handleSyncedScroll(figmaFrameRef, webFrameRef)}
          />
        </div>

        <details className="mockup-secondary-selector">
          <summary>피그마 시안 이미지 선택</summary>
          <div className="image-selector" aria-label="피그마 시안 이미지 선택">
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
            )) : <p className="panel-note relaxed-note">업로드된 피그마 시안 이미지가 없습니다.</p>}
          </div>
        </details>
      </article>

      <article className="detail-card mockup-report-card">
        <div className="section-title-row">
          <div>
            <h3>상위 주요 이슈</h3>
            <p className="panel-note relaxed-note">위치, 항목, 확인 내용, 피그마/웹 값을 카드에서 바로 확인하세요.</p>
          </div>
          <span>기본 {INITIAL_ISSUE_LIMIT}개 · 현재 {visiblePrimaryIssues.length}개 표시</span>
        </div>

        <div className="mockup-filter-bar" aria-label="시안 비교 주요 이슈 필터">
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
          {primaryIssueGroups.length > 0 ? primaryIssueGroups.map((group) => (
            <section className="mockup-section-card" key={group.id}>
              <div className="mockup-section-heading">
                <span>
                  <strong>{group.name}</strong>
                  <small>{group.issues.length}건 · 문구 {group.text} · 버튼/링크 {group.cta} · 디자인 {group.design}</small>
                </span>
                <span className="section-priority-badge">{getPriorityLabel(group.priority)}</span>
              </div>
              <ul className="mockup-issue-list">
                {group.issues.map((issue) => (
                  <IssueCard
                    issue={issue}
                    isReference={false}
                    isSelected={selectedIssue?.id === issue.id}
                    key={issue.id}
                    markerLabel={markerMap.get(issue.id)}
                    onSelect={handleIssueSelect}
                  />
                ))}
              </ul>
            </section>
          )) : <p className="empty-row">선택한 필터에 해당하는 주요 비교 이슈가 없습니다.</p>}
        </div>

        {visibleLimit < filteredPrimaryIssues.length ? (
          <button className="mockup-more-button" type="button" onClick={() => setVisibleLimit((limit) => limit + ISSUE_LIMIT_STEP)}>
            주요 이슈 더 보기 ({filteredPrimaryIssues.length - visibleLimit}개 남음)
          </button>
        ) : null}
      </article>

      <details className="detail-card mockup-folded-card">
        <summary>
          <span>
            <strong>참고 이슈</strong>
            <small>기본 접힘 · 푸터/디스클레이머 포함 {referenceIssues.length}건</small>
          </span>
          <span className="section-priority-badge">참고</span>
        </summary>
        <div className="mockup-section-list mockup-reference-list">
          {referenceIssueGroups.length > 0 ? referenceIssueGroups.map((group) => (
            <details className={`mockup-section-card ${group.isFooterDisclaimer ? 'is-footer' : ''}`} key={group.id}>
              <summary>
                <span>
                  <strong>{group.isFooterDisclaimer ? '푸터/디스클레이머' : group.name}</strong>
                  <small>{group.issues.length}건 · 참고 확인</small>
                </span>
                <span className="section-priority-badge">접힘</span>
              </summary>
              <ul className="mockup-issue-list">
                {group.issues.map((issue) => (
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
            <strong>비교 기준 및 주의 사항</strong>
            <small>정확 매칭, 유사 문구, 픽셀 단위 비교 범위</small>
          </span>
          <span className="section-priority-badge">상세</span>
        </summary>
        <p className="panel-note relaxed-note">
          텍스트는 줄바꿈, 특수 공백, 반복 공백, 보이지 않는 문자, 일부 문장부호 차이, 영문 대소문자를 정규화해 먼저 정확 매칭합니다. 정확 매칭되지 않은 6자 이상 문구만 0.8 이상 유사도에서 확인 필요로 표시하며, 픽셀 단위 자동 비교는 실행하지 않습니다.
        </p>
      </details>
    </section>
  )
}

function ComparisonPane({ anchorLabel, frameRef, highlightRatio, imageAlt, imageSrc, issue, label, markerLabel, note, onScroll, placeholder }) {
  return (
    <section className="comparison-pane" aria-label={label}>
      <div className="comparison-pane-head">
        <strong>{label}</strong>
        <span>{note}</span>
      </div>
      {issue ? (
        <p className="comparison-selected-context">
          선택 이슈 {markerLabel} · {getSafeSectionName(issue)} · {formatPercent(highlightRatio)} 지점
        </p>
      ) : null}
      <div
        className="comparison-image-frame"
        data-anchor-scope={anchorLabel}
        ref={frameRef}
        style={{ '--highlight-top': `${highlightRatio * 100}%` }}
        tabIndex="-1"
        onScroll={onScroll}
      >
        {issue ? (
          <span className="comparison-highlight-line" aria-hidden="true">
            <span className="comparison-marker-badge">{markerLabel}</span>
          </span>
        ) : null}
        {imageSrc ? <img src={imageSrc} alt={imageAlt} /> : <div className="comparison-placeholder">{placeholder}</div>}
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
          <span className={`status-chip status-${issue.status}`}>{statusLabels[issue.status]}</span>
          <span>{isReference ? '참고 이슈' : '주요 이슈'}</span>
          <span>{getMatchLabel(issue.matchType)}</span>
        </span>
        <strong>{getDisplayIssueLabel(issue)}</strong>
        <dl className="mockup-card-fields">
          <div>
            <dt>위치</dt>
            <dd>{getSafeSectionName(issue)}</dd>
          </div>
          <div>
            <dt>항목</dt>
            <dd><IssueText text={getIssueItemText(issue)} /></dd>
          </div>
          <div>
            <dt>확인 내용</dt>
            <dd>{getConfirmText(issue)}</dd>
          </div>
          <div>
            <dt>피그마</dt>
            <dd>{getEvidenceValue(issue.figma, '피그마 기준 없음', issue, 'figma')}</dd>
          </div>
          <div>
            <dt>웹</dt>
            <dd>{getEvidenceValue(issue.web, '웹 수집 없음', issue, 'web')}</dd>
          </div>
        </dl>
      </button>
      <IssueRawDetails issue={issue} />
    </li>
  )
}

function IssueText({ text }) {
  if (!text) return <span className="mockup-issue-text">텍스트 없음</span>
  if (text.length <= 120) return <span className="mockup-issue-text">{text}</span>

  return <span className="mockup-issue-text">{text.slice(0, 120)}...</span>
}

function IssueRawDetails({ issue }) {
  return (
    <details className="mockup-raw-details">
      <summary>상세 보기</summary>
      <div className="mockup-raw-grid">
        <RawEvidence title="이슈 원문" rows={[['상세', issue.detail], ['layerPath', issue.layerPath || issue.figma?.layerPath || issue.web?.layerPath || '-']]} />
        <RawEvidence title="피그마 값" rows={getRawEvidenceRows(issue.figma)} />
        <RawEvidence title="웹 값" rows={getRawEvidenceRows(issue.web)} />
      </div>
      {(issue.differences || []).length > 0 ? (
        <ul className="mockup-difference-list">
          {issue.differences.map((difference) => (
            <li key={`${issue.id}-${difference.type}-${difference.label}`}>
              <strong>{difference.label}</strong>
              <span>{difference.detail}</span>
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

function matchesFilter(issue, filter) {
  if (filter === 'all') return true
  return getCategories(issue).includes(filter)
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

function getPlannerCounts(summaryCounts, primaryIssues) {
  return plannerMetricLabels.reduce((counts, metric) => ({
    ...counts,
    [metric.key]: summaryCounts?.[metric.key] ?? summaryCounts?.[metric.legacyKey] ?? countIssuesByMetric(primaryIssues, metric.key),
  }), {})
}

function countIssuesByMetric(issues, key) {
  if (key === 'checkRequired') return issues.length
  if (key === 'textCheck') return issues.filter((issue) => getCategories(issue).includes('text')).length
  if (key === 'ctaCheck') return issues.filter((issue) => getCategories(issue).includes('cta')).length
  if (key === 'designCheck') return issues.filter((issue) => getCategories(issue).some((category) => ['style', 'layout', 'image'].includes(category))).length
  return 0
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
      issues: [],
    }

    const categories = getCategories(issue)
    group.priority = Math.min(group.priority, issue.priority ?? group.priority)
    group.text += categories.includes('text') ? 1 : 0
    group.cta += categories.includes('cta') ? 1 : 0
    group.design += categories.some((category) => ['style', 'layout', 'image'].includes(category)) ? 1 : 0
    group.isFooterDisclaimer = group.isFooterDisclaimer || issue.isFooterDisclaimer
    group.issues.push(issue)
    groups.set(key, group)
  })

  return Array.from(groups.values()).sort((first, second) => {
    if (first.isFooterDisclaimer !== second.isFooterDisclaimer) return first.isFooterDisclaimer ? 1 : -1
    if (first.priority !== second.priority) return first.priority - second.priority
    return second.issues.length - first.issues.length
  })
}

function getPriorityLabel(priority) {
  if (priority <= 3) return '우선 확인'
  if (priority <= 6) return '확인'
  return '참고'
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
  if (ratio < 0.48) return '주요 콘텐츠 영역 1'
  if (ratio < 0.74) return '주요 콘텐츠 영역 2'
  if (ratio < 0.9) return '하단 안내 영역'
  return '화면 하단 영역'
}

function getConfirmText(issue) {
  const categories = getCategories(issue)
  if (categories.includes('cta')) return '버튼/링크 문구와 연결 의도가 시안과 같은지 확인하세요.'
  if (categories.includes('text')) return '문구가 시안 의도와 동일한지 확인하세요.'
  if (categories.includes('layout')) return '이미지의 표시 위치와 크기 차이가 허용 가능한지 확인하세요.'
  if (categories.includes('style') || categories.includes('image')) return '시안과 웹 화면의 시각 차이가 의도된 것인지 확인하세요.'
  return '선택한 영역을 웹/피그마 이미지에서 비교해 확인하세요.'
}

function getCategories(issue) {
  return Array.isArray(issue.categories) ? issue.categories : []
}

function getDisplayIssueLabel(issue) {
  return formatPlannerCopy(sanitizeDefaultDisplayText(issue.label, getPlannerFallbackText(issue, 'issue')))
}

function getIssueItemText(issue) {
  return sanitizeDefaultDisplayText(issue.text, getPlannerFallbackText(issue, 'item'))
}

function getEvidenceValue(evidence, fallback, issue, source) {
  if (!evidence) return fallback
  const evidenceText = evidence.text || evidence.href || evidence.tag
  return sanitizeDefaultDisplayText(evidenceText, getPlannerFallbackText(issue, source)) || fallback
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
    .replace(/\bCTA\b/g, '버튼/링크')
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
    ['fontSize', evidence.fontSize],
    ['color', evidence.color],
    ['x/y', `${formatRawNumber(evidence.x)} / ${formatRawNumber(evidence.y)}`],
    ['width/height', `${formatRawNumber(evidence.width)} / ${formatRawNumber(evidence.height)}`],
    ['layerPath', evidence.layerPath || '-'],
  ]
}

function getMatchLabel(matchType) {
  return matchTypeLabels[matchType] || '확인 필요'
}

function scrollPaneToIssue(frameRef, issue, pane) {
  window.requestAnimationFrame(() => {
    const frame = frameRef.current
    if (!frame) return

    const maxScroll = frame.scrollHeight - frame.clientHeight
    frame.scrollTop = Math.max(0, maxScroll * getPanePositionRatio(issue, pane))
    frame.focus({ preventScroll: true })
  })
}

function getPanePositionRatio(issue, pane) {
  if (!issue) return 0
  const paneRatio = pane === 'web' ? issue.web?.positionRatio : issue.figma?.positionRatio
  return clampRatio(paneRatio ?? issue.anchor?.positionRatio)
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
  return String(value)
}

function clampRatio(value) {
  return Math.max(0, Math.min(1, Number(value) || 0))
}

export default MockupQaPanel
