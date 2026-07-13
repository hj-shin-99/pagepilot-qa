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
  const summaryTitle = meta.openAiCalled === true ? 'AI Review' : '분석 요약'

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
        <div className="summary-box">{summary}</div>
        {copyStatus ? <p className="copy-status">{copyStatus}</p> : null}
      </header>

      <AiReviewPanel aiReview={aiReview} state={aiReviewState} />

      <section className="visual-severity-grid" aria-label="Visual QA 상태 카드">
        <SeverityCard label="Critical" value={counts.critical} tone="critical" description="핵심 숫자, Hero 문구, CTA 누락" />
        <SeverityCard label="Warning" value={counts.warning} tone="warning" description="CTA/문구/개수 차이" />
        <SeverityCard label="Check" value={counts.check} tone="check" description="사람 확인이 필요한 항목" />
      </section>

      <details className="detail-card visual-card-list-card" open>
        <summary>
          <span>Critical / Warning / Check</span>
          <strong>{cards.length}개 항목</strong>
        </summary>
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
      </details>

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

      <article className="detail-card visual-image-card">
        <div className="section-title-row">
          <div>
            <h3>이미지 확인</h3>
            <p className="panel-note relaxed-note">Figma render와 Web screenshot을 높이 제한 영역에서 확인합니다.</p>
          </div>
        </div>
        <div className="compare-scroll-shell visual-compare-shell">
          <div className="compare-grid">
            <ImagePane imageAlt="Figma render" imageSrc={figmaImage} label="Figma" placeholder="Figma render 이미지가 없습니다." />
            <ImagePane imageAlt="Web screenshot" imageSrc={webImage} label="Web" placeholder="Web screenshot 이미지가 없습니다." />
          </div>
        </div>
      </article>

      <section className="visual-two-column">
        <VisualSectionCard title="Difference Summary" note="문구 비교 요약">
          <KeyValue label="Matched" value={comparison.matchedCount} />
          <KeyValue label="Different" value={comparison.differenceCount} />
          <KeyValue label="Figma Only" value={comparison.figmaOnlyCount} />
          <KeyValue label="Web Only" value={comparison.webOnlyCount} />
          <EntityList items={createDifferenceItems(comparison)} emptyText="문구 차이가 없습니다." />
        </VisualSectionCard>

        <VisualSectionCard title={summaryTitle} note="시스템 메타">
          <KeyValue label="OpenAI 호출" value={meta.openAiCalled === true ? '있음' : '없음'} />
          <KeyValue label="Payload Version" value={meta.payloadVersion} />
          <KeyValue label="Playwright Runs" value={meta.playwrightRunCount} />
          <KeyValue label="Figma Cache" value={meta.figmaCacheSource} />
          <KeyValue label="Figma Render Cache" value={meta.figmaRenderCacheSource} />
        </VisualSectionCard>
      </section>
    </section>
  )
}

function AiReviewPanel({ aiReview, state }) {
  const review = aiReview?.review || null
  const meta = aiReview?.meta || {}

  if (state === 'loading') {
    return (
      <article className="detail-card ai-review-card">
        <div className="section-title-row">
          <h3>AI 종합 검토</h3>
          <span>OpenAI 검토 중</span>
        </div>
        <p className="panel-note relaxed-note">규칙 기반 결과를 바탕으로 배포 판단을 생성하고 있습니다.</p>
      </article>
    )
  }

  if (!review) return null

  return (
    <article className={`detail-card ai-review-card ${review.releaseDecision}`}>
      <div className="section-title-row">
        <div>
          <h3>AI 종합 검토</h3>
          <p className="panel-note relaxed-note">규칙 기반 검사 결과와 별도로 OpenAI가 배포 판단을 요약합니다.</p>
        </div>
        <span>{formatDecision(review.releaseDecision)}</span>
      </div>
      <div className="visual-key-value">
        <span>배포 판단</span>
        <strong>{formatDecision(review.releaseDecision)}</strong>
      </div>
      <p className="summary-box">{review.summary}</p>
      <div className="visual-two-column ai-review-columns">
        <AiReviewIssueList title="반드시 수정" items={review.mustFix} emptyText="배포 차단 수정 항목이 없습니다." />
        <AiReviewIssueList title="확인 필요" items={review.verify} emptyText="추가 확인 항목이 없습니다." />
      </div>
      <AiReviewIssueList title="개발 참고" items={review.developerNotes} emptyText="개발 참고 항목이 없습니다." />
      <details className="visual-folded-detail">
        <summary>회신 초안 보기</summary>
        <p className="panel-note relaxed-note">{review.clientReplyDraft || '회신 초안이 없습니다.'}</p>
      </details>
      <div className="visual-key-value">
        <span>OpenAI</span>
        <strong>{meta.openAiCalled ? `사용${meta.model ? ` · ${meta.model}` : ''}` : '미사용'}</strong>
      </div>
      {meta.fallbackUsed ? <p className="panel-note relaxed-note">AI fallback 결과입니다.</p> : null}
    </article>
  )
}

function AiReviewIssueList({ title, items = [], emptyText }) {
  return (
    <section className="visual-section-body">
      <h4>{title}</h4>
      {items.length > 0 ? (
        <ul className="visual-entity-list">
          {items.map((item, index) => (
            <li key={`${title}-${index}-${item.title}`}>
              <strong>{item.title || item.category}</strong>
              <span>{item.description}</span>
              {item.evidence?.length ? <small>{item.evidence.join(' · ')}</small> : null}
            </li>
          ))}
        </ul>
      ) : <p className="empty-row">{emptyText}</p>}
    </section>
  )
}

function formatDecision(value) {
  if (value === 'ready') return 'Ready'
  if (value === 'blocked') return 'Blocked'
  return 'Caution'
}

function SeverityCard({ label, value, tone, description }) {
  return (
    <article className={`metric-card visual-severity-card ${tone}`}>
      <p className="metric-label">{label}</p>
      <p className="metric-value">{value}</p>
      <span>{description}</span>
    </article>
  )
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
