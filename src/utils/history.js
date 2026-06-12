const HISTORY_KEY = 'pagepilot-qa-history-v2'
const MAX_HISTORY_ITEMS = 10
const MAX_HISTORY_IMAGES = 50
const MAX_HISTORY_CONSOLE_MESSAGES = 50
const MAX_HISTORY_MISSING_HREFS = 50
const MAX_HISTORY_FIGMA_ELEMENTS = 120
const MAX_HISTORY_DESIGN_ELEMENTS = 120
const EMPTY_STATUS_COUNTS = { normal: 0, error: 0, warn: 0 }

export function loadHistoryItems() {
  try {
    const parsed = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]')
    return Array.isArray(parsed) ? parsed.map(sanitizeHistoryItem).filter(Boolean) : []
  } catch {
    return []
  }
}

export function saveHistoryItem(item) {
  const safeItem = sanitizeHistoryItem(item)
  const currentItems = loadHistoryItems()
  if (!safeItem) return currentItems

  const nextItems = [safeItem, ...currentItems.filter((historyItem) => historyItem.id !== safeItem.id)].slice(0, MAX_HISTORY_ITEMS)

  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(nextItems))
  } catch {
    return currentItems
  }

  return nextItems
}

function sanitizeHistoryItem(item, index = 0) {
  if (!item || typeof item !== 'object') return null

  const result = sanitizeResult(item.result)
  const url = getString(item.url || result?.targetUrl)
  if (!url || !result) return null

  const scannedAt = getValidDate(item.scannedAt || result.scannedAt)

  return {
    id: getString(item.id) || `${scannedAt}-${url}-${index}`,
    url,
    scannedAt,
    counts: sanitizeStatusCounts(item.counts),
    issueSummary: getString(item.issueSummary) || '저장된 QA 결과',
    result: {
      ...result,
      targetUrl: url,
      scannedAt,
    },
    inputs: sanitizeInputs(item.inputs),
  }
}

function sanitizeResult(result) {
  if (!result || typeof result !== 'object' || !Array.isArray(result.checks)) return null

  return {
    targetUrl: getString(result.targetUrl),
    scannedAt: getValidDate(result.scannedAt),
    pageTitle: getString(result.pageTitle),
    httpStatus: result.httpStatus ?? null,
    accessible: Boolean(result.accessible),
    navigationError: getString(result.navigationError),
    checks: result.checks.filter(Boolean),
    links: getArray(result.links),
    uncheckedLinkCount: getNumber(result.uncheckedLinkCount),
    missingHrefLinks: getArray(result.missingHrefLinks).slice(0, MAX_HISTORY_MISSING_HREFS),
    images: getArray(result.images).slice(0, MAX_HISTORY_IMAGES),
    designElements: getArray(result.designElements).slice(0, MAX_HISTORY_DESIGN_ELEMENTS),
    consoleMessages: getArray(result.consoleMessages).slice(0, MAX_HISTORY_CONSOLE_MESSAGES),
    counts: sanitizeDomCounts(result.counts),
    mobile: sanitizeMobile(result.mobile),
  }
}

function sanitizeInputs(inputs) {
  const safeInputs = inputs && typeof inputs === 'object' ? inputs : {}

  return {
    figmaJson: '',
    figmaElements: getArray(safeInputs.figmaElements).slice(0, MAX_HISTORY_FIGMA_ELEMENTS),
    designImages: getArray(safeInputs.designImages).map(sanitizeImageMetadata).filter(Boolean),
  }
}

function sanitizeImageMetadata(image, index) {
  if (!image || typeof image !== 'object') return null
  const name = getString(image.name) || `Design image ${index + 1}`

  return {
    id: getString(image.id) || `${name}-${index}`,
    name,
    size: getNumber(image.size),
  }
}

function sanitizeStatusCounts(counts) {
  if (!counts || typeof counts !== 'object') return EMPTY_STATUS_COUNTS

  return {
    normal: getNumber(counts.normal),
    error: getNumber(counts.error),
    warn: getNumber(counts.warn),
  }
}

function sanitizeDomCounts(counts) {
  if (!counts || typeof counts !== 'object') return { anchors: 0, buttons: 0, missingHrefs: 0 }

  return {
    anchors: getNumber(counts.anchors),
    buttons: getNumber(counts.buttons),
    missingHrefs: getNumber(counts.missingHrefs),
  }
}

function sanitizeMobile(mobile) {
  const safeMobile = mobile && typeof mobile === 'object' ? mobile : {}
  const viewport = safeMobile.viewport && typeof safeMobile.viewport === 'object' ? safeMobile.viewport : {}

  return {
    accessible: Boolean(safeMobile.accessible),
    statusCode: safeMobile.statusCode ?? null,
    viewport: {
      width: getNumber(viewport.width) || 390,
      height: getNumber(viewport.height) || 844,
    },
    note: getString(safeMobile.note) || '저장된 모바일 검사 결과입니다.',
  }
}

function getArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : []
}

function getString(value) {
  return typeof value === 'string' ? value : ''
}

function getNumber(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : 0
}

function getValidDate(value) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? new Date(0).toISOString() : date.toISOString()
}
