import test from 'node:test'
import assert from 'node:assert/strict'
import { createCompactHistoryItemForStorage, createHistoryCardSummary, createHistoryDetailMeta, createHistoryItemId, getHistoryDisplayStatus, getHistoryTechResult, getHistoryVisualResult, MAX_HISTORY_ITEMS, sortHistoryItems } from './history.js'
import { clearHistoryItems, countHistoryItems, deleteHistoryItem, loadHistoryItems, migrateLegacyHistory, resetHistoryStorageForTests, saveHistoryItem } from './historyStorage.js'
import { createTechQaViewModel } from './techQa.js'

function installLocalStorage() {
  const store = new Map()
  globalThis.localStorage = {
    getItem(key) {
      return store.has(key) ? store.get(key) : null
    },
    setItem(key, value) {
      store.set(key, String(value))
    },
    removeItem(key) {
      store.delete(key)
    },
    clear() {
      store.clear()
    },
  }
}

async function resetStorage() {
  installLocalStorage()
  resetHistoryStorageForTests()
  await clearHistoryItems()
  localStorage.clear()
  resetHistoryStorageForTests()
}

function createTechItem(id, index, overrides = {}) {
  const scannedAt = `2026-01-${String(index).padStart(2, '0')}T00:00:00.000Z`
  return {
    type: 'tech',
    id,
    url: `https://${id}.example`,
    scannedAt,
    totalDurationMs: 20000 + index,
    devices: ['desktop'],
    counts: { total: 2, high: 1 },
    topIssueSummaries: ['Tech'],
    result: {
      targetUrl: `https://${id}.example`,
      scannedAt,
      durationMs: 12000 + index,
      totalDurationMs: 20000 + index,
      pageTitle: id,
      checks: [{ id: 'access', status: 'ok' }],
      links: [{ url: `https://${id}.example/a`, status: 'ok' }],
      images: [],
      consoleMessages: [],
      devices: ['desktop'],
      scanOptions: { url: true, click: true, landing: true, form: true, hover: true, modal: true, scroll: true, responsive: true, download: true, cookie: true, image: true, performance: true, seo: true, markup: true },
      ...overrides.result,
    },
    ...overrides,
  }
}

function createCombinedItem(id, index) {
  const scannedAt = `2026-02-${String(index).padStart(2, '0')}T00:00:00.000Z`
  const techResult = createTechItem(`${id}-tech`, index, { devices: ['desktop', 'tablet', 'mobile'], result: { devices: ['desktop', 'tablet', 'mobile'], deviceResults: [
    { deviceId: 'desktop', status: 'success', result: createTechItem(`${id}-desktop`, index).result },
    { deviceId: 'tablet', status: 'success', result: createTechItem(`${id}-tablet`, index).result },
    { deviceId: 'mobile', status: 'success', result: createTechItem(`${id}-mobile`, index).result },
  ] } }).result
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
    visual: { status: 'success', summary: 'Visual ok', compactResult: { meta: { webUrl: `https://${id}.example`, totalDurationMs: 42000 + index }, comparison: { differenceCount: 2, differences: [{ area: 'Main Visual', category: 'Text', figmaText: 'A', webText: 'B' }] } }, error: '' },
    tech: { status: 'success', summary: 'Tech ok', compactResult: techResult, scanOptions: techResult.scanOptions, devices: ['desktop', 'tablet', 'mobile'], error: '' },
    aiReview: { meta: { openAiCalled: true, model: 'gpt-5.6-terra', fallbackUsed: false, aiReviewDurationMs: 3200, totalDurationMs: 42000 + index }, review: { releaseDecision: 'caution', summary: '확인 필요', mustFix: [], verify: [], developerNotes: [], visualDifferences: [], clientReplyDraft: '' } },
  }
}

