import test from 'node:test'
import assert from 'node:assert/strict'
import { buildAiReviewPayloadFromQaResult, createAiReviewFromPayloadHandler, createAiReviewHandler, createAiReviewPayloadHandler } from './aiReviewPayload.js'

test('AI Review payload is compact and excludes raw artifacts', () => {
  const payload = buildAiReviewPayloadFromQaResult(createQaResult())
  const serialized = JSON.stringify(payload)

  assert.equal(payload.meta.openAiCalled, false)
  assert.equal(payload.requestedOutputSchema.releaseDecision, 'ready | caution | blocked')
  assert.equal(payload.visualEvidence.textDifferences.length <= 8, true)
  assert.equal(payload.techEvidence.brokenLinks.length <= 8, true)
  assert.equal(serialized.includes('<html'), false)
  assert.equal(serialized.includes('figmaStructure'), false)
  assert.equal(serialized.includes('data:image'), false)
  assert.equal(serialized.includes('secret-token'), false)
  assert.equal(serialized.includes('C:\\'), false)
  assert.equal(serialized.includes('.cache/'), false)
  assert.equal(payload.visualAssets.figmaRenderId, 'render-1')
  assert.equal(payload.visualAssets.webScreenshotFileName, 'aaaaaaaaaaaaaaaaaaaaaaaa.png')
  assert.equal(payload.visualEvidence.hero.sections.length, 2)
  assert.equal(payload.visualEvidence.hero.sections[0].source, 'figma')
})

test('AI Review payload dedupes visual and tech issue evidence', () => {
  const payload = buildAiReviewPayloadFromQaResult(createQaResult())

  assert.equal(payload.visualEvidence.textDifferences.length, 2)
  assert.equal(payload.techEvidence.brokenLinks.length, 1)
  assert.equal(payload.releaseDecisionInput.techErrorCount, 2)
  assert.equal(payload.releaseDecisionInput.techWarningCount, 3)
})

test('AI Review payload filters CTA evidence to canonical hero actions', () => {
  const qaResult = createQaResult()
  qaResult.visual.result.aiHints.heroCtaGroup = {
    countDifference: 4,
    figma: { count: 4, actions: [
      { text: 'Apply', role: 'primary-action', href: '/apply', comparisonScope: 'primary', sectionPath: 'Hero' },
      { text: '02 Lower monthly payment', role: 'text', comparisonScope: 'primary', sectionPath: 'Hero content' },
      { text: 'Reference', role: 'primary-action', comparisonScope: 'reference-only', sectionPath: 'Hero reference' },
    ] },
    web: { count: 0, actions: [] },
  }

  const payload = buildAiReviewPayloadFromQaResult(qaResult)

  assert.equal(payload.visualEvidence.cta.figmaCount, 1)
  assert.equal(payload.visualEvidence.cta.webCount, 0)
  assert.equal(payload.visualEvidence.cta.countDifference, 1)
  assert.deepEqual(payload.visualEvidence.cta.figmaActions.map((item) => item.text), ['Apply'])
  assert.equal(payload.visualEvidence.hero.figmaCtaCount, 1)
})

test('AI Review payload classifies ordinal numeric copy as copy and real price values as numeric', () => {
  const qaResult = createQaResult()
  qaResult.visual.result.comparison.differences = [
    { figmaText: '02 낮은 월납입금으로 BMW 이용', webText: '02 낮은 월납입금으로 이용', confidence: 'high' },
    { figmaText: 'BMW 뉴 iX, 월 50만원', webText: 'BMW 뉴 iX, 월 55만원', confidence: 'high' },
    { figmaText: '금리 4.9%', webText: '금리 5.1%', confidence: 'high' },
  ]

  const payload = buildAiReviewPayloadFromQaResult(qaResult)

  assert.equal(payload.visualEvidence.textDifferences[0].category, 'copy')
  assert.equal(payload.visualEvidence.textDifferences[0].severity, 'warning')
  assert.deepEqual(payload.visualEvidence.textDifferences.slice(1).map((item) => item.category), ['numeric', 'numeric'])
  assert.deepEqual(payload.visualEvidence.textDifferences.slice(1).map((item) => item.severity), ['critical', 'critical'])
})

