import { createVisualDifferenceReport } from './visualIssueList.js'

const SOURCE_PRIORITY = {
  final: 1,
  ai: 2,
  comparison: 3,
  cta: 4,
  media: 4,
  price: 4,
}

const SECTION_ORDER = {
  hero: 10,
  main: 20,
  content: 30,
  cta: 40,
  product: 50,
  price: 55,
  body: 60,
  footer: 90,
}

const PRICE_TYPES = new Set(['monthly-payment', 'amount', 'percentage', 'interest-rate', 'duration', 'date', 'price', 'numeric'])
const CTA_ROLES = new Set(['primary-action', 'secondary-action', 'action', 'button', 'cta'])

export function createVisualDisplayIssues(result = {}, aiReview = null) {
  const report = createVisualDisplayIssueReport(result, aiReview)
  return attachMeta(report.items, report.meta)
}

export function createVisualDisplayIssueReport(result = {}, aiReview = null) {
  const finalReport = createVisualDifferenceReport(result, aiReview)
  const comparisonDifferences = array(result.comparison?.differences)
  const aiDifferences = array(aiReview?.review?.visualDifferences)
  const heroCtaGroup = result.aiHints?.heroCtaGroup || {}
  const heroMediaGroup = result.aiHints?.heroMediaGroup || {}
  const prices = array(result.aiHints?.prices)

  const sourceCounts = {
    finalReportItemCount: finalReport.items.length,
    comparisonDifferenceCount: comparisonDifferences.length,
    aiVisualDifferenceCount: aiDifferences.length,
    ctaEvidenceCount: countCtaEvidence(heroCtaGroup),
    mediaEvidenceCount: countMediaEvidence(heroMediaGroup),
    priceNumericEvidenceCount: prices.length,
  }

  const candidates = [
    ...finalReport.items.map((item, index) => fromFinalReportItem(item, index)),
    ...aiDifferences.map((item, index) => fromAiDifference(item, index)),
    ...comparisonDifferences.map((item, index) => fromComparisonDifference(item, index, prices)),
    ...createCtaSupplementalIssues(heroCtaGroup),
    ...createMediaSupplementalIssues(heroMediaGroup),
    ...createPriceSupplementalIssues(prices),
  ].filter(Boolean).filter(isDisplayCandidate)

  const deduped = dedupeDisplayIssues(candidates)
    .sort(compareDisplayIssues)
    .map((item, index) => ({ ...item, id: item.id || `visual-display-${index}` }))

  return {
    items: deduped,
    meta: {
      ...sourceCounts,
      candidateCount: candidates.length,
      displayIssueCount: deduped.length,
      semanticDuplicateRemovedCount: candidates.length - deduped.length,
      finalReportMeta: finalReport.meta,
    },
  }
}

function fromFinalReportItem(item = {}, index) {
  return normalizeIssue({
    ...item,
    id: item.id || `display-final-${index}`,
    source: 'final',
    sourcePriority: SOURCE_PRIORITY.final,
    inputIndex: index,
  })
}

function fromAiDifference(item = {}, index) {
  return normalizeIssue({
    id: `display-ai-${index}`,
    source: 'ai',
    sourcePriority: SOURCE_PRIORITY.ai,
    inputIndex: index,
    category: normalizeCategory(item.category),
    categoryLabel: normalizeCategoryLabel(item.category),
    area: item.area || item.sectionName || item.sectionPath || '',
    title: item.title || createTitle(normalizeCategory(item.category)),
    description: item.summary || item.description || '',
    figmaValue: item.figmaValue || item.figma || item.figmaText || '',
    webValue: item.webValue || item.web || item.webText || '',
    yRatio: firstNumber(item.yRatio, item.sectionYRatio, item.figmaYRatio, item.webYRatio, item.spatialEvidence?.yRatio),
    xRatio: firstNumber(item.xRatio, item.figmaXRatio, item.webXRatio, item.spatialEvidence?.xRatio),
    originalIndex: firstNumber(item.originalIndex, item.order, index),
    sectionKey: createSectionKey(item),
    readableCanonicalArea: item.readableCanonicalArea,
    canonicalArea: item.canonicalArea,
    canonicalAreaName: item.canonicalAreaName,
    readableSectionLabel: item.readableSectionLabel,
    sectionLabel: item.sectionLabel,
    sectionName: item.sectionName,
    normalizedArea: item.normalizedArea,
  })
}

