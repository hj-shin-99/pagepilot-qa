import OpenAI from 'openai'
import { createAiReviewMessages } from './prompts/aiReviewPrompt.js'
import { createVisualVisionReviewMessages } from './prompts/visualVisionPrompt.js'

const DEFAULT_MODEL = 'gpt-4.1-mini'
const DEFAULT_TIMEOUT_MS = 60000
const VALID_RELEASE_DECISIONS = new Set(['ready', 'caution', 'blocked'])

export function createAiReviewService(options = {}) {
  const apiKey = typeof options.apiKey === 'string' ? options.apiKey.trim() : ''
  const model = typeof options.model === 'string' && options.model.trim() ? options.model.trim() : DEFAULT_MODEL
  const timeout = Number.isFinite(Number(options.timeoutMs)) && Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : DEFAULT_TIMEOUT_MS
  const client = options.client || (apiKey ? new OpenAI({ apiKey, timeout }) : null)

  return {
    async review(payload) {
      if (!client) throw createAiReviewError('missing_api_key', 'OPENAI_API_KEY가 설정되지 않았습니다.', false)

      const startedAt = Date.now()
      let imageInputCount = 0
      try {
        const messages = hasVisionInput(payload) ? createVisualVisionReviewMessages(payload) : createAiReviewMessages(payload)
        imageInputCount = countImageInputs(messages)
        const completion = await client.chat.completions.create({
          model,
          messages,
          response_format: { type: 'json_object' },
          max_completion_tokens: imageInputCount > 0 ? 1800 : 1400,
        })
        const rawText = completion.choices?.[0]?.message?.content || ''
        return {
          meta: {
            openAiCalled: true,
            model,
            visionUsed: imageInputCount > 0,
            imageInputCount,
            visionInputSummary: createVisionInputSummary(payload),
            aiReviewDurationMs: Date.now() - startedAt,
          },
          review: normalizeAiReview(parseJsonObject(rawText), payload),
        }
      } catch (error) {
        if (error?.openAiCalled === true) {
          error.visionUsed = error.visionUsed ?? false
          error.imageInputCount = error.imageInputCount ?? 0
          error.aiReviewDurationMs = error.aiReviewDurationMs ?? Date.now() - startedAt
          throw error
        }
        const wrapped = createAiReviewError('openai_review_failed', error instanceof Error ? error.message : 'AI Review 호출에 실패했습니다.', true)
        wrapped.visionUsed = imageInputCount > 0
        wrapped.imageInputCount = imageInputCount
        wrapped.visionInputSummary = createVisionInputSummary(payload)
        wrapped.aiReviewDurationMs = Date.now() - startedAt
        wrapped.cause = error
        throw wrapped
      }
    },
  }
}

export function normalizeAiReview(value, payload = {}) {
  const input = value && typeof value === 'object' ? value : {}
  const review = {
    releaseDecision: normalizeReleaseDecision(input.releaseDecision),
    summary: normalizeKoreanText(input.summary, createFallbackSummary(payload)),
    mustFix: normalizeIssueArray(input.mustFix, 'critical'),
    verify: normalizeIssueArray(input.verify, 'warning'),
    developerNotes: normalizeIssueArray(input.developerNotes, 'check'),
    visualDifferences: normalizeVisualDifferenceArray(input.visualDifferences, payload),
    clientReplyDraft: normalizeKoreanText(input.clientReplyDraft, createFallbackClientReply(payload)),
  }

  return adjustReviewDecision(review, payload)
}

export function createFallbackAiReview(payload = {}, reason = '') {
  const hasBlocking = hasBlockingEvidence(payload)
  const hasWarnings = hasWarningEvidence(payload)
  return {
    releaseDecision: hasBlocking ? 'blocked' : hasWarnings ? 'caution' : 'ready',
    summary: createFallbackSummary(payload),
    mustFix: hasBlocking ? createFallbackMustFix(payload) : [],
    verify: createFallbackVerify(payload),
    developerNotes: [createIssueObject({ category: 'tech', title: 'AI Review fallback 사용', description: reason || 'AI 응답을 사용하지 못해 규칙 기반 요약으로 대체했습니다.', severity: 'check' })],
    visualDifferences: [],
    clientReplyDraft: createFallbackClientReply(payload),
  }
}

