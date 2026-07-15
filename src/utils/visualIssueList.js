const VISUAL_AI_CATEGORIES = new Set(['price', 'text', 'cta', 'media'])
const PRICE_NUMERIC_TYPES = new Set(['monthly-payment', 'amount', 'percentage', 'interest-rate', 'duration'])
export const DEFAULT_VISUAL_ISSUE_DISPLAY_COUNT = 10

const CATEGORY_LABELS = {
  text: 'Text',
  cta: 'CTA',
  price: 'Text',
  media: 'KV / Media',
  image: 'KV / Media',
  layout: 'KV / Media',
  missing: 'Missing',
  count: 'Missing',
  other: 'Text',
}

const AREA_ORDER = {
  'Main KV': 10,
  Navigation: 20,
  Footer: 80,
  'Page Content': 90,
}

export function createVisualDifferenceItems(result = {}, aiReview = null) {
  return createVisualDifferenceReport(result, aiReview).items
}

export function createVisualDifferenceReport(result = {}, aiReview = null, options = {}) {
  const displayLimit = Number.isFinite(Number(options.displayLimit)) && Number(options.displayLimit) > 0 ? Number(options.displayLimit) : DEFAULT_VISUAL_ISSUE_DISPLAY_COUNT
  const stats = {
    rawVisionCount: getRawVisionCount(aiReview),
    canonicalSupplementCount: 0,
    invalidIssueDroppedCount: 0,
    crossCategoryMergeRejectedCount: 0,
  }
  const canonicalItems = createCanonicalItems(result).filter(isDefaultIssueCandidate)
  let sourceItems

  if (hasVisionPrimarySource(aiReview)) {
    const visionItems = createVisionItems(aiReview)
      .map((item) => applyHeroAbsenceGate(item, result, aiReview))
      .filter(Boolean)
      .filter(isDefaultIssueCandidate)
    const primaryItems = mergePrimaryItemsWithCanonical(visionItems, canonicalItems, stats)
    const supplementalItems = createSupplementalCanonicalItems(canonicalItems, primaryItems, stats)
    sourceItems = [...primaryItems, ...supplementalItems]
  } else {
    const visionItems = shouldUseAiReview(aiReview) ? createVisionItems(aiReview) : []
    const aiItems = shouldUseAiReview(aiReview) ? createAiItems(aiReview) : []
    const preferredItems = [...visionItems, ...aiItems]
    sourceItems = preferredItems.length > 0 ? mergeAiAndCanonicalItems(preferredItems, canonicalItems, stats) : canonicalItems
  }

  return finalizeIssueItems(sourceItems, { stats, displayLimit, includeProvenance: options.includeProvenance === true })
}

function finalizeIssueItems(items, { stats, displayLimit, includeProvenance }) {
  const candidateItems = []
  items.forEach((item) => {
    if (!isDefaultIssueCandidate(item)) return
    if (!isConsistentIssue(item)) {
      stats.invalidIssueDroppedCount += 1
      return
    }
    candidateItems.push(item)
  })
  const mergedCount = candidateItems.length
  const dedupedItems = dedupeItems(candidateItems)
    .map((item, index) => includeProvenance ? { ...item, id: item.id || `visual-difference-${index}` } : stripProvenance({ ...item, id: item.id || `visual-difference-${index}` }))
    .sort(compareIssueItems)
  return {
    items: dedupedItems,
    meta: {
      rawVisionCount: stats.rawVisionCount,
      canonicalSupplementCount: stats.canonicalSupplementCount,
      mergedCount,
      dedupedCount: dedupedItems.length,
      displayCount: Math.min(displayLimit, dedupedItems.length),
      invalidIssueDroppedCount: stats.invalidIssueDroppedCount,
      crossCategoryMergeRejectedCount: stats.crossCategoryMergeRejectedCount,
    },
  }
}

function stripProvenance(item) {
  const result = { ...item }
  delete result.provenance
  return result
}

function getRawVisionCount(aiReview) {
  if (Number.isFinite(Number(aiReview?.meta?.rawVisionCount))) return Number(aiReview.meta.rawVisionCount)
  return Array.isArray(aiReview?.review?.visualDifferences) ? aiReview.review.visualDifferences.length : 0
}

function hasVisionPrimarySource(aiReview) {
  const differences = Array.isArray(aiReview?.review?.visualDifferences) ? aiReview.review.visualDifferences : []
  return aiReview?.meta?.visionUsed === true && aiReview?.meta?.fallbackUsed !== true && differences.length > 0
}

function createVisionItems(aiReview = {}) {
  const differences = Array.isArray(aiReview.review?.visualDifferences) ? aiReview.review.visualDifferences : []
  return differences
    .filter((item) => item && typeof item === 'object')
    .filter((item) => normalizeConfidence(item.confidence) !== 'low' || normalizeSeverity(item.severity) === 'check')
    .map((item, index) => {
      const category = normalizeCategory(item.category)
      const area = normalizeVisualArea(item, getDefaultAreaForCategory(category))
      return {
        id: `vision-${index}-${normalizeKey(item.title || item.summary)}`,
        source: 'vision',
        category,
        categoryLabel: normalizeVisualCategoryLabel(category),
        area,
        title: createDisplayTitle(category),
        description: getString(item.summary || item.description) || createCanonicalDescription(category, item.figmaValue, item.webValue),
        figmaValue: getString(item.figmaValue || item.figma),
        webValue: getString(item.webValue || item.web),
        severity: normalizeIssueSeverityForContent(category, item.severity, item),
        confidence: normalizeConfidence(item.confidence),
        sortRank: getSortRank(item, area),
        sectionId: getString(item.sectionId),
        sectionPath: getString(item.sectionPath || item.layerPath || item.contextPath),
        yRatio: getNullableNumber(item.yRatio ?? item.sectionYRatio ?? item.figmaYRatio ?? item.webYRatio),
        xRatio: getNullableNumber(item.xRatio ?? item.figmaXRatio ?? item.webXRatio),
        originalIndex: Number.isFinite(Number(item.originalIndex ?? item.order)) ? Number(item.originalIndex ?? item.order) : index,
        sectionKey: createSectionKey(item),
        provenance: {
          origin: 'vision',
          matchedVisionIndex: index,
          matchedCanonicalEntityIds: [],
          canonicalCategory: '',
          canonicalSectionId: '',
          mergeReason: '',
        },
        mergeTokens: [item.area, item.category, item.title, item.summary, item.figmaValue, item.webValue].map(getString).filter(Boolean),
      }
    })
}

