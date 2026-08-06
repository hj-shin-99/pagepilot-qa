import test from 'node:test'
import assert from 'node:assert/strict'
import { MAX_DEVICE_SCAN_CONCURRENCY, buildQaRunResponse, createQaRunStreamHandler, runWithConcurrency } from './qaRunRoute.js'

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
      calls.scanArgsList = [...(calls.scanArgsList || []), { url, options }]
      calls.scanArgs = { url, options }
      if (options.instrumentation) {
        options.instrumentation.browserLaunchCount = 1
        options.instrumentation.desktopPageCount = 1
        options.instrumentation.mobilePageCount = options.includeMobile ? 1 : 0
      }
      if (overrides.scanThrows) throw new Error('scan failed')
      const result = typeof overrides.scanResultFactory === 'function' ? overrides.scanResultFactory(url, options, calls.scanUrl) : scanResult
      result.scanOptions = options.techScanOptions
      return result
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
  const result = await buildQaRunResponse({ webUrl: 'https://example.com', figmaUrl: 'https://www.figma.com/design/a?node-id=1-2', scanOptions: { url: false, click: true } }, dependencies)

  assert.equal(calls.scanUrl, 1)
  assert.equal(calls.scanArgs.options.deviceId, 'desktop')
  assert.equal(calls.scanArgs.options.includeVisualPayloadData, true)
  assert.equal(calls.scanArgs.options.includeMobile, true)
  assert.deepEqual(calls.scanArgs.options.techScanOptions, {
    url: false,
    click: true,
    landing: true,
    form: true,
    hover: true,
    modal: true,
    scroll: true,
    responsive: true,
    download: true,
    cookie: true,
    image: true,
    performance: true,
    seo: true,
    markup: true,
  })
  assert.equal(calls.visual, 1)
  assert.equal(calls.visualScanResult.targetUrl, scanResult.targetUrl)
  assert.equal(calls.visualScanResult.deviceId, 'desktop')
  assert.equal(result.tech.status, 'success')
  assert.equal(result.tech.result.scanOptions.url, false)
  assert.equal(result.visual.status, 'success')
  assert.equal(result.meta.webScanInvocationCount, 1)
  assert.equal(result.meta.browserLaunchCount, 1)
  assert.equal(result.meta.desktopPageCount, 1)
  assert.equal(result.meta.mobilePageCount, 1)
  assert.equal(result.meta.openAiCalled, false)
  assert.deepEqual(result.devices, ['desktop'])
  assert.equal(result.deviceResults.length, 1)
})

test('/api/qa/run builder skips visual when figmaUrl is empty', async () => {
  const { calls, dependencies } = createDependencies()
  const result = await buildQaRunResponse({ webUrl: 'https://example.com', figmaUrl: '' }, dependencies)

  assert.equal(calls.scanUrl, 1)
  assert.equal(calls.scanArgs.options.includeVisualPayloadData, false)
  assert.equal(calls.visual, 0)
  assert.equal(result.tech.status, 'success')
  assert.equal(result.visual.status, 'skipped')
  assert.deepEqual(result.devices, ['desktop'])
})

