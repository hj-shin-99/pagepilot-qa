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
  assert.equal(result.review.mustFix[0].category, 'Price')
  assert.deepEqual(Object.keys(result.review).sort(), ['clientReplyDraft', 'developerNotes', 'mustFix', 'releaseDecision', 'summary', 'verify', 'visualDifferences'])
})

test('AI review service sends four images with request detail in a single multimodal call when vision input exists', async () => {
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
  payload.visualEvidence.hero = { sections: [{ source: 'figma' }, { source: 'web' }] }
  payload.visionInput = { enabled: true, images: [
    { label: 'figma-overview', dataUrl: 'data:image/jpeg;base64,AAA', width: 100, height: 300, detail: 'low' },
    { label: 'web-overview', dataUrl: 'data:image/jpeg;base64,BBB', width: 100, height: 320, detail: 'low' },
    { label: 'figma-hero', dataUrl: 'data:image/jpeg;base64,CCC', width: 160, height: 90, detail: 'high' },
    { label: 'web-hero', dataUrl: 'data:image/jpeg;base64,DDD', width: 160, height: 90, detail: 'high' },
  ] }

  const result = await service.review(payload)
  const imageParts = calls.request.messages[1].content.filter((item) => item.type === 'image_url')

  assert.equal(calls.create, 1)
  assert.equal(imageParts.length, 4)
  assert.deepEqual(imageParts.map((item) => item.image_url.detail), ['low', 'low', 'high', 'high'])
  assert.equal(result.meta.openAiCalled, true)
  assert.equal(result.meta.visionUsed, true)
  assert.equal(result.meta.imageInputCount, 4)
  assert.equal(result.meta.rawVisionCount, 1)
  assert.deepEqual(result.meta.visionInputSummary.map((item) => item.label), ['figma-overview', 'web-overview', 'figma-hero', 'web-hero'])
  assert.equal(result.review.visualDifferences[0].category, 'Media')
})

test('AI review normalizes Korean visual differences and removes minor/generic duplicates', () => {
  const payload = createPayload()
  payload.visualEvidence.hero = { sections: [{ source: 'figma' }, { source: 'web' }] }
  payload.visualEvidence.cta = { countDifference: 0, figmaActions: [{ text: '신청하기' }], webActions: [{ text: '상담하기' }] }
  const normalized = normalizeAiReview({
    releaseDecision: 'caution',
    summary: '확인 필요',
    mustFix: [],
    verify: [],
    developerNotes: [],
    clientReplyDraft: '확인하겠습니다.',
    visualDifferences: [
      { area: 'Main Visual', category: 'Media', title: 'Hero media type mismatch', summary: 'Figma image differs from Web video.', figmaValue: 'vehicle exterior image', webValue: 'vehicle interior video', severity: 'warning', confidence: 'high', order: 0 },
      { area: 'Hero', category: 'Image', title: 'Image mismatch', summary: 'same hero issue', figmaValue: 'vehicle exterior image', webValue: 'vehicle interior video', severity: 'warning', confidence: 'medium', order: 1 },
      { area: 'Hero', category: 'Text', title: 'Minor spacing differences', summary: 'line break only', figmaValue: 'Hello World', webValue: 'HelloWorld', severity: 'check', confidence: 'low', order: 2 },
      { area: 'Hero', category: 'CTA', title: 'CTA role swap', summary: 'CTA differs', figmaValue: '신청하기', webValue: '상담하기', severity: 'warning', confidence: 'high', order: 3 },
      { area: 'Hero', category: 'CTA', title: 'CTA unclear', summary: 'CTA differs', figmaValue: 'A', webValue: 'B', severity: 'warning', confidence: 'low', order: 4 },
    ],
  }, payload)

  assert.equal(normalized.visualDifferences.length, 2)
  assert.equal(normalized.visualDifferences[0].title, '히어로/KV 비주얼이 다릅니다.')
  assert.equal(normalized.visualDifferences[0].figmaValue.includes('차량 외관'), true)
  assert.equal(normalized.visualDifferences.some((item) => /Minor spacing|CTA role swap/i.test(item.title)), false)
})

test('AI review synthetic fixture gates avoid hero false positives and repeated price merge', () => {
  const noHeroPayload = createPayload()
  noHeroPayload.visualEvidence.textDifferences = []
  noHeroPayload.visualEvidence.media = {}
  const noHero = normalizeAiReview({
    releaseDecision: 'ready', summary: '정상', mustFix: [], verify: [], developerNotes: [], clientReplyDraft: '정상',
    visualDifferences: [{ area: 'Hero', category: 'Media', title: 'Hero media type mismatch', summary: 'image vs video', figmaValue: 'image', webValue: 'video', severity: 'warning', confidence: 'high', order: 0 }],
  }, noHeroPayload)
  assert.equal(noHero.visualDifferences.length, 0)

  const pricePayload = createPayload()
  const price = normalizeAiReview({
    releaseDecision: 'blocked', summary: '가격 확인', mustFix: [], verify: [], developerNotes: [], clientReplyDraft: '확인',
    visualDifferences: [
      { area: 'Card A', category: 'Price', title: 'Price mismatch', summary: 'A', figmaValue: '월 10만원', webValue: '월 11만원', severity: 'critical', confidence: 'high', order: 0 },
      { area: 'Card B', category: 'Price', title: 'Price mismatch', summary: 'B', figmaValue: '월 20만원', webValue: '월 21만원', severity: 'critical', confidence: 'high', order: 1 },
      { area: 'Card A', category: 'Price', title: 'Price mismatch', summary: 'A duplicate', figmaValue: '월 10만원', webValue: '월 11만원', severity: 'critical', confidence: 'medium', order: 2 },
    ],
  }, pricePayload)
  assert.equal(price.visualDifferences.length, 2)
})

