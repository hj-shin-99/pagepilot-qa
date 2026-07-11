const MAX_DIFFERENCES = 20
const MAX_CTA_CANDIDATES = 20
const MAX_IMAGE_CANDIDATES = 20
const MAX_VIDEO_CANDIDATES = 10
const MAX_SECTION_CANDIDATES = 20
const MAX_PRICE_CANDIDATES = 20
const MAX_UNMATCHED_PREVIEW = 10
const MAX_HERO_TEXTS = 6
const MAX_NAV_TEXTS = 8
const MAX_NUMERIC_CANDIDATES = 30
const MAX_HERO_MEDIA_PRIMARY = 3
const SIMILAR_Y_RATIO_THRESHOLD = 0.03
const SIMILAR_X_RATIO_THRESHOLD = 0.08
const PRICE_TYPE_SET = new Set(['amount', 'percentage', 'interest-rate', 'monthly-payment', 'duration'])

export function createVisualQaPayload(input) {
  return buildVisualQaPayloadArtifacts(input).payload
}

export function buildVisualQaPayloadArtifacts({ figmaAnalysis, webAnalysis, textComparison }) {
  const safeFigmaAnalysis = figmaAnalysis && typeof figmaAnalysis === 'object' ? figmaAnalysis : {}
  const safeWebAnalysis = webAnalysis && typeof webAnalysis === 'object' ? webAnalysis : {}
  const safeTextComparison = textComparison && typeof textComparison === 'object' ? textComparison : {}
  const quality = createPayloadQuality()

  const figmaTextCandidates = normalizeFigmaTextCandidates(safeFigmaAnalysis.textNodes)
  const webTextCandidates = normalizeWebTextCandidates(safeWebAnalysis.textNodes)
  const figmaNavigationItems = dedupeCandidates(figmaTextCandidates.filter(isNavigationCandidate), quality)
  const webNavigationItems = dedupeCandidates(webTextCandidates.filter(isNavigationCandidate), quality)
  const filteredDifferences = createComparisonSummaries(safeTextComparison, quality)
  const images = dedupeCandidates(createMergedImageHints(safeFigmaAnalysis, safeWebAnalysis, quality), quality).slice(0, MAX_IMAGE_CANDIDATES)
  const videos = dedupeCandidates(createMergedVideoHints(safeFigmaAnalysis, safeWebAnalysis, quality), quality).slice(0, MAX_VIDEO_CANDIDATES)
  const interactions = createInteractionHints({
    figmaAnalysis: safeFigmaAnalysis,
    figmaTextCandidates,
    webTextCandidates,
    webAnalysis: safeWebAnalysis,
    navigationItems: [...figmaNavigationItems, ...webNavigationItems],
  }, quality)
  const ctaButtons = [...interactions.primaryActions, ...interactions.secondaryActions].slice(0, MAX_CTA_CANDIDATES)
  const numericHints = createNumericHints({ figmaTextCandidates, webTextCandidates }, quality)
  const heroMediaGroup = createHeroMediaGroup({ images, videos }, quality)
  const heroCtaGroup = createHeroCtaGroup(ctaButtons)
  const heroSection = createHeroSectionHint({
    figmaTextCandidates,
    webTextCandidates,
    safeWebAnalysis,
    filteredDifferences,
    ctaButtons,
    heroMediaGroup,
  })
  const navigation = createNavigationHint({ figmaNavigationItems, webNavigationItems, filteredDifferences, safeWebAnalysis })
  const evidenceSummary = createEvidenceSummary({
    heroSection,
    heroMediaGroup,
    heroCtaGroup,
    navigation,
    images,
    videos,
    interactions,
    prices: numericHints.prices,
    dates: numericHints.dates,
    filteredDifferences,
    figmaNavigationItems,
    webNavigationItems,
  })

  const payload = {
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
      differenceCount: filteredDifferences.length,
      figmaOnlyCount: normalizeCount(safeTextComparison.summary?.figmaOnlyCount, 0),
      webOnlyCount: normalizeCount(safeTextComparison.summary?.webOnlyCount, 0),
      differences: filteredDifferences,
    },
    aiHints: {
      heroSection,
      heroMediaGroup,
      heroCtaGroup,
      navigation,
      interactions,
      ctaButtons,
      prices: numericHints.prices,
      dates: numericHints.dates,
      numericEntities: numericHints.numericEntities,
      videos,
      images,
      evidenceSummary,
    },
  }

  return { payload, payloadQuality: quality }
}

export function createDebugPreview(textComparison) {
  const safeTextComparison = textComparison && typeof textComparison === 'object' ? textComparison : {}
  return {
    figmaOnlyPreview: limitItems(Array.isArray(safeTextComparison.figmaOnlyPreview) ? safeTextComparison.figmaOnlyPreview : [], MAX_UNMATCHED_PREVIEW),
    webOnlyPreview: limitItems(Array.isArray(safeTextComparison.webOnlyPreview) ? safeTextComparison.webOnlyPreview : [], MAX_UNMATCHED_PREVIEW),
  }
}

export function normalizeTextForExactDisplayComparison(value) {
  return String(value || '')
    .replace(/\u200B/g, '')
    .replace(/\u200C/g, '')
    .replace(/\u200D/g, '')
    .replace(/\u2060/g, '')
    .replace(/\uFEFF/g, '')
    .replace(/[\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]/gu, ' ')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/g, '').replace(/[ \t]{2,}/g, ' '))
    .join('\n')
    .trim()
}

function createPayloadQuality() {
  const quality = {
    invisibleCharacterDiffRemovedCount: 0,
    navigationRemovedFromCtaCount: 0,
    priceNoiseRemovedCount: 0,
    candidateDeduplicatedCount: 0,
    heroMediaGroupCreated: false,
    parentCtaRemovedCount: 0,
    tabRemovedFromCtaCount: 0,
    mediaControlRemovedFromCtaCount: 0,
    offscreenCandidateRemovedCount: 0,
    nonPriceNumericRemovedCount: 0,
    priceSnippetExtractedCount: 0,
    figmaCtaDetectedCount: 0,
    webCtaDetectedCount: 0,
    heroPrimaryMediaCount: 0,
    warnings: [],
  }

  Object.defineProperty(quality, '__tracker', {
    value: {
      offscreen: new Set(),
      parentCta: new Set(),
    },
    enumerable: false,
  })

  return quality
}

function createComparisonSummaries(textComparison, quality) {
  return limitItems(Array.isArray(textComparison.differences) ? textComparison.differences : [], MAX_DIFFERENCES * 3)
    .filter((difference) => {
      const figmaText = normalizeString(difference?.figmaText)
      const webText = normalizeString(difference?.webText)
      if (!figmaText || !webText) return true
      const normalizedFigma = normalizeTextForExactDisplayComparison(figmaText)
      const normalizedWeb = normalizeTextForExactDisplayComparison(webText)
      if (normalizedFigma === normalizedWeb) {
        quality.invisibleCharacterDiffRemovedCount += 1
        return false
      }
      return true
    })
    .map((difference) => ({
      text: truncateText(difference?.figmaText || difference?.webText || difference?.text || '', 120),
      figmaText: truncateText(difference?.figmaText || '', 140),
      webText: truncateText(difference?.webText || '', 140),
      confidence: normalizeConfidence(difference?.matchConfidence),
      status: classifyDifferenceStatus(difference),
      reasons: limitItems(Array.isArray(difference?.evidence) ? difference.evidence : [], 4).map((item) => truncateText(item, 120)),
    }))
    .slice(0, MAX_DIFFERENCES)
}

function createHeroSectionHint({ figmaTextCandidates, webTextCandidates, safeWebAnalysis, filteredDifferences, ctaButtons, heroMediaGroup }) {
  const figmaTexts = dedupeCandidates(figmaTextCandidates.filter(isHeroTextCandidate), null).slice(0, MAX_HERO_TEXTS)
  const webTexts = dedupeCandidates(webTextCandidates.filter(isHeroTextCandidate), null).slice(0, MAX_HERO_TEXTS)
  const sectionCandidates = limitItems(
    dedupeCandidates((Array.isArray(safeWebAnalysis.sectionCandidates) ? safeWebAnalysis.sectionCandidates : []).filter((item) => item?.name === 'hero' || item?.name === 'top'), null),
    MAX_SECTION_CANDIDATES,
  )
  const reasons = []
  if (figmaTexts.length > 0) reasons.push('figma hero/top text candidates')
  if (webTexts.length > 0) reasons.push('web hero/top text candidates')
  if (heroMediaGroup.comparisonHint) reasons.push('hero media candidates grouped')
  if (sectionCandidates.length > 0) reasons.push('section candidates support hero area')
  if (filteredDifferences.some((item) => item.confidence === 'high')) reasons.push('high confidence text differences present')

  return {
    type: 'hero',
    source: determineCombinedSource(figmaTexts.length, webTexts.length),
    confidence: classifyConfidence(reasons.length >= 3 ? 'high' : reasons.length >= 2 ? 'medium' : 'low'),
    reasons,
    mediaTypes: {
      figma: heroMediaGroup.figma.mediaTypes,
      web: heroMediaGroup.web.mediaTypes,
    },
    figmaTexts,
    webTexts,
    ctaButtons: ctaButtons.filter((item) => item.section === 'hero' || item.section === 'top').slice(0, 6),
    sectionCandidates,
  }
}

