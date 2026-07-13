const MAX_ITEMS = 8

export function buildAiReviewPayloadFromSession(session = {}) {
  const qaResult = {
    visual: session.visual || {},
    tech: session.tech || {},
  }
  return buildAiReviewPayloadFromQaResult(qaResult)
}

export function buildAiReviewPayloadFromQaResult(qaResult = {}) {
  const visual = qaResult.visual?.result || {}
  const tech = qaResult.tech?.result || {}
  const textDifferences = createTextDifferences(visual)

  return {
    meta: {
      payloadVersion: '0.3-ai-review-input',
      webUrl: getSafeUrl(visual.meta?.webUrl || tech.targetUrl),
      figmaNodeId: getString(visual.meta?.figmaNodeId),
      openAiCalled: false,
    },
    releaseDecisionInput: {
      criticalCount: textDifferences.filter((item) => item.severity === 'critical').length + countTechChecks(tech, 'error'),
      warningCount: textDifferences.filter((item) => item.severity === 'warning').length + countTechChecks(tech, 'warn'),
      checkCount: textDifferences.filter((item) => item.severity === 'check').length,
      techErrorCount: countTechChecks(tech, 'error'),
      techWarningCount: countTechChecks(tech, 'warn'),
    },
    visualEvidence: {
      textDifferences,
      hero: createHeroEvidence(visual),
      cta: createCtaEvidence(visual),
      prices: createPriceEvidence(visual),
      media: createMediaEvidence(visual),
    },
    visualAssets: createVisualAssetReferences(visual),
    techEvidence: {
      access: findCheckSummary(tech, 'access'),
      httpStatus: findCheckSummary(tech, 'http-status'),
      consoleErrors: getCheckItems(tech, 'console-errors', 'error'),
      brokenLinks: getCheckItems(tech, 'bad-links', 'warning'),
      metaIssues: getCheckItems(tech, 'meta', 'warning'),
      altIssues: getCheckItems(tech, 'image-alt', 'warning'),
      externalLinkIssues: getCheckItems(tech, 'external-links', 'warning'),
      networkIssues: getCheckItems(tech, 'network-failures', 'warning'),
    },
    requestedOutputSchema: {
      releaseDecision: 'ready | caution | blocked',
      summary: '',
      mustFix: [],
      verify: [],
      developerNotes: [],
      visualDifferences: [],
      clientReplyDraft: '',
    },
  }
}

export function sanitizeAiReviewResponse(response = {}) {
  const review = response.review && typeof response.review === 'object' ? response.review : {}
  return {
    success: response.success === true,
    meta: {
      openAiCalled: response.meta?.openAiCalled === true,
      visionUsed: response.meta?.visionUsed === true,
      imageInputCount: numberValue(response.meta?.imageInputCount),
      figmaImagePrepared: response.meta?.figmaImagePrepared === true,
      webImagePrepared: response.meta?.webImagePrepared === true,
      fallbackUsed: response.meta?.fallbackUsed === true,
      model: getString(response.meta?.model),
      aiReviewDurationMs: numberValue(response.meta?.aiReviewDurationMs),
      visionFailureReason: getString(response.meta?.visionFailureReason),
    },
    review: {
      releaseDecision: normalizeDecision(review.releaseDecision),
      summary: getString(review.summary),
      mustFix: sanitizeIssueArray(review.mustFix),
      verify: sanitizeIssueArray(review.verify),
      developerNotes: sanitizeIssueArray(review.developerNotes),
      visualDifferences: sanitizeVisualDifferenceArray(review.visualDifferences),
      clientReplyDraft: getString(review.clientReplyDraft),
    },
    error: response.error && typeof response.error === 'object' ? { code: getString(response.error.code), message: getString(response.error.message) } : null,
  }
}

function createTextDifferences(visual = {}) {
  const differences = Array.isArray(visual.comparison?.differences) ? visual.comparison.differences : []
  return dedupe(differences.map((item) => ({
    kind: 'text-difference',
    severity: classifySeverity(item),
    category: classifyCategory(item),
    figmaText: getString(item.figmaText || item.text),
    webText: getString(item.webText),
    confidence: getString(item.confidence || item.matchConfidence),
  }))).slice(0, MAX_ITEMS)
}

