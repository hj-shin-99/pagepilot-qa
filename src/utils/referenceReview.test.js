import test from 'node:test'
import assert from 'node:assert/strict'
import {
  confirmReferenceItem,
  confirmAllReferenceItems,
  countBulkConfirmEligibleItems,
  createCompactNavigationReferenceMap,
  createConfirmedReferenceMap,
  createExpectedUrlDisplayRows,
  createExpectedUrlExportText,
  createReferencePreviewTitle,
  createReferencePreset,
  createReferencePresetFilename,
  createReferenceFileSelectionState,
  createReferenceNormalizeFailureState,
  createReferenceNormalizeSuccessState,
  createReferenceReviewState,
  createReferenceTelemetryRows,
  editReferenceItem,
  excludeReferenceItem,
  importReferencePresetFromText,
  resetReferenceReviewState,
  shouldShowReferenceSheetSelection,
  updateReferenceSheetDraftSelection,
} from './referenceReview.js'

test('Preview state is created from normalized reference map', () => {
  const state = createReferenceReviewState(createReferenceMap())

  assert.equal(state.referenceMap.schemaVersion, 'navigation-intent-reference-v1')
  assert.equal(state.items.length, 3)
  assert.equal(state.reviewSummary.pending, 3)
  assert.equal(state.confirmedReferenceMap, null)
})

test('Reference Preview card title uses authoritative hierarchy depthPath', () => {
  const item = { ...createItem('ref-101', 'List', '/list', 0.9), pageContext: { depthPath: ['프로모션', 'List'], sectionHint: '', pageUrlHint: '' } }

  assert.equal(createReferencePreviewTitle(item), '프로모션 / List')
})

test('Reference Preview card title does not duplicate label matching last hierarchy segment', () => {
  const item = { ...createItem('ref-102', 'MINI', '/mini', 0.9), pageContext: { depthPath: ['온라인견적', '월 납입금 계산기', 'MINI'], sectionHint: '', pageUrlHint: '' } }

  assert.equal(createReferencePreviewTitle(item), '온라인견적 / 월 납입금 계산기 / MINI')
  assert.equal(createReferencePreviewTitle(item).endsWith('MINI / MINI'), false)
})

test('Reference Preview card title ignores stale label and metadata depth contamination', () => {
  const item = { ...createItem('ref-103', '프로모션 / List / O', '/promo', 0.9), pageContext: { depthPath: ['프로모션', 'List', 'O', 'Page', 'Type', '/not-depth'], sectionHint: '', pageUrlHint: '' } }

  assert.equal(createReferencePreviewTitle(item), '프로모션 / List')
  assert.equal(createReferencePreviewTitle(item).includes('Page'), false)
  assert.equal(createReferencePreviewTitle(item).includes('Type'), false)
  assert.equal(createReferencePreviewTitle(item).includes(' / O'), false)
})

test('Reference Preview card title keeps legacy label fallback when hierarchy is empty', () => {
  const item = { ...createItem('ref-104', 'View', '/view', 0.9), pageContext: { depthPath: [], sectionHint: '', pageUrlHint: '' } }

  assert.equal(createReferencePreviewTitle(item), 'View')
})

test('Confirm marks item confirmed without changing source provenance or confidence', () => {
  const state = createReferenceReviewState(createReferenceMap())
  const confirmed = confirmReferenceItem(state.items, 'ref-001')
  const item = confirmed[0]

  assert.deepEqual(item.userDecision, { status: 'confirmed', edited: false, excludedReason: '' })
  assert.deepEqual(item.source, state.items[0].source)
  assert.deepEqual(item.provenance, state.items[0].provenance)
  assert.equal(item.confidence, state.items[0].confidence)
})

