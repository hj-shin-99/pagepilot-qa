import { useEffect, useState } from 'react'
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
import { createVisualDisplayIssues } from '../utils/visualDisplayIssues.js'
import { createCoreVisualIssues } from '../utils/visualDisplayHierarchy.js'
import { createVisualIssueGroups } from '../utils/visualIssueGroups.js'
import { createVisualQaTitle } from '../utils/visualTitle'

function VisualQaPanel({ result, aiReview, aiReviewState = 'idle', pageTitle }) {
  const cards = createVisualIssueCards(result)
  const meta = result.meta || {}
  const aiHints = result.aiHints || {}
  const comparison = result.comparison || {}
  const hero = createHeroSummary(aiHints)
  const media = createMediaSummary(aiHints)
  const figmaImage = createFigmaImageUrl(result.figma)
  const webImage = createWebDisplayImageUrl(result.web)
  const displayIssues = createVisualDisplayIssues(result, aiReview)
  const coreIssues = createCoreVisualIssues(displayIssues)
  const coreIssueGroups = createVisualIssueGroups(coreIssues, { mergeReadableAreas: true })
  const fullIssueGroups = createVisualIssueGroups(displayIssues)
  const displayMeta = displayIssues.meta || {}
  const coreMeta = coreIssues.meta || {}
  const coreGroupMeta = coreIssueGroups.meta || {}
  const fullGroupMeta = fullIssueGroups.meta || {}
  const coreCategoryCounts = coreMeta.coreCategoryCounts || {}
  const differenceMeta = displayMeta.finalReportMeta || {}
  const visualTitle = createVisualQaTitle({ pageTitle, result })

  useEffect(() => {
    console.info(`[Visual QA Display Issues] finalReportItems=${displayMeta.finalReportItemCount} comparisonDifferences=${displayMeta.comparisonDifferenceCount} aiVisualDifferences=${displayMeta.aiVisualDifferenceCount} ctaEvidence=${displayMeta.ctaEvidenceCount} mediaEvidence=${displayMeta.mediaEvidenceCount} priceNumericEvidence=${displayMeta.priceNumericEvidenceCount} candidates=${displayMeta.candidateCount} uiCount=${displayIssues.length} coreCount=${coreIssues.length} fullDisplayedCount=${fullGroupMeta.groupedIssueCount} exactDuplicateRemoved=${fullGroupMeta.duplicateIssueCount} excludedFromCore=${coreMeta.excludedFromCoreCount} coreCta=${coreCategoryCounts.cta || 0} coreMedia=${coreCategoryCounts.media || 0} corePrice=${coreCategoryCounts.price || 0} coreText=${coreCategoryCounts.text || 0} engineDataDeleted=0 fullGroupCount=${fullGroupMeta.groupCount} rawVisionCount=${differenceMeta.rawVisionCount} canonicalSupplementCount=${differenceMeta.canonicalSupplementCount} mergedCount=${differenceMeta.mergedCount} dedupedCount=${differenceMeta.dedupedCount} invalidIssueDroppedCount=${differenceMeta.invalidIssueDroppedCount} crossCategoryMergeRejectedCount=${differenceMeta.crossCategoryMergeRejectedCount}`)
  }, [displayIssues.length, coreIssues.length, displayMeta.finalReportItemCount, displayMeta.comparisonDifferenceCount, displayMeta.aiVisualDifferenceCount, displayMeta.ctaEvidenceCount, displayMeta.mediaEvidenceCount, displayMeta.priceNumericEvidenceCount, displayMeta.candidateCount, fullGroupMeta.groupCount, fullGroupMeta.groupedIssueCount, fullGroupMeta.duplicateIssueCount, coreMeta.excludedFromCoreCount, coreCategoryCounts.cta, coreCategoryCounts.media, coreCategoryCounts.price, coreCategoryCounts.text, differenceMeta.rawVisionCount, differenceMeta.canonicalSupplementCount, differenceMeta.mergedCount, differenceMeta.dedupedCount, differenceMeta.invalidIssueDroppedCount, differenceMeta.crossCategoryMergeRejectedCount])

  return (
    <section className="section-stack visual-qa-panel" aria-label="Visual QA 결과">
      <header className="audit-header visual-audit-header">
        <div className="audit-header-top">
          <div>
            <p className="eyebrow">Visual QA Report · {formatDate(meta.createdAt)}</p>
            <h2>{visualTitle}</h2>
            <p className="target-url">{meta.webUrl}</p>
          </div>
        </div>
        <div className="summary-box">{formatIssueCountSummary(coreGroupMeta.groupedIssueCount ?? coreIssues.length)}</div>
      </header>

      <AiMultimodalComplete aiReview={aiReview} />

      <article className="detail-card visual-image-card-primary">
        <div className="section-title-row">
          <div>
            <h3>Figma / Web 이미지 비교</h3>
            <p className="panel-note relaxed-note">왼쪽은 Figma render, 오른쪽은 Web screenshot입니다. 이미지를 클릭하면 새 탭에서 원본을 확인할 수 있습니다.</p>
          </div>
        </div>
        <div className="visual-comparison-viewport">
          <div className="visual-comparison-columns">
            <ImagePane imageAlt="Figma render" imageSrc={figmaImage} label="Figma" placeholder="Figma render 이미지가 없습니다." />
            <ImagePane imageAlt="Web screenshot" imageSrc={webImage} label="Web" placeholder="Web screenshot 이미지가 없습니다." />
          </div>
        </div>
      </article>

      <article className="detail-card difference-list-card">
        <div className="section-title-row">
          <div>
            <h3>핵심 차이</h3>
            <p className="panel-note relaxed-note">실무자가 먼저 확인해야 하는 차이만 표시합니다. 전체 근거는 아래에서 모두 확인할 수 있습니다.</p>
          </div>
          <span>{formatGroupIssueCount(coreIssueGroups.length, coreGroupMeta.groupedIssueCount ?? coreIssues.length)}</span>
        </div>
        <IssueGroupList groups={coreIssueGroups} />
      </article>

      <details className="detail-card full-findings-accordion">
        <summary>
          <span>전체 발견 항목 보기</span>
          <strong>{formatGroupIssueCount(fullIssueGroups.length, fullGroupMeta.groupedIssueCount ?? displayIssues.length)}</strong>
        </summary>
        <div className="full-findings-body">
          <IssueGroupList groups={fullIssueGroups} compact />
        </div>
      </details>

      <details className="detail-card visual-detail-accordion">
        <summary>
          <span>상세 분석 보기</span>
          <strong>Hero · CTA · Price · Media · Text · System</strong>
        </summary>

        <div className="visual-detail-stack">
          <DetailAccordion title="AI 멀티모달 분석" note="최종 검토 요약">
            <AiVisionSummary aiReview={aiReview} state={aiReviewState} finalIssueCount={displayIssues.length} />
          </DetailAccordion>

          <DetailAccordion title="Hero" note="핵심 영역 요약">
            <KeyValue label="Figma Hero Text" value={hero.figmaTextCount} />
            <KeyValue label="Web Hero Text" value={hero.webTextCount} />
            <KeyValue label="CTA Count" value={`Figma ${hero.figmaCtaCount} / Web ${hero.webCtaCount}`} />
            <KeyValue label="대표 Media" value={`Figma ${formatList(hero.figmaMediaTypes)} / Web ${formatList(hero.webMediaTypes)}`} />
          </DetailAccordion>

          <DetailAccordion title="CTA" note="Primary/Secondary CTA만 표시">
            <EntityList items={createActionItems(aiHints)} emptyText="표시할 핵심 CTA가 없습니다." />
            <OtherInteractions items={createOtherInteractionItems(aiHints)} />
          </DetailAccordion>

          <DetailAccordion title="Price / Numeric" note="금액/숫자 후보">
            <EntityList items={createPriceItems(aiHints, comparison)} emptyText="수집된 가격/금액 후보가 없습니다." />
          </DetailAccordion>

          <DetailAccordion title="Media" note="Hero primary media와 주요 개수">
            <KeyValue label="Hero Media" value={media.comparisonText} />
            <KeyValue label="Content Media" value={`Figma 이미지 ${media.counts.figmaImage} / Web 이미지 ${media.counts.webImage} / Web 영상 ${media.counts.webVideo}`} />
            <EntityList items={media.heroPrimary} emptyText="Hero primary media가 없습니다." />
          </DetailAccordion>

          <DetailAccordion title="Text" note="문구 비교 요약">
            <KeyValue label="Matched" value={comparison.matchedCount} />
            <KeyValue label="Different" value={comparison.differenceCount} />
            <KeyValue label="Figma Only" value={comparison.figmaOnlyCount} />
            <KeyValue label="Web Only" value={comparison.webOnlyCount} />
            <EntityList items={createDifferenceItems(comparison)} emptyText="문구 차이가 없습니다." />
          </DetailAccordion>

          <DetailAccordion title="System" note="시스템 메타">
            <KeyValue label="OpenAI 호출" value={aiReview?.meta?.openAiCalled === true ? '있음' : '없음'} />
            <KeyValue label="이미지 분석" value={aiReview?.meta?.visionUsed === true ? '사용' : '미사용'} />
            <KeyValue label="Image Inputs" value={aiReview?.meta?.imageInputCount} />
            <KeyValue label="Fallback" value={aiReview?.meta?.fallbackUsed === true ? '있음' : '없음'} />
            <KeyValue label="Payload Version" value={meta.payloadVersion} />
            <KeyValue label="Playwright Runs" value={meta.playwrightRunCount} />
          </DetailAccordion>
        </div>
      </details>

      <details className="detail-card developer-info-accordion">
        <summary>
          <span>개발 정보</span>
          <strong>Raw · Canonical · Merge · Cache</strong>
        </summary>
        <div className="visual-section-body developer-info-body">
          <KeyValue label="Final Report Items" value={displayMeta.finalReportItemCount} />
          <KeyValue label="Comparison Differences" value={displayMeta.comparisonDifferenceCount} />
          <KeyValue label="AI Visual Differences" value={displayMeta.aiVisualDifferenceCount} />
          <KeyValue label="CTA Evidence" value={displayMeta.ctaEvidenceCount} />
          <KeyValue label="Media Evidence" value={displayMeta.mediaEvidenceCount} />
          <KeyValue label="Price/Numeric Evidence" value={displayMeta.priceNumericEvidenceCount} />
          <KeyValue label="Display Candidates" value={displayMeta.candidateCount} />
          <KeyValue label="Display Groups" value={fullGroupMeta.groupCount} />
          <KeyValue label="Grouped Issue Count" value={fullGroupMeta.groupedIssueCount} />
          <KeyValue label="Exact Duplicate Removed" value={fullGroupMeta.duplicateIssueCount} />
          <KeyValue label="Core Issue Count" value={coreIssues.length} />
          <KeyValue label="Core Candidate Count" value={coreMeta.coreCandidateCount} />
          <KeyValue label="Core After Semantic Dedupe" value={coreMeta.coreAfterSemanticDedupeCount} />
          <KeyValue label="Core Group Count" value={coreGroupMeta.groupCount} />
          <KeyValue label="Core Group Internal Issue Count" value={coreGroupMeta.groupedIssueCount} />
          <KeyValue label="Excluded From Core" value={coreMeta.excludedFromCoreCount} />
          <KeyValue label="Core Semantic Duplicate Removed" value={coreMeta.semanticDuplicateRemovedCount} />
          <KeyValue label="Merged Readable Area Groups" value={coreGroupMeta.mergedReadableAreaGroupCount} />
          <KeyValue label="Core CTA / Media / Price / Text" value={formatCoreCategoryCounts(coreCategoryCounts)} />
          <KeyValue label="Core Excluded Reasons" value={formatExcludedReasonCounts(coreMeta.excludedReasonCounts)} />
          <KeyValue label="Engine Data Deleted" value="0" />
          <KeyValue label="Raw Vision Count" value={differenceMeta.rawVisionCount} />
          <KeyValue label="Canonical Supplement Count" value={differenceMeta.canonicalSupplementCount} />
          <KeyValue label="Merged Count" value={differenceMeta.mergedCount} />
          <KeyValue label="Deduped Count" value={differenceMeta.dedupedCount} />
          <KeyValue label="UI 표시 개수" value={displayIssues.length} />
          <KeyValue label="Invalid Issue Dropped Count" value={differenceMeta.invalidIssueDroppedCount} />
          <KeyValue label="Cross Category Merge Rejected Count" value={differenceMeta.crossCategoryMergeRejectedCount} />
          <KeyValue label="Rule Source Items" value={cards.length} />
          <KeyValue label="Figma Cache" value={meta.figmaCacheSource} />
          <KeyValue label="Figma Render Cache" value={meta.figmaRenderCacheSource} />
          <KeyValue label="처리 시간" value={formatDuration(aiReview?.meta?.aiReviewDurationMs)} />
        </div>
      </details>
    </section>
  )
}