function createNavigationHint({ figmaNavigationItems, webNavigationItems, filteredDifferences, safeWebAnalysis }) {
  const sectionCandidates = limitItems(
    dedupeCandidates((Array.isArray(safeWebAnalysis.sectionCandidates) ? safeWebAnalysis.sectionCandidates : []).filter((item) => item?.name === 'navigation'), null),
    MAX_SECTION_CANDIDATES,
  )
  const reasons = []
  if (figmaNavigationItems.length > 0) reasons.push('figma navigation-like texts')
  if (webNavigationItems.length > 0) reasons.push('web navigation-like texts')
  if (sectionCandidates.length > 0) reasons.push('section candidates support navigation area')
  if (filteredDifferences.some((item) => item.status === 'different' && looksNavigationText(item.text))) reasons.push('navigation text differences detected')

  return {
    type: 'navigation',
    source: determineCombinedSource(figmaNavigationItems.length, webNavigationItems.length),
    confidence: classifyConfidence(reasons.length >= 3 ? 'high' : reasons.length >= 2 ? 'medium' : 'low'),
    reasons,
    figmaItems: figmaNavigationItems.slice(0, MAX_NAV_TEXTS),
    webItems: webNavigationItems.slice(0, MAX_NAV_TEXTS),
    sectionCandidates,
  }
}

function createInteractionHints({ figmaAnalysis, figmaTextCandidates, webTextCandidates, webAnalysis, navigationItems }, quality) {
  const figmaCandidates = createFigmaInteractionCandidates(figmaAnalysis, figmaTextCandidates)
  const webCandidates = createWebInteractionCandidates(webTextCandidates, webAnalysis)
  const combined = [...figmaCandidates, ...webCandidates]
  const onscreen = combined.filter((candidate) => !hasWebVisualExclusionSignals(candidate, webAnalysis) || !isVisualOnlyExcludedWebCandidate(candidate, webAnalysis, quality))
  const leafPreferred = removeParentInteractionCandidates(onscreen, quality)
  const deduped = dedupeCandidates(leafPreferred, quality)

  const categorized = {
    primaryActions: [],
    secondaryActions: [],
    navigationItems: [],
    tabs: [],
    mediaControls: [],
    carouselControls: [],
    formControls: [],
    utilityControls: [],
    unknownInteractive: [],
  }

  const actionLike = []

  deduped.forEach((candidate) => {
    const role = classifyInteractiveRole(candidate, deduped, navigationItems)
    const normalizedCandidate = {
      ...candidate,
      role,
      confidence: candidate.confidence || inferCandidateConfidence(candidate),
      reasons: uniqueStrings([...(candidate.reasons || []), ...buildInteractionRoleReasons(candidate, role)]),
    }

    if (role === 'navigation') {
      quality.navigationRemovedFromCtaCount += 1
      categorized.navigationItems.push(normalizedCandidate)
      return
    }
    if (role === 'tab') {
      quality.tabRemovedFromCtaCount += 1
      categorized.tabs.push(normalizedCandidate)
      return
    }
    if (role === 'media-control') {
      quality.mediaControlRemovedFromCtaCount += 1
      categorized.mediaControls.push(normalizedCandidate)
      return
    }
    if (role === 'carousel-control') {
      categorized.carouselControls.push(normalizedCandidate)
      return
    }
    if (role === 'form-control') {
      categorized.formControls.push(normalizedCandidate)
      return
    }
    if (role === 'utility-control') {
      categorized.utilityControls.push(normalizedCandidate)
      return
    }
    if (role === 'unknown-interactive') {
      categorized.unknownInteractive.push(normalizedCandidate)
      return
    }

    actionLike.push(normalizedCandidate)
  })

  const assignedActions = assignActionPriority(actionLike)
  assignedActions.forEach((candidate) => {
    if (candidate.role === 'secondary-action') {
      categorized.secondaryActions.push(candidate)
      return
    }
    categorized.primaryActions.push(candidate)
  })

  quality.figmaCtaDetectedCount = assignedActions.filter((item) => item.source === 'figma').length
  quality.webCtaDetectedCount = assignedActions.filter((item) => item.source === 'web').length

  return {
    primaryActions: categorized.primaryActions.slice(0, MAX_CTA_CANDIDATES),
    secondaryActions: categorized.secondaryActions.slice(0, MAX_CTA_CANDIDATES),
    navigationItems: categorized.navigationItems.slice(0, MAX_CTA_CANDIDATES),
    tabs: categorized.tabs.slice(0, MAX_CTA_CANDIDATES),
    mediaControls: categorized.mediaControls.slice(0, MAX_CTA_CANDIDATES),
    carouselControls: categorized.carouselControls.slice(0, MAX_CTA_CANDIDATES),
    formControls: categorized.formControls.slice(0, MAX_CTA_CANDIDATES),
    utilityControls: categorized.utilityControls.slice(0, MAX_CTA_CANDIDATES),
    unknownInteractive: categorized.unknownInteractive.slice(0, MAX_CTA_CANDIDATES),
  }
}

function createFigmaInteractionCandidates(figmaAnalysis, figmaTextCandidates) {
  const flatNodes = Array.isArray(figmaAnalysis.flatNodes) ? figmaAnalysis.flatNodes.filter((node) => node?.effectivelyVisible) : []
  if (flatNodes.length === 0) {
    return figmaTextCandidates
      .filter((item) => item.text && (/(button|btn|cta|tab|nav|menu|link|action)/i.test(`${item.context} ${item.parentContext}`) || item.role === 'cta' || item.role === 'navigation' || item.role === 'tab'))
      .map((item) => ({
        ...item,
        type: 'interactive',
        layerPath: item.layerPath,
        interactionEvidence: uniqueStrings(item.reasons || []),
        widthRatio: normalizeNumber(item.widthRatio),
        heightRatio: normalizeNumber(item.heightRatio),
        parentId: normalizeString(item.parentId),
      }))
  }

  const childMap = new Map()
  flatNodes.forEach((node) => {
    const parentId = normalizeString(node?.parentId)
    if (!parentId) return
    const siblings = childMap.get(parentId) || []
    siblings.push(node)
    childMap.set(parentId, siblings)
  })

  return flatNodes
    .filter((node) => isSemanticFigmaInteractiveNode(node, childMap))
    .map((node) => createFigmaInteractionCandidate(node, flatNodes, childMap))
    .filter(Boolean)
}

function createFigmaInteractionCandidate(node, flatNodes, childMap) {
  const text = deriveFigmaInteractionText(node, flatNodes)
  const layerPath = normalizeString(node?.layerPath)
  const context = truncateText(layerPath || node?.name || '', 180)
  const interactionEvidence = buildFigmaInteractionEvidence(node, childMap)
  const reasons = []
  if (node?.isInteractiveCandidate) reasons.push('interactive prototype signal')
  if (interactionEvidence.some((item) => item.includes('button'))) reasons.push('button-like structure')
  if (interactionEvidence.some((item) => item.includes('repeated'))) reasons.push('repeated action component')
  if (text) reasons.push('descendant text label')
  if (isHeroLikeSection(inferFigmaSection(node))) reasons.push('top section')

  const candidate = {
    type: 'interactive',
    source: 'figma',
    sourceId: normalizeString(node?.nodeId || node?.id),
    text,
    displayText: normalizeTextForExactDisplayComparison(text),
    href: '',
    selector: '',
    context,
    layerPath,
    parentContext: normalizeString(node?.parentName),
    section: inferFigmaSection(node),
    confidence: classifyConfidence(reasons.length >= 3 ? 'high' : reasons.length >= 2 ? 'medium' : 'low'),
    reasons,
    xRatio: normalizeNumber(node?.xRatio),
    yRatio: normalizeNumber(node?.yRatio),
    widthRatio: normalizeNumber(node?.widthRatio),
    heightRatio: normalizeNumber(node?.heightRatio),
    width: normalizeNumber(node?.absoluteBoundingBox?.width),
    height: normalizeNumber(node?.absoluteBoundingBox?.height),
    visible: node?.effectivelyVisible === true,
    tagName: normalizeString(node?.type).toLowerCase(),
    nodeType: normalizeString(node?.type),
    role: inferFigmaInteractionRole(node, text),
    parentId: normalizeString(node?.parentId),
    childIds: Array.isArray(node?.childIds) ? node.childIds : [],
    interactionEvidence,
  }

  if (!candidate.text && !isFigmaFormLikeCandidate(candidate) && !isNavigationLikeCandidate(candidate) && !looksLikeTabCandidate(candidate)) {
    return null
  }

  return candidate
}