export function parseJsonObject(rawText) {
  const text = typeof rawText === 'string' ? rawText.trim() : ''
  if (!text) throw createAiReviewError('empty_ai_response', 'AI Review 응답이 비어 있습니다.', true)

  try {
    return JSON.parse(text)
  } catch {
    const match = text.match(/\{[\s\S]*\}/)
    if (!match) throw createAiReviewError('invalid_ai_json', 'AI Review 응답 JSON을 찾지 못했습니다.', true)
    return JSON.parse(match[0])
  }
}

function normalizeReleaseDecision(value) {
  const decision = normalizeString(value).toLowerCase()
  return VALID_RELEASE_DECISIONS.has(decision) ? decision : 'caution'
}

function normalizeString(value) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, 1200) : ''
}

function normalizeKoreanText(value, fallback) {
  return normalizeString(value) || fallback
}

function normalizeIssueArray(value, defaultSeverity) {
  if (!Array.isArray(value)) return []
  return dedupeIssues(value.map((item) => normalizeIssue(item, defaultSeverity)).filter(Boolean)).slice(0, 10)
}

function normalizeVisualDifferenceArray(value, payload = {}) {
  if (!Array.isArray(value)) return []
  const normalized = value.map((item, index) => normalizeVisualDifference(item, index, payload)).filter(Boolean)
  return dedupeVisualDifferences(normalized.filter((item) => isUsefulVisualDifference(item, payload)))
    .sort(compareVisualDifferences)
    .slice(0, 6)
    .map(stripInternalVisualDifferenceFields)
}

function normalizeVisualDifference(item, index, payload = {}) {
  if (!item || typeof item !== 'object') return null
  const canonicalPricePair = findCanonicalPricePair(item, payload)
  const rawCategory = canonicalPricePair ? 'Price' : item.category
  const category = normalizeVisualDifferenceCategory(rawCategory)
  const area = canonicalPricePair ? getAreaFromCanonicalEntity(canonicalPricePair.web || canonicalPricePair.figma) : normalizeVisualArea(item.area)
  const figmaValue = normalizeKoreanVisualText(canonicalPricePair?.figma?.text || item.figmaValue || item.figma, category, 'figma')
  const webValue = normalizeKoreanVisualText(canonicalPricePair?.web?.text || item.webValue || item.web, category, 'web')
  const ctaGate = category === 'CTA' ? classifyCtaDifferenceSupport(item, payload) : null
  return {
    area,
    category,
    title: ctaGate?.title || normalizeVisualTitle(item.title, category, area),
    summary: ctaGate?.summary || normalizeVisualSummary(item.summary || item.description, category),
    figmaValue,
    webValue,
    severity: ctaGate?.severity || normalizeSeverity(item.severity),
    confidence: ctaGate?.confidence || normalizeConfidence(item.confidence),
    order: canonicalPricePair ? getCanonicalOrder(canonicalPricePair.web || canonicalPricePair.figma, index) : Number.isFinite(Number(item.order)) ? Number(item.order) : index,
    canonicalEntityKey: canonicalPricePair ? createPricePairKey(canonicalPricePair) : ctaGate?.key || '',
    transientOverlay: isTransientOverlayDifference(item),
  }
}

function normalizeIssue(item, defaultSeverity) {
  if (typeof item === 'string') return createIssueObject({ title: item, description: item, severity: defaultSeverity })
  if (!item || typeof item !== 'object') return null
  return createIssueObject({
    category: item.category,
    title: item.title || item.summary || item.description,
    description: item.description || item.detail || item.title,
    evidence: item.evidence,
    severity: item.severity || defaultSeverity,
  })
}

function createIssueObject({ category = 'tech', title = '', description = '', evidence = [], severity = 'warning' } = {}) {
  const safeEvidence = Array.isArray(evidence) ? evidence.map(normalizeString).filter(Boolean).slice(0, 4) : []
  const resolvedCategory = normalizeCategory(category, `${title} ${description} ${safeEvidence.join(' ')}`)
  return {
    category: resolvedCategory,
    title: normalizeString(title).slice(0, 160),
    description: normalizeString(description).slice(0, 500),
    evidence: safeEvidence,
    severity: normalizeSeverity(severity),
  }
}