function applyHeroAbsenceGate(item, result = {}, aiReview = {}) {
  if (!isUnreliableHeroCrop(aiReview) || !isHeroAbsenceClaim(item)) return item
  const presence = getCanonicalHeroPresence(result)
  const claim = classifyHeroAbsenceClaim(item)
  if ((claim === 'media' && presence.webMedia) || (claim === 'cta' && presence.webAction) || (claim === 'text' && presence.webText) || (claim === 'hero' && (presence.webText || presence.webAction || presence.webMedia))) {
    return null
  }
  if (aiReview.meta?.heroCropPairQuality?.compatible === false) return null
  if (item.severity === 'critical') return { ...item, severity: 'check' }
  return item
}

function isUnreliableHeroCrop(aiReview = {}) {
  if (aiReview.meta?.heroCropPairQuality?.compatible === false) return true
  const crops = Array.isArray(aiReview.meta?.visionCropSummary) ? aiReview.meta.visionCropSummary : []
  if (crops.some((item) => item?.cropDiagnostics?.cropQualityPassed === false)) return true
  const coverage = crops.map((item) => Number(item?.cropDiagnostics?.cropCoverageRatio)).filter(Number.isFinite)
  if (coverage.length >= 2 && Math.max(...coverage) > 0 && Math.min(...coverage) / Math.max(...coverage) < 0.45) return true
  return false
}

function isHeroAbsenceClaim(item = {}) {
  const text = `${item.area || ''} ${item.category || ''} ${item.title || ''} ${item.description || ''} ${item.figmaValue || ''} ${item.webValue || ''} ${(item.mergeTokens || []).join(' ')}`.toLowerCase()
  const heroText = /(hero|main.?visual|kv|key.?visual|main kv|메인|히어로|비주얼|대표\s*이미지)/i.test(text)
  const outputText = /(web|웹).*(image|이미지|media|미디어|cta|button|버튼).*(missing|not found|absent|loading|output|render|none|없음|누락|미노출|로딩|출력|표시|보이지 않|없습니다|없다)/i.test(text)
    || /(image|이미지|media|미디어|cta|button|버튼).*(loading|output|render|missing|not found|absent|none|없음|누락|미노출|로딩|출력|표시|보이지 않|없습니다|없다)/i.test(text)
  if (!heroText && !outputText) return false
  return outputText || /(missing|not found|absent|none|없음|누락|미노출|부족|보이지 않|없습니다|없다)/i.test(text)
}

function classifyHeroAbsenceClaim(item = {}) {
  const text = `${item.category || ''} ${item.title || ''} ${item.description || ''} ${item.figmaValue || ''} ${item.webValue || ''} ${(item.mergeTokens || []).join(' ')}`.toLowerCase()
  if (/(cta|button|action|버튼|cta)/i.test(text)) return 'cta'
  if (/(media|image|video|photo|이미지|영상|비디오|차량|visual)/i.test(text)) return 'media'
  if (/(text|copy|heading|title|문구|텍스트|타이틀)/i.test(text)) return 'text'
  return 'hero'
}

function getCanonicalHeroPresence(result = {}) {
  const aiHints = result.aiHints || {}
  const heroSection = aiHints.heroSection || {}
  const canonical = aiHints.canonicalEvidence || {}
  const heroWebSectionId = getString(heroSection.webSectionId)
  const heroTextCount = Number(aiHints.evidenceSummary?.hero?.webTextCount || 0)
  const heroCtaActions = Array.isArray(aiHints.heroCtaGroup?.web?.actions) ? aiHints.heroCtaGroup.web.actions : []
  const heroMediaCandidates = Array.isArray(aiHints.heroMediaGroup?.web?.primaryCandidates) ? aiHints.heroMediaGroup.web.primaryCandidates : []
  const heroMediaTypes = Array.isArray(aiHints.heroMediaGroup?.web?.mediaTypes) ? aiHints.heroMediaGroup.web.mediaTypes : []
  const canonicalTexts = Array.isArray(canonical.texts) ? canonical.texts : []
  const canonicalActions = Array.isArray(canonical.actions) ? canonical.actions : []
  const canonicalMedia = Array.isArray(canonical.media) ? canonical.media : []
  return {
    webText: heroTextCount > 0 || canonicalTexts.some((item) => item.source === 'web' && (!heroWebSectionId || item.sectionId === heroWebSectionId)),
    webAction: heroCtaActions.length > 0 || canonicalActions.some((item) => item.source === 'web' && (item.comparisonScope === 'primary' || item.isHeroAction === true) && /action|cta|button/i.test(item.role || '')),
    webMedia: heroMediaCandidates.length > 0 || heroMediaTypes.length > 0 || canonicalMedia.some((item) => item.source === 'web' && (item.comparisonScope === 'primary' || item.isHeroPrimary === true)),
  }
}

export function classifyVisualDifferenceItem(item = {}) {
  const explicitCategory = normalizeCategory(item.category)
  if (explicitCategory && explicitCategory !== 'other') return explicitCategory
  if (isMediaDifference(item)) return 'media'
  if (isCtaDifference(item)) return 'cta'
  if (isPriceDifference(item)) return 'price'
  if (!getString(item.figmaText || item.text) || !getString(item.webText)) return 'missing'
  return 'text'
}

export function normalizeVisualArea(item = {}, fallback = 'Page Content') {
  const raw = [
    item.area,
    item.sectionRole,
    item.section,
    item.sectionName,
    item.sectionPath,
    item.layerPath,
    item.contextPath,
    item.rootName,
    Array.isArray(item.reasons) ? item.reasons.join(' ') : '',
  ].map(getString).filter(Boolean).join(' ').toLowerCase()

  if (/hero|main.?visual|main|kv|key.?visual|visual|히어로|메인|비주얼|키.?비주얼/.test(raw)) return 'Main KV'
  if (/nav|navigation|header|gnb|menu|내비|네비|헤더|메뉴/.test(raw)) return 'Navigation'
  if (/footer|legal|copyright|푸터|약관|저작권/.test(raw)) return 'Footer'
  return fallback
}

export function normalizeVisualCategoryLabel(category) {
  return CATEGORY_LABELS[normalizeCategory(category)] || CATEGORY_LABELS.other
}

function shouldUseAiReview(aiReview) {
  if (!aiReview || aiReview.meta?.fallbackUsed === true) return false
  return aiReview.meta?.openAiCalled === true
}