function createWebInteractionCandidates(webTextCandidates, webAnalysis) {
  const hintCandidates = (Array.isArray(webAnalysis.ctaCandidates) ? webAnalysis.ctaCandidates : [])
    .map((item) => normalizeWebHintCandidate(item, 'interactive'))
  const textCandidates = webTextCandidates
    .filter(isSemanticWebInteractiveTextCandidate)
    .map((item) => ({ ...item, type: 'interactive' }))

  return [...hintCandidates, ...textCandidates]
}

function removeParentInteractionCandidates(candidates, quality) {
  const safeCandidates = Array.isArray(candidates) ? candidates : []
  return safeCandidates.filter((candidate) => {
    if (!isWebParentWrapperCandidate(candidate)) return true
    const hasPreferredLeaf = safeCandidates.some((other) => {
      if (other === candidate) return false
      if (other.source !== candidate.source) return false
      if (!isWebLeafActionCandidate(other)) return false
      if (!isCandidateDescendant(candidate, other)) return false
      if (!isSameInteractionZone(candidate, other)) return false
      return normalizeComparableText(candidate.text).includes(normalizeComparableText(other.text))
        || normalizeComparableText(candidate.displayText).includes(normalizeComparableText(other.displayText))
        || !candidate.text
    })

    if (!hasPreferredLeaf) return true

    incrementQualityOnce(quality, 'parentCtaRemovedCount', buildCandidateKey(candidate), 'parentCta')
    return false
  })
}

function classifyInteractiveRole(candidate, allCandidates, navigationItems) {
  if (isNavigationLikeCandidate(candidate) || navigationItems.some((item) => isSameCandidateFamily(candidate, item))) return 'navigation'
  if (looksLikeTabCandidate(candidate, allCandidates)) return 'tab'
  if (looksLikeMediaControlCandidate(candidate)) return 'media-control'
  if (looksLikeCarouselControlCandidate(candidate)) return 'carousel-control'
  if (isFormLikeInteractiveCandidate(candidate)) return 'form-control'
  if (looksLikeUtilityControlCandidate(candidate)) return 'utility-control'
  if (looksLikeActionCandidate(candidate)) return 'primary-action'
  return 'unknown-interactive'
}

function assignActionPriority(candidates) {
  const grouped = new Map()
  const sorted = candidates.slice().sort(compareActionCandidates)

  sorted.forEach((candidate) => {
    const key = `${candidate.source}:${getInteractionGroupKey(candidate)}`
    const group = grouped.get(key) || []
    group.push(candidate)
    grouped.set(key, group)
  })

  const assigned = []
  grouped.forEach((group) => {
    group.sort(compareActionCandidates)
    group.forEach((candidate, index) => {
      let role = 'primary-action'
      if (group.length > 1 && (index > 0 || looksLikeSecondaryActionText(candidate.text))) role = 'secondary-action'
      assigned.push({ ...candidate, role })
    })
  })

  return assigned.sort(compareActionCandidates)
}

function createMergedImageHints(figmaAnalysis, webAnalysis, quality) {
  const figmaImages = (Array.isArray(figmaAnalysis.flatNodes) ? figmaAnalysis.flatNodes : [])
    .filter((node) => node?.effectivelyVisible && node?.hasImageFill)
    .map((node) => ({
      type: 'image',
      source: 'figma',
      sourceId: normalizeString(node?.nodeId || node?.id),
      text: truncateText(node?.name || '', 120),
      confidence: classifyConfidence(node?.yRatio <= 0.35 ? 'high' : 'medium'),
      reasons: buildFigmaImageReasons(node),
      section: inferFigmaSection(node),
      context: truncateText(node?.layerPath || '', 180),
      layerPath: truncateText(node?.layerPath || '', 180),
      yRatio: normalizeNumber(node?.yRatio),
      xRatio: normalizeNumber(node?.xRatio),
      widthRatio: normalizeNumber(node?.widthRatio),
      heightRatio: normalizeNumber(node?.heightRatio),
      width: normalizeNumber(node?.absoluteBoundingBox?.width),
      height: normalizeNumber(node?.absoluteBoundingBox?.height),
      visible: node?.effectivelyVisible === true,
      parentId: normalizeString(node?.parentId),
    }))
  const webImages = (Array.isArray(webAnalysis.imageCandidates) ? webAnalysis.imageCandidates : [])
    .map((item) => normalizeWebHintCandidate(item, 'image'))
    .filter((candidate) => !hasWebVisualExclusionSignals(candidate, webAnalysis) || !isVisualOnlyExcludedWebCandidate(candidate, webAnalysis, quality))
  return [...figmaImages, ...webImages]
}

function createMergedVideoHints(figmaAnalysis, webAnalysis, quality) {
  const figmaVideos = (Array.isArray(figmaAnalysis.flatNodes) ? figmaAnalysis.flatNodes : [])
    .filter((node) => node?.effectivelyVisible && node?.hasVideoLikeContent)
    .map((node) => ({
      type: 'video',
      source: 'figma',
      sourceId: normalizeString(node?.nodeId || node?.id),
      text: truncateText(node?.name || '', 120),
      confidence: classifyConfidence(node?.yRatio <= 0.35 ? 'high' : 'medium'),
      reasons: buildFigmaVideoReasons(node),
      section: inferFigmaSection(node),
      context: truncateText(node?.layerPath || '', 180),
      layerPath: truncateText(node?.layerPath || '', 180),
      yRatio: normalizeNumber(node?.yRatio),
      xRatio: normalizeNumber(node?.xRatio),
      widthRatio: normalizeNumber(node?.widthRatio),
      heightRatio: normalizeNumber(node?.heightRatio),
      width: normalizeNumber(node?.absoluteBoundingBox?.width),
      height: normalizeNumber(node?.absoluteBoundingBox?.height),
      visible: node?.effectivelyVisible === true,
      parentId: normalizeString(node?.parentId),
    }))
  const webVideos = (Array.isArray(webAnalysis.videoCandidates) ? webAnalysis.videoCandidates : [])
    .map((item) => normalizeWebHintCandidate(item, 'video'))
    .filter((candidate) => !looksLikeMediaControlCandidate(candidate))
    .filter((candidate) => !hasWebVisualExclusionSignals(candidate, webAnalysis) || !isVisualOnlyExcludedWebCandidate(candidate, webAnalysis, quality))
  return [...figmaVideos, ...webVideos]
}

function createNumericHints({ figmaTextCandidates, webTextCandidates }, quality) {
  const rawCandidates = [...figmaTextCandidates, ...webTextCandidates]
    .map((candidate) => createNumericCandidate(candidate, quality))
    .filter(Boolean)
  const numericEntities = dedupeCandidates(rawCandidates, quality).slice(0, MAX_NUMERIC_CANDIDATES)
  const prices = []
  const dates = []

  numericEntities.forEach((candidate) => {
    if (candidate.numericType === 'date') {
      dates.push(candidate)
      return
    }

    if (!PRICE_TYPE_SET.has(candidate.numericType)) {
      quality.nonPriceNumericRemovedCount += 1
      return
    }

    if (isPriceNoise(candidate)) {
      quality.priceNoiseRemovedCount += 1
      return
    }

    prices.push(candidate)
  })

  return {
    numericEntities,
    prices: prices.slice(0, MAX_PRICE_CANDIDATES),
    dates: dates.slice(0, MAX_PRICE_CANDIDATES),
  }
}

function createNumericCandidate(candidate, quality) {
  const text = normalizeString(candidate?.text)
  if (!text || !/\d/.test(text)) return null

  const numericType = classifyNumericType(text, candidate)
  if (numericType === 'unknown-numeric') return null

  const snippet = PRICE_TYPE_SET.has(numericType) ? extractPriceSnippet(text) : { displayText: text, fullContextText: text }
  if (PRICE_TYPE_SET.has(numericType) && snippet.displayText !== snippet.fullContextText) {
    quality.priceSnippetExtractedCount += 1
  }

  const numericTokens = extractNumericTokens(snippet.displayText)
  const unitTokens = extractUnitTokens(snippet.displayText)
  const reasons = buildNumericReasons(text, candidate, numericType, unitTokens)

  return {
    type: PRICE_TYPE_SET.has(numericType) ? 'price' : 'numeric',
    numericType,
    source: candidate.source,
    sourceId: candidate.sourceId,
    text: truncateText(snippet.displayText, 140),
    displayText: truncateText(snippet.displayText, 140),
    fullContextText: truncateText(snippet.fullContextText, 220),
    numericTokens,
    unitTokens,
    context: truncateText(candidate.context || candidate.layerPath || '', 180),
    section: candidate.section,
    confidence: classifyConfidence(reasons.length >= 3 ? 'high' : reasons.length >= 2 ? 'medium' : 'low'),
    reasons,
    yRatio: candidate.yRatio,
  }
}