test('AI Review payload forwards CTA and media descendant boxes for hero crop', () => {
  const qaResult = createQaResult()
  qaResult.visual.result.aiHints.heroCtaGroup = {
    countDifference: 0,
    figma: { count: 1, actions: [{ source: 'figma', text: 'Apply', role: 'primary-action', href: '/apply', comparisonScope: 'primary', xRatio: 0.1, yRatio: 0.23, widthRatio: 0.16, heightRatio: 0.04 }] },
    web: { count: 1, actions: [{ source: 'web', text: 'Apply', role: 'primary-action', href: '/apply', comparisonScope: 'primary', xRatio: 0.1, yRatio: 0.25, widthRatio: 0.16, heightRatio: 0.04 }] },
  }
  qaResult.visual.result.aiHints.heroMediaGroup = {
    comparisonHint: 'figma-image-vs-web-video',
    figma: { mediaTypes: ['image'], primaryCandidates: [{ source: 'figma', type: 'image', xRatio: 0.5, yRatio: 0.28, widthRatio: 0.4, heightRatio: 0.18 }] },
    web: { mediaTypes: ['video'], primaryCandidates: [{ source: 'web', type: 'video', xRatio: 0.5, yRatio: 0.3, widthRatio: 0.4, heightRatio: 0.18 }] },
  }

  const payload = buildAiReviewPayloadFromQaResult(qaResult)

  assert.equal(payload.visualEvidence.cta.figmaActions[0].widthRatio, 0.16)
  assert.equal(payload.visualEvidence.media.webPrimaryCandidates[0].heightRatio, 0.18)
  assert.deepEqual(payload.visualEvidence.hero.descendants.map((item) => `${item.source}:${item.kind}`), ['figma:cta', 'web:cta', 'figma:media', 'web:media'])
})

test('AI Review payload forwards text descendants and ratio or px bbox fields generically', () => {
  const qaResult = createQaResult()
  qaResult.visual.result.aiHints.canonicalEvidence.texts = [
    { source: 'figma', text: 'Generic headline', role: 'heading', sectionId: 'figma-hero', x: 100, y: 260, width: 500, height: 80 },
    { source: 'web', text: 'Generic headline', role: 'heading', sectionId: 'web-hero', boundingBox: { x: 80, y: 280, width: 520, height: 70 } },
  ]
  qaResult.visual.result.aiHints.heroCtaGroup = {
    countDifference: 0,
    figma: { count: 1, actions: [{ source: 'figma', text: 'Start', role: 'primary-action', comparisonScope: 'primary', x: 120, y: 720, width: 220, height: 64 }] },
    web: { count: 1, actions: [{ source: 'web', text: 'Start', role: 'primary-action', comparisonScope: 'primary', rect: { left: 130, top: 740, width: 210, height: 60 } }] },
  }
  qaResult.visual.result.aiHints.heroMediaGroup = {
    comparisonHint: '',
    figma: { mediaTypes: ['image'], primaryCandidates: [{ source: 'figma', type: 'image', xRatio: 0.5, yRatio: 0.2, widthRatio: 0.4, heightRatio: 0.2 }] },
    web: { mediaTypes: ['video'], primaryCandidates: [{ source: 'web', type: 'video', bounds: { left: 700, top: 360, right: 1100, bottom: 700 } }] },
  }

  const payload = buildAiReviewPayloadFromQaResult(qaResult)
  const descendants = payload.visualEvidence.hero.descendants

  assert.deepEqual(descendants.map((item) => `${item.source}:${item.kind}`), ['figma:text', 'web:text', 'figma:cta', 'web:cta', 'figma:media', 'web:media'])
  assert.equal(descendants.find((item) => item.source === 'figma' && item.kind === 'text').y, 260)
  assert.equal(descendants.find((item) => item.source === 'web' && item.kind === 'text').height, 70)
  assert.equal(descendants.find((item) => item.source === 'figma' && item.kind === 'media').yRatio, 0.2)
  assert.equal(descendants.find((item) => item.source === 'web' && item.kind === 'media').height, 340)
})

test('AI Review payload handler reuses qa builder once and never calls OpenAI', async () => {
  const calls = { qa: 0, openAi: 0 }
  const handler = createAiReviewPayloadHandler({
    isHttpUrl(value) {
      return /^https?:\/\//.test(String(value || ''))
    },
    async buildQaRunResponse(input) {
      calls.qa += 1
      assert.equal(input.webUrl, 'https://example.com')
      return createQaResult()
    },
    qaRunDependencies: {},
    openAi() {
      calls.openAi += 1
    },
  })
  const response = createMockResponse()

  await handler({ body: { webUrl: 'https://example.com', figmaUrl: 'https://figma.example/file' } }, response)

  assert.equal(response.statusCode, 200)
  assert.equal(response.body.success, true)
  assert.equal(response.body.openAiCalled, false)
  assert.equal(response.body.payload.meta.openAiCalled, false)
  assert.equal(calls.qa, 1)
  assert.equal(calls.openAi, 0)
})