function adjustReviewDecision(review, payload) {
  const hasBlocking = hasBlockingEvidence(payload)
  const hasWarnings = hasWarningEvidence(payload)
  const adjusted = { ...review }

  if (adjusted.releaseDecision === 'blocked' && !hasBlocking) adjusted.releaseDecision = hasWarnings ? 'caution' : 'ready'
  if (adjusted.releaseDecision === 'ready' && hasBlocking) adjusted.releaseDecision = 'blocked'
  if (adjusted.releaseDecision === 'ready' && hasWarnings) adjusted.releaseDecision = 'caution'
  if (!hasBlocking) adjusted.mustFix = []
  return adjusted
}

function hasBlockingEvidence(payload = {}) {
  const accessStatus = payload.techEvidence?.access?.status
  const httpStatus = Number(payload.techEvidence?.httpStatus?.value)
  if (accessStatus === 'error') return true
  if (Number.isFinite(httpStatus) && httpStatus >= 400) return true
  if (arrayHasItems(payload.techEvidence?.consoleErrors)) return true
  if (arrayHasItems(payload.visualEvidence?.textDifferences?.filter((item) => item.category === 'numeric' || item.severity === 'critical'))) return true
  if (Number(payload.visualEvidence?.cta?.countDifference || 0) > 0) return true
  return false
}

function hasWarningEvidence(payload = {}) {
  if (hasBlockingEvidence(payload)) return true
  if (arrayHasItems(payload.visualEvidence?.textDifferences)) return true
  if (payload.visualEvidence?.media?.comparisonHint) return true
  return ['brokenLinks', 'metaIssues', 'altIssues', 'externalLinkIssues', 'networkIssues'].some((key) => arrayHasItems(payload.techEvidence?.[key]))
}

function createFallbackSummary(payload = {}) {
  if (hasBlockingEvidence(payload)) return '자동 QA 결과 배포 전에 수정해야 할 차단 이슈가 확인되었습니다. 숫자, 접속, 핵심 CTA 또는 주요 오류를 우선 확인해야 합니다.'
  if (hasWarningEvidence(payload)) return '자동 QA 결과 배포를 막는 명확한 오류는 제한적이지만 확인이 필요한 경고가 있습니다. 문구, SEO, 접근성 또는 미디어 의도 확인 후 배포를 권장합니다.'
  return '자동 QA 결과 기준 배포를 막는 주요 오류가 확인되지 않았습니다. 최종 육안 확인 후 배포할 수 있습니다.'
}

function createFallbackClientReply(payload = {}) {
  if (hasBlockingEvidence(payload)) return '자동 QA 검토 결과, 배포 전 우선 수정이 필요한 항목이 확인되었습니다. 수정 후 동일 기준으로 재검증하겠습니다.'
  if (hasWarningEvidence(payload)) return '자동 QA 검토 결과, 배포 전 확인이 필요한 항목이 일부 확인되었습니다. 의도된 차이인지 확인 후 진행하겠습니다.'
  return '자동 QA 검토 결과, 현재 기준에서 배포를 막는 주요 이슈는 확인되지 않았습니다. 최종 확인 후 진행 가능합니다.'
}

function createFallbackMustFix(payload = {}) {
  const items = []
  const numeric = (payload.visualEvidence?.textDifferences || []).find((item) => item.category === 'numeric')
  if (numeric) items.push(createIssueObject({ category: 'price', title: '숫자/가격 차이 확인 필요', description: 'Figma와 Web의 핵심 숫자 값이 다릅니다.', evidence: [`Figma: ${numeric.figmaText || '-'}`, `Web: ${numeric.webText || '-'}`], severity: 'critical' }))
  if (Number(payload.visualEvidence?.cta?.countDifference || 0) > 0) items.push(createIssueObject({ category: 'cta', title: 'Hero CTA 개수 차이', description: 'Hero CTA 개수가 Figma와 Web에서 다릅니다.', severity: 'critical' }))
  return items.slice(0, 6)
}

function createFallbackVerify(payload = {}) {
  const items = []
  if (payload.visualEvidence?.media?.comparisonHint) items.push(createIssueObject({ category: 'media', title: '이미지/영상 구성 의도 확인', description: 'Figma와 Web의 주요 미디어 구성이 다릅니다.', evidence: [payload.visualEvidence.media.comparisonHint], severity: 'warning' }))
  if (arrayHasItems(payload.techEvidence?.metaIssues)) items.push(createIssueObject({ category: 'seo', title: '메타태그 확인', description: '검색/공유 메타 정보 중 확인이 필요한 항목이 있습니다.', severity: 'warning' }))
  if (arrayHasItems(payload.techEvidence?.altIssues)) items.push(createIssueObject({ category: 'accessibility', title: '이미지 대체 텍스트 확인', description: '의미 있는 이미지 중 alt 확인이 필요한 항목이 있습니다.', severity: 'warning' }))
  return items.slice(0, 8)
}