function createHeroMediaGroup({ images, videos }, quality) {
  const heroFigmaMedia = [...images.filter((item) => item.source === 'figma' && isHeroMediaCandidate(item)), ...videos.filter((item) => item.source === 'figma' && isHeroMediaCandidate(item))]
  const heroWebMedia = [...images.filter((item) => item.source === 'web' && isHeroMediaCandidate(item)), ...videos.filter((item) => item.source === 'web' && isHeroMediaCandidate(item))]
  const figmaPrimaryCandidates = selectHeroPrimaryMediaCandidates(heroFigmaMedia)
  const webPrimaryCandidates = selectHeroPrimaryMediaCandidates(heroWebMedia)
  const figmaMediaTypes = uniqueStrings(figmaPrimaryCandidates.map((item) => item.type).length > 0 ? figmaPrimaryCandidates.map((item) => item.type) : heroFigmaMedia.map((item) => item.type))
  const webMediaTypes = uniqueStrings(webPrimaryCandidates.map((item) => item.type).length > 0 ? webPrimaryCandidates.map((item) => item.type) : heroWebMedia.map((item) => item.type))
  const comparisonHint = createHeroMediaComparisonHint(figmaMediaTypes, webMediaTypes)
  const reasons = []
  if (heroFigmaMedia.length > 0) reasons.push('figma top media candidates detected')
  if (heroWebMedia.length > 0) reasons.push('web top media candidates detected')
  if (comparisonHint) reasons.push(comparisonHint === 'mixed-media' ? 'hero contains mixed image/video media' : 'figma/web hero media types differ')

  quality.heroMediaGroupCreated = heroFigmaMedia.length > 0 || heroWebMedia.length > 0
  quality.heroPrimaryMediaCount = figmaPrimaryCandidates.length + webPrimaryCandidates.length

  return {
    type: 'hero-media',
    figma: {
      mediaTypes: figmaMediaTypes,
      candidateCount: heroFigmaMedia.length,
      primaryCount: figmaPrimaryCandidates.length,
      primaryCandidates: figmaPrimaryCandidates,
    },
    web: {
      mediaTypes: webMediaTypes,
      candidateCount: heroWebMedia.length,
      primaryCount: webPrimaryCandidates.length,
      primaryCandidates: webPrimaryCandidates,
    },
    comparisonHint,
    confidence: classifyConfidence(reasons.length >= 3 ? 'high' : reasons.length >= 2 ? 'medium' : 'low'),
    reasons,
  }
}

function createHeroCtaGroup(ctaButtons) {
  const heroActions = ctaButtons.filter((item) => item.section === 'hero' || item.section === 'top')
  const figmaActions = heroActions.filter((item) => item.source === 'figma')
  const webActions = heroActions.filter((item) => item.source === 'web')
  const figmaTexts = new Set(figmaActions.map((item) => normalizeComparableText(item.text)))
  const webTexts = new Set(webActions.map((item) => normalizeComparableText(item.text)))
  const textDifferences = []

  figmaActions.forEach((item) => {
    if (!webTexts.has(normalizeComparableText(item.text))) textDifferences.push({ source: 'figma', text: item.text })
  })
  webActions.forEach((item) => {
    if (!figmaTexts.has(normalizeComparableText(item.text))) textDifferences.push({ source: 'web', text: item.text })
  })

  const reasons = []
  if (figmaActions.length > 0) reasons.push('figma hero action candidates present')
  if (webActions.length > 0) reasons.push('web hero action candidates present')
  if (textDifferences.length === 0 && figmaActions.length === webActions.length && figmaActions.length > 0) reasons.push('hero action count aligned')

  return {
    type: 'hero-cta-group',
    figma: {
      count: figmaActions.length,
      actions: figmaActions.slice(0, 6),
    },
    web: {
      count: webActions.length,
      actions: webActions.slice(0, 6),
    },
    countDifference: Math.abs(figmaActions.length - webActions.length),
    textDifferences,
    confidence: classifyConfidence(reasons.length >= 3 ? 'high' : reasons.length >= 2 ? 'medium' : 'low'),
    reasons,
  }
}

function createEvidenceSummary({ heroSection, heroMediaGroup, heroCtaGroup, navigation, images, videos, interactions, prices, dates, filteredDifferences, figmaNavigationItems, webNavigationItems }) {
  return {
    hero: {
      figmaTextCount: heroSection.figmaTexts.length,
      webTextCount: heroSection.webTexts.length,
      figmaMediaTypes: uniqueStrings(heroSection.mediaTypes?.figma || []),
      webMediaTypes: uniqueStrings(heroSection.mediaTypes?.web || []),
      figmaCtaCount: heroCtaGroup.figma.count,
      webCtaCount: heroCtaGroup.web.count,
      figmaPrimaryMediaCount: normalizeCount(heroMediaGroup.figma.primaryCount, 0),
      webPrimaryMediaCount: normalizeCount(heroMediaGroup.web.primaryCount, 0),
    },
    navigation: {
      figmaItemCount: figmaNavigationItems.length,
      webItemCount: webNavigationItems.length,
      totalItemCount: navigation.figmaItems.length + navigation.webItems.length + interactions.navigationItems.length,
    },
    interactions: {
      primaryActionCount: interactions.primaryActions.length,
      secondaryActionCount: interactions.secondaryActions.length,
      tabCount: interactions.tabs.length,
      mediaControlCount: interactions.mediaControls.length,
      carouselControlCount: interactions.carouselControls.length,
      formControlCount: interactions.formControls.length,
      utilityControlCount: interactions.utilityControls.length,
      unknownInteractiveCount: interactions.unknownInteractive.length,
    },
    content: {
      figmaImageCount: images.filter((item) => item.source === 'figma').length,
      webImageCount: images.filter((item) => item.source === 'web').length,
      webVideoCount: videos.filter((item) => item.source === 'web').length,
      heroPrimaryMediaCount: normalizeCount(heroMediaGroup.figma.primaryCount, 0) + normalizeCount(heroMediaGroup.web.primaryCount, 0),
    },
    numeric: {
      priceCount: prices.length,
      dateCount: dates.length,
    },
    text: {
      differenceCount: filteredDifferences.length,
      highConfidenceDifferenceCount: filteredDifferences.filter((item) => item.confidence === 'high').length,
    },
  }
}

function normalizeFigmaTextCandidates(textNodes) {
  return (Array.isArray(textNodes) ? textNodes : [])
    .map((node) => {
      const text = truncateText(node?.characters || '', 180)
      const context = truncateText(node?.layerPath || node?.parentFrameName || '', 180)
      const section = inferFigmaSection(node)
      const reasons = []
      if (Number(node?.fontSize) >= 24) reasons.push('large font size')
      if (Number(node?.fontWeight) >= 700) reasons.push('bold font weight')
      if (section === 'top' || section === 'hero') reasons.push('top section')
      if (/button|cta|btn|action|tab|nav|menu|header|hero|kv|banner/i.test(context)) reasons.push('semantic layer path')

      return {
        type: looksLikePriceText(text) ? 'price' : 'text',
        source: 'figma',
        sourceId: normalizeString(node?.nodeId || node?.id),
        text,
        displayText: normalizeTextForExactDisplayComparison(text),
        confidence: classifyConfidence(reasons.length >= 3 ? 'high' : reasons.length >= 2 ? 'medium' : 'low'),
        reasons,
        section,
        context,
        layerPath: context,
        parentContext: truncateText(node?.parentFrameName || '', 120),
        fontSize: normalizeNumber(node?.fontSize),
        fontWeight: normalizeNumber(node?.fontWeight),
        yRatio: normalizeNumber(node?.yRatio),
        xRatio: normalizeNumber(node?.xRatio),
        widthRatio: normalizeNumber(node?.widthRatio),
        heightRatio: normalizeNumber(node?.heightRatio),
        role: inferFigmaRole(node),
      }
    })
    .filter((item) => item.text)
}

