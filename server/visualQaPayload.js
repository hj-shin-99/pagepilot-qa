const MAX_DIFFERENCES = 20
const MAX_CTA_CANDIDATES = 20
const MAX_IMAGE_CANDIDATES = 20
const MAX_VIDEO_CANDIDATES = 10
const MAX_SECTION_CANDIDATES = 20
const MAX_PRICE_CANDIDATES = 20
const MAX_UNMATCHED_PREVIEW = 10
const MAX_HERO_TEXTS = 6
const MAX_NAV_TEXTS = 8

export function createVisualQaPayload({ figmaAnalysis, webAnalysis, textComparison }) {
  const safeFigmaAnalysis = figmaAnalysis && typeof figmaAnalysis === 'object' ? figmaAnalysis : {}
  const safeWebAnalysis = webAnalysis && typeof webAnalysis === 'object' ? webAnalysis : {}
  const safeTextComparison = textComparison && typeof textComparison === 'object' ? textComparison : {}
  const comparisonSummaries = createComparisonSummaries(safeTextComparison)
  const heroSection = createHeroSectionHint(safeFigmaAnalysis, safeWebAnalysis, comparisonSummaries)
  const navigation = createNavigationHint(safeFigmaAnalysis, safeWebAnalysis, comparisonSummaries)
  const ctaButtons = limitItems(Array.isArray(safeWebAnalysis.ctaCandidates) ? safeWebAnalysis.ctaCandidates : [], MAX_CTA_CANDIDATES)
  const images = createMergedImageHints(safeFigmaAnalysis, safeWebAnalysis)
  const videos = createMergedVideoHints(safeFigmaAnalysis, safeWebAnalysis)
  const prices = createPriceHints(safeFigmaAnalysis, safeWebAnalysis)

  return {
    figma: {
      image: normalizeString(safeFigmaAnalysis.render?.imageUrl || safeFigmaAnalysis.render?.localImagePath),
      imageUrl: normalizeString(safeFigmaAnalysis.render?.imageUrl),
      localImagePath: normalizeString(safeFigmaAnalysis.render?.localImagePath),
      renderId: normalizeString(safeFigmaAnalysis.render?.renderId),
      structureSummary: safeFigmaAnalysis.structureSummary || {},
      textCount: Array.isArray(safeFigmaAnalysis.textNodes) ? safeFigmaAnalysis.textNodes.length : 0,
    },
    web: {
      image: normalizeString(safeWebAnalysis.screenshot?.path),
      screenshot: {
        path: normalizeString(safeWebAnalysis.screenshot?.path),
        width: normalizeCount(safeWebAnalysis.screenshot?.width, 0),
        height: normalizeCount(safeWebAnalysis.screenshot?.height, 0),
        mimeType: normalizeString(safeWebAnalysis.screenshot?.mimeType) || 'image/png',
      },
      page: safeWebAnalysis.page || {},
      textCount: Array.isArray(safeWebAnalysis.textNodes) ? safeWebAnalysis.textNodes.length : 0,
    },
    comparison: {
      matchedCount: normalizeCount(safeTextComparison.summary?.matchedCount, 0),
      differenceCount: normalizeCount(safeTextComparison.summary?.differenceCount, 0),
      figmaOnlyCount: normalizeCount(safeTextComparison.summary?.figmaOnlyCount, 0),
      webOnlyCount: normalizeCount(safeTextComparison.summary?.webOnlyCount, 0),
      differences: comparisonSummaries,
    },
    aiHints: {
      heroSection,
      navigation,
      ctaButtons,
      prices,
      videos,
      images,
    },
  }
}

export function createDebugPreview(textComparison) {
  const safeTextComparison = textComparison && typeof textComparison === 'object' ? textComparison : {}
  return {
    figmaOnlyPreview: limitItems(Array.isArray(safeTextComparison.figmaOnlyPreview) ? safeTextComparison.figmaOnlyPreview : [], MAX_UNMATCHED_PREVIEW),
    webOnlyPreview: limitItems(Array.isArray(safeTextComparison.webOnlyPreview) ? safeTextComparison.webOnlyPreview : [], MAX_UNMATCHED_PREVIEW),
  }
}

