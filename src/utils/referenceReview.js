export const REFERENCE_PRESET_SCHEMA_VERSION = 'pagepilot-reference-preset-v1'
export const MAX_REFERENCE_PRESET_BYTES = 1024 * 1024

export function createReferenceReviewState(referenceMap) {
  const safeMap = normalizeReferenceMap(referenceMap)
  return {
    referenceMap: safeMap,
    items: safeMap.items.map((item) => cloneItem(item)),
    confirmedReferenceMap: null,
    reviewSummary: createReferenceReviewSummary(safeMap.items),
  }
}

export function createReferenceFileSelectionState(file) {
  return { ...resetReferenceReviewState(), selectedFile: file || null }
}

export function updateReferenceSheetDraftSelection(selectedSheetNames = [], sheetName, checked) {
  const normalizedSheetName = normalizeText(sheetName, 160)
  const current = Array.isArray(selectedSheetNames) ? selectedSheetNames.map((name) => normalizeText(name, 160)).filter(Boolean) : []
  if (!normalizedSheetName) return current
  if (checked) return current.includes(normalizedSheetName) ? current : [...current, normalizedSheetName]
  return current.filter((name) => name !== normalizedSheetName)
}

export function createReferenceNormalizeSuccessState(current, normalized, selectedSheetNames = []) {
  const reviewState = createReferenceReviewState(normalized?.referenceMap)
  return {
    ...current,
    referenceMap: reviewState.referenceMap,
    reviewItems: reviewState.items,
    confirmedReferenceMap: null,
    referenceMeta: {
      ...(normalized?.meta || {}),
      selectedSheetNames: normalizeSheetNames(selectedSheetNames),
    },
    normalizedSheetNames: normalizeSheetNames(selectedSheetNames),
    referenceError: '',
  }
}

export function createReferenceNormalizeFailureState(current, errorMessage) {
  return {
    ...current,
    referenceError: normalizeText(errorMessage, 500) || 'Reference 정규화에 실패했습니다.',
  }
}

export function confirmReferenceItem(items, referenceId) {
  return updateReferenceItem(items, referenceId, (item) => ({
    ...item,
    userDecision: { status: 'confirmed', edited: false, excludedReason: '' },
  }))
}

export function confirmAllReferenceItems(items = []) {
  return items.map((item) => {
    if (!isConfirmEligible(item) || item.userDecision?.status === 'excluded') return item
    if (item.userDecision?.status === 'confirmed') return item
    return {
      ...cloneItem(item),
      userDecision: { status: 'confirmed', edited: item.userDecision?.edited === true, excludedReason: '' },
    }
  })
}

export function countBulkConfirmEligibleItems(items = []) {
  return items.filter((item) => item.userDecision?.status !== 'confirmed' && item.userDecision?.status !== 'excluded' && isConfirmEligible(item)).length
}

export function editReferenceItem(items, referenceId, edits = {}) {
  return updateReferenceItem(items, referenceId, (item) => {
    const original = item.original || createOriginalSnapshot(item)
    const nextUrls = Array.isArray(edits.urls)
      ? edits.urls.map((url, index) => normalizeEditedUrl(url, item.expected?.urls?.[index])).filter(Boolean)
      : item.expected?.urls || []

    return {
      ...item,
      original,
      element: {
        ...(item.element || {}),
        label: normalizeText(edits.label, 240) || item.element?.label || '',
        aliases: normalizeAliases(edits.aliases),
      },
      expected: {
        ...(item.expected || {}),
        type: 'url',
        urls: nextUrls,
      },
      userDecision: { status: 'confirmed', edited: true, excludedReason: '' },
    }
  })
}

export function excludeReferenceItem(items, referenceId, excludedReason = '') {
  return updateReferenceItem(items, referenceId, (item) => ({
    ...item,
    userDecision: { status: 'excluded', edited: item.userDecision?.edited === true, excludedReason: normalizeText(excludedReason, 500) },
  }))
}

export function createConfirmedReferenceMap(referenceMap, items) {
  const summary = createReferenceReviewSummary(items)
  const confirmedItems = items
    .filter((item) => item.userDecision?.status === 'confirmed')
    .map((item) => cloneItem(item))

  return {
    schemaVersion: referenceMap?.schemaVersion || 'navigation-intent-reference-v1',
    sourceDocument: { ...(referenceMap?.sourceDocument || {}) },
    items: confirmedItems,
    unmappedCandidates: [],
    reviewSummary: summary,
  }
}

