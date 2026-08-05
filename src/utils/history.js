import { normalizeDeviceIds } from '../../shared/deviceProfiles.js'
import { normalizeTechScanOptions } from '../../shared/techScanOptions.js'
import { createTechQaViewModel } from './techQa.js'
import { createCompactVisualResult } from './visualQa.js'

export const HISTORY_KEY = 'pagepilot-qa-history-v3'
export const LEGACY_HISTORY_KEY = 'pagepilot-qa-history-v2'
export const MAX_HISTORY_ITEMS = 5
const MAX_HISTORY_STRING_LENGTH = 800
const MAX_HISTORY_ARRAY_ITEMS = 40
const MAX_HISTORY_OBJECT_DEPTH = 8
const OMIT_HISTORY_PAYLOAD_KEY_PATTERN = /^(raw|raw[A-Z].*|debug|stack|stackTrace|trace|html|body|headers|request|response|networkRequests|displayModel|viewModel|screenshot|screenshotPath|screenshotBase64|imageBase64|base64|dataUrl|cookieValue|value)$/
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

export function createCompactHistoryItemForStorage(item) {
  return compactHistoryItem(sanitizeHistoryItem(item, 0, { generateMissingId: true }))
}

export function normalizeHistoryItems(items = []) {
  if (!Array.isArray(items)) return []
  return items
    .map((rawItem, index) => ({ item: compactHistoryItem(sanitizeHistoryItem(rawItem, index)), index, sortTime: getHistorySortTime(rawItem) }))
    .filter((entry) => entry.item)
    .sort(compareHistoryEntries)
    .map((entry) => entry.item)
}

export function sortHistoryItems(items = []) {
  return items
    .map((item, index) => ({ item, index, sortTime: getHistorySortTime(item) }))
    .sort(compareHistoryEntries)
    .map((entry) => entry.item)
}

export function getHistoryDisplayStatus(item = {}) {
  const branches = getHistoryBranches(item)
  const expectedBranches = branches.filter((branch) => branch.expected)
  const successfulBranches = expectedBranches.filter((branch) => branch.succeeded)
  const failedBranches = expectedBranches.filter((branch) => branch.failed)
  const hasRestorableResult = successfulBranches.length > 0

  if (expectedBranches.length === 0 || (!hasRestorableResult && (failedBranches.length > 0 || hasFailureSignal(item)))) return 'failed'
  if (expectedBranches.length > 0 && failedBranches.length === expectedBranches.length) return 'failed'
  if (failedBranches.length > 0 && hasRestorableResult) return 'warn'
  if (!hasRestorableResult) return 'failed'

  const techCounts = getHistoryTechIssueCounts(item)
  if (techCounts.errorCount > 0) return 'error'
  if (techCounts.warningCount > 0 || hasFailedDeviceResult(item) || getHistoryVisualDifferenceCount(item) > 0) return 'warn'
  return 'ok'
}

