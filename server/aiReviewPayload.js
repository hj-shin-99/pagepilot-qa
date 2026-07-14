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
  const fallbackStage = getFallbackStage({ preparedMeta, error, fallbackUsed })
  const fallbackReason = getFallbackReason({ preparedMeta, error, fallbackUsed, fallbackStage })
  const visionFailureReason = getVisionFailureReason({ preparedMeta, imageInputCount, openAiCalled, fallbackUsed, error, fallbackStage })

  return {
    ...(qaMeta || {}),
    ...preparedMeta,
    ...(resultMeta || {}),
    openAiCalled,
    visionUsed,
    imageInputCount,
    rawVisionCount: Number(resultMeta?.rawVisionCount ?? error?.rawVisionCount ?? 0),
    visionInputSummary: normalizeVisionInputSummary(preparedMeta.visionInputSummary || resultMeta?.visionInputSummary || error?.visionInputSummary),
    figmaImagePrepared: preparedMeta.figmaImagePrepared === true,
    webImagePrepared: preparedMeta.webImagePrepared === true,
    fallbackUsed: fallbackUsed === true,
    fallbackStage,
    fallbackReason,
    model: safeText(resultMeta?.model || error?.model),
    aiReviewDurationMs: Number(resultMeta?.aiReviewDurationMs ?? error?.aiReviewDurationMs ?? 0),
    openAiRequestDurationMs: Number(resultMeta?.openAiRequestDurationMs ?? error?.openAiRequestDurationMs ?? 0),
    openAiResponseReceived: resultMeta?.openAiResponseReceived === true || error?.openAiResponseReceived === true,
    openAiResponseParsed: resultMeta?.openAiResponseParsed === true || error?.openAiResponseParsed === true,
    visionFailureReason,
  }
}

function getVisionFailureReason({ preparedMeta = {}, imageInputCount, openAiCalled, fallbackUsed, error, fallbackStage }) {
  if (typeof preparedMeta.visionFailureReason === 'string' && preparedMeta.visionFailureReason) return preparedMeta.visionFailureReason
  const expectedImageCount = Array.isArray(preparedMeta.visionInputSummary) ? preparedMeta.visionInputSummary.length : 0
  if (preparedMeta.visionPrepared === true && imageInputCount !== expectedImageCount) return 'image-input-not-attached'
  if (fallbackUsed && ['schema-validation', 'post-process', 'json-parse', 'openai-response-empty'].includes(fallbackStage)) return fallbackStage
  if (fallbackUsed && openAiCalled && imageInputCount > 0) return 'openai-failed'
  if (fallbackUsed && error) return typeof error?.code === 'string' ? error.code : 'openai-failed'
  return ''
}

function getFallbackStage({ preparedMeta = {}, error, fallbackUsed }) {
  if (fallbackUsed !== true) return ''
  if (typeof error?.fallbackStage === 'string' && error.fallbackStage) return normalizeFallbackStage(error.fallbackStage)
  if (preparedMeta.visionFailureReason === 'image-prepare-failed') return 'image-prepare'
  return 'unknown'
}

function getFallbackReason({ preparedMeta = {}, error, fallbackUsed, fallbackStage }) {
  if (fallbackUsed !== true) return ''
  if (typeof error?.fallbackReason === 'string' && error.fallbackReason) return safeDiagnosticToken(error.fallbackReason)
  if (fallbackStage === 'image-prepare') return safeDiagnosticToken(preparedMeta.visionFailureReason || 'image-prepare-failed')
  if (typeof error?.code === 'string' && error.code) return safeDiagnosticToken(error.code)
  return 'unknown'
}

function normalizeFallbackStage(value) {
  const stage = safeText(value, 80)
  return ['image-prepare', 'openai-request', 'openai-timeout', 'openai-http-error', 'openai-response-empty', 'json-parse', 'schema-validation', 'post-process', 'unknown'].includes(stage) ? stage : 'unknown'
}

