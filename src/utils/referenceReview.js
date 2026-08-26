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

export function createExpectedUrlDisplayRows(item) {
  return Array.isArray(item?.expected?.urls)
    ? item.expected.urls.map((url) => normalizeText(url?.raw, 800)).filter(Boolean)
    : []
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

function normalizeText(value, maxLength) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, maxLength) : ''
}

function cloneItem(value) {
  return JSON.parse(JSON.stringify(value || {}))
}