export function createHistoryCardSummary(item = {}) {
  const branches = getHistoryBranches(item)
  const visual = branches.find((branch) => branch.kind === 'visual')
  const tech = branches.find((branch) => branch.kind === 'tech')
  const expectedBranches = branches.filter((branch) => branch.expected)
  const successfulBranches = expectedBranches.filter((branch) => branch.succeeded)
  const failedBranches = expectedBranches.filter((branch) => branch.failed)

  if (visual?.failed && tech?.failed) return 'Visual QA와 Tech QA를 완료하지 못했습니다.'
  if (visual?.succeeded && tech?.failed) return 'Visual QA는 완료했지만 Tech QA를 완료하지 못했습니다.'
  if (tech?.succeeded && visual?.failed) return 'Tech QA는 완료했지만 Visual QA를 완료하지 못했습니다.'
  if (item.url === '저장된 URL 없음' && !successfulBranches.length) return '저장된 과거 결과를 완전히 복원할 수 없습니다.'
  if (item.type === 'tech' && tech?.failed) return 'Tech QA를 완료하지 못했습니다.'
  if (item.type === 'visual' && visual?.failed) return 'Visual QA를 완료하지 못했습니다.'
  if (expectedBranches.length === 0 || (!successfulBranches.length && failedBranches.length)) return '저장된 과거 결과를 완전히 복원할 수 없습니다.'

  const techCounts = getHistoryTechIssueCounts(item)
  const visualDifferenceCount = getHistoryVisualDifferenceCount(item)
  const summaries = []
  if (techCounts.errorCount > 0 || techCounts.warningCount > 0) summaries.push(`Tech QA 문제 확인 ${techCounts.errorCount}개, 검토 필요 ${techCounts.warningCount}개`)
  if (visualDifferenceCount > 0) summaries.push(`Visual QA 차이 ${visualDifferenceCount}개 확인 필요`)
  if (hasFailedDeviceResult(item)) summaries.push('일부 기기 검사를 완료하지 못했습니다.')
  return summaries.length > 0 ? summaries.join(' · ') : '문제 확인과 검토 필요 항목은 없습니다.'
}

export function createHistoryDetailMeta(item = {}) {
  const techCounts = getHistoryTechIssueCounts(item)
  const visualDifferenceCount = getHistoryVisualDifferenceCount(item)
  const details = []
  if (visualDifferenceCount > 0) details.push(`Visual 차이 ${visualDifferenceCount}개`)
  if (techCounts.errorCount > 0) details.push(`Tech 문제 확인 ${techCounts.errorCount}개`)
  if (techCounts.warningCount > 0) details.push(`Tech 검토 필요 ${techCounts.warningCount}개`)
  return details
}