function normalizeWebTextCandidates(textNodes) {
  return (Array.isArray(textNodes) ? textNodes : [])
    .map((node) => {
      const text = truncateText(node?.rawText || node?.text || '', 220)
      const role = normalizeString(node?.role)
      const section = inferWebSection(node)
      const context = truncateText(node?.selector || node?.domPath || '', 180)
      const reasons = []
      if (String(node?.tagName || '').match(/^h[1-6]$/i)) reasons.push('heading element')
      if (role === 'cta') reasons.push('cta role')
      if (role === 'navigation') reasons.push('navigation role')
      if (role === 'tab') reasons.push('tab role')
      if (section === 'top' || section === 'hero') reasons.push('top section')
      if (/button|cta|btn|menuitem|tab|video|carousel|swiper|slider/i.test(context)) reasons.push('semantic selector')
      if (normalizeString(node?.href)) reasons.push('has href')

      return {
        type: looksLikePriceText(text) ? 'price' : 'text',
        source: 'web',
        sourceId: normalizeString(node?.id || node?.selector),
        text,
        displayText: normalizeTextForExactDisplayComparison(text),
        confidence: classifyConfidence(reasons.length >= 3 ? 'high' : reasons.length >= 2 ? 'medium' : 'low'),
        reasons,
        section,
        context,
        selector: truncateText(node?.selector || '', 180),
        parentContext: truncateText(node?.parentSelector || node?.domPath || '', 160),
        yRatio: normalizeNumber(node?.yRatio),
        xRatio: normalizeNumber(node?.xRatio),
        widthRatio: normalizeNumber(node?.widthRatio),
        heightRatio: normalizeNumber(node?.heightRatio),
        width: normalizeNumber(node?.absoluteBoundingBox?.width || node?.width),
        height: normalizeNumber(node?.absoluteBoundingBox?.height || node?.height),
        role,
        tagName: normalizeString(node?.tagName),
        href: normalizeString(node?.href),
        ariaRole: normalizeString(node?.ariaRole),
        parentTagName: normalizeString(node?.parentTagName),
        visible: node?.visible !== false,
      }
    })
    .filter((item) => item.text)
}

function normalizeWebHintCandidate(item, fallbackType) {
  const text = truncateText(item?.text || item?.name || '', 220)
  return {
    type: normalizeString(item?.type) || fallbackType,
    source: normalizeString(item?.source) || 'web',
    sourceId: normalizeString(item?.sourceId || item?.id || item?.selector || item?.text),
    text,
    displayText: normalizeTextForExactDisplayComparison(text),
    href: normalizeString(item?.href),
    selector: truncateText(item?.selector || '', 180),
    context: truncateText(item?.context || item?.selector || item?.layerPath || '', 180),
    parentContext: truncateText(item?.parentContext || item?.parentSelector || item?.domPath || '', 160),
    section: normalizeString(item?.section || item?.area) || 'unknown',
    confidence: normalizeConfidence(item?.confidence),
    reasons: Array.isArray(item?.reasons) ? item.reasons.map((reason) => truncateText(reason, 120)) : [],
    yRatio: normalizeNumber(item?.yRatio),
    xRatio: normalizeNumber(item?.xRatio),
    widthRatio: normalizeNumber(item?.widthRatio),
    heightRatio: normalizeNumber(item?.heightRatio),
    width: normalizeNumber(item?.width || item?.boundingBox?.width),
    height: normalizeNumber(item?.height || item?.boundingBox?.height),
    x: normalizeNumber(item?.x || item?.boundingBox?.x),
    y: normalizeNumber(item?.y || item?.boundingBox?.y),
    visible: item?.visible !== false,
    tagName: normalizeString(item?.tagName),
    role: normalizeString(item?.role),
    ariaRole: normalizeString(item?.ariaRole),
    ariaHidden: item?.ariaHidden === true || normalizeString(item?.ariaHidden).toLowerCase() === 'true',
    parentId: normalizeString(item?.parentId),
    layerPath: truncateText(item?.layerPath || '', 180),
    parentSelector: truncateText(item?.parentSelector || '', 160),
    inputType: normalizeString(item?.inputType || item?.typeAttribute),
    isDuplicate: item?.isDuplicate === true,
    isActive: typeof item?.isActive === 'boolean' ? item.isActive : null,
    isCurrent: typeof item?.isCurrent === 'boolean' ? item.isCurrent : (normalizeString(item?.ariaCurrent).toLowerCase() === 'true' ? true : null),
  }
}

function inferFigmaRole(node) {
  const searchable = `${node?.layerPath || ''} ${node?.parentFrameName || ''} ${node?.name || ''}`.toLowerCase()
  if (/tablist|tabbar|tabs|tab_btn|scroll.?tab|\btab\b/.test(searchable)) return 'tab'
  if (/nav|menu|header|gnb/.test(searchable)) return 'navigation'
  if (/button|cta|btn|action|link/.test(searchable)) return 'cta'
  if (looksLikePriceText(node?.characters)) return 'price'
  if (Number(node?.fontSize) >= 24 || Number(node?.fontWeight) >= 700) return 'heading'
  return 'body'
}

function inferFigmaInteractionRole(node, text) {
  const searchable = `${node?.layerPath || ''} ${node?.name || ''} ${text || ''}`.toLowerCase()
  if (/tablist|tabbar|tabs|tab_btn|scroll.?tab|\btab\b/.test(searchable)) return 'tab'
  if (/nav|menu|header|gnb/.test(searchable)) return 'navigation'
  if (/video|play|pause|mute|control/.test(searchable)) return 'media-control'
  return 'cta'
}

function inferFigmaSection(node) {
  const searchable = `${node?.layerPath || ''} ${node?.parentFrameName || ''} ${node?.name || ''}`.toLowerCase()
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
  const explicit = normalizeString(node?.sectionHint || node?.section)
  if (explicit) return explicit
  const searchable = `${node?.selector || ''} ${node?.domPath || ''} ${node?.parentSelector || ''}`.toLowerCase()
  if (/nav|navigation|gnb|menu|header|menuitem/.test(searchable)) return 'navigation'
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
  if (Number(node?.widthRatio) >= 0.4) reasons.push('large width ratio')
  return reasons
}

function buildFigmaVideoReasons(node) {
  const reasons = ['video-like content']
  if (normalizeString(node?.layerPath).toLowerCase().match(/hero|kv|banner|visual/)) reasons.push('semantic layer path')
  if (Number(node?.yRatio) <= 0.35) reasons.push('top section')
  if (node?.isInteractiveCandidate) reasons.push('interactive candidate')
  if (Number(node?.widthRatio) >= 0.4) reasons.push('large width ratio')
  return reasons
}

function buildFigmaInteractionEvidence(node, childMap) {
  const evidence = []
  if (node?.isInteractiveCandidate) evidence.push('isInteractiveCandidate')
  if (/button|btn|cta|action|link/.test(`${node?.name || ''} ${node?.layerPath || ''}`.toLowerCase())) evidence.push('button-like layer path')
  if (['INSTANCE', 'COMPONENT', 'FRAME'].includes(normalizeString(node?.type)) && Number(node?.widthRatio) >= 0.05 && Number(node?.heightRatio) >= 0.02) evidence.push('button-sized container')
  if (node?.hasSolidFill || Array.isArray(node?.strokes) && node.strokes.length > 0 || Number(node?.cornerRadius) > 0) evidence.push('shape-backed control')
  const siblings = childMap.get(normalizeString(node?.parentId)) || []
  if (siblings.filter((item) => isSemanticFigmaInteractiveNode(item, childMap)).length >= 2) evidence.push('repeated sibling action component')
  return uniqueStrings(evidence)
}

function buildNumericReasons(text, candidate, numericType, unitTokens) {
  const reasons = [`${numericType} classified`]
  if (unitTokens.length > 0) reasons.push('contains unit token')
  if (looksLikePriceContext(candidate)) reasons.push('price-like context')
  if (candidate.section === 'hero' || candidate.section === 'top') reasons.push('top section')
  if (text.length <= 48) reasons.push('compact standalone phrase')
  return reasons
}

function buildInteractionRoleReasons(candidate, role) {
  const reasons = []
  if (role === 'navigation') reasons.push('navigation semantics')
  if (role === 'tab') reasons.push('tab semantics')
  if (role === 'media-control') reasons.push('media control semantics')
  if (role === 'carousel-control') reasons.push('carousel control semantics')
  if (role === 'form-control') reasons.push('form control semantics')
  if (role === 'utility-control') reasons.push('utility control semantics')
  if (role === 'primary-action' || role === 'secondary-action') reasons.push('action semantics')
  if (isHeroLikeSection(candidate.section)) reasons.push('top section')
  return reasons
}

function createHeroMediaComparisonHint(figmaMediaTypes, webMediaTypes) {
  if (figmaMediaTypes.length > 1 || webMediaTypes.length > 1) return 'mixed-media'
  if (figmaMediaTypes.length === 1 && webMediaTypes.length === 1) {
    return `figma-${figmaMediaTypes[0]}-vs-web-${webMediaTypes[0]}`
  }
  if (figmaMediaTypes.length > 0 || webMediaTypes.length > 0) {
    return 'hero-media-types-differ'
  }
  return ''
}