test('AI review corrects price area from canonical product section and keeps canonical values', () => {
  const payload = createPayload()
  payload.visualEvidence.prices = [
    { source: 'figma', type: 'monthly-payment', text: 'Basic plan, 월 47만원', sectionPath: 'Product cards / Basic card', yRatio: 0.42, numericTokens: ['47'], unitTokens: ['만원'] },
    { source: 'web', type: 'monthly-payment', text: 'Basic plan, 월 50만원', sectionPath: 'section.pricing > div.product-card.basic', yRatio: 0.43, numericTokens: ['50'], unitTokens: ['만원'] },
  ]
  const normalized = normalizeAiReview({
    releaseDecision: 'blocked', summary: '가격 확인', mustFix: [], verify: [], developerNotes: [], clientReplyDraft: '확인',
    visualDifferences: [{ area: 'Main Visual', category: 'Price', title: '월 납입금 차이', summary: '가격이 다릅니다.', figmaValue: '월 47만원', webValue: '월 50만원', severity: 'critical', confidence: 'high', order: 0 }],
  }, payload)
  assert.equal(normalized.visualDifferences[0].area, 'Product Card')
  assert.equal(normalized.visualDifferences[0].figmaValue, 'Basic plan, 월 47만원')
  assert.equal(normalized.visualDifferences[0].webValue, 'Basic plan, 월 50만원')
})

test('AI review rejects Price category when title and values describe layout', () => {
  const payload = createPayload()
  payload.visualEvidence.hero = { sections: [{ source: 'figma' }, { source: 'web' }] }
  payload.visualEvidence.prices = [
    { source: 'figma', type: 'monthly-payment', text: '월 47만원', sectionPath: 'Product card', yRatio: 0.52, unitTokens: ['만원'] },
    { source: 'web', type: 'monthly-payment', text: '월 50만원', sectionPath: 'Product card', yRatio: 0.52, unitTokens: ['만원'] },
  ]
  const normalized = normalizeAiReview({
    releaseDecision: 'caution', summary: '확인', mustFix: [], verify: [], developerNotes: [], clientReplyDraft: '확인',
    visualDifferences: [{ area: 'Hero', category: 'Price', title: '히어로 섹션 높이 및 비율 차이', summary: 'Layout height differs.', figmaValue: '02 낮은 월납입금으로 이용', webValue: '잔존가치 상품 설명 장문입니다.', severity: 'warning', confidence: 'high', order: 0 }],
  }, payload)

  assert.equal(normalized.visualDifferences.length, 0)
})

test('AI review rejects ordinal monthly-payment benefit text as Price but keeps real amounts and rates', () => {
  const payload = createPayload()
  payload.visualEvidence.hero = { sections: [{ source: 'figma' }, { source: 'web' }] }
  const normalized = normalizeAiReview({
    releaseDecision: 'blocked', summary: '가격 확인', mustFix: [], verify: [], developerNotes: [], clientReplyDraft: '확인',
    visualDifferences: [
      { area: 'Content', category: 'Price', title: 'Price mismatch', summary: 'Ordinal benefit text', figmaValue: '02 낮은 월납입금으로 BMW 이용', webValue: '02 낮은 월납입금으로 이용', severity: 'critical', confidence: 'high', order: 0 },
      { area: 'Product card', category: 'Price', title: '월 납입금 차이', summary: 'Amount differs.', figmaValue: 'BMW 뉴 iX 월 50만원', webValue: 'BMW 뉴 iX 월 55만원', severity: 'critical', confidence: 'high', order: 1 },
      { area: 'Product card', category: 'Price', title: '금리 차이', summary: 'Rate differs.', figmaValue: '금리 4.9%', webValue: '금리 5.1%', severity: 'critical', confidence: 'high', order: 2 },
    ],
  }, payload)

  assert.equal(normalized.visualDifferences.length, 2)
  assert.deepEqual(normalized.visualDifferences.map((item) => item.category), ['Price', 'Price'])
  assert.equal(normalized.visualDifferences.some((item) => item.figmaValue.includes('02 낮은')), false)
})

test('AI review downgrades uncertain CTA pairing but keeps clear missing CTA count', () => {
  const uncertainPayload = createPayload()
  uncertainPayload.visualEvidence.hero = { sections: [{ source: 'figma' }, { source: 'web' }] }
  uncertainPayload.visualEvidence.cta = {
    countDifference: 0,
    figmaActions: [{ text: 'Start trial', role: 'primary-action', sectionPath: 'Hero', yRatio: 0.1, xRatio: 0.1 }, { text: 'See plans', role: 'secondary-action', sectionPath: 'Hero', yRatio: 0.1, xRatio: 0.25 }],
    webActions: [{ text: 'Contact sales', role: 'primary-action', sectionPath: 'Hero', yRatio: 0.1, xRatio: 0.75 }, { text: 'Download', role: 'secondary-action', sectionPath: 'Hero', yRatio: 0.1, xRatio: 0.9 }],
  }
  const uncertain = normalizeAiReview({
    releaseDecision: 'caution', summary: '확인', mustFix: [], verify: [], developerNotes: [], clientReplyDraft: '확인',
    visualDifferences: [{ area: 'Hero', category: 'CTA', title: 'CTA text mismatch', summary: 'CTA differs', figmaValue: 'Start trial / See plans', webValue: 'Contact sales / Download', severity: 'critical', confidence: 'high', order: 0 }],
  }, uncertainPayload)
  assert.equal(uncertain.visualDifferences[0].severity, 'check')
  assert.equal(uncertain.visualDifferences[0].title, 'CTA 구성을 확인해주세요.')

  const missingPayload = createPayload()
  missingPayload.visualEvidence.hero = { sections: [{ source: 'figma' }, { source: 'web' }] }
  missingPayload.visualEvidence.cta = { countDifference: 1, figmaActions: [{ text: 'Start', role: 'primary-action' }], webActions: [] }
  const missing = normalizeAiReview({
    releaseDecision: 'blocked', summary: '확인', mustFix: [], verify: [], developerNotes: [], clientReplyDraft: '확인',
    visualDifferences: [{ area: 'Hero', category: 'CTA', title: 'CTA 누락', summary: 'Web에 CTA가 없습니다.', figmaValue: 'Start', webValue: '', severity: 'critical', confidence: 'high', order: 0 }],
  }, missingPayload)
  assert.equal(missing.visualDifferences[0].severity, 'critical')
})

