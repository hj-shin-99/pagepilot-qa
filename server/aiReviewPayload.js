import { createFallbackAiReview } from './aiReviewService.js'

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

export function createAiReviewHandler(dependencies) {
  return async function aiReviewHandler(req, res) {
    const webUrl = typeof req.body?.webUrl === 'string' ? req.body.webUrl.trim() : ''
    const figmaUrl = typeof req.body?.figmaUrl === 'string' ? req.body.figmaUrl.trim() : ''

    if (!dependencies.isHttpUrl(webUrl)) {
      res.status(400).json({ success: false, message: 'http:// 또는 https://로 시작하는 Web URL만 사용할 수 있습니다.' })
      return
    }

    let qaResult
    let payload
    try {
      qaResult = await dependencies.buildQaRunResponse({ webUrl, figmaUrl }, dependencies.qaRunDependencies)
      payload = buildAiReviewPayloadFromQaResult(qaResult)
    } catch (error) {
      res.status(200).json({
        success: false,
        meta: { openAiCalled: false },
        error: {
          code: 'qa_run_failed',
          message: error instanceof Error ? error.message : 'QA 결과 생성 중 오류가 발생했습니다.',
        },
      })
      return
    }

    let prepared = { payload, meta: {} }
    try {
      prepared = await prepareAiReviewPayloadForVision(payload, dependencies)
      const result = await dependencies.aiReviewService.review(prepared.payload)
      const meta = createAiReviewResponseMeta({ qaMeta: qaResult?.meta, preparedMeta: prepared.meta, resultMeta: result.meta, fallbackUsed: false })
      logAiReviewMeta(meta)
      res.json({
        success: true,
        meta,
        review: result.review,
      })
    } catch (error) {
      const meta = createAiReviewResponseMeta({ qaMeta: qaResult?.meta, preparedMeta: prepared.meta, error, fallbackUsed: true })
      logAiReviewMeta(meta)
      res.status(200).json({
        success: true,
        meta,
        review: createFallbackAiReview(payload, error instanceof Error ? error.message : ''),
        error: {
          code: typeof error?.code === 'string' ? error.code : 'openai_review_failed',
          message: error instanceof Error ? error.message : 'AI Review 호출에 실패했습니다.',
        },
      })
    }
  }
}

export function createAiReviewFromPayloadHandler(dependencies) {
  return async function aiReviewFromPayloadHandler(req, res) {
    const payload = req.body?.payload && typeof req.body.payload === 'object' ? req.body.payload : null
    if (!payload) {
      res.status(400).json({ success: false, message: 'AI Review payload가 필요합니다.' })
      return
    }

    let prepared = { payload, meta: {} }
    try {
      prepared = await prepareAiReviewPayloadForVision(payload, dependencies)
      const result = await dependencies.aiReviewService.review(prepared.payload)
      const meta = createAiReviewResponseMeta({ preparedMeta: prepared.meta, resultMeta: result.meta, fallbackUsed: false })
      logAiReviewMeta(meta)
      res.json({
        success: true,
        meta,
        review: result.review,
      })
    } catch (error) {
      const meta = createAiReviewResponseMeta({ preparedMeta: prepared.meta, error, fallbackUsed: true })
      logAiReviewMeta(meta)
      res.status(200).json({
        success: true,
        meta,
        review: createFallbackAiReview(payload, error instanceof Error ? error.message : ''),
        error: {
          code: typeof error?.code === 'string' ? error.code : 'openai_review_failed',
          message: error instanceof Error ? error.message : 'AI Review 호출에 실패했습니다.',
        },
      })
    }
  }
}

async function prepareAiReviewPayloadForVision(payload, dependencies = {}) {
  if (!dependencies.visualVisionService) return { payload, meta: { visionPrepared: false, figmaImagePrepared: false, webImagePrepared: false, visionFailureReason: 'image-input-not-attached' } }
  try {
    return await dependencies.visualVisionService.attachVisionInput(payload)
  } catch (error) {
    return { payload, meta: { visionPrepared: false, figmaImagePrepared: false, webImagePrepared: false, visionFailureReason: 'image-prepare-failed', visionError: error instanceof Error ? error.message : 'vision_prepare_failed' } }
  }
}