test('indexeddb history keeps final counts 1,2,3,4,5,5', async () => {
  await resetStorage()
  const finalCounts = []
  let sixthSave = null

  for (let index = 1; index <= 6; index += 1) {
    const save = await saveHistoryItem(createTechItem(`item-${index}`, index))
    finalCounts.push(save.finalCount)
    if (index === 6) sixthSave = save
  }

  assert.deepEqual(finalCounts, [1, 2, 3, 4, 5, 5])
  assert.equal(sixthSave.beforeCount, 5)
  assert.equal(sixthSave.afterInsertCount, 6)
  assert.equal(sixthSave.trimmedCount, 1)
  assert.equal(sixthSave.finalCount, 5)
  assert.deepEqual((await loadHistoryItems()).map((item) => item.id), ['item-6', 'item-5', 'item-4', 'item-3', 'item-2'])
})

test('indexeddb history creates unique ids for same URL saves', async () => {
  await resetStorage()
  const incomingIds = []

  for (let index = 1; index <= 6; index += 1) {
    const save = await saveHistoryItem({ type: 'tech', url: 'https://same.example', scannedAt: '2026-01-01T00:00:00.000Z', result: { targetUrl: 'https://same.example', scannedAt: '2026-01-01T00:00:00.000Z' } })
    incomingIds.push(save.savedItemId)
  }

  assert.equal(new Set(incomingIds).size, 6)
  assert.deepEqual((await loadHistoryItems()).map((item) => item.id), incomingIds.slice(1).reverse())
})

test('indexeddb history serializes parallel saves and keeps latest five', async () => {
  await resetStorage()
  const saves = await Promise.all(Array.from({ length: 6 }, (_, index) => saveHistoryItem(createTechItem(`parallel-${index + 1}`, index + 1))))

  assert.equal(saves.every((save) => save.ok), true)
  assert.equal(await countHistoryItems(), 5)
  assert.deepEqual((await loadHistoryItems()).map((item) => item.id), ['parallel-6', 'parallel-5', 'parallel-4', 'parallel-3', 'parallel-2'])
})

test('history load returns five items after six saves', async () => {
  await resetStorage()
  for (let index = 1; index <= 6; index += 1) await saveHistoryItem(createTechItem(`reload-${index}`, index))

  const items = await loadHistoryItems()

  assert.equal(items.length, 5)
  assert.deepEqual(items.map((item) => item.id), ['reload-6', 'reload-5', 'reload-4', 'reload-3', 'reload-2'])
})

test('indexeddb history deletes one item and clear all empties store', async () => {
  await resetStorage()
  await saveHistoryItem(createTechItem('delete-1', 1))
  await saveHistoryItem(createTechItem('delete-2', 2))

  const remaining = await deleteHistoryItem('delete-2')

  assert.deepEqual(remaining.map((item) => item.id), ['delete-1'])
  assert.equal(await countHistoryItems(), 1)
  assert.deepEqual(await clearHistoryItems(), [])
  assert.equal(await countHistoryItems(), 0)
})

test('indexeddb history migrates latest five legacy localStorage items once', async () => {
  await resetStorage()
  localStorage.setItem('pagepilot-qa-history-v3', JSON.stringify(Array.from({ length: 6 }, (_, index) => createTechItem(`legacy-${index + 1}`, index + 1))))

  const migration = await migrateLegacyHistory()
  const items = await loadHistoryItems()

  assert.equal(migration.ok, true)
  assert.equal(migration.migratedCount, 5)
  assert.deepEqual(items.map((item) => item.id), ['legacy-6', 'legacy-5', 'legacy-4', 'legacy-3', 'legacy-2'])
  assert.equal(localStorage.getItem('pagepilot-qa-history-v3'), '[]')
})

test('indexeddb migration ignores damaged legacy entries and keeps valid items', async () => {
  await resetStorage()
  localStorage.setItem('pagepilot-qa-history-v3', JSON.stringify([
    null,
    { id: 'damaged', summary: 'Failed to fetch timeout', counts: {} },
    createTechItem('valid-legacy', 2),
  ]))

  const migration = await migrateLegacyHistory()
  const items = await loadHistoryItems()

  assert.equal(migration.ok, true)
  assert.equal(items.some((item) => item.id === 'valid-legacy'), true)
  assert.equal(items.some((item) => item.id === 'damaged'), true)
})