test('/api/qa/run builder defaults missing or invalid scan options to full selection', async () => {
  const { calls, dependencies } = createDependencies()
  await buildQaRunResponse({ webUrl: 'https://example.com', figmaUrl: '', scanOptions: { url: false, click: 'nope', unknown: false } }, dependencies)

  assert.deepEqual(calls.scanArgs.options.techScanOptions, {
    url: false,
    click: true,
    landing: true,
    form: true,
    hover: true,
    modal: true,
    scroll: true,
    responsive: true,
    download: true,
    cookie: true,
    image: true,
    performance: true,
    seo: true,
    markup: true,
  })
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

test('/api/qa/run builder emits monotonic selected-unit progress without changing result shape', async () => {
  const events = []
  const { calls, dependencies } = createDependencies()
  const scanOptions = {
    url: false,
    click: true,
    landing: false,
    form: false,
    hover: false,
    modal: false,
    scroll: false,
    responsive: false,
    download: false,
    cookie: false,
    image: false,
    performance: false,
    seo: false,
    markup: false,
  }

  dependencies.scanUrl = async (url, options) => {
    calls.scanUrl += 1
    calls.scanArgs = { url, options }
    options.onProgress('web_collect')
    options.onProgress('page_structure')
    options.onProgress('tech_click')
    return {
      targetUrl: url,
      httpStatus: 200,
      accessible: true,
      navigationError: '',
      checks: [],
      links: [],
      images: [],
      scanOptions: options.techScanOptions,
    }
  }

  const result = await buildQaRunResponse({ webUrl: 'https://example.com', figmaUrl: '', scanOptions, onProgress: (event) => events.push(event) }, dependencies)

  assert.equal(result.tech.status, 'success')
  assert.deepEqual(events.map((event) => event.completedUnits), [0, 1, 2, 3, 4])
  assert.equal(events.every((event) => event.totalUnits === 4), true)
  assert.deepEqual(events.map((event) => event.stage), ['web_collect', 'web_collect', 'page_structure', 'tech_audit', 'result_prepare'])
  assert.equal(events[0].deviceId, 'desktop')
})

test('/api/qa/run builder runs selected devices independently and preserves partial failures', async () => {
  const { calls, dependencies } = createDependencies({
    scanResultFactory(url, options) {
      if (options.deviceId === 'tablet') throw new Error('Timeout 15000ms exceeded')
      return {
        targetUrl: url,
        scannedAt: '2026-07-13T00:00:00.000Z',
        pageTitle: options.deviceId,
        httpStatus: 200,
        accessible: true,
        navigationError: '',
        checks: [],
        links: [],
        images: [],
        counts: { anchors: 0, buttons: 0 },
      }
    },
  })

  const result = await buildQaRunResponse({ webUrl: 'https://example.com', figmaUrl: '', devices: ['mobile', 'desktop', 'tablet'] }, dependencies)

  assert.deepEqual(calls.scanArgsList.map((entry) => entry.options.deviceId), ['desktop', 'tablet', 'mobile'])
  assert.equal(result.tech.status, 'success')
  assert.deepEqual(result.devices, ['desktop', 'tablet', 'mobile'])
  assert.equal(result.deviceResults.length, 3)
  assert.equal(result.deviceResults.find((entry) => entry.deviceId === 'tablet').status, 'error')
  assert.equal(result.deviceResults.find((entry) => entry.deviceId === 'mobile').status, 'success')
  assert.equal(result.tech.result.deviceResults.length, 3)
})

test('/api/qa/run builder falls back legacy missing devices to desktop only', async () => {
  const { calls, dependencies } = createDependencies()

  await buildQaRunResponse({ webUrl: 'https://example.com', figmaUrl: '', devices: [] }, dependencies)

  assert.deepEqual(calls.scanArgsList.map((entry) => entry.options.deviceId), ['desktop'])
})

test('/api/qa/run builder keeps Visual QA desktop-only when desktop was not selected', async () => {
  const { calls, dependencies } = createDependencies({
    scanResultFactory(url, options) {
      return {
        targetUrl: url,
        scannedAt: '2026-07-13T00:00:00.000Z',
        pageTitle: options.deviceId,
        httpStatus: 200,
        accessible: true,
        navigationError: '',
        checks: [],
        links: [],
        images: [],
        counts: { anchors: 0, buttons: 0 },
        visualPayloadData: options.includeVisualPayloadData ? { textNodes: [{ text: 'Desktop' }] } : null,
      }
    },
  })

  const result = await buildQaRunResponse({ webUrl: 'https://example.com', figmaUrl: 'https://www.figma.com/design/a?node-id=1-2', devices: ['mobile'] }, dependencies)

  assert.deepEqual(calls.scanArgsList.map((entry) => entry.options.deviceId), ['mobile', 'desktop'])
  assert.equal(calls.visual, 1)
  assert.equal(calls.visualScanResult.deviceId, 'desktop')
  assert.deepEqual(result.devices, ['mobile'])
  assert.equal(result.deviceResults.length, 1)
})

test('/api/qa/run builder ignores progress callback failures', async () => {
  const { dependencies } = createDependencies()
  const result = await buildQaRunResponse({
    webUrl: 'https://example.com',
    figmaUrl: '',
    onProgress() {
      throw new Error('progress failed')
    },
  }, dependencies)

  assert.equal(result.tech.status, 'success')
})

test('/api/qa/run-stream writes progress and final result as NDJSON', async () => {
  const { dependencies } = createDependencies()
  const writes = []
  const headers = {}
  const res = {
    destroyed: false,
    writableEnded: false,
    statusCode: 0,
    status(code) {
      this.statusCode = code
      return this
    },
    setHeader(name, value) {
      headers[name] = value
    },
    flushHeaders() {},
    write(chunk) {
      writes.push(chunk)
    },
    end() {
      this.writableEnded = true
    },
  }

  const handler = createQaRunStreamHandler(dependencies)
  await handler({ body: { webUrl: 'https://example.com', figmaUrl: '', scanOptions: { url: false } } }, res)

  const events = writes.join('').trim().split('\n').map((line) => JSON.parse(line))
  assert.equal(res.statusCode, 200)
  assert.equal(headers['Content-Type'], 'application/x-ndjson; charset=utf-8')
  assert.equal(events[0].type, 'progress')
  assert.equal(events.at(-1).type, 'result')
  assert.equal(events.at(-1).result.tech.status, 'success')
})

test('bounded device worker pool uses max concurrency 1 for one device', async () => {
  const seen = await measureDeviceConcurrency(['desktop'])

  assert.equal(seen.maxActive, 1)
  assert.deepEqual(seen.starts, ['desktop'])
  assert.deepEqual(seen.result.deviceResults.map((entry) => entry.deviceId), ['desktop'])
})

test('bounded device worker pool uses max concurrency 2 for two devices', async () => {
  const seen = await measureDeviceConcurrency(['desktop', 'tablet'])

  assert.equal(seen.maxActive, 2)
  assert.deepEqual(seen.starts, ['desktop', 'tablet'])
  assert.deepEqual(seen.result.deviceResults.map((entry) => entry.deviceId), ['desktop', 'tablet'])
})

test('bounded device worker pool caps three devices at concurrency 2 and preserves result order', async () => {
  const seen = await measureDeviceConcurrency(['mobile', 'desktop', 'tablet'], { desktop: 30, tablet: 5, mobile: 1 })

  assert.equal(MAX_DEVICE_SCAN_CONCURRENCY, 2)
  assert.equal(seen.maxActive, 2)
  assert.deepEqual(seen.starts, ['desktop', 'tablet', 'mobile'])
  assert.notDeepEqual(seen.finishes, ['desktop', 'tablet', 'mobile'])
  assert.deepEqual(seen.result.devices, ['desktop', 'tablet', 'mobile'])
  assert.deepEqual(seen.result.deviceResults.map((entry) => entry.deviceId), ['desktop', 'tablet', 'mobile'])
})

test('bounded worker pool preserves result slots when completion order differs', async () => {
  const starts = []
  const result = await runWithConcurrency(['desktop', 'tablet', 'mobile'], 2, async (deviceId) => {
    starts.push(deviceId)
    await delay(deviceId === 'desktop' ? 20 : 1)
    return `${deviceId}:result`
  })

  assert.deepEqual(starts, ['desktop', 'tablet', 'mobile'])
  assert.deepEqual(result, ['desktop:result', 'tablet:result', 'mobile:result'])
})

test('/api/qa/run builder overlaps independent figma preparation after desktop scan while other devices continue', async () => {
  const events = []
  const { calls, dependencies } = createDependencies({
    scanResultFactory(url, options) {
      return {
        targetUrl: url,
        scannedAt: '2026-07-13T00:00:00.000Z',
        pageTitle: options.deviceId,
        httpStatus: 200,
        accessible: true,
        navigationError: '',
        checks: [],
        links: [],
        images: [],
        counts: { anchors: 0, buttons: 0 },
        visualPayloadData: options.includeVisualPayloadData ? { textNodes: [{ text: 'Desktop' }] } : null,
      }
    },
  })
  dependencies.prepareVisualFigmaData = async () => {
    events.push('figma:start')
    await delay(1)
    events.push('figma:end')
    return { fileKey: 'file', nodeId: '1:2', figmaResult: { textNodes: [], cache: {} }, figmaRender: { cache: {} }, timings: { figmaNodeLoadMs: 1, figmaRenderLoadMs: 1 } }
  }
  dependencies.scanUrl = async (url, options) => {
    calls.scanUrl += 1
    calls.scanArgsList = [...(calls.scanArgsList || []), { url, options }]
    events.push(`${options.deviceId}:start`)
    await delay(options.deviceId === 'desktop' ? 1 : options.deviceId === 'tablet' ? 20 : 1)
    events.push(`${options.deviceId}:end`)
    const result = dependencies.scanResultFactory?.(url, options) || {
      targetUrl: url,
      httpStatus: 200,
      accessible: true,
      navigationError: '',
      checks: [],
      links: [],
      images: [],
    }
    result.scanOptions = options.techScanOptions
    return result
  }
  dependencies.scanResultFactory = (url, options) => ({
    targetUrl: url,
    scannedAt: '2026-07-13T00:00:00.000Z',
    pageTitle: options.deviceId,
    httpStatus: 200,
    accessible: true,
    navigationError: '',
    checks: [],
    links: [],
    images: [],
    counts: { anchors: 0, buttons: 0 },
    visualPayloadData: options.includeVisualPayloadData ? { textNodes: [{ text: 'Desktop' }] } : null,
  })
  dependencies.buildVisualPayloadFromScanResult = async (input) => {
    assert.ok(input.figmaPreparationPromise)
    await input.figmaPreparationPromise
    events.push('visual:build')
    return { meta: { openAiCalled: false }, comparison: { differenceCount: 0 } }
  }

  const result = await buildQaRunResponse({ webUrl: 'https://example.com', figmaUrl: 'https://www.figma.com/design/a?node-id=1-2', devices: ['desktop', 'tablet', 'mobile'] }, dependencies)

  assert.equal(result.visual.status, 'success')
  assert.equal(events.indexOf('figma:start') > events.indexOf('desktop:end'), true)
  assert.equal(events.indexOf('figma:start') < events.indexOf('tablet:end'), true)
  assert.equal(events.indexOf('visual:build') > events.indexOf('figma:end'), true)
})

async function measureDeviceConcurrency(devices, delays = {}) {
  const { dependencies } = createDependencies()
  const starts = []
  const finishes = []
  let active = 0
  let maxActive = 0
  dependencies.scanUrl = async (url, options) => {
    starts.push(options.deviceId)
    active += 1
    maxActive = Math.max(maxActive, active)
    await delay(delays[options.deviceId] ?? 5)
    active -= 1
    finishes.push(options.deviceId)
    return {
      targetUrl: url,
      scannedAt: '2026-07-13T00:00:00.000Z',
      pageTitle: options.deviceId,
      httpStatus: 200,
      accessible: true,
      navigationError: '',
      checks: [],
      links: [],
      images: [],
      counts: { anchors: 0, buttons: 0 },
      scanOptions: options.techScanOptions,
    }
  }

  const result = await buildQaRunResponse({ webUrl: 'https://example.com', figmaUrl: '', devices }, dependencies)
  return { starts, finishes, maxActive, result }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
