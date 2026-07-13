import OpenAI from 'openai'
import { createAiReviewMessages } from './prompts/aiReviewPrompt.js'

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

      try {
        const completion = await client.chat.completions.create({
          model,
          messages: createAiReviewMessages(payload),
          response_format: { type: 'json_object' },
          max_completion_tokens: 1400,
        })
        const rawText = completion.choices?.[0]?.message?.content || ''
        return {
          meta: { openAiCalled: true, model },
          review: normalizeAiReview(parseJsonObject(rawText)),
        }
      } catch (error) {
        if (error?.openAiCalled === true) throw error
        const wrapped = createAiReviewError('openai_review_failed', error instanceof Error ? error.message : 'AI Review 호출에 실패했습니다.', true)
        wrapped.cause = error
        throw wrapped
      }
    },
  }
}

export function normalizeAiReview(value) {
  const input = value && typeof value === 'object' ? value : {}
  return {
    releaseDecision: normalizeReleaseDecision(input.releaseDecision),
    summary: normalizeString(input.summary),
    mustFix: normalizeStringArray(input.mustFix),
    verify: normalizeStringArray(input.verify),
    developerNotes: normalizeStringArray(input.developerNotes),
    clientReplyDraft: normalizeString(input.clientReplyDraft),
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

function normalizeStringArray(value) {
  if (!Array.isArray(value)) return []
  return value.map((item) => normalizeString(item)).filter(Boolean).slice(0, 10)
}

function normalizeString(value) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, 1200) : ''
}

function createAiReviewError(code, message, openAiCalled) {
  const error = new Error(message)
  error.code = code
  error.openAiCalled = openAiCalled
  return error
}