test('history stores and restores combined session data without raw payloads', async () => {
  await resetStorage()
  await saveHistoryItem({
    ...createCombinedItem('combined-1', 1),
    tech: { ...createCombinedItem('combined-1', 1).tech, compactResult: { ...createCombinedItem('combined-1', 1).tech.compactResult, rawResponse: 'raw server response', debug: { raw: 'debug raw' }, networkRequests: [{ url: 'https://secret.example' }], cookieItems: [{ name: 'sid', value: 'SECRET_TOKEN_VALUE_123' }] } },
  })

  const [item] = await loadHistoryItems()
  const serialized = JSON.stringify(item)

  assert.equal(item.type, 'combined')
  assert.equal(item.visual.status, 'success')
  assert.equal(item.tech.status, 'success')
  assert.deepEqual(item.devices, ['desktop', 'tablet', 'mobile'])
  assert.equal(item.totalDurationMs, 42001)
  assert.equal(item.aiReview.meta.openAiCalled, true)
  assert.equal(serialized.includes('raw server response'), false)
  assert.equal(serialized.includes('debug raw'), false)
  assert.equal(serialized.includes('networkRequests'), false)
  assert.equal(serialized.includes('SECRET_TOKEN_VALUE_123'), false)
})

test('combined history exposes restorable Visual and Tech results for tab switching without API replay', async () => {
  await resetStorage()
  await saveHistoryItem(createCombinedItem('combined-restore', 2))

  const [item] = await loadHistoryItems()
  const visualResult = getHistoryVisualResult(item)
  const techResult = getHistoryTechResult(item)
  const techView = createTechQaViewModel(techResult)

  assert.equal(item.type, 'combined')
  assert.equal(Boolean(visualResult), true)
  assert.equal(Boolean(techResult), true)
  assert.equal(techResult.targetUrl, 'https://combined-restore.example')
  assert.deepEqual(techResult.devices, ['desktop', 'tablet', 'mobile'])
  assert.equal(techResult.deviceResults.length, 3)
  assert.equal(techResult.deviceResults.every((entry) => entry.result && entry.result.scanOptions), true)
  assert.equal(techView.targetUrl, 'https://combined-restore.example')
})

test('combined history restore supports legacy tech.result and keeps multi-device shape', () => {
  const combined = createCombinedItem('combined-legacy', 3)
  const legacy = {
    ...combined,
    tech: { status: 'success', summary: 'Tech ok', result: combined.tech.compactResult, compactResult: null, scanOptions: combined.tech.scanOptions, devices: combined.tech.devices, error: '' },
  }
  const stored = createCompactHistoryItemForStorage(legacy)
  const techResult = getHistoryTechResult(stored)

  assert.equal(stored.tech.status, 'success')
  assert.equal(Boolean(stored.tech.compactResult), true)
  assert.equal(techResult.deviceResults.length, 3)
  assert.deepEqual(techResult.devices, ['desktop', 'tablet', 'mobile'])
})

test('tech-only history restore keeps existing Tech result behavior', () => {
  const item = createCompactHistoryItemForStorage(createTechItem('tech-only-restore', 4))
  const techResult = getHistoryTechResult(item)

  assert.equal(item.type, 'tech')
  assert.equal(techResult.targetUrl, 'https://tech-only-restore.example')
  assert.deepEqual(techResult.devices, ['desktop'])
})

test('history max item limit remains unchanged', () => {
  assert.equal(MAX_HISTORY_ITEMS, 5)
})

test('history id helper never derives ids from URL type or scannedAt only', () => {
  const ids = Array.from({ length: 6 }, () => createHistoryItemId('tech'))

  assert.equal(new Set(ids).size, 6)
  assert.equal(ids.every((id) => id.startsWith('tech-')), true)
  assert.equal(ids.some((id) => id.includes('https://')), false)
})

