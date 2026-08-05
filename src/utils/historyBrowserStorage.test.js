import test from 'node:test'
import assert from 'node:assert/strict'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, join, normalize, sep } from 'node:path'
import process from 'node:process'
import { chromium } from 'playwright'

const projectRoot = process.cwd()
const mimeTypes = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
])

test('chromium IndexedDB keeps five desktop tech history items', async () => {
  await withHistoryBrowser(async (page) => {
    const metrics = await runFiveItemBrowserScenario(page, 'desktop-tech', createTechHistoryFixture)
    logBrowserStorageMetrics('desktop-tech', metrics)
    assert.equal(metrics.fifthSave.trimmedCount, 0)
    assert.equal(metrics.fifthSave.afterInsertCount, 5)
    assert.equal(metrics.afterFive.length, 5)
    assert.deepEqual(metrics.afterFive.map((item) => item.id), ['desktop-tech-5', 'desktop-tech-4', 'desktop-tech-3', 'desktop-tech-2', 'desktop-tech-1'])
    assert.equal(metrics.afterReload.length, 5)
    assert.equal(metrics.sixthSave.afterInsertCount, 6)
    assert.equal(metrics.sixthSave.trimmedCount, 1)
    assert.deepEqual(metrics.afterSix.map((item) => item.id), ['desktop-tech-6', 'desktop-tech-5', 'desktop-tech-4', 'desktop-tech-3', 'desktop-tech-2'])
    assert.equal(metrics.otherStorageValue, 'preserved')
  })
})

test('chromium IndexedDB keeps five multi-device tech history items', async () => {
  await withHistoryBrowser(async (page) => {
    const metrics = await runFiveItemBrowserScenario(page, 'multi-tech', createMultiDeviceTechHistoryFixture)
    logBrowserStorageMetrics('multi-tech', metrics)
    assert.equal(metrics.fourthSave.trimmedCount, 0)
    assert.equal(metrics.fifthSave.trimmedCount, 0)
    assert.equal(metrics.afterFive.length, 5)
    assert.equal(metrics.afterReload.length, 5)
    assert.equal(metrics.sixthSave.afterInsertCount, 6)
    assert.equal(metrics.sixthSave.trimmedCount, 1)
    assert.equal(metrics.afterSix.length, 5)
    assert.equal(metrics.afterSix.some((item) => item.id === 'multi-tech-1'), false)
  })
})

test('chromium IndexedDB keeps five visual and multi-device tech history items', async () => {
  await withHistoryBrowser(async (page) => {
    const metrics = await runFiveItemBrowserScenario(page, 'combined', createCombinedHistoryFixture)
    logBrowserStorageMetrics('combined', metrics)
    assert.equal(metrics.fourthSave.trimmedCount, 0)
    assert.equal(metrics.fifthSave.trimmedCount, 0)
    assert.equal(metrics.afterFive.length, 5)
    assert.equal(metrics.afterReload.length, 5)
    assert.equal(metrics.sixthSave.afterInsertCount, 6)
    assert.equal(metrics.sixthSave.trimmedCount, 1)
    assert.equal(metrics.afterSix.length, 5)
    assert.equal(metrics.afterSix.some((item) => item.id === 'combined-1'), false)
  })
})

test('chromium IndexedDB keeps five large actual-shaped history items', async () => {
  await withHistoryBrowser(async (page) => {
    const metrics = await runFiveItemBrowserScenario(page, 'large-actual', createLargeActualHistoryFixture)
    logBrowserStorageMetrics('large-actual', metrics)
    assert.equal(metrics.fourthSave.trimmedCount, 0)
    assert.equal(metrics.fifthSave.trimmedCount, 0)
    assert.equal(metrics.afterFive.length, 5)
    assert.equal(metrics.afterReload.length, 5)
    assert.equal(metrics.sixthSave.afterInsertCount, 6)
    assert.equal(metrics.sixthSave.trimmedCount, 1)
    assert.equal(metrics.afterSix.length, 5)
  })
})