function createAiItems(aiReview = {}) {
  const mustFix = Array.isArray(aiReview.review?.mustFix) ? aiReview.review.mustFix : []
  const verify = Array.isArray(aiReview.review?.verify) ? aiReview.review.verify : []
  return [...mustFix.map((issue) => ({ ...issue, severity: 'critical' })), ...verify]
    .filter((issue) => VISUAL_AI_CATEGORIES.has(normalizeCategory(issue.category)))
    .map((issue, index) => {
      const category = normalizeCategory(issue.category)
      const evidenceValues = extractEvidenceValues(issue.evidence)
      return {
        id: `ai-${index}-${normalizeKey(issue.title || issue.description)}`,
        source: 'ai',
        category,
        categoryLabel: normalizeVisualCategoryLabel(category),
        area: normalizeVisualArea(issue, category === 'media' || category === 'cta' ? 'Main KV' : 'Page Content'),
        title: createIssueTitle(issue, category),
        description: createIssueDescription(issue, category),
        figmaValue: evidenceValues.figma,
        webValue: evidenceValues.web,
        severity: normalizeIssueSeverityForContent(category, issue.severity || (index < mustFix.length ? 'critical' : 'warning'), issue),
        confidence: normalizeConfidence(issue.confidence),
        sortRank: getAreaRank(normalizeVisualArea(issue, category === 'media' || category === 'cta' ? 'Main KV' : 'Page Content')),
        mergeTokens: [issue.title, issue.description, ...(Array.isArray(issue.evidence) ? issue.evidence : [])].map(getString).filter(Boolean),
      }
    })
}

function createCanonicalItems(result = {}) {
  const comparison = result.comparison || {}
  const aiHints = result.aiHints || {}
  const differences = Array.isArray(comparison.differences) ? comparison.differences : []
  const items = differences.map((difference, index) => createCanonicalDifferenceItem(difference, index, aiHints))

  const heroCtaGroup = normalizeHeroCtaGroup(aiHints.heroCtaGroup || {})
  if (Number(heroCtaGroup.countDifference || 0) > 0) {
    items.push({
      id: 'canonical-hero-cta-count',
      source: 'canonical',
      category: 'cta',
      categoryLabel: 'CTA',
      area: 'Main KV',
      title: 'Hero CTA 개수가 다릅니다.',
      description: createCtaCountDescription(heroCtaGroup),
      figmaValue: formatCount(heroCtaGroup.figma?.count),
      webValue: formatCount(heroCtaGroup.web?.count),
      severity: 'critical',
      confidence: normalizeConfidence(heroCtaGroup.confidence || 'medium'),
      sortRank: 12,
      sectionKey: 'hero-cta',
      provenance: {
        origin: 'canonical',
        matchedVisionIndex: null,
        matchedCanonicalEntityIds: [...heroCtaGroup.figma.actions, ...heroCtaGroup.web.actions].map((item) => item.entityId || item.text).filter(Boolean),
        canonicalCategory: 'cta',
        canonicalSectionId: 'hero-cta',
        mergeReason: '',
      },
      mergeTokens: ['hero', 'cta', 'count', formatCount(heroCtaGroup.figma?.count), formatCount(heroCtaGroup.web?.count)],
    })
  }

  const heroMediaGroup = aiHints.heroMediaGroup || {}
  if (heroMediaGroup.comparisonHint) {
    items.push({
      id: 'canonical-hero-media',
      source: 'canonical',
      category: 'media',
      categoryLabel: normalizeVisualCategoryLabel('media'),
      area: 'Main KV',
      title: createDisplayTitle('media'),
      description: createMediaDescription(heroMediaGroup),
      figmaValue: formatMediaTypes(heroMediaGroup.figma?.mediaTypes),
      webValue: formatMediaTypes(heroMediaGroup.web?.mediaTypes),
      severity: 'warning',
      confidence: normalizeConfidence(heroMediaGroup.confidence || 'medium'),
      sortRank: 14,
      sectionKey: 'hero-media',
      provenance: {
        origin: 'canonical',
        matchedVisionIndex: null,
        matchedCanonicalEntityIds: ['hero-media'],
        canonicalCategory: 'media',
        canonicalSectionId: 'hero-media',
        mergeReason: '',
      },
      mergeTokens: ['hero', 'media', formatMediaTypes(heroMediaGroup.figma?.mediaTypes), formatMediaTypes(heroMediaGroup.web?.mediaTypes)],
    })
  }

  return items.filter(Boolean)
}

function createCanonicalDifferenceItem(difference = {}, index, aiHints = {}) {
  const category = classifyVisualDifferenceItem(enrichDifferenceWithPriceSignals(difference, aiHints))
  const area = normalizeVisualArea(difference, category === 'cta' ? 'Main KV' : 'Page Content')
  const figmaValue = getString(difference.figmaText || difference.text)
  const webValue = getString(difference.webText)
  return {
    id: `canonical-difference-${index}-${normalizeKey(figmaValue)}-${normalizeKey(webValue)}`,
    source: 'canonical',
    category,
    categoryLabel: normalizeVisualCategoryLabel(category),
    area,
    title: createCanonicalTitle(category, area),
    description: createCanonicalDescription(category, figmaValue, webValue),
    figmaValue,
    webValue,
    severity: normalizeCanonicalSeverity(difference, category),
    confidence: normalizeConfidence(difference.confidence || difference.matchConfidence),
    sortRank: getSortRank({ ...difference, order: difference.order ?? index }, area),
    sectionId: getString(difference.sectionId),
    sectionPath: getString(difference.sectionPath || difference.layerPath || difference.contextPath),
    yRatio: getNullableNumber(difference.yRatio ?? difference.sectionYRatio ?? difference.figmaYRatio ?? difference.webYRatio ?? difference.figmaNode?.yRatio ?? difference.webElement?.yRatio),
    xRatio: getNullableNumber(difference.xRatio ?? difference.figmaXRatio ?? difference.webXRatio ?? difference.figmaNode?.xRatio ?? difference.webElement?.xRatio),
    originalIndex: Number.isFinite(Number(difference.originalIndex ?? difference.order)) ? Number(difference.originalIndex ?? difference.order) : index,
    sectionKey: createSectionKey(difference),
    provenance: {
      origin: 'canonical',
      matchedVisionIndex: null,
      matchedCanonicalEntityIds: [difference.entityId, difference.sectionId, difference.figmaNodeId, difference.webSelector].map(getString).filter(Boolean),
      canonicalCategory: category,
      canonicalSectionId: createSectionKey(difference),
      mergeReason: '',
    },
    mergeTokens: createMergeTokens({ category, area, figmaValue, webValue, raw: difference }),
  }
}

function enrichDifferenceWithPriceSignals(difference, aiHints) {
  const text = normalizeKey(`${difference.figmaText || difference.text || ''} ${difference.webText || ''}`)
  const prices = Array.isArray(aiHints.prices) ? aiHints.prices : []
  const relatedPrice = prices.find((price) => {
    const priceText = normalizeKey(`${price.displayText || ''} ${price.text || ''} ${price.fullContextText || ''}`)
    return priceText && (priceText.includes(text) || text.includes(priceText))
  })
  return relatedPrice ? { ...difference, numericType: relatedPrice.numericType, priceSignal: true } : difference
}

