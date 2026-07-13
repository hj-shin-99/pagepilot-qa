import test from 'node:test'
import assert from 'node:assert/strict'
import { buildQaRunResponse } from './qaRunRoute.js'

function createDependencies(overrides = {}) {
  const calls = { scanUrl: 0, visual: 0, visualScanResult: null }
  const scanResult = overrides.scanResult || {
    targetUrl: 'https://example.com',
    scannedAt: '2026-07-13T00:00:00.000Z',
    pageTitle: 'Example',
    httpStatus: 200,
    accessible: true,
    navigationError: '',
    checks: [{ id: 'access', status: 'ok', title: '접속', value: '가능', detail: '' }],
    links: [],
    missingHrefLinks: [],
    images: [],
    consoleMessages: [],
    counts: { anchors: 1, buttons: 1 },
    mobile: { viewport: { width: 390, height: 844 }, statusCode: 200, note: 'ok' },
    webScreenshot: { dataUrl: 'data:image/png;base64,AAAA', viewport: { width: 1920, height: 1080 } },
    visualPayloadData: { textNodes: [{ text: 'Hero' }], playwrightRunCount: 1 },
  }

  const dependencies = {
    now: (() => {
      let current = Date.parse('2026-07-13T00:00:00.000Z')
      return () => {
        current += 10
        return current
      }
    })(),
    isHttpUrl(value) {
      return /^https?:\/\//.test(String(value || ''))
    },
    async scanUrl(url, options) {
      calls.scanUrl += 1
      calls.scanArgs = { url, options }
      if (options.instrumentation) {
        options.instrumentation.browserLaunchCount = 1
        options.instrumentation.desktopPageCount = 1
        options.instrumentation.mobilePageCount = options.includeMobile ? 1 : 0
      }
      if (overrides.scanThrows) throw new Error('scan failed')
      return scanResult
    },
    isWebScanNavigationFailure(result) {
      return !result?.httpStatus && Boolean(result?.navigationError)
    },
    async buildVisualPayloadFromScanResult(input) {
      calls.visual += 1
      calls.visualScanResult = input.scanResult
      if (overrides.visualThrows) throw new Error('figma failed')
      return overrides.visualResult || {
        meta: { webUrl: input.webUrl, playwrightRunCount: 1, openAiCalled: false },
        comparison: { differenceCount: 3 },
        aiHints: {
          evidenceSummary: { hero: { webPrimaryMediaCount: 1 }, numeric: { priceCount: 3 } },
          heroCtaGroup: { figma: { count: 2 }, web: { count: 2 } },
        },
      }
    },
  }

  return { calls, dependencies, scanResult }
}

test('/api/qa/run builder calls scanUrl once and reuses scanResult for visual', async () => {
  const { calls, dependencies, scanResult } = createDependencies()
  const result = await buildQaRunResponse({ webUrl: 'https://example.com', figmaUrl: 'https://www.figma.com/design/a?node-id=1-2' }, dependencies)

  assert.equal(calls.scanUrl, 1)
  assert.equal(calls.scanArgs.options.includeVisualPayloadData, true)
  assert.equal(calls.scanArgs.options.includeMobile, true)
  assert.equal(calls.visual, 1)
  assert.equal(calls.visualScanResult, scanResult)
  assert.equal(result.tech.status, 'success')
  assert.equal(result.visual.status, 'success')
  assert.equal(result.meta.webScanInvocationCount, 1)
  assert.equal(result.meta.browserLaunchCount, 1)
  assert.equal(result.meta.desktopPageCount, 1)
  assert.equal(result.meta.mobilePageCount, 1)
  assert.equal(result.meta.openAiCalled, false)
})

test('/api/qa/run builder skips visual when figmaUrl is empty', async () => {
  const { calls, dependencies } = createDependencies()
  const result = await buildQaRunResponse({ webUrl: 'https://example.com', figmaUrl: '' }, dependencies)

  assert.equal(calls.scanUrl, 1)
  assert.equal(calls.scanArgs.options.includeVisualPayloadData, false)
  assert.equal(calls.visual, 0)
  assert.equal(result.tech.status, 'success')
  assert.equal(result.visual.status, 'skipped')
})

test('/api/qa/run builder marks tech and visual error when navigation failed', async () => {
  const { calls, dependencies } = createDependencies({
    scanResult: {
      targetUrl: 'https://example.com',
      httpStatus: null,
      navigationError: 'net::ERR_NAME_NOT_RESOLVED',
      checks: [],
      links: [],
      images: [],
    },
  })
  const result = await buildQaRunResponse({ webUrl: 'https://example.com', figmaUrl: 'https://www.figma.com/design/a?node-id=1-2' }, dependencies)

  assert.equal(calls.scanUrl, 1)
  assert.equal(calls.visual, 0)
  assert.equal(result.tech.status, 'error')
  assert.equal(result.tech.result, null)
  assert.equal(result.visual.status, 'error')
  assert.equal(result.visual.result, null)
  assert.equal(result.tech.error.includes('Web 페이지에 접속하지 못해 Tech QA를 수행할 수 없습니다.'), true)
})

test('/api/qa/run builder keeps tech result when visual build fails', async () => {
  const { dependencies } = createDependencies({ visualThrows: true })
  const result = await buildQaRunResponse({ webUrl: 'https://example.com', figmaUrl: 'https://www.figma.com/design/a?node-id=1-2' }, dependencies)

  assert.equal(result.tech.status, 'success')
  assert.equal(result.tech.result.targetUrl, 'https://example.com')
  assert.equal(result.visual.status, 'error')
  assert.equal(result.visual.error, 'figma failed')
})

test('/api/qa/run builder preserves visual regression summary values from shared scan result', async () => {
  const { dependencies } = createDependencies()
  const result = await buildQaRunResponse({ webUrl: 'https://example.com', figmaUrl: 'https://www.figma.com/design/a?node-id=1-2' }, dependencies)

  assert.equal(result.visual.result.comparison.differenceCount, 3)
  assert.equal(result.visual.result.aiHints.heroCtaGroup.figma.count, 2)
  assert.equal(result.visual.result.aiHints.heroCtaGroup.web.count, 2)
  assert.equal(result.visual.result.aiHints.evidenceSummary.hero.webPrimaryMediaCount, 1)
  assert.equal(result.visual.result.aiHints.evidenceSummary.numeric.priceCount, 3)
})