test('chromium IndexedDB keeps five same URL generated-id history items', async () => {
  await withHistoryBrowser(async (page) => {
    const metrics = await runGeneratedIdBrowserScenario(page)
    logGeneratedIdMetrics(metrics)
    assert.deepEqual(metrics.finalCounts, [1, 2, 3, 4, 5, 5])
    assert.equal(new Set(metrics.incomingIds).size, 6)
    assert.equal(metrics.afterSix.length, 5)
    assert.equal(metrics.afterSix.some((item) => item.id === metrics.incomingIds[0]), false)
    assert.deepEqual(metrics.afterSix.map((item) => item.id), metrics.incomingIds.slice(1).reverse())
    assert.equal(metrics.sixthSave.afterInsertCount, 6)
    assert.equal(metrics.sixthSave.trimmedCount, 1)
    assert.equal(metrics.afterReload.length, 5)
  })
})

async function withHistoryBrowser(run) {
  const server = await createStaticServer()
  const browser = await chromium.launch()
  const page = await browser.newPage()
  try {
    await page.goto(server.url)
    await run(page)
  } finally {
    await browser.close()
    await new Promise((resolve) => server.instance.close(resolve))
  }
}

async function createStaticServer() {
  const instance = createServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url || '/', 'http://127.0.0.1')
      const pathname = decodeURIComponent(requestUrl.pathname === '/' ? '/index.html' : requestUrl.pathname)
      if (pathname === '/index.html') {
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
        response.end('<!doctype html><meta charset="utf-8"><title>History storage test</title>')
        return
      }

      const filePath = normalize(join(projectRoot, pathname))
      if (!filePath.startsWith(`${projectRoot}${sep}`)) {
        response.writeHead(403)
        response.end('Forbidden')
        return
      }

      await stat(filePath)
      response.writeHead(200, { 'content-type': mimeTypes.get(extname(filePath)) || 'text/plain; charset=utf-8' })
      createReadStream(filePath).pipe(response)
    } catch {
      response.writeHead(404)
      response.end('Not found')
    }
  })
  await new Promise((resolve) => instance.listen(0, '127.0.0.1', resolve))
  const address = instance.address()
  return { instance, url: `http://127.0.0.1:${address.port}/` }
}

async function runFiveItemBrowserScenario(page, prefix, createFixture) {
  const fixtures = Array.from({ length: 6 }, (_, index) => createFixture(`${prefix}-${index + 1}`, index + 1))
  const beforeReload = await page.evaluate(async ({ fixtures: browserFixtures }) => {
    const { clearHistoryItems, loadHistoryItems, saveHistoryItem } = await import('/src/utils/historyStorage.js')
    localStorage.clear()
    await clearHistoryItems()
    localStorage.setItem('pagepilot-qa-settings', 'preserved')

    const saves = []
    for (const item of browserFixtures.slice(0, 5)) saves.push(await saveHistoryItem(item))
    const afterFive = await loadHistoryItems()
    const afterFiveBytes = new TextEncoder().encode(JSON.stringify(afterFive)).length
    return { fourthSave: saves[3], fifthSave: saves[4], afterFive, afterFiveBytes }
  }, { fixtures })

  await page.reload()

  const afterReload = await page.evaluate(async ({ sixthFixture }) => {
    const { loadHistoryItems: loadAfterReload, saveHistoryItem: saveAfterReload } = await import('/src/utils/historyStorage.js')
    const afterReload = await loadAfterReload()
    const sixthSave = await saveAfterReload(sixthFixture)
    const afterSix = await loadAfterReload()
    const afterSixBytes = new TextEncoder().encode(JSON.stringify(afterSix)).length

    return {
      sixthSave,
      afterReload,
      afterSix,
      afterSixBytes,
      otherStorageValue: localStorage.getItem('pagepilot-qa-settings'),
    }
  }, { sixthFixture: fixtures[5] })

  return { ...beforeReload, ...afterReload }
}