function createComparisonSummaries(textComparison) {
  return limitItems(Array.isArray(textComparison.differences) ? textComparison.differences : [], MAX_DIFFERENCES).map((difference) => ({
    text: truncateText(difference?.figmaText || difference?.webText || difference?.text || '', 120),
    figmaText: truncateText(difference?.figmaText || '', 140),
    webText: truncateText(difference?.webText || '', 140),
    confidence: normalizeConfidence(difference?.matchConfidence),
    status: classifyDifferenceStatus(difference),
    reasons: limitItems(Array.isArray(difference?.evidence) ? difference.evidence : [], 4).map((item) => truncateText(item, 120)),
  }))
}

function createHeroSectionHint(figmaAnalysis, webAnalysis, comparisonSummaries) {
  const figmaTexts = normalizeFigmaTextCandidates(figmaAnalysis.textNodes)
    .filter((item) => isHeroTextCandidate(item))
    .slice(0, MAX_HERO_TEXTS)
  const webTexts = normalizeWebTextCandidates(webAnalysis.textNodes)
    .filter((item) => isHeroTextCandidate(item))
    .slice(0, MAX_HERO_TEXTS)
  const media = [
    ...createMergedImageHints(figmaAnalysis, webAnalysis).filter((item) => item.section === 'hero' || item.section === 'top'),
    ...createMergedVideoHints(figmaAnalysis, webAnalysis).filter((item) => item.section === 'hero' || item.section === 'top'),
  ].slice(0, 6)
  const sectionCandidates = limitItems(
    (Array.isArray(webAnalysis.sectionCandidates) ? webAnalysis.sectionCandidates : [])
      .filter((item) => item?.name === 'hero' || item?.name === 'top'),
    MAX_SECTION_CANDIDATES,
  )
  const reasons = []
  if (figmaTexts.some((item) => item.section === 'hero' || item.section === 'top')) reasons.push('figma top text cluster')
  if (webTexts.some((item) => item.section === 'hero' || item.section === 'top')) reasons.push('web top text cluster')
  if (media.length > 0) reasons.push('top media candidates')
  if (sectionCandidates.length > 0) reasons.push('section candidates support hero area')
  if (comparisonSummaries.some((item) => item.status === 'different')) reasons.push('text comparison differences in prominent area')

  return {
    type: 'hero',
    source: determineCombinedSource(figmaTexts.length, webTexts.length),
    confidence: classifyConfidence(reasons.length >= 3 ? 'high' : reasons.length >= 2 ? 'medium' : 'low'),
    reasons,
    figmaTexts,
    webTexts,
    media,
    sectionCandidates,
  }
}

function createNavigationHint(figmaAnalysis, webAnalysis, comparisonSummaries) {
  const figmaTexts = normalizeFigmaTextCandidates(figmaAnalysis.textNodes)
    .filter((item) => isNavigationCandidate(item))
    .slice(0, MAX_NAV_TEXTS)
  const webTexts = normalizeWebTextCandidates(webAnalysis.textNodes)
    .filter((item) => isNavigationCandidate(item))
    .slice(0, MAX_NAV_TEXTS)
  const sectionCandidates = limitItems(
    (Array.isArray(webAnalysis.sectionCandidates) ? webAnalysis.sectionCandidates : [])
      .filter((item) => item?.name === 'navigation'),
    MAX_SECTION_CANDIDATES,
  )
  const reasons = []
  if (figmaTexts.length > 0) reasons.push('figma navigation-like texts')
  if (webTexts.length > 0) reasons.push('web navigation-like texts')
  if (sectionCandidates.length > 0) reasons.push('section candidates support navigation area')
  if (comparisonSummaries.some((item) => item.status === 'different' && looksNavigationText(item.text))) reasons.push('navigation text differences detected')

  return {
    type: 'navigation',
    source: determineCombinedSource(figmaTexts.length, webTexts.length),
    confidence: classifyConfidence(reasons.length >= 3 ? 'high' : reasons.length >= 2 ? 'medium' : 'low'),
    reasons,
    figmaTexts,
    webTexts,
    sectionCandidates,
  }
}

function createMergedImageHints(figmaAnalysis, webAnalysis) {
  const figmaImages = (Array.isArray(figmaAnalysis.flatNodes) ? figmaAnalysis.flatNodes : [])
    .filter((node) => node?.effectivelyVisible && node?.hasImageFill)
    .map((node) => ({
      type: 'image',
      source: 'figma',
      text: truncateText(node?.name || '', 120),
      confidence: classifyConfidence(node?.yRatio <= 0.35 ? 'high' : 'medium'),
      reasons: buildFigmaImageReasons(node),
      section: inferFigmaSection(node),
      layerPath: truncateText(node?.layerPath || '', 180),
    }))
  const webImages = limitItems(Array.isArray(webAnalysis.imageCandidates) ? webAnalysis.imageCandidates : [], MAX_IMAGE_CANDIDATES)

  return limitItems([...figmaImages, ...webImages], MAX_IMAGE_CANDIDATES)
}