test('AI Review handler runs QA once and returns structured review with openAiCalled true', async () => {
  const calls = { qa: 0, review: 0 }
  const handler = createAiReviewHandler({
    isHttpUrl(value) {
      return /^https?:\/\//.test(String(value || ''))
    },
    async buildQaRunResponse(input) {
      calls.qa += 1
      assert.equal(input.webUrl, 'https://example.com')
      return createQaResult()
    },
    qaRunDependencies: {},
    aiReviewService: {
      async review(payload) {
        calls.review += 1
        assert.equal(payload.meta.openAiCalled, false)
        return {
          meta: { openAiCalled: true, model: 'test-model', visionUsed: false, imageInputCount: 0, aiReviewDurationMs: 12 },
          review: {
            releaseDecision: 'caution',
            summary: 'Review summary',
            mustFix: ['Fix critical mismatch'],
            verify: ['Run regression'],
            developerNotes: ['No extra scan'],
            visualDifferences: [],
            clientReplyDraft: 'We recommend a focused fix pass before release.',
          },
        }
      },
    },
  })
  const response = createMockResponse()

  await handler({ body: { webUrl: 'https://example.com', figmaUrl: 'https://figma.example/file' } }, response)

  assert.equal(response.statusCode, 200)
  assert.equal(response.body.success, true)
  assert.equal(response.body.meta.openAiCalled, true)
  assert.equal(response.body.meta.visionUsed, false)
  assert.equal(response.body.meta.imageInputCount, 0)
  assert.equal(response.body.meta.aiReviewDurationMs, 12)
  assert.equal(response.body.meta.fallbackStage, '')
  assert.equal(response.body.meta.fallbackReason, '')
  assert.equal(response.body.meta.openAiRequestDurationMs, 0)
  assert.equal(response.body.meta.openAiResponseReceived, false)
  assert.equal(response.body.meta.openAiResponseParsed, false)
  assert.equal(response.body.meta.webScanInvocationCount, 1)
  assert.equal(response.body.meta.browserLaunchCount, 1)
  assert.equal(response.body.meta.desktopPageCount, 1)
  assert.equal(response.body.meta.mobilePageCount, 1)
  assert.equal(response.body.review.releaseDecision, 'caution')
  assert.equal(response.body.releaseDecision, undefined)
  assert.equal(typeof response.body.review.summary, 'string')
  assert.equal(Array.isArray(response.body.review.mustFix), true)
  assert.equal(Array.isArray(response.body.review.verify), true)
  assert.equal(Array.isArray(response.body.review.developerNotes), true)
  assert.equal(typeof response.body.review.clientReplyDraft, 'string')
  assert.equal(calls.qa, 1)
  assert.equal(calls.review, 1)
})

test('AI Review handler returns fallback review when OpenAI fails', async () => {
  const handler = createAiReviewHandler({
    isHttpUrl(value) {
      return /^https?:\/\//.test(String(value || ''))
    },
    async buildQaRunResponse() {
      return createQaResult()
    },
    qaRunDependencies: {},
    aiReviewService: {
      async review() {
        const error = new Error('OpenAI unavailable')
        error.code = 'openai_review_failed'
        error.openAiCalled = true
        throw error
      },
    },
  })
  const response = createMockResponse()

  await handler({ body: { webUrl: 'https://example.com', figmaUrl: '' } }, response)

  assert.equal(response.statusCode, 200)
  assert.equal(response.body.success, true)
  assert.equal(response.body.meta.openAiCalled, true)
  assert.equal(response.body.meta.fallbackUsed, true)
  assert.equal(response.body.meta.fallbackStage, 'unknown')
  assert.equal(response.body.meta.fallbackReason, 'openai_review_failed')
  assert.equal(response.body.meta.visionFailureReason, 'image-input-not-attached')
  assert.equal(response.body.review.releaseDecision, 'blocked')
  assert.equal(response.body.error.code, 'openai_review_failed')
})