function normalizeCategory(value, context = '') {
  const category = normalizeString(value).toLowerCase()
  if (category.includes('price') || category.includes('amount') || category.includes('numeric')) return 'Price'
  if (category.includes('cta') || category.includes('button') || category.includes('action') || category.includes('link')) return 'CTA'
  if (category.includes('media') || category.includes('video')) return 'Media'
  if (category.includes('image')) return 'Image'
  if (category.includes('layout')) return 'Layout'
  if (category.includes('missing')) return 'Missing'
  if (category.includes('text') || category.includes('copy')) return 'Text'
  const searchable = normalizeString(context).toLowerCase()
  if (/(가격|금액|월\s*\d|만원|원|납입|납부|할부|%|price|amount|payment|monthly|rate|interest)/i.test(searchable)) return 'Price'
  if (/(cta|button|버튼|링크|href|상담|신청|예약|문의|바로가기|action)/i.test(searchable)) return 'CTA'
  if (/(image|video|media|이미지|영상|비디오|미디어)/i.test(searchable)) return 'Media'
  if (/(문구|텍스트|headline|title|copy|text)/i.test(searchable)) return 'Text'
  if (category.includes('tech') || category.includes('seo') || category.includes('accessibility')) return 'Tech'
  if (/(http|console|network|접속|status|alt|meta|seo|accessibility)/i.test(searchable)) return 'Tech'
  return 'Other'
}

function normalizeVisualDifferenceCategory(value) {
  const category = normalizeString(value).toLowerCase()
  if (category === 'image') return 'Image'
  if (category === 'layout') return 'Layout'
  if (category === 'text') return 'Text'
  if (category === 'cta') return 'CTA'
  if (category === 'price') return 'Price'
  if (category === 'media') return 'Media'
  if (category === 'missing') return 'Missing'
  return 'Layout'
}

function normalizeVisualArea(value) {
  const text = normalizeString(value).slice(0, 80)
  const lower = text.toLowerCase()
  if (/hero|main visual|kv|key visual|메인|히어로/.test(lower)) return '메인 비주얼'
  if (/navigation|nav|gnb|header|헤더|내비/.test(lower)) return '상단 내비게이션'
  if (/footer|legal|푸터|하단/.test(lower)) return '푸터'
  if (/promotion|promo|campaign|offer|benefit|프로모션|혜택/.test(lower)) return 'Product Promotion'
  if (/card|product|series|slide|carousel|swiper|model|vehicle|상품|제품|카드/.test(lower)) return 'Product Card'
  if (/content|section|본문|콘텐츠/.test(lower)) return '페이지 콘텐츠'
  return text || '페이지 콘텐츠'
}

function normalizeVisualTitle(value, category, area) {
  const text = normalizeString(value).slice(0, 160)
  if (text && hasKorean(text) && !isGenericEnglishVisualText(text)) return text
  if (category === 'Media' || category === 'Image') return area === '메인 비주얼' ? '히어로/KV 비주얼이 다릅니다.' : '이미지 콘텐츠가 다릅니다.'
  if (category === 'CTA') return area === '메인 비주얼' ? '히어로 CTA 구성이 다릅니다.' : 'CTA 구성이 다릅니다.'
  if (category === 'Price') return area === 'Product Promotion' || area === 'Product Card' ? '상품 가격 정보가 다릅니다.' : '가격 정보가 다릅니다.'
  if (category === 'Text') return area === '메인 비주얼' ? '히어로 주요 문구가 다릅니다.' : '주요 문구가 다릅니다.'
  if (category === 'Missing') return '주요 콘텐츠 노출이 다릅니다.'
  return '레이아웃 구성이 다릅니다.'
}

