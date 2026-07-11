import { inferFigmaSectionHint, inferFigmaTextRole, inferWebSectionHint } from './textMatcher.js'
import { inferWebTextRole } from './webText.js'

const MAX_COMPARISON_ITEMS = 20
const MAX_SECTION_TEXTS = 8
const MAX_HINT_ITEMS = 12

export function createVisualQaPayload({
  figmaRender,
  webScreenshot,
  figmaStructure,
  figmaTextNodes,
  webTextNodes,
  textCompareResult,
}) {
  const safeFigmaTextNodes = Array.isArray(figmaTextNodes) ? figmaTextNodes : []
  const safeWebTextNodes = Array.isArray(webTextNodes) ? webTextNodes : []
  const safeFigmaFlatNodes = Array.isArray(figmaStructure?.figmaFlatNodes)
    ? figmaStructure.figmaFlatNodes
    : Array.isArray(figmaStructure?.flatNodes)
      ? figmaStructure.flatNodes
      : []
  const summary = textCompareResult?.summary || {}
  const comparisonSummaries = createComparisonSummaries(textCompareResult)
  const figmaImageHints = createImageHints(safeFigmaFlatNodes)
  const videoHints = createVideoHints(safeFigmaFlatNodes)
  const ctaHints = createCtaHints(safeFigmaTextNodes, safeWebTextNodes)
  const priceHints = createPriceHints(safeFigmaTextNodes, safeWebTextNodes)

  return {
    figma: {
      image: pickImagePath(figmaRender),
      imageUrl: normalizeString(figmaRender?.imageUrl),
      localImagePath: normalizeString(figmaRender?.localImagePath),
      renderId: normalizeString(figmaRender?.renderId),
      structureSummary: figmaStructure?.structureSummary || {},
      textCount: safeFigmaTextNodes.length,
    },

    web: {
      image: pickImagePath(webScreenshot),
      localImagePath: normalizeString(webScreenshot?.localImagePath),
      textCount: safeWebTextNodes.length,
      capturedAt: normalizeString(webScreenshot?.capturedAt),
    },

    comparison: {
      matchedCount: normalizeCount(summary.matchedCount, Array.isArray(textCompareResult?.matchedPairs) ? textCompareResult.matchedPairs.length : 0),
      differenceCount: normalizeCount(summary.differenceCount, Array.isArray(textCompareResult?.differences) ? textCompareResult.differences.length : 0),
      figmaOnlyCount: normalizeCount(summary.figmaOnlyCount, Array.isArray(textCompareResult?.figmaOnly) ? textCompareResult.figmaOnly.length : 0),
      webOnlyCount: normalizeCount(summary.webOnlyCount, Array.isArray(textCompareResult?.webOnly) ? textCompareResult.webOnly.length : 0),
      differences: comparisonSummaries,
    },

    aiHints: {
      heroSection: createHeroSectionHint({
        figmaTextNodes: safeFigmaTextNodes,
        webTextNodes: safeWebTextNodes,
        figmaFlatNodes: safeFigmaFlatNodes,
        comparisonSummaries,
      }),
      navigation: createNavigationHint({
        figmaTextNodes: safeFigmaTextNodes,
        webTextNodes: safeWebTextNodes,
        comparisonSummaries,
      }),
      ctaButtons: ctaHints,
      prices: priceHints,
      videos: videoHints,
      images: figmaImageHints,
    },
  }
}

