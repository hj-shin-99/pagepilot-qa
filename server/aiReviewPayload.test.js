import test from 'node:test'
import assert from 'node:assert/strict'
import { buildAiReviewPayloadFromQaResult, createAiReviewHandler, createAiReviewPayloadHandler } from './aiReviewPayload.js'

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
})

test('AI Review payload dedupes visual and tech issue evidence', () => {
  const payload = buildAiReviewPayloadFromQaResult(createQaResult())

  assert.equal(payload.visualEvidence.textDifferences.length, 2)
  assert.equal(payload.techEvidence.brokenLinks.length, 1)
  assert.equal(payload.releaseDecisionInput.techErrorCount, 2)
  assert.equal(payload.releaseDecisionInput.techWarningCount, 3)
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
          meta: { openAiCalled: true, model: 'test-model' },
          review: {
            releaseDecision: 'caution',
            summary: 'Review summary',
            mustFix: ['Fix critical mismatch'],
            verify: ['Run regression'],
            developerNotes: ['No extra scan'],
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
  assert.equal(response.body.meta.webScanInvocationCount, 1)
  assert.equal(response.body.meta.browserLaunchCount, 1)
  assert.equal(response.body.meta.desktopPageCount, 1)
  assert.equal(response.body.meta.mobilePageCount, 1)
  assert.equal(response.body.releaseDecision, 'caution')
  assert.equal(typeof response.body.summary, 'string')
  assert.equal(Array.isArray(response.body.mustFix), true)
  assert.equal(Array.isArray(response.body.verify), true)
  assert.equal(Array.isArray(response.body.developerNotes), true)
  assert.equal(typeof response.body.clientReplyDraft, 'string')
  assert.equal(calls.qa, 1)
  assert.equal(calls.review, 1)
})

test('AI Review handler returns success false when OpenAI fails', async () => {
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
  assert.equal(response.body.success, false)
  assert.equal(response.body.meta.openAiCalled, true)
  assert.equal(response.body.error.code, 'openai_review_failed')
})

function createQaResult() {
  return {
    meta: { webScanInvocationCount: 1, openAiCalled: false, browserLaunchCount: 1, desktopPageCount: 1, mobilePageCount: 1 },
    visual: {
      status: 'success',
      result: {
        meta: { payloadVersion: '1.0', webUrl: 'https://example.com', figmaNodeId: '1:2', openAiCalled: false },
        figma: { displayImageUrl: '/api/figma/render/render-1', localImagePath: '.cache/figma/renders/render-1.png', figmaStructure: { raw: true } },
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