function mergeAiAndCanonicalItems(aiItems, canonicalItems, stats) {
  const usedCanonicalIndexes = new Set()
  const mergedAiItems = aiItems.map((aiItem) => {
    const matchIndex = findBestCanonicalMatch(aiItem, canonicalItems, usedCanonicalIndexes, stats)
    if (matchIndex === -1) return aiItem
    usedCanonicalIndexes.add(matchIndex)
    return mergeIssueItem(aiItem, canonicalItems[matchIndex])
  })

  const remainingCanonicalItems = canonicalItems.filter((_, index) => !usedCanonicalIndexes.has(index))
  return [...mergedAiItems, ...remainingCanonicalItems]
}

function mergePrimaryItemsWithCanonical(primaryItems, canonicalItems, stats) {
  const usedCanonicalIndexes = new Set()
  return primaryItems.map((primaryItem) => {
    const matchIndex = findBestCanonicalMatch(primaryItem, canonicalItems, usedCanonicalIndexes, stats)
    if (matchIndex === -1) return primaryItem
    usedCanonicalIndexes.add(matchIndex)
    return mergeIssueItem(primaryItem, canonicalItems[matchIndex])
  })
}

function createSupplementalCanonicalItems(canonicalItems, primaryItems, stats) {
  const supplemental = []
  canonicalItems.forEach((item) => {
    if (!isHighConfidenceCanonicalSupplement(item)) return
    if (primaryItems.some((primaryItem) => areDuplicateItems(primaryItem, item))) return
    if (supplemental.some((existing) => areDuplicateItems(existing, item))) return
    supplemental.push(item)
    stats.canonicalSupplementCount += 1
  })
  return supplemental
}

function isHighConfidenceCanonicalSupplement(item) {
  if (!getString(item.figmaValue) || !getString(item.webValue)) return false
  if (isLowValueIssue(item)) return false
  return normalizeConfidence(item.confidence) === 'high'
}

function findBestCanonicalMatch(aiItem, canonicalItems, usedIndexes, stats) {
  let bestIndex = -1
  let bestScore = 0
  canonicalItems.forEach((canonicalItem, index) => {
    if (usedIndexes.has(index)) return
    const score = scoreIssueMatch(aiItem, canonicalItem, stats)
    if (score > bestScore) {
      bestScore = score
      bestIndex = index
    }
  })
  return bestScore >= 3 ? bestIndex : -1
}

function scoreIssueMatch(aiItem, canonicalItem, stats) {
  let score = 0
  const aiCategory = normalizeCategory(aiItem.category)
  const canonicalCategory = normalizeCategory(canonicalItem.category)
  if (!canMergeIssueCategories(aiItem, canonicalItem)) {
    if (hasMergeOverlapSignal(aiItem, canonicalItem)) stats.crossCategoryMergeRejectedCount += 1
    return 0
  }
  if (!canMergeIssueSections(aiItem, canonicalItem)) return 0
  if (aiCategory === 'cta' || canonicalCategory === 'cta') {
    const ctaScore = scoreCtaMergeEvidence(aiItem, canonicalItem)
    if (ctaScore < 3) return 0
    score += ctaScore
  }
  if (aiCategory === canonicalCategory) score += 2
  if (categoriesAreCompatible(aiCategory, canonicalCategory, aiItem, canonicalItem)) score += 1
  if (normalizeAreaForKey(aiItem.area) === normalizeAreaForKey(canonicalItem.area)) score += 1

  const aiText = normalizeKey(`${aiItem.title} ${aiItem.description} ${aiItem.figmaValue} ${aiItem.webValue}`)
  const canonicalFigma = normalizeKey(canonicalItem.figmaValue)
  const canonicalWeb = normalizeKey(canonicalItem.webValue)
  if (canonicalFigma && aiText.includes(canonicalFigma)) score += 2
  if (canonicalWeb && aiText.includes(canonicalWeb)) score += 2
  if (normalizedValuesOverlap(aiItem.figmaValue, canonicalItem.figmaValue)) score += 2
  if (normalizedValuesOverlap(aiItem.webValue, canonicalItem.webValue)) score += 2
  if (numericTokens(aiText).some((token) => numericTokens(`${canonicalItem.figmaValue} ${canonicalItem.webValue}`).includes(token))) score += 1
  if (canonicalItem.mergeTokens?.some((token) => token && aiText.includes(normalizeKey(token)))) score += 1
  return score
}

function mergeIssueItem(aiItem, canonicalItem) {
  const category = normalizeCategory(canonicalItem.category) !== 'other' ? normalizeCategory(canonicalItem.category) : normalizeCategory(aiItem.category)
  const aiProvenance = aiItem.provenance || {}
  const canonicalProvenance = canonicalItem.provenance || {}
  const canOverwriteValues = canUseCanonicalValues(aiItem, canonicalItem)
  return {
    ...aiItem,
    source: 'merged',
    category,
    categoryLabel: normalizeVisualCategoryLabel(category),
    area: preferSpecificArea(canonicalItem.area, aiItem.area),
    title: isGenericTitle(aiItem.title) ? canonicalItem.title : aiItem.title,
    description: aiItem.description || canonicalItem.description,
    figmaValue: canOverwriteValues ? canonicalItem.figmaValue || aiItem.figmaValue : aiItem.figmaValue,
    webValue: canOverwriteValues ? canonicalItem.webValue || aiItem.webValue : aiItem.webValue,
    severity: strongerSeverity(aiItem.severity, canonicalItem.severity),
    sortRank: aiItem.source === 'vision' ? aiItem.sortRank : canonicalItem.sortRank ?? aiItem.sortRank,
    yRatio: canonicalItem.yRatio ?? aiItem.yRatio ?? null,
    xRatio: canonicalItem.xRatio ?? aiItem.xRatio ?? null,
    originalIndex: canonicalItem.originalIndex ?? aiItem.originalIndex ?? null,
    sectionKey: canonicalItem.sectionKey || aiItem.sectionKey || '',
    provenance: {
      origin: 'merged',
      matchedVisionIndex: aiProvenance.matchedVisionIndex ?? null,
      matchedCanonicalEntityIds: canonicalProvenance.matchedCanonicalEntityIds || [],
      canonicalCategory: normalizeCategory(canonicalItem.category),
      canonicalSectionId: canonicalItem.sectionKey || '',
      mergeReason: createMergeReason(aiItem, canonicalItem),
    },
    mergeTokens: [...(aiItem.mergeTokens || []), ...(canonicalItem.mergeTokens || [])],
  }
}

function dedupeItems(items) {
  const seen = new Set()
  const deduped = []
  items.forEach((item) => {
    const key = createDedupeKey(item)
    if (seen.has(key)) return
    if (deduped.some((existing) => areDuplicateItems(existing, item))) return
    seen.add(key)
    deduped.push(item)
  })
  return deduped
}