test('AI Review from-payload calls OpenAI once without QA scan', async () => {
  const calls = { review: 0 }
  const handler = createAiReviewFromPayloadHandler({
    aiReviewService: {
      async review(payload) {
        calls.review += 1
        assert.equal(payload.meta.webUrl, 'https://example.com')
        return {
          meta: { openAiCalled: true, model: 'test-model', visionUsed: false, imageInputCount: 0, aiReviewDurationMs: 8 },
          review: {
            releaseDecision: 'ready',
            summary: '배포 차단 이슈가 없습니다.',
            mustFix: [],
            verify: [],
            developerNotes: [],
            visualDifferences: [],
            clientReplyDraft: '확인된 주요 차단 이슈는 없습니다.',
          },
        }
      },
    },
  })
  const response = createMockResponse()

  await handler({ body: { payload: buildAiReviewPayloadFromQaResult(createQaResult()) } }, response)

  assert.equal(response.body.success, true)
  assert.equal(response.body.meta.openAiCalled, true)
  assert.equal(response.body.meta.fallbackUsed, false)
  assert.equal(response.body.meta.fallbackStage, '')
  assert.equal(response.body.meta.fallbackReason, '')
  assert.equal(response.body.meta.visionUsed, false)
  assert.equal(response.body.meta.imageInputCount, 0)
  assert.equal(response.body.meta.visionFailureReason, 'image-input-not-attached')
  assert.equal(response.body.review.releaseDecision, 'ready')
  assert.equal(calls.review, 1)
})

test('AI Review from-payload prepares vision once and does not expose image data in response', async () => {
  const calls = { review: 0, vision: 0 }
  const handler = createAiReviewFromPayloadHandler({
    visualVisionService: {
      async attachVisionInput(payload) {
        calls.vision += 1
        return { payload: { ...payload, visionInput: { enabled: true, images: [
          { label: 'figma-overview', dataUrl: 'data:image/jpeg;base64,AAA', width: 100, height: 300, detail: 'low' },
          { label: 'web-overview', dataUrl: 'data:image/jpeg;base64,BBB', width: 100, height: 300, detail: 'low' },
          { label: 'figma-hero', dataUrl: 'data:image/jpeg;base64,CCC', width: 160, height: 90, detail: 'high' },
          { label: 'web-hero', dataUrl: 'data:image/jpeg;base64,DDD', width: 160, height: 90, detail: 'high' },
        ] } }, meta: { visionPrepared: true, figmaImagePrepared: true, webImagePrepared: true, visionInputSummary: [
          { label: 'figma-overview', width: 100, height: 300, detail: 'low' },
          { label: 'web-overview', width: 100, height: 300, detail: 'low' },
          { label: 'figma-hero', width: 160, height: 90, detail: 'high' },
          { label: 'web-hero', width: 160, height: 90, detail: 'high' },
        ] } }
      },
    },
    aiReviewService: {
      async review(payload) {
        calls.review += 1
        assert.equal(payload.visionInput.images[0].dataUrl.startsWith('data:image/jpeg'), true)
        return { meta: { openAiCalled: true, model: 'test-model', visionUsed: true, imageInputCount: 4, rawVisionCount: 1, aiReviewDurationMs: 25 }, review: { releaseDecision: 'caution', summary: 'Vision checked', mustFix: [], verify: [], developerNotes: [], visualDifferences: [{ area: 'Main Visual', category: 'Media', title: 'Hero media differs', summary: 'Image versus video.', figmaValue: 'Image', webValue: 'Video', severity: 'warning', confidence: 'high', order: 0 }], clientReplyDraft: '' } }
      },
    },
  })
  const response = createMockResponse()

  await handler({ body: { payload: buildAiReviewPayloadFromQaResult(createQaResult()) } }, response)

  assert.equal(calls.vision, 1)
  assert.equal(calls.review, 1)
  assert.equal(response.body.meta.visionPrepared, true)
  assert.equal(response.body.meta.visionUsed, true)
  assert.equal(response.body.meta.imageInputCount, 4)
  assert.equal(response.body.meta.rawVisionCount, 1)
  assert.equal(response.body.meta.visionInputSummary.length, 4)
  assert.equal(response.body.meta.figmaImagePrepared, true)
  assert.equal(response.body.meta.webImagePrepared, true)
  assert.equal(JSON.stringify(response.body).includes('data:image'), false)
  assert.equal(response.body.review.visualDifferences[0].title, 'Hero media differs')
})