function fromComparisonDifference(item = {}, index, prices = []) {
  const category = classifyComparisonDifference(item, prices)
  return normalizeIssue({
    id: `display-comparison-${index}`,
    source: 'comparison',
    sourcePriority: SOURCE_PRIORITY.comparison,
    inputIndex: index,
    category,
    categoryLabel: normalizeCategoryLabel(category),
    area: item.area || item.sectionName || item.sectionRole || item.sectionPath || '',
    title: createTitle(category),
    description: createDescription(category),
    figmaValue: item.figmaText || item.text || item.figmaValue || '',
    webValue: item.webText || item.webValue || '',
    yRatio: firstNumber(item.yRatio, item.sectionYRatio, item.figmaYRatio, item.webYRatio, item.spatialEvidence?.yRatio),
    xRatio: firstNumber(item.xRatio, item.figmaXRatio, item.webXRatio, item.spatialEvidence?.xRatio),
    originalIndex: firstNumber(item.originalIndex, item.order, index),
    sectionKey: createSectionKey(item),
    readableCanonicalArea: item.readableCanonicalArea,
    canonicalArea: item.canonicalArea,
    canonicalAreaName: item.canonicalAreaName,
    readableSectionLabel: item.readableSectionLabel,
    sectionLabel: item.sectionLabel,
    sectionName: item.sectionName,
    normalizedArea: item.normalizedArea,
  })
}

function createCtaSupplementalIssues(group = {}) {
  const items = []
  const figmaActions = array(group.figma?.actions)
  const webActions = array(group.web?.actions)
  const countDifference = Number(group.countDifference || 0)

  if (countDifference > 0) {
    items.push(normalizeIssue({
      id: 'display-cta-count',
      source: 'cta',
      sourcePriority: SOURCE_PRIORITY.cta,
      inputIndex: 0,
      category: 'cta',
      categoryLabel: 'CTA',
      area: 'Main KV',
      title: 'CTA 구성을 확인해주세요.',
      description: 'Figma와 Web의 CTA 개수가 다릅니다.',
      figmaValue: formatCount(group.figma?.count),
      webValue: formatCount(group.web?.count),
      sectionKey: 'hero-cta',
    }))
  }

  createPairedCtaIssues(figmaActions, webActions).forEach((item, index) => {
    items.push(normalizeIssue({
      ...item,
      id: `display-cta-pair-${index}`,
      source: 'cta',
      sourcePriority: SOURCE_PRIORITY.cta,
      inputIndex: index + 1,
      category: 'cta',
      categoryLabel: 'CTA',
      area: 'Main KV',
      title: 'CTA 구성을 확인해주세요.',
      description: item.description || 'Figma와 Web의 CTA 문구 또는 링크가 다릅니다.',
      sectionKey: 'hero-cta',
    }))
  })

  return items
}