export function createReferencePreset({ referenceMap, items, meta, normalizedSheetNames } = {}) {
  const safeItems = Array.isArray(items) ? items.map(createPresetItem).filter(Boolean) : []
  const sourceDocument = referenceMap?.sourceDocument || {}
  return {
    schemaVersion: REFERENCE_PRESET_SCHEMA_VERSION,
    createdAt: new Date().toISOString(),
    sourceDocument: {
      fileName: normalizeText(sourceDocument.fileName, 240),
      analyzedAt: normalizeText(sourceDocument.analyzedAt, 80),
      mimeType: normalizeText(sourceDocument.mimeType, 120),
    },
    normalizedSheetNames: normalizeSheetNames(normalizedSheetNames || meta?.selectedSheetNames),
    referenceMap: {
      schemaVersion: referenceMap?.schemaVersion || 'navigation-intent-reference-v1',
      sourceDocument: {
        fileName: normalizeText(sourceDocument.fileName, 240),
        analyzedAt: normalizeText(sourceDocument.analyzedAt, 80),
        mimeType: normalizeText(sourceDocument.mimeType, 120),
      },
      items: safeItems,
      unmappedCandidates: [],
    },
    meta: sanitizePresetMeta(meta),
    reviewSummary: createReferenceReviewSummary(safeItems),
  }
}

export function createReferencePresetFilename(sourceFileName = '', date = new Date()) {
  const baseName = normalizeText(sourceFileName, 160).replace(/\.[^.]+$/u, '').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
  if (baseName) return `${baseName}.pagepilot-reference.json`
  const pad = (value) => String(value).padStart(2, '0')
  const stamp = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  return `pagepilot-reference-${stamp}.json`
}

export function importReferencePresetFromText(text, options = {}) {
  const rawText = typeof text === 'string' ? text : ''
  const maxBytes = Number(options.maxBytes) > 0 ? Number(options.maxBytes) : MAX_REFERENCE_PRESET_BYTES
  if (new TextEncoder().encode(rawText).length > maxBytes) throw new Error('Reference 설정 파일이 너무 큽니다.')
  let preset
  try {
    preset = JSON.parse(rawText)
  } catch {
    throw new Error('Reference 설정 JSON을 읽을 수 없습니다.')
  }
  return importReferencePreset(preset)
}

export function importReferencePreset(preset) {
  if (!preset || typeof preset !== 'object' || Array.isArray(preset)) throw new Error('Reference 설정 형식이 올바르지 않습니다.')
  if (preset.schemaVersion !== REFERENCE_PRESET_SCHEMA_VERSION) throw new Error('지원하지 않는 Reference 설정 버전입니다.')
  const referenceMap = normalizeReferenceMap(preset.referenceMap)
  if (!referenceMap.items.length) throw new Error('Reference 설정에 Preview 항목이 없습니다.')
  const reviewItems = referenceMap.items.map((item) => cloneItem(item))
  const normalizedSheetNames = normalizeSheetNames(preset.normalizedSheetNames || preset.meta?.selectedSheetNames)
  return {
    ...resetReferenceReviewState(),
    selectedFile: null,
    analyzedReference: null,
    referenceMap,
    reviewItems,
    confirmedReferenceMap: createConfirmedReferenceMap(referenceMap, reviewItems),
    referenceMeta: {
      ...sanitizePresetMeta(preset.meta),
      selectedSheetNames: normalizedSheetNames,
      importedPreset: true,
      sourceFileName: normalizeText(preset.sourceDocument?.fileName, 240),
    },
    normalizedSheetNames,
    referenceError: '',
  }
}

export function createCompactNavigationReferenceMap(confirmedReferenceMap) {
  if (!confirmedReferenceMap || typeof confirmedReferenceMap !== 'object' || Array.isArray(confirmedReferenceMap)) return null
  const items = Array.isArray(confirmedReferenceMap.items)
    ? confirmedReferenceMap.items.map(createCompactNavigationReferenceItem).filter(Boolean)
    : []
  if (items.length === 0) return null

  return {
    schemaVersion: confirmedReferenceMap.schemaVersion || 'navigation-intent-reference-v1',
    sourceDocument: {
      fileName: normalizeText(confirmedReferenceMap.sourceDocument?.fileName, 240),
      analyzedAt: normalizeText(confirmedReferenceMap.sourceDocument?.analyzedAt, 80),
    },
    items,
  }
}

export function createExpectedUrlDisplayRows(item) {
  return Array.isArray(item?.expected?.urls)
    ? item.expected.urls.map((url) => normalizeText(url?.raw, 800)).filter(Boolean)
    : []
}

