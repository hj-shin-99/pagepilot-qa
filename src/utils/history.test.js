import test from 'node:test'
import assert from 'node:assert/strict'
import { createCompactHistoryItemForStorage, createCompactTechResult, createHistoryCardSummary, createHistoryDetailMeta, createHistoryItemId, getHistoryDisplayStatus, getHistoryTechResult, getHistoryVisualResult, MAX_HISTORY_ITEMS, sortHistoryItems } from './history.js'
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

const FULL_TECH_SCAN_OPTIONS = { url: true, click: true, landing: true, form: true, hover: true, modal: true, scroll: true, responsive: true, download: true, cookie: true, image: true, performance: true, seo: true, markup: true }

function createFullTechResult(id = 'full-tech', deviceId = 'desktop') {
  const targetUrl = `https://${id}.example`
  const landingPages = [{ auditId: `${deviceId}-landing`, label: 'Landing CTA', requestedUrl: `${targetUrl}/landing`, finalUrl: `${targetUrl}/landing`, statusCode: 200, status: 'ok', note: 'landing ok', sources: [{ label: '프로모션 바로가기', section: 'header', selector: '#landing', domPath: 'header>a.promo', href: '/landing', interactionOutcome: 'navigation', requestedUrl: `${targetUrl}/landing` }] }]
  const formInteractions = [{ auditId: `${deviceId}-form`, label: 'Email form', selector: '#email', status: 'warn', category: 'validation', note: 'label 확인 필요', issues: { legacy: 'object issue should not crash' } }]
  const hoverInteractions = [{ auditId: `${deviceId}-hover`, label: 'Menu', selector: '#menu', status: 'ok', category: 'dropdown', note: 'hover ok', issues: ['menu visible'] }]
  const modalInteractions = [{ auditId: `${deviceId}-modal`, label: 'Open modal', selector: '#modal', status: 'ok', category: 'modal', note: 'modal ok' }]
  const scrollInteractions = [{ auditId: `${deviceId}-scroll`, label: 'Page scroll', status: 'ok', category: 'scroll', note: 'bottom reached' }]
  const responsiveLayouts = [{ auditId: `${deviceId}-responsive`, label: 'Mobile', type: '390x844', status: 'warn', category: 'needs-review', note: 'visible CTA clipped', overflowAmount: 0, clippedCount: 1 }]
  const downloadResources = [{ auditId: `${deviceId}-download`, label: 'PDF', url: `${targetUrl}/file.pdf`, status: 'ok', category: 'download-ok', statusCode: 200, contentType: 'application/pdf' }]
  const cookieItems = [{ auditId: `${deviceId}-cookie`, label: 'session', name: 'session', status: 'warn', category: 'secure', note: 'Secure 확인 필요' }]
  const imageItems = [{ auditId: `${deviceId}-image`, label: 'Hero image', currentSrc: `${targetUrl}/hero.webp`, status: 'ok', category: 'image-ok', contentType: 'image/webp' }]
  const performanceItems = [{ auditId: `${deviceId}-performance`, label: '전체 리소스', category: 'overview', type: 'performance', status: 'ok', note: '리소스 2개 · 이번 navigation 총 전송 10.0 KB', issues: ['script 전송 10.0 KB'] }]
  const seoItems = [{ auditId: `${deviceId}-seo`, label: '소셜 메타', category: 'social-meta', type: 'seo', status: 'info', note: 'OG/Twitter 소셜 메타가 명시되지 않았습니다.', issues: ['OG/Twitter 소셜 메타가 명시되지 않았습니다.'] }]
  const metaIssues = [{ auditId: `${deviceId}-meta-description`, label: 'meta description', name: 'description', section: 'head', type: 'meta', status: 'warn', category: 'missing-meta', reason: 'meta description 값이 확인되지 않았습니다.' }]
  const imageAltIssues = [
    { auditId: `${deviceId}-image-alt-1`, label: 'Hero visual', selector: '#hero-img', domPath: 'main>img.hero', section: 'main visual', type: 'image', status: 'warn', category: 'missing-alt', reason: '의미 있는 이미지의 alt 값이 비어 있습니다.' },
    { auditId: `${deviceId}-image-alt-duplicate`, label: 'Hero visual duplicate', selector: '#hero-img', domPath: 'main>img.hero', section: 'main visual', type: 'image', status: 'warn', category: 'missing-alt', reason: '동일 이미지 alt 근거가 중복 수집되었습니다.' },
  ]
  const externalLinkIssues = [
    { auditId: `${deviceId}-external-1`, label: 'Partner link', href: 'https://partner.example', rel: 'noopener', section: 'footer', type: 'external-link', status: 'warn', category: 'blank-rel', reason: 'target="_blank" 링크에 noreferrer 포함 여부 확인이 필요합니다.' },
    { auditId: `${deviceId}-external-2`, label: 'Partner link copy', href: 'https://partner.example', rel: 'noopener', section: 'footer', type: 'external-link', status: 'warn', category: 'blank-rel', reason: '동일 외부 링크 rel 근거가 중복 수집되었습니다.' },
  ]
  return {
    targetUrl,
    scannedAt: '2026-03-01T00:00:00.000Z',
    durationMs: 1234,
    totalDurationMs: 4321,
    pageTitle: `${id} title`,
    httpStatus: 200,
    accessible: true,
    checks: [
      { id: 'access', status: 'ok', value: '접속 가능 · HTTP 200' },
      { id: 'http-status', status: 'ok', value: '200' },
      { id: 'title', status: 'ok', value: `${id} title` },
      { id: 'console-errors', status: 'ok', items: [] },
      { id: 'images', status: 'ok', items: [] },
      { id: 'resource-size', status: 'ok', items: [] },
      { id: 'links', status: 'ok', value: '1개' },
      { id: 'missing-href', status: 'ok', items: [] },
      { id: 'mobile', status: 'ok', value: '200' },
      { id: 'headings', status: 'ok', value: 'h1 1개' },
      { id: 'duplicate-ids', status: 'ok', items: [] },
      { id: 'network-failures', status: 'ok', items: [] },
      { id: 'forms', status: 'ok', value: '폼 요소 1개 / required 0개' },
      { id: 'meta', status: 'warn', value: '총 3개', totalCount: 3, items: metaIssues },
      { id: 'image-alt', status: 'warn', value: '총 2개', totalCount: 2, items: imageAltIssues },
      { id: 'external-links', status: 'warn', value: '총 2개', totalCount: 2, items: externalLinkIssues },
      { id: 'click-actions', status: 'ok', items: [{ auditId: `${deviceId}-click`, label: 'Open page', selector: '#open', domPath: 'main>a', href: '/open', url: `${targetUrl}/open`, role: 'link', status: 'ok', actionClassification: 'verified-working', interactionOutcome: 'navigation', reason: '정상 이동 URL이 확인되었습니다.' }], meta: { candidateCount: 1, verifiedWorkingCount: 1 } },
      { id: 'landing-pages', status: 'ok', items: landingPages, meta: { candidateCount: 1, inspectedCount: 1, noTarget: false } },
      { id: 'form-interaction', status: 'warn', items: formInteractions, meta: { candidateCount: 1, inspectedCount: 1, warningCount: 1, noTarget: false } },
      { id: 'hover-interaction', status: 'ok', items: hoverInteractions, meta: { candidateCount: 1, inspectedCount: 1, noTarget: false } },
      { id: 'modal-interaction', status: 'ok', items: modalInteractions, meta: { candidateCount: 1, inspectedCount: 1, noTarget: false } },
      { id: 'scroll-interaction', status: 'ok', items: scrollInteractions, meta: { candidateCount: 1, inspectedCount: 1, noTarget: false } },
      { id: 'responsive-layout', status: 'warn', items: responsiveLayouts, meta: { candidateCount: 1, inspectedCount: 1, warningCount: 1, noTarget: false } },
      { id: 'download-resource', status: 'ok', items: downloadResources, meta: { candidateCount: 1, inspectedCount: 1, noTarget: false } },
      { id: 'cookie-security', status: 'warn', items: cookieItems, meta: { candidateCount: 1, inspectedCount: 1, warningCount: 1, noTarget: false } },
      { id: 'image-rendering', status: 'ok', items: imageItems, meta: { candidateCount: 1, inspectedCount: 1, noTarget: false } },
      { id: 'performance-resource', status: 'ok', items: performanceItems, meta: { candidateCount: 2, inspectedCount: 1, noTarget: false } },
      { id: 'seo-readiness', status: 'ok', items: seoItems, meta: { candidateCount: 1, inspectedCount: 1, skippedCount: 1, noTarget: false } },
    ],
    links: [{ url: `${targetUrl}/open`, status: 'ok', statusCode: 200, label: 'Open page' }],
    images: [{ src: `${targetUrl}/hero.webp`, status: 'ok' }, { src: `${targetUrl}/hero-mobile.webp`, status: 'ok' }],
    consoleMessages: [],
    counts: { anchors: 1, buttons: 1 },
    mobile: { viewport: { width: 390, height: 844 }, statusCode: 200, note: 'ok' },
    linkAudit: { discoveredLinkCount: 2, uniqueRequestUrlCount: 1, actualHttpRequestCount: 1, dedupedLinkCount: 1 },
    clickActions: [{ auditId: `${deviceId}-click`, label: 'Open page', selector: '#open', domPath: 'main>a', href: '/open', url: `${targetUrl}/open`, role: 'link', status: 'ok', actionClassification: 'verified-working', interactionOutcome: 'navigation', reason: '정상 이동 URL이 확인되었습니다.' }],
    clickActionAudit: { candidateCount: 1, verifiedWorkingCount: 1 },
    landingPages,
    landingAudit: { candidateCount: 1, inspectedCount: 1, noTarget: false },
    formInteractions,
    formAudit: { candidateCount: 1, inspectedCount: 1, warningCount: 1, noTarget: false },
    hoverInteractions,
    hoverAudit: { candidateCount: 1, inspectedCount: 1, noTarget: false },
    modalInteractions,
    modalAudit: { candidateCount: 1, inspectedCount: 1, noTarget: false },
    scrollInteractions,
    scrollAudit: { candidateCount: 1, inspectedCount: 1, noTarget: false },
    responsiveLayouts,
    responsiveAudit: { candidateCount: 1, inspectedCount: 1, warningCount: 1, noTarget: false },
    downloadResources,
    downloadAudit: { candidateCount: 1, inspectedCount: 1, noTarget: false },
    cookieItems,
    cookieAudit: { candidateCount: 1, inspectedCount: 1, warningCount: 1, noTarget: false },
    imageItems,
    imageAudit: { candidateCount: 1, inspectedCount: 1, noTarget: false },
    performanceItems,
    performanceAudit: { candidateCount: 2, inspectedCount: 1, noTarget: false },
    seoItems,
    seoAudit: { candidateCount: 1, inspectedCount: 1, skippedCount: 1, noTarget: false },
    scanOptions: FULL_TECH_SCAN_OPTIONS,
    devices: [deviceId],
    deviceId,
  }
}