function createPairedCtaIssues(figmaActions, webActions) {
  if (!figmaActions.length || !webActions.length) return []
  const pairs = []
  const usedWeb = new Set()

  figmaActions.forEach((figmaAction, index) => {
    const webIndex = findPairedActionIndex(figmaAction, webActions, usedWeb, index, figmaActions.length)
    if (webIndex < 0) return
    usedWeb.add(webIndex)
    const webAction = webActions[webIndex]
    const figmaLabel = textOf(figmaAction.text || figmaAction.displayText)
    const webLabel = textOf(webAction.text || webAction.displayText)
    const figmaHref = textOf(figmaAction.href)
    const webHref = textOf(webAction.href)
    const labelDiffers = figmaLabel && webLabel && !sameLooseText(figmaLabel, webLabel)
    const hrefDiffers = figmaHref && webHref && figmaHref !== webHref
    if (!labelDiffers && !hrefDiffers) return
    pairs.push({
      figmaValue: [figmaLabel, figmaHref].filter(Boolean).join(' / '),
      webValue: [webLabel, webHref].filter(Boolean).join(' / '),
      yRatio: firstNumber(figmaAction.yRatio, webAction.yRatio, figmaAction.spatialEvidence?.yRatio, webAction.spatialEvidence?.yRatio),
      xRatio: firstNumber(figmaAction.xRatio, webAction.xRatio, figmaAction.spatialEvidence?.xRatio, webAction.spatialEvidence?.xRatio),
      originalIndex: firstNumber(figmaAction.originalIndex, webAction.originalIndex, index),
    })
  })

  return pairs
}

function findPairedActionIndex(figmaAction, webActions, usedWeb, fallbackIndex, figmaCount) {
  const figmaHref = textOf(figmaAction.href)
  if (figmaHref) {
    const byHref = webActions.findIndex((item, index) => !usedWeb.has(index) && textOf(item.href) === figmaHref)
    if (byHref >= 0) return byHref
  }
  const figmaRole = textOf(figmaAction.role)
  if (figmaRole) {
    const byRole = webActions.findIndex((item, index) => !usedWeb.has(index) && textOf(item.role) === figmaRole)
    if (byRole >= 0) return byRole
  }
  if (figmaCount === webActions.length && fallbackIndex < webActions.length && !usedWeb.has(fallbackIndex)) return fallbackIndex
  return -1
}

function createMediaSupplementalIssues(group = {}) {
  if (!group.comparisonHint) return []
  const figmaValue = formatMediaTypes(group.figma?.mediaTypes)
  const webValue = formatMediaTypes(group.web?.mediaTypes)
  return [normalizeIssue({
    id: 'display-hero-media',
    source: 'media',
    sourcePriority: SOURCE_PRIORITY.media,
    inputIndex: 0,
    category: 'media',
    categoryLabel: 'KV / Media',
    area: 'Main KV',
    title: 'KV 이미지가 다릅니다.',
    description: 'Figma와 Web의 주요 미디어 구성이 다릅니다.',
    figmaValue,
    webValue,
    yRatio: firstCandidateNumber(group.figma?.primaryCandidates, group.web?.primaryCandidates, 'yRatio'),
    xRatio: firstCandidateNumber(group.figma?.primaryCandidates, group.web?.primaryCandidates, 'xRatio'),
    sectionKey: 'hero-media',
  })]
}

function createPriceSupplementalIssues(prices = []) {
  const groups = new Map()
  prices.filter((item) => PRICE_TYPES.has(textOf(item.numericType))).forEach((item, index) => {
    const key = `${textOf(item.numericType)}:${createSectionKey(item) || textOf(item.sectionPath) || 'page'}`
    const group = groups.get(key) || { figma: [], web: [] }
    if (item.source === 'figma') group.figma.push({ ...item, inputIndex: index })
    if (item.source === 'web') group.web.push({ ...item, inputIndex: index })
    groups.set(key, group)
  })

  const items = []
  groups.forEach((group, key) => {
    if (group.figma.length !== 1 || group.web.length !== 1) return
    const figma = group.figma[0]
    const web = group.web[0]
    const figmaValue = textOf(figma.displayText || figma.text)
    const webValue = textOf(web.displayText || web.text)
    if (!figmaValue || !webValue || sameLooseText(figmaValue, webValue)) return
    items.push(normalizeIssue({
      id: `display-price-${key}`,
      source: 'price',
      sourcePriority: SOURCE_PRIORITY.price,
      inputIndex: firstNumber(figma.inputIndex, web.inputIndex, 0),
      category: 'price',
      categoryLabel: 'Price / Numeric',
      area: figma.sectionPath || web.sectionPath || '',
      title: '금액/숫자를 확인해주세요.',
      description: 'Figma와 Web의 금액 또는 숫자 값이 다릅니다.',
      figmaValue,
      webValue,
      yRatio: firstNumber(figma.yRatio, web.yRatio, figma.spatialEvidence?.yRatio, web.spatialEvidence?.yRatio),
      xRatio: firstNumber(figma.xRatio, web.xRatio, figma.spatialEvidence?.xRatio, web.spatialEvidence?.xRatio),
      sectionKey: createSectionKey(figma) || createSectionKey(web),
    }))
  })
  return items
}