function AiMultimodalComplete({ aiReview }) {
  const meta = aiReview?.meta || {}
  return (
    <article className="detail-card ai-multimodal-complete">
      <div className="section-title-row">
        <div>
          <h3>AI 멀티모달 검증 완료</h3>
          <p className="panel-note relaxed-note">AI 멀티모달이 Figma 시안과 Web 화면을 교차 검토하여 최종 차이를 분석했습니다.</p>
        </div>
      </div>
      <ol className="ai-complete-steps" aria-label="AI 멀티모달 검증 완료 단계">
        <li>Playwright 수집 완료</li>
        <li>Figma API 비교 완료</li>
        <li>Canonical 2차 검증 완료</li>
        <li>AI 멀티모달 최종 검토 완료</li>
      </ol>
      <div className="ai-complete-meta">
        <KeyValue label="모델" value={meta.model || (meta.openAiCalled ? '사용' : '미사용')} />
        <KeyValue label="처리 시간" value={formatDuration(meta.aiReviewDurationMs)} />
      </div>
    </article>
  )
}

function AiVisionSummary({ aiReview, state, finalIssueCount }) {
  const review = aiReview?.review || null
  const meta = aiReview?.meta || {}

  if (state === 'loading') {
    return <p className="visual-detail-section panel-note relaxed-note">AI 멀티모달 검토 중입니다.</p>
  }

  if (!review && state !== 'fallback') {
    return <p className="visual-detail-section empty-row">AI 분석 요약이 없습니다.</p>
  }

  return (
    <section className="visual-detail-section">
      <div className="section-title-row">
        <div>
          <h3>AI 분석 요약</h3>
          <p className="panel-note relaxed-note">AI 처리 정보만 간단히 표시합니다.</p>
        </div>
        <span>{meta.visionUsed ? `${meta.imageInputCount || 0}장` : '이미지 분석 미사용'}</span>
      </div>
      <p className="visual-raw-summary">{formatIssueCountSummary(finalIssueCount)}</p>
      <div className="ai-summary-grid">
        <div className="visual-key-value">
          <span>처리 모델</span>
          <strong>{meta.model || (meta.openAiCalled ? '사용' : '미사용')}</strong>
        </div>
        <div className="visual-key-value">
          <span>처리 시간</span>
          <strong>{meta.aiReviewDurationMs ? `${meta.aiReviewDurationMs}ms` : '-'}</strong>
        </div>
        <div className="visual-key-value">
          <span>이미지 입력</span>
          <strong>{meta.imageInputCount ?? 0}장</strong>
        </div>
        <div className="visual-key-value">
          <span>Fallback</span>
          <strong>{meta.fallbackUsed ? '있음' : '없음'}</strong>
        </div>
        <div className="visual-key-value">
          <span>최종 차이 개수</span>
          <strong>{formatValue(finalIssueCount)}</strong>
        </div>
      </div>
    </section>
  )
}

