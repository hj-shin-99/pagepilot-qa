import test from 'node:test'
import assert from 'node:assert/strict'
import { createAiReviewService, normalizeAiReview, parseJsonObject } from './aiReviewService.js'

test('AI review service calls OpenAI client exactly once and normalizes structured review', async () => {
  const calls = { create: 0, request: null }
  const service = createAiReviewService({
    client: {
      chat: {
        completions: {
          async create(request) {
            calls.create += 1
            calls.request = request
            return {
              choices: [{
                message: {
                  content: JSON.stringify({
                    releaseDecision: 'blocked',
                    summary: '가격 차이가 확인되어 배포 전 수정이 필요합니다.',
                    mustFix: [{ category: 'price', title: '가격 수정', description: '가격 차이를 수정하세요.', evidence: ['Monthly 47 / 50'], severity: 'critical' }],
                    verify: [{ category: 'media', title: '미디어 확인', description: '이미지/영상 의도 확인', evidence: [], severity: 'warning' }],
                    developerNotes: [{ category: 'tech', title: '데이터 확인', description: 'canonical payload 확인', evidence: [], severity: 'check' }],
                    clientReplyDraft: '가격 차이가 확인되어 수정 후 재검증하겠습니다.',
                  }),
                },
              }],
            }
          },
        },
      },
    },
    model: 'test-model',
  })

  const result = await service.review(createPayload())

  assert.equal(calls.create, 1)
  assert.equal(calls.request.model, 'test-model')
  assert.equal(calls.request.response_format.type, 'json_object')
  assert.equal(calls.request.messages.length, 2)
  assert.equal(result.meta.openAiCalled, true)
  assert.equal(result.meta.visionUsed, false)
  assert.equal(result.meta.imageInputCount, 0)
  assert.equal(Number.isFinite(result.meta.aiReviewDurationMs), true)
  assert.equal(result.review.releaseDecision, 'blocked')
  assert.equal(result.review.mustFix[0].category, 'price')
  assert.deepEqual(Object.keys(result.review).sort(), ['clientReplyDraft', 'developerNotes', 'mustFix', 'releaseDecision', 'summary', 'verify', 'visualDifferences'])
})

test('AI review service sends two images in a single multimodal call when vision input exists', async () => {
  const calls = { create: 0, request: null }
  const service = createAiReviewService({
    client: {
      chat: {
        completions: {
          async create(request) {
            calls.create += 1
            calls.request = request
            return { choices: [{ message: { content: JSON.stringify({ releaseDecision: 'caution', summary: '시각 차이 확인', mustFix: [], verify: [], developerNotes: [], clientReplyDraft: '', visualDifferences: [{ area: 'Main Visual', category: 'Media', title: 'Hero KV 비주얼이 다릅니다.', summary: '이미지 구성이 다릅니다.', figmaValue: 'Hero image', webValue: 'Hero video', severity: 'warning', confidence: 'high', order: 0 }] }) } }] }
          },
        },
      },
    },
  })
  const payload = createPayload()
  payload.visionInput = { enabled: true, images: { figma: { dataUrl: 'data:image/jpeg;base64,AAA' }, web: { dataUrl: 'data:image/jpeg;base64,BBB' } } }

  const result = await service.review(payload)
  const imageParts = calls.request.messages[1].content.filter((item) => item.type === 'image_url')

  assert.equal(calls.create, 1)
  assert.equal(imageParts.length, 2)
  assert.equal(result.meta.openAiCalled, true)
  assert.equal(result.meta.visionUsed, true)
  assert.equal(result.meta.imageInputCount, 2)
  assert.equal(result.review.visualDifferences[0].category, 'Media')
})

test('AI review service marks OpenAI failures as attempted calls', async () => {
  const service = createAiReviewService({
    client: {
      chat: {
        completions: {
          async create() {
            throw new Error('network failed')
          },
        },
      },
    },
  })

  await assert.rejects(
    service.review(createPayload()),
    (error) => error.openAiCalled === true && error.code === 'openai_review_failed' && Number.isFinite(error.aiReviewDurationMs),
  )
})