function normalizeIssue(item = {}) {
  const category = normalizeCategory(item.category || item.categoryLabel)
  return {
    id: item.id || '',
    source: item.source || 'display',
    sourcePriority: item.sourcePriority || SOURCE_PRIORITY[item.source] || 9,
    inputIndex: Number.isFinite(Number(item.inputIndex)) ? Number(item.inputIndex) : 0,
    category,
    categoryLabel: normalizeCategoryLabel(category),
    area: normalizeArea(item.area || item.sectionName || item.sectionPath || item.sectionKey),
    title: item.title || createTitle(category),
    description: item.description || '',
    figmaValue: textOf(item.figmaValue || item.figmaText || item.figma || item.text),
    webValue: textOf(item.webValue || item.webText || item.web),
    yRatio: firstNumber(item.yRatio, item.sectionYRatio, item.spatialEvidence?.yRatio),
    xRatio: firstNumber(item.xRatio, item.spatialEvidence?.xRatio),
    originalIndex: firstNumber(item.originalIndex, item.order),
    sectionId: textOf(item.sectionId),
    sectionRootId: textOf(item.sectionRootId),
    sectionPath: textOf(item.sectionPath),
    canonicalCategory: textOf(item.canonicalCategory),
    mediaType: textOf(item.mediaType),
    figmaMediaType: textOf(item.figmaMediaType),
    webMediaType: textOf(item.webMediaType),
    mediaPair: textOf(item.mediaPair),
    numericType: textOf(item.numericType),
    role: textOf(item.role),
    readableCanonicalArea: textOf(item.readableCanonicalArea),
    canonicalArea: textOf(item.canonicalArea),
    canonicalAreaName: textOf(item.canonicalAreaName),
    readableSectionLabel: textOf(item.readableSectionLabel),
    sectionLabel: textOf(item.sectionLabel),
    sectionName: textOf(item.sectionName),
    normalizedArea: textOf(item.normalizedArea),
    sectionKey: createSectionKey(item),
    sortRank: firstNumber(item.sortRank),
    evidenceSources: normalizeEvidenceSources(item),
  }
}

function isDisplayCandidate(item = {}) {
  if (!item.figmaValue && !item.webValue) return false
  if (isNoiseText(`${item.title} ${item.description} ${item.figmaValue} ${item.webValue}`)) return false
  if (isGenericAiCheck(item)) return false
  if (item.figmaValue && item.webValue && sameLooseText(item.figmaValue, item.webValue)) return false
  if (item.category === 'cta' && !isValidCtaDisplayItem(item)) return false
  return true
}

function isValidCtaDisplayItem(item = {}) {
  if (item.source === 'final' || item.source === 'ai' || item.source === 'comparison') return true
  if (item.id === 'display-cta-count') return true
  return Boolean(item.figmaValue && item.webValue)
}

function dedupeDisplayIssues(items) {
  const deduped = []
  items.forEach((item) => {
    const currentIndex = deduped.findIndex((current) => areDuplicateDisplayIssues(current, item))
    if (currentIndex < 0) {
      deduped.push(item)
      return
    }
    deduped[currentIndex] = mergeDisplayIssue(deduped[currentIndex], item)
  })
  return deduped
}