function createDedupeKey(item) {
  const category = normalizeCategoryForDedupe(item.category)
  const area = normalizeAreaForKey(item.area)
  const section = normalizeAreaForKey(item.sectionKey)
  const figma = normalizeKey(item.figmaValue)
  const web = normalizeKey(item.webValue)
  const numbers = numericTokens(`${item.figmaValue} ${item.webValue}`).join(',')
  if (figma || web || numbers) return `${category}:${area}:${section}:${figma}:${web}:${numbers}`
  return `${category}:${area}:${section}:${normalizeKey(item.title)}:${normalizeKey(item.description)}`
}

function areDuplicateItems(first, second) {
  const firstCategory = normalizeCategoryForDedupe(first.category)
  const secondCategory = normalizeCategoryForDedupe(second.category)
  if (firstCategory !== secondCategory) return false
  if (!canMergeIssueSections(first, second)) return false

  if (normalizedValuesOverlap(first.figmaValue, second.figmaValue) && normalizedValuesOverlap(first.webValue, second.webValue)) return true

  if (firstCategory === 'media' && mediaPairKey(first) && mediaPairKey(first) === mediaPairKey(second)) return true
  if (firstCategory === 'cta' && ctaTokensOverlap(first, second)) return true

  const firstText = normalizeKey(`${first.title} ${first.description} ${(first.mergeTokens || []).join(' ')}`)
  const secondText = normalizeKey(`${second.title} ${second.description} ${(second.mergeTokens || []).join(' ')}`)
  return Boolean(firstText && secondText && (firstText.includes(secondText) || secondText.includes(firstText)))
}

function isDefaultIssueCandidate(item = {}) {
  if (!item || typeof item !== 'object') return false
  if (normalizeConfidence(item.confidence) === 'low') return false
  if (isLowValueIssue(item)) return false
  return ['Text', 'CTA', 'KV / Media', 'Missing'].includes(normalizeVisualCategoryLabel(item.category))
}

function isConsistentIssue(item = {}) {
  const category = normalizeCategory(item.category)
  const searchable = `${item.title || ''} ${item.description || ''} ${item.figmaValue || ''} ${item.webValue || ''}`
  const titleText = `${item.title || ''} ${item.description || ''}`
  if (category === 'cta') return item.source !== 'vision' && hasCtaIssueEvidence(item)
  if (category === 'price') {
    if (/(layout|height|width|ratio|비율|높이|너비|레이아웃|이미지|영상|media)/i.test(titleText)) return false
    return classifyPriceByText(`${item.figmaValue || ''} ${item.webValue || ''}`)
  }
  if (['layout', 'media', 'image'].includes(category) && classifyPriceByText(`${item.figmaValue || ''} ${item.webValue || ''}`) && !isMediaValue(`${item.figmaValue || ''} ${item.webValue || ''}`)) return false
  if (['layout', 'media', 'image'].includes(category) && looksLikeUnrelatedLongTextPair(item)) return false
  if (getString(item.figmaValue) && getString(item.webValue) && !valuesCanBeCompared(item)) return false
  return Boolean(normalizeKey(searchable))
}

function hasCtaIssueEvidence(item = {}) {
  if (item.id === 'canonical-hero-cta-count') return true
  const provenance = item.provenance || {}
  if (provenance.canonicalCategory === 'cta') return true
  return /primary-action|secondary-action|button|cta|href|action/i.test(`${item.mergeTokens?.join(' ') || ''} ${item.description || ''}`)
}

function looksLikeUnrelatedLongTextPair(item = {}) {
  const figma = getString(item.figmaValue)
  const web = getString(item.webValue)
  if (!figma || !web) return false
  if (isMediaValue(figma) || isMediaValue(web)) return false
  if (figma.length < 18 && web.length < 18) return false
  const first = normalizeKey(figma)
  const second = normalizeKey(web)
  return first && second && !first.includes(second) && !second.includes(first) && !shareNumericToken(figma, web)
}

function valuesCanBeCompared(item = {}) {
  const category = normalizeCategory(item.category)
  if (['media', 'image', 'layout'].includes(category)) return isMediaValue(item.figmaValue) || isMediaValue(item.webValue) || !looksLikeUnrelatedLongTextPair(item)
  return true
}

function isLowValueIssue(item = {}) {
  const searchable = `${item.area || ''} ${item.category || ''} ${item.title || ''} ${item.description || ''} ${item.summary || ''} ${item.figmaValue || ''} ${item.webValue || ''} ${(item.mergeTokens || []).join(' ')}`
  const normalized = normalizeKey(searchable)
  const hasMeaningfulValuePair = normalizeKey(item.figmaValue).length > 5 && normalizeKey(item.webValue).length > 5 && /[a-z가-힣]/i.test(`${item.figmaValue || ''} ${item.webValue || ''}`)
  if (!normalized) return true
  if (/cookie|쿠키|session|세션|overlay|popup|팝업|modal|모달/.test(searchable)) return true
  if (/system|cache|playwright|payload|openai/i.test(searchable)) return true
  if (/text\s*node|텍스트\s*노드|matched|figma\s*only|web\s*only/i.test(searchable)) return true
  if (/개수\s*차이|텍스트량|카운트/i.test(searchable) && normalizeCategory(item.category) !== 'cta' && !hasMeaningfulValuePair) return true
  if (/줄바꿈|공백|띄어쓰기|zero.?width|punctuation|spacing|minor/i.test(searchable)) return true
  if (/^(콘텐츠가?\s*다릅니다|content\s*differs)$/i.test(getString(item.title).trim())) return true
  if (getString(item.figmaValue) && getString(item.webValue) && normalizeKey(item.figmaValue) === normalizeKey(item.webValue)) return true
  return false
}

function normalizeCategoryForDedupe(category) {
  const normalized = normalizeCategory(category)
  if (normalized === 'price') return 'text'
  if (['media', 'image', 'layout'].includes(normalized)) return 'media'
  if (normalized === 'count') return 'cta'
  return normalized || 'text'
}

function mediaPairKey(item = {}) {
  const figma = normalizeMediaType(item.figmaValue)
  const web = normalizeMediaType(item.webValue)
  return figma || web ? `${figma}:${web}` : ''
}

function normalizeMediaType(value) {
  const text = getString(value).toLowerCase()
  if (/video|동영상|영상|비디오/.test(text)) return 'video'
  if (/image|이미지|정지|photo|사진/.test(text)) return 'image'
  return normalizeKey(value)
}

function ctaTokensOverlap(first, second) {
  const firstTokens = ctaTokens(first)
  const secondTokens = ctaTokens(second)
  if (!firstTokens.length || !secondTokens.length) return normalizeAreaForKey(first.area) === normalizeAreaForKey(second.area)
  return firstTokens.some((token) => secondTokens.includes(token))
}