test('AI review downgrades Vision missing CTA when canonical Web CTA exists', () => {
  const payload = createPayload()
  payload.visualEvidence.hero = { sections: [{ source: 'figma' }, { source: 'web' }] }
  payload.visualEvidence.cta = {
    countDifference: 0,
    figmaActions: [{ text: 'Start', role: 'primary-action', sectionPath: 'Hero', yRatio: 0.2, xRatio: 0.1 }],
    webActions: [{ text: 'Start', role: 'primary-action', sectionPath: 'Hero', yRatio: 0.2, xRatio: 0.1 }],
  }
  Object.defineProperty(payload, '__visionCropSummary', { value: [
    { label: 'figma-hero', cropDiagnostics: { cropQualityPassed: true, descendantUnionHeight: 120, finalCropHeight: 900 } },
    { label: 'web-hero', cropDiagnostics: { cropQualityPassed: true, descendantUnionHeight: 120, finalCropHeight: 900 } },
  ], enumerable: false })

  const normalized = normalizeAiReview({
    releaseDecision: 'blocked', summary: 'CTA 확인', mustFix: [], verify: [], developerNotes: [], clientReplyDraft: '확인',
    visualDifferences: [{ area: 'Hero', category: 'CTA', title: 'CTA missing', summary: 'Web CTA missing.', figmaValue: 'Start', webValue: 'Web CTA 없음', severity: 'critical', confidence: 'high', order: 0 }],
  }, payload)

  assert.equal(normalized.visualDifferences.length, 0)
})

test('AI review removes CTA critical when hero crop quality fails but keeps normal CTA count behavior', () => {
  const unsafePayload = createPayload()
  unsafePayload.visualEvidence.hero = { sections: [{ source: 'figma' }, { source: 'web' }] }
  unsafePayload.visualEvidence.cta = { countDifference: 1, figmaActions: [{ text: 'Start', role: 'primary-action' }], webActions: [] }
  Object.defineProperty(unsafePayload, '__visionCropSummary', { value: [
    { label: 'figma-hero', cropDiagnostics: { cropQualityPassed: true, descendantUnionHeight: 120, finalCropHeight: 900 } },
    { label: 'web-hero', cropDiagnostics: { cropQualityPassed: false, descendantUnionHeight: 0, finalCropHeight: 200 } },
  ], enumerable: false })
  const unsafe = normalizeAiReview({
    releaseDecision: 'blocked', summary: 'CTA 확인', mustFix: [], verify: [], developerNotes: [], clientReplyDraft: '확인',
    visualDifferences: [{ area: 'Hero', category: 'CTA', title: 'CTA missing', summary: 'Web CTA missing.', figmaValue: 'Start', webValue: '', severity: 'critical', confidence: 'high', order: 0 }],
  }, unsafePayload)

  const safePayload = createPayload()
  safePayload.visualEvidence.hero = { sections: [{ source: 'figma' }, { source: 'web' }] }
  safePayload.visualEvidence.cta = { countDifference: 1, figmaActions: [{ text: 'Start', role: 'primary-action' }], webActions: [] }
  Object.defineProperty(safePayload, '__visionCropSummary', { value: [
    { label: 'figma-hero', cropDiagnostics: { cropQualityPassed: true, descendantUnionHeight: 120, finalCropHeight: 900 } },
    { label: 'web-hero', cropDiagnostics: { cropQualityPassed: true, descendantUnionHeight: 120, finalCropHeight: 900 } },
  ], enumerable: false })
  const safe = normalizeAiReview({
    releaseDecision: 'blocked', summary: 'CTA 확인', mustFix: [], verify: [], developerNotes: [], clientReplyDraft: '확인',
    visualDifferences: [{ area: 'Hero', category: 'CTA', title: 'CTA missing', summary: 'Web CTA missing.', figmaValue: 'Start', webValue: '', severity: 'critical', confidence: 'high', order: 0 }],
  }, safePayload)

  assert.equal(unsafe.visualDifferences.length, 0)
  assert.equal(safe.visualDifferences[0].severity, 'critical')
})

test('AI review excludes transient cookie overlay but keeps explicit designed modal', () => {
  const payload = createPayload()
  payload.visualEvidence.textDifferences = []
  const normalized = normalizeAiReview({
    releaseDecision: 'caution', summary: '확인', mustFix: [], verify: [], developerNotes: [], clientReplyDraft: '확인',
    visualDifferences: [
      { area: 'Cookie consent popup', category: 'Missing', title: '쿠키 동의 팝업이 Web에만 표시됩니다.', summary: '세션 상태 팝업입니다.', figmaValue: '없음', webValue: '쿠키 동의 팝업', severity: 'warning', confidence: 'high', order: 0 },
      { area: 'Signup modal', category: 'Layout', title: '회원가입 모달 레이아웃이 다릅니다.', summary: 'Figma dialog와 Web modal 양쪽에 존재합니다.', figmaValue: '시안 팝업', webValue: 'Web 팝업', severity: 'warning', confidence: 'high', order: 1 },
    ],
  }, payload)
  assert.equal(normalized.visualDifferences.length, 1)
  assert.equal(normalized.visualDifferences[0].title, '회원가입 모달 레이아웃이 다릅니다.')
})

