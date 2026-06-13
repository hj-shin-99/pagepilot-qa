const HISTORY_KEY = 'pagepilot-qa-history-v2'
const MAX_HISTORY_ITEMS = 10
const EMPTY_COUNTS = {
  total: 0,
  high: 0,
  text: 0,
  style: 0,
  layout: 0,
  cta: 0,
  footer: 0,
  techError: 0,
  techWarn: 0,
}

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

  const url = getString(item.url || item.result?.targetUrl)
  if (!url) return null

  const scannedAt = getValidDate(item.scannedAt || item.result?.scannedAt)
  const counts = sanitizeCounts(item.counts)
  const topIssueSummaries = sanitizeTopIssueSummaries(item.topIssueSummaries, item.issueSummary)
  const designImageFilenames = sanitizeDesignImageFilenames(item.designImageFilenames, item.inputs?.designImages)

  return {
    id: getString(item.id) || `${scannedAt}-${url}-${index}`,
    url,
    scannedAt,
    totalIssueCount: getNumber(item.totalIssueCount) || counts.total,
    counts,
    topIssueSummaries,
    designImageFilenames,
  }
}

function sanitizeCounts(counts) {
  const safeCounts = counts && typeof counts === 'object' ? counts : {}

  if ('normal' in safeCounts || 'error' in safeCounts || 'warn' in safeCounts) {
    const error = getNumber(safeCounts.error)
    const warn = getNumber(safeCounts.warn)

    return {
      ...EMPTY_COUNTS,
      total: error + warn,
      high: error,
      techError: error,
      techWarn: warn,
    }
  }

  return {
    total: getNumber(safeCounts.total),
    high: getNumber(safeCounts.high),
    text: getNumber(safeCounts.text),
    style: getNumber(safeCounts.style),
    layout: getNumber(safeCounts.layout),
    cta: getNumber(safeCounts.cta),
    footer: getNumber(safeCounts.footer),
    techError: getNumber(safeCounts.techError),
    techWarn: getNumber(safeCounts.techWarn),
  }
}

function sanitizeTopIssueSummaries(topIssueSummaries, legacyIssueSummary) {
  const summaries = Array.isArray(topIssueSummaries) ? topIssueSummaries : [legacyIssueSummary]
  const safeSummaries = summaries.map(getString).filter(Boolean).slice(0, 3)

  return safeSummaries.length > 0 ? safeSummaries : ['저장된 QA 결과']
}

function sanitizeDesignImageFilenames(filenames, legacyImages) {
  if (Array.isArray(filenames)) return filenames.map(getString).filter(Boolean)
  if (!Array.isArray(legacyImages)) return []
  return legacyImages.map((image) => getString(image?.name)).filter(Boolean)
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