function classifySeverity(item = {}) {
  if (isTrivialTextDifference(item.figmaText || item.text, item.webText)) return 'check'
  const text = `${item.figmaText || ''} ${item.webText || ''} ${item.text || ''}`
  if (/[0-9][0-9,._%원$€£年月日-]*/.test(text)) return 'critical'
  if (String(item.confidence || item.matchConfidence || '').toLowerCase() === 'low') return 'check'
  return 'warning'
}

function classifyCategory(item = {}) {
  const text = `${item.figmaText || ''} ${item.webText || ''} ${item.text || ''}`
  if (/[0-9][0-9,._%원$€£年月日-]*/.test(text)) return 'numeric'
  if (/cta|button|action/i.test(`${item.role || ''} ${item.sectionRole || ''}`)) return 'cta-text'
  return 'copy'
}

function createHeroEvidence(visual = {}) {
  const hero = visual.aiHints?.evidenceSummary?.hero || {}
  return {
    figmaTextCount: numberValue(hero.figmaTextCount),
    webTextCount: numberValue(hero.webTextCount),
    figmaCtaCount: numberValue(hero.figmaCtaCount ?? visual.aiHints?.heroCtaGroup?.figma?.count),
    webCtaCount: numberValue(hero.webCtaCount ?? visual.aiHints?.heroCtaGroup?.web?.count),
    webPrimaryMediaCount: numberValue(hero.webPrimaryMediaCount),
  }
}

function createCtaEvidence(visual = {}) {
  const group = visual.aiHints?.heroCtaGroup || {}
  return {
    figmaCount: numberValue(group.figma?.count),
    webCount: numberValue(group.web?.count),
    countDifference: numberValue(group.countDifference),
    figmaActions: limitActions(group.figma?.actions),
    webActions: limitActions(group.web?.actions),
  }
}

function createPriceEvidence(visual = {}) {
  return dedupe(arrayOfObjects(visual.aiHints?.prices).map((item) => ({
    source: getString(item.source),
    type: getString(item.numericType),
    text: getString(item.displayText || item.text),
    role: getString(item.role),
  }))).slice(0, MAX_ITEMS)
}

function createMediaEvidence(visual = {}) {
  const group = visual.aiHints?.heroMediaGroup || {}
  const content = visual.aiHints?.evidenceSummary?.content || {}
  return {
    comparisonHint: getString(group.comparisonHint),
    figmaMediaTypes: arrayOfStrings(group.figma?.mediaTypes),
    webMediaTypes: arrayOfStrings(group.web?.mediaTypes),
    figmaImageCount: numberValue(content.figmaImageCount),
    webImageCount: numberValue(content.webImageCount),
    webVideoCount: numberValue(content.webVideoCount),
  }
}

function createVisualAssetReferences(visual = {}) {
  return {
    figmaRenderId: getSafeAssetId(visual.figma?.renderId),
    webScreenshotFileName: getSafeScreenshotFileName(visual.web?.displayImageUrl || visual.web?.localImagePath || visual.web?.screenshotPath || visual.web?.screenshot?.path || visual.web?.image),
  }
}

function findCheckSummary(tech = {}, checkId) {
  const check = arrayOfObjects(tech.checks).find((item) => item.id === checkId)
  if (!check) return {}
  return { status: getString(check.status), value: getString(check.value), detail: getString(check.detail) }
}

function getCheckItems(tech = {}, checkId, severity) {
  const check = arrayOfObjects(tech.checks).find((item) => item.id === checkId)
  if (!check || !['error', 'warn', 'check'].includes(check.status)) return []
  return dedupe(arrayOfObjects(check.items).map((item) => ({
    severity,
    label: getString(item.label || item.alt || item.id || item.source || item.type),
    status: getString(item.status),
    statusCode: item.statusCode === null || item.statusCode === undefined ? undefined : numberValue(item.statusCode),
    type: getString(item.type || item.category),
    message: getString(item.message || item.note),
    url: getSafeUrl(item.url || item.src),
  }))).slice(0, MAX_ITEMS)
}

