const MAX_VISUAL_ITEMS = 8
const MAX_TECH_ITEMS = 8

export function createAiReviewPayload({ visualResult, techResult } = {}) {
  const visual = visualResult && typeof visualResult === 'object' ? visualResult : {}
  const tech = techResult && typeof techResult === 'object' ? techResult : {}
  const visualIssues = createVisualIssues(visual)
  const techIssues = createTechIssueSummary(tech)

  return {
    meta: {
      payloadVersion: '0.3-ai-review-input',
      webUrl: safeUrl(visual.meta?.webUrl || tech.targetUrl),
      figmaNodeId: safeText(visual.meta?.figmaNodeId),
      openAiCalled: false,
    },
    releaseDecisionInput: {
      criticalCount: visualIssues.filter((issue) => issue.severity === 'critical').length + techIssues.errorCount,
      warningCount: visualIssues.filter((issue) => issue.severity === 'warning').length + techIssues.warningCount,
      checkCount: visualIssues.filter((issue) => issue.severity === 'check').length,
      techErrorCount: techIssues.errorCount,
      techWarningCount: techIssues.warningCount,
    },
    visualEvidence: {
      textDifferences: visualIssues.filter((issue) => issue.kind === 'text-difference').slice(0, MAX_VISUAL_ITEMS),
      hero: createHeroEvidence(visual),
      cta: createCtaEvidence(visual),
      prices: createPriceEvidence(visual),
      media: createMediaEvidence(visual),
    },
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
      clientReplyDraft: '',
    },
  }
}

export function buildAiReviewPayloadFromQaResult(qaResult = {}) {
  return createAiReviewPayload({
    visualResult: qaResult.visual?.result,
    techResult: qaResult.tech?.result,
  })
}

export function createAiReviewPayloadHandler(dependencies) {
  return async function aiReviewPayloadHandler(req, res) {
    const webUrl = typeof req.body?.webUrl === 'string' ? req.body.webUrl.trim() : ''
    const figmaUrl = typeof req.body?.figmaUrl === 'string' ? req.body.figmaUrl.trim() : ''

    if (!dependencies.isHttpUrl(webUrl)) {
      res.status(400).json({ message: 'http:// 또는 https://로 시작하는 Web URL만 사용할 수 있습니다.' })
      return
    }

    const qaResult = await dependencies.buildQaRunResponse({ webUrl, figmaUrl }, dependencies.qaRunDependencies)
    res.json({
      success: true,
      openAiCalled: false,
      payload: buildAiReviewPayloadFromQaResult(qaResult),
    })
  }
}

function createVisualIssues(visual = {}) {
  const differences = Array.isArray(visual.comparison?.differences) ? visual.comparison.differences : []
  const issues = differences.slice(0, MAX_VISUAL_ITEMS).map((difference) => ({
    kind: 'text-difference',
    severity: classifyVisualDifferenceSeverity(difference),
    category: classifyVisualDifferenceCategory(difference),
    figmaText: safeText(difference.figmaText || difference.text),
    webText: safeText(difference.webText),
    confidence: safeText(difference.confidence || difference.matchConfidence),
  }))

  const ctaGroup = visual.aiHints?.heroCtaGroup || {}
  if (Number(ctaGroup.countDifference || 0) > 0) {
    issues.push({
      kind: 'cta-count',
      severity: 'warning',
      category: 'cta',
      figmaCount: Number(ctaGroup.figma?.count || 0),
      webCount: Number(ctaGroup.web?.count || 0),
    })
  }

  const mediaHint = safeText(visual.aiHints?.heroMediaGroup?.comparisonHint)
  if (mediaHint) {
    issues.push({ kind: 'media-composition', severity: mediaHint.includes('mixed') ? 'check' : 'warning', category: 'media', hint: mediaHint })
  }

  return dedupeByJson(issues).slice(0, MAX_VISUAL_ITEMS)
}