function logBrowserStorageMetrics(label, metrics) {
  if (process.env.HISTORY_BROWSER_METRICS !== '1') return
  console.info(`[History Browser Metrics] ${label} fourth=before:${metrics.fourthSave.beforeCount},afterInsert:${metrics.fourthSave.afterInsertCount},trimmed:${metrics.fourthSave.trimmedCount},final:${metrics.fourthSave.finalCount},reason:${metrics.fourthSave.reason} fifth=before:${metrics.fifthSave.beforeCount},afterInsert:${metrics.fifthSave.afterInsertCount},trimmed:${metrics.fifthSave.trimmedCount},final:${metrics.fifthSave.finalCount},reason:${metrics.fifthSave.reason},storedBytes:${metrics.afterFiveBytes} sixth=before:${metrics.sixthSave.beforeCount},afterInsert:${metrics.sixthSave.afterInsertCount},trimmed:${metrics.sixthSave.trimmedCount},final:${metrics.sixthSave.finalCount},reason:${metrics.sixthSave.reason},storedBytes:${metrics.afterSixBytes}`)
}

async function runGeneratedIdBrowserScenario(page) {
  const beforeReload = await page.evaluate(async () => {
    const { createHistoryItemId } = await import('/src/utils/history.js')
    const { clearHistoryItems, loadHistoryItems, saveHistoryItem } = await import('/src/utils/historyStorage.js')
    localStorage.clear()
    await clearHistoryItems()
    const saves = []
    const incomingIds = []
    for (let index = 1; index <= 6; index += 1) {
      const id = createHistoryItemId('tech')
      incomingIds.push(id)
      saves.push(await saveHistoryItem({
        type: 'tech',
        id,
        url: 'https://same-runtime.example',
        scannedAt: '2026-05-01T00:00:00.000Z',
        devices: ['desktop'],
        totalDurationMs: 19000 + index,
        result: {
          targetUrl: 'https://same-runtime.example',
          scannedAt: '2026-05-01T00:00:00.000Z',
          durationMs: 12000 + index,
          totalDurationMs: 19000 + index,
          pageTitle: `Runtime ${index}`,
          httpStatus: 200,
          accessible: true,
          checks: [{ id: 'access', status: 'ok', title: '페이지 접속', value: '정상' }],
          links: Array.from({ length: 12 }, (_, linkIndex) => ({ url: `https://same-runtime.example/${index}/${linkIndex}`, status: 'ok', statusCode: 200 })),
          images: [],
          consoleMessages: [],
          scanOptions: { url: true, click: true, landing: true, form: false, hover: false, modal: false, scroll: false, responsive: false, download: false, cookie: false, image: false, performance: false, seo: false, markup: true },
          devices: ['desktop'],
          deviceId: 'desktop',
          deviceLabel: 'Desktop',
        },
      }))
    }
    return { incomingIds, finalCounts: saves.map((save) => save.finalCount), sixthSave: saves[5], afterSix: await loadHistoryItems() }
  })

  await page.reload()
  const afterReload = await page.evaluate(async () => {
    const { loadHistoryItems } = await import('/src/utils/historyStorage.js')
    return loadHistoryItems()
  })

  return { ...beforeReload, afterReload }
}

function logGeneratedIdMetrics(metrics) {
  if (process.env.HISTORY_BROWSER_METRICS !== '1') return
  console.info(`[History Browser Metrics] generated finalCounts=${metrics.finalCounts.join(',')} sixth=before:${metrics.sixthSave.beforeCount},afterInsert:${metrics.sixthSave.afterInsertCount},trimmed:${metrics.sixthSave.trimmedCount},final:${metrics.sixthSave.finalCount}`)
}

function createTechHistoryFixture(id, index) {
  const scannedAt = `2026-02-${String(index).padStart(2, '0')}T00:00:00.000Z`
  return {
    type: 'tech',
    id,
    url: `https://${id}.example`,
    scannedAt,
    devices: ['desktop'],
    totalDurationMs: 18000 + index,
    result: createTechResult({ id, index, scannedAt, deviceId: 'desktop', deviceLabel: 'Desktop' }),
  }
}

function createMultiDeviceTechHistoryFixture(id, index) {
  const scannedAt = `2026-03-${String(index).padStart(2, '0')}T00:00:00.000Z`
  const devices = createDeviceEntries(id, index, scannedAt)
  return {
    type: 'tech',
    id,
    url: `https://${id}.example`,
    scannedAt,
    devices: ['desktop', 'tablet', 'mobile'],
    totalDurationMs: 26000 + index,
    result: {
      ...createTechResult({ id, index, scannedAt, deviceId: 'desktop', deviceLabel: 'Desktop' }),
      devices: ['desktop', 'tablet', 'mobile'],
      deviceResults: devices,
    },
  }
}