test('Edit label aliases and expected URL keeps source provenance confidence and records original', () => {
  const state = createReferenceReviewState(createReferenceMap())
  const edited = editReferenceItem(state.items, 'ref-001', {
    label: 'Pricing edited',
    aliases: 'Plans, Fees',
    urls: ['/pricing?tab=lease#top'],
  })
  const item = edited[0]
  const url = item.expected.urls[0]

  assert.equal(item.element.label, 'Pricing edited')
  assert.deepEqual(item.element.aliases, ['Plans', 'Fees'])
  assert.equal(url.raw, '/pricing?tab=lease#top')
  assert.equal(url.normalizedPath, '/pricing')
  assert.deepEqual(url.query, { tab: 'lease' })
  assert.equal(url.hash, 'top')
  assert.deepEqual(item.userDecision, { status: 'confirmed', edited: true, excludedReason: '' })
  assert.equal(item.original.element.label, 'Pricing')
  assert.deepEqual(item.source, state.items[0].source)
  assert.deepEqual(item.provenance, state.items[0].provenance)
  assert.equal(item.confidence, state.items[0].confidence)
})

test('Exclude marks item excluded with optional reason', () => {
  const state = createReferenceReviewState(createReferenceMap())
  const excluded = excludeReferenceItem(state.items, 'ref-002', 'Out of scope')

  assert.deepEqual(excluded[1].userDecision, { status: 'excluded', edited: false, excludedReason: 'Out of scope' })
})

test('confirmedReferenceMap includes confirmed and edited items but excludes pending and excluded', () => {
  const state = createReferenceReviewState(createReferenceMap())
  let items = confirmReferenceItem(state.items, 'ref-001')
  items = editReferenceItem(items, 'ref-002', { label: 'Help edited', aliases: ['Support'], urls: ['/help'] })
  items = excludeReferenceItem(items, 'ref-003')
  const confirmedMap = createConfirmedReferenceMap(state.referenceMap, items)

  assert.deepEqual(confirmedMap.items.map((item) => item.referenceId), ['ref-001', 'ref-002'])
  assert.deepEqual(confirmedMap.unmappedCandidates, [])
  assert.equal(confirmedMap.reviewSummary.confirmed, 2)
  assert.equal(confirmedMap.reviewSummary.edited, 1)
  assert.equal(confirmedMap.reviewSummary.excluded, 1)
  assert.equal(confirmedMap.reviewSummary.pending, 0)
  assert.equal(confirmedMap.items.some((item) => item.userDecision.status === 'pending'), false)
  assert.equal(confirmedMap.items.some((item) => item.userDecision.status === 'excluded'), false)
})

test('bulk confirm marks pending eligible only and preserves excluded and edited decisions', () => {
  const state = createReferenceReviewState(createReferenceMap())
  let items = editReferenceItem(state.items, 'ref-001', { label: 'Pricing edited', aliases: ['Plans'], urls: ['/pricing-edited'] })
  items = excludeReferenceItem(items, 'ref-002')

  assert.equal(countBulkConfirmEligibleItems(items), 1)
  const next = confirmAllReferenceItems(items)
  const confirmedMap = createConfirmedReferenceMap(state.referenceMap, next)

  assert.deepEqual(next.map((item) => item.userDecision.status), ['confirmed', 'excluded', 'confirmed'])
  assert.equal(next[0].userDecision.edited, true)
  assert.equal(next[0].expected.urls[0].raw, '/pricing-edited')
  assert.deepEqual(confirmedMap.items.map((item) => item.referenceId), ['ref-001', 'ref-003'])
  assert.equal(confirmedMap.reviewSummary.confirmed, 2)
  assert.equal(confirmedMap.reviewSummary.excluded, 1)
})

test('Expected URL display rows keep multi URL values independent', () => {
  const rows = createExpectedUrlDisplayRows(createItem('ref-101', 'Multi', ['/a', '/b'], 0.9))

  assert.deepEqual(rows, ['/a', '/b'])
  assert.equal(rows.includes('/a/b'), false)
  assert.equal(createExpectedUrlExportText(createItem('ref-101', 'Multi', ['/a', '/b'], 0.9)), '/a\n/b')
  assert.equal(createExpectedUrlExportText(createItem('ref-101', 'Multi', ['/a', '/b'], 0.9)).includes('/a/b'), false)
})

