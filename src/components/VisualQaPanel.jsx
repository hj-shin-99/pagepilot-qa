import { useState } from 'react'
import {
  countIssueCards,
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

function VisualQaPanel({ result, summary, copyStatus, onCopyResult, aiReview, aiReviewState = 'idle' }) {
  const cards = createVisualIssueCards(result)
  const counts = countIssueCards(cards)
  const meta = result.meta || {}
  const aiHints = result.aiHints || {}
  const comparison = result.comparison || {}
  const hero = createHeroSummary(aiHints)
  const media = createMediaSummary(aiHints)
  const figmaImage = createFigmaImageUrl(result.figma)
  const webImage = createWebDisplayImageUrl(result.web)
  const displayReview = createDisplayReview(aiReview, cards, counts)
  const displayIssues = createDisplayIssues(displayReview, cards)
  const aiMeta = aiReview?.meta || {}

  return (
    <section className="section-stack visual-qa-panel" aria-label="Visual QA 결과">
      <header className="audit-header visual-audit-header">
        <div className="audit-header-top">
          <div>
            <p className="eyebrow">Visual QA · {formatDate(meta.createdAt)}</p>
            <h2>{result.web?.page?.title || 'Canonical Visual QA 결과'}</h2>
            <p className="target-url">{meta.webUrl}</p>
          </div>
          <button className="secondary-button" type="button" onClick={onCopyResult}>
            결과 복사
          </button>
        </div>
        {copyStatus ? <p className="copy-status">{copyStatus}</p> : null}
      </header>

      <ReleaseDecisionCard review={displayReview} counts={counts} meta={aiMeta} state={aiReviewState} />

      <KeyIssueList issues={displayIssues} />

      <ImageComparisonCard figmaImage={figmaImage} webImage={webImage} />

      <details className="detail-card visual-detail-accordion">
        <summary>
          <span>세부 비교 보기</span>
          <strong>Hero · CTA · Price · Media · Text Difference · System</strong>
        </summary>

        <section className="visual-detail-section">
          <h3>규칙 기반 검사 결과</h3>
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

          <VisualSectionCard title="System" note="분석 요약 및 시스템 메타">
            <p className="panel-note relaxed-note">{summary}</p>
            <KeyValue label="OpenAI 호출" value={aiMeta.openAiCalled === true ? '있음' : '없음'} />
            <KeyValue label="OpenAI Model" value={aiMeta.model || '-'} />
            <KeyValue label="Fallback" value={aiMeta.fallbackUsed ? '사용' : '미사용'} />
            <KeyValue label="Payload Version" value={meta.payloadVersion} />
            <KeyValue label="Playwright Runs" value={meta.playwrightRunCount} />
            <KeyValue label="Figma Cache" value={meta.figmaCacheSource} />
            <KeyValue label="Figma Render Cache" value={meta.figmaRenderCacheSource} />
          </VisualSectionCard>
        </section>
      </details>
    </section>
  )
}

function ReleaseDecisionCard({ review, counts, meta, state }) {
  if (state === 'loading') {
    return (
      <article className="detail-card release-decision-card caution">
        <div className="section-title-row">
          <h3>배포 판단</h3>
          <span>OpenAI 검토 중</span>
        </div>
        <p className="panel-note relaxed-note">규칙 기반 결과를 바탕으로 배포 판단을 생성하고 있습니다.</p>
      </article>
    )
  }

  return (
    <article className={`detail-card release-decision-card ${review.releaseDecision}`}>
      <div className="section-title-row">
        <div>
          <h3>배포 판단</h3>
          <p className="panel-note relaxed-note">{formatDecisionCopy(review.releaseDecision)}</p>
        </div>
        <span>{formatDecision(review.releaseDecision)}</span>
      </div>
      <p className="summary-box compact-summary">{review.summary}</p>
      <div className="release-decision-metrics" aria-label="AI Review 및 규칙 기반 개수">
        <MetricPill label="반드시 수정" value={review.mustFix.length} tone="critical" />
        <MetricPill label="확인 필요" value={review.verify.length} tone="warning" />
        <MetricPill label="Critical" value={counts.critical} tone="critical" />
        <MetricPill label="Warning" value={counts.warning} tone="warning" />
        <MetricPill label="Check" value={counts.check} tone="check" />
      </div>
      {meta.fallbackUsed ? <p className="panel-note relaxed-note">AI fallback 결과로, 규칙 기반 검사 결과를 우선 반영했습니다.</p> : null}
    </article>
  )
}

function MetricPill({ label, value, tone }) {
  return (
    <span className={`metric-pill ${tone}`}>
      {label} <strong>{value}</strong>
    </span>
  )
}

function KeyIssueList({ issues }) {
  return (
    <article className="detail-card key-issues-card">
      <div className="section-title-row">
        <h3>핵심 발견 문제</h3>
        <span>{issues.length}개</span>
      </div>
      {issues.length > 0 ? (
        <ul className="key-issue-list">
          {issues.map((issue, index) => (
            <li className={`key-issue-row ${issue.severity}`} key={`${index}-${issue.title}-${issue.description}`}>
              <span>{formatIssueSeverity(issue.severity)}</span>
              <strong>{issue.title || issue.category}</strong>
              <p>{issue.description}</p>
              <IssueEvidence evidence={issue.evidence} />
            </li>
          ))}
        </ul>
      ) : <p className="empty-row">기본 화면에 표시할 핵심 문제가 없습니다.</p>}
    </article>
  )
}

function IssueEvidence({ evidence = [] }) {
  if (!evidence.length) return null
  return (
    <dl className="key-issue-evidence">
      {evidence.map((item, index) => {
        const [label, ...rest] = String(item).split(':')
        return <div key={`${index}-${item}`}><dt>{rest.length ? label : '근거'}</dt><dd>{rest.length ? rest.join(':').trim() : item}</dd></div>
      })}
    </dl>
  )
}

function formatDecision(value) {
  if (value === 'ready') return 'Ready'
  if (value === 'blocked') return 'Blocked'
  return 'Caution'
}

function formatDecisionCopy(value) {
  if (value === 'ready') return '배포 가능'
  if (value === 'blocked') return '배포 전 수정 필요'
  return '확인 후 배포 권장'
}

function formatIssueSeverity(value) {
  if (value === 'critical') return '수정 필요'
  if (value === 'check') return '참고'
  return '확인 필요'
}

function ImageComparisonCard({ figmaImage, webImage }) {
  return (
    <article className="detail-card visual-image-card">
      <div className="section-title-row">
        <div>
          <h3>이미지 비교</h3>
          <p className="panel-note relaxed-note">Figma render와 Web screenshot을 나란히 확인합니다.</p>
        </div>
      </div>
      <div className="compare-scroll-shell visual-compare-shell">
        <div className="compare-grid">
          <ImagePane imageAlt="Figma render" imageSrc={figmaImage} label="Figma" placeholder="Figma render 이미지가 없습니다." />
          <ImagePane imageAlt="Web screenshot" imageSrc={webImage} label="Web" placeholder="Web screenshot 이미지가 없습니다." />
        </div>
      </div>
    </article>
  )
}

function createDisplayReview(aiReview, cards, counts) {
  const review = aiReview?.review
  if (review && !aiReview?.meta?.fallbackUsed) return review

  const criticalCards = cards.filter((card) => card.severity === 'critical')
  const warningCards = cards.filter((card) => card.severity === 'warning')
  const releaseDecision = criticalCards.length > 0 ? 'blocked' : warningCards.length > 0 ? 'caution' : 'ready'

  return {
    releaseDecision,
    summary: createRuleBasedSummary(releaseDecision, counts),
    mustFix: criticalCards.slice(0, 4).map((card) => createIssueFromCard(card, 'critical')),
    verify: warningCards.concat(cards.filter((card) => card.severity === 'check')).slice(0, 6).map((card) => createIssueFromCard(card, card.severity === 'check' ? 'check' : 'warning')),
    developerNotes: [],
  }
}

function createDisplayIssues(review, cards) {
  const aiIssues = [...(review.mustFix || []), ...(review.verify || [])]
  if (aiIssues.length > 0) return dedupeIssues(aiIssues.map(normalizeIssueForDisplay))
  return dedupeIssues(cards.filter((card) => card.severity !== 'check').slice(0, 6).map((card) => createIssueFromCard(card, card.severity === 'critical' ? 'critical' : 'warning')))
}

function createRuleBasedSummary(decision, counts) {
  if (decision === 'blocked') return `규칙 기반 검사에서 Critical ${counts.critical}건이 확인되어 배포 전 수정이 필요합니다.`
  if (decision === 'caution') return `규칙 기반 검사에서 Warning ${counts.warning}건이 확인되었습니다. 확인 후 배포를 권장합니다.`
  return '규칙 기반 검사에서 배포를 막는 주요 문제가 확인되지 않았습니다.'
}

function createIssueFromCard(card, severity) {
  return normalizeIssueForDisplay({
    category: card.category,
    title: card.title,
    description: card.detail,
    evidence: [card.figmaText ? `Figma: ${card.figmaText}` : '', card.webText ? `Web: ${card.webText}` : ''].filter(Boolean),
    severity,
  })
}

function normalizeIssueForDisplay(issue = {}) {
  return {
    category: issue.category || 'tech',
    title: issue.title || issue.category || '확인 필요 항목',
    description: issue.description || issue.detail || '',
    evidence: Array.isArray(issue.evidence) ? issue.evidence.filter(Boolean).slice(0, 4) : [],
    severity: issue.severity === 'critical' ? 'critical' : issue.severity === 'check' ? 'check' : 'warning',
  }
}

function dedupeIssues(issues) {
  const seen = new Set()
  return issues.filter((issue) => {
    const key = `${issue.title}:${issue.description}`.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
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

function ImagePane({ imageAlt, imageSrc, label, placeholder }) {
  const [failed, setFailed] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const showImage = imageSrc && !failed

  return (
    <section className="comparison-pane" aria-label={label}>
      <div className="comparison-pane-head">
        <strong>{label}</strong>
      </div>
      <div className={`comparison-image-frame mockup-ai-image-frame ${showImage ? '' : 'is-empty'}`}>
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