function selectHeroPrimaryMediaCandidates(candidates) {
  const decorated = candidates
    .map((candidate) => ({ ...candidate, role: classifyHeroMediaRole(candidate) }))
    .sort(compareHeroMediaCandidates)
  const background = decorated.filter((item) => item.role === 'background-primary').slice(0, 1)
  const foreground = decorated.filter((item) => item.role === 'foreground-primary').slice(0, 2)
  const videos = decorated.filter((item) => item.type === 'video').slice(0, 1)

  const selected = []
  background.forEach((item) => pushUniqueCandidate(selected, item))
  foreground.forEach((item) => pushUniqueCandidate(selected, item))
  videos.forEach((item) => pushUniqueCandidate(selected, item))

  return selected.slice(0, MAX_HERO_MEDIA_PRIMARY)
}

function classifyHeroMediaRole(candidate) {
  const searchable = `${candidate?.context || ''} ${candidate?.layerPath || ''} ${candidate?.text || ''} ${candidate?.selector || ''}`.toLowerCase()
  if (/icon|control|play|pause|mute|button/.test(searchable)) return 'control/icon'
  if ((candidate.heightRatio || 0) <= 0.12 || (candidate.widthRatio || 0) <= 0.12) return 'decorative'
  if ((candidate.widthRatio || 0) >= 0.55 && (candidate.heightRatio || 0) >= 0.25 && (candidate.yRatio || 1) <= 0.25) return 'background-primary'
  if ((candidate.widthRatio || 0) >= 0.18 && (candidate.heightRatio || 0) >= 0.14) return 'foreground-primary'
  if (/overlay|badge|gradient/.test(searchable)) return 'overlay'
  return 'unknown'
}

function isHeroTextCandidate(item) {
  if (!item || !item.text) return false
  return item.section === 'hero'
    || item.section === 'top'
    || item.role === 'heading'
    || item.reasons.includes('large font size')
    || item.reasons.includes('heading element')
}

function isNavigationCandidate(item) {
  if (!item || !item.text) return false
  return item.section === 'navigation'
    || item.role === 'navigation'
    || /nav|navigation|gnb|menu|header/.test(`${item.context || ''} ${item.parentContext || ''} ${item.selector || ''}`.toLowerCase())
}

function isNavigationLikeCandidate(candidate) {
  return candidate.section === 'navigation'
    || candidate.role === 'navigation'
    || /(nav|navigation|gnb|menu|header|menuitem)/i.test(`${candidate?.context || ''} ${candidate?.parentContext || ''} ${candidate?.selector || ''}`)
}

function isSemanticWebInteractiveTextCandidate(item) {
  if (!item || !item.text) return false
  return ['a', 'button', 'input', 'select', 'textarea', 'label'].includes(item.tagName)
    || ['cta', 'navigation', 'tab'].includes(item.role)
    || ['button', 'tab'].includes(item.ariaRole)
    || /(button|btn|cta|tab|swiper|carousel|slider|video|control|form)/i.test(`${item.context} ${item.parentContext}`)
}

function isSemanticFigmaInteractiveNode(node, childMap) {
  if (!node?.effectivelyVisible) return false
  const searchable = `${node?.name || ''} ${node?.layerPath || ''}`.toLowerCase()
  if (node?.isInteractiveCandidate) return true
  if (/button|btn|cta|action|link|tab|nav|menu/.test(searchable)) return true
  if (['INSTANCE', 'COMPONENT', 'FRAME'].includes(normalizeString(node?.type)) && Number(node?.widthRatio) >= 0.05 && Number(node?.heightRatio) >= 0.02) {
    const children = childMap.get(normalizeString(node?.id)) || []
    return children.some((child) => child?.type === 'TEXT' && normalizeString(child?.characters))
  }
  return false
}

function isHeroMediaCandidate(item) {
  return item.visible !== false && (item.section === 'hero' || item.section === 'top')
}

function compareHeroMediaCandidates(first, second) {
  return getHeroMediaScore(second) - getHeroMediaScore(first)
}

function getHeroMediaScore(candidate) {
  let score = 0
  if (candidate.visible !== false) score += 100
  if (candidate.section === 'hero') score += 80
  if (candidate.section === 'top') score += 60
  if (candidate.role === 'background-primary') score += 70
  if (candidate.role === 'foreground-primary') score += 50
  if (candidate.type === 'video') score += 40
  score += Math.max(0, 40 - Math.round((candidate.yRatio || 1) * 100))
  score += Math.round((candidate.widthRatio || 0) * 100)
  score += Math.round((candidate.heightRatio || 0) * 100)
  score += Math.round(Math.min(candidate.width || 0, 2000) / 50)
  score += Math.round(Math.min(candidate.height || 0, 2000) / 50)
  return score
}

function compareActionCandidates(first, second) {
  const scoreDiff = getCandidateScore(second) - getCandidateScore(first)
  if (scoreDiff !== 0) return scoreDiff
  const yDiff = (first.yRatio ?? 1) - (second.yRatio ?? 1)
  if (yDiff !== 0) return yDiff
  return (first.xRatio ?? 0) - (second.xRatio ?? 0)
}

function getInteractionGroupKey(candidate) {
  const parentKey = normalizeString(candidate.parentId || candidate.parentContext || candidate.parentSelector)
  if (parentKey) return parentKey
  const y = Number.isFinite(candidate.yRatio) ? Math.round(candidate.yRatio * 100) : 'na'
  return `${candidate.section || 'unknown'}:${y}`
}

function isCandidateDescendant(parent, child) {
  if (!parent || !child) return false
  if (parent.source !== child.source) return false
  if (parent.source === 'web') {
    const parentSelector = normalizeString(parent.selector)
    const childParentContext = normalizeString(child.parentContext || child.parentSelector)
    const childSelector = normalizeString(child.selector)
    return Boolean(parentSelector && (childParentContext === parentSelector || childSelector.startsWith(`${parentSelector} >`) || childSelector.includes(`${parentSelector} `)))
  }
  if (parent.source === 'figma') {
    return normalizeString(child.parentId) === normalizeString(parent.sourceId)
      || normalizeString(child.layerPath).startsWith(`${normalizeString(parent.layerPath)} /`)
  }
  return false
}

function isSameInteractionZone(first, second) {
  return first.section === second.section && hasSimilarPosition(first.yRatio, second.yRatio)
}

function isWebParentWrapperCandidate(candidate) {
  if (!candidate || candidate.source !== 'web') return false
  const tagName = normalizeString(candidate.tagName).toLowerCase()
  if (['a', 'button', 'input'].includes(tagName)) return false
  return /(btn|button|cta|wrap|wrapper|action)/i.test(`${candidate.selector || ''} ${candidate.context || ''}`)
}

function isWebLeafActionCandidate(candidate) {
  if (!candidate || candidate.source !== 'web') return false
  return ['a', 'button', 'input'].includes(normalizeString(candidate.tagName).toLowerCase())
    || normalizeString(candidate.ariaRole).toLowerCase() === 'button'
}

function looksLikeTabCandidate(candidate, allCandidates = []) {
  const searchable = `${candidate?.text || ''} ${candidate?.context || ''} ${candidate?.parentContext || ''} ${candidate?.selector || ''} ${candidate?.layerPath || ''}`.toLowerCase()
  if (candidate?.role === 'tab' || normalizeString(candidate?.ariaRole).toLowerCase() === 'tab') return true
  if (/tablist|tabbar|tabs|tab_btn|scroll.?tab|\btab\b/.test(searchable)) return true
  if (candidate?.source === 'web' && /(role=tab|tablist)/.test(searchable)) return true
  const siblings = allCandidates.filter((item) => item !== candidate && getInteractionGroupKey(item) === getInteractionGroupKey(candidate))
  return siblings.length >= 2 && candidate.text.length <= 24 && !normalizeString(candidate.href)
}

function looksLikeMediaControlCandidate(candidate) {
  if (candidate?.type === 'video') return false
  const searchable = `${candidate?.text || ''} ${candidate?.context || ''} ${candidate?.parentContext || ''} ${candidate?.selector || ''}`.toLowerCase()
  return /video|media|control|state|play|pause|mute|unmute|정지|재생|음소거/.test(searchable)
}

function looksLikeCarouselControlCandidate(candidate) {
  const searchable = `${candidate?.text || ''} ${candidate?.context || ''} ${candidate?.parentContext || ''} ${candidate?.selector || ''}`.toLowerCase()
  return /swiper-button|carousel-control|slider-control|pagination|bullet|prev|next|이전|다음/.test(searchable)
}

function looksLikeUtilityControlCandidate(candidate) {
  const searchable = `${candidate?.text || ''} ${candidate?.context || ''} ${candidate?.parentContext || ''}`.toLowerCase()
  return /close|닫기|search|검색|menu|메뉴|share|공유|zoom|확대|download|다운로드|filter|필터/.test(searchable)
}

