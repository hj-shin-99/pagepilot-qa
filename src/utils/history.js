const HISTORY_KEY = 'pagepilot-qa-history-v3'
const LEGACY_HISTORY_KEY = 'pagepilot-qa-history-v2'
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
    const storedHistory = localStorage.getItem(HISTORY_KEY) || localStorage.getItem(LEGACY_HISTORY_KEY) || '[]'
    const parsed = JSON.parse(storedHistory)
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

  const url = getString(item.url || item.webUrl || item.result?.targetUrl)
  if (!url) return null

  const scannedAt = getValidDate(item.scannedAt || item.createdAt || item.result?.scannedAt)
  const counts = sanitizeCounts(item.counts)
  const topIssueSummaries = sanitizeTopIssueSummaries(item.topIssueSummaries, item.issueSummary)
  const designImageFilenames = sanitizeDesignImageFilenames(item.designImageFilenames, item.inputs?.designImages)
  const figmaUrl = getString(item.figmaUrl)
  const result = item.result && typeof item.result === 'object' ? item.result : null
  const visual = sanitizeSessionBranch(item.visual)
  const tech = sanitizeSessionBranch(item.tech)
  const aiReview = sanitizeAiReview(item.aiReview)
  const type = sanitizeHistoryType(item.type, result, figmaUrl, visual, tech)

  return {
    type,
    id: getString(item.id) || `${scannedAt}-${url}-${index}`,
    url,
    webUrl: url,
    figmaUrl,
    scannedAt,
    createdAt: getValidDate(item.createdAt || scannedAt),
    summary: getString(item.summary),
    totalIssueCount: getNumber(item.totalIssueCount) || counts.total,
    counts,
    topIssueSummaries,
    designImageFilenames,
    result,
    visual,
    tech,
    aiReview,
  }
}

function sanitizeAiReview(aiReview) {
  if (!aiReview || typeof aiReview !== 'object') return null
  const review = aiReview.review && typeof aiReview.review === 'object' ? aiReview.review : {}
  return {
    meta: {
      openAiCalled: aiReview.meta?.openAiCalled === true,
      model: getString(aiReview.meta?.model),
      fallbackUsed: aiReview.meta?.fallbackUsed === true,
    },
    review: {
      releaseDecision: sanitizeReleaseDecision(review.releaseDecision),
      summary: getString(review.summary),
      mustFix: sanitizeAiIssueList(review.mustFix),
      verify: sanitizeAiIssueList(review.verify),
      developerNotes: sanitizeAiIssueList(review.developerNotes),
      clientReplyDraft: getString(review.clientReplyDraft),
    },
  }
}

function sanitizeReleaseDecision(value) {
  return ['ready', 'caution', 'blocked'].includes(value) ? value : 'caution'
}

function sanitizeAiIssueList(value) {
  if (!Array.isArray(value)) return []
  return value.map((item) => {
    if (typeof item === 'string') return { category: 'tech', title: item, description: item, evidence: [], severity: 'warning' }
    if (!item || typeof item !== 'object') return null
    return {
      category: getString(item.category) || 'tech',
      title: getString(item.title),
      description: getString(item.description),
      evidence: Array.isArray(item.evidence) ? item.evidence.map(getString).filter(Boolean).slice(0, 4) : [],
      severity: getString(item.severity) || 'warning',
    }
  }).filter(Boolean).slice(0, 10)
}

function sanitizeHistoryType(type, result, figmaUrl, visual, tech) {
  if (type === 'visual' || type === 'tech' || type === 'combined') return type
  if (visual || tech) return 'combined'
  if (result?.targetUrl) return 'tech'
  if (result?.meta || result?.comparison || figmaUrl) return 'visual'
  return 'tech'
}

function sanitizeSessionBranch(branch) {
  if (!branch || typeof branch !== 'object') return null
  return {
    status: sanitizeBranchStatus(branch.status),
    summary: getString(branch.summary),
    compactResult: branch.compactResult && typeof branch.compactResult === 'object' ? branch.compactResult : null,
    error: getString(branch.error),
  }
}

function sanitizeBranchStatus(status) {
  if (['idle', 'loading', 'success', 'error', 'skipped'].includes(status)) return status
  return 'idle'
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