test('AI review removes transient cookie overlay from summary mustFix and developerNotes', () => {
  const normalized = normalizeAiReview({
    releaseDecision: 'blocked',
    summary: 'Cookie consent popup is the key visual difference.',
    mustFix: [{ category: 'missing', title: 'Cookie consent popup', description: 'Web cookie consent overlay appears.', severity: 'critical' }],
    verify: [{ category: 'tech', title: 'Cookie consent state', description: 'Session cookie overlay should be checked.', severity: 'warning' }],
    developerNotes: [{ category: 'tech', title: 'Cookie overlay debug', description: 'Consent popup appeared in screenshot.', severity: 'check' }],
    clientReplyDraft: '확인',
    visualDifferences: [],
  }, createPayload())

  assert.equal(/cookie|consent/i.test(normalized.summary), false)
  assert.equal(normalized.mustFix.length, 0)
  assert.equal(normalized.developerNotes.length, 0)
  assert.equal(normalized.verify.length <= 1, true)
  if (normalized.verify.length === 1) assert.equal(normalized.verify[0].severity, 'check')
})

test('AI review normalizes mustFix and verify visual categories', () => {
  const normalized = normalizeAiReview({
    releaseDecision: 'blocked', summary: '확인',
    mustFix: [{ title: '월 납입금 수정', description: 'Figma 47만원 Web 50만원', severity: 'critical' }],
    verify: [{ title: 'CTA 링크 확인', description: 'href 목적지가 다릅니다.', severity: 'warning' }, { title: '콘솔 오류', description: 'console error', severity: 'warning' }],
    developerNotes: [], clientReplyDraft: '확인', visualDifferences: [],
  }, createPayload())
  assert.deepEqual(normalized.mustFix.map((item) => item.category), ['Price'])
  assert.deepEqual(normalized.verify.map((item) => item.category), ['CTA', 'Tech'])
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
    (error) => error.openAiCalled === true && error.code === 'openai_request_failed' && error.fallbackStage === 'openai-request' && Number.isFinite(error.aiReviewDurationMs),
  )
})

test('AI review diagnostics mark normal response as received and parsed', async () => {
  const service = createAiReviewService({ client: createMockOpenAiClient(validAiResponse()) })

  const result = await service.review(createPayload())

  assert.equal(result.meta.fallbackStage, '')
  assert.equal(result.meta.fallbackReason, '')
  assert.equal(result.meta.openAiResponseReceived, true)
  assert.equal(result.meta.openAiResponseParsed, true)
  assert.equal(Number.isFinite(result.meta.openAiRequestDurationMs), true)
})

test('AI review diagnostics classify timeout fallback', async () => {
  const timeoutError = new Error('request timed out')
  timeoutError.code = 'ETIMEDOUT'
  const service = createAiReviewService({ client: createMockOpenAiClient(null, timeoutError) })

  await assert.rejects(
    service.review(createPayload()),
    (error) => error.fallbackStage === 'openai-timeout'
      && error.fallbackReason === 'timeout'
      && error.openAiResponseReceived === false
      && error.openAiResponseParsed === false
      && Number.isFinite(error.openAiRequestDurationMs),
  )
})

test('AI review diagnostics classify HTTP error fallback', async () => {
  const httpError = new Error('server error')
  httpError.status = 503
  const service = createAiReviewService({ client: createMockOpenAiClient(null, httpError) })

  await assert.rejects(
    service.review(createPayload()),
    (error) => error.fallbackStage === 'openai-http-error'
      && error.fallbackReason === 'http-503'
      && error.code === 'openai_http_error',
  )
})

test('AI review diagnostics classify empty response fallback', async () => {
  const service = createAiReviewService({ client: createMockOpenAiClient('') })

  await assert.rejects(
    service.review(createPayload()),
    (error) => error.fallbackStage === 'openai-response-empty'
      && error.fallbackReason === 'empty_ai_response'
      && error.openAiResponseReceived === true
      && error.openAiResponseParsed === false,
  )
})

test('AI review diagnostics classify JSON parse fallback', async () => {
  const service = createAiReviewService({ client: createMockOpenAiClient('not-json') })

  await assert.rejects(
    service.review(createPayload()),
    (error) => error.fallbackStage === 'json-parse'
      && error.fallbackReason === 'invalid_ai_json'
      && error.openAiResponseReceived === true
      && error.openAiResponseParsed === false,
  )
})

test('AI review diagnostics classify schema validation fallback', async () => {
  const service = createAiReviewService({ client: createMockOpenAiClient(JSON.stringify({ developerNotes: [] })), model: 'schema-model' })

  await assert.rejects(
    service.review(createPayload()),
    (error) => error.fallbackStage === 'schema-validation'
      && error.fallbackReason === 'invalid_ai_schema'
      && error.model === 'schema-model'
      && error.openAiResponseReceived === true
      && error.openAiResponseParsed === true,
  )
})

test('AI review sanitizes developerNotes string arrays without fallback', async () => {
  const service = createAiReviewService({ client: createMockOpenAiClient(JSON.stringify({
    releaseDecision: 'caution',
    summary: '확인 필요',
    mustFix: [],
    verify: [],
    developerNotes: ['개발 확인 필요', null, ''],
    clientReplyDraft: '확인하겠습니다.',
    visualDifferences: [{ area: 'Main Visual', category: 'Media', title: 'Hero media type mismatch', summary: 'image vs video', figmaValue: 'image', webValue: 'video', severity: 'warning', confidence: 'high', order: 0 }],
  })) })
  const payload = createPayload()
  payload.visualEvidence.hero = { sections: [{ source: 'figma' }, { source: 'web' }], webPrimaryMediaCount: 1 }

  const result = await service.review(payload)

  assert.equal(result.meta.fallbackStage, '')
  assert.equal(result.review.developerNotes.length, 1)
  assert.equal(result.review.developerNotes[0].title, '개발 확인 필요')
  assert.equal(result.review.developerNotes[0].severity, 'check')
  assert.equal(result.review.visualDifferences.length, 1)
})

