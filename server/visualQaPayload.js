const MAX_DIFFERENCES = 20
const MAX_CTA_CANDIDATES = 20
const MAX_IMAGE_CANDIDATES = 20
const MAX_VIDEO_CANDIDATES = 10
const MAX_SECTION_CANDIDATES = 20
const MAX_PRICE_CANDIDATES = 20
const MAX_UNMATCHED_PREVIEW = 10
const MAX_HERO_TEXTS = 6
const MAX_NAV_TEXTS = 8
const SIMILAR_Y_RATIO_THRESHOLD = 0.03

export function createVisualQaPayload(input) {
  return buildVisualQaPayloadArtifacts(input).payload
}

export function buildVisualQaPayloadArtifacts({ figmaAnalysis, webAnalysis, textComparison }) {
  const safeFigmaAnalysis = figmaAnalysis && typeof figmaAnalysis === 'object' ? figmaAnalysis : {}
  const safeWebAnalysis = webAnalysis && typeof webAnalysis === 'object' ? webAnalysis : {}
  const safeTextComparison = textComparison && typeof textComparison === 'object' ? textComparison : {}
  const quality = {
    invisibleCharacterDiffRemovedCount: 0,
    navigationRemovedFromCtaCount: 0,
    priceNoiseRemovedCount: 0,
    candidateDeduplicatedCount: 0,
    heroMediaGroupCreated: false,
    warnings: [],
  }

  const figmaTextCandidates = normalizeFigmaTextCandidates(safeFigmaAnalysis.textNodes)
  const webTextCandidates = normalizeWebTextCandidates(safeWebAnalysis.textNodes)
  const figmaNavigationItems = dedupeCandidates(figmaTextCandidates.filter(isNavigationCandidate), quality)
  const webNavigationItems = dedupeCandidates(webTextCandidates.filter(isNavigationCandidate), quality)
  const filteredDifferences = createComparisonSummaries(safeTextComparison, quality)
  const images = dedupeCandidates(createMergedImageHints(safeFigmaAnalysis, safeWebAnalysis), quality).slice(0, MAX_IMAGE_CANDIDATES)
  const videos = dedupeCandidates(createMergedVideoHints(safeFigmaAnalysis, safeWebAnalysis), quality).slice(0, MAX_VIDEO_CANDIDATES)
  const ctaButtons = createCtaButtons({ figmaTextCandidates, webTextCandidates, webAnalysis: safeWebAnalysis, navigationItems: [...figmaNavigationItems, ...webNavigationItems] }, quality)
  const prices = createPriceHints({ figmaTextCandidates, webTextCandidates }, quality)
  const heroMediaGroup = createHeroMediaGroup({ figmaAnalysis: safeFigmaAnalysis, webAnalysis: safeWebAnalysis, images, videos }, quality)
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
    navigation,
    images,
    videos,
    ctaButtons,
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
      navigation,
      ctaButtons,
      prices,
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

function createCtaButtons({ figmaTextCandidates, webTextCandidates, webAnalysis, navigationItems }, quality) {
  const figmaCandidates = figmaTextCandidates
    .filter((item) => isFigmaCtaCandidate(item))
    .map((item) => ({ ...item, type: 'cta' }))
  const webHintCandidates = (Array.isArray(webAnalysis.ctaCandidates) ? webAnalysis.ctaCandidates : [])
    .map((item) => normalizeWebHintCandidate(item, 'cta'))
  const webTextCtaCandidates = webTextCandidates
    .filter((item) => isWebCtaTextCandidate(item))
    .map((item) => ({ ...item, type: 'cta' }))

  const allCandidates = [...figmaCandidates, ...webHintCandidates, ...webTextCtaCandidates]
  const filtered = allCandidates.filter((candidate) => {
    const isNavigation = isNavigationLikeCandidate(candidate) || navigationItems.some((item) => isSameCandidateFamily(candidate, item))
    if (isNavigation) {
      quality.navigationRemovedFromCtaCount += 1
      return false
    }
    return true
  })

  return dedupeCandidates(filtered, quality).slice(0, MAX_CTA_CANDIDATES)
}

function createMergedImageHints(figmaAnalysis, webAnalysis) {
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
      yRatio: normalizeNumber(node?.yRatio),
      widthRatio: normalizeNumber(node?.widthRatio),
      heightRatio: normalizeNumber(node?.heightRatio),
      visible: node?.effectivelyVisible === true,
    }))
  const webImages = (Array.isArray(webAnalysis.imageCandidates) ? webAnalysis.imageCandidates : [])
    .map((item) => normalizeWebHintCandidate(item, 'image'))
  return [...figmaImages, ...webImages]
}

