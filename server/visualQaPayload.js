const MAX_DIFFERENCES = 20
const MAX_CTA_CANDIDATES = 20
const MAX_IMAGE_CANDIDATES = 20
const MAX_VIDEO_CANDIDATES = 10
const MAX_SECTION_CANDIDATES = 20
const MAX_PRICE_CANDIDATES = 15
const MAX_UNMATCHED_PREVIEW = 10
const MAX_NAV_TEXTS = 8
const MAX_NUMERIC_CANDIDATES = 30
const MAX_HERO_MEDIA_PRIMARY = 3
const MAX_HERO_ACTIONS = 5
const MAX_CONTENT_ACTIONS = 10
const MAX_NAVIGATION_ITEMS = 15
const MAX_SECTION_ENTITIES = 15
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
  const filteredDifferences = createComparisonSummaries(safeTextComparison, quality)
  const rawImages = dedupeCandidates(createMergedImageHints(safeFigmaAnalysis, safeWebAnalysis, quality), quality).slice(0, MAX_IMAGE_CANDIDATES)
  const rawVideos = dedupeCandidates(createMergedVideoHints(safeFigmaAnalysis, safeWebAnalysis, quality), quality).slice(0, MAX_VIDEO_CANDIDATES)
  const rawInteractions = createRawInteractionArtifacts({
    figmaAnalysis: safeFigmaAnalysis,
    figmaTextCandidates,
    webTextCandidates,
    webAnalysis: safeWebAnalysis,
  }, quality)
  const rawNumericCandidates = createRawNumericCandidates({
    figmaTextCandidates,
    webTextCandidates,
    webAnalysis: safeWebAnalysis,
  }, quality)
  const draftSections = createSectionEntities({
    figmaAnalysis: safeFigmaAnalysis,
    figmaTextCandidates,
    webTextCandidates,
    rawActions: rawInteractions.allCandidates,
    rawNumericCandidates,
    rawImages,
    rawVideos,
  })
  const heroSections = detectHeroSections(draftSections)
  quality.heroSectionDetected = Boolean(heroSections.figmaSectionId || heroSections.webSectionId)
  const interactions = createInteractionHints({ rawInteractions, sections: draftSections, heroSections }, quality)
  const numericHints = createNumericHints({ rawNumericCandidates, sections: draftSections, heroSections }, quality)
  const mediaHints = createCanonicalMediaHints({ images: rawImages, videos: rawVideos, sections: draftSections, heroSections })
  const canonicalEvidence = createCanonicalEvidence({
    actions: interactions.allActions,
    numericValues: numericHints.numericEntities,
    media: mediaHints.media,
    sections: finalizeSectionEntities(draftSections, {
      actions: interactions.allActions,
      numericValues: numericHints.numericEntities,
      media: mediaHints.media,
    }, heroSections),
  })
  const ctaButtons = createCanonicalCtaButtons(canonicalEvidence.actions, heroSections)
  const heroMediaGroup = createHeroMediaGroup({ media: canonicalEvidence.media, heroSections }, quality)
  const heroCtaGroup = createHeroCtaGroup(canonicalEvidence.actions, heroSections, quality)
  const heroSection = createHeroSectionHint({
    sections: canonicalEvidence.sections,
    heroSections,
    filteredDifferences,
    ctaButtons,
    heroMediaGroup,
  })
  const navigation = createNavigationHint({ sections: canonicalEvidence.sections, actions: canonicalEvidence.actions, filteredDifferences })
  const evidenceSummary = createEvidenceSummary({
    heroSection,
    heroMediaGroup,
    heroCtaGroup,
    navigation,
    sections: canonicalEvidence.sections,
    media: canonicalEvidence.media,
    interactions,
    prices: numericHints.prices,
    dates: numericHints.dates,
    filteredDifferences,
    canonicalEvidence,
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
      canonicalEvidence: {
        actions: canonicalEvidence.actions,
        numericValues: canonicalEvidence.numericValues,
        media: canonicalEvidence.media,
        sections: canonicalEvidence.sections,
      },
      heroSection,
      heroMediaGroup,
      heroCtaGroup,
      navigation,
      interactions,
      ctaButtons,
      prices: numericHints.prices,
      dates: numericHints.dates,
      numericEntities: numericHints.numericEntities,
      videos: canonicalEvidence.media.filter((item) => item.mediaType === 'video').slice(0, MAX_VIDEO_CANDIDATES),
      images: canonicalEvidence.media.filter((item) => item.mediaType === 'image').slice(0, MAX_IMAGE_CANDIDATES),
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
    canonicalActionCount: 0,
    canonicalNumericCount: 0,
    rawActionCount: 0,
    rawNumericCount: 0,
    webActionSourcesMergedCount: 0,
    figmaNestedActionMergedCount: 0,
    oversizedFigmaActionRejectedCount: 0,
    duplicateNumericMergedCount: 0,
    heroSectionDetected: false,
    figmaHeroCanonicalActionCount: 0,
    webHeroCanonicalActionCount: 0,
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

function createSectionEntities({ figmaAnalysis, figmaTextCandidates, webTextCandidates, rawActions, rawNumericCandidates, rawImages, rawVideos }) {
  const sectionMap = new Map()
  const figmaNodes = Array.isArray(figmaAnalysis.flatNodes) ? figmaAnalysis.flatNodes : []
  const figmaSources = [...figmaNodes, ...figmaTextCandidates]
  const webSources = [
    ...webTextCandidates,
    ...(Array.isArray(rawActions) ? rawActions.filter((item) => item.source === 'web') : []),
    ...(Array.isArray(rawNumericCandidates) ? rawNumericCandidates.filter((item) => item.source === 'web') : []),
    ...(Array.isArray(rawImages) ? rawImages.filter((item) => item.source === 'web') : []),
    ...(Array.isArray(rawVideos) ? rawVideos.filter((item) => item.source === 'web') : []),
  ]

  figmaSources.forEach((candidate) => upsertSectionEntity(sectionMap, createSectionSeedFromCandidate(candidate, 'figma')))
  webSources.forEach((candidate) => upsertSectionEntity(sectionMap, createSectionSeedFromCandidate(candidate, 'web')))

  return Array.from(sectionMap.values())
    .sort(compareSectionEntities)
    .slice(0, MAX_SECTION_ENTITIES)
}

function detectHeroSections(sections) {
  const figma = selectHeroSectionForSource(sections, 'figma')
  const web = selectHeroSectionForSource(sections, 'web')
  return {
    figmaSectionId: figma?.sectionId || '',
    webSectionId: web?.sectionId || '',
  }
}

function createCanonicalEvidence({ actions, numericValues, media, sections }) {
  return {
    actions: limitCanonicalActions(actions),
    numericValues: limitItems(numericValues, MAX_PRICE_CANDIDATES),
    media: limitItems(media, MAX_IMAGE_CANDIDATES + MAX_VIDEO_CANDIDATES),
    sections: limitItems(sections, MAX_SECTION_ENTITIES),
  }
}

function createHeroSectionHint({ sections, heroSections, filteredDifferences, ctaButtons, heroMediaGroup }) {
  const figmaHero = sections.find((item) => item.sectionId === heroSections.figmaSectionId) || null
  const webHero = sections.find((item) => item.sectionId === heroSections.webSectionId) || null
  const reasons = []
  if (figmaHero) reasons.push('figma hero section detected')
  if (webHero) reasons.push('web hero section detected')
  if (heroMediaGroup.comparisonHint) reasons.push('hero media candidates grouped')
  if (figmaHero?.actionCount > 0 || webHero?.actionCount > 0) reasons.push('hero action cluster detected')
  if (filteredDifferences.some((item) => item.confidence === 'high')) reasons.push('high confidence text differences present')

  return {
    type: 'hero',
    source: determineCombinedSource(figmaHero ? 1 : 0, webHero ? 1 : 0),
    confidence: classifyConfidence(reasons.length >= 3 ? 'high' : reasons.length >= 2 ? 'medium' : 'low'),
    reasons,
    figmaSectionId: figmaHero?.sectionId || '',
    webSectionId: webHero?.sectionId || '',
    mediaTypes: {
      figma: heroMediaGroup.figma.mediaTypes,
      web: heroMediaGroup.web.mediaTypes,
    },
    figmaTextCount: normalizeCount(figmaHero?.textCount, 0),
    webTextCount: normalizeCount(webHero?.textCount, 0),
    ctaButtons: ctaButtons.filter((item) => item.sectionId && (item.sectionId === heroSections.figmaSectionId || item.sectionId === heroSections.webSectionId)).slice(0, MAX_HERO_ACTIONS),
    sections: [figmaHero, webHero].filter(Boolean),
  }
}

function createNavigationHint({ sections, actions, filteredDifferences }) {
  const navSections = sections.filter((item) => item.role === 'navigation').slice(0, MAX_NAV_TEXTS)
  const navigationItems = actions.filter((item) => item.role === 'navigation').slice(0, MAX_NAVIGATION_ITEMS)
  const reasons = []
  if (navSections.some((item) => item.source === 'figma')) reasons.push('figma navigation section detected')
  if (navSections.some((item) => item.source === 'web')) reasons.push('web navigation section detected')
  if (navigationItems.length > 0) reasons.push('navigation action items detected')
  if (filteredDifferences.some((item) => item.status === 'different' && looksNavigationText(item.text))) reasons.push('navigation text differences detected')

  return {
    type: 'navigation',
    source: determineCombinedSource(navSections.filter((item) => item.source === 'figma').length, navSections.filter((item) => item.source === 'web').length),
    confidence: classifyConfidence(reasons.length >= 3 ? 'high' : reasons.length >= 2 ? 'medium' : 'low'),
    reasons,
    figmaItems: navigationItems.filter((item) => item.source === 'figma').slice(0, MAX_NAVIGATION_ITEMS),
    webItems: navigationItems.filter((item) => item.source === 'web').slice(0, MAX_NAVIGATION_ITEMS),
    sections: navSections,
  }
}

function createRawInteractionArtifacts({ figmaAnalysis, figmaTextCandidates, webTextCandidates, webAnalysis }, quality) {
  const figmaCandidates = createFigmaInteractionCandidates(figmaAnalysis, figmaTextCandidates, quality)
  const webCandidates = createWebInteractionCandidates(webTextCandidates, webAnalysis)
  const combined = [...figmaCandidates, ...webCandidates]
  const onscreen = combined.filter((candidate) => !hasWebVisualExclusionSignals(candidate, webAnalysis) || !isVisualOnlyExcludedWebCandidate(candidate, webAnalysis, quality))
  const leafPreferred = removeParentInteractionCandidates(onscreen, quality)
  const exactDeduped = dedupeRawInteractionCandidates(leafPreferred, quality)
  quality.rawActionCount = exactDeduped.length

  return {
    allCandidates: exactDeduped,
    dedupedCandidates: exactDeduped,
  }
}

function createInteractionHints({ rawInteractions, sections, heroSections }, quality) {
  const deduped = rawInteractions.dedupedCandidates

  deduped.forEach((candidate) => {
    const role = classifyInteractiveRole(candidate, deduped, [])
    candidate.role = role
    candidate.confidence = candidate.confidence || inferCandidateConfidence(candidate)
    candidate.reasons = uniqueStrings([...(candidate.reasons || []), ...buildInteractionRoleReasons(candidate, role)])
    if (role === 'navigation') quality.navigationRemovedFromCtaCount += 1
    if (role === 'tab') quality.tabRemovedFromCtaCount += 1
    if (role === 'media-control') quality.mediaControlRemovedFromCtaCount += 1
  })

  const assignedActions = assignActionPriority(deduped.filter((candidate) => candidate.role === 'primary-action'))
  const roleMap = new Map(assignedActions.map((candidate) => [buildCandidateKey(candidate), candidate.role]))
  deduped.forEach((candidate) => {
    const candidateKey = buildCandidateKey(candidate)
    if (roleMap.has(candidateKey)) candidate.role = roleMap.get(candidateKey)
  })

  const canonicalActions = createCanonicalActionEntities(deduped, sections, heroSections, quality)
  const categorized = {
    primaryActions: canonicalActions.filter((item) => item.role === 'primary-action'),
    secondaryActions: canonicalActions.filter((item) => item.role === 'secondary-action'),
    navigationItems: canonicalActions.filter((item) => item.role === 'navigation'),
    tabs: canonicalActions.filter((item) => item.role === 'tab'),
    mediaControls: canonicalActions.filter((item) => item.role === 'media-control'),
    carouselControls: canonicalActions.filter((item) => item.role === 'carousel-control'),
    formControls: canonicalActions.filter((item) => item.role === 'form-control'),
    utilityControls: canonicalActions.filter((item) => item.role === 'utility-control'),
    unknownInteractive: canonicalActions.filter((item) => item.role === 'unknown-interactive'),
  }

  quality.figmaCtaDetectedCount = canonicalActions.filter((item) => item.source === 'figma' && isCtaRole(item.role)).length
  quality.webCtaDetectedCount = canonicalActions.filter((item) => item.source === 'web' && isCtaRole(item.role)).length
  quality.canonicalActionCount = canonicalActions.length

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
    allActions: canonicalActions,
  }
}

function createFigmaInteractionCandidates(figmaAnalysis, figmaTextCandidates, quality) {
  const flatNodes = Array.isArray(figmaAnalysis.flatNodes) ? figmaAnalysis.flatNodes.filter((node) => node?.effectivelyVisible) : []
  if (flatNodes.length === 0) {
    return figmaTextCandidates
      .filter((item) => item.text && item.text.length <= 24 && !/[.!?]|\s{2,}/.test(item.text) && /(button|btn|cta|tab|nav|menu|link|action)/i.test(`${item.context} ${item.parentContext}`))
      .map((item) => ({
        ...item,
        type: 'interactive',
        sourceKind: 'figma-text',
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
    .filter((node) => isSemanticFigmaInteractiveNode(node, childMap, flatNodes, quality))
    .map((node) => createFigmaInteractionCandidate(node, flatNodes, childMap, quality))
    .filter(Boolean)
}

function createFigmaInteractionCandidate(node, flatNodes, childMap, quality) {
  const text = deriveFigmaInteractionText(node, flatNodes)
  const layerPath = normalizeString(node?.layerPath)
  const context = truncateText(layerPath || node?.name || '', 180)
  const interactionEvidence = buildFigmaInteractionEvidence(node, childMap)
  const descendantTexts = getFigmaDescendantTexts(node, flatNodes)
  if (shouldRejectFigmaActionNode(node, descendantTexts, childMap)) {
    quality.oversizedFigmaActionRejectedCount += 1
    return null
  }
  const reasons = []
  if (node?.isInteractiveCandidate) reasons.push('interactive prototype signal')
  if (interactionEvidence.some((item) => item.includes('button'))) reasons.push('button-like structure')
  if (interactionEvidence.some((item) => item.includes('repeated'))) reasons.push('repeated action component')
  if (text) reasons.push('descendant text label')
  if (isHeroLikeSection(inferFigmaSection(node))) reasons.push('top section')

  const candidate = {
    type: 'interactive',
    source: 'figma',
    sourceKind: 'figma-node',
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
    .map((item) => normalizeWebHintCandidate({ ...item, sourceKind: 'web-cta-hint' }, 'interactive'))
  const textCandidates = webTextCandidates
    .filter(isSemanticWebInteractiveTextCandidate)
    .map((item) => ({ ...item, type: 'interactive', sourceKind: 'web-text' }))

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
      sourceKind: 'figma-node',
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
      sourceKind: 'figma-node',
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

function createRawNumericCandidates({ figmaTextCandidates, webTextCandidates, webAnalysis }, quality) {
  const rawCandidates = [...figmaTextCandidates, ...webTextCandidates]
    .filter((candidate) => !hasWebVisualExclusionSignals(candidate, webAnalysis) || !isVisualOnlyExcludedWebCandidate(candidate, webAnalysis, quality))
    .map((candidate) => createNumericCandidate(candidate, quality))
    .filter(Boolean)
  quality.rawNumericCount = rawCandidates.length
  return rawCandidates
}

function createNumericHints({ rawNumericCandidates, sections, heroSections }, quality) {
  const numericEntities = createCanonicalNumericEntities(rawNumericCandidates, sections, heroSections, quality).slice(0, MAX_NUMERIC_CANDIDATES)
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
    sourceKind: candidate.sourceKind || `${candidate.source}-text`,
    numericType,
    source: candidate.source,
    sourceId: candidate.sourceId,
    text: truncateText(snippet.displayText, 140),
    displayText: truncateText(snippet.displayText, 140),
    fullContextText: truncateText(snippet.fullContextText, 220),
    numericTokens,
    unitTokens,
    context: truncateText(candidate.context || candidate.layerPath || '', 180),
    selector: candidate.selector || '',
    parentContext: candidate.parentContext || '',
    section: candidate.section,
    confidence: classifyConfidence(reasons.length >= 3 ? 'high' : reasons.length >= 2 ? 'medium' : 'low'),
    reasons,
    xRatio: candidate.xRatio,
    yRatio: candidate.yRatio,
  }
}

function createCanonicalMediaHints({ images, videos, sections, heroSections }) {
  const canonicalMedia = createCanonicalMediaEntities([...images, ...videos], sections, heroSections)
  return {
    media: canonicalMedia,
  }
}

function createHeroMediaGroup({ media, heroSections }, quality) {
  const heroFigmaMedia = media.filter((item) => item.source === 'figma' && item.sectionId === heroSections.figmaSectionId)
  const heroWebMedia = media.filter((item) => item.source === 'web' && item.sectionId === heroSections.webSectionId)
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

function createHeroCtaGroup(actions, heroSections, quality) {
  const heroActions = actions.filter((item) => isCtaRole(item.role) && (item.sectionId === heroSections.figmaSectionId || item.sectionId === heroSections.webSectionId))
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

  quality.heroSectionDetected = Boolean(heroSections.figmaSectionId || heroSections.webSectionId)
  quality.figmaHeroCanonicalActionCount = figmaActions.length
  quality.webHeroCanonicalActionCount = webActions.length

  return {
    type: 'hero-cta-group',
    figma: {
      count: figmaActions.length,
      actions: figmaActions.slice(0, MAX_HERO_ACTIONS),
    },
    web: {
      count: webActions.length,
      actions: webActions.slice(0, MAX_HERO_ACTIONS),
    },
    countDifference: Math.abs(figmaActions.length - webActions.length),
    textDifferences,
    confidence: classifyConfidence(reasons.length >= 3 ? 'high' : reasons.length >= 2 ? 'medium' : 'low'),
    reasons,
  }
}

function createEvidenceSummary({ heroSection, heroMediaGroup, heroCtaGroup, navigation, sections, media, interactions, prices, dates, filteredDifferences, canonicalEvidence }) {
  return {
    hero: {
      figmaTextCount: heroSection.figmaTextCount,
      webTextCount: heroSection.webTextCount,
      figmaMediaTypes: uniqueStrings(heroSection.mediaTypes?.figma || []),
      webMediaTypes: uniqueStrings(heroSection.mediaTypes?.web || []),
      figmaCtaCount: heroCtaGroup.figma.count,
      webCtaCount: heroCtaGroup.web.count,
      figmaPrimaryMediaCount: normalizeCount(heroMediaGroup.figma.primaryCount, 0),
      webPrimaryMediaCount: normalizeCount(heroMediaGroup.web.primaryCount, 0),
    },
    navigation: {
      figmaItemCount: navigation.figmaItems.length,
      webItemCount: navigation.webItems.length,
      totalItemCount: navigation.figmaItems.length + navigation.webItems.length,
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
      figmaImageCount: media.filter((item) => item.source === 'figma' && item.mediaType === 'image').length,
      webImageCount: media.filter((item) => item.source === 'web' && item.mediaType === 'image').length,
      webVideoCount: media.filter((item) => item.source === 'web' && item.mediaType === 'video').length,
      heroPrimaryMediaCount: normalizeCount(heroMediaGroup.figma.primaryCount, 0) + normalizeCount(heroMediaGroup.web.primaryCount, 0),
    },
    numeric: {
      priceCount: prices.length,
      dateCount: dates.length,
    },
    sections: {
      totalCount: sections.length,
      heroCount: sections.filter((item) => item.role === 'hero').length,
    },
    canonical: {
      actionCount: canonicalEvidence.actions.length,
      numericCount: canonicalEvidence.numericValues.length,
      mediaCount: canonicalEvidence.media.length,
    },
    text: {
      differenceCount: filteredDifferences.length,
      highConfidenceDifferenceCount: filteredDifferences.filter((item) => item.confidence === 'high').length,
    },
  }
}

function upsertSectionEntity(sectionMap, seed) {
  if (!seed) return
  const existing = sectionMap.get(seed.sectionId)
  if (!existing) {
    sectionMap.set(seed.sectionId, seed)
    return
  }

  existing.xRatio = minDefined(existing.xRatio, seed.xRatio)
  existing.yRatio = minDefined(existing.yRatio, seed.yRatio)
  existing.widthRatio = maxDefined(existing.widthRatio, seed.widthRatio)
  existing.heightRatio = maxDefined(existing.heightRatio, seed.heightRatio)
  existing.textCount += normalizeCount(seed.textCount, 0)
  existing.actionCount += normalizeCount(seed.actionCount, 0)
  existing.imageCount += normalizeCount(seed.imageCount, 0)
  existing.videoCount += normalizeCount(seed.videoCount, 0)
  existing.headingCount += normalizeCount(seed.headingCount, 0)
  existing.numericCount += normalizeCount(seed.numericCount, 0)
}

function createSectionSeedFromCandidate(candidate, source) {
  if (!candidate) return null
  const sectionPath = source === 'figma'
    ? getFigmaSectionPath(candidate.layerPath || candidate.context || candidate.parentContext)
    : getWebSectionPath(candidate.parentContext || candidate.context || candidate.selector || candidate.layerPath, candidate.section)
  const searchable = `${candidate?.layerPath || ''} ${candidate?.context || ''} ${candidate?.parentContext || ''} ${candidate?.selector || ''}`.toLowerCase()
  const role = inferSectionRole({ source, searchable, explicitSection: candidate.section, text: candidate.text })
  return {
    sectionId: `${source}:${sectionPath || role || 'unknown'}`,
    source,
    role,
    path: sectionPath || role || 'unknown',
    xRatio: normalizeNumber(candidate.xRatio),
    yRatio: normalizeNumber(candidate.yRatio),
    widthRatio: normalizeNumber(candidate.widthRatio),
    heightRatio: normalizeNumber(candidate.heightRatio),
    textCount: candidate.type === 'text' || candidate.nodeType === 'TEXT' ? 1 : 0,
    actionCount: candidate.type === 'interactive' ? 1 : 0,
    imageCount: candidate.type === 'image' ? 1 : 0,
    videoCount: candidate.type === 'video' ? 1 : 0,
    headingCount: candidate.role === 'heading' || Array.isArray(candidate.reasons) && (candidate.reasons.includes('large font size') || candidate.reasons.includes('heading element')) ? 1 : 0,
    numericCount: candidate.type === 'numeric' || candidate.type === 'price' ? 1 : 0,
    childEntityIds: [],
  }
}

function compareSectionEntities(first, second) {
  const scoreDiff = getSectionEntityScore(second) - getSectionEntityScore(first)
  if (scoreDiff !== 0) return scoreDiff
  return (first.yRatio ?? 1) - (second.yRatio ?? 1)
}

function getSectionEntityScore(section) {
  let score = 0
  if (section.role === 'hero') score += 200
  if (section.role === 'navigation') score += 120
  if (section.role === 'footer') score += 40
  score += normalizeCount(section.headingCount, 0) * 18
  score += normalizeCount(section.actionCount, 0) * 14
  score += normalizeCount(section.imageCount, 0) * 12
  score += normalizeCount(section.videoCount, 0) * 14
  score += normalizeCount(section.textCount, 0) * 3
  score += Math.max(0, 50 - Math.round((section.yRatio ?? 1) * 100))
  return score
}

function selectHeroSectionForSource(sections, source) {
  const candidates = sections.filter((item) => item.source === source && item.role !== 'navigation' && item.role !== 'footer')
  if (candidates.length === 0) return null
  return candidates
    .map((section) => ({ section, score: getHeroSectionScore(section) }))
    .filter((entry) => entry.score > 0)
    .sort((first, second) => second.score - first.score)
    .map((entry) => entry.section)[0] || null
}

function getHeroSectionScore(section) {
  let score = 0
  if (section.role === 'hero') score += 220
  if (/hero|kv|banner|main.?visual/.test(section.path.toLowerCase())) score += 180
  if ((section.imageCount + section.videoCount) > 0) score += 60
  if (section.headingCount > 0) score += 50
  if (section.actionCount > 0) score += 45
  if ((section.yRatio ?? 1) <= 0.3) score += 40
  if ((section.widthRatio ?? 0) >= 0.4) score += 20
  if ((section.heightRatio ?? 0) >= 0.12) score += 20
  return score
}

function inferSectionRole({ source, searchable, explicitSection, text }) {
  const explicit = normalizeString(explicitSection).toLowerCase()
  if (explicit === 'navigation') return 'navigation'
  if (explicit === 'footer') return 'footer'
  if (explicit === 'hero') return 'hero'
  if (/nav|navigation|gnb|menu|header/.test(searchable)) return 'navigation'
  if (/footer|legal|copyright|terms|privacy|cookie/.test(searchable)) return 'footer'
  if (/hero|kv|banner|main.?visual/.test(searchable)) return 'hero'
  if (/card|swiper|carousel|slider/.test(searchable)) return 'cards'
  if (source === 'web' && /main/.test(searchable)) return 'content'
  if (text) return 'content'
  return 'unknown'
}

function getFigmaSectionPath(value) {
  const parts = normalizeString(value).split('/').map((item) => item.trim()).filter(Boolean)
  return parts[0] || 'unknown'
}

function getWebSectionPath(value, explicitSection) {
  const explicit = normalizeString(explicitSection)
  if (explicit === 'hero' || explicit === 'navigation' || explicit === 'footer') return explicit
  const normalized = normalizeString(value)
  if (!normalized) return explicit || 'unknown'
  const parts = normalized.split('>').map((item) => item.trim()).filter(Boolean)
  const root = (parts[0] || explicit || 'unknown').split(/\s+/)[0]
  return root || explicit || 'unknown'
}

function finalizeSectionEntities(sections, canonicalEvidence, heroSections) {
  const finalized = sections.map((section) => ({
    ...section,
    role: section.sectionId === heroSections.figmaSectionId || section.sectionId === heroSections.webSectionId ? 'hero' : section.role,
    textCount: normalizeCount(section.textCount, 0),
    actionCount: 0,
    imageCount: 0,
    videoCount: 0,
    childEntityIds: [],
  }))

  const sectionMap = new Map(finalized.map((section) => [section.sectionId, section]))
  canonicalEvidence.actions.forEach((entity) => {
    const section = sectionMap.get(entity.sectionId)
    if (!section) return
    section.actionCount += 1
    section.childEntityIds.push(entity.entityId)
  })
  canonicalEvidence.numericValues.forEach((entity) => {
    const section = sectionMap.get(entity.sectionId)
    if (!section) return
    section.childEntityIds.push(entity.entityId)
  })
  canonicalEvidence.media.forEach((entity) => {
    const section = sectionMap.get(entity.sectionId)
    if (!section) return
    if (entity.mediaType === 'video') section.videoCount += 1
    if (entity.mediaType === 'image') section.imageCount += 1
    section.childEntityIds.push(entity.entityId)
  })

  return finalized.sort(compareSectionEntities)
}

function limitCanonicalActions(actions) {
  const hero = actions.filter((item) => isCtaRole(item.role) && item.isHeroAction).slice(0, MAX_HERO_ACTIONS)
  const content = actions.filter((item) => isCtaRole(item.role) && !item.isHeroAction).slice(0, MAX_CONTENT_ACTIONS)
  const navigation = actions.filter((item) => item.role === 'navigation').slice(0, MAX_NAVIGATION_ITEMS)
  const tabs = actions.filter((item) => item.role === 'tab').slice(0, MAX_NAVIGATION_ITEMS)
  const mediaControls = actions.filter((item) => item.role === 'media-control').slice(0, MAX_NAVIGATION_ITEMS)
  const others = actions.filter((item) => !isCtaRole(item.role) && !['navigation', 'tab', 'media-control'].includes(item.role)).slice(0, MAX_NAVIGATION_ITEMS)
  return dedupeCanonicalEntities([...hero, ...content, ...navigation, ...tabs, ...mediaControls, ...others])
}

function createCanonicalCtaButtons(actions, heroSections) {
  const hero = actions.filter((item) => isCtaRole(item.role) && (item.sectionId === heroSections.figmaSectionId || item.sectionId === heroSections.webSectionId)).slice(0, MAX_HERO_ACTIONS)
  const content = actions.filter((item) => isCtaRole(item.role) && !hero.includes(item)).slice(0, MAX_CONTENT_ACTIONS)
  return [...hero, ...content]
}

function createCanonicalActionEntities(rawCandidates, sections, heroSections, quality) {
  const canonical = []

  rawCandidates.forEach((candidate) => {
    const section = resolveSectionForCandidate(candidate, sections)
    const normalized = {
      ...candidate,
      sectionId: section?.sectionId || '',
      sectionRootId: section?.sectionId || '',
      sectionPath: section?.path || '',
    }
    const existing = canonical.find((entity) => isSameCanonicalAction(entity, normalized))
    if (!existing) {
      canonical.push(createCanonicalActionEntity(normalized, heroSections))
      return
    }

    mergeCanonicalActionEntity(existing, normalized, quality)
  })

  canonical.forEach((entity) => {
    entity.isHeroAction = isCtaRole(entity.role) && (entity.sectionId === heroSections.figmaSectionId || entity.sectionId === heroSections.webSectionId)
  })

  return canonical.sort(compareActionCandidates)
}

function createCanonicalActionEntity(candidate, heroSections) {
  return {
    entityId: `action:${candidate.source}:${candidate.sourceId || candidate.selector || normalizeComparableText(candidate.text)}`,
    type: 'action',
    source: candidate.source,
    role: candidate.role,
    text: candidate.text,
    displayText: candidate.displayText,
    href: candidate.href || '',
    selector: candidate.selector || '',
    sectionId: candidate.sectionId || '',
    sectionRootId: candidate.sectionRootId || '',
    sectionPath: candidate.sectionPath || '',
    confidence: candidate.confidence,
    reasons: uniqueStrings(candidate.reasons || []),
    xRatio: normalizeNumber(candidate.xRatio),
    yRatio: normalizeNumber(candidate.yRatio),
    widthRatio: normalizeNumber(candidate.widthRatio),
    heightRatio: normalizeNumber(candidate.heightRatio),
    interactionEvidence: Array.isArray(candidate.interactionEvidence) ? candidate.interactionEvidence : [],
    sources: [buildSourceEvidence(candidate)],
    isHeroAction: candidate.sectionId === heroSections.figmaSectionId || candidate.sectionId === heroSections.webSectionId,
  }
}

function mergeCanonicalActionEntity(entity, candidate, quality) {
  entity.sources.push(buildSourceEvidence(candidate))
  entity.sources = dedupeSourceEvidence(entity.sources)
  entity.reasons = uniqueStrings([...entity.reasons, ...(candidate.reasons || [])])
  entity.interactionEvidence = uniqueStrings([...(entity.interactionEvidence || []), ...(candidate.interactionEvidence || [])])
  if (getActionRepresentativeScore(candidate) > getActionRepresentativeScore(entity)) {
    entity.text = candidate.text || entity.text
    entity.displayText = candidate.displayText || entity.displayText
    entity.href = candidate.href || entity.href
    entity.selector = candidate.selector || entity.selector
    entity.confidence = candidate.confidence || entity.confidence
    entity.xRatio = normalizeNumber(candidate.xRatio)
    entity.yRatio = normalizeNumber(candidate.yRatio)
    entity.widthRatio = normalizeNumber(candidate.widthRatio)
    entity.heightRatio = normalizeNumber(candidate.heightRatio)
  }
  if (candidate.source === 'web') quality.webActionSourcesMergedCount += 1
  if (candidate.source === 'figma') quality.figmaNestedActionMergedCount += 1
}

function isSameCanonicalAction(entity, candidate) {
  if (!entity || !candidate) return false
  if (entity.source !== candidate.source) return false
  if (entity.source === 'web') {
    const sameSelector = normalizeSelector(entity.selector) && normalizeSelector(entity.selector) === normalizeSelector(candidate.selector)
    const sameHref = normalizeString(entity.href) === normalizeString(candidate.href)
    const sameText = normalizeComparableText(entity.text) === normalizeComparableText(candidate.text)
    const sameParent = normalizeString(entity.sectionPath) === normalizeString(candidate.sectionPath)
    return sameText && hasSimilarPosition(entity.yRatio, candidate.yRatio) && (sameSelector || (sameHref && sameParent))
  }
  const sameText = normalizeComparableText(entity.text) === normalizeComparableText(candidate.text)
  const sameSection = normalizeString(entity.sectionPath) === normalizeString(candidate.sectionPath)
  const sameFamily = normalizeString(entity.selector || entity.sectionId) === normalizeString(candidate.parentId || candidate.sectionId)
  return sameText && (sameFamily || (sameSection && hasSimilarPosition(entity.yRatio, candidate.yRatio) && hasSimilarXAxis(entity.xRatio, candidate.xRatio)))
}

function buildSourceEvidence(candidate) {
  return {
    source: candidate.sourceKind || `${candidate.source}-${candidate.type}`,
    sourceId: candidate.sourceId || '',
    selector: candidate.selector || '',
    href: candidate.href || '',
    text: candidate.text || '',
  }
}

function dedupeSourceEvidence(sources) {
  const seen = new Set()
  return (Array.isArray(sources) ? sources : []).filter((item) => {
    const key = `${item.source}:${item.sourceId}:${item.selector}:${item.href}:${normalizeComparableText(item.text)}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function getActionRepresentativeScore(candidate) {
  let score = getCandidateScore(candidate)
  const type = normalizeString(candidate.nodeType || candidate.tagName).toUpperCase()
  if (candidate.source === 'figma' && ['INSTANCE', 'COMPONENT'].includes(type) && Array.isArray(candidate.interactionEvidence) && candidate.interactionEvidence.includes('isInteractiveCandidate')) score += 80
  if (candidate.source === 'figma' && type === 'FRAME') score += 40
  if (candidate.sourceKind === 'figma-text') score -= 40
  if (candidate.sourceKind === 'web-cta-hint') score += 10
  return score
}

function createCanonicalNumericEntities(rawCandidates, sections, heroSections, quality) {
  const canonical = []

  rawCandidates.forEach((candidate) => {
    const section = resolveSectionForCandidate(candidate, sections)
    const normalized = {
      ...candidate,
      sectionId: section?.sectionId || '',
      sectionRootId: section?.sectionId || '',
      sectionPath: section?.path || '',
      isHeroNumeric: section?.sectionId === heroSections.figmaSectionId || section?.sectionId === heroSections.webSectionId,
    }
    const existing = canonical.find((entity) => isSameCanonicalNumeric(entity, normalized))
    if (!existing) {
      canonical.push(createCanonicalNumericEntity(normalized))
      return
    }
    existing.sources.push(buildSourceEvidence(normalized))
    existing.sources = dedupeSourceEvidence(existing.sources)
    existing.reasons = uniqueStrings([...existing.reasons, ...(normalized.reasons || [])])
    if (getNumericRepresentativeScore(normalized) > getNumericRepresentativeScore(existing)) {
      existing.text = normalized.text
      existing.displayText = normalized.displayText
      existing.fullContextText = normalized.fullContextText
      existing.numericTokens = normalized.numericTokens
      existing.unitTokens = normalized.unitTokens
      existing.context = normalized.context
      existing.yRatio = normalized.yRatio
    }
    quality.duplicateNumericMergedCount += 1
  })

  quality.canonicalNumericCount = canonical.length
  return canonical
}

function createCanonicalNumericEntity(candidate) {
  return {
    entityId: `numeric:${candidate.source}:${candidate.sourceId || normalizeComparableText(candidate.text)}`,
    type: candidate.type,
    numericType: candidate.numericType,
    source: candidate.source,
    text: candidate.text,
    displayText: candidate.displayText,
    fullContextText: candidate.fullContextText,
    numericTokens: candidate.numericTokens,
    unitTokens: candidate.unitTokens,
    context: candidate.context,
    sectionId: candidate.sectionId || '',
    sectionRootId: candidate.sectionRootId || '',
    sectionPath: candidate.sectionPath || '',
    confidence: candidate.confidence,
    reasons: uniqueStrings(candidate.reasons || []),
    yRatio: candidate.yRatio,
    sources: [buildSourceEvidence(candidate)],
  }
}

function isSameCanonicalNumeric(entity, candidate) {
  return entity.source === candidate.source
    && entity.numericType === candidate.numericType
    && normalizeComparableText(entity.displayText) === normalizeComparableText(candidate.displayText)
    && normalizeComparableSectionPath(entity.sectionPath) === normalizeComparableSectionPath(candidate.sectionPath)
    && JSON.stringify(entity.numericTokens) === JSON.stringify(candidate.numericTokens)
    && JSON.stringify(entity.unitTokens) === JSON.stringify(candidate.unitTokens)
    && hasSimilarPosition(entity.yRatio, candidate.yRatio)
}

function getNumericRepresentativeScore(candidate) {
  let score = getCandidateScore(candidate)
  const searchable = `${candidate.selector || ''} ${candidate.context || ''}`.toLowerCase()
  if (/active|current/.test(searchable)) score += 20
  if (/duplicate/.test(searchable)) score -= 40
  if ((candidate.fullContextText || '').length < 60) score += 10
  return score
}

function createCanonicalMediaEntities(rawMedia, sections, heroSections) {
  const canonical = []
  rawMedia.forEach((candidate) => {
    const section = resolveSectionForCandidate(candidate, sections)
    const normalized = {
      ...candidate,
      sectionId: section?.sectionId || '',
      sectionRootId: section?.sectionId || '',
      sectionPath: section?.path || '',
    }
    const existing = canonical.find((entity) => isSameCanonicalMedia(entity, normalized))
    if (!existing) {
      canonical.push({
        entityId: `media:${normalized.source}:${normalized.sourceId || normalized.selector || normalized.layerPath}`,
        entityType: 'media',
        type: normalized.type,
        mediaType: normalized.type,
        source: normalized.source,
        text: normalized.text,
        sectionId: normalized.sectionId,
        sectionRootId: normalized.sectionRootId,
        sectionPath: normalized.sectionPath,
        confidence: normalized.confidence,
        reasons: uniqueStrings(normalized.reasons || []),
        xRatio: normalized.xRatio,
        yRatio: normalized.yRatio,
        widthRatio: normalized.widthRatio,
        heightRatio: normalized.heightRatio,
        width: normalized.width,
        height: normalized.height,
        role: classifyHeroMediaRole(normalized),
        sources: [buildSourceEvidence(normalized)],
        isHeroPrimary: normalized.sectionId === heroSections.figmaSectionId || normalized.sectionId === heroSections.webSectionId,
      })
      return
    }
    existing.sources.push(buildSourceEvidence(normalized))
    existing.sources = dedupeSourceEvidence(existing.sources)
  })
  return canonical
}

function isSameCanonicalMedia(entity, candidate) {
  return entity.source === candidate.source
    && entity.mediaType === candidate.type
    && (normalizeString(entity.sectionPath) === normalizeString(candidate.sectionPath))
    && (normalizeString(entity.text) === normalizeString(candidate.text) || normalizeString(entity.entityId).endsWith(normalizeString(candidate.sourceId)))
}

function resolveSectionForCandidate(candidate, sections) {
  const source = candidate?.source
  const path = source === 'figma'
    ? getFigmaSectionPath(candidate.layerPath || candidate.context || candidate.parentContext)
    : getWebSectionPath(candidate.parentContext || candidate.context || candidate.selector || candidate.layerPath, candidate.section)
  return sections.find((section) => section.source === source && section.path === path)
    || sections.find((section) => section.source === source && normalizeComparableSectionPath(section.path) === normalizeComparableSectionPath(path))
    || sections.find((section) => section.source === source && section.role === candidate.section)
    || null
}

function normalizeSelector(value) {
  return normalizeString(value).replace(/:nth-of-type\(\d+\)/g, '')
}

function normalizeComparableSectionPath(value) {
  const normalized = normalizeString(value).toLowerCase().split(/\s+/)[0].replace(/[#.]/g, '')
  return normalized.endsWith('s') ? normalized.slice(0, -1) : normalized
}

function isCtaRole(role) {
  return role === 'primary-action' || role === 'secondary-action'
}

function dedupeCanonicalEntities(items) {
  const seen = new Set()
  return items.filter((item) => {
    if (seen.has(item.entityId)) return false
    seen.add(item.entityId)
    return true
  })
}

function dedupeRawInteractionCandidates(candidates, quality) {
  const selected = []
  ;(Array.isArray(candidates) ? candidates : []).forEach((candidate) => {
    const index = selected.findIndex((existing) => isSameRawInteractionCandidate(existing, candidate))
    if (index === -1) {
      selected.push(candidate)
      return
    }
    quality.candidateDeduplicatedCount += 1
    selected[index] = choosePreferredCandidate(selected[index], candidate)
  })
  return selected
}

function isSameRawInteractionCandidate(first, second) {
  if (!first || !second) return false
  if (first.source !== second.source) return false
  if (first.sourceKind !== second.sourceKind) return false
  if (first.sourceId && second.sourceId && first.sourceId === second.sourceId) return true
  return normalizeSelector(first.selector) === normalizeSelector(second.selector)
    && normalizeComparableText(first.text) === normalizeComparableText(second.text)
    && normalizeString(first.href) === normalizeString(second.href)
}

function minDefined(first, second) {
  if (!Number.isFinite(first)) return Number.isFinite(second) ? second : null
  if (!Number.isFinite(second)) return first
  return Math.min(first, second)
}

function maxDefined(first, second) {
  if (!Number.isFinite(first)) return Number.isFinite(second) ? second : null
  if (!Number.isFinite(second)) return first
  return Math.max(first, second)
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
        sourceKind: 'figma-text',
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
        sourceKind: 'web-text',
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
    sourceKind: normalizeString(item?.sourceKind) || (fallbackType === 'interactive' ? 'web-cta-hint' : `web-${fallbackType}-hint`),
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

function isSemanticFigmaInteractiveNode(node, childMap, flatNodes, quality) {
  if (!node?.effectivelyVisible) return false
  const type = normalizeString(node?.type)
  if (!['FRAME', 'INSTANCE', 'COMPONENT'].includes(type)) return false
  const searchable = `${node?.name || ''} ${node?.layerPath || ''}`.toLowerCase()
  const descendantTexts = getFigmaDescendantTexts(node, flatNodes)
  const compactActionLabel = descendantTexts.length > 0 && descendantTexts.every(isCompactActionLabel)
  const hasInteraction = node?.isInteractiveCandidate === true
  const looksButtonLike = /button|btn|cta|action|link/.test(searchable)
  const hasButtonStructure = looksButtonLike && compactActionLabel && (node?.hasSolidFill || Number(node?.cornerRadius) > 0 || Array.isArray(node?.strokes) && node.strokes.length > 0)
  if (!hasInteraction && !hasButtonStructure) return false
  if (shouldRejectFigmaActionNode(node, descendantTexts, childMap)) {
    if (quality) quality.oversizedFigmaActionRejectedCount += 1
    return false
  }
  return compactActionLabel || hasInteraction
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

  const descendantTexts = getFigmaDescendantTexts(node, flatNodes)

  return truncateText(uniqueStrings(descendantTexts).join(' ').trim(), 160)
}

function getFigmaDescendantTexts(node, flatNodes) {
  const layerPath = normalizeString(node?.layerPath)
  return (Array.isArray(flatNodes) ? flatNodes : [])
    .filter((child) => child?.effectivelyVisible && child?.type === 'TEXT')
    .filter((child) => normalizeString(child?.parentId) === normalizeString(node?.id) || normalizeString(child?.layerPath).startsWith(`${layerPath} /`))
    .map((child) => normalizeString(child?.characters))
    .filter(Boolean)
}

function shouldRejectFigmaActionNode(node, descendantTexts, childMap) {
  const widthRatio = Number(node?.widthRatio) || 0
  const heightRatio = Number(node?.heightRatio) || 0
  const width = Number(node?.absoluteBoundingBox?.width) || 0
  const height = Number(node?.absoluteBoundingBox?.height) || 0
  const children = childMap.get(normalizeString(node?.id)) || []
  const searchable = `${node?.name || ''} ${node?.layerPath || ''} ${node?.parentName || ''}`.toLowerCase()
  const longTextCount = descendantTexts.filter((text) => !isCompactActionLabel(text)).length
  const sentenceLikeCount = descendantTexts.filter((text) => /[.!?]|\s{2,}|[,;:]|다$|요$/.test(text) || text.length > 28).length
  const hasMixedContent = children.some((child) => child?.hasImageFill || child?.hasVideoLikeContent) && descendantTexts.length > 0
  const isLarge = widthRatio > 0.35 || heightRatio > 0.05 || width >= 640 || height >= 120
  const isRootLargeSection = !normalizeString(node?.parentId) && (widthRatio > 0.35 || heightRatio > 0.12 || children.length >= 3)
  const isSectionLike = children.length >= 4 || descendantTexts.length >= 3 || hasMixedContent
  const isFooterOrNavigation = /footer|nav|navigation|header|menu|legal/.test(searchable)
  const isHeadingGroup = /title|heading|hero\s*title/.test(searchable) && descendantTexts.length > 0
  if (isFooterOrNavigation) return true
  if (isRootLargeSection) return true
  if (isLarge && isSectionLike) return true
  if (longTextCount > 0 || sentenceLikeCount > 0) return true
  if (isHeadingGroup) return true
  return false
}

function isCompactActionLabel(value) {
  const text = normalizeTextForExactDisplayComparison(value)
  if (!text || text.length > 24) return false
  if (/[.!?]/.test(text)) return false
  if (/\b(and|및)\b/.test(text) && text.length > 14) return false
  return true
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