function createCombinedHistoryFixture(id, index) {
  const scannedAt = `2026-04-${String(index).padStart(2, '0')}T00:00:00.000Z`
  const tech = createMultiDeviceTechHistoryFixture(id, index).result
  return {
    type: 'combined',
    id,
    url: `https://${id}.example`,
    webUrl: `https://${id}.example`,
    figmaUrl: `https://www.figma.com/design/${id}`,
    scannedAt,
    createdAt: scannedAt,
    devices: ['desktop', 'tablet', 'mobile'],
    totalDurationMs: 42000 + index,
    visual: { status: 'success', summary: 'Visual restored', compactResult: createVisualResult(id, index, scannedAt), error: '' },
    tech: { status: 'success', summary: 'Tech restored', compactResult: tech, scanOptions: tech.scanOptions, devices: ['desktop', 'tablet', 'mobile'], error: '' },
    aiReview: {
      meta: { openAiCalled: true, model: 'gpt-5.6-terra', aiReviewDurationMs: 3200, totalDurationMs: 42000 + index, rawVisionCount: 2, fallbackUsed: false },
      review: { releaseDecision: 'caution', summary: '복원 가능한 요약', mustFix: [], verify: [], developerNotes: [], visualDifferences: [], clientReplyDraft: '' },
    },
  }
}

function createLargeActualHistoryFixture(id, index) {
  const item = createCombinedHistoryFixture(id, index)
  const repeatedEvidence = Array.from({ length: 120 }, (_, evidenceIndex) => ({
    selector: `.section-${evidenceIndex} > .card:nth-child(${evidenceIndex + 1}) .cta`,
    source: `node-${evidenceIndex}`,
    url: `https://${id}.example/resource-${evidenceIndex}.js`,
    status: evidenceIndex % 9 === 0 ? 'warn' : 'ok',
    message: `Detailed runtime evidence ${evidenceIndex} `.repeat(12),
  }))

  item.tech.compactResult = {
    ...item.tech.compactResult,
    links: repeatedEvidence,
    clickActions: repeatedEvidence,
    consoleMessages: repeatedEvidence,
    performanceItems: repeatedEvidence,
    networkRequests: repeatedEvidence,
    rawResponse: 'raw server response '.repeat(1000),
    debug: { trace: 'debug trace '.repeat(1000) },
  }
  item.visual.compactResult = {
    ...item.visual.compactResult,
    comparison: {
      ...item.visual.compactResult.comparison,
      differences: repeatedEvidence.map((entry, diffIndex) => ({
        area: 'Main Visual',
        category: 'Text',
        figmaText: `Figma value ${diffIndex} ${entry.message}`,
        webText: `Web value ${diffIndex} ${entry.message}`,
        selector: entry.selector,
        sources: repeatedEvidence.slice(0, 8),
        order: diffIndex,
      })),
    },
    rawFigmaPayload: 'figma raw payload '.repeat(1000),
  }
  item.aiReview.review.visualDifferences = repeatedEvidence.slice(0, 40).map((entry, reviewIndex) => ({
    area: 'Main Visual',
    category: 'Text',
    title: `Review ${reviewIndex}`,
    summary: entry.message,
    figmaValue: 'Figma',
    webValue: 'Web',
    severity: 'warning',
    confidence: 'high',
    order: reviewIndex,
  }))
  return item
}

function createDeviceEntries(id, index, scannedAt) {
  return [
    { deviceId: 'desktop', deviceLabel: 'Desktop', viewport: { width: 1440, height: 1200 }, status: 'success', result: createTechResult({ id, index, scannedAt, deviceId: 'desktop', deviceLabel: 'Desktop' }) },
    { deviceId: 'tablet', deviceLabel: 'Tablet', viewport: { width: 834, height: 1112 }, status: 'success', result: createTechResult({ id, index, scannedAt, deviceId: 'tablet', deviceLabel: 'Tablet' }) },
    { deviceId: 'mobile', deviceLabel: 'Mobile', viewport: { width: 390, height: 844 }, status: 'success', result: createTechResult({ id, index, scannedAt, deviceId: 'mobile', deviceLabel: 'Mobile' }) },
  ]
}