function normalizeVisualSummary(value, category) {
  const text = normalizeString(value).slice(0, 500)
  if (text && hasKorean(text) && !isGenericEnglishVisualText(text)) return text
  if (category === 'Media' || category === 'Image') return 'Figma와 Web에서 보이는 주요 시각 콘텐츠가 서로 다릅니다.'
  if (category === 'CTA') return 'Figma와 Web의 CTA 구성 또는 노출 값이 다릅니다.'
  if (category === 'Price') return 'Figma와 Web의 가격 또는 핵심 숫자 값이 다릅니다.'
  if (category === 'Text') return 'Figma와 Web의 주요 문구 값이 다릅니다.'
  if (category === 'Missing') return '한쪽에서 확인되는 주요 콘텐츠가 다른 쪽에는 보이지 않습니다.'
  return 'Figma와 Web의 주요 배치 또는 섹션 구성이 다릅니다.'
}

function normalizeKoreanVisualText(value, category, side) {
  const text = normalizeString(value).slice(0, 500)
  if (!text) return side === 'figma' ? 'Figma에서 확인되지 않음' : 'Web에서 확인되지 않음'
  if (hasKorean(text)) return replaceCommonEnglishTerms(text)
  const replaced = replaceCommonEnglishTerms(text)
  if (hasKorean(replaced)) return replaced
  if (category === 'Media' || category === 'Image') return `${replaced} 시각 콘텐츠`
  if (category === 'CTA') return `${replaced} CTA`
  if (category === 'Price') return `${replaced} 가격 정보`
  if (category === 'Text') return `${replaced} 문구`
  return replaced
}

function replaceCommonEnglishTerms(value) {
  return normalizeString(value)
    .replace(/hero\s*\/\s*kv|hero|key visual|main visual/gi, 'Hero/KV')
    .replace(/vehicle exterior|car exterior|exterior/gi, '차량 외관')
    .replace(/vehicle interior|car interior|interior/gi, '차량 실내')
    .replace(/vehicle|car/gi, '차량')
    .replace(/video/gi, '영상')
    .replace(/image|photo/gi, '이미지')
    .replace(/background/gi, '배경')
    .replace(/person|people/gi, '인물')
    .replace(/product/gi, '제품')
    .replace(/text|headline|copy/gi, '문구')
    .replace(/button/gi, '버튼')
    .replace(/price|amount/gi, '가격')
    .replace(/layout/gi, '레이아웃')
    .replace(/missing/gi, '누락')
}

function normalizeSeverity(value) {
  const severity = normalizeString(value).toLowerCase()
  return ['critical', 'warning', 'check'].includes(severity) ? severity : 'warning'
}