export function createExpectedUrlExportText(item) {
  return createExpectedUrlDisplayRows(item).join('\n')
}

export function createReferenceReviewSummary(items = []) {
  return items.reduce((summary, item) => {
    const status = item.userDecision?.status || 'pending'
    if (status === 'confirmed') {
      summary.confirmed += 1
      if (item.userDecision?.edited === true) summary.edited += 1
    } else if (status === 'excluded') {
      summary.excluded += 1
    } else {
      summary.pending += 1
    }
    return summary
  }, { confirmed: 0, edited: 0, excluded: 0, pending: 0 })
}

export function resetReferenceReviewState() {
  return {
    selectedFile: null,
    analyzedReference: null,
    referenceMap: null,
    reviewItems: [],
    confirmedReferenceMap: null,
    referenceMeta: null,
    normalizedSheetNames: [],
    referenceError: '',
  }
}

function isConfirmEligible(item) {
  return Boolean(normalizeText(item?.element?.label, 240) && Array.isArray(item?.expected?.urls) && item.expected.urls.some((url) => normalizeText(url?.raw, 800)))
}

function createPresetItem(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return null
  return {
    referenceId: normalizeText(item.referenceId, 80),
    source: {
      sheetName: normalizeText(item.source?.sheetName, 160),
      rowNumber: Number.isFinite(Number(item.source?.rowNumber)) ? Number(item.source.rowNumber) : null,
      evidenceText: normalizeText(item.source?.evidenceText, 300),
    },
    pageContext: {
      sectionHint: normalizeText(item.pageContext?.sectionHint, 160),
      depthPath: normalizeStringArray(item.pageContext?.depthPath, 8, 160),
      pageUrlHint: normalizeText(item.pageContext?.pageUrlHint, 500),
    },
    element: {
      label: normalizeText(item.element?.label, 240),
      aliases: normalizeStringArray(item.element?.aliases, 12, 160),
      roleHint: normalizeText(item.element?.roleHint, 80),
      actionHint: normalizeText(item.element?.actionHint, 80),
    },
    expected: {
      type: 'url',
      urls: Array.isArray(item.expected?.urls) ? item.expected.urls.map(createCompactNavigationUrl).filter(Boolean) : [],
      notes: normalizeText(item.expected?.notes, 300),
    },
    provenance: item.provenance && typeof item.provenance === 'object' && !Array.isArray(item.provenance) ? {
      urlSource: normalizeText(item.provenance.urlSource, 120),
      labelSource: normalizeText(item.provenance.labelSource, 120),
      inferenceUsed: item.provenance.inferenceUsed === true,
      aiRationale: normalizeText(item.provenance.aiRationale, 300),
    } : {},
    confidence: Number.isFinite(Number(item.confidence)) ? Number(item.confidence) : 0,
    userDecision: normalizeUserDecision(item.userDecision),
    original: item.original ? {
      element: cloneItem(item.original.element || {}),
      expected: cloneItem(item.original.expected || {}),
    } : undefined,
    isUnmappedCandidate: item.isUnmappedCandidate === true,
    duplicateCandidate: item.duplicateCandidate === true,
  }
}

function sanitizePresetMeta(meta = {}) {
  const safeMeta = meta && typeof meta === 'object' && !Array.isArray(meta) ? meta : {}
  return {
    model: normalizeText(safeMeta.model, 120),
    selectedSheetNames: normalizeSheetNames(safeMeta.selectedSheetNames),
    coverage: safeMeta.coverage && typeof safeMeta.coverage === 'object' && !Array.isArray(safeMeta.coverage) ? cloneItem(safeMeta.coverage) : {},
    chunking: safeMeta.chunking && typeof safeMeta.chunking === 'object' && !Array.isArray(safeMeta.chunking) ? cloneItem(safeMeta.chunking) : {},
    warnings: normalizeStringArray(safeMeta.warnings, 10, 300),
  }
}

function normalizeSheetNames(value) {
  return Array.isArray(value) ? value.map((item) => normalizeText(item, 160)).filter(Boolean) : []
}

function normalizeReferenceMap(referenceMap) {
  return {
    schemaVersion: referenceMap?.schemaVersion || 'navigation-intent-reference-v1',
    sourceDocument: { ...(referenceMap?.sourceDocument || {}) },
    unmappedCandidates: Array.isArray(referenceMap?.unmappedCandidates) ? referenceMap.unmappedCandidates.map((item) => cloneItem(item)) : [],
    items: Array.isArray(referenceMap?.items) ? referenceMap.items.map((item) => ({
      ...cloneItem(item),
      userDecision: normalizeUserDecision(item.userDecision),
    })) : [],
  }
}