test('AI Review fallback response exposes diagnostic meta and safe log fields', async () => {
  const logs = []
  const originalInfo = console.info
  console.info = (message) => logs.push(String(message))
  const handler = createAiReviewFromPayloadHandler({
    visualVisionService: {
      async attachVisionInput(payload) {
        return { payload: { ...payload, visionInput: { enabled: true, images: [{ label: 'figma-overview', dataUrl: 'data:image/jpeg;base64,AAA', width: 100, height: 300, detail: 'low' }] } }, meta: { visionPrepared: true, figmaImagePrepared: true, webImagePrepared: true, visionInputSummary: [{ label: 'figma-overview', width: 100, height: 300, detail: 'low' }] } }
      },
    },
    aiReviewService: {
      async review() {
        const error = new Error('timeout')
        error.code = 'openai_timeout'
        error.openAiCalled = true
        error.visionUsed = true
        error.imageInputCount = 1
        error.aiReviewDurationMs = 181464
        error.openAiRequestDurationMs = 180001
        error.openAiResponseReceived = false
        error.openAiResponseParsed = false
        error.fallbackStage = 'openai-timeout'
        error.fallbackReason = 'timeout'
        throw error
      },
    },
  })
  const response = createMockResponse()

  try {
    await handler({ body: { payload: buildAiReviewPayloadFromQaResult(createQaResult()) } }, response)
  } finally {
    console.info = originalInfo
  }

  assert.equal(response.body.meta.fallbackUsed, true)
  assert.equal(response.body.meta.fallbackStage, 'openai-timeout')
  assert.equal(response.body.meta.fallbackReason, 'timeout')
  assert.equal(response.body.meta.openAiRequestDurationMs, 180001)
  assert.equal(response.body.meta.openAiResponseReceived, false)
  assert.equal(response.body.meta.openAiResponseParsed, false)
  assert.equal(response.body.meta.visionFailureReason, 'openai-failed')
  assert.equal(logs.at(-1), '[AI Review] called=true vision=true images=1 fallback=true stage=openai-timeout reason=timeout durationMs=181464')
  assert.equal(JSON.stringify(response.body).includes('data:image'), false)
})

test('AI Review schema fallback keeps parsed response meta and stage-specific vision reason', async () => {
  const handler = createAiReviewFromPayloadHandler({
    visualVisionService: {
      async attachVisionInput(payload) {
        return { payload: { ...payload, visionInput: { enabled: true, images: [
          { label: 'figma-overview', dataUrl: 'data:image/jpeg;base64,AAA', width: 100, height: 300, detail: 'low' },
          { label: 'web-overview', dataUrl: 'data:image/jpeg;base64,BBB', width: 100, height: 300, detail: 'low' },
          { label: 'figma-hero', dataUrl: 'data:image/jpeg;base64,CCC', width: 160, height: 90, detail: 'high' },
          { label: 'web-hero', dataUrl: 'data:image/jpeg;base64,DDD', width: 160, height: 90, detail: 'high' },
        ] } }, meta: { visionPrepared: true, figmaImagePrepared: true, webImagePrepared: true, visionInputSummary: [
          { label: 'figma-overview', width: 100, height: 300, detail: 'low' },
          { label: 'web-overview', width: 100, height: 300, detail: 'low' },
          { label: 'figma-hero', width: 160, height: 90, detail: 'high' },
          { label: 'web-hero', width: 160, height: 90, detail: 'high' },
        ] } }
      },
    },
    aiReviewService: {
      async review() {
        const error = new Error('AI Review developerNotes 값이 올바르지 않습니다.')
        error.code = 'invalid_ai_schema'
        error.openAiCalled = true
        error.visionUsed = true
        error.imageInputCount = 4
        error.model = 'test-model'
        error.aiReviewDurationMs = 18800
        error.openAiRequestDurationMs = 18780
        error.openAiResponseReceived = true
        error.openAiResponseParsed = true
        error.fallbackStage = 'schema-validation'
        error.fallbackReason = 'invalid_ai_schema'
        throw error
      },
    },
  })
  const response = createMockResponse()

  await handler({ body: { payload: buildAiReviewPayloadFromQaResult(createQaResult()) } }, response)

  assert.equal(response.body.meta.openAiCalled, true)
  assert.equal(response.body.meta.visionUsed, true)
  assert.equal(response.body.meta.imageInputCount, 4)
  assert.equal(response.body.meta.model, 'test-model')
  assert.equal(response.body.meta.openAiRequestDurationMs, 18780)
  assert.equal(response.body.meta.openAiResponseReceived, true)
  assert.equal(response.body.meta.openAiResponseParsed, true)
  assert.equal(response.body.meta.fallbackStage, 'schema-validation')
  assert.equal(response.body.meta.fallbackReason, 'invalid_ai_schema')
  assert.equal(response.body.meta.visionFailureReason, 'schema-validation')
})