test('Expected URL display rows keep base path and query variant independent', () => {
  const rows = createExpectedUrlDisplayRows(createItem('ref-102', 'Variants', ['/a', '/a?tab=1'], 0.9))

  assert.deepEqual(rows, ['/a', '/a?tab=1'])
  assert.equal(rows.includes('/a/a?tab=1'), false)
})

test('Expected URL display rows preserve single URL shape', () => {
  assert.deepEqual(createExpectedUrlDisplayRows(createItem('ref-103', 'Single', '/single', 0.9)), ['/single'])
})

test('Edit preserves multi URL array shape', () => {
  const state = createReferenceReviewState({ ...createReferenceMap(), items: [createItem('ref-101', 'Multi', ['/a', '/b'], 0.9)] })
  const edited = editReferenceItem(state.items, 'ref-101', { label: 'Multi edited', aliases: '', urls: ['/a', '/b?tab=1'] })

  assert.deepEqual(edited[0].expected.urls.map((url) => url.raw), ['/a', '/b?tab=1'])
  assert.equal(Array.isArray(edited[0].expected.urls), true)
})

test('Confirm preserves multi URL array in confirmedReferenceMap', () => {
  const state = createReferenceReviewState({ ...createReferenceMap(), items: [createItem('ref-101', 'Multi', ['/a', '/b'], 0.9)] })
  const confirmedMap = createConfirmedReferenceMap(state.referenceMap, confirmReferenceItem(state.items, 'ref-101'))

  assert.deepEqual(confirmedMap.items[0].expected.urls.map((url) => url.raw), ['/a', '/b'])
})

test('compact navigation Reference map keeps only confirmed compact intent data', () => {
  const state = createReferenceReviewState({ ...createReferenceMap(), items: [createItem('ref-101', 'Multi', ['/a', '/b?tab=1'], 0.9), createItem('ref-102', 'Pending', '/pending', 0.8)] })
  const confirmedMap = createConfirmedReferenceMap(state.referenceMap, confirmReferenceItem(state.items, 'ref-101'))
  const compact = createCompactNavigationReferenceMap({ ...confirmedMap, items: [...confirmedMap.items, state.items[1]] })

  assert.deepEqual(compact.items.map((item) => item.referenceId), ['ref-101'])
  assert.deepEqual(compact.items[0].expected.urls.map((url) => url.raw), ['/a', '/b?tab=1'])
  assert.equal(compact.items[0].source.sheetName, 'Sheet1')
  assert.equal(Object.hasOwn(compact.items[0].source, 'columns'), false)
})

test('Reference preset and compact map preserve hierarchy depth gaps without raw workbook columns', () => {
  const hierarchyItem = { ...createItem('ref-101', 'Eligibility', '/cta', 0.9), pageContext: { depthPath: ['Products', '', 'Calculator', '', 'Eligibility'], sectionHint: '', pageUrlHint: '' } }
  const state = createReferenceReviewState({ ...createReferenceMap(), items: [hierarchyItem] })
  const confirmedMap = createConfirmedReferenceMap(state.referenceMap, confirmReferenceItem(state.items, 'ref-101'))
  const preset = createReferencePreset({ referenceMap: state.referenceMap, items: confirmedMap.items, meta: { selectedSheetNames: ['Sheet1'] }, normalizedSheetNames: ['Sheet1'] })
  const imported = importReferencePresetFromText(JSON.stringify(preset))
  const compact = createCompactNavigationReferenceMap(confirmedMap)

  assert.deepEqual(confirmedMap.items[0].pageContext.depthPath, ['Products', '', 'Calculator', '', 'Eligibility'])
  assert.equal(confirmedMap.items[0].element.label, 'Eligibility')
  assert.equal(imported.reviewItems[0].element.label, 'Eligibility')
  assert.equal(compact.items[0].element.label, 'Eligibility')
  assert.deepEqual(imported.reviewItems[0].pageContext.depthPath, ['Products', '', 'Calculator', '', 'Eligibility'])
  assert.deepEqual(compact.items[0].pageContext.depthPath, ['Products', '', 'Calculator', '', 'Eligibility'])
  assert.equal(Object.hasOwn(compact.items[0].source, 'columns'), false)
})