function createMergedVideoHints(figmaAnalysis, webAnalysis) {
  const figmaVideos = (Array.isArray(figmaAnalysis.flatNodes) ? figmaAnalysis.flatNodes : [])
    .filter((node) => node?.effectivelyVisible && node?.hasVideoLikeContent)
    .map((node) => ({
      type: 'video',
      source: 'figma',
      text: truncateText(node?.name || '', 120),
      confidence: classifyConfidence(node?.yRatio <= 0.35 ? 'high' : 'medium'),
      reasons: buildFigmaVideoReasons(node),
      section: inferFigmaSection(node),
      layerPath: truncateText(node?.layerPath || '', 180),
    }))
  const webVideos = limitItems(Array.isArray(webAnalysis.videoCandidates) ? webAnalysis.videoCandidates : [], MAX_VIDEO_CANDIDATES)

  return limitItems([...figmaVideos, ...webVideos], MAX_VIDEO_CANDIDATES)
}

function createPriceHints(figmaAnalysis, webAnalysis) {
  const figmaPrices = normalizeFigmaTextCandidates(figmaAnalysis.textNodes).filter((item) => item.type === 'price')
  const webPrices = normalizeWebTextCandidates(webAnalysis.textNodes).filter((item) => item.type === 'price')
  return limitItems([...figmaPrices, ...webPrices], MAX_PRICE_CANDIDATES)
}

function normalizeFigmaTextCandidates(textNodes) {
  return (Array.isArray(textNodes) ? textNodes : [])
    .map((node) => {
      const reasons = []
      if (Number(node?.fontSize) >= 24) reasons.push('large font size')
      if (Number(node?.fontWeight) >= 700) reasons.push('bold font weight')
      if (Number(node?.yRatio) <= 0.35) reasons.push('top section')
      if (String(node?.layerPath || '').toLowerCase().match(/nav|menu|header|hero|kv|banner|button|cta/)) reasons.push('semantic layer path')

      return {
        type: looksLikePriceText(node?.characters) ? 'price' : 'text',
        source: 'figma',
        text: truncateText(node?.characters || '', 140),
        confidence: classifyConfidence(reasons.length >= 3 ? 'high' : reasons.length >= 2 ? 'medium' : 'low'),
        reasons,
        section: inferFigmaSection(node),
        layerPath: truncateText(node?.layerPath || '', 180),
        fontSize: normalizeNumber(node?.fontSize),
        fontWeight: normalizeNumber(node?.fontWeight),
        yRatio: normalizeNumber(node?.yRatio),
      }
    })
    .filter((item) => item.text)
}

function normalizeWebTextCandidates(textNodes) {
  return (Array.isArray(textNodes) ? textNodes : [])
    .map((node) => {
      const reasons = []
      if (String(node?.tagName || '').match(/^h[1-6]$/i)) reasons.push('heading element')
      if (String(node?.role || '').toLowerCase() === 'cta') reasons.push('cta role')
      if (String(node?.role || '').toLowerCase() === 'navigation') reasons.push('navigation role')
      if (Number(node?.yRatio) <= 0.35) reasons.push('top section')
      if (String(node?.selector || node?.domPath || '').toLowerCase().match(/nav|menu|header|hero|banner|button|cta/)) reasons.push('semantic selector')

      return {
        type: looksLikePriceText(node?.rawText || node?.text) ? 'price' : 'text',
        source: 'web',
        text: truncateText(node?.rawText || node?.text || '', 140),
        confidence: classifyConfidence(reasons.length >= 3 ? 'high' : reasons.length >= 2 ? 'medium' : 'low'),
        reasons,
        section: inferWebSection(node),
        selector: truncateText(node?.selector || '', 180),
        yRatio: normalizeNumber(node?.yRatio),
        role: normalizeString(node?.role),
      }
    })
    .filter((item) => item.text)
}