function areDuplicateDisplayIssues(first = {}, second = {}) {
  if (normalizeCategory(first.category) !== normalizeCategory(second.category)) return false
  const firstValues = `${normalizeComparableText(first.figmaValue)}:${normalizeComparableText(first.webValue)}`
  const secondValues = `${normalizeComparableText(second.figmaValue)}:${normalizeComparableText(second.webValue)}`
  const sectionsCompatible = areSectionsCompatible(first, second)
  if (firstValues && firstValues === secondValues) return true
  if (first.category === 'media') return mediaToken(first.figmaValue) === mediaToken(second.figmaValue) && mediaToken(first.webValue) === mediaToken(second.webValue) && sectionsCompatible
  if (first.category === 'cta') return ctaToken(first.figmaValue) === ctaToken(second.figmaValue) && ctaToken(first.webValue) === ctaToken(second.webValue) && sectionsCompatible
  const firstNumbers = numericTokens(`${first.figmaValue} ${first.webValue}`).join('|')
  const secondNumbers = numericTokens(`${second.figmaValue} ${second.webValue}`).join('|')
  return Boolean(firstNumbers && firstNumbers === secondNumbers && sectionsCompatible)
}

function areSectionsCompatible(first = {}, second = {}) {
  const firstSection = sectionToken(first)
  const secondSection = sectionToken(second)
  return firstSection === secondSection || isDefaultSection(firstSection) || isDefaultSection(secondSection)
}

function mergeDisplayIssue(current, next) {
  const preferred = next.sourcePriority < current.sourcePriority ? next : current
  const canonical = next.source === 'comparison' || next.source === 'cta' || next.source === 'media' || next.source === 'price' ? next : current
  return {
    ...current,
    ...preferred,
    figmaValue: canonical.figmaValue || preferred.figmaValue || current.figmaValue,
    webValue: canonical.webValue || preferred.webValue || current.webValue,
    yRatio: firstNumber(canonical.yRatio, preferred.yRatio, current.yRatio),
    xRatio: firstNumber(canonical.xRatio, preferred.xRatio, current.xRatio),
    originalIndex: firstNumber(canonical.originalIndex, preferred.originalIndex, current.originalIndex),
    sectionKey: canonical.sectionKey || preferred.sectionKey || current.sectionKey,
    canonicalCategory: canonical.canonicalCategory || preferred.canonicalCategory || current.canonicalCategory,
    mediaType: canonical.mediaType || preferred.mediaType || current.mediaType,
    figmaMediaType: canonical.figmaMediaType || preferred.figmaMediaType || current.figmaMediaType,
    webMediaType: canonical.webMediaType || preferred.webMediaType || current.webMediaType,
    mediaPair: canonical.mediaPair || preferred.mediaPair || current.mediaPair,
    numericType: canonical.numericType || preferred.numericType || current.numericType,
    role: canonical.role || preferred.role || current.role,
    readableCanonicalArea: canonical.readableCanonicalArea || preferred.readableCanonicalArea || current.readableCanonicalArea,
    canonicalArea: canonical.canonicalArea || preferred.canonicalArea || current.canonicalArea,
    canonicalAreaName: canonical.canonicalAreaName || preferred.canonicalAreaName || current.canonicalAreaName,
    readableSectionLabel: canonical.readableSectionLabel || preferred.readableSectionLabel || current.readableSectionLabel,
    sectionLabel: canonical.sectionLabel || preferred.sectionLabel || current.sectionLabel,
    sectionName: canonical.sectionName || preferred.sectionName || current.sectionName,
    normalizedArea: canonical.normalizedArea || preferred.normalizedArea || current.normalizedArea,
    inputIndex: Math.min(current.inputIndex, next.inputIndex),
    evidenceSources: uniqueStrings([...(current.evidenceSources || []), ...(next.evidenceSources || [])]),
  }
}

function compareDisplayIssues(first, second) {
  const yDiff = compareNullableNumber(first.yRatio, second.yRatio)
  if (yDiff !== 0) return yDiff
  const sectionDiff = sectionRank(first) - sectionRank(second)
  if (sectionDiff !== 0) return sectionDiff
  const xDiff = compareNullableNumber(first.xRatio, second.xRatio)
  if (xDiff !== 0) return xDiff
  const indexDiff = compareNullableNumber(first.originalIndex, second.originalIndex)
  if (indexDiff !== 0) return indexDiff
  return first.inputIndex - second.inputIndex
}