function createAiReviewResponseMeta({ qaMeta, preparedMeta = {}, resultMeta, error, fallbackUsed }) {
  const imageInputCount = Number(resultMeta?.imageInputCount ?? error?.imageInputCount ?? 0)
  const openAiCalled = resultMeta?.openAiCalled === true || error?.openAiCalled === true
  const visionUsed = resultMeta?.visionUsed === true || error?.visionUsed === true
  const visionFailureReason = getVisionFailureReason({ preparedMeta, imageInputCount, openAiCalled, fallbackUsed, error })

  return {
    ...(qaMeta || {}),
    ...preparedMeta,
    ...(resultMeta || {}),
    openAiCalled,
    visionUsed,
    imageInputCount,
    visionInputSummary: normalizeVisionInputSummary(preparedMeta.visionInputSummary || resultMeta?.visionInputSummary || error?.visionInputSummary),
    figmaImagePrepared: preparedMeta.figmaImagePrepared === true,
    webImagePrepared: preparedMeta.webImagePrepared === true,
    fallbackUsed: fallbackUsed === true,
    model: safeText(resultMeta?.model || error?.model),
    aiReviewDurationMs: Number(resultMeta?.aiReviewDurationMs ?? error?.aiReviewDurationMs ?? 0),
    visionFailureReason,
  }
}

function getVisionFailureReason({ preparedMeta = {}, imageInputCount, openAiCalled, fallbackUsed, error }) {
  if (typeof preparedMeta.visionFailureReason === 'string' && preparedMeta.visionFailureReason) return preparedMeta.visionFailureReason
  const expectedImageCount = Array.isArray(preparedMeta.visionInputSummary) ? preparedMeta.visionInputSummary.length : 0
  if (preparedMeta.visionPrepared === true && imageInputCount !== expectedImageCount) return 'image-input-not-attached'
  if (fallbackUsed && openAiCalled && imageInputCount > 0) return 'openai-failed'
  if (fallbackUsed && error) return typeof error?.code === 'string' ? error.code : 'openai-failed'
  return ''
}

function normalizeVisionInputSummary(value) {
  if (!Array.isArray(value)) return []
  return value.map((item) => ({
    label: safeText(item?.label, 80),
    width: numberValue(item?.width),
    height: numberValue(item?.height),
    detail: ['low', 'high', 'auto'].includes(item?.detail) ? item.detail : 'auto',
  })).filter((item) => item.label).slice(0, 4)
}