function createComparisonSummaries(textCompareResult) {
  const differences = Array.isArray(textCompareResult?.differences) ? textCompareResult.differences : []
  const matchedPairs = Array.isArray(textCompareResult?.matchedPairs) ? textCompareResult.matchedPairs : []
  const figmaOnly = Array.isArray(textCompareResult?.figmaOnly) ? textCompareResult.figmaOnly : []
  const webOnly = Array.isArray(textCompareResult?.webOnly) ? textCompareResult.webOnly : []
  const differenceKeys = new Set(differences.map((item) => createPairKey(item?.figmaNodeId, item?.webSelector)).filter(Boolean))

  const matchedSummaries = matchedPairs.map((pair) => {
    const pairKey = createPairKey(pair?.figmaNode?.nodeId || pair?.figmaNode?.id, pair?.webElement?.selector)
    const figmaText = normalizeText(pair?.figmaNode?.characters)
    const webText = normalizeText(pair?.webElement?.rawText || pair?.webElement?.text)
    const hasDifference = differenceKeys.has(pairKey) || (!pair?.rawTextEqual && !pair?.normalizedTextEqual)

    return {
      text: truncateText(figmaText || webText, 120),
      figmaText: truncateText(figmaText, 140),
      webText: truncateText(webText, 140),
      confidence: normalizeConfidence(pair?.matchConfidence),
      status: hasDifference ? 'different' : 'same',
    }
  })

  const figmaOnlySummaries = figmaOnly.map((node) => ({
    text: truncateText(node?.characters, 120),
    figmaText: truncateText(node?.characters, 140),
    webText: '',
    confidence: 'low',
    status: 'figma-only',
  }))

  const webOnlySummaries = webOnly.map((node) => ({
    text: truncateText(node?.rawText || node?.text, 120),
    figmaText: '',
    webText: truncateText(node?.rawText || node?.text, 140),
    confidence: 'low',
    status: 'web-only',
  }))

  return [...matchedSummaries, ...figmaOnlySummaries, ...webOnlySummaries]
    .filter((item) => item.text || item.figmaText || item.webText)
    .sort(compareComparisonSummary)
    .slice(0, MAX_COMPARISON_ITEMS)
}

function createHeroSectionHint({ figmaTextNodes, webTextNodes, figmaFlatNodes, comparisonSummaries }) {
  const heroFigmaTexts = figmaTextNodes
    .map(createFigmaTextCandidate)
    .filter((item) => item.sectionHint === 'hero' || item.sectionHint === 'top' || item.role === 'heading' || item.role === 'price')
    .sort(compareTextCandidates)
    .slice(0, MAX_SECTION_TEXTS)

  const heroWebTexts = webTextNodes
    .map(createWebTextCandidate)
    .filter((item) => item.sectionHint === 'hero' || item.sectionHint === 'top' || item.role === 'heading' || item.role === 'price')
    .sort(compareTextCandidates)
    .slice(0, MAX_SECTION_TEXTS)

  const heroNodes = figmaFlatNodes
    .filter((node) => node?.effectivelyVisible)
    .filter((node) => isHeroLikeNode(node))
    .sort(compareStructureNodes)
    .slice(0, 4)
    .map((node) => createStructureNodeHint(node))

  return {
    figmaNodeCandidates: heroNodes,
    figmaTexts: heroFigmaTexts,
    webTexts: heroWebTexts,
    comparison: comparisonSummaries.filter((item) => isHeroLikeText(item.text) || isHeroLikeText(item.figmaText) || isHeroLikeText(item.webText)).slice(0, 6),
    hasImageCandidate: heroNodes.some((node) => node.hasImageFill),
    hasVideoCandidate: heroNodes.some((node) => node.hasVideoLikeContent),
  }
}

function createNavigationHint({ figmaTextNodes, webTextNodes, comparisonSummaries }) {
  const figmaTexts = figmaTextNodes
    .map(createFigmaTextCandidate)
    .filter((item) => item.sectionHint === 'navigation' || item.role === 'navigation')
    .sort(compareTextCandidates)
    .slice(0, MAX_SECTION_TEXTS)

  const webTexts = webTextNodes
    .map(createWebTextCandidate)
    .filter((item) => item.sectionHint === 'navigation' || item.role === 'navigation')
    .sort(compareTextCandidates)
    .slice(0, MAX_SECTION_TEXTS)

  return {
    figmaTexts,
    webTexts,
    comparison: comparisonSummaries.filter((item) => isNavigationLikeText(item.text) || isNavigationLikeText(item.figmaText) || isNavigationLikeText(item.webText)).slice(0, 6),
  }
}