function createRuntimeLikeTechHistoryItem(result) {
  const techView = createTechQaViewModel(result)
  const techCounts = techView.issueCounts
  const totalIssueCount = techCounts.errorElementCount + techCounts.warningElementCount
  return {
    type: 'tech',
    id: 'runtime-like-tech-history',
    url: result.targetUrl,
    scannedAt: result.scannedAt,
    totalDurationMs: result.totalDurationMs,
    summary: 'runtime-like Tech QA result',
    devices: result.devices,
    totalIssueCount,
    counts: {
      total: totalIssueCount,
      high: techCounts.errorElementCount,
      techError: techCounts.errorElementCount,
      techWarn: techCounts.warningElementCount,
    },
    topIssueSummaries: ['runtime-like Tech QA'],
    result: createCompactTechResult(result),
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
  const combined = createCombinedItem('combined-restore', 2)
  combined.tech.compactResult.navigationIntentQa = {
    meta: { available: true },
    summary: { evaluated: 1, correct: 1, mismatch: 0, review: 0, notObserved: 0 },
    items: [{ referenceId: 'intent-1', label: 'Apply', status: 'matched-correct', expectedUrls: [{ raw: '/apply', matchMode: 'path-prefix', allowRedirect: true, allowTrailingSlashVariant: true }], actualUrlEvidence: [{ url: 'https://combined-restore.example/apply' }] }],
  }
  await saveHistoryItem(combined)

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
  assert.deepEqual(techView.navigationIntent.rows[0].expectedUrls, ['/apply'])
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

test('full Tech QA synthetic result round-trips canonical phase collections without API replay', () => {
  const desktop = createFullTechResult('full-desktop', 'desktop')
  const tablet = createFullTechResult('full-tablet', 'tablet')
  const mobile = createFullTechResult('full-mobile', 'mobile')
  const fullResult = {
    ...desktop,
    targetUrl: 'https://full-tech.example',
    devices: ['desktop', 'tablet', 'mobile'],
    deviceResults: [
      { deviceId: 'desktop', status: 'success', result: desktop },
      { deviceId: 'tablet', status: 'success', result: tablet },
      { deviceId: 'mobile', status: 'success', result: mobile },
    ],
  }

  const compact = createCompactHistoryItemForStorage({ type: 'tech', id: 'full-tech-roundtrip', url: fullResult.targetUrl, scannedAt: fullResult.scannedAt, devices: fullResult.devices, result: fullResult })
  const restored = getHistoryTechResult(JSON.parse(JSON.stringify(compact)))
  const view = createTechQaViewModel(restored.deviceResults[0].result)

  assert.equal(restored.targetUrl, 'https://full-tech.example')
  assert.deepEqual(restored.devices, ['desktop', 'tablet', 'mobile'])
  assert.deepEqual(restored.deviceResults.map((entry) => entry.deviceId), ['desktop', 'tablet', 'mobile'])
  assert.equal(view.linkSummary.total, 1)
  assert.equal(view.clickActionGroups.total, 1)
  assert.equal(view.landingPageGroups.total, 1)
  assert.equal(view.landingPageGroups.hasTargets, true)
  assert.equal(view.formInteractionGroups.total, 1)
  assert.equal(view.formInteractionGroups.hasTargets, true)
  assert.equal(view.hoverInteractionGroups.total, 1)
  assert.equal(view.modalInteractionGroups.total, 1)
  assert.equal(view.scrollInteractionGroups.total, 1)
  assert.equal(view.responsiveLayoutGroups.total, 1)
  assert.equal(view.downloadResourceGroups.total, 1)
  assert.equal(view.cookieGroups.total, 1)
  assert.equal(view.imageGroups.total, 1)
  assert.equal(view.performanceGroups.total, 1)
  assert.equal(view.seoGroups.total, 1)
  assert.equal(view.checkItems.some((item) => item.id === 'forms'), true)
  assert.equal(view.formInteractionGroups.items[0].issues?.legacy, 'object issue should not crash')
})

test('Tech QA history preserves Navigation Intent QA result through compact round-trip', () => {
  const desktop = createFullTechResult('intent-desktop', 'desktop')
  desktop.navigationIntentQa = {
    meta: { available: true },
    summary: { evaluated: 2, correct: 1, mismatch: 1, review: 0, notObserved: 0 },
    items: [
      { referenceId: 'intent-1', label: 'Apply', status: 'matched-correct', expectedUrls: [{ raw: '/apply' }], actualUrlEvidence: [{ url: 'https://intent-desktop.example/apply' }] },
      { referenceId: 'intent-2', label: 'Offer', status: 'matched-mismatch', expectedUrls: [{ raw: '/offer' }], actualUrlEvidence: [{ url: 'https://intent-desktop.example/promo' }], reason: 'Expected URL differs' },
    ],
  }

  const compact = createCompactHistoryItemForStorage({ type: 'tech', id: 'intent-roundtrip', url: desktop.targetUrl, scannedAt: desktop.scannedAt, devices: desktop.devices, result: desktop })
  const restored = getHistoryTechResult(JSON.parse(JSON.stringify(compact)))
  const view = createTechQaViewModel(restored)

  assert.deepEqual(compact.result.navigationIntentQa.items[0].expectedUrls, ['/apply'])
  assert.deepEqual(compact.result.navigationIntentQa.items[1].expectedUrls, ['/offer'])
  assert.equal(restored.navigationIntentQa.summary.mismatch, 1)
  assert.deepEqual(restored.navigationIntentQa.items[0].expectedUrls, ['/apply'])
  assert.deepEqual(view.navigationIntent.rows[1].expectedUrls, ['/apply'])
  assert.equal(view.navigationIntent.visible, true)
  assert.deepEqual(view.navigationIntent.rows.map((row) => row.referenceId), ['intent-2', 'intent-1'])
})

test('runtime-like frontend History save path preserves Landing and Form after App precompact and storage load', async () => {
  await resetStorage()
  const desktop = createFullTechResult('runtime-desktop', 'desktop')
  const tablet = createFullTechResult('runtime-tablet', 'tablet')
  const mobile = createFullTechResult('runtime-mobile', 'mobile')
  const runtimeResult = {
    ...desktop,
    targetUrl: 'https://runtime-tech.example',
    devices: ['desktop', 'tablet', 'mobile'],
    deviceResults: [
      { deviceId: 'desktop', status: 'success', result: desktop },
      { deviceId: 'tablet', status: 'success', result: tablet },
      { deviceId: 'mobile', status: 'success', result: mobile },
    ],
  }
  const expectedView = createTechQaViewModel(desktop)

  await saveHistoryItem(createRuntimeLikeTechHistoryItem(runtimeResult))
  const [storedItem] = await loadHistoryItems()
  const serializedItem = JSON.parse(JSON.stringify(storedItem))
  const restored = getHistoryTechResult(serializedItem)
  const desktopResult = restored.deviceResults.find((entry) => entry.deviceId === 'desktop')?.result
  const view = createTechQaViewModel(desktopResult)
  const headingCheck = view.basicCheckItems.find((item) => item.id === 'headings')
  const formCheck = view.basicCheckItems.find((item) => item.id === 'forms')
  const metaCheck = view.checkItems.find((item) => item.id === 'meta')
  const imageAltCheck = view.checkItems.find((item) => item.id === 'image-alt')
  const externalLinksCheck = view.checkItems.find((item) => item.id === 'external-links')
  const landingSource = view.landingPageGroups.items[0]?.sources?.[0]

  assert.equal(storedItem.result.landingPages.length, 1)
  assert.equal(storedItem.result.formInteractions.length, 1)
  assert.equal(serializedItem.result.deviceResults[0].result.landingPages.length, 1)
  assert.equal(serializedItem.result.deviceResults[0].result.formInteractions.length, 1)
  assert.equal(restored.targetUrl, 'https://runtime-tech.example')
  assert.deepEqual(restored.deviceResults.map((entry) => entry.deviceId), ['desktop', 'tablet', 'mobile'])
  assert.equal(view.landingPageGroups.total, 1)
  assert.equal(view.landingPageGroups.hasTargets, true)
  assert.equal(view.formInteractionGroups.total, 1)
  assert.equal(view.formInteractionGroups.hasTargets, true)
  assert.equal(view.linkSummary.total, 1)
  assert.equal(view.clickActionGroups.total, 1)
  assert.equal(view.scrollInteractionGroups.total, 1)
  assert.equal(view.responsiveLayoutGroups.total, 1)
  assert.equal(view.downloadResourceGroups.total, 1)
  assert.equal(view.cookieGroups.total, 1)
  assert.equal(view.imageGroups.total, 1)
  assert.equal(view.performanceGroups.total, 1)
  assert.equal(view.seoGroups.total, 1)
  assert.equal(headingCheck.value, 'h1 1개 · 검토 필요 0개')
  assert.equal(formCheck.value, '폼 요소 1개 / required 0개 · 검토 필요 0개')
  assert.deepEqual(pickIssueCounts(view.issueCounts), pickIssueCounts(expectedView.issueCounts))
  assert.deepEqual(landingSource, { label: '프로모션 바로가기', section: 'header', selector: '#landing', domPath: 'header>a.promo', href: '/landing', interactionOutcome: 'navigation', requestedUrl: 'https://runtime-desktop.example/landing' })
  assert.equal(metaCheck.value, '총 3개 항목 검토 필요')
  assert.deepEqual(metaCheck.problemItems[0], { auditId: 'desktop-meta-description', label: 'meta description', name: 'description', section: 'head', type: 'meta', status: 'warn', category: 'missing-meta', reason: 'meta description 값이 확인되지 않았습니다.' })
  assert.equal(imageAltCheck.value, '총 2개 · alt 검토 필요 2개')
  assert.equal(imageAltCheck.problemItems[0].label, 'Hero visual')
  assert.equal(imageAltCheck.problemItems[0].section, 'main visual')
  assert.equal(imageAltCheck.problemItems[0].reason, '의미 있는 이미지의 alt 값이 비어 있습니다.')
  assert.equal(imageAltCheck.problemItems[0].type, 'image')
  assert.equal(externalLinksCheck.value, '총 2개 · rel 검토 필요 2개')
  assert.equal(externalLinksCheck.problemItems[0].label, 'Partner link')
  assert.equal(externalLinksCheck.problemItems[0].href, 'https://partner.example')
  assert.equal(externalLinksCheck.problemItems[0].section, 'footer')
  assert.equal(externalLinksCheck.problemItems[0].reason, 'target="_blank" 링크에 noreferrer 포함 여부 확인이 필요합니다.')
})

function pickIssueCounts(counts = {}) {
  return {
    errorCheckCount: counts.errorCheckCount,
    errorEvidenceCount: counts.errorEvidenceCount,
    errorUniqueElementCount: counts.errorUniqueElementCount,
    warningCheckCount: counts.warningCheckCount,
    warningEvidenceCount: counts.warningEvidenceCount,
    warningUniqueElementCount: counts.warningUniqueElementCount,
    duplicateEvidenceMergedCount: counts.duplicateEvidenceMergedCount,
  }
}

test('Tech QA history restore keeps legacy landing and form check item fallback when top-level collections are missing', () => {
  const legacyResult = createFullTechResult('legacy-fallback', 'desktop')
  delete legacyResult.landingPages
  delete legacyResult.formInteractions

  const compact = createCompactHistoryItemForStorage({ type: 'tech', id: 'legacy-fallback', url: legacyResult.targetUrl, scannedAt: legacyResult.scannedAt, result: legacyResult })
  const restored = getHistoryTechResult(JSON.parse(JSON.stringify(compact)))
  const view = createTechQaViewModel(restored)

  assert.equal(view.landingPageGroups.total, 1)
  assert.equal(view.landingPageGroups.hasTargets, true)
  assert.equal(view.formInteractionGroups.total, 1)
  assert.equal(view.formInteractionGroups.hasTargets, true)
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