function logAiReviewMeta(meta = {}) {
  console.info(`[AI Review] called=${meta.openAiCalled === true} vision=${meta.visionUsed === true} images=${Number(meta.imageInputCount || 0)} fallback=${meta.fallbackUsed === true} durationMs=${Number(meta.aiReviewDurationMs || 0)}`)
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

function createVisualAssetReferences(visual = {}) {
  return {
    figmaRenderId: safeAssetId(visual.figma?.renderId),
    webScreenshotFileName: getSafeScreenshotFileName(visual.web?.displayImageUrl || visual.web?.localImagePath || visual.web?.screenshotPath || visual.web?.screenshot?.path || visual.web?.image),
  }
}

function safeAssetId(value) {
  const text = safeText(value, 160)
  return /^[0-9a-zA-Z._-]+$/.test(text) ? text : ''
}

function getSafeScreenshotFileName(value) {
  const normalized = safeText(value, 240).replace(/\\/g, '/')
  const fileName = normalized.split('/').filter(Boolean).at(-1) || ''
  return /^[a-f0-9]{24}\.png$/i.test(fileName) ? fileName : ''
}

function classifyVisualDifferenceSeverity(item = {}) {
  const text = `${item.figmaText || ''} ${item.webText || ''} ${item.text || ''}`
  if (isTrivialTextDifference(item.figmaText || item.text, item.webText)) return 'check'
  if (/[0-9][0-9,._%원$€£年月日-]*/.test(text)) return 'critical'
  if (String(item.confidence || item.matchConfidence || '').toLowerCase() === 'low') return 'check'
  return 'warning'
}

function classifyVisualDifferenceCategory(item = {}) {
  const text = `${item.figmaText || ''} ${item.webText || ''} ${item.text || ''}`
  if (/[0-9][0-9,._%원$€£年月日-]*/.test(text)) return 'numeric'
  if (/cta|button|action/i.test(`${item.role || ''} ${item.sectionRole || ''}`)) return 'cta-text'
  return 'copy'
}

function isTrivialTextDifference(first, second) {
  const firstText = safeText(first, 400)
  const secondText = safeText(second, 400)
  if (!firstText || !secondText) return false
  if (normalizeLooseText(firstText) === normalizeLooseText(secondText)) return true

  const firstNoJosa = normalizeKoreanParticles(firstText)
  const secondNoJosa = normalizeKoreanParticles(secondText)
  return firstNoJosa === secondNoJosa
}

function normalizeLooseText(value) {
  return safeText(value, 400).toLowerCase().replace(/(?:\s|\u00a0|\u200b|\u200c|\u200d|[.,:;!?"'“”‘’()[\]{}<>_/\\-])/g, '')
}

function normalizeKoreanParticles(value) {
  return normalizeLooseText(value).replace(/(은|는|이|가|을|를|의|에|에서|으로|로|와|과|도|만|까지|부터|입니다|합니다|하세요|해요)$/g, '')
}

function createHeroEvidence(visual = {}) {
  const hero = visual.aiHints?.evidenceSummary?.hero || {}
  const heroSection = visual.aiHints?.heroSection || {}
  return {
    figmaSectionId: safeText(heroSection.figmaSectionId),
    webSectionId: safeText(heroSection.webSectionId),
    figmaTextCount: numberValue(hero.figmaTextCount),
    webTextCount: numberValue(hero.webTextCount),
    figmaCtaCount: numberValue(hero.figmaCtaCount ?? visual.aiHints?.heroCtaGroup?.figma?.count),
    webCtaCount: numberValue(hero.webCtaCount ?? visual.aiHints?.heroCtaGroup?.web?.count),
    webPrimaryMediaCount: numberValue(hero.webPrimaryMediaCount),
    confidence: safeText(heroSection.confidence),
    sections: arrayOfObjects(heroSection.sections).map(compactHeroSection).filter(Boolean).slice(0, 4),
  }
}

function compactHeroSection(section = {}) {
  const source = safeText(section.source)
  if (!['figma', 'web'].includes(source)) return null
  return {
    sectionId: safeText(section.sectionId, 220),
    source,
    role: safeText(section.role),
    xRatio: nullableNumber(section.xRatio),
    yRatio: nullableNumber(section.yRatio),
    widthRatio: nullableNumber(section.widthRatio),
    heightRatio: nullableNumber(section.heightRatio),
    confidence: safeText(section.confidence),
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
    sectionId: safeText(item.sectionId, 220),
    sectionRootId: safeText(item.sectionRootId, 220),
    sectionPath: safeText(item.sectionPath || item.contextPath || item.context, 260),
    comparisonScope: safeText(item.comparisonScope),
    xRatio: nullableNumber(item.xRatio),
    yRatio: nullableNumber(item.yRatio),
    numericTokens: arrayOfStrings(item.numericTokens).slice(0, 6),
    unitTokens: arrayOfStrings(item.unitTokens).slice(0, 4),
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
    sectionId: safeText(item.sectionId, 220),
    sectionPath: safeText(item.sectionPath || item.contextPath || item.parentSelector, 260),
    comparisonScope: safeText(item.comparisonScope),
    xRatio: nullableNumber(item.xRatio),
    yRatio: nullableNumber(item.yRatio),
    isHeroAction: item.isHeroAction === true,
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

function nullableNumber(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : null
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