function safeDiagnosticToken(value) {
  return safeText(value, 140).toLowerCase().replace(/[^a-z0-9._:-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 120) || 'unknown'
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
  console.info(`[AI Review] called=${meta.openAiCalled === true} vision=${meta.visionUsed === true} images=${Number(meta.imageInputCount || 0)} fallback=${meta.fallbackUsed === true} stage=${meta.fallbackStage || ''} reason=${meta.fallbackReason || ''} durationMs=${Number(meta.aiReviewDurationMs || 0)}`)
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
  if (hasStrongPriceEvidence(text)) return 'critical'
  if (String(item.confidence || item.matchConfidence || '').toLowerCase() === 'low') return 'check'
  return 'warning'
}

function classifyVisualDifferenceCategory(item = {}) {
  const text = `${item.figmaText || ''} ${item.webText || ''} ${item.text || ''}`
  if (hasStrongPriceEvidence(text)) return 'numeric'
  if (/cta|button|action/i.test(`${item.role || ''} ${item.sectionRole || ''}`)) return 'cta-text'
  return 'copy'
}

function hasStrongPriceEvidence(value) {
  const text = safeText(value, 500)
  if (!/\d/.test(text)) return false
  if (/(₩|\$|€|£|¥)\s*\d|\d[\d.,]*\s*(원|만원|천원|억원|krw|usd|eur|jpy)/i.test(text)) return true
  if (/\d(?:[.,]\d+)?\s*(%|퍼센트)/i.test(text)) return true
  if (/(금리|이율|interest|rate|apr)\s*\d|\d(?:[.,]\d+)?\s*%/.test(text) && /(금리|이율|interest|rate|apr)/i.test(text)) return true
  if (/(월\s*납입|월납입|monthly|payment|per\s*month)/i.test(text) && /(₩|\$|€|£|¥|\d[\d.,]*\s*(원|만원|천원|억원|krw|usd|eur|jpy))/i.test(text)) return true
  if (/(계약기간|약정|리스|렌트|period|term)/i.test(text) && /\d+\s*(개월|년|months?|years?)/i.test(text)) return true
  return false
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
  const cta = createCtaEvidence(visual)
  const media = createMediaEvidence(visual)
  const textDescendants = createHeroTextDescendants(visual, heroSection)
  return {
    figmaSectionId: safeText(heroSection.figmaSectionId),
    webSectionId: safeText(heroSection.webSectionId),
    figmaTextCount: numberValue(hero.figmaTextCount),
    webTextCount: numberValue(hero.webTextCount),
    figmaCtaCount: cta.figmaCount,
    webCtaCount: cta.webCount,
    webPrimaryMediaCount: numberValue(hero.webPrimaryMediaCount),
    confidence: safeText(heroSection.confidence),
    sections: arrayOfObjects(heroSection.sections).map(compactHeroSection).filter(Boolean).slice(0, 4),
    descendants: [
      ...textDescendants.map((item) => compactHeroDescendantBox(item, 'text')).filter(Boolean),
      ...cta.figmaActions.map((item) => compactHeroDescendantBox(item, 'cta')).filter(Boolean),
      ...cta.webActions.map((item) => compactHeroDescendantBox(item, 'cta')).filter(Boolean),
      ...media.figmaPrimaryCandidates.map((item) => compactHeroDescendantBox(item, 'media')).filter(Boolean),
      ...media.webPrimaryCandidates.map((item) => compactHeroDescendantBox(item, 'media')).filter(Boolean),
    ].slice(0, 12),
  }
}

function createHeroTextDescendants(visual = {}, heroSection = {}) {
  const texts = arrayOfObjects(visual.aiHints?.canonicalEvidence?.texts)
  const figmaSectionId = safeText(heroSection.figmaSectionId)
  const webSectionId = safeText(heroSection.webSectionId)
  return texts
    .filter((item) => (item.source === 'figma' && item.sectionId === figmaSectionId) || (item.source === 'web' && item.sectionId === webSectionId))
    .filter((item) => ['heading', 'label', 'body'].includes(safeText(item.role)) || safeText(item.text))
    .slice(0, 8)
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
    x: nullableNumber(section.x),
    y: nullableNumber(section.y),
    width: nullableNumber(section.width),
    height: nullableNumber(section.height),
    confidence: safeText(section.confidence),
  }
}