function sanitizeHistoryItem(item, index = 0, options = {}) {
  if (!item || typeof item !== 'object') return null

  const url = getString(item.url || item.webUrl || item.result?.targetUrl || item.result?.meta?.webUrl || item.visual?.compactResult?.meta?.webUrl || item.tech?.compactResult?.targetUrl || item.figmaUrl) || '저장된 URL 없음'

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
  const totalDurationMs = getOptionalDurationMs(item.totalDurationMs)

  return {
    type,
    id: getString(item.id) || (options.generateMissingId ? createHistoryItemId('history') : `${scannedAt}-${url}-${index}`),
    url,
    webUrl: url,
    figmaUrl,
    devices: normalizeDeviceIds(item.devices || result?.devices || tech?.devices),
    scannedAt,
    createdAt: getValidDate(item.createdAt || scannedAt),
    ...(totalDurationMs !== null ? { totalDurationMs } : {}),
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
      aiReviewDurationMs: getOptionalDurationMs(aiReview.meta?.aiReviewDurationMs),
      totalDurationMs: getOptionalDurationMs(aiReview.meta?.totalDurationMs),
      rawVisionCount: getNumber(aiReview.meta?.rawVisionCount),
      fallbackUsed: aiReview.meta?.fallbackUsed === true,
    },
    review: {
      releaseDecision: sanitizeReleaseDecision(review.releaseDecision),
      summary: getString(review.summary),
      mustFix: sanitizeAiIssueList(review.mustFix),
      verify: sanitizeAiIssueList(review.verify),
      developerNotes: sanitizeAiIssueList(review.developerNotes),
      visualDifferences: sanitizeVisualDifferences(review.visualDifferences),
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

function sanitizeVisualDifferences(value) {
  if (!Array.isArray(value)) return []
  return value.map((item, index) => {
    if (!item || typeof item !== 'object') return null
    return {
      area: getString(item.area) || 'Page Content',
      category: getString(item.category) || 'Layout',
      title: getString(item.title),
      summary: getString(item.summary),
      figmaValue: getString(item.figmaValue),
      webValue: getString(item.webValue),
      severity: getString(item.severity) || 'warning',
      confidence: getString(item.confidence) || 'medium',
      order: Number.isFinite(Number(item.order)) ? Number(item.order) : index,
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
    scanOptions: branch.scanOptions && typeof branch.scanOptions === 'object' ? branch.scanOptions : null,
    devices: normalizeDeviceIds(branch.devices || branch.compactResult?.devices),
    error: getString(branch.error),
  }
}

export function createHistoryItemId(prefix = 'history') {
  const safePrefix = getString(prefix) || 'history'
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return `${safePrefix}-${crypto.randomUUID()}`
  } catch {
    // Fall through to the timestamp/random fallback.
  }

  const now = Date.now()
  const perfNow = typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : now
  const random = Math.random().toString(36).slice(2, 10)
  return `${safePrefix}-${now}-${perfNow}-${random}`
}

function compactHistoryItem(item) {
  if (!item) return null
  const compactItem = {
    ...item,
    result: compactHistoryResult(item.type, item.result),
    visual: compactHistoryBranch('visual', item.visual),
    tech: compactHistoryBranch('tech', item.tech),
  }
  return pruneHistoryPayload(compactItem)
}

function compactHistoryBranch(kind, branch) {
  if (!branch) return null
  return {
    ...branch,
    compactResult: compactHistoryResult(kind, branch.compactResult),
  }
}

function compactHistoryResult(kind, result) {
  if (!result || typeof result !== 'object') return null
  if (kind === 'tech' || result.targetUrl) return createCompactTechResult(result)
  if (kind === 'visual' || result.meta || result.comparison) return createCompactVisualResult(result)
  return result
}

export function createCompactTechResult(result = {}) {
  return {
    targetUrl: result.targetUrl,
    scannedAt: result.scannedAt,
    durationMs: result.durationMs,
    totalDurationMs: result.totalDurationMs,
    pageTitle: result.pageTitle,
    httpStatus: result.httpStatus,
    accessible: result.accessible,
    navigationError: result.navigationError,
    checks: Array.isArray(result.checks) ? result.checks : [],
    links: Array.isArray(result.links) ? result.links : [],
    uncheckedLinkCount: result.uncheckedLinkCount || 0,
    missingHrefLinks: Array.isArray(result.missingHrefLinks) ? result.missingHrefLinks : [],
    images: Array.isArray(result.images) ? result.images : [],
    consoleMessages: Array.isArray(result.consoleMessages) ? result.consoleMessages : [],
    consoleAudit: result.consoleAudit || {},
    counts: result.counts || {},
    mobile: result.mobile || { viewport: { width: 0, height: 0 }, statusCode: null, note: '' },
    linkAudit: result.linkAudit || {},
    scanOptions: normalizeTechScanOptions(result.scanOptions),
    devices: normalizeDeviceIds(result.devices),
    device: result.device || null,
    deviceId: result.deviceId || result.device?.deviceId || '',
    deviceLabel: result.deviceLabel || result.device?.deviceLabel || '',
    viewport: result.viewport || result.device?.viewport || null,
    hasTouch: result.hasTouch === true || result.device?.hasTouch === true,
    isMobile: result.isMobile === true || result.device?.isMobile === true,
    deviceResults: Array.isArray(result.deviceResults) ? result.deviceResults.map((entry) => ({
      deviceId: entry.deviceId,
      deviceLabel: entry.deviceLabel,
      viewport: entry.viewport,
      hasTouch: entry.hasTouch === true,
      isMobile: entry.isMobile === true,
      status: entry.status,
      errorType: entry.errorType || '',
      error: entry.error || '',
      result: entry.result && typeof entry.result === 'object' ? createCompactTechResult({ ...entry.result, deviceResults: [] }) : null,
    })) : [],
    clickActions: Array.isArray(result.clickActions) ? result.clickActions : [],
    clickActionAudit: result.clickActionAudit || {},
    scrollInteractions: Array.isArray(result.scrollInteractions) ? result.scrollInteractions : [],
    scrollAudit: result.scrollAudit || {},
    responsiveLayouts: Array.isArray(result.responsiveLayouts) ? result.responsiveLayouts : [],
    responsiveAudit: result.responsiveAudit || {},
    downloadResources: Array.isArray(result.downloadResources) ? result.downloadResources : [],
    downloadAudit: result.downloadAudit || {},
    uiControlWithoutUrlCount: result.uiControlWithoutUrlCount || 0,
    ...(Array.isArray(result.cookieItems) || result.cookieAudit ? {
      cookieItems: Array.isArray(result.cookieItems) ? result.cookieItems : [],
      cookieAudit: result.cookieAudit || {},
    } : {}),
    ...(Array.isArray(result.imageItems) || result.imageAudit ? {
      imageItems: Array.isArray(result.imageItems) ? result.imageItems : [],
      imageAudit: result.imageAudit || {},
    } : {}),
    ...(Array.isArray(result.performanceItems) || result.performanceAudit ? {
      performanceItems: Array.isArray(result.performanceItems) ? result.performanceItems : [],
      performanceAudit: result.performanceAudit || {},
    } : {}),
    ...(Array.isArray(result.seoItems) || result.seoAudit ? {
      seoItems: Array.isArray(result.seoItems) ? result.seoItems : [],
      seoAudit: result.seoAudit || {},
    } : {}),
  }
}

function pruneHistoryPayload(value, key = '', depth = 0) {
  if (key !== 'rawVisionCount' && OMIT_HISTORY_PAYLOAD_KEY_PATTERN.test(key)) return undefined
  if (value === null || value === undefined) return value
  if (typeof value === 'string') return compactHistoryString(value)
  if (typeof value !== 'object') return value
  if (depth >= MAX_HISTORY_OBJECT_DEPTH) return '[truncated]'

  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_HISTORY_ARRAY_ITEMS)
      .map((item) => pruneHistoryPayload(item, '', depth + 1))
      .filter((item) => item !== undefined)
  }

  return Object.entries(value).reduce((nextValue, [entryKey, entryValue]) => {
    const prunedValue = pruneHistoryPayload(entryValue, entryKey, depth + 1)
    if (prunedValue !== undefined) nextValue[entryKey] = prunedValue
    return nextValue
  }, {})
}

function compactHistoryString(value) {
  if (/^data:/i.test(value)) return '[data-url omitted]'
  if (value.length <= MAX_HISTORY_STRING_LENGTH) return value
  return `${value.slice(0, MAX_HISTORY_STRING_LENGTH)}...[truncated ${value.length - MAX_HISTORY_STRING_LENGTH} chars]`
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

function compareHistoryEntries(first, second) {
  if (second.sortTime !== first.sortTime) return second.sortTime - first.sortTime
  const firstSavedOrder = Number(first.item?.savedOrder)
  const secondSavedOrder = Number(second.item?.savedOrder)
  if (Number.isFinite(firstSavedOrder) && Number.isFinite(secondSavedOrder) && secondSavedOrder !== firstSavedOrder) return secondSavedOrder - firstSavedOrder
  const firstSavedTime = Date.parse(first.item?.savedAt)
  const secondSavedTime = Date.parse(second.item?.savedAt)
  if (Number.isFinite(firstSavedTime) && Number.isFinite(secondSavedTime) && secondSavedTime !== firstSavedTime) return secondSavedTime - firstSavedTime
  return first.index - second.index
}

function getHistorySortTime(item = {}) {
  for (const key of ['scannedAt', 'createdAt', 'timestamp']) {
    const time = Date.parse(item?.[key])
    if (Number.isFinite(time)) return time
  }
  const resultTime = Date.parse(item?.result?.scannedAt)
  return Number.isFinite(resultTime) ? resultTime : Number.NEGATIVE_INFINITY
}

function getHistoryBranches(item = {}) {
  const visualResult = item.visual?.compactResult || (item.type === 'visual' ? item.result : null)
  const techResult = item.tech?.compactResult || (item.type === 'tech' ? item.result : null)
  const expectsVisual = item.type === 'visual' || item.type === 'combined' || Boolean(item.visual)
  const expectsTech = item.type === 'tech' || item.type === 'combined' || Boolean(item.tech)
  return [
    createHistoryBranch('visual', expectsVisual, item.visual, visualResult, item),
    createHistoryBranch('tech', expectsTech, item.tech, techResult, item),
  ]
}

function createHistoryBranch(kind, expected, branch, result, item) {
  const status = branch?.status || (result ? 'success' : expected ? 'error' : 'skipped')
  const text = [branch?.error, branch?.summary, item?.summary, ...(Array.isArray(item?.topIssueSummaries) ? item.topIssueSummaries : [])].join(' ')
  const failed = expected && (status === 'error' || (!result && status !== 'skipped') || (!result && hasFailureText(text)))
  return { kind, expected, result, status, failed, succeeded: expected && Boolean(result) && status !== 'error' }
}

function getHistoryTechIssueCounts(item = {}) {
  const result = item.tech?.compactResult || (item.type === 'tech' ? item.result : null)
  if (result && typeof result === 'object') {
    try {
      const counts = createTechQaViewModel(result).issueCounts || {}
      return {
        errorCount: getFirstPositiveNumber(counts.errorUniqueElementCount, counts.errorElementCount, counts.errorEvidenceCount),
        warningCount: getFirstPositiveNumber(counts.warningUniqueElementCount, counts.warningElementCount, counts.warningEvidenceCount),
      }
    } catch {
      return getLegacyTechCounts(item, result)
    }
  }
  return getLegacyTechCounts(item, result)
}

function getLegacyTechCounts(item = {}, result = {}) {
  const checks = Array.isArray(result?.checks) ? result.checks : []
  const errorChecks = checks.filter((check) => check?.status === 'error').length
  const warningChecks = checks.filter((check) => check?.status === 'warn').length
  return {
    errorCount: getFirstPositiveNumber(item.counts?.techError, item.counts?.high, errorChecks),
    warningCount: getFirstPositiveNumber(item.counts?.techWarn, warningChecks),
  }
}

function getHistoryVisualDifferenceCount(item = {}) {
  const result = item.visual?.compactResult || (item.type === 'visual' ? item.result : null)
  const comparison = result?.comparison || {}
  return getFirstPositiveNumber(
    comparison.differenceCount,
    Array.isArray(comparison.differences) ? comparison.differences.length : 0,
    item.aiReview?.review?.visualDifferences?.length,
    item.counts?.text,
    item.counts?.style,
    item.counts?.layout,
    item.counts?.cta,
  )
}

function hasFailedDeviceResult(item = {}) {
  const result = item.tech?.compactResult || (item.type === 'tech' ? item.result : null)
  return Array.isArray(result?.deviceResults) && result.deviceResults.some((entry) => entry?.status === 'error')
}

function hasFailureSignal(item = {}) {
  return hasFailureText([item.summary, item.visual?.error, item.tech?.error, ...(Array.isArray(item.topIssueSummaries) ? item.topIssueSummaries : [])].join(' '))
}

function hasFailureText(value) {
  return /failed to fetch|timeout|network|navigation failed|ERR_|검사할 수 없습니다|QA 모두 실패/i.test(String(value || ''))
}

function getFirstPositiveNumber(...values) {
  for (const value of values) {
    const number = Number(value)
    if (Number.isFinite(number) && number > 0) return number
  }
  return 0
}

function getNumber(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : 0
}

function getOptionalDurationMs(value) {
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? number : null
}

function getValidDate(value) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? new Date(0).toISOString() : date.toISOString()
}