test('Reference preset export excludes raw workbook data and restores review decisions', () => {
  const state = createReferenceReviewState(createReferenceMap())
  let items = editReferenceItem(state.items, 'ref-001', { label: 'Pricing edited', aliases: 'Plans', urls: ['/pricing-edited'] })
  items = excludeReferenceItem(items, 'ref-002', 'not needed')
  const preset = createReferencePreset({ referenceMap: state.referenceMap, items, meta: { selectedSheetNames: ['Sheet1'], model: 'model-name', usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 }, cache: { keyHash: 'abc123', status: 'miss' } }, normalizedSheetNames: ['Sheet1'] })
  const serialized = JSON.stringify({ ...preset, apiKey: undefined })
  const imported = importReferencePresetFromText(JSON.stringify(preset))

  assert.equal(preset.schemaVersion, 'pagepilot-reference-preset-v1')
  assert.equal(createReferencePresetFilename('reference.xlsx'), 'reference.pagepilot-reference.json')
  assert.equal(serialized.includes('base64'), false)
  assert.equal(serialized.includes('apiKey'), false)
  assert.equal(serialized.includes('columns'), false)
  assert.equal(serialized.includes('promptTokens'), false)
  assert.equal(serialized.includes('keyHash'), false)
  assert.deepEqual(imported.reviewItems.map((item) => item.userDecision.status), ['confirmed', 'excluded', 'pending'])
  assert.equal(imported.reviewItems[0].element.label, 'Pricing edited')
  assert.equal(imported.reviewItems[1].userDecision.excludedReason, 'not needed')
  assert.deepEqual(imported.normalizedSheetNames, ['Sheet1'])
  assert.equal(imported.analyzedReference, null)
})

test('Reference preset preserves Unicode sourceDocument filename in top-level and referenceMap', () => {
  const fileName = 'Reference 기능정의서 (최종).xlsx'
  const state = createReferenceReviewState({ ...createReferenceMap(), sourceDocument: { fileName, analyzedAt: '2026-08-21T00:00:00.000Z', mimeType: 'xlsx' } })
  const preset = createReferencePreset({ referenceMap: state.referenceMap, items: state.items, meta: { selectedSheetNames: ['Sheet1'] }, normalizedSheetNames: ['Sheet1'] })
  const imported = importReferencePresetFromText(JSON.stringify(preset))

  assert.equal(preset.sourceDocument.fileName, fileName)
  assert.equal(preset.referenceMap.sourceDocument.fileName, fileName)
  assert.equal(imported.referenceMap.sourceDocument.fileName, fileName)
  assert.equal(imported.referenceMeta.sourceFileName, fileName)
})

test('Reference telemetry rows show live AI cache miss with current request tokens', () => {
  const rows = createReferenceTelemetryRows({
    model: 'test-model',
    openAiCalled: true,
    chunking: { apiCallCount: 2, failedChunkCount: 0 },
    cache: { status: 'miss', hit: false, read: true, written: true, keyHash: 'safe-hash-only' },
    usage: { promptTokens: 1200, completionTokens: 340, totalTokens: 1540, completionCount: 2 },
  })

  assertTelemetryRows(rows, {
    'AI 분석': '사용됨',
    Cache: 'MISS',
    '이번 분석 AI Calls': '2',
    '이번 분석 Input Tokens': '1200',
    '이번 분석 Output Tokens': '340',
    '이번 분석 Total Tokens': '1540',
    Model: 'test-model',
  })
})

test('Reference telemetry rows show cache hit as zero-cost current request', () => {
  const rows = createReferenceTelemetryRows({
    model: 'test-model',
    openAiCalled: false,
    chunking: { apiCallCount: 0 },
    cache: { status: 'hit', hit: true },
    usage: { promptTokens: 999, completionTokens: 111, totalTokens: 1110 },
  })

  assertTelemetryRows(rows, {
    'AI 분석': '캐시 사용',
    Cache: 'HIT',
    '이번 분석 AI Calls': '0',
    '이번 분석 Input Tokens': '0',
    '이번 분석 Output Tokens': '0',
    '이번 분석 Total Tokens': '0',
    Model: 'test-model',
  })
})