function inferFigmaSection(node) {
  const searchable = `${node?.layerPath || ''} ${node?.parentFrameName || ''}`.toLowerCase()
  if (/nav|navigation|gnb|menu|header/.test(searchable)) return 'navigation'
  if (/hero|kv|banner|main[_\s-]?visual/.test(searchable)) return 'hero'
  if (/footer|legal|terms|privacy|cookie|disclaimer|약관|개인정보/.test(searchable)) return 'footer'
  const yRatio = Number(node?.yRatio)
  if (Number.isFinite(yRatio) && yRatio <= 0.35) return 'top'
  if (Number.isFinite(yRatio) && yRatio <= 0.7) return 'middle'
  if (Number.isFinite(yRatio)) return 'bottom'
  return 'unknown'
}

function inferWebSection(node) {
  const explicit = normalizeString(node?.sectionHint)
  if (explicit) return explicit
  const searchable = `${node?.selector || ''} ${node?.domPath || ''}`.toLowerCase()
  if (/nav|navigation|gnb|menu|header/.test(searchable)) return 'navigation'
  if (/hero|kv|banner/.test(searchable)) return 'hero'
  if (/footer|legal|terms|privacy|cookie|disclaimer/.test(searchable)) return 'footer'
  const yRatio = Number(node?.yRatio)
  if (Number.isFinite(yRatio) && yRatio <= 0.35) return 'top'
  if (Number.isFinite(yRatio) && yRatio <= 0.7) return 'middle'
  if (Number.isFinite(yRatio)) return 'bottom'
  return 'unknown'
}

function buildFigmaImageReasons(node) {
  const reasons = ['image fill']
  if (normalizeString(node?.layerPath).toLowerCase().match(/hero|kv|banner|visual/)) reasons.push('semantic layer path')
  if (Number(node?.yRatio) <= 0.35) reasons.push('top section')
  if (node?.isInteractiveCandidate) reasons.push('interactive candidate')
  return reasons
}

function buildFigmaVideoReasons(node) {
  const reasons = ['video-like content']
  if (normalizeString(node?.layerPath).toLowerCase().match(/hero|kv|banner|visual/)) reasons.push('semantic layer path')
  if (Number(node?.yRatio) <= 0.35) reasons.push('top section')
  if (node?.isInteractiveCandidate) reasons.push('interactive candidate')
  return reasons
}

function isHeroTextCandidate(item) {
  if (!item || !item.text) return false
  return item.section === 'hero'
    || item.section === 'top'
    || item.reasons.includes('large font size')
    || item.reasons.includes('heading element')
}

function isNavigationCandidate(item) {
  if (!item || !item.text) return false
  return item.section === 'navigation'
    || item.reasons.includes('navigation role')
    || item.reasons.includes('semantic selector')
    || item.reasons.includes('semantic layer path')
}

function looksNavigationText(value) {
  return /menu|header|search|navigation|nav|gnb/i.test(String(value || ''))
}

function determineCombinedSource(figmaCount, webCount) {
  if (figmaCount > 0 && webCount > 0) return 'combined'
  if (figmaCount > 0) return 'figma'
  if (webCount > 0) return 'web'
  return 'combined'
}

function classifyDifferenceStatus(difference) {
  const figmaText = normalizeString(difference?.figmaText)
  const webText = normalizeString(difference?.webText)
  if (figmaText && webText) return 'different'
  if (figmaText) return 'figma-only'
  if (webText) return 'web-only'
  return 'different'
}

function looksLikePriceText(value) {
  return /(?:₩|\$|€|¥|원|만원|krw|usd|eur|jpy|%|연\s*\d|월\s*\d)/i.test(String(value || '')) && /\d/.test(String(value || ''))
}

function limitItems(items, limit) {
  return items.slice(0, limit)
}

function truncateText(value, maxLength) {
  const text = normalizeString(value).replace(/\s+/g, ' ')
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text
}

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeCount(value, fallback) {
  const numeric = Number(value)
  return Number.isFinite(numeric) && numeric >= 0 ? Math.round(numeric) : fallback
}

function normalizeNumber(value) {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

function normalizeConfidence(value) {
  if (value === 'high' || value === 'medium' || value === 'low') return value
  return 'low'
}

function classifyConfidence(value) {
  if (value === 'high' || value === 'medium' || value === 'low') return value
  return 'low'
}

export const VISUAL_QA_LIMITS = {
  MAX_DIFFERENCES,
  MAX_CTA_CANDIDATES,
  MAX_IMAGE_CANDIDATES,
  MAX_VIDEO_CANDIDATES,
  MAX_SECTION_CANDIDATES,
  MAX_PRICE_CANDIDATES,
  MAX_UNMATCHED_PREVIEW,
}