test('AI review sanitizes partial developerNotes objects evidence and invalid enums', async () => {
  const result = normalizeAiReview({
    releaseDecision: 'caution',
    summary: '확인 필요',
    mustFix: [],
    verify: [],
    developerNotes: [
      { description: '캐시 확인', evidence: 'render cache hit', severity: 'note', category: 'unknown-kind' },
      { title: '', description: '', evidence: [] },
    ],
    clientReplyDraft: '확인하겠습니다.',
    visualDifferences: [],
  }, createPayload())

  assert.equal(result.developerNotes.length, 1)
  assert.equal(result.developerNotes[0].title, '캐시 확인')
  assert.deepEqual(result.developerNotes[0].evidence, ['render cache hit'])
  assert.equal(result.developerNotes[0].category, 'Other')
  assert.equal(result.developerNotes[0].severity, 'check')
})

test('AI review sanitizes mustFix and verify partial invalid items', () => {
  const result = normalizeAiReview({
    releaseDecision: 'blocked',
    summary: '확인 필요',
    mustFix: ['가격 확인', { evidence: '월 47 / 월 50', severity: 'blocker' }, null],
    verify: [{ message: 'CTA 링크 확인', category: 'bad-category', severity: 'maybe' }, undefined],
    developerNotes: [],
    clientReplyDraft: 12345,
    visualDifferences: [],
  }, createPayload())

  assert.equal(result.mustFix.length, 1)
  assert.equal(result.mustFix[0].title, '월 47 / 월 50')
  assert.equal(result.mustFix[0].severity, 'critical')
  assert.equal(result.verify.length, 2)
  assert.equal(result.verify.some((item) => item.title === '가격 확인' && item.severity === 'warning'), true)
  assert.equal(result.verify.some((item) => item.category === 'CTA' && item.severity === 'warning'), true)
  assert.equal(typeof result.clientReplyDraft, 'string')
})

test('AI review keeps visualDifferences when auxiliary fields are malformed', async () => {
  const service = createAiReviewService({ client: createMockOpenAiClient(JSON.stringify({
    releaseDecision: 'caution',
    summary: '확인 필요',
    mustFix: { title: '가격 확인', evidence: '월 47 / 월 50', severity: 'blocker' },
    verify: 'CTA 확인',
    developerNotes: 'developer note as string',
    clientReplyDraft: { text: 'not string' },
    visualDifferences: [
      { area: 'Main Visual', category: 'Media', title: 'Hero media type mismatch', summary: 'image vs video', figmaValue: 'image', webValue: 'video', severity: 'warning', confidence: 'high', order: 0 },
      null,
      {},
    ],
  })) })
  const payload = createPayload()
  payload.visualEvidence.hero = { sections: [{ source: 'figma' }, { source: 'web' }], webPrimaryMediaCount: 1 }

  const result = await service.review(payload)

  assert.equal(result.meta.fallbackStage, '')
  assert.equal(result.review.mustFix.length, 1)
  assert.equal(result.review.verify.length, 1)
  assert.equal(result.review.developerNotes.length, 1)
  assert.equal(result.review.visualDifferences.length, 1)
  assert.equal(result.review.visualDifferences[0].category, 'Media')
})