function createCtaHints(figmaTextNodes, webTextNodes) {
  const candidates = [
    ...figmaTextNodes.map(createFigmaTextCandidate).filter((item) => item.role === 'cta'),
    ...webTextNodes.map(createWebTextCandidate).filter((item) => item.role === 'cta'),
  ]

  return dedupeHintItems(candidates.map((item) => ({
    source: item.source,
    text: item.text,
    sectionHint: item.sectionHint,
    context: item.context,
    yRatio: item.yRatio,
  }))).slice(0, MAX_HINT_ITEMS)
}

function createPriceHints(figmaTextNodes, webTextNodes) {
  const candidates = [
    ...figmaTextNodes.map(createFigmaTextCandidate).filter((item) => item.role === 'price' || looksLikePriceText(item.text)),
    ...webTextNodes.map(createWebTextCandidate).filter((item) => item.role === 'price' || looksLikePriceText(item.text)),
  ]

  return dedupeHintItems(candidates.map((item) => ({
    source: item.source,
    text: item.text,
    sectionHint: item.sectionHint,
    context: item.context,
    yRatio: item.yRatio,
  }))).slice(0, MAX_HINT_ITEMS)
}

function createVideoHints(figmaFlatNodes) {
  return figmaFlatNodes
    .filter((node) => node?.effectivelyVisible && node?.hasVideoLikeContent)
    .sort(compareStructureNodes)
    .slice(0, MAX_HINT_ITEMS)
    .map((node) => ({
      source: 'figma',
      name: normalizeText(node?.name) || 'Unnamed Video',
      layerPath: normalizeText(node?.layerPath),
      type: normalizeString(node?.type),
      yRatio: normalizeRatio(node?.yRatio),
    }))
}

function createImageHints(figmaFlatNodes) {
  return figmaFlatNodes
    .filter((node) => node?.effectivelyVisible && node?.hasImageFill)
    .sort(compareStructureNodes)
    .slice(0, MAX_HINT_ITEMS)
    .map((node) => ({
      source: 'figma',
      name: normalizeText(node?.name) || 'Unnamed Image',
      layerPath: normalizeText(node?.layerPath),
      type: normalizeString(node?.type),
      yRatio: normalizeRatio(node?.yRatio),
      imageFillCount: normalizeCount(node?.imageFillCount, 0),
      likelyHero: isHeroLikeNode(node),
    }))
}

function createFigmaTextCandidate(node) {
  return {
    source: 'figma',
    text: truncateText(node?.characters, 140),
    role: inferFigmaTextRole(node),
    sectionHint: inferFigmaSectionHint(node),
    context: truncateText(node?.layerPath || node?.parentFrameName || '', 160),
    yRatio: normalizeRatio(node?.yRatio),
    fontSize: normalizeNumber(node?.fontSize),
    fontWeight: normalizeNumber(node?.fontWeight),
  }
}

function createWebTextCandidate(node) {
  return {
    source: 'web',
    text: truncateText(node?.rawText || node?.text, 140),
    role: node?.role || inferWebTextRole(node),
    sectionHint: inferWebSectionHint(node),
    context: truncateText(node?.selector || node?.domPath || '', 160),
    yRatio: normalizeRatio(node?.yRatio),
    fontSize: normalizeNumber(node?.fontSize),
    fontWeight: normalizeNumber(node?.fontWeight),
  }
}

function createStructureNodeHint(node) {
  return {
    name: normalizeText(node?.name) || 'Unnamed Node',
    type: normalizeString(node?.type),
    layerPath: truncateText(node?.layerPath, 180),
    yRatio: normalizeRatio(node?.yRatio),
    childCount: normalizeCount(node?.childCount, 0),
    hasImageFill: node?.hasImageFill === true,
    hasVideoLikeContent: node?.hasVideoLikeContent === true,
  }
}