function classifyVisualDifferenceSeverity(item = {}) {
  const text = `${item.figmaText || ''} ${item.webText || ''} ${item.text || ''}`
  if (/[0-9][0-9,._%원$€£年月日-]*/.test(text)) return 'critical'
  if (/hero|heading|title|headline/i.test(`${item.role || ''} ${item.sectionRole || ''}`)) return 'critical'
  if (String(item.confidence || item.matchConfidence || '').toLowerCase() === 'low') return 'check'
  return 'warning'
}

function classifyVisualDifferenceCategory(item = {}) {
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
  return dedupeByJson(arrayOfObjects(visual.aiHints?.prices).map((item) => ({
    source: safeText(item.source),
    type: safeText(item.numericType),
    text: safeText(item.displayText || item.text),
    role: safeText(item.role),
  }))).slice(0, MAX_VISUAL_ITEMS)
}

function createMediaEvidence(visual = {}) {
  const group = visual.aiHints?.heroMediaGroup || {}
  const content = visual.aiHints?.evidenceSummary?.content || {}
  return {
    comparisonHint: safeText(group.comparisonHint),
    figmaMediaTypes: arrayOfStrings(group.figma?.mediaTypes),
    webMediaTypes: arrayOfStrings(group.web?.mediaTypes),
    figmaImageCount: numberValue(content.figmaImageCount),
    webImageCount: numberValue(content.webImageCount),
    webVideoCount: numberValue(content.webVideoCount),
  }
}

function createTechIssueSummary(tech = {}) {
  const checks = Array.isArray(tech.checks) ? tech.checks : []
  return {
    errorCount: checks.filter((check) => check.status === 'error').length,
    warningCount: checks.filter((check) => check.status === 'warn').length,
  }
}

function findCheckSummary(tech = {}, checkId) {
  const check = arrayOfObjects(tech.checks).find((item) => item.id === checkId)
  if (!check) return {}
  return {
    status: safeText(check.status),
    value: safeText(check.value),
    detail: safeText(check.detail),
  }
}

function getCheckItems(tech = {}, checkId, severity) {
  const check = arrayOfObjects(tech.checks).find((item) => item.id === checkId)
  if (!check || !['error', 'warn', 'check'].includes(check.status)) return []
  return dedupeByJson(arrayOfObjects(check.items).map((item) => ({
    severity,
    label: safeText(item.label || item.alt || item.id || item.source || item.type),
    status: safeText(item.status),
    statusCode: item.statusCode === null || item.statusCode === undefined ? undefined : numberValue(item.statusCode),
    type: safeText(item.type || item.category),
    message: safeText(item.message || item.note),
    url: safeUrl(item.url || item.src),
  }))).slice(0, MAX_TECH_ITEMS)
}

function limitActions(items) {
  return dedupeByJson(arrayOfObjects(items).map((item) => ({
    text: safeText(item.text || item.displayText),
    role: safeText(item.role),
    href: safeUrl(item.href),
  }))).slice(0, 6)
}

function dedupeByJson(items) {
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
  return Array.isArray(value) ? value.map(safeText).filter(Boolean).slice(0, 8) : []
}

function numberValue(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : 0
}

function safeText(value, maxLength = 180) {
  const text = typeof value === 'string' ? redactSensitiveText(value).replace(/\s+/g, ' ').trim() : ''
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text
}

function redactSensitiveText(value) {
  return String(value || '')
    .replace(/sk-[a-zA-Z0-9_-]{8,}/g, '[redacted-key]')
    .replace(/(api[_-]?key|access[_-]?token|figma[_-]?token|openai[_-]?token|secret[_-]?token)\s*[:=]?\s*[^\s,;]+/gi, '$1 [redacted]')
    .replace(/secret-token/gi, '[redacted-token]')
}

function safeUrl(value) {
  const text = safeText(value, 240)
  if (!text) return ''
  if (text.startsWith('data:')) return ''
  if (/^[a-zA-Z]:[\\/]/.test(text) || text.startsWith('\\\\') || text.includes('.cache/')) return ''
  if (text.startsWith('/api/') || /^https?:\/\//i.test(text) || text.startsWith('/')) return text
  return ''
}
