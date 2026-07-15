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
const SIMILAR_Y_RATIO_THRESHOLD = 0.03
const SIMILAR_X_RATIO_THRESHOLD = 0.08
const PRICE_TYPE_SET = new Set(['amount', 'percentage', 'interest-rate', 'monthly-payment', 'duration'])

export function createVisualQaPayload(input) {
  return buildVisualQaPayloadArtifacts({ ...(input || {}), collectDebugArtifacts: false }).payload
}

export function buildVisualQaPayloadArtifacts({ figmaAnalysis, webAnalysis, textComparison, collectDebugArtifacts = true }) {
  const safeFigmaAnalysis = figmaAnalysis && typeof figmaAnalysis === 'object' ? figmaAnalysis : {}
  const safeWebAnalysis = webAnalysis && typeof webAnalysis === 'object' ? webAnalysis : {}
  const safeTextComparison = textComparison && typeof textComparison === 'object' ? textComparison : {}
  const includeDebugArtifacts = collectDebugArtifacts === true
  const quality = createPayloadQuality({ includeDebugArtifacts })

  const figmaTextCandidates = normalizeFigmaTextCandidates(safeFigmaAnalysis.textNodes)
  const webTextCandidates = normalizeWebTextCandidates(safeWebAnalysis.textNodes)
  const filteredDifferences = createComparisonSummaries(safeTextComparison, quality, { figmaTextCandidates, webTextCandidates })
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
  const sectionContexts = createSectionContexts({
    figmaAnalysis: safeFigmaAnalysis,
    figmaTextCandidates,
  })
  const heroSelection = selectHeroRoots({
    figmaTextCandidates,
    webTextCandidates,
    rawActions: rawInteractions.allCandidates,
    rawImages,
    rawVideos,
    sectionContexts,
  })
  const heroSections = heroSelection.heroSections
  const annotatedFigmaTextCandidates = annotateCandidatesWithSections(figmaTextCandidates, sectionContexts, heroSelection)
  const annotatedWebTextCandidates = annotateCandidatesWithSections(webTextCandidates, sectionContexts, heroSelection)
  const annotatedRawActions = annotateCandidatesWithSections(rawInteractions.allCandidates, sectionContexts, heroSelection)
  const annotatedRawNumericCandidates = annotateCandidatesWithSections(rawNumericCandidates, sectionContexts, heroSelection)
  const annotatedRawImages = annotateCandidatesWithSections(rawImages, sectionContexts, heroSelection)
  const annotatedRawVideos = annotateCandidatesWithSections(rawVideos, sectionContexts, heroSelection)
  quality.rawFigmaActionCandidateCount = annotatedRawActions.filter((candidate) => candidate?.source === 'figma').length
  quality.rawFigmaHeroActionCandidateCount = annotatedRawActions.filter((candidate) => candidate?.source === 'figma' && candidate?.sectionDescriptor?.sectionId === heroSections.figmaSectionId).length
  quality.rawWebHeroMediaCandidateCount = annotatedRawVideos.filter((candidate) => candidate?.source === 'web' && isCandidateWithinSectionDescriptor(candidate, heroSelection?.webHeroDescriptor)).length
  const draftSections = createSectionEntities({
    candidates: [
      ...annotatedFigmaTextCandidates,
      ...annotatedWebTextCandidates,
      ...annotatedRawActions,
      ...annotatedRawNumericCandidates,
      ...annotatedRawImages,
      ...annotatedRawVideos,
    ],
  })
  quality.heroSectionDetected = Boolean(heroSections.figmaSectionId || heroSections.webSectionId)
  const interactions = createInteractionHints({
    rawInteractions: {
      ...rawInteractions,
      allCandidates: annotatedRawActions,
      dedupedCandidates: annotatedRawActions,
    },
    sections: draftSections,
    heroSections,
  }, quality)
  const numericHints = createNumericHints({ rawNumericCandidates: annotatedRawNumericCandidates, sections: draftSections, heroSections }, quality)
  const mediaHints = createCanonicalMediaHints({ images: annotatedRawImages, videos: annotatedRawVideos, sections: draftSections, heroSections, quality })
  const textHints = createCanonicalTextHints({ textCandidates: [...annotatedFigmaTextCandidates, ...annotatedWebTextCandidates] })
  const resolvedCanonicalEvidence = remapCanonicalEvidenceToSelectedHeroes({
    actions: interactions.allActions,
    numericValues: numericHints.numericEntities,
    media: mediaHints.media,
    texts: textHints.texts,
    heroSelection,
  })
  const canonicalEvidence = createCanonicalEvidence({
    actions: dedupeFinalCanonicalActions(resolvedCanonicalEvidence.actions, safeWebAnalysis.url),
    numericValues: dedupeFinalCanonicalNumericValues(resolvedCanonicalEvidence.numericValues),
    media: resolvedCanonicalEvidence.media,
    texts: resolvedCanonicalEvidence.texts,
    sections: pruneFinalSectionEntities(finalizeSectionEntities(draftSections, {
      actions: resolvedCanonicalEvidence.actions,
      numericValues: resolvedCanonicalEvidence.numericValues,
      media: resolvedCanonicalEvidence.media,
      texts: resolvedCanonicalEvidence.texts,
    }, heroSections)),
  })
  const ctaButtons = createCanonicalCtaButtons(canonicalEvidence.actions)
  const comparisonNumericValues = createComparisonNumericValues(canonicalEvidence.numericValues)
  const comparisonPrices = comparisonNumericValues.filter((item) => PRICE_TYPE_SET.has(item.numericType)).slice(0, MAX_PRICE_CANDIDATES)
  const comparisonDates = comparisonNumericValues.filter((item) => item.numericType === 'date').slice(0, MAX_PRICE_CANDIDATES)
  const comparisonMedia = createComparisonMedia(canonicalEvidence.media)
  const heroMediaGroup = createHeroMediaGroup({ media: canonicalEvidence.media, heroSections }, quality)
  const heroCtaGroup = createHeroCtaGroup(canonicalEvidence.actions, heroSections, quality)
  const comparisonDifferences = enrichComparisonDifferencesWithCanonicalEvidence(filteredDifferences, canonicalEvidence)
  const heroSection = createHeroSectionHint({
    sections: canonicalEvidence.sections,
    heroSections,
    filteredDifferences: comparisonDifferences,
    ctaButtons,
    heroMediaGroup,
    texts: canonicalEvidence.texts,
    actions: canonicalEvidence.actions,
  })
  const navigation = createNavigationHint({ sections: canonicalEvidence.sections, actions: canonicalEvidence.actions, filteredDifferences: comparisonDifferences })
  const evidenceSummary = createEvidenceSummary({
    heroSection,
    heroMediaGroup,
    heroCtaGroup,
    navigation,
    sections: canonicalEvidence.sections,
    media: canonicalEvidence.media,
    prices: comparisonPrices,
    dates: comparisonDates,
    filteredDifferences: comparisonDifferences,
    canonicalEvidence,
  })
  const sectionTrace = includeDebugArtifacts ? createSectionTrace({ sections: canonicalEvidence.sections, heroSections, canonicalEvidence }) : null
  const figmaActionInputTrace = includeDebugArtifacts ? createFigmaActionInputTrace({
    figmaAnalysis: safeFigmaAnalysis,
    heroSelection,
    rawFigmaActions: rawInteractions.allCandidates.filter((candidate) => candidate?.source === 'figma'),
  }) : null
  const webVideoPipelineTrace = includeDebugArtifacts ? createWebVideoPipelineTrace({
    webAnalysis: safeWebAnalysis,
    rawVideos,
    annotatedRawVideos,
    canonicalEvidence: resolvedCanonicalEvidence,
  }) : null
  const entitySectionTrace = includeDebugArtifacts ? createEntitySectionTrace({
    rawActions: rawInteractions.allCandidates,
    annotatedRawActions,
    annotatedRawVideos,
    heroSelection,
    sectionContexts,
    canonicalEvidence,
  }) : null
  const heroActionResolution = includeDebugArtifacts ? createHeroActionResolutionTrace({
    heroSections,
    rawActions: rawInteractions.allCandidates,
    canonicalActions: canonicalEvidence.actions,
    heroCtaGroup,
  }) : null
  const heroMediaResolution = includeDebugArtifacts ? createHeroMediaResolutionTrace({
    heroSections,
    rawVideos,
    canonicalMedia: canonicalEvidence.media,
    heroMediaGroup,
  }) : null
  const canonicalMergeTrace = includeDebugArtifacts ? createCanonicalMergeTrace(quality) : null
  const actionPipelineTrace = includeDebugArtifacts ? createActionPipelineTrace(heroActionResolution) : null
  const figmaActionTrace = includeDebugArtifacts ? createFigmaActionTrace(figmaActionInputTrace) : null
  const ctaMergeTrace = includeDebugArtifacts ? createCtaMergeTrace(canonicalMergeTrace) : null
  const numericMergeTrace = includeDebugArtifacts ? createNumericMergeTrace(canonicalMergeTrace) : null
  applyCanonicalQualityMetrics(quality, {
    heroCtaGroup,
    heroMediaGroup,
    canonicalEvidence,
    comparisonActions: ctaButtons,
    comparisonPrices,
    comparisonMedia,
    sectionTrace,
    sections: canonicalEvidence.sections,
    heroSelection,
    entitySectionTrace,
    figmaActionInputTrace,
    heroActionResolution,
    heroMediaResolution,
    canonicalMergeTrace,
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
      differenceCount: comparisonDifferences.length,
      figmaOnlyCount: normalizeCount(safeTextComparison.summary?.figmaOnlyCount, 0),
      webOnlyCount: normalizeCount(safeTextComparison.summary?.webOnlyCount, 0),
      differences: comparisonDifferences,
    },
    aiHints: {
      canonicalEvidence: {
        actions: canonicalEvidence.actions,
        numericValues: canonicalEvidence.numericValues,
        media: canonicalEvidence.media,
        texts: canonicalEvidence.texts,
        sections: canonicalEvidence.sections,
      },
      comparisonEvidence: {
        actions: ctaButtons,
        numericValues: comparisonNumericValues,
        media: comparisonMedia,
      },
      heroSection,
      heroMediaGroup,
      heroCtaGroup,
      navigation,
      interactions,
      ctaButtons,
      prices: comparisonPrices,
      dates: comparisonDates,
      numericEntities: canonicalEvidence.numericValues,
      videos: comparisonMedia.filter((item) => item.mediaType === 'video').slice(0, MAX_VIDEO_CANDIDATES),
      images: comparisonMedia.filter((item) => item.mediaType === 'image').slice(0, MAX_IMAGE_CANDIDATES),
      evidenceSummary,
    },
  }

  const debugArtifacts = includeDebugArtifacts
    ? {
        sectionTrace,
        heroCandidateTrace: heroSelection.heroCandidateTrace,
        figmaActionInputTrace,
        webVideoPipelineTrace,
        entitySectionTrace,
        webVideoTrace: entitySectionTrace.webVideoTrace,
        heroActionResolution,
        heroMediaResolution,
        canonicalMergeTrace,
        actionPipelineTrace,
        figmaActionTrace,
        ctaMergeTrace,
        numericMergeTrace,
      }
    : null

  return { payload, payloadQuality: quality, debugArtifacts }
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

function createPayloadQuality({ includeDebugArtifacts = true } = {}) {
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
    figmaHeroTextCount: 0,
    webHeroTextCount: 0,
    figmaHeroActionCount: 0,
    webHeroActionCount: 0,
    figmaHeroMediaCount: 0,
    webHeroMediaCount: 0,
    figmaHeroCandidateCount: 0,
    webHeroCandidateCount: 0,
    figmaHeroRootPromotedCount: 0,
    webHeroRootPromotedCount: 0,
    figmaHeroContainsText: false,
    figmaHeroContainsAction: false,
    figmaHeroContainsMedia: false,
    webHeroContainsText: false,
    webHeroContainsAction: false,
    webHeroContainsMedia: false,
    figmaHeroDescendantNodeCount: 0,
    figmaButtonLikeNodeCount: 0,
    figmaInteractiveNodeCount: 0,
    rawFigmaActionCandidateCount: 0,
    canonicalFigmaActionCount: 0,
    rawFigmaHeroActionCandidateCount: 0,
    resolvedFigmaHeroActionCount: 0,
    rejectedFigmaHeroActionCount: 0,
    rawWebHeroMediaCandidateCount: 0,
    resolvedWebHeroMediaCount: 0,
    webSelectorSignatureMergedCount: 0,
    duplicateHeroActionMergedCount: 0,
    duplicateHeroNumericMergedCount: 0,
    unassignedCanonicalEntityCount: 0,
    multiAssignedCanonicalEntityCount: 0,
    comparisonActionCount: 0,
    referenceOnlyActionCount: 0,
    canonicalCountConsistencyPassed: false,
    sourceHeroCountConsistencyPassed: false,
    heroActionResolutionPassed: false,
    heroMediaResolutionPassed: false,
    figmaActionPipelineConsistencyPassed: false,
    webVideoPipelineConsistencyPassed: false,
    canonicalAiHintsOnlyPassed: false,
    duplicateActionEliminationPassed: false,
    duplicateNumericEliminationPassed: false,
    warnings: [],
  }

  Object.defineProperty(quality, '__tracker', {
    value: {
      offscreen: new Set(),
      parentCta: new Set(),
    },
    enumerable: false,
  })

  if (includeDebugArtifacts) {
    Object.defineProperty(quality, '__trace', {
      value: {
        actionMergePairs: [],
        numericMergePairs: [],
      },
      enumerable: false,
    })
  }

  return quality
}

function createComparisonSummaries(textComparison, quality, { figmaTextCandidates = [], webTextCandidates = [] } = {}) {
  return limitItems(Array.isArray(textComparison.differences) ? textComparison.differences : [], MAX_DIFFERENCES * 3)
    .map((difference, originalIndex) => ({ difference, originalIndex }))
    .filter((difference) => {
      const figmaText = normalizeString(difference?.difference?.figmaText)
      const webText = normalizeString(difference?.difference?.webText)
      if (!figmaText || !webText) return true
      const normalizedFigma = normalizeTextForExactDisplayComparison(figmaText)
      const normalizedWeb = normalizeTextForExactDisplayComparison(webText)
      if (normalizedFigma === normalizedWeb) {
        quality.invisibleCharacterDiffRemovedCount += 1
        return false
      }
      return true
    })
    .map(({ difference, originalIndex }) => createComparisonSummary(difference, originalIndex, { figmaTextCandidates, webTextCandidates }))
    .slice(0, MAX_DIFFERENCES)
}

function createComparisonSummary(difference = {}, originalIndex, { figmaTextCandidates = [], webTextCandidates = [] } = {}) {
  const figmaEntity = findFigmaDifferenceEntity(difference, figmaTextCandidates)
  const webEntity = findWebDifferenceEntity(difference, webTextCandidates)
  const figmaSpatialEvidence = createSpatialEvidence(figmaEntity || difference.figmaNode || difference.figmaElement || difference.figma || {})
  const webSpatialEvidence = createSpatialEvidence(webEntity || difference.webElement || difference.webNode || difference.web || {})
  const spatialEvidence = chooseRepresentativeSpatialEvidence(figmaSpatialEvidence, webSpatialEvidence)
  const sourceIds = uniqueStrings([
    normalizeString(difference?.figmaNodeId || figmaEntity?.sourceId),
    normalizeString(difference?.webSelector || webEntity?.selector || webEntity?.sourceId),
  ])
  return {
    text: truncateText(difference?.figmaText || difference?.webText || difference?.text || '', 120),
    figmaText: truncateText(difference?.figmaText || '', 140),
    webText: truncateText(difference?.webText || '', 140),
    confidence: normalizeConfidence(difference?.matchConfidence || difference?.confidence),
    status: classifyDifferenceStatus(difference),
    reasons: limitItems(Array.isArray(difference?.evidence) ? difference.evidence : [], 4).map((item) => truncateText(item, 120)),
    figmaNodeId: normalizeString(difference?.figmaNodeId || figmaEntity?.sourceId),
    webSelector: normalizeString(difference?.webSelector || webEntity?.selector),
    sourceEntityIds: sourceIds,
    originalIndex,
    order: originalIndex,
    sectionId: spatialEvidence?.sectionId || '',
    sectionRootId: spatialEvidence?.sectionRootId || '',
    sectionPath: spatialEvidence?.sectionPath || '',
    xRatio: spatialEvidence?.xRatio ?? null,
    yRatio: spatialEvidence?.yRatio ?? null,
    widthRatio: spatialEvidence?.widthRatio ?? null,
    heightRatio: spatialEvidence?.heightRatio ?? null,
    spatialEvidence,
    figmaSpatialEvidence,
    webSpatialEvidence,
  }
}

function findFigmaDifferenceEntity(difference = {}, figmaTextCandidates = []) {
  const nodeId = normalizeString(difference.figmaNodeId)
  if (nodeId) {
    const byId = figmaTextCandidates.find((item) => normalizeString(item?.sourceId) === nodeId || normalizeString(item?.id) === nodeId)
    if (byId) return byId
  }
  return findTextEntityByValue(figmaTextCandidates, difference.figmaText || difference.text)
}

function findWebDifferenceEntity(difference = {}, webTextCandidates = []) {
  const selector = normalizeString(difference.webSelector)
  if (selector) {
    const bySelector = webTextCandidates.find((item) => normalizeString(item?.selector) === selector || normalizeString(item?.sourceId) === selector)
    if (bySelector) return bySelector
  }
  return findTextEntityByValue(webTextCandidates, difference.webText)
}

function findTextEntityByValue(candidates = [], value) {
  const target = normalizeComparableText(value)
  if (!target) return null
  return candidates.find((item) => normalizeComparableText(item?.text || item?.displayText) === target)
    || candidates.find((item) => {
      const text = normalizeComparableText(item?.text || item?.displayText)
      return text && (text.includes(target) || target.includes(text))
    })
    || null
}

function createSectionContexts({ figmaAnalysis, figmaTextCandidates }) {
  const flatNodes = Array.isArray(figmaAnalysis?.flatNodes) ? figmaAnalysis.flatNodes : []
  const indexes = buildFigmaNodeIndexes(flatNodes)

  return {
    figma: {
      flatNodes,
      ...indexes,
      totalTextCount: Array.isArray(figmaTextCandidates) ? figmaTextCandidates.length : 0,
    },
  }
}

function buildFigmaNodeIndexes(flatNodes) {
  const nodeById = new Map()
  const nodeByPath = new Map()
  const childrenByParentId = new Map()
  const parentChainByNodeId = new Map()

  ;(Array.isArray(flatNodes) ? flatNodes : []).forEach((node) => {
    const nodeId = normalizeString(node?.nodeId || node?.id)
    const path = normalizeString(node?.layerPath)
    if (nodeId) nodeById.set(nodeId, node)
    if (path && !nodeByPath.has(path)) nodeByPath.set(path, node)
    const parentId = normalizeString(node?.parentId)
    if (!parentId) return
    const siblings = childrenByParentId.get(parentId) || []
    siblings.push(node)
    childrenByParentId.set(parentId, siblings)
  })

  nodeById.forEach((node, nodeId) => {
    const chain = []
    let currentParentId = normalizeString(node?.parentId)
    const visited = new Set([nodeId])
    while (currentParentId && !visited.has(currentParentId)) {
      visited.add(currentParentId)
      chain.push(currentParentId)
      const parentNode = nodeById.get(currentParentId)
      currentParentId = normalizeString(parentNode?.parentId)
    }
    parentChainByNodeId.set(nodeId, chain)
  })

  return {
    nodeById,
    nodeByPath,
    childMap: childrenByParentId,
    childrenByParentId,
    parentChainByNodeId,
  }
}

function annotateCandidatesWithSections(candidates, sectionContexts, heroSelection) {
  return (Array.isArray(candidates) ? candidates : []).map((candidate) => ({
    ...candidate,
    sectionDescriptor: createSectionDescriptorForCandidate(candidate, sectionContexts, heroSelection),
  }))
}