function isFormLikeInteractiveCandidate(candidate) {
  const searchable = `${candidate?.context || ''} ${candidate?.parentContext || ''} ${candidate?.selector || ''}`.toLowerCase()
  return isFigmaFormLikeCandidate(candidate)
    || ['input', 'select', 'textarea', 'label'].includes(normalizeString(candidate?.tagName).toLowerCase())
    || ['textbox', 'combobox'].includes(normalizeString(candidate?.ariaRole).toLowerCase())
    || /form|input|select|textarea|checkbox|radio|submit/.test(searchable)
}

function isFigmaFormLikeCandidate(candidate) {
  return /form|input|textfield|checkbox|radio|select/.test(`${candidate?.context || ''} ${candidate?.layerPath || ''}`.toLowerCase())
}

function looksLikeActionCandidate(candidate) {
  if (!candidate?.text) return false
  if (candidate.source === 'web') {
    const tagName = normalizeString(candidate.tagName).toLowerCase()
    if (!['a', 'button', 'input'].includes(tagName) && normalizeString(candidate.ariaRole).toLowerCase() !== 'button' && !normalizeString(candidate.href)) {
      return /(button|btn|cta|action|link)/i.test(`${candidate.context} ${candidate.parentContext}`)
    }
  }
  return !looksLikeMediaControlCandidate(candidate)
    && !looksLikeCarouselControlCandidate(candidate)
    && !looksLikeUtilityControlCandidate(candidate)
    && !isFormLikeInteractiveCandidate(candidate)
    && !looksLikeTabCandidate(candidate)
    && !isNavigationLikeCandidate(candidate)
}

function looksLikeSecondaryActionText(value) {
  return /자세히|상세|더\s*보기|learn more|details|more|info/i.test(String(value || ''))
}

function inferCandidateConfidence(candidate) {
  const reasons = Array.isArray(candidate?.reasons) ? candidate.reasons.length : 0
  if (reasons >= 3) return 'high'
  if (reasons >= 2) return 'medium'
  return 'low'
}

function deriveFigmaInteractionText(node, flatNodes) {
  const directText = normalizeString(node?.characters)
  if (directText) return truncateText(directText, 160)

  const layerPath = normalizeString(node?.layerPath)
  const descendantTexts = flatNodes
    .filter((child) => child?.effectivelyVisible && child?.type === 'TEXT')
    .filter((child) => normalizeString(child?.parentId) === normalizeString(node?.id) || normalizeString(child?.layerPath).startsWith(`${layerPath} /`))
    .map((child) => normalizeString(child?.characters))
    .filter(Boolean)

  return truncateText(uniqueStrings(descendantTexts).join(' ').trim(), 160)
}

function classifyNumericType(text, candidate) {
  const value = String(text || '')
  const searchable = `${value} ${candidate?.context || ''} ${candidate?.section || ''}`.toLowerCase()
  if (looksLikeBusinessRegistrationNumber(value)) return 'business-registration-number'
  if (looksLikePhoneNumber(value)) return 'phone-number'
  if (looksLikeCopyrightYear(value, candidate)) return 'copyright-year'
  if (looksLikePostalCode(value, candidate)) return 'postal-code'
  if (looksLikeAddressNumber(value, candidate)) return 'address-number'
  if (looksLikeDateText(value)) return 'date'
  if (looksLikeModelName(value, candidate)) return 'model-name'
  if (/월\s*납입|월\s*\d+[\d.,]*\s*(만원|천원|억원|원)/i.test(value)) return 'monthly-payment'
  if (/(금리|이율|apr|rate|연)\s*\d+(?:[.,]\d+)?\s*%|\d+(?:[.,]\d+)?\s*%/.test(value) && /(금리|이율|apr|rate|연|interest)/i.test(searchable)) return 'interest-rate'
  if (/\d+(?:[.,]\d+)?\s*%|퍼센트/i.test(value)) return 'percentage'
  if (/(계약기간|약정|리스|렌트|개월|년)/i.test(value) && /\d/.test(value)) return 'duration'
  if (/(만원|천원|억원|원|krw|usd|eur|jpy)/i.test(value) && /\d/.test(value)) return /월/i.test(value) ? 'monthly-payment' : 'amount'
  if (/\d/.test(value)) return 'generic-number'
  return 'unknown-numeric'
}

function isPriceNoise(candidate) {
  const text = normalizeString(candidate?.fullContextText || candidate?.text)
  if (!text) return true
  const searchable = `${candidate?.section || ''} ${candidate?.context || ''} ${text}`
  const isLegalContext = /legal|footer|terms|privacy|cookie|disclaimer|약관|개인정보|유의사항|사업자|대표자/i.test(searchable)
  const hasManyNumbers = candidate.numericTokens.length >= 3
  const isLongSentence = text.length >= 55
  const hasStandalonePriceContext = looksLikePriceContext(candidate)

  if (!hasStrongPriceEvidence(text, candidate.numericType)) return true
  if (candidate.numericType === 'generic-number' || candidate.numericType === 'model-name' || candidate.numericType === 'phone-number' || candidate.numericType === 'business-registration-number' || candidate.numericType === 'postal-code' || candidate.numericType === 'address-number' || candidate.numericType === 'copyright-year') return true
  if (isLegalContext && isLongSentence) return true
  if (hasManyNumbers && isLongSentence && !hasStandalonePriceContext) return true
  if (text.length >= 120) return true
  return false
}

function hasStrongPriceEvidence(text, numericType) {
  const value = String(text || '')
  if (numericType === 'monthly-payment') return /(월\s*납입|월\s*\d+[\d.,]*\s*(만원|천원|억원|원)|월\s*[^\s]+\s*(만원|천원|억원|원))/i.test(value)
  if (numericType === 'interest-rate') return /(금리|이율|apr|rate|연)\s*\d+(?:[.,]\d+)?\s*%|\d+(?:[.,]\d+)?\s*%/i.test(value)
  if (numericType === 'duration') return /(계약기간|약정|리스|렌트|개월|년)/i.test(value)
  if (numericType === 'percentage') return /%|퍼센트/i.test(value)
  if (numericType === 'amount') return /(원|만원|천원|억원|krw|usd|eur|jpy)/i.test(value)
  return false
}

function looksLikePriceContext(candidate) {
  return /(price|amount|rate|month|payment|deposit|term|개월|보증금|월|금리|이율|가격|금액|계약기간|표|table|card|payment)/i.test(`${candidate?.text || ''} ${candidate?.context || ''}`)
}

function extractPriceSnippet(text) {
  const value = normalizeTextForExactDisplayComparison(text)
  const sentenceMatches = splitSentenceLikeSegments(value)
  const preferred = sentenceMatches.find((segment) => hasStrongSnippetSignal(segment))
  if (preferred) return { displayText: preferred, fullContextText: value }

  const match = value.match(/(.{0,24}(월\s*\d+[\d.,]*\s*(만원|천원|억원|원)|\d+(?:[.,]\d+)?\s*%|계약기간\s*\d+\s*(개월|년)|\d+\s*(개월|년|만원|천원|억원|원)).{0,24})/i)
  if (match?.[1]) return { displayText: match[1].trim(), fullContextText: value }
  return { displayText: value, fullContextText: value }
}

function splitSentenceLikeSegments(value) {
  return String(value || '')
    .split(/(?<=[.!?])\s+|(?<=다\.)\s+|(?<=요\.)\s+/u)
    .map((segment) => segment.trim())
    .filter(Boolean)
}

function hasStrongSnippetSignal(value) {
  return /(월\s*\d+[\d.,]*\s*(만원|천원|억원|원)|\d+(?:[.,]\d+)?\s*%|계약기간\s*\d+\s*(개월|년)|\d+\s*(개월|년|만원|천원|억원|원))/i.test(String(value || ''))
}

function extractNumericTokens(value) {
  return (String(value || '').match(/\d+(?:[.,]\d+)?/g) || []).map((token) => token.replace(/,/g, '.'))
}

function extractUnitTokens(value) {
  return uniqueStrings(String(value || '').match(/만원|천원|억원|원|%|퍼센트|월\s*납입|금리|연|보증금|선납금|계약기간|개월|년|krw|usd|eur|jpy|price|rate|payment|deposit|term/gi) || [])
}

function looksLikePriceText(value) {
  return /(?:₩|\$|€|¥|원|만원|천원|억원|krw|usd|eur|jpy|%|연\s*\d|월\s*\d|개월|년)/i.test(String(value || '')) && /\d/.test(String(value || ''))
}

function looksLikeModelName(value, candidate) {
  const text = normalizeTextForExactDisplayComparison(value)
  if (/(원|만원|천원|억원|%|퍼센트|개월|년|월\s*납입|금리|이율)/i.test(text)) return false
  if (looksLikePhoneNumber(text) || looksLikeBusinessRegistrationNumber(text)) return false
  const searchable = `${text} ${candidate?.context || ''} ${candidate?.section || ''}`.toLowerCase()
  if (/nav|menu|tab|model|lineup|trim|grade|category/.test(searchable)) return true
  return text.length <= 24 && /(?:[a-zA-Z]+\d+[a-zA-Z0-9-]*|\b\d+[a-zA-Z][a-zA-Z0-9-]*\b|\b[a-zA-Z]+\s+\d+\b|\b더\s*\d+\b|\bthe\s+\d+\b|\bthe\s+[a-zA-Z]+\d*\b)/i.test(text)
}