function ctaTokens(item = {}) {
  return `${item.figmaValue || ''} ${item.webValue || ''} ${(item.mergeTokens || []).join(' ')}`
    .split(/[\s,/()[\]{}·|]+/)
    .map(normalizeKey)
    .filter((token) => token.length >= 2)
}

function compareIssueItems(first, second) {
  const firstY = getYRatio(first.yRatio)
  const secondY = getYRatio(second.yRatio)
  if (firstY !== null && secondY !== null && firstY !== secondY) return firstY - secondY
  if (firstY !== null && secondY === null) return -1
  if (firstY === null && secondY !== null) return 1
  const sectionDiff = getAreaRank(first.area) - getAreaRank(second.area)
  if (sectionDiff !== 0) return sectionDiff
  const firstIndex = Number(first.originalIndex ?? first.sortRank)
  const secondIndex = Number(second.originalIndex ?? second.sortRank)
  if (Number.isFinite(firstIndex) && Number.isFinite(secondIndex) && firstIndex !== secondIndex) return firstIndex - secondIndex
  return 0
}

function createIssueTitle(issue, category) {
  return createDisplayTitle(category || issue.category)
}

function createIssueDescription(issue, category) {
  const description = getString(issue.description || issue.detail)
  if (description && description !== getString(issue.title)) return description
  if (category === 'price') return 'Figma와 Web의 금액 또는 숫자 값이 다릅니다.'
  if (category === 'cta') return 'Figma와 Web의 CTA 문구 또는 개수가 다릅니다.'
  if (category === 'media') return 'Figma와 Web의 주요 미디어 구성이 다릅니다.'
  return 'Figma와 Web의 문구가 다릅니다.'
}

function createCanonicalTitle(category, area) {
  return createDisplayTitle(category, area)
}

function createDisplayTitle(category) {
  const normalized = normalizeCategory(category)
  if (normalized === 'cta') return 'CTA 구성을 확인해주세요.'
  if (['media', 'image', 'layout'].includes(normalized)) return 'KV 이미지가 다릅니다.'
  if (['missing', 'count'].includes(normalized)) return '요소 유무가 다릅니다.'
  return '텍스트가 다릅니다.'
}

function createCanonicalDescription(category, figmaValue, webValue) {
  if (category === 'price') return '금액, 퍼센트, 기간 등 숫자 값이 서로 다릅니다.'
  if (category === 'cta') return '사용자가 클릭하는 버튼 또는 액션 문구가 서로 다릅니다.'
  if (category === 'media') return '이미지와 영상 등 주요 미디어 구성이 서로 다릅니다.'
  if (!figmaValue || !webValue) return 'Figma 또는 Web 한쪽에서만 확인됩니다.'
  return 'Figma와 Web에서 표시되는 문구가 서로 다릅니다.'
}

function normalizeCanonicalSeverity(difference, category) {
  if (category === 'price') return 'critical'
  if (category === 'count') return 'critical'
  if (String(difference.confidence || difference.matchConfidence || '').toLowerCase() === 'low') return 'check'
  return category === 'media' ? 'warning' : 'warning'
}

function classifyPriceByText(value) {
  const text = getString(value)
  if (!/\d/.test(text)) return false
  return hasStrongPriceEvidence(text)
}

function isPriceDifference(item = {}) {
  if (PRICE_NUMERIC_TYPES.has(getString(item.numericType))) return true
  if (item.priceSignal === true) return true
  const text = `${item.figmaText || item.text || ''} ${item.webText || ''} ${item.fullContextText || ''}`
  if (!classifyPriceByText(text)) return false
  const tokens = numericTokens(text)
  return tokens.length > 0
}

function isCtaDifference(item = {}) {
  const text = `${item.role || ''} ${item.sectionRole || ''} ${item.category || ''} ${item.kind || ''} ${item.entityType || ''}`
  if (/cta|button|action|primary-action|secondary-action/i.test(text)) return true
  const valueText = `${item.figmaText || item.text || ''} ${item.webText || ''}`
  if (looksLikeLongBodyValue(item.figmaText || item.text) || looksLikeLongBodyValue(item.webText)) return false
  return /(사전예약|예약|상담|구매|신청|문의|apply|consult|reserve|buy|learn more)/i.test(valueText)
}

function isMediaDifference(item = {}) {
  const text = `${item.category || ''} ${item.kind || ''} ${item.mediaType || ''} ${item.comparisonHint || ''} ${item.figmaText || ''} ${item.webText || ''}`
  return /(media|image|video|이미지|영상|비디오)/i.test(text)
}

function normalizeCategory(value) {
  const category = getString(value).toLowerCase()
  if (category.includes('numeric') || category.includes('price') || category.includes('amount')) return 'price'
  if (category.includes('cta') || category.includes('action') || category.includes('button')) return 'cta'
  if (category.includes('media') || category.includes('video')) return 'media'
  if (category.includes('image')) return 'image'
  if (category.includes('layout')) return 'layout'
  if (category.includes('missing')) return 'missing'
  if (category.includes('count')) return 'count'
  if (category.includes('text') || category.includes('copy')) return 'text'
  return category ? 'other' : ''
}

function extractEvidenceValues(evidence = []) {
  const values = { figma: '', web: '' }
  if (!Array.isArray(evidence)) return values
  evidence.forEach((item) => {
    const text = getString(item)
    const figmaMatch = text.match(/^\s*figma\s*:\s*(.+)$/i)
    const webMatch = text.match(/^\s*web\s*:\s*(.+)$/i)
    if (figmaMatch && !values.figma) values.figma = figmaMatch[1].trim()
    if (webMatch && !values.web) values.web = webMatch[1].trim()
  })
  return values
}

function createCtaCountDescription(group = {}) {
  const figmaCount = Number(group.figma?.count || 0)
  const webCount = Number(group.web?.count || 0)
  if (figmaCount > webCount) return `Web에 CTA가 ${figmaCount - webCount}개 부족합니다.`
  if (webCount > figmaCount) return `Web에 CTA가 ${webCount - figmaCount}개 더 많습니다.`
  return 'Hero CTA 개수를 확인해야 합니다.'
}

function createMediaDescription(group = {}) {
  const figma = formatMediaTypes(group.figma?.mediaTypes)
  const web = formatMediaTypes(group.web?.mediaTypes)
  if (figma && web) return `Figma는 ${figma}, Web은 ${web}로 감지되었습니다.`
  return 'Figma와 Web의 주요 미디어 구성이 다릅니다.'
}