function selectHeroRoots({ figmaTextCandidates, webTextCandidates, rawActions, rawImages, rawVideos, sectionContexts }) {
  const figmaSelection = selectHeroRootForSource({
    source: 'figma',
    textCandidates: figmaTextCandidates,
    actionCandidates: (Array.isArray(rawActions) ? rawActions : []).filter((item) => item?.source === 'figma'),
    mediaCandidates: [...(Array.isArray(rawImages) ? rawImages : []).filter((item) => item?.source === 'figma'), ...(Array.isArray(rawVideos) ? rawVideos : []).filter((item) => item?.source === 'figma')],
    figmaContext: sectionContexts?.figma,
  })
  const webSelection = selectHeroRootForSource({
    source: 'web',
    textCandidates: webTextCandidates,
    actionCandidates: (Array.isArray(rawActions) ? rawActions : []).filter((item) => item?.source === 'web'),
    mediaCandidates: [...(Array.isArray(rawImages) ? rawImages : []).filter((item) => item?.source === 'web'), ...(Array.isArray(rawVideos) ? rawVideos : []).filter((item) => item?.source === 'web')],
  })

  return {
    figmaHeroDescriptor: figmaSelection.descriptor,
    webHeroDescriptor: webSelection.descriptor,
    heroSections: {
      figmaSectionId: figmaSelection.descriptor?.sectionId || '',
      webSectionId: webSelection.descriptor?.sectionId || '',
    },
    heroCandidateTrace: {
      figma: figmaSelection.trace,
      web: webSelection.trace,
    },
    quality: {
      figmaHeroCandidateCount: figmaSelection.candidateCount,
      webHeroCandidateCount: webSelection.candidateCount,
      figmaHeroRootPromotedCount: figmaSelection.promoted ? 1 : 0,
      webHeroRootPromotedCount: webSelection.promoted ? 1 : 0,
      figmaHeroContainsText: figmaSelection.containsText,
      figmaHeroContainsAction: figmaSelection.containsAction,
      figmaHeroContainsMedia: figmaSelection.containsMedia,
      webHeroContainsText: webSelection.containsText,
      webHeroContainsAction: webSelection.containsAction,
      webHeroContainsMedia: webSelection.containsMedia,
    },
  }
}

function selectHeroRootForSource({ source, textCandidates, actionCandidates, mediaCandidates, figmaContext }) {
  const topTextCandidates = (Array.isArray(textCandidates) ? textCandidates : []).filter((candidate) => isTopHeroTextCandidate(candidate)).sort(compareHeroSignalCandidates).slice(0, 8)
  const topActionCandidates = (Array.isArray(actionCandidates) ? actionCandidates : []).filter((candidate) => isTopHeroActionCandidate(candidate)).sort(compareHeroSignalCandidates).slice(0, 8)
  const topMediaCandidates = (Array.isArray(mediaCandidates) ? mediaCandidates : []).filter((candidate) => isTopHeroMediaCandidate(candidate)).sort(compareHeroSignalCandidates).slice(0, 8)
  const heroSignals = [
    ...topTextCandidates.map((candidate) => ({ kind: 'text', candidate })),
    ...topActionCandidates.map((candidate) => ({ kind: 'action', candidate })),
    ...topMediaCandidates.map((candidate) => ({ kind: 'media', candidate })),
  ]
  const anchorCandidates = buildHeroAnchorCandidates({ source, heroSignals, figmaContext })
  const scoredCandidates = anchorCandidates
    .map((anchor) => scoreHeroAnchorCandidate({ source, anchor, heroSignals, figmaContext }))
    .sort(compareHeroAnchorScores)

  const selected = scoredCandidates.find((candidate) => candidate.isValid) || scoredCandidates[0] || null
  const descriptor = selected ? createSectionDescriptorFromHeroAnchor({ source, anchor: selected, figmaContext }) : null
  const leafLikeSelected = selected ? selected.leafLike : false
  const trace = scoredCandidates.slice(0, 10).map((candidate) => ({
    sourceId: candidate.rootSourceId,
    path: candidate.path,
    nodeType: candidate.nodeType,
    childCount: candidate.childCount,
    containsText: candidate.containsText,
    containsAction: candidate.containsAction,
    containsMedia: candidate.containsMedia,
    score: candidate.score,
    rejectedReasons: candidate.rejectedReasons,
    selected: descriptor ? candidate.path === descriptor.path && candidate.rootSourceId === descriptor.rootSourceId : false,
  }))

  return {
    descriptor,
    trace,
    candidateCount: scoredCandidates.length,
    promoted: Boolean(selected && (leafLikeSelected || heroSignals.some(({ candidate }) => {
      const directPath = getCandidateDirectAnchorPath(candidate, source)
      return directPath && directPath !== selected.path && isCandidateUnderAnchor(candidate, source, selected.path)
    }))),
    containsText: Boolean(selected?.containsText),
    containsAction: Boolean(selected?.containsAction),
    containsMedia: Boolean(selected?.containsMedia),
  }
}

function buildHeroAnchorCandidates({ source, heroSignals, figmaContext }) {
  const candidateMap = new Map()
  heroSignals.forEach(({ candidate }) => {
    const anchors = source === 'figma'
      ? buildFigmaAnchorCandidates(candidate?.layerPath || candidate?.context || candidate?.parentContext, candidate, figmaContext)
      : buildWebAnchorCandidates(candidate)
    anchors.forEach((anchor) => {
      const path = normalizeString(anchor?.path)
      if (!path) return
      const rootSourceId = source === 'figma'
        ? normalizeString(anchor?.node?.nodeId || anchor?.node?.id || path)
        : path
      const key = `${rootSourceId}:${path}`
      if (candidateMap.has(key)) return
      candidateMap.set(key, {
        path,
        rootSourceId,
        node: anchor?.node || null,
      })
    })
  })
  return Array.from(candidateMap.values())
}

function scoreHeroAnchorCandidate({ source, anchor, heroSignals, figmaContext }) {
  const matchedSignals = heroSignals.filter(({ candidate }) => isCandidateUnderAnchor(candidate, source, anchor.path))
  const containsText = matchedSignals.some((item) => item.kind === 'text')
  const containsAction = matchedSignals.some((item) => item.kind === 'action')
  const containsMedia = matchedSignals.some((item) => item.kind === 'media')
  const featureKindCount = [containsText, containsAction, containsMedia].filter(Boolean).length
  const layoutLike = isLayoutLikeHeroAnchor(anchor, source, figmaContext)
  const childCount = source === 'figma'
    ? countFigmaAnchorChildren(anchor.node, figmaContext)
    : estimateWebAnchorChildCount(anchor.path, matchedSignals)
  const nodeType = source === 'figma'
    ? normalizeString(anchor.node?.type || 'CONTAINER')
    : inferWebAnchorNodeType(anchor.path)
  const rejectedReasons = []

  if (isInvalidHeroRootAnchor(anchor, source, { childCount, containsText, containsAction, containsMedia, layoutLike, nodeType, figmaContext })) {
    rejectedReasons.push('leaf-or-narrow-wrapper')
  }
  if (isPageRootAnchor(anchor, source, figmaContext)) rejectedReasons.push('page-root')
  if (isNavigationOrFooterAnchor(anchor, source)) rejectedReasons.push('navigation-or-footer')
  if (featureKindCount < 2 && !layoutLike) rejectedReasons.push('insufficient-signal-types')

  let score = 0
  score += featureKindCount * 120
  score += containsMedia ? 40 : 0
  score += containsText ? 30 : 0
  score += containsAction ? 25 : 0
  score += layoutLike ? 35 : 0
  score += Math.min(matchedSignals.length, 6) * 8
  score += scoreHeroAnchorSemantics(anchor.path)
  score += source === 'figma' ? scoreFigmaHeroAnchorGeometry(anchor.node) : scoreWebHeroAnchorGeometry(matchedSignals)
  score += getHeroAnchorDepth(anchor.path, source) * 3
  if (rejectedReasons.includes('leaf-or-narrow-wrapper')) score -= 180
  if (rejectedReasons.includes('page-root')) score -= 220
  if (rejectedReasons.includes('navigation-or-footer')) score -= 180
  if (rejectedReasons.includes('insufficient-signal-types')) score -= 90

  return {
    ...anchor,
    score,
    isValid: rejectedReasons.length === 0,
    rejectedReasons,
    containsText,
    containsAction,
    containsMedia,
    nodeType,
    childCount,
    leafLike: rejectedReasons.includes('leaf-or-narrow-wrapper'),
  }
}

function createSectionDescriptorFromHeroAnchor({ source, anchor, figmaContext }) {
  const role = 'hero'
  const xRatio = source === 'figma'
    ? normalizeNumber(anchor.node?.xRatio)
    : null
  const yRatio = source === 'figma'
    ? normalizeNumber(anchor.node?.yRatio)
    : null
  const widthRatio = source === 'figma'
    ? normalizeNumber(anchor.node?.widthRatio)
    : null
  const heightRatio = source === 'figma'
    ? normalizeNumber(anchor.node?.heightRatio)
    : null
  const parentSectionId = source === 'figma'
    ? findParentHeroAnchorSectionId(anchor.path, figmaContext)
    : findWebParentHeroAnchorSectionId(anchor.path)
  return createSectionDescriptor({
    source,
    path: anchor.path,
    rootSourceId: anchor.rootSourceId,
    parentSectionId,
    role,
    xRatio,
    yRatio,
    widthRatio,
    heightRatio,
    confidence: anchor.score >= 220 ? 'high' : anchor.score >= 140 ? 'medium' : 'low',
    reasons: ['hero common ancestor root'],
  })
}

function createSectionDescriptorForCandidate(candidate, sectionContexts, heroSelection) {
  const source = normalizeString(candidate?.source)
  const selectedHeroDescriptor = source === 'figma' ? heroSelection?.figmaHeroDescriptor : source === 'web' ? heroSelection?.webHeroDescriptor : null
  if (selectedHeroDescriptor && isCandidateWithinSectionDescriptor(candidate, selectedHeroDescriptor)) {
    return selectedHeroDescriptor
  }
  if (candidate?.source === 'figma') return createFigmaSectionDescriptor(candidate, sectionContexts?.figma)
  if (candidate?.source === 'web') return createWebSectionDescriptor(candidate)
  return createFallbackSectionDescriptor(candidate)
}

function createFigmaSectionDescriptor(candidate, context) {
  const layerPath = normalizeString(candidate?.layerPath || candidate?.context || candidate?.parentContext)
  const anchors = buildFigmaAnchorCandidates(layerPath, candidate, context)
  const scoredAnchors = anchors
    .map((anchor) => ({ ...anchor, score: getFigmaAnchorScore(anchor, candidate, context) }))
    .sort((first, second) => second.score - first.score)
  const selected = scoredAnchors.find((anchor) => isUsableFigmaSectionAnchor(anchor, context)) || scoredAnchors[0]

  if (!selected || selected.score <= 0) return createFallbackSectionDescriptor(candidate)

  const parentAnchor = anchors
    .filter((anchor) => anchor.path !== selected.path && isFigmaPathAncestor(anchor.path, selected.path))
    .map((anchor) => ({ ...anchor, score: getFigmaAnchorScore(anchor, candidate, context) }))
    .filter((anchor) => anchor.score > 0 && !isFigmaPageRootNode(anchor.node, context))
    .sort((first, second) => second.path.length - first.path.length)[0] || null

  const role = inferSectionRole({
    source: 'figma',
    searchable: `${selected.path} ${selected.node?.name || ''}`.toLowerCase(),
    explicitSection: candidate?.section,
    text: candidate?.text,
  })

  return createSectionDescriptor({
    source: 'figma',
    path: selected.path,
    rootSourceId: normalizeString(selected.node?.nodeId || selected.node?.id || selected.path),
    parentSectionId: parentAnchor ? buildSectionId('figma', normalizeString(parentAnchor.node?.nodeId || parentAnchor.node?.id || parentAnchor.path), parentAnchor.path) : null,
    role,
    xRatio: normalizeNumber(selected.node?.xRatio ?? candidate?.xRatio),
    yRatio: normalizeNumber(selected.node?.yRatio ?? candidate?.yRatio),
    widthRatio: normalizeNumber(selected.node?.widthRatio ?? candidate?.widthRatio),
    heightRatio: normalizeNumber(selected.node?.heightRatio ?? candidate?.heightRatio),
    confidence: selected.score >= 180 ? 'high' : selected.score >= 110 ? 'medium' : 'low',
    reasons: uniqueStrings([
      selected.node ? 'figma ancestor section root' : 'figma layer path section root',
      role === 'hero' ? 'hero-like figma section anchor' : '',
    ]),
  })
}

function createWebSectionDescriptor(candidate) {
  const anchors = buildWebAnchorCandidates(candidate)
  const scoredAnchors = anchors
    .map((anchor) => ({ ...anchor, score: getWebAnchorScore(anchor, candidate) }))
    .sort((first, second) => second.score - first.score)
  const selected = scoredAnchors.find((anchor) => isUsableWebSectionAnchor(anchor)) || scoredAnchors[0]

  if (!selected || selected.score <= 0) return createFallbackSectionDescriptor(candidate)

  const parentAnchor = anchors
    .filter((anchor) => anchor.path !== selected.path && isWebPathAncestor(anchor.path, selected.path))
    .map((anchor) => ({ ...anchor, score: getWebAnchorScore(anchor, candidate) }))
    .filter((anchor) => anchor.score > 0)
    .sort((first, second) => second.path.length - first.path.length)[0] || null

  const role = inferSectionRole({
    source: 'web',
    searchable: `${selected.path} ${candidate?.selector || ''} ${candidate?.parentContext || ''}`.toLowerCase(),
    explicitSection: candidate?.section,
    text: candidate?.text,
  })

  return createSectionDescriptor({
    source: 'web',
    path: selected.path,
    rootSourceId: selected.path,
    parentSectionId: parentAnchor ? buildSectionId('web', parentAnchor.path, parentAnchor.path) : null,
    role,
    xRatio: normalizeNumber(candidate?.xRatio),
    yRatio: normalizeNumber(candidate?.yRatio),
    widthRatio: normalizeNumber(candidate?.widthRatio),
    heightRatio: normalizeNumber(candidate?.heightRatio),
    confidence: selected.score >= 170 ? 'high' : selected.score >= 100 ? 'medium' : 'low',
    reasons: uniqueStrings([
      'web ancestor section root',
      role === 'hero' ? 'hero-like web section anchor' : '',
    ]),
  })
}

function createFallbackSectionDescriptor(candidate) {
  const source = normalizeString(candidate?.source) || 'unknown'
  const rawPath = source === 'figma'
    ? getFigmaSectionPath(candidate?.layerPath || candidate?.context || candidate?.parentContext)
    : getWebSectionPath(candidate?.parentContext || candidate?.context || candidate?.selector || candidate?.layerPath, candidate?.section)
  const searchable = `${candidate?.layerPath || ''} ${candidate?.context || ''} ${candidate?.parentContext || ''} ${candidate?.selector || ''}`.toLowerCase()
  const role = inferSectionRole({ source, searchable, explicitSection: candidate?.section, text: candidate?.text })
  return createSectionDescriptor({
    source,
    path: rawPath || role || 'unknown',
    rootSourceId: normalizeString(candidate?.parentId || candidate?.sourceId || rawPath || role || 'unknown'),
    parentSectionId: null,
    role,
    xRatio: normalizeNumber(candidate?.xRatio),
    yRatio: normalizeNumber(candidate?.yRatio),
    widthRatio: normalizeNumber(candidate?.widthRatio),
    heightRatio: normalizeNumber(candidate?.heightRatio),
    confidence: 'low',
    reasons: ['fallback section anchor'],
  })
}

function createSectionDescriptor({ source, path, rootSourceId, parentSectionId, role, xRatio, yRatio, widthRatio, heightRatio, confidence, reasons }) {
  const normalizedPath = normalizeString(path) || 'unknown'
  const normalizedRootSourceId = normalizeString(rootSourceId) || normalizedPath
  return {
    sectionId: buildSectionId(source, normalizedRootSourceId, normalizedPath),
    source,
    role: role || 'unknown',
    rootSourceId: normalizedRootSourceId,
    path: normalizedPath,
    parentSectionId: parentSectionId || null,
    xRatio: normalizeNumber(xRatio),
    yRatio: normalizeNumber(yRatio),
    widthRatio: normalizeNumber(widthRatio),
    heightRatio: normalizeNumber(heightRatio),
    confidence: normalizeConfidence(confidence),
    reasons: uniqueStrings(reasons || []),
  }
}

function buildSectionId(source, rootSourceId, path) {
  return `section:${normalizeString(source) || 'unknown'}:${normalizeString(rootSourceId) || normalizeComparableSectionPath(path) || 'unknown'}`
}

function buildFigmaAnchorCandidates(layerPath, candidate, context) {
  const paths = buildFigmaCumulativePaths(layerPath)
  if (paths.length === 0) return [{ path: getFigmaSectionPath(layerPath) || 'unknown', node: null }]
  return paths.map((path) => ({ path, node: findFigmaNodeByNormalizedPath(context, path) }))
}

function buildFigmaCumulativePaths(layerPath) {
  const parts = normalizeString(layerPath).split('/').map((item) => item.trim()).filter(Boolean)
  if (parts.length === 0) return []
  const first = parts[0]?.toLowerCase() || ''
  const startIndex = parts.length >= 2 && /page|root|desktop|mobile|frame/.test(first) ? 1 : 0
  return parts.slice(startIndex).map((_, index, sliced) => sliced.slice(0, index + 1).join(' / '))
}

function getFigmaAnchorScore(anchor, candidate, context) {
  const node = anchor.node
  const searchable = `${anchor.path} ${node?.name || ''} ${candidate?.text || ''}`.toLowerCase()
  const role = inferSectionRole({ source: 'figma', searchable, explicitSection: candidate?.section, text: candidate?.text })
  const lastSegment = getLastPathToken(anchor.path, '/')
  let score = 0
  if (role === 'hero') score += 180
  if (role === 'banner') score += 150
  if (role === 'navigation') score += 120
  if (role === 'legal') score += 100
  if (role === 'footer') score += 80
  if (role === 'cards') score += 70
  if (role === 'content') score += 60
  if (node?.hasImageFill || node?.hasVideoLikeContent) score += 60
  if ((node?.widthRatio ?? candidate?.widthRatio ?? 0) >= 0.55) score += 30
  if ((node?.heightRatio ?? candidate?.heightRatio ?? 0) >= 0.12 && (node?.heightRatio ?? candidate?.heightRatio ?? 0) <= 0.72) score += 25
  if ((node?.yRatio ?? candidate?.yRatio ?? 1) <= 0.3) score += 20
  if (/visual|hero|banner|kv|section|content|offer|benefit|advisor/.test(searchable)) score += 20
  if (anchor.path === normalizeString(candidate?.layerPath)) score -= 20
  if (/title|heading|copy|label/.test(lastSegment)) score -= 30
  if (/action|button|cta|tab/.test(lastSegment)) score -= 40
  if (isFigmaPageRootNode(node, context)) score -= 220
  if (isLikelyFigmaSubsectionWrapper(node, context)) score -= 80
  return score
}

function isFigmaPageRootNode(node, context) {
  if (!node) return false
  const parentId = normalizeString(node?.parentId)
  const heightRatio = Number(node?.heightRatio) || 0
  const widthRatio = Number(node?.widthRatio) || 0
  const layerPath = normalizeString(node?.layerPath).toLowerCase()
  const descendantTextCount = countFigmaTextsUnderPath(normalizeString(node?.layerPath), context)
  const textShare = context?.totalTextCount > 0 ? descendantTextCount / context.totalTextCount : 0
  const childCount = (context?.childMap?.get(normalizeString(node?.nodeId || node?.id)) || []).length
  return !parentId && ((widthRatio >= 0.75 && heightRatio >= 0.75) || textShare >= 0.6 || childCount >= 3 || /page|root/.test(layerPath))
}

function countFigmaTextsUnderPath(layerPath, context) {
  const normalizedPath = normalizeString(layerPath)
  if (!normalizedPath) return 0
  return (Array.isArray(context?.flatNodes) ? context.flatNodes : [])
    .filter((node) => node?.type === 'TEXT')
    .filter((node) => {
      const childPath = normalizeString(node?.layerPath)
      return buildFigmaCumulativePaths(childPath).includes(normalizedPath)
    }).length
}

function findFigmaNodeByNormalizedPath(context, normalizedPath) {
  const targetPath = normalizeString(normalizedPath)
  if (!targetPath) return null
  return (Array.isArray(context?.flatNodes) ? context.flatNodes : [])
    .filter((node) => buildFigmaCumulativePaths(normalizeString(node?.layerPath)).includes(targetPath))
    .sort((first, second) => {
      const firstDepth = getHeroAnchorDepth(normalizeString(first?.layerPath), 'figma')
      const secondDepth = getHeroAnchorDepth(normalizeString(second?.layerPath), 'figma')
      if (firstDepth !== secondDepth) return firstDepth - secondDepth
      return countFigmaAnchorChildren(second, context) - countFigmaAnchorChildren(first, context)
    })[0] || null
}