function createMergedVideoHints(figmaAnalysis, webAnalysis) {
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
      yRatio: normalizeNumber(node?.yRatio),
      widthRatio: normalizeNumber(node?.widthRatio),
      heightRatio: normalizeNumber(node?.heightRatio),
      visible: node?.effectivelyVisible === true,
    }))
  const webVideos = (Array.isArray(webAnalysis.videoCandidates) ? webAnalysis.videoCandidates : [])
    .map((item) => normalizeWebHintCandidate(item, 'video'))
  return [...figmaVideos, ...webVideos]
}

function createPriceHints({ figmaTextCandidates, webTextCandidates }, quality) {
  const rawCandidates = [...figmaTextCandidates, ...webTextCandidates]
    .map((candidate) => createPriceCandidate(candidate))
    .filter(Boolean)

  const filtered = rawCandidates.filter((candidate) => {
    if (isPriceNoise(candidate)) {
      quality.priceNoiseRemovedCount += 1
      return false
    }
    return true
  })

  return dedupeCandidates(filtered, quality).slice(0, MAX_PRICE_CANDIDATES)
}

function createHeroMediaGroup({ images, videos }, quality) {
  const heroFigmaMedia = [
    ...images.filter((item) => item.source === 'figma' && isHeroMediaCandidate(item)),
    ...videos.filter((item) => item.source === 'figma' && isHeroMediaCandidate(item)),
  ]
  const heroWebMedia = [
    ...images.filter((item) => item.source === 'web' && isHeroMediaCandidate(item)),
    ...videos.filter((item) => item.source === 'web' && isHeroMediaCandidate(item)),
  ]
  const figmaPrimaryCandidates = heroFigmaMedia.slice().sort(compareHeroMediaCandidates).slice(0, 3)
  const webPrimaryCandidates = heroWebMedia.slice().sort(compareHeroMediaCandidates).slice(0, 3)
  const figmaMediaTypes = uniqueStrings(heroFigmaMedia.map((item) => item.type))
  const webMediaTypes = uniqueStrings(heroWebMedia.map((item) => item.type))
  const comparisonHint = createHeroMediaComparisonHint(figmaMediaTypes, webMediaTypes)
  const reasons = []
  if (heroFigmaMedia.length > 0) reasons.push('figma top media candidates detected')
  if (heroWebMedia.length > 0) reasons.push('web top media candidates detected')
  if (comparisonHint) reasons.push('figma/web hero media types differ')

  const result = {
    type: 'hero-media',
    figma: {
      mediaTypes: figmaMediaTypes,
      candidateCount: heroFigmaMedia.length,
      primaryCandidates: figmaPrimaryCandidates,
    },
    web: {
      mediaTypes: webMediaTypes,
      candidateCount: heroWebMedia.length,
      primaryCandidates: webPrimaryCandidates,
    },
    comparisonHint,
    confidence: classifyConfidence(reasons.length >= 3 ? 'high' : reasons.length >= 2 ? 'medium' : 'low'),
    reasons,
  }

  quality.heroMediaGroupCreated = heroFigmaMedia.length > 0 || heroWebMedia.length > 0
  return result
}