function createCompactNavigationReferenceItem(item) {
  if (!item || typeof item !== 'object') return null
  if (item.userDecision?.status && item.userDecision.status !== 'confirmed') return null
  const referenceId = normalizeText(item.referenceId, 80)
  const label = normalizeText(item.element?.label, 240)
  const urls = Array.isArray(item.expected?.urls) ? item.expected.urls.map(createCompactNavigationUrl).filter(Boolean) : []
  if (!referenceId || !label || urls.length === 0) return null
  return {
    referenceId,
    source: {
      sheetName: normalizeText(item.source?.sheetName, 160),
      rowNumber: Number.isFinite(Number(item.source?.rowNumber)) ? Number(item.source.rowNumber) : null,
      evidenceText: normalizeText(item.source?.evidenceText, 300),
    },
    pageContext: {
      sectionHint: normalizeText(item.pageContext?.sectionHint, 160),
      depthPath: normalizeStringArray(item.pageContext?.depthPath, 8, 160),
    },
    element: {
      label,
      aliases: normalizeStringArray(item.element?.aliases, 12, 160),
      roleHint: normalizeText(item.element?.roleHint, 80),
      actionHint: normalizeText(item.element?.actionHint, 80),
    },
    expected: { type: 'url', urls },
    userDecision: {
      status: 'confirmed',
      edited: item.userDecision?.edited === true,
      excludedReason: '',
    },
  }
}

function createCompactNavigationUrl(url) {
  const raw = normalizeText(url?.raw, 800)
  if (!raw) return null
  return {
    raw,
    normalizedPath: normalizeText(url.normalizedPath, 800),
    query: url.query && typeof url.query === 'object' && !Array.isArray(url.query) ? { ...url.query } : {},
    hash: normalizeText(url.hash, 200),
    matchMode: normalizeText(url.matchMode, 80) || 'path-and-query',
    allowSameOrigin: url.allowSameOrigin !== false,
    allowRedirect: url.allowRedirect === true,
    allowTrailingSlashVariant: url.allowTrailingSlashVariant !== false,
    dynamicParameters: normalizeStringArray(url.dynamicParameters, 20, 80),
  }
}

function updateReferenceItem(items, referenceId, updater) {
  return items.map((item) => item.referenceId === referenceId ? updater(cloneItem(item)) : item)
}

function normalizeEditedUrl(rawUrl, previousUrl = {}) {
  const raw = normalizeText(rawUrl, 800)
  if (!raw) return null
  return {
    ...previousUrl,
    raw,
    ...parseUrlParts(raw),
  }
}

function parseUrlParts(raw) {
  try {
    const parsed = raw.startsWith('http://') || raw.startsWith('https://') ? new URL(raw) : new URL(raw, 'https://reference.local')
    return {
      normalizedPath: parsed.pathname || '/',
      query: Object.fromEntries(parsed.searchParams.entries()),
      hash: parsed.hash ? parsed.hash.slice(1) : '',
    }
  } catch {
    const [beforeHash, hash = ''] = raw.split('#')
    const [path, queryText = ''] = beforeHash.split('?')
    return { normalizedPath: path || raw, query: parseQuery(queryText), hash }
  }
}

function parseQuery(queryText) {
  if (!queryText) return {}
  return Object.fromEntries(queryText.split('&').map((pair) => {
    const [key, value = ''] = pair.split('=')
    return [key, value]
  }).filter(([key]) => key))
}

function normalizeUserDecision(userDecision = {}) {
  const status = ['pending', 'confirmed', 'excluded'].includes(userDecision.status) ? userDecision.status : 'pending'
  return {
    status,
    edited: userDecision.edited === true,
    excludedReason: normalizeText(userDecision.excludedReason, 500),
  }
}

function createOriginalSnapshot(item) {
  return {
    element: cloneItem(item.element || {}),
    expected: cloneItem(item.expected || {}),
  }
}

function normalizeAliases(value) {
  if (Array.isArray(value)) return value.map((item) => normalizeText(item, 160)).filter(Boolean)
  return normalizeText(value, 500).split(',').map((item) => normalizeText(item, 160)).filter(Boolean)
}

function normalizeStringArray(value, maxItems, maxLength) {
  return Array.isArray(value) ? value.map((item) => normalizeText(item, maxLength)).filter(Boolean).slice(0, maxItems) : []
}

function normalizeText(value, maxLength) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, maxLength) : ''
}

function cloneItem(value) {
  return JSON.parse(JSON.stringify(value || {}))
}