function isLikelyFigmaSubsectionWrapper(node, context) {
  if (!node) return false
  const searchable = `${node?.name || ''} ${node?.layerPath || ''}`.toLowerCase()
  const widthRatio = Number(node?.widthRatio) || 0
  const heightRatio = Number(node?.heightRatio) || 0
  if (/title|heading|copy|label/.test(searchable) && heightRatio <= 0.12) return true
  if (/action|button|cta|tab/.test(searchable) && widthRatio <= 0.4 && heightRatio <= 0.12) return true
  return isSemanticFigmaInteractiveNode(node, context?.childMap || new Map(), context?.flatNodes || [], null) && widthRatio <= 0.4 && heightRatio <= 0.12
}

function buildWebAnchorCandidates(candidate) {
  const selector = normalizeString(candidate?.selector)
  const parentContext = normalizeString(candidate?.parentContext)
  const parentSelector = normalizeString(candidate?.parentSelector)
  const rawPaths = uniqueStrings([
    parentContext,
    isCompatibleWebAncestorPath(parentSelector, selector) || isCompatibleWebAncestorPath(parentSelector, parentContext) ? parentSelector : '',
    normalizeString(candidate?.context),
    selector,
  ])
  const anchors = []
  rawPaths.forEach((path) => {
    buildWebCumulativePaths(path).forEach((anchorPath) => {
      anchors.push({ path: anchorPath })
    })
  })
  if (anchors.length === 0) anchors.push({ path: normalizeString(candidate?.section) || 'unknown' })
  return dedupeByPath(anchors)
}

function buildWebCumulativePaths(path) {
  const normalized = normalizeString(path)
  if (!normalized) return []
  const parts = normalized.includes('>')
    ? normalized.split('>').map((item) => item.trim()).filter(Boolean)
    : normalized.split(/\s+/).map((item) => item.trim()).filter(Boolean)
  const separator = normalized.includes('>') ? ' > ' : ' '
  return parts.map((_, index) => parts.slice(0, index + 1).join(separator))
}