function createEvidenceSummary({ heroSection, images, videos, ctaButtons, filteredDifferences, figmaNavigationItems, webNavigationItems }) {
  return {
    hero: {
      figmaTextCount: heroSection.figmaTexts.length,
      webTextCount: heroSection.webTexts.length,
      figmaMediaTypes: uniqueStrings(heroSection.mediaTypes?.figma || []),
      webMediaTypes: uniqueStrings(heroSection.mediaTypes?.web || []),
      figmaCtaCount: ctaButtons.filter((item) => item.source === 'figma' && (item.section === 'hero' || item.section === 'top')).length,
      webCtaCount: ctaButtons.filter((item) => item.source === 'web' && (item.section === 'hero' || item.section === 'top')).length,
    },
    navigation: {
      figmaItemCount: figmaNavigationItems.length,
      webItemCount: webNavigationItems.length,
    },
    content: {
      figmaImageCount: images.filter((item) => item.source === 'figma').length,
      webImageCount: images.filter((item) => item.source === 'web').length,
      webVideoCount: videos.filter((item) => item.source === 'web').length,
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
      const text = truncateText(node?.characters || '', 140)
      const context = truncateText(node?.layerPath || node?.parentFrameName || '', 180)
      const section = inferFigmaSection(node)
      const reasons = []
      if (Number(node?.fontSize) >= 24) reasons.push('large font size')
      if (Number(node?.fontWeight) >= 700) reasons.push('bold font weight')
      if (section === 'top' || section === 'hero') reasons.push('top section')
      if (/nav|menu|header|hero|kv|banner|button|cta|tab|item/i.test(context)) reasons.push('semantic layer path')

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
        role: inferFigmaRole(node),
      }
    })
    .filter((item) => item.text)
}

function normalizeWebTextCandidates(textNodes) {
  return (Array.isArray(textNodes) ? textNodes : [])
    .map((node) => {
      const text = truncateText(node?.rawText || node?.text || '', 140)
      const role = normalizeString(node?.role)
      const section = inferWebSection(node)
      const context = truncateText(node?.selector || node?.domPath || '', 180)
      const reasons = []
      if (String(node?.tagName || '').match(/^h[1-6]$/i)) reasons.push('heading element')
      if (role === 'cta') reasons.push('cta role')
      if (role === 'navigation') reasons.push('navigation role')
      if (section === 'top' || section === 'hero') reasons.push('top section')
      if (/nav|menu|header|hero|banner|button|cta|menuitem/i.test(context)) reasons.push('semantic selector')
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
        role,
        tagName: normalizeString(node?.tagName),
        href: normalizeString(node?.href),
        ariaRole: normalizeString(node?.ariaRole),
      }
    })
    .filter((item) => item.text)
}

function normalizeWebHintCandidate(item, fallbackType) {
  const text = truncateText(item?.text || item?.name || '', 120)
  return {
    type: normalizeString(item?.type) || fallbackType,
    source: normalizeString(item?.source) || 'web',
    sourceId: normalizeString(item?.sourceId || item?.selector || item?.text),
    text,
    displayText: normalizeTextForExactDisplayComparison(text),
    href: normalizeString(item?.href),
    selector: truncateText(item?.selector || '', 180),
    context: truncateText(item?.context || item?.selector || '', 180),
    parentContext: truncateText(item?.parentContext || '', 160),
    section: normalizeString(item?.section || item?.area) || 'unknown',
    confidence: normalizeConfidence(item?.confidence),
    reasons: Array.isArray(item?.reasons) ? item.reasons.map((reason) => truncateText(reason, 120)) : [],
    yRatio: normalizeNumber(item?.yRatio),
    widthRatio: normalizeNumber(item?.widthRatio),
    heightRatio: normalizeNumber(item?.heightRatio),
    width: normalizeNumber(item?.width),
    height: normalizeNumber(item?.height),
    visible: item?.visible !== false,
    tagName: normalizeString(item?.tagName),
    role: normalizeString(item?.role),
  }
}