test('AI review diagnostics classify post-process fallback', async () => {
  const service = createAiReviewService({
    client: createMockOpenAiClient(validAiResponse()),
    normalizeReview() {
      throw new Error('post process failed')
    },
  })

  await assert.rejects(
    service.review(createPayload()),
    (error) => error.fallbackStage === 'post-process'
      && error.fallbackReason === 'post_process_failed'
      && error.openAiResponseReceived === true
      && error.openAiResponseParsed === true,
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
  assert.equal(normalized.mustFix.length, 0)
  assert.equal(normalized.verify.some((item) => item.title === 'A'), true)
  assert.equal(normalized.verify.some((item) => item.title === 'not-array'), true)
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

test('AI review does not stay blocked without final critical output', () => {
  const payload = createPayload()
  const normalized = normalizeAiReview({ releaseDecision: 'ready', summary: '정상', mustFix: [], verify: [], developerNotes: [], clientReplyDraft: '초안' }, payload)

  assert.equal(normalized.releaseDecision, 'ready')
  assert.equal(/차단|우선\s*수정|수정\s*필요/.test(normalized.summary), false)
})

test('AI review puts image versus video composition into verify instead of blocked', () => {
  const payload = createPayload()
  payload.visualEvidence.textDifferences = []
  payload.visualEvidence.media = { comparisonHint: 'figma-image-vs-web-video', figmaMediaTypes: ['image'], webMediaTypes: ['video'], webVideoCount: 1 }
  payload.techEvidence.metaIssues = []
  payload.releaseDecisionInput = { criticalCount: 0, warningCount: 1, checkCount: 0, techErrorCount: 0, techWarningCount: 0 }

  const normalized = normalizeAiReview({ releaseDecision: 'blocked', summary: '차단', mustFix: [{ category: 'media', title: '미디어', description: '미디어', severity: 'critical' }], verify: [{ category: 'media', title: '미디어 의도 확인', description: '확인', severity: 'warning' }], developerNotes: [], clientReplyDraft: '초안' }, payload)

  assert.equal(normalized.releaseDecision, 'caution')
  assert.equal(normalized.verify[0].category, 'Media')
})

test('AI review removes hero absence criticals across arrays when crop pair is incompatible', () => {
  const payload = createPayload()
  payload.visualEvidence.hero = { sections: [{ source: 'figma' }, { source: 'web' }], webTextCount: 2 }
  payload.visualEvidence.cta = { webActions: [{ text: 'Apply', role: 'primary-action' }] }
  payload.visualEvidence.media = { webPrimaryCandidates: [{ type: 'image', source: 'web' }] }
  Object.defineProperty(payload, '__heroCropPairQuality', { value: { compatible: false, figmaCoverageRatio: 0.36, webCoverageRatio: 0.04, coverageRatioDelta: 0.32, reason: 'hero-crop-quality-failed' }, enumerable: false })
  const normalized = normalizeAiReview({
    releaseDecision: 'blocked',
    summary: 'Hero 이미지 세로 압축과 Web CTA 없음이 핵심 문제입니다.',
    mustFix: [
      { category: 'media', title: 'Hero 이미지 세로 압축 Critical', description: 'Hero image is compressed.', severity: 'critical' },
      { category: 'cta', title: 'Web CTA 0개 Critical', description: 'Web Hero CTA missing.', severity: 'critical' },
    ],
    verify: [{ category: 'text', title: 'Hero 텍스트 없음', description: 'Web Hero text missing.', severity: 'warning' }],
    developerNotes: [{ category: 'media', title: 'Hero distortion debug', description: 'Hero crop shows distortion.', severity: 'check' }],
    clientReplyDraft: 'Hero CTA 없음과 이미지 압축을 수정하겠습니다.',
    visualDifferences: [
      { area: 'Hero', category: 'CTA', title: 'Web CTA missing', summary: 'Web CTA missing.', figmaValue: 'Apply', webValue: 'missing', severity: 'critical', confidence: 'high', order: 0 },
      { area: 'Hero', category: 'Media', title: 'Hero image compressed', summary: 'Hero image distortion.', figmaValue: 'normal', webValue: 'compressed', severity: 'critical', confidence: 'high', order: 1 },
    ],
  }, payload)

  assert.equal(normalized.visualDifferences.length, 0)
  assert.equal(normalized.mustFix.length, 0)
  assert.equal(normalized.verify.length, 0)
  assert.equal(normalized.developerNotes.length, 0)
  assert.equal(/Hero|CTA 없음|압축/i.test(normalized.summary), false)
  assert.equal(/Hero|CTA 없음|압축/i.test(normalized.clientReplyDraft), false)
})

test('AI review keeps normal hero vision judgment when crop pair is compatible', () => {
  const payload = createPayload()
  payload.visualEvidence.hero = { sections: [{ source: 'figma' }, { source: 'web' }] }
  Object.defineProperty(payload, '__heroCropPairQuality', { value: { compatible: true, figmaCoverageRatio: 0.32, webCoverageRatio: 0.31, coverageRatioDelta: 0.01, reason: '' }, enumerable: false })
  const normalized = normalizeAiReview({
    releaseDecision: 'caution', summary: 'Hero 이미지 차이 확인', mustFix: [], verify: [], developerNotes: [], clientReplyDraft: '확인',
    visualDifferences: [{ area: 'Hero', category: 'Media', title: 'Hero media differs', summary: 'Image differs.', figmaValue: 'image A', webValue: 'image B', severity: 'warning', confidence: 'high', order: 0 }],
  }, payload)

  assert.equal(normalized.visualDifferences.length, 1)
  assert.equal(normalized.visualDifferences[0].severity, 'warning')
})

test('AI review removes hero CTA missing judgment when both crops are bad', () => {
  const payload = createPayload()
  payload.visualEvidence.hero = { sections: [{ source: 'figma' }, { source: 'web' }] }
  Object.defineProperty(payload, '__heroCropPairQuality', { value: { compatible: false, figmaCoverageRatio: 0.05, webCoverageRatio: 0.04, coverageRatioDelta: 0.01, reason: 'hero-crop-quality-failed' }, enumerable: false })
  const normalized = normalizeAiReview({
    releaseDecision: 'blocked', summary: 'CTA 확인', mustFix: [], verify: [], developerNotes: [], clientReplyDraft: '확인',
    visualDifferences: [{ area: 'Hero', category: 'CTA', title: 'Web CTA missing', summary: 'Web CTA missing.', figmaValue: 'Apply', webValue: 'missing', severity: 'critical', confidence: 'high', order: 0 }],
  }, payload)

  assert.equal(normalized.visualDifferences.length, 0)
})

test('AI review treats excessive hero coverage delta as incompatible', () => {
  const payload = createPayload()
  payload.visualEvidence.hero = { sections: [{ source: 'figma' }, { source: 'web' }] }
  Object.defineProperty(payload, '__visionCropSummary', { value: [
    { label: 'figma-hero', cropDiagnostics: { cropQualityPassed: true, validDescendantBoxCount: 4, descendantUnionHeight: 500, finalCropHeight: 900, cropCoverageRatio: 0.36 } },
    { label: 'web-hero', cropDiagnostics: { cropQualityPassed: true, validDescendantBoxCount: 4, descendantUnionHeight: 500, finalCropHeight: 900, cropCoverageRatio: 0.12 } },
  ], enumerable: false })
  const normalized = normalizeAiReview({
    releaseDecision: 'blocked', summary: 'Hero CTA 없음', mustFix: [], verify: [], developerNotes: [], clientReplyDraft: '확인',
    visualDifferences: [{ area: 'Hero', category: 'CTA', title: 'Web CTA missing', summary: 'Web CTA missing.', figmaValue: 'Apply', webValue: '', severity: 'critical', confidence: 'high', order: 0 }],
  }, payload)

  assert.equal(normalized.visualDifferences.length, 0)
})

test('AI review removes canonical-conflicting Web media missing claims', () => {
  const payload = createPayload()
  payload.visualEvidence.hero = { sections: [{ source: 'figma' }, { source: 'web' }] }
  payload.visualEvidence.media = { webPrimaryCandidates: [{ source: 'web', type: 'image' }] }
  Object.defineProperty(payload, '__heroCropPairQuality', { value: { compatible: false, figmaCoverageRatio: 0.36, webCoverageRatio: 0.04, coverageRatioDelta: 0.32, reason: 'hero-crop-quality-failed' }, enumerable: false })
  const normalized = normalizeAiReview({
    releaseDecision: 'blocked', summary: '확인', mustFix: [], verify: [], developerNotes: [], clientReplyDraft: '확인',
    visualDifferences: [{ area: 'Hero', category: 'Missing', title: 'Web Hero image missing', summary: 'Web media missing.', figmaValue: 'image', webValue: 'missing', severity: 'critical', confidence: 'high', order: 0 }],
  }, payload)

  assert.equal(normalized.visualDifferences.length, 0)
})

test('AI review removes incompatible hero image and CTA output claims from narrative fields', () => {
  const payload = createPayload()
  Object.defineProperty(payload, '__heroCropPairQuality', { value: { compatible: false, figmaCoverageRatio: 0.34, webCoverageRatio: 0.06, coverageRatioDelta: 0.28, reason: 'hero-crop-quality-failed' }, enumerable: false })
  const normalized = normalizeAiReview({
    releaseDecision: 'blocked',
    summary: '차단 이슈: 웹 이미지와 CTA 출력 이슈 점검이 필요합니다.',
    mustFix: [{ category: 'media', title: '대표 이미지 미노출', description: '웹 이미지와 CTA 출력 이슈 점검', severity: 'critical' }],
    verify: [{ category: 'media', title: '웹 이미지와 CTA 출력 이슈 점검', description: 'Web 이미지 로딩/출력 문제입니다.', severity: 'warning' }],
    developerNotes: [{ category: 'media', title: '웹 이미지와 CTA 출력 이슈 점검', description: 'Hero crop 기반입니다.', severity: 'check' }],
    clientReplyDraft: '차단 이슈로 대표 이미지 미노출과 CTA 출력 문제를 우선 수정하겠습니다.',
    visualDifferences: [{ area: 'Hero', category: 'Media', title: '대표 이미지 미노출', summary: '웹 이미지와 CTA 출력 이슈 점검', figmaValue: 'Hero image', webValue: '이미지 미노출', severity: 'critical', confidence: 'high' }],
  }, payload)

  assert.equal(normalized.releaseDecision, 'ready')
  assert.equal(normalized.visualDifferences.length, 0)
  assert.equal(normalized.mustFix.length, 0)
  assert.equal(normalized.verify.length, 0)
  assert.equal(normalized.developerNotes.length, 0)
  assert.equal(/차단|우선\s*수정|이미지 미노출|출력 이슈/.test(`${normalized.summary} ${normalized.clientReplyDraft}`), false)
})

test('AI review downgrades ordinal-only text differences from critical', () => {
  const normalized = normalizeAiReview({
    releaseDecision: 'blocked', summary: '확인', mustFix: [], verify: [], developerNotes: [], clientReplyDraft: '확인',
    visualDifferences: [{ area: 'Benefit', category: 'Text', title: '낮은 월 납입금 문구 차이', summary: '순번과 띄어쓰기 차이입니다.', figmaValue: '02 낮은 월납입금으로 이용', webValue: '낮은 월 납입금으로 이용', severity: 'critical', confidence: 'high', order: 0 }],
  }, createPayload())

  assert.equal(normalized.releaseDecision, 'caution')
  assert.equal(normalized.visualDifferences[0].category, 'Text')
  assert.equal(normalized.visualDifferences[0].severity, 'warning')
})

test('AI review reconciles final arrays from sanitized visualDifferences', () => {
  const payload = createPayload()
  Object.defineProperty(payload, '__heroCropPairQuality', { value: { compatible: false, figmaCoverageRatio: 0.35, webCoverageRatio: 0.05, coverageRatioDelta: 0.3, reason: 'hero-crop-quality-failed' }, enumerable: false })
  const normalized = normalizeAiReview({
    releaseDecision: 'caution',
    summary: 'Hero 섹션 내 주요 CTA 3개가 Web에 전혀 노출되지 않음이 차단 이슈입니다.',
    mustFix: [
      { category: 'cta', title: 'Hero 섹션 내 주요 CTA 3개가 Web에 전혀 노출되지 않음', description: 'Hero CTA 미노출', severity: 'critical' },
      { category: 'text', title: 'BMWW 오타 수정 필요', description: 'BMWW를 BMW로 수정해야 합니다.', severity: 'critical' },
    ],
    verify: [],
    developerNotes: [{ category: 'cta', title: 'Hero CTA debug', description: 'CTA 미노출 점검', severity: 'check' }],
    clientReplyDraft: 'Hero CTA 미노출 차단 이슈와 BMWW 오타를 우선 수정하겠습니다.',
    visualDifferences: [
      { area: 'Header', category: 'Text', title: 'BMWW/BMW 오탈자', summary: '브랜드 표기 오탈자입니다.', figmaValue: 'BMWW', webValue: 'BMW', severity: 'warning', confidence: 'high', order: 0 },
      { area: 'Footer', category: 'Text', title: '하단 링크 텍스트 차이', summary: '링크 문구가 다릅니다.', figmaValue: '고객 지원', webValue: '고객센터', severity: 'check', confidence: 'medium', order: 1 },
    ],
  }, payload)

  assert.equal(normalized.releaseDecision, 'caution')
  assert.equal(normalized.mustFix.length, 0)
  assert.equal(normalized.verify.some((item) => /BMWW/.test(item.title) && item.severity === 'warning'), true)
  assert.equal(normalized.developerNotes.some((item) => /CTA|미노출/i.test(`${item.title} ${item.description}`)), false)
  assert.equal(/Hero|CTA|미노출|차단|우선\s*수정/.test(`${normalized.summary} ${normalized.clientReplyDraft}`), false)
})

test('AI review keeps inclusion exclusion critical but blocks only with real critical evidence', () => {
  const important = normalizeAiReview({
    releaseDecision: 'caution', summary: '확인', verify: [], developerNotes: [], clientReplyDraft: '확인',
    mustFix: [{ category: 'text', title: '혜택 포함/제외 의미 반전', description: 'Figma는 혜택 포함, Web은 혜택 제외로 표시됩니다.', severity: 'critical' }],
    visualDifferences: [{ area: 'Offer', category: 'Text', title: '혜택 조건 문구 차이', summary: '포함과 제외가 반대로 표시됩니다.', figmaValue: '혜택 포함', webValue: '혜택 제외', severity: 'critical', confidence: 'high', order: 0 }],
  }, createPayload())
  const numeric = normalizeAiReview({
    releaseDecision: 'caution', summary: '확인', verify: [], developerNotes: [], clientReplyDraft: '확인', visualDifferences: [],
    mustFix: [{ category: 'price', title: '월 납입금 차이', description: 'Figma 월 47만원, Web 월 50만원', severity: 'critical' }],
  }, createPayload())

  assert.equal(important.releaseDecision, 'blocked')
  assert.equal(important.mustFix[0].severity, 'critical')
  assert.equal(numeric.releaseDecision, 'blocked')
  assert.equal(numeric.mustFix[0].severity, 'critical')
})

test('AI review prevents critical mustFix for general typos and warning visual matches', () => {
  const normalized = normalizeAiReview({
    releaseDecision: 'caution', summary: 'BMWW 오타 수정 필요', verify: [], developerNotes: [], clientReplyDraft: 'BMWW 오타를 수정하겠습니다.',
    mustFix: [{ category: 'text', title: 'BMWW 오타 수정 필요', description: 'BMWW를 BMW로 수정합니다.', severity: 'critical' }],
    visualDifferences: [{ area: 'Header', category: 'Text', title: 'BMWW/BMW 오탈자', summary: '브랜드 표기 오탈자입니다.', figmaValue: 'BMWW', webValue: 'BMW', severity: 'warning', confidence: 'high', order: 0 }],
  }, createPayload())

  assert.equal(normalized.releaseDecision, 'caution')
  assert.equal(normalized.mustFix.length, 0)
  assert.equal(normalized.verify[0].severity, 'warning')
  assert.equal(normalized.visualDifferences[0].severity, 'warning')
})

test('AI review removes ordinal price criticals from auxiliary arrays but keeps real amounts', () => {
  const payload = createPayload()
  payload.visualEvidence.textDifferences = [{ kind: 'text-difference', severity: 'critical', category: 'numeric', figmaText: 'Figma 47만원', webText: 'Web 50만원' }]
  payload.releaseDecisionInput = { criticalCount: 1, warningCount: 0, checkCount: 0, techErrorCount: 0, techWarningCount: 0 }
  const normalized = normalizeAiReview({
    releaseDecision: 'blocked', summary: '02 접두사 숫자를 가격 문제로 분류했습니다.',
    mustFix: [
      { category: 'price', title: '02 접두사 숫자 가격 문제', description: '02 낮은 월납입금 항목입니다.', severity: 'critical' },
      { category: 'price', title: '금액 차이', description: 'Figma 47만원 Web 50만원', severity: 'critical' },
    ],
    verify: [], developerNotes: [], clientReplyDraft: '02 가격 문제를 수정하겠습니다.', visualDifferences: [],
  }, payload)

  assert.equal(normalized.mustFix.length, 1)
  assert.equal(normalized.mustFix[0].title, '금액 차이')
  assert.equal(/02/.test(normalized.summary), false)
  assert.equal(/02/.test(normalized.clientReplyDraft), false)
})

test('AI review removes cookie overlay from all auxiliary output text', () => {
  const normalized = normalizeAiReview({
    releaseDecision: 'blocked', summary: 'Cookie popup is the core issue.',
    mustFix: [{ category: 'missing', title: 'Cookie popup', description: 'Cookie consent overlay appears.', severity: 'critical' }],
    verify: [{ category: 'tech', title: 'Cookie state', description: 'Consent popup state.', severity: 'warning' }],
    developerNotes: [{ category: 'tech', title: 'Cookie debug', description: 'Cookie overlay shown.', severity: 'check' }],
    clientReplyDraft: 'Cookie popup을 핵심 문제로 수정하겠습니다.', visualDifferences: [],
  }, createPayload())

  assert.equal(normalized.mustFix.length, 0)
  assert.equal(normalized.verify.length, 0)
  assert.equal(normalized.developerNotes.length, 0)
  assert.equal(/cookie|popup|consent/i.test(normalized.summary), false)
  assert.equal(/cookie|popup|consent/i.test(normalized.clientReplyDraft), false)
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

function validAiResponse() {
  return JSON.stringify({
    releaseDecision: 'caution',
    summary: '확인 필요 항목이 있습니다.',
    mustFix: [],
    verify: [],
    developerNotes: [],
    clientReplyDraft: '확인 후 진행하겠습니다.',
    visualDifferences: [],
  })
}

function createMockOpenAiClient(content, error = null) {
  return {
    chat: {
      completions: {
        async create() {
          if (error) throw error
          return { choices: [{ message: { content } }] }
        },
      },
    },
  }
}
