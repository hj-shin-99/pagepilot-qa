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
    visualDifferences: normalizeVisualDifferenceArray(input.visualDifferences),
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

function normalizeVisualDifferenceArray(value) {
  if (!Array.isArray(value)) return []
  return dedupeVisualDifferences(value.map(normalizeVisualDifference).filter(Boolean)).slice(0, 10)
}

function normalizeVisualDifference(item, index) {
  if (!item || typeof item !== 'object') return null
  const category = normalizeVisualDifferenceCategory(item.category)
  return {
    area: normalizeString(item.area).slice(0, 80) || 'Page Content',
    category,
    title: normalizeString(item.title).slice(0, 160) || `${category} 차이 확인`,
    summary: normalizeString(item.summary || item.description).slice(0, 500),
    figmaValue: normalizeString(item.figmaValue || item.figma).slice(0, 500),
    webValue: normalizeString(item.webValue || item.web).slice(0, 500),
    severity: normalizeSeverity(item.severity),
    confidence: normalizeConfidence(item.confidence),
    order: Number.isFinite(Number(item.order)) ? Number(item.order) : index,
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
  return {
    category: normalizeCategory(category),
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

function normalizeCategory(value) {
  const category = normalizeString(value).toLowerCase()
  return ['price', 'text', 'cta', 'media', 'tech', 'seo', 'accessibility'].includes(category) ? category : 'tech'
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
  const seen = new Set()
  return items.filter((item) => {
    const key = `${item.area}:${item.category}:${item.title}:${item.figmaValue}:${item.webValue}`.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function normalizeConfidence(value) {
  const confidence = normalizeString(value).toLowerCase()
  return ['high', 'medium', 'low'].includes(confidence) ? confidence : 'medium'
}

function hasVisionInput(payload = {}) {
  return Boolean(payload.visionInput?.images?.figma?.dataUrl && payload.visionInput?.images?.web?.dataUrl)
}

function countImageInputs(messages = []) {
  return messages.reduce((count, message) => {
    if (!Array.isArray(message.content)) return count
    return count + message.content.filter((part) => part?.type === 'image_url' && part.image_url?.url).length
  }, 0)
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