function createQaResult() {
  return {
    meta: { webScanInvocationCount: 1, openAiCalled: false, browserLaunchCount: 1, desktopPageCount: 1, mobilePageCount: 1 },
    visual: {
      status: 'success',
      result: {
        meta: { payloadVersion: '1.0', webUrl: 'https://example.com', figmaNodeId: '1:2', openAiCalled: false },
        figma: { displayImageUrl: '/api/figma/render/render-1', localImagePath: '.cache/figma/renders/render-1.png', renderId: 'render-1', figmaStructure: { raw: true } },
        web: { displayImageUrl: '/api/visual/screenshot/aaaaaaaaaaaaaaaaaaaaaaaa.png', screenshot: { dataUrl: 'data:image/png;base64,AAAA' } },
        comparison: {
          differenceCount: 3,
          differences: [
            { figmaText: '월 47만원', webText: '월 50만원', confidence: 'high', webSelector: '#price' },
            { figmaText: '월 47만원', webText: '월 50만원', confidence: 'high', webSelector: '#price' },
            { figmaText: 'Apply now', webText: 'Apply', confidence: 'medium' },
          ],
        },
        aiHints: {
          evidenceSummary: { hero: { figmaTextCount: 2, webTextCount: 2, figmaCtaCount: 2, webCtaCount: 2, webPrimaryMediaCount: 1 }, content: { figmaImageCount: 1, webImageCount: 1, webVideoCount: 1 } },
          heroCtaGroup: { countDifference: 0, figma: { count: 2, actions: [{ text: 'Apply', role: 'primary-action', href: '/apply' }] }, web: { count: 2, actions: [{ text: 'Apply', role: 'primary-action', href: '/apply' }] } },
          heroSection: { figmaSectionId: 'figma-hero', webSectionId: 'web-hero', confidence: 'high', sections: [{ sectionId: 'figma-hero', source: 'figma', role: 'hero', xRatio: 0, yRatio: 0, widthRatio: 1, heightRatio: 0.2, confidence: 'high' }, { sectionId: 'web-hero', source: 'web', role: 'hero', xRatio: 0, yRatio: 0, widthRatio: 1, heightRatio: 0.2, confidence: 'high' }] },
          prices: Array.from({ length: 12 }, (_, index) => ({ source: 'web', numericType: 'amount', displayText: `Price ${index}` })),
          heroMediaGroup: { comparisonHint: 'figma-image-vs-web-video', figma: { mediaTypes: ['image'] }, web: { mediaTypes: ['video'] } },
          canonicalEvidence: { raw: '<html>raw</html>' },
        },
      },
    },
    tech: {
      status: 'success',
      result: {
        targetUrl: 'https://example.com',
        checks: [
          { id: 'access', status: 'ok', value: '접속 가능', detail: 'ok' },
          { id: 'http-status', status: 'ok', value: '200', detail: '메인 문서 응답 코드 200' },
          { id: 'console-errors', status: 'error', value: '1건', detail: 'console error', items: [{ source: 'page', message: 'fatal error secret-token', url: 'C:\\secret\\file.js' }] },
          { id: 'images', status: 'error', value: '1건 실패', detail: 'image failed', items: [{ src: 'https://example.com/broken.png', message: 'failed' }] },
          { id: 'bad-links', status: 'warn', value: '1개 오류', detail: 'bad links', items: [{ url: 'https://example.com/404', statusCode: 404, message: '404' }, { url: 'https://example.com/404', statusCode: 404, message: '404' }] },
          { id: 'meta', status: 'warn', value: '1개', detail: 'missing meta', items: [{ label: 'og:image', message: 'missing' }] },
          { id: 'image-alt', status: 'warn', value: '1개', detail: 'alt', items: [{ alt: '', src: '.cache/visual/screenshots/local.png', selector: '#hero img' }] },
        ],
      },
    },
  }
}

function createMockResponse() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code
      return this
    },
    json(payload) {
      this.body = payload
      return this
    },
  }
}