test('Reference telemetry rows show preset import as saved Reference without current API cost', () => {
  const rows = createReferenceTelemetryRows({ importedPreset: true, model: 'origin-model', chunking: { apiCallCount: 7 }, usage: { totalTokens: 9000 } })

  assertTelemetryRows(rows, {
    'AI 분석': '저장된 Reference 사용',
    Cache: '-',
    '이번 분석 AI Calls': '0',
    '이번 분석 Input Tokens': '0',
    '이번 분석 Output Tokens': '0',
    '이번 분석 Total Tokens': '0',
    Model: '원본 분석 모델: origin-model',
  })
})

test('Reference telemetry rows never fake zero tokens when live usage is missing', () => {
  const rows = createReferenceTelemetryRows({ openAiCalled: true, model: 'test-model', chunking: { apiCallCount: 1 }, cache: { status: 'miss' }, usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } })

  assertTelemetryRows(rows, {
    'AI 분석': '사용됨',
    Cache: 'MISS',
    '이번 분석 AI Calls': '1',
    '이번 분석 Input Tokens': '확인 불가',
    '이번 분석 Output Tokens': '확인 불가',
    '이번 분석 Total Tokens': '확인 불가',
  })
})

test('Reference telemetry rows preserve fallback visibility with attempted calls', () => {
  const rows = createReferenceTelemetryRows({
    openAiCalled: true,
    model: 'test-model',
    chunking: { apiCallCount: 3, failedChunkCount: 1 },
    failedChunks: [{ code: 'openai_reference_failed' }],
    cache: { status: 'miss' },
    usage: { promptTokens: 100, completionTokens: 20, totalTokens: 120 },
  })

  assertTelemetryRows(rows, {
    'AI 분석': '실패 / fallback',
    Cache: 'MISS',
    '이번 분석 AI Calls': '3',
    '이번 분석 Input Tokens': '100',
    '이번 분석 Output Tokens': '20',
    '이번 분석 Total Tokens': '120',
  })
})

test('Reference preset import rejects malformed and unsupported versions safely', () => {
  assert.throws(() => importReferencePresetFromText('{bad json'), /JSON/)
  assert.throws(() => importReferencePresetFromText(JSON.stringify({ schemaVersion: 'old', referenceMap: createReferenceMap() })), /버전/)
})

test('sheet draft change keeps existing preview review state and normalized sheet names', () => {
  const preview = createPreviewState()
  const nextDraft = updateReferenceSheetDraftSelection(['Current Navigation'], 'Proposed Navigation', true)

  assert.deepEqual(nextDraft, ['Current Navigation', 'Proposed Navigation'])
  assert.equal(preview.referenceMap.items.length, 1)
  assert.deepEqual(preview.normalizedSheetNames, ['Current Navigation'])
  assert.equal(preview.reviewItems[0].userDecision.status, 'confirmed')
})

test('normalized sheet display state is separate from checkbox draft selection', () => {
  const preview = createPreviewState()
  const draftSelectedSheetNames = updateReferenceSheetDraftSelection(['Current Navigation'], 'Proposed Navigation', true)

  assert.deepEqual(draftSelectedSheetNames, ['Current Navigation', 'Proposed Navigation'])
  assert.deepEqual(preview.referenceMeta.selectedSheetNames, ['Current Navigation'])
})

test('new normalization success replaces preview and normalized sheet names', () => {
  const current = createPreviewState()
  const nextMap = { ...createReferenceMap(), items: [createItem('ref-201', 'New', '/new', 0.95)] }
  const next = createReferenceNormalizeSuccessState(current, { referenceMap: nextMap, meta: { model: 'test-model' } }, ['Proposed Navigation'])

  assert.deepEqual(next.referenceMap.items.map((item) => item.expected.urls[0].raw), ['/new'])
  assert.deepEqual(next.normalizedSheetNames, ['Proposed Navigation'])
  assert.deepEqual(next.referenceMeta.selectedSheetNames, ['Proposed Navigation'])
  assert.equal(next.confirmedReferenceMap, null)
  assert.equal(next.reviewItems[0].userDecision.status, 'pending')
})