function dedupeIssues(items) {
  const seen = new Set()
  return items.filter((item) => {
    const key = `${item.category}:${item.title}:${item.description}`.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function dedupeVisualDifferences(items) {
  const selected = new Map()
  items.forEach((item) => {
    const key = createVisualDifferenceKey(item)
    const current = selected.get(key)
    if (!current || scoreVisualDifference(item) > scoreVisualDifference(current)) selected.set(key, item)
  })
  return Array.from(selected.values()).sort((first, second) => first.order - second.order)
}

function isUsefulVisualDifference(item, payload = {}) {
  const searchable = `${item.title} ${item.summary} ${item.figmaValue} ${item.webValue}`
  if (item.transientOverlay === true) return false
  if (isMinorVisualDifference(searchable)) return false
  if (item.area === '메인 비주얼' && !hasHeroEvidence(payload) && ['Media', 'Image', 'Text', 'CTA'].includes(item.category)) return false
  if (item.category === 'Text' && normalizeLooseVisualText(item.figmaValue) === normalizeLooseVisualText(item.webValue)) return false
  if (item.category === 'CTA' && !isSupportedCtaDifference(item, payload)) return false
  return true
}

function hasHeroEvidence(payload = {}) {
  const hero = payload.visualEvidence?.hero || {}
  return Array.isArray(hero.sections) && hero.sections.length > 0
    || Number(hero.figmaTextCount || 0) > 0
    || Number(hero.webTextCount || 0) > 0
    || Number(hero.figmaCtaCount || 0) > 0
    || Number(hero.webCtaCount || 0) > 0
    || Number(hero.webPrimaryMediaCount || 0) > 0
}

function isMinorVisualDifference(value) {
  return /minor|spacing|line\s*break|punctuation|whitespace|공백|줄\s*바꿈|줄바꿈|문장부호|마침표|쉼표|미세|자간|matched\s*count|text\s*node\s*count/i.test(String(value || ''))
}

function isSupportedCtaDifference(item, payload = {}) {
  return classifyCtaDifferenceSupport(item, payload).supported === true
}

function createVisualDifferenceKey(item) {
  const area = normalizeLooseVisualText(item.area)
  const category = item.category
  const valueKey = `${normalizeLooseVisualText(item.figmaValue)}:${normalizeLooseVisualText(item.webValue)}`
  if (item.canonicalEntityKey) return `${category}:${item.canonicalEntityKey}`
  if (/메인|hero|kv/.test(area) && (category === 'Media' || category === 'Image')) return 'hero-media'
  if (/메인|hero|kv/.test(area) && category === 'Text') return 'hero-text'
  if (/메인|hero|kv/.test(area) && category === 'CTA') return 'hero-cta'
  if (category === 'Price') return `price:${extractNumericTokens(valueKey).join('|') || valueKey}`
  if (category === 'Layout') return `layout:${area}:${valueKey}`
  return `${area}:${category}:${valueKey}`
}

function findCanonicalPricePair(item, payload = {}) {
  const category = normalizeVisualDifferenceCategory(item.category)
  const searchable = `${item.title || ''} ${item.summary || item.description || ''} ${item.figmaValue || item.figma || ''} ${item.webValue || item.web || ''}`
  if (category !== 'Price' && !/(가격|금액|만원|원|%|monthly|payment|price|amount)/i.test(searchable)) return null
  const prices = Array.isArray(payload.visualEvidence?.prices) ? payload.visualEvidence.prices : []
  const figmaPrices = prices.filter((price) => price.source === 'figma')
  const webPrices = prices.filter((price) => price.source === 'web')
  const figmaText = normalizeLooseVisualText(item.figmaValue || item.figma || searchable)
  const webText = normalizeLooseVisualText(item.webValue || item.web || searchable)
  const figma = figmaPrices.find((price) => valueLooksRelated(figmaText, price.text)) || figmaPrices[0] || null
  const web = webPrices.find((price) => valueLooksRelated(webText, price.text)) || webPrices.find((price) => shareUnitTokens(figma, price)) || webPrices[0] || null
  return figma || web ? { figma, web } : null
}

function valueLooksRelated(searchText, value) {
  const normalized = normalizeLooseVisualText(value)
  if (!searchText || !normalized) return false
  if (searchText.includes(normalized) || normalized.includes(searchText)) return true
  const searchNumbers = extractNumericTokens(searchText).map(normalizeLooseVisualText)
  const valueNumbers = extractNumericTokens(normalized).map(normalizeLooseVisualText)
  return valueNumbers.some((token) => searchNumbers.includes(token))
}

function shareUnitTokens(first, second) {
  const firstUnits = Array.isArray(first?.unitTokens) ? first.unitTokens : []
  const secondUnits = Array.isArray(second?.unitTokens) ? second.unitTokens : []
  return firstUnits.some((unit) => secondUnits.includes(unit))
}

function getAreaFromCanonicalEntity(entity = {}) {
  const text = `${entity.sectionPath || ''} ${entity.sectionRootId || ''} ${entity.role || ''}`.toLowerCase()
  if (/footer|legal|copyright|푸터/.test(text)) return 'Footer'
  if (/nav|navigation|header|gnb|menu/.test(text)) return 'Navigation'
  if (/hero|main.?visual|key.?visual|\bkv\b/.test(text)) return '메인 비주얼'
  if (/promotion|promo|campaign|offer|benefit|프로모션|혜택/.test(text)) return 'Product Promotion'
  if (/product|card|tile|series|slide|carousel|swiper|model|vehicle|상품|제품/.test(text)) return 'Product Card'
  return 'Page Content'
}

function getCanonicalOrder(entity = {}, fallback) {
  const yRatio = Number(entity.yRatio)
  return Number.isFinite(yRatio) && yRatio >= 0 ? yRatio * 100 : fallback
}

function createPricePairKey(pair = {}) {
  const figma = normalizeLooseVisualText(pair.figma?.sectionId || pair.figma?.sectionPath || pair.figma?.text)
  const web = normalizeLooseVisualText(pair.web?.sectionId || pair.web?.sectionPath || pair.web?.text)
  const numbers = extractNumericTokens(`${pair.figma?.text || ''} ${pair.web?.text || ''}`).join('|')
  return `price:${figma}:${web}:${numbers}`
}

function classifyCtaDifferenceSupport(item, payload = {}) {
  const confidence = normalizeConfidence(item.confidence)
  if (confidence === 'low') return { supported: false }
  const cta = payload.visualEvidence?.cta || {}
  const figmaActions = Array.isArray(cta.figmaActions) ? cta.figmaActions : []
  const webActions = Array.isArray(cta.webActions) ? cta.webActions : []
  if (Number(cta.countDifference || 0) > 0) return { supported: true, key: 'cta-count' }
  const rawFigma = normalizeLooseVisualText(item.figmaValue || item.figma)
  const rawWeb = normalizeLooseVisualText(item.webValue || item.web)
  if (looksLikeCtaListValue(item.figmaValue || item.figma) || looksLikeCtaListValue(item.webValue || item.web)) {
    return createUncertainCtaGate()
  }
  const candidatePairs = []
  figmaActions.forEach((figmaAction, figmaIndex) => {
    webActions.forEach((webAction, webIndex) => {
      const score = scoreCtaPair(figmaAction, webAction, figmaIndex, webIndex)
      if (score >= 5) candidatePairs.push({ figmaAction, webAction, score })
    })
  })
  const supportedPair = candidatePairs.find((pair) => {
    const figmaText = normalizeLooseVisualText(pair.figmaAction.text)
    const webText = normalizeLooseVisualText(pair.webAction.text)
    return (!rawFigma || rawFigma.includes(figmaText) || figmaText.includes(rawFigma))
      && (!rawWeb || rawWeb.includes(webText) || webText.includes(rawWeb))
  })
  if (supportedPair) return { supported: true, key: `cta:${normalizeLooseVisualText(supportedPair.figmaAction.sectionId || supportedPair.figmaAction.sectionPath)}:${normalizeLooseVisualText(supportedPair.figmaAction.text)}:${normalizeLooseVisualText(supportedPair.webAction.text)}` }
  if (figmaActions.length > 0 && webActions.length > 0 && confidence !== 'low') {
    return createUncertainCtaGate()
  }
  return { supported: false }
}

function createUncertainCtaGate() {
  return {
    supported: true,
    severity: 'check',
    confidence: 'medium',
    title: 'CTA 구성 확인이 필요합니다.',
    summary: 'Figma와 Web의 CTA 목록은 다르지만 명확한 1:1 대응 관계가 부족해 구성 확인 항목으로 분류했습니다.',
    key: 'cta-uncertain-composition',
  }
}

function looksLikeCtaListValue(value) {
  const text = normalizeString(value)
  if (!text) return false
  return (text.includes('/') || text.includes(',') || text.includes('[') || text.includes(']')) && text.length >= 12
}

function scoreCtaPair(figmaAction = {}, webAction = {}, figmaIndex, webIndex) {
  let score = 0
  if (figmaAction.sectionId && webAction.sectionId && normalizeComparableSection(figmaAction.sectionId) === normalizeComparableSection(webAction.sectionId)) score += 2
  if (sameBroadArea(figmaAction, webAction)) score += 1
  if (figmaAction.role && webAction.role && figmaAction.role === webAction.role) score += 1
  if (figmaAction.href && webAction.href && normalizeHrefPurpose(figmaAction.href) === normalizeHrefPurpose(webAction.href)) score += 2
  if (Number.isFinite(Number(figmaAction.yRatio)) && Number.isFinite(Number(webAction.yRatio)) && Math.abs(Number(figmaAction.yRatio) - Number(webAction.yRatio)) <= 0.04) score += 1
  if (Number.isFinite(Number(figmaAction.xRatio)) && Number.isFinite(Number(webAction.xRatio)) && Math.abs(Number(figmaAction.xRatio) - Number(webAction.xRatio)) <= 0.08) score += 1
  if (figmaIndex === webIndex) score += 1
  if (normalizeLooseVisualText(figmaAction.text) === normalizeLooseVisualText(webAction.text)) score += 2
  return score
}

function normalizeComparableSection(value) {
  return normalizeLooseVisualText(String(value || '').replace(/figma|web/g, ''))
}

function sameBroadArea(first = {}, second = {}) {
  return getAreaFromCanonicalEntity(first) === getAreaFromCanonicalEntity(second)
}

function normalizeHrefPurpose(value) {
  try {
    const url = new URL(String(value || ''), 'https://example.test')
    return url.pathname.replace(/\d+/g, ':id').replace(/\/+$/g, '')
  } catch {
    return normalizeLooseVisualText(value)
  }
}

function isTransientOverlayDifference(item = {}) {
  const text = `${item.area || ''} ${item.category || ''} ${item.title || ''} ${item.summary || item.description || ''} ${item.figmaValue || item.figma || ''} ${item.webValue || item.web || ''}`
  const hasOverlay = /(cookie|consent|privacy|preference|modal|dialog|popup|overlay|쿠키|동의|개인정보|팝업|모달|오버레이|환경설정)/i.test(text)
  const hasCoreDesignEvidence = /(figma.*dialog|dialog.*figma|modal.*figma|시안.*팝업|팝업.*시안)/i.test(text) && /(web|figma|양쪽|both)/i.test(text)
  return hasOverlay && !hasCoreDesignEvidence
}

function compareVisualDifferences(first, second) {
  const orderDiff = Number(first.order || 0) - Number(second.order || 0)
  if (orderDiff !== 0) return orderDiff
  const categoryOrder = { Text: 1, CTA: 2, Media: 3, Image: 3, Price: 4, Layout: 5, Missing: 6, Other: 7 }
  return (categoryOrder[first.category] || 99) - (categoryOrder[second.category] || 99)
}

function stripInternalVisualDifferenceFields(item) {
  const result = { ...item }
  delete result.canonicalEntityKey
  delete result.transientOverlay
  return result
}

function scoreVisualDifference(item) {
  const confidenceScore = { high: 30, medium: 20, low: 10 }[item.confidence] || 0
  const severityScore = { critical: 20, warning: 12, check: 4 }[item.severity] || 0
  const koreanScore = hasKorean(`${item.title} ${item.summary} ${item.figmaValue} ${item.webValue}`) ? 10 : 0
  return confidenceScore + severityScore + koreanScore + Math.min(20, `${item.summary} ${item.figmaValue} ${item.webValue}`.length / 50)
}

function normalizeLooseVisualText(value) {
  return normalizeString(value).toLowerCase().replace(/(?:\s|\u00a0|\u200b|\u200c|\u200d|[.,:;!?"'“”‘’()[\]{}<>_/\\-])/g, '')
}

function extractNumericTokens(value) {
  return String(value || '').match(/\d+(?:[.,]\d+)?\s*(?:%|원|만원|개월|년)?/g) || []
}

function hasKorean(value) {
  return /[가-힣]/.test(String(value || ''))
}

function isGenericEnglishVisualText(value) {
  return /headline text mismatch|hero media type mismatch|minor spacing|cta role swap|layout mismatch|image mismatch/i.test(String(value || ''))
}

function normalizeConfidence(value) {
  const confidence = normalizeString(value).toLowerCase()
  return ['high', 'medium', 'low'].includes(confidence) ? confidence : 'medium'
}

function hasVisionInput(payload = {}) {
  return getVisionImages(payload).length > 0
}

function countImageInputs(messages = []) {
  return messages.reduce((count, message) => {
    if (!Array.isArray(message.content)) return count
    return count + message.content.filter((part) => part?.type === 'image_url' && part.image_url?.url).length
  }, 0)
}

function createVisionInputSummary(payload = {}) {
  return getVisionImages(payload).map((image) => ({
    label: normalizeString(image.label).slice(0, 80) || 'image',
    width: Number(image.width || 0),
    height: Number(image.height || 0),
    detail: ['low', 'high', 'auto'].includes(image.detail) ? image.detail : 'auto',
  }))
}

function getVisionImages(payload = {}) {
  const images = payload.visionInput?.images
  if (Array.isArray(images)) return images.filter((image) => image?.dataUrl)
  if (images && typeof images === 'object') return Object.entries(images).map(([label, image]) => ({ label, ...(image || {}) })).filter((image) => image?.dataUrl)
  return []
}

function arrayHasItems(value) {
  return Array.isArray(value) && value.length > 0
}

function createAiReviewError(code, message, openAiCalled) {
  const error = new Error(message)
  error.code = code
  error.openAiCalled = openAiCalled
  return error
}