function countTechChecks(tech = {}, status) {
  return arrayOfObjects(tech.checks).filter((check) => check.status === status).length
}

function limitActions(items) {
  return dedupe(arrayOfObjects(items).map((item) => ({ text: getString(item.text || item.displayText), role: getString(item.role), href: getSafeUrl(item.href) }))).slice(0, 6)
}

function sanitizeIssueArray(value) {
  return Array.isArray(value) ? value.map(sanitizeIssue).filter(Boolean).slice(0, 10) : []
}

function sanitizeVisualDifferenceArray(value) {
  return Array.isArray(value) ? value.map(sanitizeVisualDifference).filter(Boolean).slice(0, 10) : []
}

function sanitizeVisualDifference(item, index) {
  if (!item || typeof item !== 'object') return null
  return {
    area: getString(item.area) || 'Page Content',
    category: getString(item.category) || 'Layout',
    title: getString(item.title),
    summary: getString(item.summary || item.description),
    figmaValue: getString(item.figmaValue || item.figma),
    webValue: getString(item.webValue || item.web),
    severity: getString(item.severity) || 'warning',
    confidence: getString(item.confidence) || 'medium',
    order: Number.isFinite(Number(item.order)) ? Number(item.order) : index,
  }
}

function sanitizeIssue(item) {
  if (typeof item === 'string') return { category: 'tech', title: item, description: item, evidence: [], severity: 'warning' }
  if (!item || typeof item !== 'object') return null
  return {
    category: getString(item.category) || 'tech',
    title: getString(item.title),
    description: getString(item.description),
    evidence: Array.isArray(item.evidence) ? item.evidence.map(getString).filter(Boolean).slice(0, 4) : [],
    severity: getString(item.severity) || 'warning',
  }
}

function normalizeDecision(value) {
  return ['ready', 'caution', 'blocked'].includes(value) ? value : 'caution'
}

function isTrivialTextDifference(first, second) {
  if (!first || !second) return false
  if (normalizeLooseText(first) === normalizeLooseText(second)) return true
  return normalizeKoreanParticles(first) === normalizeKoreanParticles(second)
}

function normalizeLooseText(value) {
  return getString(value).toLowerCase().replace(/(?:\s|\u00a0|\u200b|\u200c|\u200d|[.,:;!?"'“”‘’()[\]{}<>_/\\-])/g, '')
}

function normalizeKoreanParticles(value) {
  return normalizeLooseText(value).replace(/(은|는|이|가|을|를|의|에|에서|으로|로|와|과|도|만|까지|부터|입니다|합니다|하세요|해요)$/g, '')
}

function dedupe(items) {
  const seen = new Set()
  return items.filter((item) => {
    const key = JSON.stringify(item)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function arrayOfObjects(value) {
  return Array.isArray(value) ? value.filter((item) => item && typeof item === 'object') : []
}

function arrayOfStrings(value) {
  return Array.isArray(value) ? value.map(getString).filter(Boolean).slice(0, 8) : []
}

function numberValue(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : 0
}

function getSafeUrl(value) {
  const text = getString(value)
  if (!text || text.startsWith('data:') || text.includes('.cache/') || /^[a-zA-Z]:[\\/]/.test(text)) return ''
  return text.startsWith('/api/') || text.startsWith('/') || /^https?:\/\//i.test(text) ? text : ''
}

function getSafeAssetId(value) {
  const text = getString(value)
  return /^[0-9a-zA-Z._-]+$/.test(text) ? text : ''
}

function getSafeScreenshotFileName(value) {
  const normalized = getString(value).replace(/\\/g, '/')
  const fileName = normalized.split('/').filter(Boolean).at(-1) || ''
  return /^[a-f0-9]{24}\.png$/i.test(fileName) ? fileName : ''
}

function getString(value) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, 500) : ''
}