function IssueGroupList({ groups = [], compact = false }) {
  if (!groups.length) return <p className="empty-row">표시할 다른 부분이 없습니다.</p>

  return (
    <ol className={`issue-group-list ${compact ? 'is-compact' : ''}`}>
      {groups.map((group, index) => (
        <li className="issue-group-card" key={group.id || `${group.label}-${index}`}>
          <div className="issue-group-header">
            <span className="issue-group-index">{String(index + 1).padStart(2, '0')}</span>
            <div>
              <strong>{group.label}</strong>
              <span>{group.items.length}개 차이</span>
            </div>
          </div>
          <ol className="issue-group-items">
            {group.items.map((item, itemIndex) => <IssueGroupItem compact={compact} item={item} key={item.groupItemId || item.id || `${item.categoryLabel}-${item.title}-${itemIndex}`} />)}
          </ol>
        </li>
      ))}
    </ol>
  )
}

function IssueGroupItem({ item, compact = false }) {
  return (
    <li className={`issue-group-item ${compact ? 'is-compact' : ''} ${getDifferenceCategoryClass(item)}`}>
      <div className="issue-group-item-main">
        <div className="difference-meta-row">
              <span className="difference-category-chip">{item.displayCategoryLabel || item.categoryLabel}</span>
        </div>
        <strong>{item.title}</strong>
        {shouldShowDifferenceDescription(item) ? <p>{item.description}</p> : null}
      </div>
      {item.figmaValue || item.webValue ? (
        <dl className="difference-values issue-group-values">
          <div>
            <dt>Figma</dt>
            <dd>{formatValue(item.figmaValue)}</dd>
          </div>
          <div>
            <dt>Web</dt>
            <dd>{formatValue(item.webValue)}</dd>
          </div>
        </dl>
      ) : null}
    </li>
  )
}