function inferFigmaRole(node) {
  const context = `${node?.layerPath || ''} ${node?.parentFrameName || ''}`.toLowerCase()
  if (/nav|menu|header|gnb|tab|item/.test(context)) return 'navigation'
  if (/button|cta|btn/.test(context)) return 'cta'
  if (looksLikePriceText(node?.characters)) return 'price'
  if (Number(node?.fontSize) >= 24 || Number(node?.fontWeight) >= 700) return 'heading'
  return 'body'
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

function createPriceCandidate(candidate) {
  const text = normalizeString(candidate?.text)
  if (!text) return null

  const numericTokens = extractNumericTokens(text)
  const unitTokens = extractUnitTokens(text)
  if (numericTokens.length === 0) return null

  const reasons = ['contains numeric token']
  if (unitTokens.length > 0) reasons.push('contains unit token')
  if (looksLikePriceContext(candidate)) reasons.push('price-like context')
  if (text.length <= 40) reasons.push('compact standalone phrase')

  return {
    type: 'price',
    source: candidate.source,
    sourceId: candidate.sourceId,
    text: truncateText(text, 140),
    displayText: candidate.displayText,
    numericTokens,
    unitTokens,
    context: candidate.context,
    section: candidate.section,
    confidence: classifyConfidence(reasons.length >= 3 ? 'high' : reasons.length >= 2 ? 'medium' : 'low'),
    reasons,
    yRatio: candidate.yRatio,
  }
}

function isPriceNoise(candidate) {
  const text = normalizeString(candidate?.text)
  if (!text) return true
  const isLegalContext = /legal|footer|terms|privacy|cookie|disclaimer|약관|개인정보|유의사항|사업자|대표자/i.test(`${candidate?.section || ''} ${candidate?.context || ''}`)
  const hasManyNumbers = candidate.numericTokens.length >= 3
  const isLongSentence = text.length >= 55
  const hasStandalonePriceContext = looksLikePriceContext(candidate)

  if (isLegalContext && isLongSentence) return true
  if (hasManyNumbers && isLongSentence && !hasStandalonePriceContext) return true
  if (text.length >= 90) return true
  return false
}

function looksLikePriceContext(candidate) {
  return /(price|amount|rate|month|payment|deposit|term|개월|보증금|월|금리|이율|가격|금액|계약기간|표|table|card|payment)/i.test(`${candidate?.text || ''} ${candidate?.context || ''}`)
}

function createHeroMediaComparisonHint(figmaMediaTypes, webMediaTypes) {
  if (figmaMediaTypes.length === 1 && webMediaTypes.length === 1) {
    return `figma-${figmaMediaTypes[0]}-vs-web-${webMediaTypes[0]}`
  }
  if (figmaMediaTypes.length > 0 || webMediaTypes.length > 0) {
    return 'hero-media-types-differ'
  }
  return ''
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
    || item.reasons.includes('navigation role')
    || item.reasons.includes('semantic selector')
    || item.reasons.includes('semantic layer path')
}

function isNavigationLikeCandidate(candidate) {
  return candidate.section === 'navigation'
    || candidate.role === 'navigation'
    || /(nav|navigation|gnb|menu|header|menuitem)/i.test(`${candidate?.context || ''} ${candidate?.parentContext || ''} ${candidate?.selector || ''}`)
}

function isFigmaCtaCandidate(item) {
  if (!item || !item.text) return false
  if (isNavigationLikeCandidate(item)) return false
  return item.role === 'cta' || /(button|cta|btn)/i.test(`${item.context} ${item.parentContext}`)
}

function isWebCtaTextCandidate(item) {
  if (!item || !item.text) return false
  if (isNavigationLikeCandidate(item)) return false
  return item.role === 'cta'
    || item.tagName === 'button'
    || /(button|cta|btn)/i.test(`${item.context} ${item.parentContext}`)
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
  score += Math.max(0, 40 - Math.round((candidate.yRatio || 1) * 100))
  score += Math.round((candidate.widthRatio || 0) * 100)
  score += Math.round((candidate.heightRatio || 0) * 100)
  score += Math.round(Math.min(candidate.width || 0, 2000) / 50)
  score += Math.round(Math.min(candidate.height || 0, 2000) / 50)
  return score
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

  return sameText && similarY && (sameContext || sameParent)
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
  return score
}

function hasSimilarPosition(firstYRatio, secondYRatio) {
  const first = normalizeNumber(firstYRatio)
  const second = normalizeNumber(secondYRatio)
  if (!Number.isFinite(first) || !Number.isFinite(second)) return false
  return Math.abs(first - second) <= SIMILAR_Y_RATIO_THRESHOLD
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

function extractNumericTokens(value) {
  return (String(value || '').match(/\d+(?:[.,]\d+)?/g) || []).map((token) => token.replace(/,/g, '.'))
}

function extractUnitTokens(value) {
  return uniqueStrings(String(value || '').match(/만원|원|%|개월|년|월|krw|usd|eur|jpy|price|rate|payment|deposit|term/gi) || [])
}

function looksLikePriceText(value) {
  return /(?:₩|\$|€|¥|원|만원|krw|usd|eur|jpy|%|연\s*\d|월\s*\d|개월|년)/i.test(String(value || '')) && /\d/.test(String(value || ''))
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