function classifyComparisonDifference(item = {}, prices = []) {
  const text = `${item.role || ''} ${item.sectionRole || ''} ${item.sectionPath || ''} ${item.numericType || ''}`.toLowerCase()
  if (CTA_ROLES.has(textOf(item.role)) || /cta|button|action|hero actions/.test(text)) return 'cta'
  if (PRICE_TYPES.has(textOf(item.numericType)) || hasPriceSignal(item, prices)) return 'price'
  if (/media|image|video|kv|visual/.test(text)) return 'media'
  if (!item.figmaText || !item.webText) return 'missing'
  return 'text'
}

function hasPriceSignal(item = {}, prices = []) {
  const value = normalizeComparableText(`${item.figmaText || item.text || ''} ${item.webText || ''}`)
  if (numericTokens(value).length > 0 && /[₩$€¥]|원|만원|%|개월|년|월|금리|납입|price|amount/i.test(`${item.figmaText || ''} ${item.webText || ''}`)) return true
  return prices.some((price) => {
    const priceText = normalizeComparableText(`${price.displayText || ''} ${price.text || ''} ${price.fullContextText || ''}`)
    return priceText && (priceText.includes(value) || value.includes(priceText))
  })
}

function normalizeCategory(value) {
  const text = textOf(value).toLowerCase()
  if (/cta|button|action/.test(text)) return 'cta'
  if (/price|numeric|amount|monthly|interest|percentage|duration|date/.test(text)) return 'price'
  if (/media|image|video|layout|kv/.test(text)) return 'media'
  if (/missing|count|only/.test(text)) return 'missing'
  return 'text'
}

function normalizeCategoryLabel(value) {
  const category = normalizeCategory(value)
  if (category === 'cta') return 'CTA'
  if (category === 'media') return 'KV / Media'
  if (category === 'price') return 'Price / Numeric'
  if (category === 'missing') return 'Missing'
  return 'Text'
}

function createTitle(category) {
  if (category === 'cta') return 'CTA 구성을 확인해주세요.'
  if (category === 'media') return 'KV 이미지가 다릅니다.'
  if (category === 'price') return '금액/숫자를 확인해주세요.'
  if (category === 'missing') return '요소 유무가 다릅니다.'
  return '텍스트가 다릅니다.'
}

function createDescription(category) {
  if (category === 'cta') return '사용자가 클릭하는 버튼 또는 액션 문구가 서로 다릅니다.'
  if (category === 'media') return '이미지와 영상 등 주요 미디어 구성이 서로 다릅니다.'
  if (category === 'price') return '금액, 퍼센트, 기간 등 숫자 값이 서로 다릅니다.'
  if (category === 'missing') return 'Figma 또는 Web 한쪽에서만 확인됩니다.'
  return 'Figma와 Web에서 표시되는 문구가 서로 다릅니다.'
}

function normalizeArea(value) {
  const text = textOf(value)
  if (!text) return 'Page Content'
  if (/hero|kv|main visual|main[_\s-]*visual|메인|비주얼/i.test(text)) return 'Main KV'
  if (/footer|푸터/i.test(text)) return 'Footer'
  return text
}

function sectionRank(item = {}) {
  const text = `${item.area || ''} ${item.sectionKey || ''}`.toLowerCase()
  if (/hero|kv|main visual|main kv/.test(text)) return SECTION_ORDER.hero
  if (/footer/.test(text)) return SECTION_ORDER.footer
  if (/cta|action|button/.test(text)) return SECTION_ORDER.cta
  if (/product|card/.test(text)) return SECTION_ORDER.product
  if (/price|numeric|amount|pricing/.test(text)) return SECTION_ORDER.price
  if (/body|content/.test(text)) return SECTION_ORDER.body
  if (/main/.test(text)) return SECTION_ORDER.main
  return SECTION_ORDER.content
}

