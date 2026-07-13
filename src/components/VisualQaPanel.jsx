import { useEffect, useRef, useState } from 'react'
import {
  createActionItems,
  createDifferenceItems,
  createFigmaImageUrl,
  createHeroSummary,
  createMediaSummary,
  createOtherInteractionItems,
  createPriceItems,
  createVisualIssueCards,
  createWebDisplayImageUrl,
} from '../utils/visualQa'

function VisualQaPanel({ result, summary, copyStatus, onCopyResult, aiReview }) {
  const [selectedIssueId, setSelectedIssueId] = useState('')
  const [highlight, setHighlight] = useState({ figma: null, web: null })
  const cards = createVisualIssueCards(result)
  const meta = result.meta || {}
  const aiHints = result.aiHints || {}
  const comparison = result.comparison || {}
  const hero = createHeroSummary(aiHints)
  const media = createMediaSummary(aiHints)
  const figmaImage = createFigmaImageUrl(result.figma)
  const webImage = createWebDisplayImageUrl(result.web)
  const differenceItems = createDifferenceListItems(result, aiReview)

  const handleSelectIssue = (item) => {
    setSelectedIssueId(item.id)
    setHighlight({ figma: item.figmaYRatio, web: item.webYRatio })
  }

  return (
    <section className="section-stack visual-qa-panel" aria-label="Visual QA 결과">
      <header className="audit-header visual-audit-header">
        <div className="audit-header-top">
          <div>
            <p className="eyebrow">Visual QA · {formatDate(meta.createdAt)}</p>
            <h2>{result.web?.page?.title || 'Visual QA 결과'}</h2>
            <p className="target-url">{meta.webUrl}</p>
          </div>
          <button className="secondary-button" type="button" onClick={onCopyResult}>
            결과 복사
          </button>
        </div>
        {copyStatus ? <p className="copy-status">{copyStatus}</p> : null}
      </header>

      <ImageComparisonCard figmaImage={figmaImage} webImage={webImage} highlight={highlight} />

      <DifferenceList items={differenceItems} selectedIssueId={selectedIssueId} onSelectIssue={handleSelectIssue} />

      <details className="detail-card visual-detail-accordion">
        <summary>
          <span>세부 정보 보기</span>
          <strong>Hero · CTA · Price · Media · Text Difference · System</strong>
        </summary>

        <section className="visual-two-column">
          <VisualSectionCard title="Hero" note="핵심 영역 요약">
            <KeyValue label="Figma Hero Text" value={hero.figmaTextCount} />
            <KeyValue label="Web Hero Text" value={hero.webTextCount} />
            <KeyValue label="CTA Count" value={`Figma ${hero.figmaCtaCount} / Web ${hero.webCtaCount}`} />
            <KeyValue label="대표 Media" value={`Figma ${formatList(hero.figmaMediaTypes)} / Web ${formatList(hero.webMediaTypes)}`} />
          </VisualSectionCard>

          <VisualSectionCard title="CTA" note="Primary/Secondary CTA만 표시">
            <EntityList items={createActionItems(aiHints)} emptyText="표시할 핵심 CTA가 없습니다." />
            <OtherInteractions items={createOtherInteractionItems(aiHints)} />
          </VisualSectionCard>
        </section>

        <section className="visual-two-column">
          <VisualSectionCard title="Price" note="금액/숫자 후보">
            <EntityList items={createPriceItems(aiHints, comparison)} emptyText="수집된 가격/금액 후보가 없습니다." />
          </VisualSectionCard>

          <VisualSectionCard title="Media" note="Hero primary media와 주요 개수">
            <KeyValue label="Hero Media" value={media.comparisonText} />
            <KeyValue label="Content Media" value={`Figma 이미지 ${media.counts.figmaImage} / Web 이미지 ${media.counts.webImage} / Web 영상 ${media.counts.webVideo}`} />
            <EntityList items={media.heroPrimary} emptyText="Hero primary media가 없습니다." />
          </VisualSectionCard>
        </section>

        <section className="visual-two-column">
          <VisualSectionCard title="Text Difference" note="문구 비교 요약">
            <KeyValue label="Matched" value={comparison.matchedCount} />
            <KeyValue label="Different" value={comparison.differenceCount} />
            <KeyValue label="Figma Only" value={comparison.figmaOnlyCount} />
            <KeyValue label="Web Only" value={comparison.webOnlyCount} />
            <EntityList items={createDifferenceItems(comparison)} emptyText="문구 차이가 없습니다." />
          </VisualSectionCard>

          <VisualSectionCard title="System" note="개발 확인용 메타">
            <p className="panel-note relaxed-note">{summary}</p>
            <KeyValue label="Payload Version" value={meta.payloadVersion} />
            <KeyValue label="Playwright Runs" value={meta.playwrightRunCount} />
            <KeyValue label="Figma Cache" value={meta.figmaCacheSource} />
            <KeyValue label="Figma Render Cache" value={meta.figmaRenderCacheSource} />
          </VisualSectionCard>
        </section>

        <section className="visual-detail-section">
          <h3>규칙 기반 상세</h3>
          <ul className="visual-card-list">
            {cards.map((card) => (
              <li className={`visual-issue-card ${card.severity}`} key={`${card.category}-${card.title}-${card.detail}-${card.entityKey}`}>
                <span>{card.severity}</span>
                <strong>{card.title}</strong>
                <p>{card.detail}</p>
                {card.technical ? (
                  <details className="visual-technical-detail">
                    <summary>상세 보기</summary>
                    <small>{card.technical}</small>
                  </details>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      </details>
    </section>
  )
}

function ImageComparisonCard({ figmaImage, webImage, highlight }) {
  return (
    <article className="detail-card visual-image-card visual-image-card-primary">
      <div className="compare-scroll-shell visual-compare-shell">
        <div className="compare-grid">
          <ImagePane imageAlt="Figma 시안" imageSrc={figmaImage} label="Figma 시안" placeholder="Figma render 이미지가 없습니다." highlightRatio={highlight.figma} />
          <ImagePane imageAlt="Web 캡처" imageSrc={webImage} label="Web 캡처" placeholder="Web screenshot 이미지가 없습니다." highlightRatio={highlight.web} />
        </div>
      </div>
    </article>
  )
}

function DifferenceList({ items, selectedIssueId, onSelectIssue }) {
  return (
    <article className="detail-card difference-list-card">
      <div className="section-title-row">
        <h3>다른 부분</h3>
        <span>{items.length}개</span>
      </div>
      {items.length > 0 ? (
        <ol className="difference-list">
          {items.map((item, index) => (
            <li key={item.id}>
              <button className={`difference-item ${selectedIssueId === item.id ? 'is-selected' : ''}`} type="button" onClick={() => onSelectIssue(item)}>
                <span className="difference-index">{index + 1}</span>
                <span className="difference-copy">
                  <strong>{item.area}</strong>
                  <span>{item.message}</span>
                  <DifferenceValues figmaValue={item.figmaValue} webValue={item.webValue} />
                </span>
              </button>
            </li>
          ))}
        </ol>
      ) : <p className="empty-row">표시할 차이를 찾지 못했습니다.</p>}
    </article>
  )
}

function DifferenceValues({ figmaValue, webValue }) {
  if (!figmaValue && !webValue) return null
  return (
    <dl className="difference-values">
      {figmaValue ? <div><dt>Figma</dt><dd>{figmaValue}</dd></div> : null}
      {webValue ? <div><dt>Web</dt><dd>{webValue}</dd></div> : null}
    </dl>
  )
}

function ImagePane({ imageAlt, imageSrc, label, placeholder, highlightRatio }) {
  const [failed, setFailed] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const frameRef = useRef(null)
  const showImage = imageSrc && !failed

  useEffect(() => {
    if (!Number.isFinite(Number(highlightRatio)) || !frameRef.current) return
    const frame = frameRef.current
    const maxScroll = Math.max(0, frame.scrollHeight - frame.clientHeight)
    frame.scrollTo({ top: maxScroll * Math.max(0, Math.min(1, Number(highlightRatio))), behavior: 'smooth' })
  }, [highlightRatio])

  return (
    <section className="comparison-pane" aria-label={label}>
      <div className="comparison-pane-head">
        <strong>{label}</strong>
      </div>
      <div ref={frameRef} className={`comparison-image-frame mockup-ai-image-frame ${showImage ? '' : 'is-empty'}`}>
        {Number.isFinite(Number(highlightRatio)) ? <span className="image-highlight-band" style={{ top: `${Math.max(0, Math.min(1, Number(highlightRatio))) * 100}%` }} /> : null}
        {showImage ? (
          <div className="comparison-image-stage mockup-ai-image-stage">
            {!loaded ? <span className="comparison-image-loading">이미지 로딩 중...</span> : null}
            <a href={imageSrc} target="_blank" rel="noreferrer" aria-label={`${label} 이미지 새 탭에서 열기`}>
              <img src={imageSrc} alt={imageAlt} onLoad={() => setLoaded(true)} onError={() => setFailed(true)} />
            </a>
          </div>
        ) : (
          <div className="comparison-placeholder mockup-ai-image-placeholder">
            <span>{failed ? '이미지를 불러오지 못했습니다.' : placeholder}</span>
            {imageSrc ? (
              <details className="visual-technical-detail">
                <summary>HTTP 확인용 URL</summary>
                <small>{imageSrc}</small>
              </details>
            ) : null}
          </div>
        )}
      </div>
    </section>
  )
}

function createDifferenceListItems(result = {}, aiReview = null) {
  const comparison = result.comparison || {}
  const aiHints = result.aiHints || {}
  const items = []

  const differences = Array.isArray(comparison.differences) ? comparison.differences : []
  differences.forEach((difference, index) => {
    items.push({
      id: `difference-${index}-${normalizeKey(difference.figmaText || difference.text)}-${normalizeKey(difference.webText)}`,
      type: classifyDifferenceType(difference),
      area: inferIssueArea(difference),
      message: createShortDifferenceMessage(difference),
      figmaValue: difference.figmaText || difference.text || '',
      webValue: difference.webText || '',
      figmaYRatio: getYRatio(difference.figmaYRatio ?? difference.yRatio ?? difference.figmaNode?.yRatio),
      webYRatio: getYRatio(difference.webYRatio ?? difference.webElement?.yRatio ?? difference.webElement?.positionRatio),
      sortRank: getIssueSortRank(difference),
    })
  })

  const heroCtaGroup = aiHints.heroCtaGroup || {}
  if (Number(heroCtaGroup.countDifference || 0) > 0) {
    items.push({
      id: 'hero-cta-count',
      type: 'cta',
      area: 'Hero CTA',
      message: createCtaCountMessage(heroCtaGroup),
      figmaValue: String(heroCtaGroup.figma?.count ?? ''),
      webValue: String(heroCtaGroup.web?.count ?? ''),
      sortRank: 15,
    })
  }

  const heroMediaGroup = aiHints.heroMediaGroup || {}
  if (heroMediaGroup.comparisonHint) {
    items.push({
      id: 'hero-media-type',
      type: 'media',
      area: 'Hero Media',
      message: createMediaMessage(heroMediaGroup),
      figmaValue: formatList(heroMediaGroup.figma?.mediaTypes),
      webValue: formatList(heroMediaGroup.web?.mediaTypes),
      sortRank: 40,
    })
  }

  const aiIssues = [...(aiReview?.review?.mustFix || []), ...(aiReview?.review?.verify || [])]
  aiIssues.forEach((issue, index) => {
    if (!isVisualAiIssue(issue)) return
    items.push({
      id: `ai-${index}-${normalizeKey(issue.title)}`,
      type: issue.category || 'check',
      area: formatIssueArea(issue.category),
      message: createShortAiIssueMessage(issue),
      figmaValue: extractEvidenceValue(issue.evidence, 'figma'),
      webValue: extractEvidenceValue(issue.evidence, 'web'),
      sortRank: getAiIssueSortRank(issue),
    })
  })

  return dedupeDifferenceItems(items)
    .sort((first, second) => first.sortRank - second.sortRank)
    .slice(0, 12)
}

function isVisualAiIssue(issue = {}) {
  return ['price', 'text', 'cta', 'media'].includes(issue.category)
}

function classifyDifferenceType(item = {}) {
  const text = `${item.figmaText || ''} ${item.webText || ''} ${item.text || ''}`
  if (/[0-9][0-9,._%원$€£年月日-]*/.test(text)) return 'price'
  if (/cta|button|action/i.test(`${item.role || ''} ${item.sectionRole || ''} ${item.category || ''}`)) return 'cta'
  return 'text'
}

function createShortDifferenceMessage(item = {}) {
  const type = classifyDifferenceType(item)
  if (type === 'price') return '금액이 다릅니다.'
  if (type === 'cta') return 'CTA 문구가 다릅니다.'
  return '문구가 다릅니다.'
}

function createCtaCountMessage(group = {}) {
  const figmaCount = Number(group.figma?.count || 0)
  const webCount = Number(group.web?.count || 0)
  if (figmaCount > webCount) return `Web에 CTA가 ${figmaCount - webCount}개 부족합니다.`
  return 'CTA 개수가 다릅니다.'
}

function createMediaMessage(group = {}) {
  const figmaTypes = formatList(group.figma?.mediaTypes)
  const webTypes = formatList(group.web?.mediaTypes)
  if (figmaTypes !== '-' && webTypes !== '-') return `Figma는 ${figmaTypes}, Web은 ${webTypes}입니다.`
  return '미디어 구성이 다릅니다.'
}

function createShortAiIssueMessage(issue = {}) {
  if (issue.category === 'price') return '금액이 다릅니다.'
  if (issue.category === 'cta') return 'CTA 문구가 다릅니다.'
  if (issue.category === 'media') return '미디어 구성이 다릅니다.'
  return '문구가 다릅니다.'
}

function inferIssueArea(item = {}) {
  const text = `${item.sectionRole || ''} ${item.section || ''} ${item.sectionPath || ''} ${item.role || ''}`.toLowerCase()
  if (/hero|main|kv|top/.test(text)) return '메인 KV'
  if (/cta|button|action/.test(text)) return 'CTA'
  if (classifyDifferenceType(item) === 'price') return '금액'
  return '콘텐츠'
}

function formatIssueArea(category) {
  if (category === 'price') return '금액'
  if (category === 'cta') return 'CTA'
  if (category === 'media') return '미디어'
  return '콘텐츠'
}

function getIssueSortRank(item = {}) {
  const yRatio = getYRatio(item.yRatio ?? item.figmaYRatio ?? item.webYRatio ?? item.figmaNode?.yRatio ?? item.webElement?.yRatio)
  if (yRatio !== null) return yRatio * 100
  const type = classifyDifferenceType(item)
  if (inferIssueArea(item) === '메인 KV') return 10
  if (type === 'cta') return 20
  if (type === 'price') return 50
  return 30
}

function getAiIssueSortRank(issue = {}) {
  if (issue.category === 'text') return 30
  if (issue.category === 'cta') return 20
  if (issue.category === 'price') return 50
  if (issue.category === 'media') return 40
  return 80
}

function dedupeDifferenceItems(items) {
  const seen = new Set()
  return items.filter((item) => {
    const key = `${normalizeKey(item.type)}:${normalizeKey(item.figmaValue)}:${normalizeKey(item.webValue)}:${normalizeKey(item.message)}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function extractEvidenceValue(evidence = [], side) {
  if (!Array.isArray(evidence)) return ''
  const match = evidence.find((item) => new RegExp(`^${side}:`, 'i').test(String(item)))
  return match ? String(match).replace(/^\w+:/, '').trim() : ''
}

function getYRatio(value) {
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 && number <= 1 ? number : null
}

function normalizeKey(value) {
  return String(value || '').toLowerCase().replace(/[\s\u00a0.,:;!?"'()[\]{}<>_/\\-]/g, '')
}

function VisualSectionCard({ title, note, children }) {
  return (
    <article className="detail-card visual-section-card">
      <div className="section-title-row">
        <div>
          <h3>{title}</h3>
          <p className="panel-note relaxed-note">{note}</p>
        </div>
      </div>
      <div className="visual-section-body">{children}</div>
    </article>
  )
}

function KeyValue({ label, value }) {
  return (
    <div className="visual-key-value">
      <span>{label}</span>
      <strong>{formatValue(value)}</strong>
    </div>
  )
}

function EntityList({ items, emptyText }) {
  if (!items.length) return <p className="empty-row">{emptyText}</p>

  return (
    <ul className="visual-entity-list">
      {items.map((item) => (
        <li key={item.id}>
          <strong>{item.title}</strong>
          <span>{item.detail}{item.sectionRole ? ` · ${item.sectionRole}` : ''}</span>
          {item.meta ? <small>{item.meta}</small> : null}
          {item.technical ? (
            <details className="visual-technical-detail">
              <summary>상세 보기</summary>
              <small>{item.technical}</small>
            </details>
          ) : null}
        </li>
      ))}
    </ul>
  )
}

function OtherInteractions({ items }) {
  if (!items.length) return null

  return (
    <details className="visual-folded-detail">
      <summary>기타 인터랙션 {items.length}개</summary>
      <EntityList items={items} emptyText="기타 인터랙션이 없습니다." />
    </details>
  )
}

function formatList(values) {
  return Array.isArray(values) && values.length > 0 ? values.join(', ') : '-'
}

function formatValue(value) {
  if (Array.isArray(value)) return formatList(value)
  if (value === undefined || value === null || value === '') return '-'
  return String(value)
}

function formatDate(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

export default VisualQaPanel