function DetailAccordion({ title, note, children }) {
  return (
    <details className="visual-sub-accordion">
      <summary>
        <span>{title}</span>
        <small>{note}</small>
      </summary>
      <div className="visual-section-body">{children}</div>
    </details>
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

function formatDuration(value) {
  const ms = Number(value)
  if (!Number.isFinite(ms) || ms <= 0) return '-'
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}초` : `${Math.round(ms)}ms`
}

function getDifferenceCategoryClass(item = {}) {
  const value = `${item.category || ''} ${item.categoryLabel || ''}`.toLowerCase()
  const displayCategory = `${item.displayCategory || ''} ${item.displayCategoryLabel || ''}`.toLowerCase()
  if (/cta|button|action/.test(displayCategory)) return 'is-cta'
  if (/media|image|kv|video/.test(displayCategory)) return 'is-media'
  if (/price|numeric|amount/.test(displayCategory)) return 'is-price'
  if (/missing|count/.test(displayCategory)) return 'is-missing'
  if (/text/.test(displayCategory)) return 'is-text'
  if (/cta|button|action/.test(value)) return 'is-cta'
  if (/media|image|kv|video/.test(value)) return 'is-media'
  if (/price|numeric|amount/.test(value)) return 'is-price'
  if (/missing|count/.test(value)) return 'is-missing'
  return 'is-text'
}

function shouldShowDifferenceDescription(item = {}) {
  const description = String(item.description || '').trim()
  if (!description) return false
  const title = String(item.title || '').trim()
  if (description === title) return false
  if (description === String(item.figmaValue || '').trim() || description === String(item.webValue || '').trim()) return false
  return !/^figma와 web/i.test(description) || description.length > 28
}

function formatIssueCountSummary(count) {
  const safeCount = Number.isFinite(Number(count)) ? Number(count) : 0
  return safeCount > 0 ? `Figma 시안과 Web 페이지에서 ${safeCount}개의 차이를 확인했습니다.` : 'Figma 시안과 Web 페이지에서 확인된 차이가 없습니다.'
}

function formatGroupIssueCount(groupCount, issueCount) {
  const safeGroupCount = Number.isFinite(Number(groupCount)) ? Number(groupCount) : 0
  const safeIssueCount = Number.isFinite(Number(issueCount)) ? Number(issueCount) : 0
  return `${safeGroupCount}개 영역 · ${safeIssueCount}개 항목`
}

function formatCoreCategoryCounts(counts = {}) {
  return `CTA ${counts.cta || 0} / Media ${counts.media || 0} / Price ${counts.price || 0} / Text ${counts.text || 0}`
}

function formatExcludedReasonCounts(counts = {}) {
  return `low-value ${counts['low-value-text'] || 0} / ordinal ${counts['ordinal-only'] || 0} / duplicate ${counts['semantic-duplicate'] || 0} / non-core ${counts['non-core'] || 0} / invalid ${counts.invalid || 0}`
}

function formatDate(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

export default VisualQaPanel