test('AI review service reports missing API key before calling OpenAI', async () => {
  const service = createAiReviewService({ apiKey: '' })

  await assert.rejects(
    service.review(createPayload()),
    (error) => error.openAiCalled === false && error.code === 'missing_api_key',
  )
})

test('AI review JSON parsing and normalization are robust', () => {
  const parsed = parseJsonObject('prefix {"releaseDecision":"ready","mustFix":["A"]} suffix')
  const normalized = normalizeAiReview({ ...parsed, mustFix: ['A', '', null], verify: 'not-array', releaseDecision: 'unknown' }, createPayload())

  assert.equal(normalized.releaseDecision, 'caution')
  assert.equal(normalized.mustFix[0].title, 'A')
  assert.deepEqual(normalized.verify, [])
})

test('AI review decision is not blocked for spacing-only, meta-only, or alt-only warnings', () => {
  const payload = createPayload()
  payload.releaseDecisionInput = { criticalCount: 0, warningCount: 2, checkCount: 1, techErrorCount: 0, techWarningCount: 2 }
  payload.visualEvidence.textDifferences = [{ kind: 'text-difference', severity: 'check', category: 'copy', figmaText: 'Hello World', webText: 'HelloWorld' }]
  payload.techEvidence.metaIssues = [{ severity: 'warning', label: 'og:image' }]
  payload.techEvidence.altIssues = [{ severity: 'warning', label: 'Hero image' }]

  const normalized = normalizeAiReview({ releaseDecision: 'blocked', summary: '차단', mustFix: [{ category: 'seo', title: 'SEO', description: 'SEO', severity: 'critical' }], verify: [], developerNotes: [], clientReplyDraft: '초안' }, payload)

  assert.equal(normalized.releaseDecision, 'caution')
  assert.equal(normalized.mustFix.length, 0)
})

test('AI review keeps blocked for numeric price differences', () => {
  const payload = createPayload()
  const normalized = normalizeAiReview({ releaseDecision: 'ready', summary: '정상', mustFix: [], verify: [], developerNotes: [], clientReplyDraft: '초안' }, payload)

  assert.equal(normalized.releaseDecision, 'blocked')
})

test('AI review puts image versus video composition into verify instead of blocked', () => {
  const payload = createPayload()
  payload.visualEvidence.textDifferences = []
  payload.visualEvidence.media = { comparisonHint: 'figma-image-vs-web-video', figmaMediaTypes: ['image'], webMediaTypes: ['video'], webVideoCount: 1 }
  payload.techEvidence.metaIssues = []
  payload.releaseDecisionInput = { criticalCount: 0, warningCount: 1, checkCount: 0, techErrorCount: 0, techWarningCount: 0 }

  const normalized = normalizeAiReview({ releaseDecision: 'blocked', summary: '차단', mustFix: [{ category: 'media', title: '미디어', description: '미디어', severity: 'critical' }], verify: [{ category: 'media', title: '미디어 의도 확인', description: '확인', severity: 'warning' }], developerNotes: [], clientReplyDraft: '초안' }, payload)

  assert.equal(normalized.releaseDecision, 'caution')
  assert.equal(normalized.verify[0].category, 'media')
})

function createPayload() {
  return {
    meta: { payloadVersion: '0.3-ai-review-input', webUrl: 'https://example.com', openAiCalled: false },
    releaseDecisionInput: { criticalCount: 1, warningCount: 2, checkCount: 0, techErrorCount: 0, techWarningCount: 1 },
    visualEvidence: { textDifferences: [{ kind: 'text-difference', severity: 'critical', category: 'numeric', figmaText: 'Monthly 47', webText: 'Monthly 50', confidence: 'high' }], hero: {}, cta: {}, prices: [], media: {} },
    techEvidence: { access: {}, httpStatus: {}, consoleErrors: [], brokenLinks: [], metaIssues: [], altIssues: [], externalLinkIssues: [], networkIssues: [] },
    requestedOutputSchema: { releaseDecision: 'ready | caution | blocked', summary: '', mustFix: [], verify: [], developerNotes: [], clientReplyDraft: '' },
  }
}