function getWebAnchorScore(anchor, candidate) {
  const searchable = `${anchor.path} ${candidate?.selector || ''} ${candidate?.parentContext || ''} ${candidate?.section || ''}`.toLowerCase()
  const role = inferSectionRole({ source: 'web', searchable, explicitSection: candidate?.section, text: candidate?.text })
  const lastToken = getLastPathToken(anchor.path, anchor.path.includes('>') ? '>' : ' ')
  let score = 0
  if (role === 'hero') score += 180
  if (role === 'banner') score += 150
  if (role === 'navigation') score += 120
  if (role === 'legal') score += 100
  if (role === 'footer') score += 80
  if (role === 'cards') score += 75
  if (role === 'content') score += 60
  if (/section|article|hero|banner|visual|kv|promo|offer|benefit|footer|legal|nav|card|form/.test(searchable)) score += 35
  if (anchor.path === normalizeString(candidate?.parentContext)) score += 18
  if (anchor.path === normalizeString(candidate?.selector) && /hero|banner|section|card|footer|legal|nav/.test(searchable)) score += 22
  if (/card/.test(searchable)) score += 12
  if (candidate?.type === 'video' && /hero|banner|visual|main/.test(searchable)) score += 30
  if ((candidate?.yRatio ?? 1) <= 0.3) score += 10
  if (/^body$|^html$|^body > main$|^main$/.test(anchor.path)) score -= 120
  if (/^(h[1-6]|p|span|small|img|video|label|input)(?:[.#]|\[|$)/.test(lastToken) || /^a(?:[.#]|\[|$)/.test(lastToken) || /^button(?:[.#]|\[|$)/.test(lastToken)) score -= 70
  if (/action|button|cta|title|heading|copy|text|links?$/.test(lastToken)) score -= 25
  return score
}

function isCompatibleWebAncestorPath(parentPath, childPath) {
  const parent = normalizeString(parentPath)
  const child = normalizeString(childPath)
  if (!parent || !child) return false
  return child === parent || child.startsWith(`${parent} `) || child.startsWith(`${parent} > `) || child.includes(`${parent} `)
}

function dedupeByPath(items) {
  const seen = new Set()
  return items.filter((item) => {
    const key = normalizeString(item?.path)
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function isFigmaPathAncestor(parentPath, childPath) {
  const parent = normalizeString(parentPath)
  const child = normalizeString(childPath)
  return Boolean(parent && child && parent !== child && child.startsWith(`${parent} /`))
}

function isWebPathAncestor(parentPath, childPath) {
  const parent = normalizeString(parentPath)
  const child = normalizeString(childPath)
  return Boolean(parent && child && parent !== child && (child.startsWith(`${parent} > `) || child.startsWith(`${parent} `)))
}

function getLastPathToken(value, separator) {
  const parts = normalizeString(value)
    .split(separator === ' ' ? /\s+/ : separator)
    .map((item) => item.trim())
    .filter(Boolean)
  return (parts[parts.length - 1] || '').toLowerCase()
}

function mergeConfidence(first, second) {
  const rank = { low: 1, medium: 2, high: 3 }
  return (rank[normalizeConfidence(second)] || 0) > (rank[normalizeConfidence(first)] || 0) ? normalizeConfidence(second) : normalizeConfidence(first)
}

function isCandidateWithinSectionDescriptor(candidate, descriptor) {
  if (!candidate || !descriptor) return false
  if (descriptor.source === 'web') return matchesWebHeroAncestry(candidate, descriptor.path)
  return isCandidateUnderAnchor(candidate, descriptor.source, descriptor.path)
}

function isTopHeroTextCandidate(candidate) {
  if (!candidate?.text) return false
  if (candidate.source === 'figma') return candidate.role === 'heading' || isHeroLikeSection(candidate.section) || (candidate.yRatio ?? 1) <= 0.35
  return candidate.role === 'heading' || isHeroLikeSection(candidate.section) || /hero|banner|main.?visual|kv/.test(`${candidate.selector || ''} ${candidate.parentContext || ''}`.toLowerCase()) || (candidate.yRatio ?? 1) <= 0.25
}

function isTopHeroActionCandidate(candidate) {
  if (!candidate?.text) return false
  if (isNavigationLikeCandidate(candidate) || looksLikeTabCandidate(candidate) || looksLikeMediaControlCandidate(candidate) || looksLikeCarouselControlCandidate(candidate) || looksLikeUtilityControlCandidate(candidate)) return false
  return looksLikeActionCandidate(candidate) && (isHeroLikeSection(candidate.section) || (candidate.yRatio ?? 1) <= 0.35)
}

function isTopHeroMediaCandidate(candidate) {
  if (!candidate) return false
  return candidate.visible !== false && (isHeroLikeSection(candidate.section) || (candidate.yRatio ?? 1) <= 0.35)
}

function compareHeroSignalCandidates(first, second) {
  const yDiff = (first?.yRatio ?? 1) - (second?.yRatio ?? 1)
  if (yDiff !== 0) return yDiff
  return getCandidateScore(second) - getCandidateScore(first)
}

function getCandidateDirectAnchorPath(candidate, source) {
  if (source === 'figma') {
    const paths = buildFigmaCumulativePaths(candidate?.layerPath || candidate?.context || candidate?.parentContext)
    return paths[paths.length - 1] || ''
  }
  return normalizeString(candidate?.selector || candidate?.context || candidate?.parentContext)
}

function compareHeroAnchorScores(first, second) {
  if ((second?.score || 0) !== (first?.score || 0)) return (second?.score || 0) - (first?.score || 0)
  return getHeroAnchorDepth(second?.path || '', second?.source || '') - getHeroAnchorDepth(first?.path || '', first?.source || '')
}

function isCandidateUnderAnchor(candidate, source, anchorPath) {
  const targetPath = normalizeString(anchorPath)
  if (!targetPath) return false
  if (source === 'figma') {
    const layerPath = normalizeString(candidate?.layerPath || candidate?.context || candidate?.parentContext)
    return buildFigmaCumulativePaths(layerPath).includes(targetPath)
  }
  const ancestryPaths = buildWebAnchorCandidates(candidate).map((item) => normalizeString(item.path))
  return ancestryPaths.includes(targetPath)
}

function isLayoutLikeHeroAnchor(anchor, source, figmaContext) {
  if (source === 'figma') {
    const widthRatio = Number(anchor?.node?.widthRatio) || 0
    const heightRatio = Number(anchor?.node?.heightRatio) || 0
    const childCount = countFigmaAnchorChildren(anchor?.node, figmaContext)
    return widthRatio >= 0.55 || heightRatio >= 0.14 || childCount >= 3
  }
  return /section|hero|banner|main.?visual|visual|kv|wrap|container|inner|main/.test(normalizeString(anchor?.path).toLowerCase())
}

function countFigmaAnchorChildren(node, figmaContext) {
  if (!node) return 0
  return (figmaContext?.childMap?.get(normalizeString(node?.nodeId || node?.id)) || []).length
}

function estimateWebAnchorChildCount(anchorPath, matchedSignals) {
  const descendants = matchedSignals.filter((item) => isCandidateUnderAnchor(item.candidate, 'web', anchorPath))
  return descendants.length
}

function inferWebAnchorNodeType(anchorPath) {
  const lastToken = getLastPathToken(anchorPath, anchorPath.includes('>') ? '>' : ' ')
  if (/^(section|main|article|header|footer|nav)([.#]|\[|$)/.test(lastToken)) return 'CONTAINER'
  if (/^(div|ul|ol|li)([.#]|\[|$)/.test(lastToken)) return 'WRAPPER'
  if (/^(h[1-6]|p|span|small|img|video|a|button)([.#]|\[|$)/.test(lastToken)) return 'LEAF'
  return 'WRAPPER'
}

function isUsableFigmaSectionAnchor(anchor, figmaContext) {
  if (!anchor?.node) return false
  if (isFigmaPageRootNode(anchor.node, figmaContext)) return false
  const type = normalizeString(anchor.node?.type).toUpperCase()
  if (['TEXT', 'RECTANGLE', 'VECTOR', 'ELLIPSE', 'LINE', 'POLYGON', 'STAR'].includes(type)) return false
  if (countFigmaAnchorChildren(anchor.node, figmaContext) === 0) return false
  if (isLikelyFigmaSubsectionWrapper(anchor.node, figmaContext)) return false
  return true
}

function isUsableWebSectionAnchor(anchor) {
  if (!anchor?.path) return false
  const nodeType = inferWebAnchorNodeType(anchor.path)
  if (nodeType === 'LEAF') return false
  const lowerPath = normalizeString(anchor.path).toLowerCase()
  if (/\b(txt|text|title|heading|copy|label)\b/.test(lowerPath)) return false
  if (/^body$|^html$|^main$|^body > main$/i.test(anchor.path)) return false
  return true
}

function isInvalidHeroRootAnchor(anchor, source, { childCount, containsText, containsAction, containsMedia, layoutLike, nodeType, figmaContext }) {
  if (source === 'figma') {
    const node = anchor?.node
    if (!node) return true
    const type = normalizeString(node?.type).toUpperCase()
    if (['TEXT', 'RECTANGLE', 'VECTOR', 'ELLIPSE', 'LINE', 'POLYGON', 'STAR'].includes(type)) return true
    if (childCount === 0) return true
    if (isLikelyFigmaSubsectionWrapper(node, figmaContext) && [containsText, containsAction, containsMedia].filter(Boolean).length < 2) return true
    return [containsText, containsAction, containsMedia].filter(Boolean).length < 2 && !layoutLike
  }
  const lowerPath = normalizeString(anchor?.path).toLowerCase()
  if (nodeType === 'LEAF') return true
  if (/\b(txt|text|title|heading|copy|label|btn_wrap|button_wrap)\b/.test(lowerPath) && [containsText, containsAction, containsMedia].filter(Boolean).length < 2) return true
  return [containsText, containsAction, containsMedia].filter(Boolean).length < 2 && !layoutLike
}

function isPageRootAnchor(anchor, source, figmaContext) {
  if (source === 'figma') return isFigmaPageRootNode(anchor?.node, figmaContext)
  return /^body$|^html$|^main$|^body > main$/i.test(normalizeString(anchor?.path))
}

function isNavigationOrFooterAnchor(anchor, source) {
  const path = normalizeString(anchor?.path).toLowerCase()
  if (source === 'figma') return /nav|navigation|header|menu|footer|legal|cookie|privacy|terms/.test(path)
  return /nav|navigation|header|menu|footer|legal|cookie|privacy|terms/.test(path)
}

function scoreHeroAnchorSemantics(path) {
  const searchable = normalizeString(path).toLowerCase()
  let score = 0
  if (/hero|main.?visual|kv|banner|visual/.test(searchable)) score += 90
  if (/section|container|wrap|inner/.test(searchable)) score += 20
  if (/txt|text|title|heading/.test(searchable)) score -= 35
  if (/img|image|video/.test(searchable)) score -= 20
  return score
}

function scoreFigmaHeroAnchorGeometry(node) {
  if (!node) return 0
  let score = 0
  const widthRatio = Number(node?.widthRatio) || 0
  const heightRatio = Number(node?.heightRatio) || 0
  const yRatio = Number(node?.yRatio) || 1
  if (widthRatio >= 0.55) score += 25
  if (heightRatio >= 0.14 && heightRatio <= 0.7) score += 25
  if (yRatio <= 0.25) score += 30
  return score
}

function scoreWebHeroAnchorGeometry(matchedSignals) {
  const topMostY = matchedSignals.reduce((lowest, item) => Math.min(lowest, Number(item?.candidate?.yRatio) || 1), 1)
  return topMostY <= 0.25 ? 25 : topMostY <= 0.35 ? 10 : 0
}

function getHeroAnchorDepth(path, source) {
  if (!source && normalizeString(path).includes('/')) return normalizeString(path).split('/').map((item) => item.trim()).filter(Boolean).length
  if (source === 'figma') return normalizeString(path).split('/').map((item) => item.trim()).filter(Boolean).length
  if (normalizeString(path).includes('>')) return normalizeString(path).split('>').map((item) => item.trim()).filter(Boolean).length
  return normalizeString(path).split(/\s+/).filter(Boolean).length
}

function findParentHeroAnchorSectionId(anchorPath, figmaContext) {
  const ancestors = buildFigmaCumulativePaths(anchorPath)
  if (ancestors.length <= 1) return null
  const parentPath = ancestors[ancestors.length - 2]
  const parentNode = figmaContext?.nodeByPath?.get(parentPath)
  if (!parentPath || isFigmaPageRootNode(parentNode, figmaContext)) return null
  return buildSectionId('figma', normalizeString(parentNode?.nodeId || parentNode?.id || parentPath), parentPath)
}

function findWebParentHeroAnchorSectionId(anchorPath) {
  const ancestors = buildWebCumulativePaths(anchorPath)
  if (ancestors.length <= 1) return null
  const parentPath = ancestors[ancestors.length - 2]
  if (!parentPath || /^body$|^html$|^main$|^body > main$/i.test(parentPath)) return null
  return buildSectionId('web', parentPath, parentPath)
}

function createSectionEntities({ candidates }) {
  const sectionMap = new Map()
  ;(Array.isArray(candidates) ? candidates : []).forEach((candidate) => {
    upsertSectionEntity(sectionMap, createSectionSeedFromCandidate(candidate))
  })

  return Array.from(sectionMap.values())
    .filter((section) => shouldKeepSectionEntity(section))
    .sort(compareSectionEntities)
}

function createCanonicalEvidence({ actions, numericValues, media, texts, sections }) {
  return {
    actions: dedupeCanonicalEntities(Array.isArray(actions) ? actions : []),
    numericValues: dedupeCanonicalEntities(Array.isArray(numericValues) ? numericValues : []),
    media: dedupeCanonicalEntities(Array.isArray(media) ? media : []),
    texts: dedupeCanonicalEntities(Array.isArray(texts) ? texts : []),
    sections: dedupeCanonicalEntities(Array.isArray(sections) ? sections : []),
  }
}

function createHeroSectionHint({ sections, heroSections, filteredDifferences, ctaButtons, heroMediaGroup, texts, actions }) {
  const figmaHero = sections.find((item) => item.sectionId === heroSections.figmaSectionId) || null
  const webHero = sections.find((item) => item.sectionId === heroSections.webSectionId) || null
  const figmaNextSection = findNextSectionAfterHero(sections, figmaHero)
  const webNextSection = findNextSectionAfterHero(sections, webHero)
  const figmaTextCount = texts.filter((item) => item.source === 'figma' && item.sectionId === heroSections.figmaSectionId).length
  const webTextCount = texts.filter((item) => item.source === 'web' && item.sectionId === heroSections.webSectionId).length
  const heroActionCount = actions.filter((item) => item.sectionId && (item.sectionId === heroSections.figmaSectionId || item.sectionId === heroSections.webSectionId)).length
  const reasons = []
  if (figmaHero) reasons.push('figma hero section detected')
  if (webHero) reasons.push('web hero section detected')
  if (heroMediaGroup.comparisonHint) reasons.push('hero media candidates grouped')
  if (heroActionCount > 0) reasons.push('hero action cluster detected')
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
    figmaTextCount,
    webTextCount,
    ctaButtons: ctaButtons.filter((item) => item.sectionId && (item.sectionId === heroSections.figmaSectionId || item.sectionId === heroSections.webSectionId)).slice(0, MAX_HERO_ACTIONS),
    sections: [figmaHero, webHero, figmaNextSection, webNextSection].filter(Boolean),
  }
}

function enrichComparisonDifferencesWithCanonicalEvidence(differences, canonicalEvidence) {
  const texts = Array.isArray(canonicalEvidence?.texts) ? canonicalEvidence.texts : []
  return (Array.isArray(differences) ? differences : []).map((difference) => {
    const figmaText = findCanonicalTextForDifference(texts, 'figma', difference.figmaText || difference.text, difference.figmaNodeId)
    const webText = findCanonicalTextForDifference(texts, 'web', difference.webText, difference.webSelector)
    const figmaSpatialEvidence = createSpatialEvidence(figmaText || difference.figmaSpatialEvidence || {})
    const webSpatialEvidence = createSpatialEvidence(webText || difference.webSpatialEvidence || {})
    const spatialEvidence = chooseRepresentativeSpatialEvidence(figmaSpatialEvidence, webSpatialEvidence, difference.spatialEvidence)
    const sourceEntityIds = uniqueStrings([
      ...(Array.isArray(difference.sourceEntityIds) ? difference.sourceEntityIds : []),
      figmaText?.entityId,
      webText?.entityId,
      figmaText?.sourceIds?.[0],
      webText?.sourceIds?.[0],
    ])
    return {
      ...difference,
      sourceEntityIds,
      figmaNodeId: difference.figmaNodeId || figmaText?.sourceIds?.[0] || '',
      webSelector: difference.webSelector || webText?.selector || '',
      figmaSpatialEvidence,
      webSpatialEvidence,
      spatialEvidence,
      sectionId: difference.sectionId || spatialEvidence?.sectionId || figmaText?.sectionId || webText?.sectionId || '',
      sectionRootId: difference.sectionRootId || spatialEvidence?.sectionRootId || figmaText?.sectionRootId || webText?.sectionRootId || '',
      sectionPath: difference.sectionPath || spatialEvidence?.sectionPath || figmaText?.sectionPath || webText?.sectionPath || '',
      xRatio: difference.xRatio ?? spatialEvidence?.xRatio ?? null,
      yRatio: difference.yRatio ?? spatialEvidence?.yRatio ?? null,
      widthRatio: difference.widthRatio ?? spatialEvidence?.widthRatio ?? null,
      heightRatio: difference.heightRatio ?? spatialEvidence?.heightRatio ?? null,
    }
  })
}

function findCanonicalTextForDifference(texts, source, value, sourceIdOrSelector) {
  const sourceKey = normalizeString(sourceIdOrSelector)
  const sourceTexts = texts.filter((item) => item?.source === source)
  if (sourceKey) {
    const byId = sourceTexts.find((item) => normalizeString(item?.entityId) === sourceKey
      || normalizeString(item?.selector) === sourceKey
      || normalizeString(item?.sourceIds?.[0]) === sourceKey
      || (Array.isArray(item?.sourceIds) && item.sourceIds.map(normalizeString).includes(sourceKey)))
    if (byId) return byId
  }
  return findTextEntityByValue(sourceTexts, value)
}

function createSpatialEvidence(item = {}) {
  if (!item || typeof item !== 'object') return null
  const ratio = extractRatioBox(item)
  const pixel = extractPixelBox(item)
  if (!ratio && !pixel) {
    const yRatio = sanitizeRatio(item.yRatio ?? item.sectionYRatio)
    if (yRatio === null && !item.sectionId && !item.sectionPath) return null
    return compactObject({
      coordinateSpace: yRatio === null ? '' : 'ratio',
      yRatio,
      sectionId: normalizeString(item.sectionId),
      sectionRootId: normalizeString(item.sectionRootId || item.rootSourceId),
      sectionPath: normalizeString(item.sectionPath || item.path || item.contextPath || item.context || item.layerPath),
    })
  }
  return compactObject({
    coordinateSpace: ratio ? 'ratio' : 'pixel',
    ...(pixel || {}),
    ...(ratio || {}),
    sourceWidth: sanitizePositiveNumber(item.sourceWidth || item.imageWidth || item.viewportWidth || item.scrollWidth),
    sourceHeight: sanitizePositiveNumber(item.sourceHeight || item.imageHeight || item.viewportHeight || item.scrollHeight),
    sectionId: normalizeString(item.sectionId),
    sectionRootId: normalizeString(item.sectionRootId || item.rootSourceId),
    sectionPath: normalizeString(item.sectionPath || item.path || item.contextPath || item.context || item.layerPath),
  })
}

function chooseRepresentativeSpatialEvidence(first, second, fallback = null) {
  const validFirst = first && typeof first === 'object' ? first : null
  const validSecond = second && typeof second === 'object' ? second : null
  if (!validFirst && !validSecond) return fallback || null
  if (validFirst && validSecond) {
    const firstY = sanitizeRatio(validFirst.yRatio)
    const secondY = sanitizeRatio(validSecond.yRatio)
    const yRatio = firstY !== null && secondY !== null ? Number(((firstY + secondY) / 2).toFixed(6)) : firstY ?? secondY
    return compactObject({
      ...validFirst,
      ...validSecond,
      coordinateSpace: validFirst.coordinateSpace === 'ratio' || validSecond.coordinateSpace === 'ratio' ? 'ratio' : (validFirst.coordinateSpace || validSecond.coordinateSpace),
      xRatio: sanitizeRatio(validFirst.xRatio) ?? sanitizeRatio(validSecond.xRatio),
      yRatio,
      widthRatio: sanitizeRatio(validFirst.widthRatio) ?? sanitizeRatio(validSecond.widthRatio),
      heightRatio: sanitizeRatio(validFirst.heightRatio) ?? sanitizeRatio(validSecond.heightRatio),
      sectionId: validFirst.sectionId || validSecond.sectionId || '',
      sectionRootId: validFirst.sectionRootId || validSecond.sectionRootId || '',
      sectionPath: validFirst.sectionPath || validSecond.sectionPath || '',
    })
  }
  return validFirst || validSecond || fallback || null
}

function extractRatioBox(item = {}) {
  const xRatio = sanitizeRatio(item.xRatio ?? item.positionRatio?.xRatio)
  const yRatio = sanitizeRatio(item.yRatio ?? item.positionRatio?.yRatio)
  const widthRatio = sanitizeRatio(item.widthRatio ?? item.positionRatio?.widthRatio)
  const heightRatio = sanitizeRatio(item.heightRatio ?? item.positionRatio?.heightRatio)
  if (xRatio === null || yRatio === null || widthRatio === null || heightRatio === null || widthRatio <= 0 || heightRatio <= 0) return null
  return { xRatio, yRatio, widthRatio, heightRatio }
}

function extractPixelBox(item = {}) {
  const box = item.boundingBox || item.absoluteBoundingBox || item.bbox || item.rect || item.bounds || item.box || item
  const x = normalizeNumber(box.x ?? box.left)
  const y = normalizeNumber(box.y ?? box.top)
  const width = normalizeNumber(box.width ?? (Number.isFinite(Number(box.right)) && Number.isFinite(Number(x)) ? Number(box.right) - Number(x) : null))
  const height = normalizeNumber(box.height ?? (Number.isFinite(Number(box.bottom)) && Number.isFinite(Number(y)) ? Number(box.bottom) - Number(y) : null))
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null
  return { x, y, width, height }
}

function sanitizeRatio(value) {
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 && number <= 1 ? number : null
}

function sanitizePositiveNumber(value) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : null
}

function compactObject(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== null && item !== undefined && item !== ''))
}

function findNextSectionAfterHero(sections, heroSection) {
  if (!heroSection) return null
  const heroY = normalizeNumber(heroSection.yRatio)
  const heroHeight = normalizeNumber(heroSection.heightRatio)
  if (!Number.isFinite(heroY)) return null
  const heroBottom = heroY + (Number.isFinite(heroHeight) ? heroHeight : 0)
  return (Array.isArray(sections) ? sections : [])
    .filter((item) => item?.source === heroSection.source && item.sectionId !== heroSection.sectionId)
    .filter((item) => Number.isFinite(normalizeNumber(item.yRatio)) && normalizeNumber(item.yRatio) >= heroBottom)
    .sort((first, second) => normalizeNumber(first.yRatio) - normalizeNumber(second.yRatio))[0] || null
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

  const indexes = buildFigmaNodeIndexes(flatNodes)
  const childMap = indexes.childMap

  return flatNodes
    .filter((node) => isSemanticFigmaInteractiveNode(node, childMap, flatNodes, quality, indexes))
    .map((node) => createFigmaInteractionCandidate(node, flatNodes, childMap, quality, indexes))
    .filter(Boolean)
}

function createFigmaInteractionCandidate(node, flatNodes, childMap, quality, indexes = buildFigmaNodeIndexes(flatNodes)) {
  const text = deriveFigmaInteractionText(node, flatNodes, indexes)
  const layerPath = normalizeString(node?.layerPath)
  const context = truncateText(layerPath || node?.name || '', 180)
  const interactionEvidence = buildFigmaInteractionEvidence(node, childMap)
  const descendantTextNodes = getFigmaDescendantTextNodes(node, indexes)
  const descendantTexts = descendantTextNodes.map((child) => normalizeString(child?.characters)).filter(Boolean)
  const rejectionReasons = getFigmaActionRejectionReasons(node, descendantTexts, childMap)
  if (rejectionReasons.length > 0) {
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
    parentName: normalizeString(node?.parentName),
    section: inferFigmaSection(node),
    confidence: classifyConfidence(reasons.length >= 3 ? 'high' : reasons.length >= 2 ? 'medium' : 'low'),
    reasons,
    xRatio: normalizeNumber(node?.xRatio),
    yRatio: normalizeNumber(node?.yRatio),
    widthRatio: normalizeNumber(node?.widthRatio),
    heightRatio: normalizeNumber(node?.heightRatio),
    x: normalizeNumber(node?.absoluteBoundingBox?.x),
    y: normalizeNumber(node?.absoluteBoundingBox?.y),
    width: normalizeNumber(node?.absoluteBoundingBox?.width),
    height: normalizeNumber(node?.absoluteBoundingBox?.height),
    visible: node?.effectivelyVisible === true,
    tagName: normalizeString(node?.type).toLowerCase(),
    nodeType: normalizeString(node?.type),
    role: inferFigmaInteractionRole(node, text),
    parentId: normalizeString(node?.parentId),
    childIds: Array.isArray(node?.childIds) ? node.childIds : [],
    subtreeTextIds: descendantTextNodes.map((child) => normalizeString(child?.nodeId || child?.id)).filter(Boolean),
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
      x: normalizeNumber(node?.absoluteBoundingBox?.x),
      y: normalizeNumber(node?.absoluteBoundingBox?.y),
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
      x: normalizeNumber(node?.absoluteBoundingBox?.x),
      y: normalizeNumber(node?.absoluteBoundingBox?.y),
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
    contextPath: truncateText(candidate.contextPath || candidate.context || candidate.layerPath || '', 220),
    selector: candidate.selector || '',
    selectorSignature: candidate.selectorSignature || createSelectorSignature(candidate.selector || candidate.contextPath || candidate.context),
    parentContext: candidate.parentContext || '',
    parentSelector: candidate.parentSelector || '',
    section: candidate.section,
    confidence: classifyConfidence(reasons.length >= 3 ? 'high' : reasons.length >= 2 ? 'medium' : 'low'),
    reasons,
    xRatio: candidate.xRatio,
    yRatio: candidate.yRatio,
  }
}

function createCanonicalMediaHints({ images, videos, sections, heroSections, quality }) {
  const canonicalMedia = createCanonicalMediaEntities([...images, ...videos], sections, heroSections, quality)
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
  const heroActions = actions.filter((item) => isHeroCtaActionEntity(item, heroSections))
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

function isHeroCtaActionEntity(item = {}, heroSections = {}) {
  if (!isCtaRole(item.role)) return false
  if (item.comparisonScope !== 'primary') return false
  if (item.sectionId !== heroSections.figmaSectionId && item.sectionId !== heroSections.webSectionId) return false
  if (/reference|navigation|tab|media-control|carousel-control|utility-control/i.test(`${item.comparisonScope || ''} ${item.role || ''} ${item.sectionPath || ''}`)) return false
  if (!normalizeString(item.text || item.displayText)) return false
  return true
}

function createEvidenceSummary({ heroSection, heroMediaGroup, heroCtaGroup, navigation, sections, media, prices, dates, filteredDifferences, canonicalEvidence }) {
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
      primaryActionCount: canonicalEvidence.actions.filter((item) => item.role === 'primary-action').length,
      secondaryActionCount: canonicalEvidence.actions.filter((item) => item.role === 'secondary-action').length,
      tabCount: canonicalEvidence.actions.filter((item) => item.role === 'tab').length,
      mediaControlCount: canonicalEvidence.actions.filter((item) => item.role === 'media-control').length,
      carouselControlCount: canonicalEvidence.actions.filter((item) => item.role === 'carousel-control').length,
      formControlCount: canonicalEvidence.actions.filter((item) => item.role === 'form-control').length,
      utilityControlCount: canonicalEvidence.actions.filter((item) => item.role === 'utility-control').length,
      unknownInteractiveCount: canonicalEvidence.actions.filter((item) => item.role === 'unknown-interactive').length,
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
  existing.spatialEvidence = chooseRepresentativeSpatialEvidence(existing.spatialEvidence, seed.spatialEvidence)
  existing.parentSectionId = existing.parentSectionId || seed.parentSectionId || null
  existing.reasons = uniqueStrings([...(existing.reasons || []), ...(seed.reasons || [])])
  existing.confidence = mergeConfidence(existing.confidence, seed.confidence)
  existing.__textCount += normalizeCount(seed.__textCount, 0)
  existing.__actionCount += normalizeCount(seed.__actionCount, 0)
  existing.__imageCount += normalizeCount(seed.__imageCount, 0)
  existing.__videoCount += normalizeCount(seed.__videoCount, 0)
  existing.__headingCount += normalizeCount(seed.__headingCount, 0)
  existing.__numericCount += normalizeCount(seed.__numericCount, 0)
  existing.__candidateCount += normalizeCount(seed.__candidateCount, 0)
}

function createSectionSeedFromCandidate(candidate) {
  if (!candidate) return null
  const source = normalizeString(candidate.source) || 'unknown'
  const descriptor = candidate.sectionDescriptor || createFallbackSectionDescriptor(candidate)
  const searchable = `${candidate?.layerPath || ''} ${candidate?.context || ''} ${candidate?.parentContext || ''} ${candidate?.selector || ''}`.toLowerCase()
  const role = descriptor.role || inferSectionRole({ source, searchable, explicitSection: candidate.section, text: candidate.text })
  return {
    sectionId: descriptor.sectionId,
    source,
    role,
    rootSourceId: descriptor.rootSourceId,
    path: descriptor.path,
    parentSectionId: descriptor.parentSectionId || null,
    xRatio: minDefined(normalizeNumber(candidate.xRatio), normalizeNumber(descriptor.xRatio)),
    yRatio: minDefined(normalizeNumber(candidate.yRatio), normalizeNumber(descriptor.yRatio)),
    widthRatio: maxDefined(normalizeNumber(candidate.widthRatio), normalizeNumber(descriptor.widthRatio)),
    heightRatio: maxDefined(normalizeNumber(candidate.heightRatio), normalizeNumber(descriptor.heightRatio)),
    spatialEvidence: createSpatialEvidence({
      ...candidate,
      sectionId: descriptor.sectionId,
      sectionRootId: descriptor.rootSourceId,
      sectionPath: descriptor.path,
      xRatio: minDefined(normalizeNumber(candidate.xRatio), normalizeNumber(descriptor.xRatio)),
      yRatio: minDefined(normalizeNumber(candidate.yRatio), normalizeNumber(descriptor.yRatio)),
      widthRatio: maxDefined(normalizeNumber(candidate.widthRatio), normalizeNumber(descriptor.widthRatio)),
      heightRatio: maxDefined(normalizeNumber(candidate.heightRatio), normalizeNumber(descriptor.heightRatio)),
    }),
    entityIds: [],
    textEntityIds: [],
    actionEntityIds: [],
    numericEntityIds: [],
    mediaEntityIds: [],
    confidence: descriptor.confidence || 'low',
    reasons: uniqueStrings(descriptor.reasons || []),
    __textCount: candidate.type === 'text' || candidate.nodeType === 'TEXT' ? 1 : 0,
    __actionCount: candidate.type === 'interactive' ? 1 : 0,
    __imageCount: candidate.type === 'image' ? 1 : 0,
    __videoCount: candidate.type === 'video' ? 1 : 0,
    __headingCount: candidate.role === 'heading' || Array.isArray(candidate.reasons) && (candidate.reasons.includes('large font size') || candidate.reasons.includes('heading element')) ? 1 : 0,
    __numericCount: candidate.type === 'numeric' || candidate.type === 'price' ? 1 : 0,
    __candidateCount: 1,
  }
}

function compareSectionEntities(first, second) {
  const scoreDiff = getSectionEntityScore(second) - getSectionEntityScore(first)
  if (scoreDiff !== 0) return scoreDiff
  return (first.yRatio ?? 1) - (second.yRatio ?? 1)
}

function shouldKeepSectionEntity(section) {
  if (!section) return false
  if (['hero', 'navigation', 'footer', 'legal', 'banner', 'cards'].includes(section.role)) return true
  if (normalizeCount(section.__candidateCount, 0) >= 2) return true
  if (normalizeCount(section.__actionCount, 0) + normalizeCount(section.__imageCount, 0) + normalizeCount(section.__videoCount, 0) >= 1) return true
  if (normalizeCount(section.__headingCount, 0) >= 1 && (section.widthRatio ?? 0) >= 0.4) return true
  if ((section.widthRatio ?? 0) >= 0.55 && (section.heightRatio ?? 0) >= 0.12) return true
  return false
}

function getSectionEntityScore(section) {
  let score = 0
  if (section.role === 'hero') score += 200
  if (section.role === 'navigation') score += 120
  if (section.role === 'legal') score += 60
  if (section.role === 'footer') score += 40
  score += normalizeCount(section.__headingCount, 0) * 18
  score += normalizeCount(section.__actionCount, 0) * 14
  score += normalizeCount(section.__imageCount, 0) * 12
  score += normalizeCount(section.__videoCount, 0) * 14
  score += normalizeCount(section.__textCount, 0) * 3
  score += Math.max(0, 50 - Math.round((section.yRatio ?? 1) * 100))
  return score
}

function inferSectionRole({ source, searchable, explicitSection, text }) {
  const explicit = normalizeString(explicitSection).toLowerCase()
  if (explicit === 'navigation') return 'navigation'
  if (explicit === 'legal') return 'legal'
  if (explicit === 'footer') return 'footer'
  if (explicit === 'banner') return 'banner'
  if (explicit === 'cards') return 'cards'
  if (explicit === 'content') return 'content'
  if (explicit === 'hero') return 'hero'
  if (/nav|navigation|gnb|menu|header/.test(searchable)) return 'navigation'
  if (/legal|copyright|terms|privacy|cookie|disclaimer|약관|개인정보/.test(searchable)) return 'legal'
  if (/footer/.test(searchable)) return 'footer'
  if (/banner|promo|promotion/.test(searchable)) return 'banner'
  if (/hero|kv|banner|main.?visual/.test(searchable)) return 'hero'
  if (/card|swiper|carousel|slider/.test(searchable)) return 'cards'
  if (source === 'web' && /main|section|article|content|form|benefit|offer/.test(searchable)) return 'content'
  if (source === 'figma' && /section|content|benefit|offer|smart|advisor/.test(searchable)) return 'content'
  if (text) return 'content'
  return 'unknown'
}

function getFigmaSectionPath(value) {
  return buildFigmaCumulativePaths(value)[0] || 'unknown'
}

function getWebSectionPath(value, explicitSection) {
  const explicit = normalizeString(explicitSection)
  if (explicit === 'hero' || explicit === 'navigation' || explicit === 'footer') return explicit
  const normalized = normalizeString(value)
  if (!normalized) return explicit || 'unknown'
  return buildWebCumulativePaths(normalized).find((item) => !/^body$|^html$|^main$|^body > main$/i.test(item)) || explicit || 'unknown'
}

function finalizeSectionEntities(sections, canonicalEvidence, heroSections) {
  const finalized = sections.map((section) => ({
    sectionId: section.sectionId,
    source: section.source,
    role: resolveFinalSectionRole(section, heroSections),
    rootSourceId: section.rootSourceId,
    path: section.path,
    parentSectionId: section.parentSectionId || null,
    xRatio: section.xRatio,
    yRatio: section.yRatio,
    widthRatio: section.widthRatio,
    heightRatio: section.heightRatio,
    spatialEvidence: section.spatialEvidence || createSpatialEvidence({
      sectionId: section.sectionId,
      sectionRootId: section.rootSourceId,
      sectionPath: section.path,
      xRatio: section.xRatio,
      yRatio: section.yRatio,
      widthRatio: section.widthRatio,
      heightRatio: section.heightRatio,
    }),
    entityIds: [],
    textEntityIds: [],
    actionEntityIds: [],
    numericEntityIds: [],
    mediaEntityIds: [],
    confidence: section.confidence,
    reasons: uniqueStrings(section.sectionId === heroSections.figmaSectionId || section.sectionId === heroSections.webSectionId
      ? [...(section.reasons || []), 'selected as hero section']
      : section.reasons || []),
  }))

  const sectionMap = new Map(finalized.map((section) => [section.sectionId, section]))
  canonicalEvidence.texts.forEach((entity) => {
    const section = sectionMap.get(entity.sectionId)
    if (!section) return
    section.entityIds.push(entity.entityId)
    section.textEntityIds.push(entity.entityId)
  })
  canonicalEvidence.actions.forEach((entity) => {
    const section = sectionMap.get(entity.sectionId)
    if (!section) return
    section.entityIds.push(entity.entityId)
    section.actionEntityIds.push(entity.entityId)
  })
  canonicalEvidence.numericValues.forEach((entity) => {
    const section = sectionMap.get(entity.sectionId)
    if (!section) return
    section.entityIds.push(entity.entityId)
    section.numericEntityIds.push(entity.entityId)
  })
  canonicalEvidence.media.forEach((entity) => {
    const section = sectionMap.get(entity.sectionId)
    if (!section) return
    section.entityIds.push(entity.entityId)
    section.mediaEntityIds.push(entity.entityId)
  })

  return finalized.sort(compareSectionEntities)
}

function pruneFinalSectionEntities(sections) {
  return (Array.isArray(sections) ? sections : []).filter((section) => {
    const entityCount = Array.isArray(section?.entityIds) ? section.entityIds.length : 0
    const actionCount = Array.isArray(section?.actionEntityIds) ? section.actionEntityIds.length : 0
    const mediaCount = Array.isArray(section?.mediaEntityIds) ? section.mediaEntityIds.length : 0
    const numericCount = Array.isArray(section?.numericEntityIds) ? section.numericEntityIds.length : 0
    if (section?.role === 'hero') return true
    if (entityCount === 0) return false
    if (actionCount > 0 || mediaCount > 0 || numericCount > 0) return true
    if (entityCount >= 2) return true
    return false
  })
}

function resolveFinalSectionRole(section, heroSections) {
  const isSelectedHero = section.sectionId === heroSections.figmaSectionId || section.sectionId === heroSections.webSectionId
  if (isSelectedHero) return 'hero'
  if (section.role === 'hero') return /banner|visual|main/.test(normalizeString(section.path).toLowerCase()) ? 'banner' : 'content'
  return section.role
}

function createCanonicalCtaButtons(actions) {
  const hero = actions.filter((item) => isCtaRole(item.role) && item.comparisonScope === 'primary' && normalizeString(item.text || item.displayText)).slice(0, MAX_HERO_ACTIONS)
  const content = actions.filter((item) => isComparisonActionEntity(item) && item.comparisonScope === 'secondary' && !hero.includes(item)).slice(0, MAX_CONTENT_ACTIONS)
  return [...hero, ...content]
}

function createCanonicalActionEntities(rawCandidates, sections, heroSections, quality) {
  const canonical = []

  rawCandidates.forEach((candidate) => {
    const section = resolveSectionForCandidate(candidate, sections)
    const normalized = {
      ...candidate,
      sectionId: section?.sectionId || '',
      sectionRootId: section?.rootSourceId || '',
      sectionPath: section?.path || '',
      sectionRole: section?.role || 'unknown',
    }
    recordActionMergeTrace(normalized, canonical, quality)
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
  const section = createSectionStub(candidate)
  const spatialEvidence = createSpatialEvidence(candidate)
  return {
    entityId: `action:${candidate.source}:${candidate.sourceId || candidate.selector || normalizeComparableText(candidate.text)}`,
    type: 'action',
    source: candidate.source,
    role: candidate.role,
    text: candidate.text,
    displayText: candidate.displayText,
    href: candidate.href || '',
    selector: candidate.selector || '',
    selectorSignature: candidate.selectorSignature || createSelectorSignature(candidate.selector || candidate.contextPath || candidate.context),
    contextPath: candidate.contextPath || candidate.context || '',
    parentSelector: candidate.parentSelector || '',
    layerPath: candidate.layerPath || '',
    parentId: candidate.parentId || '',
    sectionId: candidate.sectionId || '',
    sectionRootId: candidate.sectionRootId || '',
    sectionPath: candidate.sectionPath || '',
    comparisonScope: determineEntityComparisonScope({ type: 'action', candidate, section, heroSections }),
    confidence: candidate.confidence,
    reasons: uniqueStrings(candidate.reasons || []),
    xRatio: normalizeNumber(candidate.xRatio),
    yRatio: normalizeNumber(candidate.yRatio),
    widthRatio: normalizeNumber(candidate.widthRatio),
    heightRatio: normalizeNumber(candidate.heightRatio),
    x: normalizeNumber(candidate.x),
    y: normalizeNumber(candidate.y),
    width: normalizeNumber(candidate.width),
    height: normalizeNumber(candidate.height),
    spatialEvidence,
    interactionEvidence: Array.isArray(candidate.interactionEvidence) ? candidate.interactionEvidence : [],
    sources: [buildSourceEvidence(candidate)],
    isHeroAction: candidate.sectionId === heroSections.figmaSectionId || candidate.sectionId === heroSections.webSectionId,
  }
}

function mergeCanonicalActionEntity(entity, candidate, quality) {
  const previousSelector = entity.selector
  const previousSelectorSignature = entity.selectorSignature
  entity.sources.push(buildSourceEvidence(candidate))
  entity.sources = dedupeSourceEvidence(entity.sources)
  entity.reasons = uniqueStrings([...entity.reasons, ...(candidate.reasons || [])])
  entity.interactionEvidence = uniqueStrings([...(entity.interactionEvidence || []), ...(candidate.interactionEvidence || [])])
  if (getActionRepresentativeScore(candidate) > getActionRepresentativeScore(entity)) {
    entity.text = candidate.text || entity.text
    entity.displayText = candidate.displayText || entity.displayText
    entity.href = candidate.href || entity.href
    entity.selector = candidate.selector || entity.selector
    entity.selectorSignature = candidate.selectorSignature || entity.selectorSignature
    entity.contextPath = candidate.contextPath || entity.contextPath
    entity.parentSelector = candidate.parentSelector || entity.parentSelector
    entity.layerPath = candidate.layerPath || entity.layerPath
    entity.parentId = candidate.parentId || entity.parentId
    entity.confidence = candidate.confidence || entity.confidence
    entity.xRatio = normalizeNumber(candidate.xRatio)
    entity.yRatio = normalizeNumber(candidate.yRatio)
    entity.widthRatio = normalizeNumber(candidate.widthRatio)
    entity.heightRatio = normalizeNumber(candidate.heightRatio)
    entity.x = normalizeNumber(candidate.x)
    entity.y = normalizeNumber(candidate.y)
    entity.width = normalizeNumber(candidate.width)
    entity.height = normalizeNumber(candidate.height)
  }
  if (candidate.source === 'web') {
    quality.webActionSourcesMergedCount += 1
    if (previousSelector !== candidate.selector && hasEquivalentSelectorSignature(previousSelectorSignature, candidate.selectorSignature)) quality.webSelectorSignatureMergedCount += 1
  }
  if (candidate.source === 'figma') quality.figmaNestedActionMergedCount += 1
}

function isSameCanonicalAction(entity, candidate) {
  if (!entity || !candidate) return false
  if (entity.source !== candidate.source) return false
  if (entity.source === 'web') {
    const sameSelector = normalizeSelector(entity.selector) && normalizeSelector(entity.selector) === normalizeSelector(candidate.selector)
    const sameSelectorSignature = hasEquivalentSelectorSignature(entity.selectorSignature, candidate.selectorSignature)
    const sameHref = normalizeString(entity.href) === normalizeString(candidate.href)
    const sameText = normalizeComparableText(entity.text) === normalizeComparableText(candidate.text)
    const sameSectionId = normalizeString(entity.sectionId) === normalizeString(candidate.sectionId)
    const sameSectionContext = sameSectionId
      || hasEquivalentSelectorSignature(entity.parentSelector, candidate.parentSelector)
      || hasEquivalentSelectorSignature(entity.sectionPath, candidate.sectionPath)
    const similarSize = hasSimilarSize(entity.widthRatio, candidate.widthRatio, entity.heightRatio, candidate.heightRatio, entity.width, candidate.width, entity.height, candidate.height)
    return sameText
      && sameHref
      && sameSectionContext
      && hasSimilarPosition(entity.yRatio, candidate.yRatio)
      && (sameSelector || sameSelectorSignature || similarSize)
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
    parentSelector: candidate.parentSelector || '',
    contextPath: candidate.contextPath || candidate.context || '',
    selectorSignature: candidate.selectorSignature || createSelectorSignature(candidate.selector || candidate.contextPath || candidate.context),
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
      sectionRootId: section?.rootSourceId || '',
      sectionPath: section?.path || '',
      sectionRole: section?.role || 'unknown',
      isHeroNumeric: section?.sectionId === heroSections.figmaSectionId || section?.sectionId === heroSections.webSectionId,
    }
    recordNumericMergeTrace(normalized, canonical, quality)
    const existing = canonical.find((entity) => isSameCanonicalNumeric(entity, normalized))
    if (!existing) {
      canonical.push(createCanonicalNumericEntity(normalized, heroSections))
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
      existing.xRatio = normalized.xRatio
      existing.yRatio = normalized.yRatio
    }
    quality.duplicateNumericMergedCount += 1
  })

  quality.canonicalNumericCount = canonical.length
  return canonical
}

function createCanonicalNumericEntity(candidate, heroSections) {
  const section = createSectionStub(candidate)
  const spatialEvidence = createSpatialEvidence(candidate)
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
    selector: candidate.selector || '',
    selectorSignature: candidate.selectorSignature || createSelectorSignature(candidate.selector || candidate.contextPath || candidate.context),
    contextPath: candidate.contextPath || candidate.context || '',
    parentSelector: candidate.parentSelector || '',
    sectionId: candidate.sectionId || '',
    sectionRootId: candidate.sectionRootId || '',
    sectionPath: candidate.sectionPath || '',
    comparisonScope: determineEntityComparisonScope({ type: 'numeric', candidate, section, heroSections }),
    confidence: candidate.confidence,
    reasons: uniqueStrings(candidate.reasons || []),
    xRatio: candidate.xRatio,
    yRatio: candidate.yRatio,
    spatialEvidence,
    sources: [buildSourceEvidence(candidate)],
  }
}

function isSameCanonicalNumeric(entity, candidate) {
  return entity.source === candidate.source
    && entity.numericType === candidate.numericType
    && normalizeComparableText(entity.displayText) === normalizeComparableText(candidate.displayText)
    && JSON.stringify(entity.numericTokens) === JSON.stringify(candidate.numericTokens)
    && JSON.stringify(entity.unitTokens) === JSON.stringify(candidate.unitTokens)
    && hasSimilarPosition(entity.yRatio, candidate.yRatio)
    && (hasSimilarXAxis(entity.xRatio, candidate.xRatio) || hasSameNumericParentChain(entity, candidate))
}

function getNumericRepresentativeScore(candidate) {
  let score = getCandidateScore(candidate)
  const searchable = `${candidate.selector || ''} ${candidate.context || ''}`.toLowerCase()
  if (/active|current/.test(searchable)) score += 20
  if (/duplicate/.test(searchable)) score -= 40
  if ((candidate.fullContextText || '').length < 60) score += 10
  return score
}

function createCanonicalMediaEntities(rawMedia, sections, heroSections, quality) {
  const canonical = []
  rawMedia.forEach((candidate) => {
    const section = resolveSectionForCandidate(candidate, sections)
    const normalized = {
      ...candidate,
      sectionId: section?.sectionId || '',
      sectionRootId: section?.rootSourceId || '',
      sectionPath: section?.path || '',
      sectionRole: section?.role || 'unknown',
    }
    const existing = canonical.find((entity) => isSameCanonicalMedia(entity, normalized))
    if (!existing) {
      const role = classifyHeroMediaRole(normalized)
      const spatialEvidence = createSpatialEvidence(normalized)
      canonical.push({
        entityId: `media:${normalized.source}:${normalized.sourceId || normalized.selector || normalized.layerPath}`,
        entityType: 'media',
        type: normalized.type,
        mediaType: normalized.type,
        source: normalized.source,
        text: normalized.text,
        selector: normalized.selector || '',
        selectorSignature: normalized.selectorSignature || createSelectorSignature(normalized.selector || normalized.contextPath || normalized.context),
        contextPath: normalized.contextPath || normalized.context || '',
        parentSelector: normalized.parentSelector || '',
        autoplay: normalized.autoplay === true,
        controls: normalized.controls === true,
        sectionId: normalized.sectionId,
        sectionRootId: normalized.sectionRootId,
        sectionPath: normalized.sectionPath,
        confidence: normalized.confidence,
        reasons: uniqueStrings(normalized.reasons || []),
        xRatio: normalized.xRatio,
        yRatio: normalized.yRatio,
        widthRatio: normalized.widthRatio,
        heightRatio: normalized.heightRatio,
        x: normalized.x,
        y: normalized.y,
        width: normalized.width,
        height: normalized.height,
        spatialEvidence,
        role,
        comparisonScope: determineEntityComparisonScope({ type: 'media', candidate: normalized, section: createSectionStub(normalized), heroSections, mediaRole: role }),
        sources: [buildSourceEvidence(normalized)],
        isHeroPrimary: normalized.sectionId === heroSections.figmaSectionId || normalized.sectionId === heroSections.webSectionId,
      })
      return
    }
    const previousSelector = existing.selector
    const previousSelectorSignature = existing.selectorSignature
    existing.sources.push(buildSourceEvidence(normalized))
    existing.sources = dedupeSourceEvidence(existing.sources)
    if (normalized.source === 'web' && previousSelector !== normalized.selector && hasEquivalentSelectorSignature(previousSelectorSignature, normalized.selectorSignature)) quality.webSelectorSignatureMergedCount += 1
  })
  return canonical
}

function isSameCanonicalMedia(entity, candidate) {
  return entity.source === candidate.source
    && entity.mediaType === candidate.type
    && (normalizeString(entity.sectionPath) === normalizeString(candidate.sectionPath) || hasEquivalentSelectorSignature(entity.selectorSignature, candidate.selectorSignature))
    && (normalizeString(entity.text) === normalizeString(candidate.text)
      || normalizeString(entity.entityId).endsWith(normalizeString(candidate.sourceId))
      || hasEquivalentSelectorSignature(entity.selectorSignature, candidate.selectorSignature))
}

function resolveSectionForCandidate(candidate, sections) {
  if (candidate?.sectionDescriptor?.sectionId) {
    return sections.find((section) => section.sectionId === candidate.sectionDescriptor.sectionId)
      || createSectionStub({
        sectionId: candidate.sectionDescriptor.sectionId,
        rootSourceId: candidate.sectionDescriptor.rootSourceId,
        sectionPath: candidate.sectionDescriptor.path,
        sectionRole: candidate.sectionDescriptor.role,
      })
  }
  const source = candidate?.source
  const path = source === 'figma'
    ? getFigmaSectionPath(candidate.layerPath || candidate.context || candidate.parentContext)
    : getWebSectionPath(candidate.parentContext || candidate.context || candidate.selector || candidate.layerPath, candidate.section)
  return sections.find((section) => section.source === source && section.path === path)
    || sections.find((section) => section.source === source && normalizeComparableSectionPath(section.path) === normalizeComparableSectionPath(path))
    || sections.find((section) => section.source === source && section.role === candidate.section)
    || null
}

function createCanonicalTextHints({ textCandidates }) {
  return {
    texts: (Array.isArray(textCandidates) ? textCandidates : []).map((candidate) => ({
      entityId: `text:${candidate.source}:${candidate.sourceId || candidate.selector || candidate.layerPath || normalizeComparableText(candidate.text)}`,
      source: candidate.source,
      text: candidate.text,
      selector: candidate.selector || '',
      selectorSignature: candidate.selectorSignature || createSelectorSignature(candidate.selector || candidate.contextPath || candidate.context),
      parentSelector: candidate.parentSelector || '',
      contextPath: candidate.contextPath || candidate.context || '',
      layerPath: candidate.layerPath || '',
      parentId: candidate.parentId || '',
      sectionId: candidate?.sectionDescriptor?.sectionId || '',
      sectionRootId: candidate?.sectionDescriptor?.rootSourceId || '',
      sectionPath: candidate?.sectionDescriptor?.path || '',
      role: mapTextEntityRole(candidate),
      xRatio: normalizeNumber(candidate.xRatio),
      yRatio: normalizeNumber(candidate.yRatio),
      widthRatio: normalizeNumber(candidate.widthRatio),
      heightRatio: normalizeNumber(candidate.heightRatio),
      x: normalizeNumber(candidate.x),
      y: normalizeNumber(candidate.y),
      width: normalizeNumber(candidate.width),
      height: normalizeNumber(candidate.height),
      spatialEvidence: createSpatialEvidence({
        ...candidate,
        sectionId: candidate?.sectionDescriptor?.sectionId || '',
        sectionRootId: candidate?.sectionDescriptor?.rootSourceId || '',
        sectionPath: candidate?.sectionDescriptor?.path || '',
      }),
      sourceIds: uniqueStrings([candidate.sourceId]),
    })),
  }
}

function remapCanonicalEvidenceToSelectedHeroes({ actions, numericValues, media, texts, heroSelection }) {
  return {
    actions: remapCanonicalEntitiesToHero(actions, heroSelection),
    numericValues: remapCanonicalEntitiesToHero(numericValues, heroSelection),
    media: remapCanonicalEntitiesToHero(media, heroSelection),
    texts: remapCanonicalEntitiesToHero(texts, heroSelection),
  }
}

function remapCanonicalEntitiesToHero(entities, heroSelection) {
  return (Array.isArray(entities) ? entities : []).map((entity) => {
    const heroDescriptor = resolveHeroDescriptorForEntity(entity, heroSelection)
    if (!heroDescriptor) return entity
    const mediaRole = entity.entityType === 'media' ? classifyHeroMediaRole(entity) : entity.role
    return {
      ...entity,
      sectionId: heroDescriptor.sectionId,
      sectionRootId: heroDescriptor.rootSourceId,
      sectionPath: heroDescriptor.path,
      sectionRole: heroDescriptor.role,
      isHeroAction: entity.type === 'action' ? isCtaRole(entity.role) : entity.isHeroAction,
      isHeroPrimary: entity.entityType === 'media' ? true : entity.isHeroPrimary,
      role: entity.entityType === 'media' ? mediaRole : entity.role,
      comparisonScope: entity.comparisonScope === 'reference-only' || entity.comparisonScope === 'excluded'
        ? entity.comparisonScope
        : 'primary',
    }
  })
}

function resolveHeroDescriptorForEntity(entity, heroSelection) {
  if (!entity) return null
  if (entity.source === 'figma' && heroSelection?.figmaHeroDescriptor && isEntityWithinHeroDescriptor(entity, heroSelection.figmaHeroDescriptor)) return heroSelection.figmaHeroDescriptor
  if (entity.source === 'web' && heroSelection?.webHeroDescriptor && isEntityWithinHeroDescriptor(entity, heroSelection.webHeroDescriptor)) return heroSelection.webHeroDescriptor
  return null
}

function isEntityWithinHeroDescriptor(entity, descriptor) {
  if (!entity || !descriptor) return false
  if (descriptor.source === 'web') return matchesWebHeroAncestry(entity, descriptor.path)
  return isCandidateUnderAnchor(entity, descriptor.source, descriptor.path)
}

function mapTextEntityRole(candidate) {
  if (candidate?.role === 'heading') return 'heading'
  if (candidate?.role === 'price' || candidate?.type === 'price') return 'price'
  if (candidate?.role === 'navigation' || candidate?.section === 'navigation') return 'navigation'
  if (candidate?.section === 'legal') return 'legal'
  if (candidate?.role === 'cta') return 'label'
  return 'body'
}

function createSectionStub(candidate) {
  return {
    sectionId: candidate?.sectionId || '',
    rootSourceId: candidate?.sectionRootId || candidate?.rootSourceId || '',
    path: candidate?.sectionPath || candidate?.path || '',
    role: candidate?.sectionRole || candidate?.role || 'unknown',
  }
}

function determineEntityComparisonScope({ type, candidate, section, heroSections, mediaRole }) {
  const sectionRole = section?.role || candidate?.sectionRole || 'unknown'
  const isHeroSection = candidate?.sectionId === heroSections?.figmaSectionId || candidate?.sectionId === heroSections?.webSectionId
  if (['navigation', 'footer', 'legal'].includes(sectionRole)) return 'reference-only'
  if (type === 'action') {
    if (['navigation', 'tab', 'utility-control'].includes(candidate?.role)) return 'reference-only'
    if (['media-control', 'carousel-control', 'unknown-interactive'].includes(candidate?.role)) return 'excluded'
    if (candidate?.role === 'form-control') return 'secondary'
    if (!isComparisonActionRole(candidate?.role)) return 'excluded'
    return isHeroSection ? 'primary' : 'secondary'
  }
  if (type === 'media') {
    if (mediaRole === 'control/icon' || mediaRole === 'decorative') return 'excluded'
    return isHeroSection ? 'primary' : 'secondary'
  }
  if (type === 'numeric') {
    return isHeroSection ? 'primary' : 'secondary'
  }
  return 'excluded'
}

function isComparisonActionRole(role) {
  return role === 'primary-action' || role === 'secondary-action' || role === 'form-control'
}

function isComparisonActionEntity(entity) {
  return ['primary', 'secondary'].includes(entity?.comparisonScope) && isComparisonActionRole(entity?.role)
}

function createComparisonNumericValues(numericValues) {
  return (Array.isArray(numericValues) ? numericValues : []).filter((item) => ['primary', 'secondary'].includes(item.comparisonScope))
}

function createComparisonMedia(media) {
  return (Array.isArray(media) ? media : []).filter((item) => ['primary', 'secondary'].includes(item.comparisonScope))
}

function createSectionTrace({ sections, heroSections, canonicalEvidence }) {
  const figmaHero = sections.find((item) => item.sectionId === heroSections.figmaSectionId) || null
  const webHero = sections.find((item) => item.sectionId === heroSections.webSectionId) || null
  const allEntities = [
    ...(canonicalEvidence?.actions || []),
    ...(canonicalEvidence?.numericValues || []),
    ...(canonicalEvidence?.media || []),
    ...(canonicalEvidence?.texts || []),
  ]

  return {
    figmaHero: buildHeroSectionTrace(figmaHero),
    webHero: buildHeroSectionTrace(webHero),
    unassignedEntityCount: allEntities.filter((item) => !normalizeString(item?.sectionId)).length,
    multiAssignedEntityCount: 0,
  }
}

function createFigmaActionInputTrace({ figmaAnalysis, heroSelection, rawFigmaActions }) {
  const flatNodes = Array.isArray(figmaAnalysis?.flatNodes) ? figmaAnalysis.flatNodes : []
  const indexes = buildFigmaNodeIndexes(flatNodes)
  const heroDescriptor = heroSelection?.figmaHeroDescriptor || null
  const heroRootPath = normalizeString(heroDescriptor?.path)
  const heroRootId = normalizeString(heroDescriptor?.rootSourceId)
  const heroDescendants = flatNodes.filter((node) => heroRootPath && isCandidateUnderAnchor(node, 'figma', heroRootPath))
  const buttonLikeNodes = heroDescendants.filter(isFigmaButtonLikeTraceNode)
  const interactiveNodes = heroDescendants.filter((node) => node?.isInteractiveCandidate === true || node?.hasPrototypeInteractions === true || node?.hasReactions === true)
  const rawActionIds = new Set((Array.isArray(rawFigmaActions) ? rawFigmaActions : []).map((item) => normalizeString(item?.sourceId)).filter(Boolean))
  const traceNodes = heroDescendants
    .filter((node) => shouldIncludeFigmaActionTraceNode(node))
    .slice(0, 20)
    .map((node) => {
      const descendantTextNodes = getFigmaDescendantTextNodes(node, indexes)
      const descendantTexts = descendantTextNodes.map((child) => normalizeString(child?.characters)).filter(Boolean)
      const candidateCreated = rawActionIds.has(normalizeString(node?.nodeId || node?.id))
      const rejectionReasons = candidateCreated ? [] : classifyFigmaActionTraceExclusion(node, descendantTexts, flatNodes, indexes)
      return {
        id: normalizeString(node?.id),
        type: normalizeString(node?.type),
        name: normalizeString(node?.name),
        layerPath: normalizeString(node?.layerPath),
        parentId: normalizeString(node?.parentId),
        childCount: normalizeCount(node?.childCount, 0),
        directChildIds: getDirectFigmaChildNodes(node, indexes).map((child) => normalizeString(child?.nodeId || child?.id)).filter(Boolean),
        descendantNodeIdsPreview: collectFigmaSubtreeNodes(node, indexes).map((child) => normalizeString(child?.nodeId || child?.id)).filter(Boolean).slice(0, 10),
        descendantTextIdsPreview: descendantTextNodes.map((child) => normalizeString(child?.nodeId || child?.id)).filter(Boolean).slice(0, 10),
        isInteractiveCandidate: node?.isInteractiveCandidate === true,
        hasPrototypeInteractions: node?.hasPrototypeInteractions === true || normalizeCount(node?.prototypeInteractionCount, 0) > 0,
        hasReactions: node?.hasReactions === true || normalizeCount(node?.reactionCount, 0) > 0,
        widthRatio: normalizeNumber(node?.widthRatio),
        heightRatio: normalizeNumber(node?.heightRatio),
        subtreeTextIsolationPassed: descendantTextNodes.every((child) => {
          const childId = normalizeString(child?.nodeId || child?.id)
          const parentChain = indexes.parentChainByNodeId?.get(childId) || []
          return parentChain.includes(normalizeString(node?.nodeId || node?.id))
        }),
        descendantTextPreview: descendantTexts.slice(0, 3),
        candidateCreated,
        excludedReason: candidateCreated ? null : (rejectionReasons[0] || 'filtered-before-canonicalization'),
        rejectionReasons,
      }
    })

  return {
    heroRootId,
    heroRootPath,
    heroDescendantNodeCount: heroDescendants.length,
    buttonLikeNodeCount: buttonLikeNodes.length,
    interactiveCandidateCount: interactiveNodes.length,
    rawActionCandidateCount: traceNodes.filter((node) => node.candidateCreated).length,
    nodes: traceNodes,
  }
}

function shouldIncludeFigmaActionTraceNode(node) {
  if (!node) return false
  if (['INSTANCE', 'COMPONENT', 'FRAME', 'TEXT'].includes(normalizeString(node?.type))) return true
  if (isFigmaButtonLikeTraceNode(node)) return true
  if (node?.isInteractiveCandidate === true) return true
  if (normalizeCount(node?.prototypeInteractionCount, 0) > 0 || normalizeCount(node?.reactionCount, 0) > 0 || node?.hasTransitionTarget === true) return true
  return false
}

function isFigmaButtonLikeTraceNode(node) {
  const searchable = `${node?.name || ''} ${node?.layerPath || ''}`.toLowerCase()
  return /button|btn|action|cta|component/.test(searchable)
}

function classifyFigmaActionTraceExclusion(node, descendantTexts, flatNodes, indexes = buildFigmaNodeIndexes(flatNodes)) {
  if (!node?.effectivelyVisible) return ['not-visible']
  if (!['FRAME', 'INSTANCE', 'COMPONENT'].includes(normalizeString(node?.type))) return ['unsupported-type']
  const interactionEvidence = buildFigmaInteractionEvidence(node, indexes.childMap)
  const compactActionLabel = descendantTexts.length > 0 && descendantTexts.every(isCompactActionLabel)
  const hasInteraction = node?.isInteractiveCandidate === true || normalizeCount(node?.prototypeInteractionCount, 0) > 0 || normalizeCount(node?.reactionCount, 0) > 0 || node?.hasTransitionTarget === true
  const looksButtonLike = /button|btn|cta|action|link/.test(`${node?.name || ''} ${node?.layerPath || ''}`.toLowerCase())
  const hasButtonStructure = compactActionLabel
    && (looksButtonLike
      || interactionEvidence.includes('button-sized container')
      || interactionEvidence.includes('shape-backed control')
      || interactionEvidence.includes('repeated sibling action component'))
  if (!hasInteraction && !hasButtonStructure) return ['no-button-or-interaction-signal']
  const rejectionReasons = getFigmaActionRejectionReasons(node, descendantTexts, indexes.childMap)
  if (rejectionReasons.length > 0) return rejectionReasons
  if (!compactActionLabel) return ['no-compact-descendant-label']
  return ['filtered-before-canonicalization']
}

function createWebVideoPipelineTrace({ webAnalysis, rawVideos, annotatedRawVideos, canonicalEvidence }) {
  const scanResultVideos = Array.isArray(webAnalysis?.scanResult?.visualPayloadData?.videoCandidates) ? webAnalysis.scanResult.visualPayloadData.videoCandidates : []
  const visualPayloadDataVideos = Array.isArray(webAnalysis?.scanResult?.visualPayloadData?.videoCandidates) ? webAnalysis.scanResult.visualPayloadData.videoCandidates : []
  const webAnalysisVideos = Array.isArray(webAnalysis?.videoCandidates) ? webAnalysis.videoCandidates : []
  const payloadInputVideos = (Array.isArray(rawVideos) ? rawVideos : []).filter((item) => item?.source === 'web')
  const rawMediaCandidates = (Array.isArray(annotatedRawVideos) ? annotatedRawVideos : []).filter((item) => item?.source === 'web')
  const canonicalMediaVideos = (Array.isArray(canonicalEvidence?.media) ? canonicalEvidence.media : []).filter((item) => item?.source === 'web' && item?.mediaType === 'video')

  return {
    scanResultCount: scanResultVideos.length,
    visualPayloadDataCount: visualPayloadDataVideos.length,
    webAnalysisCount: webAnalysisVideos.length,
    payloadInputCount: payloadInputVideos.length,
    rawMediaCandidateCount: rawMediaCandidates.length,
    canonicalMediaCount: canonicalMediaVideos.length,
    items: [
      ...createWebVideoTraceStageItems('scanResult', scanResultVideos),
      ...createWebVideoTraceStageItems('visualPayloadData', visualPayloadDataVideos),
      ...createWebVideoTraceStageItems('webAnalysis', webAnalysisVideos),
      ...createWebVideoTraceStageItems('payloadInput', payloadInputVideos),
      ...createWebVideoTraceStageItems('rawMediaCandidate', rawMediaCandidates),
      ...createWebVideoTraceStageItems('canonicalMedia', canonicalMediaVideos),
    ].slice(0, 30),
  }
}

function createWebVideoTraceStageItems(stage, items) {
  return (Array.isArray(items) ? items : []).slice(0, 5).map((item) => ({
    stage,
    sourceId: normalizeString(item?.sourceId || item?.selector),
    selector: normalizeString(item?.selector),
    parentSelector: normalizeString(item?.parentSelector),
    contextPath: normalizeString(item?.contextPath || item?.domPath || item?.context),
    visible: item?.visible !== false,
    autoplay: item?.autoplay === true,
    controls: item?.controls === true,
  }))
}

function createEntitySectionTrace({ rawActions, annotatedRawActions, annotatedRawVideos, heroSelection, sectionContexts, canonicalEvidence }) {
  const figmaHeroActions = buildActionEntityTrace({
    source: 'figma',
    rawCandidates: rawActions,
    annotatedCandidates: annotatedRawActions,
    heroDescriptor: heroSelection?.figmaHeroDescriptor,
    sectionContexts,
    canonicalEntities: canonicalEvidence.actions,
  })
  const webHeroActions = buildActionEntityTrace({
    source: 'web',
    rawCandidates: rawActions,
    annotatedCandidates: annotatedRawActions,
    heroDescriptor: heroSelection?.webHeroDescriptor,
    sectionContexts,
    canonicalEntities: canonicalEvidence.actions,
  })
  const webHeroMedia = buildMediaEntityTrace({
    source: 'web',
    annotatedCandidates: annotatedRawVideos,
    heroDescriptor: heroSelection?.webHeroDescriptor,
    sectionContexts,
    canonicalEntities: canonicalEvidence.media,
  })
  const webVideoTrace = buildWebCanonicalVideoTrace({
    canonicalMedia: canonicalEvidence.media,
    heroDescriptor: heroSelection?.webHeroDescriptor,
  })
  return {
    figmaHeroActions,
    webHeroActions,
    webHeroMedia,
    webVideoTrace,
  }
}

function createHeroActionResolutionTrace({ heroSections, rawActions, canonicalActions, heroCtaGroup }) {
  const rawFigmaActions = (Array.isArray(rawActions) ? rawActions : []).filter((item) => item?.source === 'figma')
  const canonicalFigmaActions = (Array.isArray(canonicalActions) ? canonicalActions : []).filter((item) => item?.source === 'figma')
  const heroResolvedFigmaActions = canonicalFigmaActions.filter((item) => item.sectionId === heroSections.figmaSectionId)
  const heroGroupFigmaActions = Array.isArray(heroCtaGroup?.figma?.actions) ? heroCtaGroup.figma.actions : []

  return {
    stage1RawCandidates: rawFigmaActions.length,
    stage2Rejected: Math.max(0, rawFigmaActions.length - canonicalFigmaActions.length),
    stage3Canonical: canonicalFigmaActions.length,
    stage4HeroResolved: heroResolvedFigmaActions.length,
    stage5HeroGroup: heroGroupFigmaActions.length,
    stage1CandidateIds: rawFigmaActions.map((item) => item.sourceId || '').filter(Boolean).slice(0, 20),
    stage2RejectedIds: rawFigmaActions.filter((item) => !canonicalFigmaActions.some((entity) => Array.isArray(entity.sources) && entity.sources.some((source) => source.sourceId === item.sourceId))).map((item) => item.sourceId || '').filter(Boolean).slice(0, 20),
    stage3CanonicalIds: canonicalFigmaActions.map((item) => item.entityId || '').filter(Boolean).slice(0, 20),
    stage4HeroResolvedIds: heroResolvedFigmaActions.map((item) => item.entityId || '').filter(Boolean).slice(0, 20),
    stage5HeroGroupIds: heroGroupFigmaActions.map((item) => item.entityId || '').filter(Boolean).slice(0, 20),
    candidates: rawFigmaActions.slice(0, 20).map((candidate) => {
      const canonical = canonicalFigmaActions.find((entity) => Array.isArray(entity.sources) && entity.sources.some((source) => source.sourceId === candidate.sourceId)) || null
      const inHeroGroup = heroGroupFigmaActions.some((entity) => entity.entityId === canonical?.entityId)
      return {
        id: candidate.sourceId || '',
        parentId: candidate.parentId || '',
        layerPath: candidate.layerPath || '',
        nodeType: candidate.nodeType || '',
        isInteractiveCandidate: candidate.interactionEvidence?.includes('isInteractiveCandidate') || candidate.reasons?.includes('interactive prototype signal') || false,
        interactionSummary: {
          prototypeInteractionCount: normalizeCount(candidate.prototypeInteractionCount, 0),
          reactionCount: normalizeCount(candidate.reactionCount, 0),
          hasTransitionTarget: candidate.hasTransitionTarget === true,
        },
        descendantTexts: Array.isArray(candidate.subtreeTextIds) ? candidate.subtreeTextIds : [],
        rejectionReasons: canonical ? [] : ['not-canonicalized'],
        selectedStage: inHeroGroup ? 'hero-group' : canonical && canonical.sectionId === heroSections.figmaSectionId ? 'hero-resolved' : canonical ? 'canonical' : 'raw',
      }
    }),
  }
}

function createHeroMediaResolutionTrace({ heroSections, rawVideos, canonicalMedia, heroMediaGroup }) {
  const rawWebVideos = (Array.isArray(rawVideos) ? rawVideos : []).filter((item) => item?.source === 'web')
  const canonicalWebVideos = (Array.isArray(canonicalMedia) ? canonicalMedia : []).filter((item) => item?.source === 'web' && item?.mediaType === 'video')
  const heroResolvedVideos = canonicalWebVideos.filter((item) => item.sectionId === heroSections.webSectionId)
  const heroGroupVideos = Array.isArray(heroMediaGroup?.web?.primaryCandidates) ? heroMediaGroup.web.primaryCandidates : []

  return {
    stage1Candidates: rawWebVideos.length,
    stage2Canonical: canonicalWebVideos.length,
    stage3HeroResolved: heroResolvedVideos.length,
    stage4HeroGroup: heroGroupVideos.length,
    stage1CandidateIds: rawWebVideos.map((item) => item.sourceId || '').filter(Boolean).slice(0, 20),
    stage2CanonicalIds: canonicalWebVideos.map((item) => item.entityId || '').filter(Boolean).slice(0, 20),
    stage3HeroResolvedIds: heroResolvedVideos.map((item) => item.entityId || '').filter(Boolean).slice(0, 20),
    stage4HeroGroupIds: heroGroupVideos.map((item) => item.entityId || '').filter(Boolean).slice(0, 20),
    items: canonicalWebVideos.slice(0, 10).map((item) => ({
      sourceId: item.sources?.[0]?.sourceId || '',
      selector: item.selector || '',
      sectionId: item.sectionId || '',
      selectedStage: heroGroupVideos.some((candidate) => candidate.entityId === item.entityId)
        ? 'hero-group'
        : item.sectionId === heroSections.webSectionId
          ? 'hero-resolved'
          : 'canonical',
    })),
  }
}

function createCanonicalMergeTrace(quality) {
  return {
    actionPairs: Array.isArray(quality?.__trace?.actionMergePairs) ? quality.__trace.actionMergePairs.slice(0, 30) : [],
    numericPairs: Array.isArray(quality?.__trace?.numericMergePairs) ? quality.__trace.numericMergePairs.slice(0, 30) : [],
  }
}

function createActionPipelineTrace(heroActionResolution) {
  const trace = heroActionResolution || {}
  return {
    stage1RawCandidates: {
      count: normalizeCount(trace.stage1RawCandidates, 0),
      candidateIds: Array.isArray(trace.stage1CandidateIds) ? trace.stage1CandidateIds : [],
    },
    stage2Rejected: {
      count: normalizeCount(trace.stage2Rejected, 0),
      candidateIds: Array.isArray(trace.stage2RejectedIds) ? trace.stage2RejectedIds : [],
    },
    stage3Canonical: {
      count: normalizeCount(trace.stage3Canonical, 0),
      candidateIds: Array.isArray(trace.stage3CanonicalIds) ? trace.stage3CanonicalIds : [],
    },
    stage4HeroResolved: {
      count: normalizeCount(trace.stage4HeroResolved, 0),
      candidateIds: Array.isArray(trace.stage4HeroResolvedIds) ? trace.stage4HeroResolvedIds : [],
    },
    stage5HeroGroup: {
      count: normalizeCount(trace.stage5HeroGroup, 0),
      candidateIds: Array.isArray(trace.stage5HeroGroupIds) ? trace.stage5HeroGroupIds : [],
    },
  }
}

function createFigmaActionTrace(figmaActionInputTrace) {
  return Array.isArray(figmaActionInputTrace?.nodes)
    ? figmaActionInputTrace.nodes.map((node) => ({
      id: node.id || '',
      parentId: node.parentId || '',
      layerPath: node.layerPath || '',
      nodeType: node.type || '',
      isInteractiveCandidate: node.isInteractiveCandidate === true,
      interactionSummary: {
        hasPrototypeInteractions: node.hasPrototypeInteractions === true,
        hasReactions: node.hasReactions === true,
      },
      descendantTexts: Array.isArray(node.descendantTextPreview) ? node.descendantTextPreview : [],
      rejectionReasons: Array.isArray(node.rejectionReasons) ? node.rejectionReasons : [],
      selectedStage: node.candidateCreated ? 'raw-candidate' : 'rejected',
      heroAncestorMatched: true,
      heroRootId: figmaActionInputTrace?.heroRootId || '',
    }))
    : []
}

function createCtaMergeTrace(canonicalMergeTrace) {
  return Array.isArray(canonicalMergeTrace?.actionPairs)
    ? canonicalMergeTrace.actionPairs.map((pair) => ({
      leftId: pair.existingEntityId || '',
      rightId: pair.incomingSourceId || '',
      sameText: pair.sameText === true,
      sameHref: pair.sameHref === true,
      sameSelectorSignature: pair.sameSelectorSignature === true,
      samePosition: pair.samePosition === true,
      sameSection: pair.sameSection === true,
      merged: pair.merged === true,
      reason: pair.reason || '',
      finalRepresentativeId: pair.merged ? (pair.existingEntityId || '') : '',
    }))
    : []
}

function createNumericMergeTrace(canonicalMergeTrace) {
  return Array.isArray(canonicalMergeTrace?.numericPairs)
    ? canonicalMergeTrace.numericPairs.map((pair) => ({
      leftId: pair.existingEntityId || '',
      rightId: pair.incomingSourceId || '',
      sameNumericType: pair.sameNumericType === true,
      sameDisplayText: pair.sameDisplayText === true,
      sameTokens: pair.sameTokens === true,
      sameUnits: pair.sameUnits === true,
      sameContext: pair.sameContext === true,
      samePosition: pair.samePosition === true,
      merged: pair.merged === true,
      reason: pair.reason || '',
      representativeNumericId: pair.merged ? (pair.existingEntityId || '') : '',
    }))
    : []
}

function buildActionEntityTrace({ source, rawCandidates, annotatedCandidates, heroDescriptor, sectionContexts, canonicalEntities }) {
  const sourceRawCandidates = (Array.isArray(rawCandidates) ? rawCandidates : []).filter((candidate) => candidate?.source === source)
  const sourceAnnotatedCandidates = (Array.isArray(annotatedCandidates) ? annotatedCandidates : []).filter((candidate) => candidate?.source === source)
  return sourceRawCandidates
    .map((candidate) => {
      const originalDescriptor = createSectionDescriptorForCandidate(candidate, sectionContexts, null)
      const annotatedCandidate = sourceAnnotatedCandidates.find((item) => item.sourceId === candidate.sourceId && item.text === candidate.text) || null
      const resolvedEntity = findCanonicalEntityForCandidate(annotatedCandidate || candidate, canonicalEntities)
      const heroDescendant = Boolean(heroDescriptor && isCandidateWithinSectionDescriptor(candidate, heroDescriptor))
      return {
        sourceId: candidate.sourceId || '',
        text: candidate.text || '',
        originalSectionId: originalDescriptor?.sectionId || '',
        resolvedSectionId: resolvedEntity?.sectionId || annotatedCandidate?.sectionDescriptor?.sectionId || '',
        heroDescendant,
        excludedReason: heroDescendant && !resolvedEntity ? 'excluded-during-canonicalization' : null,
      }
    })
    .filter((item) => item.heroDescendant || item.excludedReason)
    .slice(0, 10)
}

function buildMediaEntityTrace({ source, annotatedCandidates, heroDescriptor, sectionContexts, canonicalEntities }) {
  return (Array.isArray(annotatedCandidates) ? annotatedCandidates : [])
    .filter((candidate) => candidate?.source === source)
    .map((candidate) => {
      const originalDescriptor = createSectionDescriptorForCandidate(candidate, sectionContexts, null)
      const resolvedEntity = findCanonicalEntityForCandidate(candidate, canonicalEntities)
      const heroDescendant = Boolean(heroDescriptor && isCandidateWithinSectionDescriptor(candidate, heroDescriptor))
      return {
        sourceId: candidate.sourceId || '',
        selector: candidate.selector || '',
        parentSelector: candidate.parentSelector || '',
        originalSectionId: originalDescriptor?.sectionId || '',
        resolvedSectionId: resolvedEntity?.sectionId || candidate?.sectionDescriptor?.sectionId || '',
        heroDescendant,
        excludedReason: heroDescendant && !resolvedEntity ? 'excluded-during-canonicalization' : null,
      }
    })
    .filter((item) => item.heroDescendant || item.excludedReason)
    .slice(0, 10)
}

function buildWebCanonicalVideoTrace({ canonicalMedia, heroDescriptor }) {
  const heroCanonicalAncestry = createCanonicalSelectorAncestry(heroDescriptor?.path || '')
  return (Array.isArray(canonicalMedia) ? canonicalMedia : [])
    .filter((item) => item?.source === 'web' && item?.mediaType === 'video')
    .slice(0, 10)
    .map((item) => {
      const candidateAncestry = createCanonicalSelectorAncestry(item?.contextPath || item?.selector || '')
      const parentAncestry = createCanonicalSelectorAncestry(item?.parentSelector || '')
      const selectorMatch = isCanonicalAncestryDescendant(candidateAncestry, heroCanonicalAncestry)
      const parentMatch = isCanonicalAncestryDescendant(parentAncestry, heroCanonicalAncestry)
      const comparisonDirection = selectorMatch || parentMatch ? 'candidate-descendant-of-hero' : 'no-ancestry-match'
      const ancestorMatchedAt = selectorMatch ? 'canonicalAncestry' : parentMatch ? 'parentSelector' : 'none'
      const matchedAncestor = selectorMatch ? findMatchedAncestorSegment(candidateAncestry, heroCanonicalAncestry) : parentMatch ? findMatchedAncestorSegment(parentAncestry, heroCanonicalAncestry) : ''
      return {
        sourceId: item.sourceId || '',
        selector: item.selector || '',
        canonicalAncestry: candidateAncestry,
        heroCanonicalAncestry: heroCanonicalAncestry,
        descendantMatchType: selectorMatch ? 'selector-ancestry' : parentMatch ? 'parent-selector-ancestry' : 'none',
        comparisonDirection,
        ancestorMatchedAt,
        matchedAncestor,
        heroDescendant: selectorMatch || parentMatch,
        resolvedSectionId: item.sectionId || '',
        excludedReason: selectorMatch || parentMatch ? null : 'hero-ancestry-mismatch',
      }
    })
}

function findMatchedAncestorSegment(candidateSegments, ancestorSegments) {
  const safeCandidate = Array.isArray(candidateSegments) ? candidateSegments : []
  const safeAncestor = Array.isArray(ancestorSegments) ? ancestorSegments : []
  for (let start = 0; start <= safeCandidate.length - safeAncestor.length; start += 1) {
    let matched = true
    for (let index = 0; index < safeAncestor.length; index += 1) {
      if (safeCandidate[start + index] !== safeAncestor[index]) {
        matched = false
        break
      }
    }
    if (matched) return safeAncestor.join(' > ')
  }
  return ''
}

function findCanonicalEntityForCandidate(candidate, canonicalEntities) {
  return (Array.isArray(canonicalEntities) ? canonicalEntities : []).find((entity) => {
    if (!entity || !candidate) return false
    if (entity.source !== candidate.source) return false
    if (Array.isArray(entity.sources) && entity.sources.some((source) => source.sourceId === candidate.sourceId)) return true
    return false
  }) || null
}

function buildHeroSectionTrace(section) {
  return {
    sectionId: section?.sectionId || '',
    rootSourceId: section?.rootSourceId || '',
    path: section?.path || '',
    textCount: Array.isArray(section?.textEntityIds) ? section.textEntityIds.length : 0,
    actionCount: Array.isArray(section?.actionEntityIds) ? section.actionEntityIds.length : 0,
    mediaCount: Array.isArray(section?.mediaEntityIds) ? section.mediaEntityIds.length : 0,
    reasons: Array.isArray(section?.reasons) ? section.reasons : [],
  }
}

function applyCanonicalQualityMetrics(quality, { heroCtaGroup, heroMediaGroup, canonicalEvidence, comparisonActions, comparisonPrices, comparisonMedia, sectionTrace, sections, heroSelection, entitySectionTrace, figmaActionInputTrace }) {
  const selectedFigmaHeroSectionId = sections.find((section) => section.source === 'figma' && section.role === 'hero')?.sectionId || ''
  const selectedWebHeroSectionId = sections.find((section) => section.source === 'web' && section.role === 'hero')?.sectionId || ''
  const finalFigmaHeroMediaCount = canonicalEvidence.media.filter((item) => item.source === 'figma' && item.sectionId === selectedFigmaHeroSectionId && item.comparisonScope === 'primary').length
  const finalWebHeroMediaCount = canonicalEvidence.media.filter((item) => item.source === 'web' && item.mediaType === 'video' && item.sectionId === selectedWebHeroSectionId).length
  quality.canonicalActionCount = canonicalEvidence.actions.length
  quality.canonicalNumericCount = canonicalEvidence.numericValues.length
  quality.webActionSourcesMergedCount = canonicalEvidence.actions.filter((item) => item.source === 'web' && Array.isArray(item.sources) && item.sources.length > 1).length
  quality.figmaHeroTextCount = normalizeCount(sectionTrace?.figmaHero?.textCount, 0)
  quality.webHeroTextCount = normalizeCount(sectionTrace?.webHero?.textCount, 0)
  quality.figmaHeroActionCount = heroCtaGroup.figma.count
  quality.webHeroActionCount = heroCtaGroup.web.count
  quality.figmaHeroMediaCount = normalizeCount(sectionTrace?.figmaHero?.mediaCount, 0)
  quality.webHeroMediaCount = normalizeCount(sectionTrace?.webHero?.mediaCount, 0)
  quality.figmaHeroCandidateCount = normalizeCount(heroSelection?.quality?.figmaHeroCandidateCount, 0)
  quality.webHeroCandidateCount = normalizeCount(heroSelection?.quality?.webHeroCandidateCount, 0)
  quality.figmaHeroRootPromotedCount = normalizeCount(heroSelection?.quality?.figmaHeroRootPromotedCount, 0)
  quality.webHeroRootPromotedCount = normalizeCount(heroSelection?.quality?.webHeroRootPromotedCount, 0)
  quality.figmaHeroContainsText = heroSelection?.quality?.figmaHeroContainsText === true
  quality.figmaHeroContainsAction = heroSelection?.quality?.figmaHeroContainsAction === true
  quality.figmaHeroContainsMedia = finalFigmaHeroMediaCount >= 1
  quality.webHeroContainsText = heroSelection?.quality?.webHeroContainsText === true
  quality.webHeroContainsAction = heroSelection?.quality?.webHeroContainsAction === true
  quality.webHeroContainsMedia = finalWebHeroMediaCount >= 1
  quality.figmaHeroDescendantNodeCount = normalizeCount(figmaActionInputTrace?.heroDescendantNodeCount, 0)
  quality.figmaButtonLikeNodeCount = normalizeCount(figmaActionInputTrace?.buttonLikeNodeCount, 0)
  quality.figmaInteractiveNodeCount = normalizeCount(figmaActionInputTrace?.interactiveCandidateCount, 0)
  quality.canonicalFigmaActionCount = canonicalEvidence.actions.filter((item) => item.source === 'figma').length
  quality.resolvedFigmaHeroActionCount = heroCtaGroup.figma.count
  quality.rejectedFigmaHeroActionCount = Math.max(0, quality.rawFigmaHeroActionCandidateCount - quality.resolvedFigmaHeroActionCount)
  quality.resolvedWebHeroMediaCount = finalWebHeroMediaCount
  quality.duplicateHeroActionMergedCount = Math.max(0,
    quality.rawFigmaHeroActionCandidateCount + (Array.isArray(entitySectionTrace?.webHeroActions) ? entitySectionTrace.webHeroActions.length : 0)
      - (heroCtaGroup.figma.count + heroCtaGroup.web.count))
  quality.duplicateNumericMergedCount = Math.max(0,
    canonicalEvidence.numericValues.reduce((count, item) => count + Math.max(0, (Array.isArray(item.sources) ? item.sources.length : 1) - 1), 0))
  quality.duplicateHeroNumericMergedCount = Math.max(0,
    canonicalEvidence.numericValues
      .filter((item) => item.comparisonScope === 'primary')
      .reduce((count, item) => count + Math.max(0, (Array.isArray(item.sources) ? item.sources.length : 1) - 1), 0))
  quality.unassignedCanonicalEntityCount = normalizeCount(sectionTrace?.unassignedEntityCount, 0)
  quality.multiAssignedCanonicalEntityCount = normalizeCount(sectionTrace?.multiAssignedEntityCount, 0)
  quality.comparisonActionCount = Array.isArray(comparisonActions) ? comparisonActions.length : 0
  quality.referenceOnlyActionCount = canonicalEvidence.actions.filter((item) => item.comparisonScope === 'reference-only').length
  quality.heroPrimaryMediaCount = normalizeCount(heroMediaGroup.figma.primaryCount, 0) + normalizeCount(heroMediaGroup.web.primaryCount, 0)
  quality.canonicalCountConsistencyPassed = quality.canonicalActionCount === canonicalEvidence.actions.length
    && quality.canonicalNumericCount === canonicalEvidence.numericValues.length
  quality.sourceHeroCountConsistencyPassed = sections.filter((item) => item.source === 'figma' && item.role === 'hero').length === 1
    && sections.filter((item) => item.source === 'web' && item.role === 'hero').length === 1
  quality.heroActionResolutionPassed = heroCtaGroup.figma.count >= 1 && heroCtaGroup.web.count >= 1
  quality.heroMediaResolutionPassed = finalFigmaHeroMediaCount >= 1 && finalWebHeroMediaCount >= 1
  quality.figmaActionPipelineConsistencyPassed = quality.canonicalFigmaActionCount <= quality.rawFigmaActionCandidateCount
    && quality.resolvedFigmaHeroActionCount <= quality.rawFigmaHeroActionCandidateCount
  quality.webVideoPipelineConsistencyPassed = quality.resolvedWebHeroMediaCount <= normalizeCount(comparisonMedia.filter((item) => item.source === 'web' && item.mediaType === 'video').length, 0)
    && (!comparisonMedia.some((item) => item.source === 'web' && item.mediaType === 'video' && item.sectionId === sections.find((section) => section.source === 'web' && section.role === 'hero')?.sectionId)
      || quality.resolvedWebHeroMediaCount > 0)
  quality.canonicalAiHintsOnlyPassed = comparisonActions.every((item) => canonicalEvidence.actions.some((entity) => entity.entityId === item.entityId))
    && comparisonPrices.every((item) => canonicalEvidence.numericValues.some((entity) => entity.entityId === item.entityId))
    && comparisonMedia.every((item) => canonicalEvidence.media.some((entity) => entity.entityId === item.entityId))
  quality.duplicateActionEliminationPassed = new Set((Array.isArray(comparisonActions) ? comparisonActions : []).map((item) => buildCanonicalActionKey(item))).size === (Array.isArray(comparisonActions) ? comparisonActions.length : 0)
  quality.duplicateNumericEliminationPassed = new Set((Array.isArray(comparisonPrices) ? comparisonPrices : []).map((item) => buildCanonicalNumericKey(item))).size === (Array.isArray(comparisonPrices) ? comparisonPrices.length : 0)
}

function normalizeSelector(value) {
  return normalizeString(value).replace(/:nth-of-type\(\d+\)/g, '')
}

function createSelectorSignature(selector) {
  const normalized = normalizeString(selector)
    .replace(/[?#].*$/, '')
    .replace(/\s*>\s*/g, ' > ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!normalized) return ''
  const segments = normalized.includes('>')
    ? normalized.split('>').map((item) => item.trim()).filter(Boolean)
    : normalized.split(/\s+/).map((item) => item.trim()).filter(Boolean)
  return segments
    .slice(-5)
    .map(normalizeSelectorSegment)
    .join(' > ')
}

function normalizeSelectorSegment(segment, preserveNth = false) {
  const normalized = preserveNth
    ? normalizeString(segment)
      .replace(/:nth-of-type\((\d+)\)/g, ':nth($1)')
      .replace(/:nth-child\((\d+)\)/g, ':nth($1)')
    : normalizeString(segment)
      .replace(/:nth-of-type\(\d+\)/g, '')
      .replace(/:nth-child\(\d+\)/g, '')
      .replace(/:nth\(\d+\)/g, '')
  if (!normalized) return ''
  const tagMatch = normalized.match(/^[a-z0-9_-]+/i)
  const tag = tagMatch ? tagMatch[0].toLowerCase() : ''
  const idMatches = normalized.match(/#[a-z0-9_-]+/gi) || []
  const classMatches = (normalized.match(/\.[a-z0-9_-]+/gi) || []).map((item) => item.toLowerCase()).sort()
  const attrMatches = normalized.match(/\[[^\]]+\]/g) || []
  const nthMatches = normalized.match(/:nth\(\d+\)/g) || []
  return uniqueStrings([tag, ...idMatches.map((item) => item.toLowerCase()), ...classMatches, ...attrMatches, ...nthMatches]).join('')
}

function hasEquivalentSelectorSignature(firstSignature, secondSignature) {
  const first = splitSelectorSignature(firstSignature)
  const second = splitSelectorSignature(secondSignature)
  if (first.length === 0 || second.length === 0) return false
  if (first.join(' > ') === second.join(' > ')) return true
  const tailLength = Math.min(first.length, second.length, 3)
  if (tailLength < 2) return false
  return first.slice(-tailLength).join(' > ') === second.slice(-tailLength).join(' > ')
}

function splitSelectorSignature(signature) {
  return normalizeString(signature).split('>').map((item) => item.trim()).filter(Boolean)
}

function createCanonicalSelectorAncestry(value) {
  const normalized = normalizeString(value)
  if (!normalized) return []
  const segments = normalized.includes('>')
    ? normalized.split('>').map((item) => item.trim()).filter(Boolean)
    : normalized.split(/\s+/).map((item) => item.trim()).filter(Boolean)
  const canonicalSegments = segments.map((segment) => normalizeSelectorSegment(segment, false)).filter(Boolean)
  return trimShellSelectorSegments(canonicalSegments)
}

function trimShellSelectorSegments(segments) {
  const safeSegments = Array.isArray(segments) ? segments.slice() : []
  while (safeSegments.length > 2 && isShellSelectorSegment(safeSegments[0])) safeSegments.shift()
  return safeSegments
}

function isShellSelectorSegment(segment) {
  const normalized = normalizeString(segment).toLowerCase()
  if (!normalized) return false
  if (/(hero|banner|visual|section|nav|footer|card|video|btn|txt|title|offer|content)/.test(normalized)) return false
  return /(^|[#.])(wrap|wrapper|container|inner|root|shell|layout|page|app|main)([.#]|$)/.test(normalized)
}

function matchesWebHeroAncestry(candidate, heroPath) {
  const heroAncestry = createCanonicalSelectorAncestry(heroPath)
  if (heroAncestry.length === 0) return false
  const selectorAncestry = createCanonicalSelectorAncestry(candidate?.selector || '')
  const contextAncestry = createCanonicalSelectorAncestry(candidate?.contextPath || candidate?.context || '')
  const parentAncestry = createCanonicalSelectorAncestry(candidate?.parentSelector || candidate?.parentContext || '')
  const selectorMatch = selectorAncestry.length > 0 && isCanonicalAncestryDescendant(selectorAncestry, heroAncestry)
  const contextMatch = contextAncestry.length > 0 && isCanonicalAncestryDescendant(contextAncestry, heroAncestry)
  const parentMatch = parentAncestry.length > 0 && isCanonicalAncestryDescendant(parentAncestry, heroAncestry)
  if (selectorAncestry.length > 0 || contextAncestry.length > 0) return selectorMatch || contextMatch
  return parentMatch
}

function isCanonicalAncestryDescendant(candidateSegments, ancestorSegments) {
  const safeCandidate = Array.isArray(candidateSegments) ? candidateSegments : []
  const safeAncestor = Array.isArray(ancestorSegments) ? ancestorSegments : []
  if (safeCandidate.length === 0 || safeAncestor.length === 0) return false
  if (safeCandidate.length >= safeAncestor.length) {
    for (let start = 0; start <= safeCandidate.length - safeAncestor.length; start += 1) {
      let matched = true
      for (let index = 0; index < safeAncestor.length; index += 1) {
        if (safeCandidate[start + index] !== safeAncestor[index]) {
          matched = false
          break
        }
      }
      if (matched) return true
    }
  }
  const minTailLength = Math.min(safeCandidate.length, safeAncestor.length, 2)
  if (minTailLength >= 2) {
    const ancestorTail = safeAncestor.slice(-minTailLength)
    for (let start = 0; start <= safeCandidate.length - ancestorTail.length; start += 1) {
      let matched = true
      for (let index = 0; index < ancestorTail.length; index += 1) {
        if (safeCandidate[start + index] !== ancestorTail[index]) {
          matched = false
          break
        }
      }
      if (matched) return true
    }
  }
  return false
}

function normalizeComparableSectionPath(value) {
  return normalizeString(value)
    .toLowerCase()
    .replace(/\s*>\s*/g, '>')
    .replace(/\s*\/\s*/g, '/')
    .replace(/[#.]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function isCtaRole(role) {
  return role === 'primary-action' || role === 'secondary-action'
}

function dedupeCanonicalEntities(items) {
  const seen = new Set()
  return items.filter((item) => {
    const key = item?.entityId || item?.sectionId || ''
    if (!key || seen.has(key)) return false
    seen.add(key)
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
        x: normalizeNumber(node?.absoluteBoundingBox?.x),
        y: normalizeNumber(node?.absoluteBoundingBox?.y),
        width: normalizeNumber(node?.absoluteBoundingBox?.width),
        height: normalizeNumber(node?.absoluteBoundingBox?.height),
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
        contextPath: truncateText(node?.domPath || node?.selector || '', 220),
        selector: truncateText(node?.selector || '', 180),
        parentContext: truncateText(node?.parentSelector || node?.domPath || '', 160),
        parentSelector: truncateText(node?.parentSelector || '', 160),
        selectorSignature: createSelectorSignature(node?.selector || node?.domPath || ''),
        yRatio: normalizeNumber(node?.yRatio),
        xRatio: normalizeNumber(node?.xRatio),
        widthRatio: normalizeNumber(node?.widthRatio),
        heightRatio: normalizeNumber(node?.heightRatio),
        x: normalizeNumber(node?.x || node?.absoluteBoundingBox?.x),
        y: normalizeNumber(node?.y || node?.absoluteBoundingBox?.y),
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
    contextPath: truncateText(item?.domPath || item?.context || item?.selector || '', 220),
    parentContext: truncateText(item?.parentContext || item?.parentSelector || item?.domPath || '', 160),
    parentSelector: truncateText(item?.parentSelector || '', 160),
    selectorSignature: createSelectorSignature(item?.selector || item?.domPath || ''),
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
    inputType: normalizeString(item?.inputType || item?.typeAttribute),
    isDuplicate: item?.isDuplicate === true,
    isActive: typeof item?.isActive === 'boolean' ? item.isActive : null,
    isCurrent: typeof item?.isCurrent === 'boolean' ? item.isCurrent : (normalizeString(item?.ariaCurrent).toLowerCase() === 'true' ? true : null),
    autoplay: item?.autoplay === true,
    controls: item?.controls === true,
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
  const repeatedSiblingCount = siblings.filter((item) => {
    const searchable = `${item?.name || ''} ${item?.layerPath || ''}`.toLowerCase()
    return ['INSTANCE', 'COMPONENT', 'FRAME'].includes(normalizeString(item?.type))
      && (item?.isInteractiveCandidate === true || /button|btn|cta|action|link/.test(searchable))
  }).length
  if (repeatedSiblingCount >= 2) evidence.push('repeated sibling action component')
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

function isSemanticFigmaInteractiveNode(node, childMap, flatNodes, quality, indexes = buildFigmaNodeIndexes(flatNodes)) {
  if (!node?.effectivelyVisible) return false
  const type = normalizeString(node?.type)
  if (!['FRAME', 'INSTANCE', 'COMPONENT'].includes(type)) return false
  const searchable = `${node?.name || ''} ${node?.layerPath || ''}`.toLowerCase()
  const descendantTexts = getFigmaDescendantTexts(node, flatNodes, indexes)
  const interactionEvidence = buildFigmaInteractionEvidence(node, childMap)
  const compactActionLabel = descendantTexts.length > 0 && descendantTexts.every(isCompactActionLabel)
  const hasInteraction = node?.isInteractiveCandidate === true
  const looksButtonLike = /button|btn|cta|action|link/.test(searchable)
  const hasButtonStructure = compactActionLabel
    && (looksButtonLike
      || interactionEvidence.includes('button-sized container')
      || interactionEvidence.includes('shape-backed control')
      || interactionEvidence.includes('repeated sibling action component'))
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

function deriveFigmaInteractionText(node, flatNodes, indexes = buildFigmaNodeIndexes(flatNodes)) {
  const directText = normalizeString(node?.characters)
  if (directText) return truncateText(directText, 160)

  const descendantTexts = getFigmaDescendantTexts(node, flatNodes, indexes)

  return truncateText(uniqueStrings(descendantTexts).join(' ').trim(), 160)
}

function getFigmaDescendantTexts(node, flatNodes, indexes = buildFigmaNodeIndexes(flatNodes)) {
  return getFigmaDescendantTextNodes(node, indexes)
    .map((child) => normalizeString(child?.characters))
    .filter(Boolean)
}

function getFigmaDescendantTextNodes(node, indexes) {
  return collectFigmaSubtreeNodes(node, indexes)
    .filter((child) => child?.effectivelyVisible && child?.type === 'TEXT')
}

function collectFigmaSubtreeNodes(node, indexes) {
  const nodeId = normalizeString(node?.nodeId || node?.id)
  if (!nodeId) return []
  const result = []
  const queue = [...getDirectFigmaChildNodes(node, indexes)]
  const visited = new Set(queue.map((child) => normalizeString(child?.nodeId || child?.id)).filter(Boolean))

  while (queue.length > 0) {
    const current = queue.shift()
    if (!current) continue
    result.push(current)
    getDirectFigmaChildNodes(current, indexes).forEach((child) => {
      const childId = normalizeString(child?.nodeId || child?.id)
      if (!childId || visited.has(childId)) return
      visited.add(childId)
      queue.push(child)
    })
  }

  return result
}

function getDirectFigmaChildNodes(node, indexes) {
  const nodeId = normalizeString(node?.nodeId || node?.id)
  if (!nodeId) return []
  const childIds = Array.isArray(node?.childIds) ? node.childIds.map((childId) => normalizeString(childId)).filter(Boolean) : []
  if (childIds.length > 0) {
    return childIds.map((childId) => indexes?.nodeById?.get(childId)).filter(Boolean)
  }
  return indexes?.childrenByParentId?.get(nodeId) || indexes?.childMap?.get(nodeId) || []
}

function shouldRejectFigmaActionNode(node, descendantTexts, childMap) {
  return getFigmaActionRejectionReasons(node, descendantTexts, childMap).length > 0
}

function getFigmaActionRejectionReasons(node, descendantTexts, childMap) {
  const widthRatio = Number(node?.widthRatio) || 0
  const heightRatio = Number(node?.heightRatio) || 0
  const width = Number(node?.absoluteBoundingBox?.width) || 0
  const height = Number(node?.absoluteBoundingBox?.height) || 0
  const children = childMap.get(normalizeString(node?.id)) || []
  const searchable = `${node?.name || ''} ${node?.layerPath || ''} ${node?.parentName || ''}`.toLowerCase()
  const longTextCount = descendantTexts.filter((text) => !isCompactActionLabel(text)).length
  const sentenceLikeCount = descendantTexts.filter((text) => /[.!?]|\s{2,}|[,;:]|다$|요$/.test(text) || text.length > 28).length
  const hasMixedContent = children.some((child) => child?.hasImageFill || child?.hasVideoLikeContent) && descendantTexts.length > 0
  const rootHasMixedContent = (node?.hasImageFill || node?.hasVideoLikeContent) && descendantTexts.length > 0
  const isLarge = widthRatio > 0.35 || heightRatio > 0.05 || width >= 640 || height >= 120
  const isRootLargeSection = !normalizeString(node?.parentId) && (widthRatio > 0.35 || heightRatio > 0.12 || children.length >= 3)
  const isSectionLike = children.length >= 4 || descendantTexts.length >= 3 || hasMixedContent
  const actionLikeChildren = children.filter((child) => {
    const type = normalizeString(child?.type)
    if (!['FRAME', 'INSTANCE', 'COMPONENT'].includes(type)) return false
    const childSearchable = `${child?.name || ''} ${child?.layerPath || ''}`.toLowerCase()
    return child?.isInteractiveCandidate === true || /button|btn|cta|action|link/.test(childSearchable)
  }).length
  const isFooterOrNavigation = /footer|nav|navigation|header|menu|legal/.test(searchable)
  const isHeadingGroup = /title|heading|hero\s*title/.test(searchable) && descendantTexts.length > 0
  const isActionWrapper = actionLikeChildren >= 2 && descendantTexts.length >= 2 && !normalizeString(node?.characters)
  const hasExplicitActionSemantics = /button|btn|cta|action|link/.test(searchable)
    || normalizeCount(node?.prototypeInteractionCount, 0) > 0
    || normalizeCount(node?.reactionCount, 0) > 0
    || node?.hasTransitionTarget === true
  const isEnumeratedContentLabel = descendantTexts.length === 1
    && /^\s*\d{1,2}[.)\s]+\S+/.test(descendantTexts[0])
    && !hasExplicitActionSemantics
  const isInteractiveButtonInstance = ['INSTANCE', 'COMPONENT'].includes(normalizeString(node?.type))
    && node?.isInteractiveCandidate === true
    && descendantTexts.length > 0
  const reasons = []
  if (isFooterOrNavigation) reasons.push('footer-or-navigation')
  if (isRootLargeSection) reasons.push('root-large-section')
  if (isActionWrapper) reasons.push('section-wrapper')
  if (rootHasMixedContent) reasons.push('mixed-media-and-label-root')
  if (isLarge && isSectionLike) reasons.push('oversized-container')
  if (longTextCount > 0 || sentenceLikeCount > 0) reasons.push('multiple-independent-labels')
  if (isEnumeratedContentLabel) reasons.push('enumerated-content-label')
  if (isHeadingGroup && !isInteractiveButtonInstance) reasons.push('heading-group')
  return reasons
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

function hasSimilarSize(firstWidthRatio, secondWidthRatio, firstHeightRatio, secondHeightRatio, firstWidth, secondWidth, firstHeight, secondHeight) {
  const widthRatioA = normalizeNumber(firstWidthRatio)
  const widthRatioB = normalizeNumber(secondWidthRatio)
  const heightRatioA = normalizeNumber(firstHeightRatio)
  const heightRatioB = normalizeNumber(secondHeightRatio)
  if (Number.isFinite(widthRatioA) && Number.isFinite(widthRatioB) && Math.abs(widthRatioA - widthRatioB) <= 0.06
    && Number.isFinite(heightRatioA) && Number.isFinite(heightRatioB) && Math.abs(heightRatioA - heightRatioB) <= 0.04) return true
  const widthA = normalizeNumber(firstWidth)
  const widthB = normalizeNumber(secondWidth)
  const heightA = normalizeNumber(firstHeight)
  const heightB = normalizeNumber(secondHeight)
  if (Number.isFinite(widthA) && Number.isFinite(widthB) && Math.abs(widthA - widthB) <= Math.max(40, Math.min(widthA, widthB) * 0.15)
    && Number.isFinite(heightA) && Number.isFinite(heightB) && Math.abs(heightA - heightB) <= Math.max(24, Math.min(heightA, heightB) * 0.2)) return true
  return false
}

function isSameNumericContext(entity, candidate) {
  const sameSection = normalizeComparableSectionPath(entity.sectionPath) === normalizeComparableSectionPath(candidate.sectionPath)
  const sameSelectorSignature = hasEquivalentSelectorSignature(entity.selectorSignature, candidate.selectorSignature)
  const sameParentSelector = normalizeString(entity.parentSelector) && normalizeString(entity.parentSelector) === normalizeString(candidate.parentSelector)
  return sameSection || sameSelectorSignature || sameParentSelector
}

function hasSameNumericParentChain(entity, candidate) {
  const entityParent = normalizeString(entity.parentSelector)
  const candidateParent = normalizeString(candidate.parentSelector)
  if (entityParent && candidateParent && (entityParent === candidateParent || entityParent.startsWith(`${candidateParent} `) || candidateParent.startsWith(`${entityParent} `))) return true
  const entitySignature = normalizeString(entity.selectorSignature)
  const candidateSignature = normalizeString(candidate.selectorSignature)
  return Boolean(entitySignature && candidateSignature && hasEquivalentSelectorSignature(entitySignature, candidateSignature))
}

function buildCanonicalActionKey(action) {
  return [
    normalizeString(action?.source),
    normalizeComparableText(action?.text),
    normalizeString(action?.canonicalHref || action?.href),
    normalizeString(action?.sectionId),
    normalizeString(action?.role),
  ].join('|')
}

function buildCanonicalNumericKey(numeric) {
  return [
    normalizeString(numeric?.source),
    normalizeString(numeric?.numericType),
    normalizeComparableText(numeric?.displayText),
    JSON.stringify(numeric?.numericTokens || []),
    JSON.stringify(numeric?.unitTokens || []),
    createSemanticCardRootSignature(numeric),
  ].join('|')
}

function canonicalizeActionHref(href, baseUrl = '') {
  const normalizedHref = normalizeString(href)
  if (!normalizedHref) return ''
  if (/^(javascript:|mailto:|tel:)/i.test(normalizedHref)) return normalizedHref.toLowerCase()
  try {
    const resolved = baseUrl ? new URL(normalizedHref, baseUrl) : new URL(normalizedHref)
    const base = baseUrl ? new URL(baseUrl) : null
    const pathname = resolved.pathname.replace(/\/$/, '') || '/'
    const canonicalPath = `${pathname}${resolved.search}${resolved.hash}`
    if (base && resolved.origin.toLowerCase() === base.origin.toLowerCase()) return canonicalPath
    return `${resolved.protocol.toLowerCase()}//${resolved.host.toLowerCase()}${canonicalPath}`
  } catch {
    return normalizedHref
  }
}

function dedupeFinalCanonicalActions(actions, webUrl = '') {
  const finalActions = []
  ;(Array.isArray(actions) ? actions : []).forEach((action) => {
    const normalizedAction = {
      ...action,
      canonicalHref: action.source === 'web' ? canonicalizeActionHref(action.href, webUrl) : action.href,
    }
    const existing = finalActions.find((item) => isSameFinalCanonicalAction(item, normalizedAction))
    if (!existing) {
      finalActions.push({ ...normalizedAction, sources: Array.isArray(normalizedAction.sources) ? normalizedAction.sources.slice() : [] })
      return
    }
    existing.sources = dedupeSourceEvidence([...(existing.sources || []), ...(normalizedAction.sources || [])])
    existing.reasons = uniqueStrings([...(existing.reasons || []), ...(normalizedAction.reasons || [])])
    existing.interactionEvidence = uniqueStrings([...(existing.interactionEvidence || []), ...(normalizedAction.interactionEvidence || [])])
    if (shouldPreferFinalActionRepresentative(normalizedAction, existing)) {
      existing.text = normalizedAction.text || existing.text
      existing.displayText = normalizedAction.displayText || existing.displayText
      existing.href = normalizedAction.href || existing.href
      existing.canonicalHref = normalizedAction.canonicalHref || existing.canonicalHref
      existing.selector = normalizedAction.selector || existing.selector
      existing.selectorSignature = normalizedAction.selectorSignature || existing.selectorSignature
      existing.contextPath = normalizedAction.contextPath || existing.contextPath
      existing.parentSelector = normalizedAction.parentSelector || existing.parentSelector
      existing.layerPath = normalizedAction.layerPath || existing.layerPath
      existing.parentId = normalizedAction.parentId || existing.parentId
      existing.xRatio = normalizeNumber(normalizedAction.xRatio)
      existing.yRatio = normalizeNumber(normalizedAction.yRatio)
      existing.widthRatio = normalizeNumber(normalizedAction.widthRatio)
      existing.heightRatio = normalizeNumber(normalizedAction.heightRatio)
    }
  })
  return finalActions
}

function isSameFinalCanonicalAction(first, second) {
  const hasCompletePosition = Number.isFinite(normalizeNumber(first?.xRatio))
    && Number.isFinite(normalizeNumber(first?.yRatio))
    && Number.isFinite(normalizeNumber(second?.xRatio))
    && Number.isFinite(normalizeNumber(second?.yRatio))
  const sameSection = normalizeString(first?.sectionId) === normalizeString(second?.sectionId)
    || normalizeString(first?.sectionRootId) === normalizeString(second?.sectionRootId)
    || hasEquivalentSelectorSignature(first?.parentSelector, second?.parentSelector)
    || hasEquivalentSelectorSignature(first?.sectionPath, second?.sectionPath)
  return first?.source === second?.source
    && normalizeComparableText(first?.text) === normalizeComparableText(second?.text)
    && normalizeString(first?.canonicalHref || first?.href) === normalizeString(second?.canonicalHref || second?.href)
    && areCompatibleActionRoles(first?.role, second?.role)
    && sameSection
    && (!hasCompletePosition || (hasSimilarPosition(first?.yRatio, second?.yRatio) && hasSimilarXAxis(first?.xRatio, second?.xRatio)))
}

function shouldPreferFinalActionRepresentative(candidate, existing) {
  const candidateHasGeometry = Number.isFinite(normalizeNumber(candidate?.xRatio))
    && Number.isFinite(normalizeNumber(candidate?.yRatio))
    && Boolean(normalizeString(candidate?.selector))
  const existingHasGeometry = Number.isFinite(normalizeNumber(existing?.xRatio))
    && Number.isFinite(normalizeNumber(existing?.yRatio))
    && Boolean(normalizeString(existing?.selector))
  if (candidateHasGeometry !== existingHasGeometry) return candidateHasGeometry
  const candidateHasHref = Boolean(normalizeString(candidate?.canonicalHref || candidate?.href))
  const existingHasHref = Boolean(normalizeString(existing?.canonicalHref || existing?.href))
  if (candidateHasHref !== existingHasHref) return candidateHasHref
  return (Array.isArray(candidate?.sources) ? candidate.sources.length : 0) > (Array.isArray(existing?.sources) ? existing.sources.length : 0)
}

function areCompatibleActionRoles(firstRole, secondRole) {
  if (normalizeString(firstRole) === normalizeString(secondRole)) return true
  return ['primary-action', 'secondary-action'].includes(normalizeString(firstRole))
    && ['primary-action', 'secondary-action'].includes(normalizeString(secondRole))
}

function dedupeFinalCanonicalNumericValues(numericValues) {
  const finalNumericValues = []
  ;(Array.isArray(numericValues) ? numericValues : []).forEach((numeric) => {
    const existing = finalNumericValues.find((item) => isSameFinalCanonicalNumeric(item, numeric))
    if (!existing) {
      finalNumericValues.push({ ...numeric, sources: Array.isArray(numeric.sources) ? numeric.sources.slice() : [] })
      return
    }
    existing.sources = dedupeSourceEvidence([...(existing.sources || []), ...(numeric.sources || [])])
    existing.reasons = uniqueStrings([...(existing.reasons || []), ...(numeric.reasons || [])])
    if (shouldPreferNumericRepresentative(numeric, existing)) {
      existing.text = numeric.text
      existing.displayText = numeric.displayText
      existing.fullContextText = numeric.fullContextText
      existing.context = numeric.context
      existing.selector = numeric.selector || existing.selector
      existing.selectorSignature = numeric.selectorSignature || existing.selectorSignature
      existing.contextPath = numeric.contextPath || existing.contextPath
      existing.parentSelector = numeric.parentSelector || existing.parentSelector
      existing.xRatio = numeric.xRatio
      existing.yRatio = numeric.yRatio
    }
  })
  return finalNumericValues
}

function isSameFinalCanonicalNumeric(first, second) {
  const firstRoot = createSemanticCardRootSignature(first)
  const secondRoot = createSemanticCardRootSignature(second)
  return first?.source === second?.source
    && normalizeString(first?.numericType) === normalizeString(second?.numericType)
    && normalizeComparableText(first?.displayText) === normalizeComparableText(second?.displayText)
    && JSON.stringify(first?.numericTokens || []) === JSON.stringify(second?.numericTokens || [])
    && JSON.stringify(first?.unitTokens || []) === JSON.stringify(second?.unitTokens || [])
    && (normalizeString(first?.sectionId) === normalizeString(second?.sectionId) || (firstRoot && secondRoot && firstRoot === secondRoot))
    && (hasSimilarPosition(first?.yRatio, second?.yRatio) || hasSameNumericParentChain(first, second))
}

function shouldPreferNumericRepresentative(candidate, existing) {
  const candidateLength = normalizeString(candidate?.displayText).length || 999
  const existingLength = normalizeString(existing?.displayText).length || 999
  if (candidateLength !== existingLength) return candidateLength < existingLength
  const candidateSelectorLength = normalizeString(candidate?.selector).length
  const existingSelectorLength = normalizeString(existing?.selector).length
  if (candidateSelectorLength !== existingSelectorLength) return candidateSelectorLength > existingSelectorLength
  return getNumericRepresentativeScore(candidate) > getNumericRepresentativeScore(existing)
}

function createSemanticCardRootSignature(candidate) {
  const contextSegments = extractMeaningfulCardSegments(candidate?.contextPath || '')
  const parentSegments = extractMeaningfulCardSegments(candidate?.parentSelector || '')
  const selectorSegments = extractMeaningfulCardSegments(candidate?.selector || '')
  const preferredSegments = contextSegments.length > 0 ? contextSegments : parentSegments.length > 0 ? parentSegments : selectorSegments
  const slideRootIndex = preferredSegments.findIndex((segment) => /(swiperslide|slideactive|slidecurrent|slide:nth\(|slide)/.test(segment))
  if (slideRootIndex !== -1) return preferredSegments.slice(slideRootIndex, Math.min(slideRootIndex + 2, preferredSegments.length)).join(' > ')
  const cardRootIndex = preferredSegments.findIndex((segment) => /(productcard|promotioncard|card|series|item)/.test(segment))
  if (cardRootIndex !== -1) return preferredSegments.slice(cardRootIndex, Math.min(cardRootIndex + 2, preferredSegments.length)).join(' > ')
  return preferredSegments.slice(0, 2).join(' > ')
}

function extractMeaningfulCardSegments(value) {
  const normalized = normalizeString(value)
  if (!normalized) return []
  const segments = normalized.includes('>')
    ? normalized.split('>').map((item) => item.trim()).filter(Boolean)
    : normalized.split(/\s+/).map((item) => item.trim()).filter(Boolean)
  return trimShellSelectorSegments(segments.map((segment) => normalizeSelectorSegment(segment, true)).filter(Boolean))
    .filter((segment) => /(swiperslide|slide|active|current|card|promotion|series|item|txtarea)/.test(segment))
    .filter((segment) => !/(txtarea|text|wrapper|p$|divp|label)/.test(segment))
}

function recordActionMergeTrace(candidate, canonical, quality) {
  if (!quality?.__trace || candidate?.source !== 'web') return
  const safeCanonical = Array.isArray(canonical) ? canonical.filter((item) => item?.source === 'web') : []
  safeCanonical.slice(0, 5).forEach((entity) => {
    if (quality.__trace.actionMergePairs.length >= 30) return
    const sameText = normalizeComparableText(entity.text) === normalizeComparableText(candidate.text)
    const sameHref = normalizeString(entity.href) === normalizeString(candidate.href)
    const sameSelectorSignature = hasEquivalentSelectorSignature(entity.selectorSignature, candidate.selectorSignature)
    const samePosition = hasSimilarPosition(entity.yRatio, candidate.yRatio)
    const sameSection = normalizeString(entity.sectionId) === normalizeString(candidate.sectionId)
    const merged = isSameCanonicalAction(entity, candidate)
    quality.__trace.actionMergePairs.push({
      existingEntityId: entity.entityId,
      incomingSourceId: candidate.sourceId || '',
      text: candidate.text || '',
      href: candidate.href || '',
      sameText,
      sameHref,
      sameSelectorSignature,
      samePosition,
      sameSection,
      merged,
      reason: merged ? 'canonical-action-match' : 'canonical-action-no-match',
    })
  })
}

function recordNumericMergeTrace(candidate, canonical, quality) {
  if (!quality?.__trace || candidate?.source !== 'web') return
  const safeCanonical = Array.isArray(canonical) ? canonical.filter((item) => item?.source === 'web') : []
  safeCanonical.slice(0, 5).forEach((entity) => {
    if (quality.__trace.numericMergePairs.length >= 30) return
    const sameNumericType = entity.numericType === candidate.numericType
    const sameDisplayText = normalizeComparableText(entity.displayText) === normalizeComparableText(candidate.displayText)
    const sameTokens = JSON.stringify(entity.numericTokens) === JSON.stringify(candidate.numericTokens)
    const sameUnits = JSON.stringify(entity.unitTokens) === JSON.stringify(candidate.unitTokens)
    const sameContext = isSameNumericContext(entity, candidate)
    const samePosition = hasSimilarPosition(entity.yRatio, candidate.yRatio)
    const merged = isSameCanonicalNumeric(entity, candidate)
    quality.__trace.numericMergePairs.push({
      existingEntityId: entity.entityId,
      incomingSourceId: candidate.sourceId || '',
      text: candidate.text || '',
      sameNumericType,
      sameDisplayText,
      sameTokens,
      sameUnits,
      sameContext,
      samePosition,
      merged,
      reason: merged ? 'canonical-numeric-match' : 'canonical-numeric-no-match',
    })
  })
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