function compareComparisonSummary(first, second) {
  const statusDiff = getComparisonStatusRank(first.status) - getComparisonStatusRank(second.status)
  if (statusDiff !== 0) return statusDiff
  return getConfidenceRank(second.confidence) - getConfidenceRank(first.confidence)
}

function compareTextCandidates(first, second) {
  if (first.role !== second.role) return getRoleRank(first.role) - getRoleRank(second.role)
  const yDiff = (first.yRatio ?? 1) - (second.yRatio ?? 1)
  if (yDiff !== 0) return yDiff
  return (second.fontSize || 0) - (first.fontSize || 0)
}

function compareStructureNodes(first, second) {
  const firstScore = getStructureRank(first)
  const secondScore = getStructureRank(second)
  if (firstScore !== secondScore) return secondScore - firstScore
  return (first.yRatio ?? 1) - (second.yRatio ?? 1)
}

function getStructureRank(node) {
  let score = 0
  if (node?.hasVideoLikeContent) score += 500
  if (node?.hasImageFill) score += 300
  if (isHeroLikeNode(node)) score += 200
  score += Math.min(normalizeCount(node?.childCount, 0), 20) * 5
  return score
}

function getComparisonStatusRank(value) {
  if (value === 'different') return 0
  if (value === 'figma-only') return 1
  if (value === 'web-only') return 2
  return 3
}

function getConfidenceRank(value) {
  if (value === 'high') return 3
  if (value === 'medium') return 2
  return 1
}

function getRoleRank(value) {
  if (value === 'heading') return 0
  if (value === 'price') return 1
  if (value === 'cta') return 2
  if (value === 'navigation') return 3
  return 4
}

function pickImagePath(value) {
  return normalizeString(value?.localImagePath || value?.imageUrl || value?.image)
}

function createPairKey(figmaNodeId, webSelector) {
  const figma = normalizeString(figmaNodeId)
  const web = normalizeString(webSelector)
  return figma || web ? `${figma}::${web}` : ''
}

function dedupeHintItems(items) {
  const seen = new Set()
  const result = []

  items.forEach((item) => {
    const key = `${normalizeText(item?.source)}:${normalizeText(item?.text)}:${normalizeText(item?.sectionHint)}:${normalizeText(item?.context)}`
    if (!item?.text || seen.has(key)) return
    seen.add(key)
    result.push(item)
  })

  return result
}

function isHeroLikeNode(node) {
  const searchable = `${node?.name || ''} ${node?.layerPath || ''}`.toLowerCase()
  if (/hero|kv|banner|main[_\s-]?visual/.test(searchable)) return true
  if (node?.hasImageFill && Number(node?.yRatio) <= 0.35) return true
  if (node?.hasVideoLikeContent && Number(node?.yRatio) <= 0.45) return true
  return Number(node?.yRatio) <= 0.2 && normalizeCount(node?.childCount, 0) >= 3
}

function isHeroLikeText(value) {
  const text = String(value || '').toLowerCase()
  return /bmw|hero|kv|프로모션|혜택|월\s*\d+|예약|구매/.test(text)
}

function isNavigationLikeText(value) {
  const text = String(value || '').toLowerCase()
  return /navigation|nav|gnb|header|menu|search|상단\s*메뉴|전체\s*메뉴|메뉴/.test(text)
}

function looksLikePriceText(value) {
  const text = String(value || '')
  return /(?:₩|\$|€|¥|원|만원|krw|usd|eur|jpy|%|월\s*\d|연\s*\d)/i.test(text) && /\d/.test(text)
}

function normalizeConfidence(value) {
  return ['high', 'medium', 'low'].includes(value) ? value : 'low'
}

function normalizeRatio(value) {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? Math.round(numeric * 10000) / 10000 : null
}

function normalizeCount(value, fallback) {
  const numeric = Number(value)
  return Number.isFinite(numeric) && numeric >= 0 ? Math.round(numeric) : fallback
}

function normalizeNumber(value) {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

function truncateText(value, maxLength) {
  const text = normalizeText(value)
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text
}