test('new normalization success preserves backend usage and cache telemetry in preview meta', () => {
  const current = createPreviewState()
  const nextMap = { ...createReferenceMap(), items: [createItem('ref-301', 'Telemetry', '/telemetry', 0.95)] }
  const meta = {
    model: 'test-model',
    chunking: { apiCallCount: 1 },
    usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15, completionCount: 1 },
    cache: { status: 'miss', hit: false, read: true, written: true, keyHash: 'abcdef' },
  }
  const next = createReferenceNormalizeSuccessState(current, { referenceMap: nextMap, meta }, ['Current Navigation'])

  assert.deepEqual(next.referenceMeta.usage, meta.usage)
  assert.deepEqual(next.referenceMeta.cache, meta.cache)
  assert.deepEqual(next.referenceMeta.selectedSheetNames, ['Current Navigation'])
})

test('Reference sheet selection visibility follows Preview state matrix', () => {
  const analyzedState = { ...resetReferenceReviewState(), analyzedReference: { sheetSummaries: [{ sheetName: 'Navigation' }], sheets: [] } }
  const previewState = createReferenceNormalizeSuccessState(analyzedState, { referenceMap: createReferenceMap(), meta: { selectedSheetNames: ['Navigation'] } }, ['Navigation'])
  const presetState = importReferencePresetFromText(JSON.stringify(createReferencePreset({ referenceMap: createReferenceMap(), items: createReferenceMap().items, meta: { selectedSheetNames: ['Navigation'] }, normalizedSheetNames: ['Navigation'] })))
  const resetForNewExcel = { ...createReferenceFileSelectionState({ name: 'new-reference.xlsx' }), analyzedReference: { sheetSummaries: [{ sheetName: 'New Navigation' }], sheets: [] } }
  const failedAfterPreview = createReferenceNormalizeFailureState(previewState, 'Temporary failure')

  assert.equal(shouldShowReferenceSheetSelection(resetReferenceReviewState()), false)
  assert.equal(shouldShowReferenceSheetSelection(analyzedState), true)
  assert.equal(shouldShowReferenceSheetSelection(previewState), false)
  assert.equal(shouldShowReferenceSheetSelection(presetState), false)
  assert.equal(shouldShowReferenceSheetSelection(resetForNewExcel), true)
  assert.equal(shouldShowReferenceSheetSelection(failedAfterPreview), false)
})

test('new normalization failure keeps existing preview and review decisions', () => {
  const current = createPreviewState()
  const next = createReferenceNormalizeFailureState(current, 'Temporary normalize failure')

  assert.equal(next.referenceMap, current.referenceMap)
  assert.equal(next.reviewItems, current.reviewItems)
  assert.equal(next.referenceMeta, current.referenceMeta)
  assert.equal(next.confirmedReferenceMap, current.confirmedReferenceMap)
  assert.equal(next.referenceError, 'Temporary normalize failure')
})

test('new file selection resets preview and normalized sheet names', () => {
  const file = { name: 'new-reference.xlsx' }
  const next = createReferenceFileSelectionState(file)

  assert.equal(next.selectedFile, file)
  assert.equal(next.referenceMap, null)
  assert.deepEqual(next.reviewItems, [])
  assert.deepEqual(next.normalizedSheetNames, [])
})

test('pending items are excluded from confirmedReferenceMap', () => {
  const state = createReferenceReviewState(createReferenceMap())
  const items = confirmReferenceItem(state.items, 'ref-001')
  const confirmedMap = createConfirmedReferenceMap(state.referenceMap, items)

  assert.deepEqual(confirmedMap.items.map((item) => item.referenceId), ['ref-001'])
  assert.equal(confirmedMap.reviewSummary.pending, 2)
})