function compareNullableNumber(first, second) {
  const a = numberOrNull(first)
  const b = numberOrNull(second)
  if (a !== null && b !== null && a !== b) return a - b
  if (a !== null && b === null) return -1
  if (a === null && b !== null) return 1
  return 0
}

function sameLooseText(first, second) {
  return normalizeComparableText(first) === normalizeComparableText(second)
}

function normalizeComparableText(value) {
  return textOf(value)
    .toLowerCase()
    .replace(/[\u200b-\u200d\ufeff]/g, '')
    .replace(/[\s\u00a0.,:;!?"'“”‘’()[\]{}<>_/\\\-·|]+/g, '')
}

function isNoiseText(value) {
  return /cookie|consent|privacy preference|쿠키|동의/.test(textOf(value).toLowerCase())
}

function isGenericAiCheck(item = {}) {
  const text = `${item.title || ''} ${item.description || ''}`.trim()
  if (item.figmaValue || item.webValue) return false
  return /확인 필요|검토 필요|check/i.test(text)
}

function createSectionKey(item = {}) {
  return textOf(item.sectionKey || item.sectionId || item.sectionRootId || item.sectionPath || item.area)
}

function sectionToken(item = {}) {
  const value = normalizeComparableText(item.sectionKey || item.area || item.sectionPath || '') || 'page'
  return /^y\d+$/.test(value) ? 'page' : value
}

function isDefaultSection(value) {
  return value === 'page' || value === 'pagecontent'
}

function ctaToken(value) {
  return normalizeComparableText(value).replace(/https?:\/\//g, '')
}

function mediaToken(value) {
  const text = textOf(value).toLowerCase()
  if (/video|동영상|영상|비디오/.test(text)) return 'video'
  if (/image|이미지|photo|picture|사진/.test(text)) return 'image'
  return normalizeComparableText(value)
}

function numericTokens(value) {
  return textOf(value).match(/\d+(?:[.,]\d+)?/g) || []
}

function textOf(value) {
  return typeof value === 'string' ? value.trim() : value === undefined || value === null ? '' : String(value).trim()
}

function array(value) {
  return Array.isArray(value) ? value.filter((item) => item && typeof item === 'object') : []
}

function normalizeEvidenceSources(item = {}) {
  return uniqueStrings([...(Array.isArray(item.evidenceSources) ? item.evidenceSources : []), item.source])
}

function uniqueStrings(values = []) {
  return [...new Set(values.map(textOf).filter(Boolean))]
}

function numberOrNull(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function firstNumber(...values) {
  for (const value of values) {
    const number = numberOrNull(value)
    if (number !== null) return number
  }
  return null
}

function firstCandidateNumber(figmaCandidates = [], webCandidates = [], field) {
  return firstNumber(array(figmaCandidates)[0]?.[field], array(webCandidates)[0]?.[field], array(figmaCandidates)[0]?.spatialEvidence?.[field], array(webCandidates)[0]?.spatialEvidence?.[field])
}

function formatCount(value) {
  const count = Number(value || 0)
  return `${Number.isFinite(count) ? count : 0}개`
}

function formatMediaTypes(value) {
  const values = Array.isArray(value) ? value.map(textOf).filter(Boolean) : []
  return values.length > 0 ? values.join(', ') : ''
}

function countCtaEvidence(group = {}) {
  return array(group.figma?.actions).length + array(group.web?.actions).length + array(group.textDifferences).length + (Number(group.countDifference || 0) > 0 ? 1 : 0)
}

function countMediaEvidence(group = {}) {
  return array(group.figma?.primaryCandidates).length + array(group.web?.primaryCandidates).length + (group.comparisonHint ? 1 : 0)
}

function attachMeta(items, meta) {
  Object.defineProperty(items, 'meta', { value: meta, enumerable: false })
  return items
}