function looksLikePhoneNumber(value) {
  return /(?:\+?\d{1,3}[\s-]?)?(?:0\d{1,2}|\d{2,4})[\s-]?\d{3,4}[\s-]?\d{4}/.test(String(value || ''))
}

function looksLikeBusinessRegistrationNumber(value) {
  return /\b\d{3}-\d{2}-\d{5}\b/.test(String(value || ''))
}

function looksLikePostalCode(value, candidate) {
  return /(우편번호|postal|postcode)/i.test(`${value} ${candidate?.context || ''}`) && /\b\d{5}\b/.test(String(value || ''))
}

function looksLikeAddressNumber(value, candidate) {
  const searchable = `${value} ${candidate?.context || ''}`
  return /(\d+\s*(로|길|번길|번지)|\d+\s*(동|호)|address\s*\d+)/i.test(searchable)
}

function looksLikeCopyrightYear(value, candidate) {
  return /(copyright|all rights reserved|©)/i.test(`${value} ${candidate?.context || ''}`) && /\b(19|20)\d{2}\b/.test(String(value || ''))
}

function looksLikeDateText(value) {
  return /(\b\d{4}[./-]\d{1,2}[./-]\d{1,2}\b|\b\d{1,2}[/-]\d{1,2}\b|\b\d{1,2}\.\d{1,2}\.\d{1,2}\b|\b\d+\s*일\b)/i.test(String(value || ''))
}

function isVisualOnlyExcludedWebCandidate(candidate, webAnalysis, quality) {
  if (!candidate || candidate.source !== 'web') return false
  const viewportWidth = Number(webAnalysis?.page?.viewportWidth) || 0
  const searchable = `${candidate.selector || ''} ${candidate.context || ''} ${candidate.parentContext || ''}`.toLowerCase()
  const xRatio = normalizeNumber(candidate.xRatio)
  const widthRatio = normalizeNumber(candidate.widthRatio)
  const x = normalizeNumber(candidate.x)
  const width = normalizeNumber(candidate.width)
  const hasExplicitPositionSignal = Number.isFinite(xRatio) || (viewportWidth > 0 && Number.isFinite(x) && Number.isFinite(width))
  const offscreen = (Number.isFinite(xRatio) && (xRatio < 0 || xRatio > 1))
    || (Number.isFinite(xRatio) && Number.isFinite(widthRatio) && (xRatio + widthRatio <= 0 || xRatio >= 1))
    || (viewportWidth > 0 && Number.isFinite(x) && Number.isFinite(width) && (x + width <= 0 || x >= viewportWidth))
  const duplicateSlide = /swiper-slide-duplicate/.test(searchable) || candidate.isDuplicate === true
  const hidden = candidate.ariaHidden === true
  const hasExplicitCarouselState = candidate.isActive !== null || candidate.isCurrent !== null
  const inactiveCarousel = /swiper|carousel|slider|slide/.test(searchable) && hasExplicitCarouselState && candidate.isActive === false && candidate.isCurrent === false

  if (!duplicateSlide && !hidden && !inactiveCarousel && (!hasExplicitPositionSignal || !offscreen)) return false
  incrementQualityOnce(quality, 'offscreenCandidateRemovedCount', buildCandidateKey(candidate), 'offscreen')
  return true
}

function hasWebVisualExclusionSignals(candidate, webAnalysis) {
  if (!candidate || candidate.source !== 'web') return false
  const viewportWidth = Number(webAnalysis?.page?.viewportWidth) || 0
  const searchable = `${candidate.selector || ''} ${candidate.context || ''} ${candidate.parentContext || ''}`.toLowerCase()
  return candidate.ariaHidden === true
    || candidate.isDuplicate === true
    || /swiper-slide-duplicate|swiper|carousel|slider|slide/.test(searchable)
    || Number.isFinite(normalizeNumber(candidate.xRatio))
    || (viewportWidth > 0 && Number.isFinite(normalizeNumber(candidate.x)) && Number.isFinite(normalizeNumber(candidate.width)))
}

function dedupeCandidates(candidates, quality) {
  const safeCandidates = Array.isArray(candidates) ? candidates : []
  const deduped = []

  safeCandidates.forEach((candidate) => {
    const duplicateIndex = deduped.findIndex((existing) => isDuplicateCandidate(existing, candidate))
    if (duplicateIndex === -1) {
      deduped.push(candidate)
      return
    }

    if (quality) quality.candidateDeduplicatedCount += 1
    deduped[duplicateIndex] = choosePreferredCandidate(deduped[duplicateIndex], candidate)
  })

  return deduped
}

function isDuplicateCandidate(first, second) {
  if (!first || !second) return false
  if (first.source && second.source && first.source !== second.source) return false
  if (first.source && second.source && first.source === second.source) {
    if (first.sourceId && second.sourceId && first.sourceId === second.sourceId) return true
    if (first.selector && second.selector && first.selector === second.selector) return true
  }

  const firstText = normalizeTextForExactDisplayComparison(first.text)
  const secondText = normalizeTextForExactDisplayComparison(second.text)
  const sameText = firstText && secondText && firstText === secondText
  const sameContext = normalizeString(first.context) && normalizeString(first.context) === normalizeString(second.context)
  const sameParent = normalizeString(first.parentContext) && normalizeString(first.parentContext) === normalizeString(second.parentContext)
  const similarY = hasSimilarPosition(first.yRatio, second.yRatio)
  const similarX = hasSimilarXAxis(first.xRatio, second.xRatio)

  return sameText && similarY && (sameContext || sameParent || similarX)
}

function choosePreferredCandidate(first, second) {
  return getCandidateScore(second) > getCandidateScore(first) ? second : first
}

function getCandidateScore(candidate) {
  let score = 0
  score += candidate.confidence === 'high' ? 30 : candidate.confidence === 'medium' ? 20 : 10
  score += Array.isArray(candidate.reasons) ? candidate.reasons.length : 0
  if (candidate.visible !== false) score += 5
  if (candidate.section === 'hero' || candidate.section === 'top') score += 5
  if (normalizeString(candidate.href)) score += 3
  if (['a', 'button', 'input'].includes(normalizeString(candidate.tagName).toLowerCase())) score += 4
  return score
}

function hasSimilarPosition(firstYRatio, secondYRatio) {
  const first = normalizeNumber(firstYRatio)
  const second = normalizeNumber(secondYRatio)
  if (!Number.isFinite(first) || !Number.isFinite(second)) return false
  return Math.abs(first - second) <= SIMILAR_Y_RATIO_THRESHOLD
}

function hasSimilarXAxis(firstXRatio, secondXRatio) {
  const first = normalizeNumber(firstXRatio)
  const second = normalizeNumber(secondXRatio)
  if (!Number.isFinite(first) || !Number.isFinite(second)) return false
  return Math.abs(first - second) <= SIMILAR_X_RATIO_THRESHOLD
}

function isSameCandidateFamily(first, second) {
  return normalizeTextForExactDisplayComparison(first?.text) === normalizeTextForExactDisplayComparison(second?.text)
    && hasSimilarPosition(first?.yRatio, second?.yRatio)
    && (normalizeString(first?.context) === normalizeString(second?.context) || normalizeString(first?.parentContext) === normalizeString(second?.parentContext))
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

function isHeroLikeSection(section) {
  return section === 'hero' || section === 'top'
}

function pushUniqueCandidate(target, candidate) {
  if (target.some((item) => isDuplicateCandidate(item, candidate))) return
  target.push(candidate)
}

function incrementQualityOnce(quality, key, candidateKey, trackerKey) {
  if (!quality || !quality.__tracker) return
  const tracker = quality.__tracker[trackerKey]
  if (!tracker || tracker.has(candidateKey)) return
  tracker.add(candidateKey)
  quality[key] += 1
}

function buildCandidateKey(candidate) {
  return `${candidate?.source || 'unknown'}:${candidate?.sourceId || candidate?.selector || candidate?.text || Math.random().toString(36).slice(2, 10)}`
}

function normalizeComparableText(value) {
  return normalizeTextForExactDisplayComparison(value).toLowerCase().replace(/[\s\u00a0.,:;!?"'“”‘’()[\]{}<>_/\\-]/g, '')
}

function uniqueStrings(values) {
  return Array.from(new Set((Array.isArray(values) ? values : []).filter(Boolean).map((value) => String(value))))
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
  if (value === null || value === undefined || value === '') return null
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