function createTechResult({ id, index, scannedAt, deviceId, deviceLabel }) {
  return {
    targetUrl: `https://${id}.example`,
    scannedAt,
    durationMs: 12000 + index,
    totalDurationMs: 18000 + index,
    pageTitle: `${deviceLabel} ${id}`,
    httpStatus: 200,
    accessible: true,
    checks: [
      { id: 'access', status: 'ok', title: '페이지 접속', value: '정상' },
      { id: 'external-links', status: 'warn', title: '외부 링크', value: '검토 필요 2개' },
      { id: 'click-actions', status: 'ok', title: '클릭 동작', value: '정상' },
    ],
    links: Array.from({ length: 24 }, (_, linkIndex) => ({ url: `https://${id}.example/link-${deviceId}-${linkIndex}`, status: linkIndex % 11 === 0 ? 'warn' : 'ok', statusCode: 200, text: `Link ${linkIndex}`, sourceCount: 1 })),
    images: Array.from({ length: 18 }, (_, imageIndex) => ({ src: `https://${id}.example/image-${deviceId}-${imageIndex}.webp`, status: 'ok', naturalWidth: 1200, naturalHeight: 800, sourceCount: 1 })),
    consoleMessages: Array.from({ length: 6 }, (_, messageIndex) => ({ type: messageIndex === 0 ? 'warning' : 'info', text: `Console message ${messageIndex}`, sourceCount: 1 })),
    scanOptions: { url: true, click: true, landing: true, form: true, hover: true, modal: true, scroll: true, responsive: true, download: true, cookie: true, image: true, performance: true, seo: true, markup: true },
    devices: [deviceId],
    deviceId,
    deviceLabel,
    viewport: { width: deviceId === 'mobile' ? 390 : deviceId === 'tablet' ? 834 : 1440, height: deviceId === 'mobile' ? 844 : 1200 },
    hasTouch: deviceId !== 'desktop',
    isMobile: deviceId === 'mobile',
    linkAudit: { itemCount: 24, warningCount: 2 },
    clickActions: Array.from({ length: 12 }, (_, actionIndex) => ({ label: `Action ${actionIndex}`, status: 'ok', selector: `.cta-${actionIndex}`, sourceCount: 1 })),
    clickActionAudit: { itemCount: 12 },
    responsiveLayouts: [{ label: deviceLabel, status: 'ok', viewport: { width: deviceId === 'mobile' ? 390 : 1440, height: 900 } }],
    responsiveAudit: { itemCount: 1 },
  }
}

function createVisualResult(id, index, scannedAt) {
  return {
    meta: { webUrl: `https://${id}.example`, scannedAt, totalDurationMs: 42000 + index, pageTitle: id },
    figma: { name: id, displayImageUrl: `/api/figma/render/${id}` },
    web: { pageTitle: id, displayImageUrl: `/api/visual/screenshot/${id}.png` },
    comparison: {
      matchedCount: 18,
      differenceCount: 6,
      differences: Array.from({ length: 12 }, (_, diffIndex) => ({ area: 'Main Visual', category: 'Text', figmaText: `Figma copy ${diffIndex}`, webText: `Web copy ${diffIndex}`, confidence: 'high', order: diffIndex })),
    },
    aiHints: {
      evidenceSummary: { sections: { totalCount: 6 }, content: { figmaImageCount: 4, webImageCount: 4 }, interactions: { primaryActionCount: 2, secondaryActionCount: 2 } },
      heroSection: { figma: { label: 'Hero' }, web: { label: 'Hero' } },
      heroMediaGroup: { comparisonHint: 'image/video', figma: { mediaTypes: ['image'] }, web: { mediaTypes: ['video'] } },
      heroCtaGroup: { countDifference: 1, figma: { count: 2, actions: [] }, web: { count: 1, actions: [] } },
      ctaButtons: [],
      prices: [],
    },
  }
}