test('history sorts by newest valid scan time without mutating the source array', () => {
  const source = [
    { id: 'invalid', scannedAt: 'not-a-date' },
    { id: 'created', createdAt: '2026-01-08T00:00:00.000Z' },
    { id: 'scanned', scannedAt: '2026-01-09T00:00:00.000Z' },
    { id: 'timestamp', timestamp: '2026-01-07T00:00:00.000Z' },
    { id: 'same-a', scannedAt: '2026-01-06T00:00:00.000Z' },
    { id: 'same-b', scannedAt: '2026-01-06T00:00:00.000Z' },
  ]

  const sorted = sortHistoryItems(source)

  assert.deepEqual(sorted.map((item) => item.id), ['scanned', 'created', 'timestamp', 'same-a', 'same-b', 'invalid'])
  assert.deepEqual(source.map((item) => item.id), ['invalid', 'created', 'scanned', 'timestamp', 'same-a', 'same-b'])
})

test('history display status is derived from stored results instead of trusting legacy text', () => {
  const ok = { type: 'tech', result: { targetUrl: 'https://example.com', checks: [{ id: 'access', status: 'ok' }], links: [], images: [] }, counts: {} }
  const error = { type: 'tech', result: { targetUrl: 'https://example.com', checks: [{ id: 'access', status: 'error' }], links: [], images: [] }, counts: {} }
  const warn = { type: 'tech', result: { targetUrl: 'https://example.com', checks: [{ id: 'external-links', status: 'warn' }], links: [], images: [] }, counts: {} }
  const visualWarn = { type: 'visual', result: { meta: { webUrl: 'https://example.com' }, comparison: { differenceCount: 2 } }, counts: {} }
  const allFailed = { type: 'combined', summary: 'QA 모두 실패 Failed to fetch', visual: { status: 'error', error: 'Failed to fetch', compactResult: null }, tech: { status: 'error', error: 'Failed to fetch', compactResult: null }, counts: {} }
  const partial = { type: 'combined', visual: { status: 'success', compactResult: { meta: { webUrl: 'https://example.com' } } }, tech: { status: 'error', error: 'navigation failed', compactResult: null }, counts: {} }

  assert.equal(getHistoryDisplayStatus(ok), 'ok')
  assert.equal(getHistoryDisplayStatus(error), 'error')
  assert.equal(getHistoryDisplayStatus(warn), 'warn')
  assert.equal(getHistoryDisplayStatus(visualWarn), 'warn')
  assert.equal(getHistoryDisplayStatus(allFailed), 'failed')
  assert.equal(getHistoryDisplayStatus(partial), 'warn')
})

test('history card summary hides raw failure details and keeps concise issue metadata', () => {
  const failed = { type: 'combined', summary: 'QA 모두 실패 Failed to fetch ERR_NAME_NOT_RESOLVED stack trace', visual: { status: 'error', error: 'Failed to fetch', compactResult: null }, tech: { status: 'error', error: 'ERR_NAME_NOT_RESOLVED', compactResult: null }, counts: {}, topIssueSummaries: ['Failed to fetch ERR_NAME_NOT_RESOLVED'] }
  const mixed = { type: 'combined', totalDurationMs: 289800, visual: { status: 'success', compactResult: { meta: { webUrl: 'https://example.com' }, comparison: { differenceCount: 3 } } }, tech: { status: 'success', compactResult: { targetUrl: 'https://example.com', checks: [{ id: 'access', status: 'warn' }], links: [], images: [] } }, counts: {} }

  assert.equal(createHistoryCardSummary(failed), 'Visual QA와 Tech QA를 완료하지 못했습니다.')
  assert.equal(createHistoryCardSummary(failed).includes('ERR_'), false)
  assert.equal(createHistoryCardSummary(mixed), 'Tech QA 문제 확인 0개, 검토 필요 1개 · Visual QA 차이 3개 확인 필요')
  assert.deepEqual(createHistoryDetailMeta(mixed), ['Visual 차이 3개', 'Tech 검토 필요 1개'])
})