function createCtaEvidence(visual = {}) {
  const group = visual.aiHints?.heroCtaGroup || {}
  const figmaActions = limitActions(group.figma?.actions)
  const webActions = limitActions(group.web?.actions)
  return {
    figmaCount: figmaActions.length,
    webCount: webActions.length,
    countDifference: Math.abs(figmaActions.length - webActions.length),
    figmaActions,
    webActions,
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
    figmaPrimaryCandidates: limitMediaCandidates(group.figma?.primaryCandidates),
    webPrimaryCandidates: limitMediaCandidates(group.web?.primaryCandidates),
  }
}

function limitMediaCandidates(items) {
  return arrayOfObjects(items).map((item) => {
    const pxBox = extractPixelBox(item)
    return {
      source: safeText(item.source),
      type: safeText(item.type || item.mediaType),
      role: safeText(item.role),
      xRatio: nullableNumber(item.xRatio),
      yRatio: nullableNumber(item.yRatio),
      widthRatio: nullableNumber(item.widthRatio),
      heightRatio: nullableNumber(item.heightRatio),
      ...(pxBox || {}),
    }
  }).filter((item) => ['figma', 'web'].includes(item.source)).slice(0, 4)
}

function compactHeroDescendantBox(item = {}, kind) {
  const source = safeText(item.source)
  if (!['figma', 'web'].includes(source)) return null
  const yRatio = nullableNumber(item.yRatio)
  const pxBox = extractPixelBox(item)
  if (yRatio === null && !pxBox) return null
  return {
    source,
    kind,
    xRatio: nullableNumber(item.xRatio),
    yRatio,
    widthRatio: nullableNumber(item.widthRatio),
    heightRatio: nullableNumber(item.heightRatio),
    ...(pxBox || {}),
  }
}

function extractPixelBox(item = {}) {
  const box = item.boundingBox || item.absoluteBoundingBox || item.bbox || item.rect || item.bounds || item.box || item
  const x = nullableNumber(box.x ?? box.left)
  const y = nullableNumber(box.y ?? box.top)
  const width = nullableNumber(box.width ?? (Number.isFinite(Number(box.right)) && x !== null ? Number(box.right) - x : null))
  const height = nullableNumber(box.height ?? (Number.isFinite(Number(box.bottom)) && y !== null ? Number(box.bottom) - y : null))
  if (x === null || y === null || width === null || height === null || width <= 0 || height <= 0) return null
  return { x, y, width, height }
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
  return dedupeByJson(arrayOfObjects(items)
    .map((item) => {
      const pxBox = extractPixelBox(item)
      return {
        source: safeText(item.source),
        text: safeText(item.text || item.displayText),
        role: safeText(item.role),
        href: safeUrl(item.href),
        sectionId: safeText(item.sectionId, 220),
        sectionPath: safeText(item.sectionPath || item.contextPath || item.parentSelector, 260),
        comparisonScope: safeText(item.comparisonScope),
        xRatio: nullableNumber(item.xRatio),
        yRatio: nullableNumber(item.yRatio),
        widthRatio: nullableNumber(item.widthRatio),
        heightRatio: nullableNumber(item.heightRatio),
        ...(pxBox || {}),
        isHeroAction: item.isHeroAction === true,
      }
    })
    .filter(isCanonicalHeroCtaAction))
    .slice(0, 6)
}

function isCanonicalHeroCtaAction(item = {}) {
  if (!item.text) return false
  if (!['primary-action', 'secondary-action'].includes(item.role)) return false
  if (!['primary', ''].includes(item.comparisonScope)) return false
  if (/reference|tab|media-control|carousel|utility|navigation/i.test(`${item.comparisonScope} ${item.role} ${item.sectionPath}`)) return false
  return true
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