test('unmapped candidates remain pending until a user confirms edits or excludes them', () => {
  const state = createReferenceReviewState({
    ...createReferenceMap(),
    items: [
      createItem('ref-001', 'Mapped', '/mapped', 0.9),
      { ...createItem('ref-002', 'AI 미매핑 / 검토 필요', '/omitted', 0), isUnmappedCandidate: true },
    ],
  })

  assert.equal(state.items[1].isUnmappedCandidate, true)
  assert.equal(state.reviewSummary.pending, 2)

  const confirmedMap = createConfirmedReferenceMap(state.referenceMap, confirmReferenceItem(state.items, 'ref-002'))
  assert.deepEqual(confirmedMap.items.map((item) => item.referenceId), ['ref-002'])
  assert.equal(confirmedMap.items[0].isUnmappedCandidate, true)
})

test('new file selection can reset Reference review state without touching URL Figma or Tech option values', () => {
  const reset = resetReferenceReviewState()

  assert.deepEqual(reset, {
    selectedFile: null,
    analyzedReference: null,
    referenceMap: null,
    reviewItems: [],
    confirmedReferenceMap: null,
    referenceMeta: null,
    normalizedSheetNames: [],
    referenceError: '',
  })
  assert.equal(Object.hasOwn(reset, 'url'), false)
  assert.equal(Object.hasOwn(reset, 'figmaUrl'), false)
  assert.equal(Object.hasOwn(reset, 'techScanOptions'), false)
})

function createReferenceMap() {
  return {
    schemaVersion: 'navigation-intent-reference-v1',
    sourceDocument: { fileName: 'reference.xlsx', mimeType: 'xlsx', analyzedAt: '2026-08-21T00:00:00.000Z' },
    items: [
      createItem('ref-001', 'Pricing', '/pricing', 0.92),
      createItem('ref-002', 'Help', '/help', 0.71),
      createItem('ref-003', 'Contact', '/contact', 0.88),
    ],
  }
}

function createPreviewState() {
  const map = { ...createReferenceMap(), items: [createItem('ref-101', 'Current', ['/a', '/b'], 0.9)] }
  const state = createReferenceNormalizeSuccessState({ ...resetReferenceReviewState(), analyzedReference: { sheets: [] } }, { referenceMap: map, meta: { model: 'test-model' } }, ['Current Navigation'])
  const confirmedItems = confirmReferenceItem(state.reviewItems, 'ref-101')
  return {
    ...state,
    reviewItems: confirmedItems,
    confirmedReferenceMap: createConfirmedReferenceMap(state.referenceMap, confirmedItems),
  }
}

function assertTelemetryRows(rows, expected) {
  const byLabel = Object.fromEntries(rows.map((row) => [row.label, row.value]))
  for (const [label, value] of Object.entries(expected)) {
    assert.equal(byLabel[label], value)
  }
}

function createItem(referenceId, label, raw, confidence) {
  const raws = Array.isArray(raw) ? raw : [raw]
  return {
    referenceId,
    source: { sheetName: 'Sheet1', rowNumber: Number(referenceId.split('-')[1]), columns: { A: label, B: raws.join(' ') }, evidenceText: `A: ${label} | B: ${raws.join(' ')}` },
    pageContext: { depthPath: ['Main'], sectionHint: 'Header', pageUrlHint: '' },
    element: { label, aliases: [], roleHint: 'link', actionHint: 'navigation' },
    expected: { type: 'url', urls: raws.map((url) => ({ raw: url, normalizedPath: url.split('?')[0], query: {}, hash: '', matchMode: 'path-and-query', provenance: { urlSource: 'explicit-document-cell', sourceColumn: 'B' } })), urlPatterns: [], notes: '' },
    provenance: { urlSource: 'explicit-document-cell', labelSource: 'document-cell', inferenceUsed: false, aiRationale: 'Documented row.' },
    confidence,
    userDecision: { status: 'pending', edited: false, excludedReason: '' },
  }
}