function createMergeTokens({ category, area, figmaValue, webValue, raw }) {
  return [category, area, figmaValue, webValue, raw?.sectionRole, raw?.role, raw?.sectionPath, raw?.href, raw?.entityId, raw?.sectionId]
    .map(getString)
    .filter(Boolean)
}

function getSortRank(item, area) {
  const ratio = getYRatio(item.yRatio ?? item.sectionYRatio ?? item.figmaYRatio ?? item.webYRatio ?? item.figmaNode?.yRatio ?? item.webElement?.yRatio)
  if (ratio !== null) return ratio * 100
  const order = Number(item.order)
  if (Number.isFinite(order)) return order
  return getAreaRank(area)
}

function getAreaRank(area) {
  return AREA_ORDER[area] || 90
}

function getDefaultAreaForCategory(category) {
  return ['media', 'image', 'layout', 'cta'].includes(category) ? 'Main KV' : 'Page Content'
}

function categoriesAreCompatible(first, second, firstItem = {}, secondItem = {}) {
  if (first === second) return true
  if ((first === 'cta' && second === 'count') || (first === 'count' && second === 'cta')) return true
  if (['media', 'image', 'layout'].includes(first) && ['media', 'image', 'layout'].includes(second)) return true
  if ((first === 'text' && second === 'price') || (first === 'price' && second === 'text')) return hasComparableValuePair(firstItem, secondItem)
  return false
}

function scoreCtaMergeEvidence(firstItem = {}, secondItem = {}) {
  let score = 0
  const firstIds = getCanonicalIds(firstItem)
  const secondIds = getCanonicalIds(secondItem)
  if (firstIds.length > 0 && secondIds.some((id) => firstIds.includes(id))) score += 5
  if (ctaTextOverlap(firstItem, secondItem)) score += 4
  if (hrefMatches(firstItem, secondItem)) score += 4
  if (hasCtaActionEvidence(firstItem) && hasCtaActionEvidence(secondItem) && normalizeKey(firstItem.sectionKey) && normalizeKey(firstItem.sectionKey) === normalizeKey(secondItem.sectionKey)) score += 3
  if (ctaRolesCompatible(firstItem, secondItem)) score += 1
  if (positionsAreNear(firstItem, secondItem)) score += 2
  if (isCtaCountItem(firstItem) || isCtaCountItem(secondItem)) score += 3
  return score
}

function canUseCanonicalValues(aiItem = {}, canonicalItem = {}) {
  if (normalizeCategory(aiItem.category) !== 'cta' && normalizeCategory(canonicalItem.category) !== 'cta') return true
  return scoreCtaMergeEvidence(aiItem, canonicalItem) >= 3
}

function getCanonicalIds(item = {}) {
  const provenanceIds = Array.isArray(item.provenance?.matchedCanonicalEntityIds) ? item.provenance.matchedCanonicalEntityIds : []
  return [item.entityId, item.actionId, item.id, ...provenanceIds].map(getString).map(normalizeKey).filter(Boolean)
}

function ctaTextOverlap(firstItem = {}, secondItem = {}) {
  const first = ctaLabelTokens(firstItem)
  const second = ctaLabelTokens(secondItem)
  if (!first.length || !second.length) return false
  return first.some((token) => second.includes(token))
}

function ctaLabelTokens(item = {}) {
  return [item.figmaValue, item.webValue, ...(item.mergeTokens || [])]
    .map(getString)
    .filter((value) => value && !looksLikeLongBodyValue(value))
    .flatMap((value) => value.split(/[\s,/()[\]{}·|]+/))
    .map(normalizeKey)
    .filter((token) => token.length >= 2 && !/^\d{1,2}$/.test(token))
}

function hrefMatches(firstItem = {}, secondItem = {}) {
  const first = (firstItem.mergeTokens || []).map(getString).filter((token) => /^https?:\/\//i.test(token) || token.startsWith('/'))
  const second = (secondItem.mergeTokens || []).map(getString).filter((token) => /^https?:\/\//i.test(token) || token.startsWith('/'))
  return first.length > 0 && second.some((token) => first.includes(token))
}

function hasCtaActionEvidence(item = {}) {
  return /primary-action|secondary-action|button|cta|href|action/i.test(`${item.mergeTokens?.join(' ') || ''} ${item.description || ''} ${item.id || ''}`)
}

function ctaRolesCompatible(firstItem = {}, secondItem = {}) {
  const text = `${firstItem.mergeTokens?.join(' ') || ''} ${secondItem.mergeTokens?.join(' ') || ''}`
  return /primary-action|secondary-action|cta|button|action/i.test(text)
}

function positionsAreNear(firstItem = {}, secondItem = {}) {
  const firstY = Number(firstItem.yRatio)
  const secondY = Number(secondItem.yRatio)
  const firstX = Number(firstItem.xRatio)
  const secondX = Number(secondItem.xRatio)
  const yNear = Number.isFinite(firstY) && Number.isFinite(secondY) && Math.abs(firstY - secondY) <= 0.06
  const xNear = Number.isFinite(firstX) && Number.isFinite(secondX) && Math.abs(firstX - secondX) <= 0.12
  return yNear && (!Number.isFinite(firstX) || !Number.isFinite(secondX) || xNear)
}

function isCtaCountItem(item = {}) {
  return normalizeCategory(item.category) === 'cta' && /count|개수|부족|누락/i.test(`${item.id || ''} ${item.title || ''} ${item.description || ''} ${(item.mergeTokens || []).join(' ')}`)
}

function canMergeIssueCategories(firstItem = {}, secondItem = {}) {
  const first = normalizeCategory(firstItem.category)
  const second = normalizeCategory(secondItem.category)
  if (categoriesAreCompatible(first, second, firstItem, secondItem)) return true
  return false
}

function canMergeIssueSections(firstItem = {}, secondItem = {}) {
  const firstSection = normalizeKey(firstItem.sectionKey)
  const secondSection = normalizeKey(secondItem.sectionKey)
  if (firstSection && secondSection && firstSection !== secondSection) return false
  const firstArea = normalizeAreaForKey(firstItem.area)
  const secondArea = normalizeAreaForKey(secondItem.area)
  if (firstArea && secondArea && firstArea !== secondArea) {
    return normalizeCategoryForDedupe(firstItem.category) === 'media' && normalizeCategoryForDedupe(secondItem.category) === 'media'
  }
  return true
}

function hasComparableValuePair(firstItem = {}, secondItem = {}) {
  return normalizedValuesOverlap(firstItem.figmaValue, secondItem.figmaValue) && normalizedValuesOverlap(firstItem.webValue, secondItem.webValue)
}

function hasMergeOverlapSignal(firstItem = {}, secondItem = {}) {
  return normalizedValuesOverlap(firstItem.figmaValue, secondItem.figmaValue)
    || normalizedValuesOverlap(firstItem.webValue, secondItem.webValue)
    || shareNumericToken(`${firstItem.figmaValue || ''} ${firstItem.webValue || ''}`, `${secondItem.figmaValue || ''} ${secondItem.webValue || ''}`)
}

function shareNumericToken(first, second) {
  const secondTokens = numericTokens(second)
  return numericTokens(first).some((token) => secondTokens.includes(token))
}

function createMergeReason(aiItem = {}, canonicalItem = {}) {
  const reasons = []
  if (normalizeCategory(aiItem.category) === normalizeCategory(canonicalItem.category)) reasons.push('same-category')
  else reasons.push('compatible-category')
  if (hasComparableValuePair(aiItem, canonicalItem)) reasons.push('same-values')
  if (normalizeKey(aiItem.sectionKey) && normalizeKey(aiItem.sectionKey) === normalizeKey(canonicalItem.sectionKey)) reasons.push('same-section')
  return reasons.join('+')
}

function createSectionKey(item = {}) {
  const explicit = [item.sectionId, item.sectionRootId, item.sectionPath, item.layerPath, item.contextPath, item.selector, item.webSelector, item.figmaNodeId].map(getString).find(Boolean)
  if (explicit) return normalizeKey(explicit)
  const ratio = getYRatio(item.sectionYRatio ?? item.yRatio ?? item.figmaYRatio ?? item.webYRatio)
  return ratio === null ? '' : `y${Math.round(ratio * 100)}`
}

function hasStrongPriceEvidence(value) {
  const text = getString(value)
  if (!/\d/.test(text)) return false
  if (/(₩|\$|€|£|¥)\s*\d|\d[\d.,]*\s*(원|만원|천원|억원|krw|usd|eur|jpy)/i.test(text)) return true
  if (/\d(?:[.,]\d+)?\s*(%|퍼센트)/i.test(text)) return true
  if (/(금리|이율|interest|rate|apr)\s*\d|\d(?:[.,]\d+)?\s*%/.test(text) && /(금리|이율|interest|rate|apr)/i.test(text)) return true
  if (/(월\s*납입|월납입|monthly|payment|per\s*month)/i.test(text) && /(₩|\$|€|£|¥|\d[\d.,]*\s*(원|만원|천원|억원|krw|usd|eur|jpy))/i.test(text)) return true
  if (/(계약기간|약정|리스|렌트|period|term)/i.test(text) && /\d+\s*(개월|년|months?|years?)/i.test(text)) return true
  return false
}

function looksLikeLongBodyValue(value) {
  const text = getString(value)
  return text.length >= 36 || /[.!?]|다\.?|요\.?|니다\.?/.test(text)
}

function normalizeHeroCtaGroup(group = {}) {
  const figmaActions = filterHeroCtaActions(group.figma?.actions)
  const webActions = filterHeroCtaActions(group.web?.actions)
  return {
    ...group,
    figma: { ...(group.figma || {}), count: figmaActions.length, actions: figmaActions },
    web: { ...(group.web || {}), count: webActions.length, actions: webActions },
    countDifference: Math.abs(figmaActions.length - webActions.length),
  }
}

function filterHeroCtaActions(actions) {
  return (Array.isArray(actions) ? actions : []).filter((item) => {
    if (!item || typeof item !== 'object') return false
    if (!['primary-action', 'secondary-action'].includes(getString(item.role))) return false
    if (!['primary', ''].includes(getString(item.comparisonScope))) return false
    if (/reference|navigation|tab|media-control|carousel|utility/i.test(`${item.comparisonScope || ''} ${item.role || ''} ${item.sectionRole || ''}`)) return false
    if (!getString(item.text || item.displayText)) return false
    return true
  })
}

function isMediaValue(value) {
  return /image|video|media|photo|이미지|영상|비디오|사진|미디어/i.test(getString(value))
}

function preferSpecificArea(first, second) {
  if (first && first !== 'Page Content') return first
  return second || first || 'Page Content'
}

function isGenericTitle(title) {
  return ['문구가 다릅니다.', '금액이 다릅니다.', 'CTA 문구가 다릅니다.', '미디어 구성이 다릅니다.'].includes(getString(title))
}

function strongerSeverity(first, second) {
  const rank = { critical: 3, warning: 2, check: 1 }
  return (rank[first] || 0) >= (rank[second] || 0) ? first : second
}

function normalizedValuesOverlap(first, second) {
  const firstKey = normalizeKey(first)
  const secondKey = normalizeKey(second)
  return Boolean(firstKey && secondKey && (firstKey.includes(secondKey) || secondKey.includes(firstKey)))
}

function normalizeAreaForKey(value) {
  return normalizeKey(value || 'Page Content')
}

function numericTokens(value) {
  return getString(value).match(/\d+(?:[.,_]\d+)*/g) || []
}

function getYRatio(value) {
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 && number <= 1 ? number : null
}

function getNullableNumber(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function formatCount(value) {
  if (value === undefined || value === null || value === '') return ''
  return `${Number(value)}개`
}

function formatMediaTypes(value) {
  return Array.isArray(value) ? value.map(getString).filter(Boolean).join(', ') : ''
}

function normalizeSeverity(value) {
  const severity = getString(value).toLowerCase()
  return ['critical', 'warning', 'check'].includes(severity) ? severity : 'warning'
}

function normalizeIssueSeverityForContent(category, severity, item = {}) {
  const normalized = normalizeSeverity(severity)
  if (normalizeCategory(category) === 'text' && normalized === 'critical' && isOrdinalTextDifference(item)) return 'warning'
  return normalized
}

function isOrdinalTextDifference(item = {}) {
  const text = `${item.title || ''} ${item.description || ''} ${item.summary || ''} ${item.figmaValue || item.figmaText || item.text || ''} ${item.webValue || item.webText || ''} ${(item.mergeTokens || []).join(' ')}`
  if (!/(^|\s)(0?[1-9]|[①②③④⑤])(?:[.)]|\s)|(^|\s)0[1-9](?=\s|[가-힣A-Za-z])/.test(text)) return false
  if (hasStrongPriceEvidence(text)) return false
  return !/(포함|제외|include|exclude|included|excluded|필수|의무|법적|고지|약관|조건|보장|미보장|가능|불가|취소|환불|만료|기간|날짜)/i.test(text)
}

function normalizeConfidence(value) {
  const confidence = getString(value).toLowerCase()
  return ['high', 'medium', 'low'].includes(confidence) ? confidence : 'medium'
}

function normalizeKey(value) {
  return getString(value).toLowerCase().replace(/[\s\u00a0.,:;!?"'“”‘’()[\]{}<>_/\\-]/g, '')
}

function getString(value) {
  return typeof value === 'string' ? value : value === undefined || value === null ? '' : String(value)
}
