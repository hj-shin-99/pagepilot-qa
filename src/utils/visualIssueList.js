const VISUAL_AI_CATEGORIES = new Set(['price', 'text', 'cta', 'media'])
const PRICE_NUMERIC_TYPES = new Set(['monthly-payment', 'amount', 'percentage', 'interest-rate', 'duration'])

const CATEGORY_LABELS = {
  text: 'Text',
  cta: 'CTA',
  price: 'Price',
  media: 'Media',
  image: 'Image',
  layout: 'Layout',
  missing: 'Missing',
  count: 'Count',
  other: 'Other',
}

const CATEGORY_ORDER = {
  text: 1,
  cta: 2,
  media: 3,
  image: 3,
  layout: 3,
  price: 4,
  missing: 5,
  count: 5,
  other: 6,
}

const AREA_ORDER = {
  'Main Visual': 10,
  Navigation: 20,
  'Product Promotion': 40,
  'Product Card': 45,
  Footer: 80,
  'Page Content': 90,
}

export function createVisualDifferenceItems(result = {}, aiReview = null) {
  const canonicalItems = createCanonicalItems(result)
  const visionItems = shouldUseAiReview(aiReview) ? createVisionItems(aiReview) : []
  const aiItems = shouldUseAiReview(aiReview) ? createAiItems(aiReview) : []
  const preferredItems = [...visionItems, ...aiItems]
  const sourceItems = preferredItems.length > 0 ? mergeAiAndCanonicalItems(preferredItems, canonicalItems) : canonicalItems

  return dedupeItems(sourceItems)
    .map((item, index) => ({ ...item, id: item.id || `visual-difference-${index}` }))
    .sort(compareIssueItems)
    .slice(0, 16)
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
        title: getString(item.title) || createCanonicalTitle(category, area),
        description: getString(item.summary || item.description) || createCanonicalDescription(category, item.figmaValue, item.webValue),
        figmaValue: getString(item.figmaValue || item.figma),
        webValue: getString(item.webValue || item.web),
        severity: normalizeSeverity(item.severity),
        confidence: normalizeConfidence(item.confidence),
        sortRank: Number.isFinite(Number(item.order)) ? Number(item.order) : getAreaRank(area),
        mergeTokens: [item.area, item.category, item.title, item.summary, item.figmaValue, item.webValue].map(getString).filter(Boolean),
      }
    })
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

  if (/hero|main.?visual|main|kv|key.?visual|visual/.test(raw)) return 'Main Visual'
  if (/nav|navigation|header|gnb|menu/.test(raw)) return 'Navigation'
  if (/footer|legal|copyright/.test(raw)) return 'Footer'
  if (/promotion|promo|campaign|offer|benefit/.test(raw)) return 'Product Promotion'
  if (/product|vehicle|model|card|tile|price|payment|amount|금액|가격|납입/.test(raw)) return 'Product Card'
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
        area: normalizeVisualArea(issue, category === 'media' || category === 'cta' ? 'Main Visual' : 'Page Content'),
        title: createIssueTitle(issue, category),
        description: createIssueDescription(issue, category),
        figmaValue: evidenceValues.figma,
        webValue: evidenceValues.web,
        severity: normalizeSeverity(issue.severity || (index < mustFix.length ? 'critical' : 'warning')),
        sortRank: getAreaRank(normalizeVisualArea(issue, category === 'media' || category === 'cta' ? 'Main Visual' : 'Page Content')),
      }
    })
}

function createCanonicalItems(result = {}) {
  const comparison = result.comparison || {}
  const aiHints = result.aiHints || {}
  const differences = Array.isArray(comparison.differences) ? comparison.differences : []
  const items = differences.map((difference, index) => createCanonicalDifferenceItem(difference, index, aiHints))

  const heroCtaGroup = aiHints.heroCtaGroup || {}
  if (Number(heroCtaGroup.countDifference || 0) > 0) {
    items.push({
      id: 'canonical-hero-cta-count',
      source: 'canonical',
      category: 'count',
      categoryLabel: 'Count',
      area: 'Main Visual',
      title: 'Hero CTA 개수가 다릅니다.',
      description: createCtaCountDescription(heroCtaGroup),
      figmaValue: formatCount(heroCtaGroup.figma?.count),
      webValue: formatCount(heroCtaGroup.web?.count),
      severity: 'critical',
      sortRank: 12,
      mergeTokens: ['hero', 'cta', 'count'],
    })
  }

  const heroMediaGroup = aiHints.heroMediaGroup || {}
  if (heroMediaGroup.comparisonHint) {
    items.push({
      id: 'canonical-hero-media',
      source: 'canonical',
      category: 'media',
      categoryLabel: 'Media',
      area: 'Main Visual',
      title: 'Hero 미디어 구성이 다릅니다.',
      description: createMediaDescription(heroMediaGroup),
      figmaValue: formatMediaTypes(heroMediaGroup.figma?.mediaTypes),
      webValue: formatMediaTypes(heroMediaGroup.web?.mediaTypes),
      severity: 'warning',
      sortRank: 14,
      mergeTokens: ['hero', 'media', formatMediaTypes(heroMediaGroup.figma?.mediaTypes), formatMediaTypes(heroMediaGroup.web?.mediaTypes)],
    })
  }

  return items.filter(Boolean)
}

function createCanonicalDifferenceItem(difference = {}, index, aiHints = {}) {
  const category = classifyVisualDifferenceItem(enrichDifferenceWithPriceSignals(difference, aiHints))
  const area = normalizeVisualArea(difference, category === 'cta' ? 'Main Visual' : 'Page Content')
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
    sortRank: getSortRank(difference, area),
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

function mergeAiAndCanonicalItems(aiItems, canonicalItems) {
  const usedCanonicalIndexes = new Set()
  const mergedAiItems = aiItems.map((aiItem) => {
    const matchIndex = findBestCanonicalMatch(aiItem, canonicalItems, usedCanonicalIndexes)
    if (matchIndex === -1) return aiItem
    usedCanonicalIndexes.add(matchIndex)
    return mergeIssueItem(aiItem, canonicalItems[matchIndex])
  })

  const remainingCanonicalItems = canonicalItems.filter((_, index) => !usedCanonicalIndexes.has(index))
  return [...mergedAiItems, ...remainingCanonicalItems]
}

function findBestCanonicalMatch(aiItem, canonicalItems, usedIndexes) {
  let bestIndex = -1
  let bestScore = 0
  canonicalItems.forEach((canonicalItem, index) => {
    if (usedIndexes.has(index)) return
    const score = scoreIssueMatch(aiItem, canonicalItem)
    if (score > bestScore) {
      bestScore = score
      bestIndex = index
    }
  })
  return bestScore >= 3 ? bestIndex : -1
}

function scoreIssueMatch(aiItem, canonicalItem) {
  let score = 0
  const aiCategory = normalizeCategory(aiItem.category)
  const canonicalCategory = normalizeCategory(canonicalItem.category)
  if (aiCategory === canonicalCategory) score += 2
  if (categoriesAreCompatible(aiCategory, canonicalCategory)) score += 1
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
  return {
    ...aiItem,
    source: 'merged',
    category,
    categoryLabel: normalizeVisualCategoryLabel(category),
    area: preferSpecificArea(canonicalItem.area, aiItem.area),
    title: isGenericTitle(aiItem.title) ? canonicalItem.title : aiItem.title,
    description: aiItem.description || canonicalItem.description,
    figmaValue: canonicalItem.figmaValue || aiItem.figmaValue,
    webValue: canonicalItem.webValue || aiItem.webValue,
    severity: strongerSeverity(aiItem.severity, canonicalItem.severity),
    sortRank: canonicalItem.sortRank ?? aiItem.sortRank,
    mergeTokens: [...(aiItem.mergeTokens || []), ...(canonicalItem.mergeTokens || [])],
  }
}

function dedupeItems(items) {
  const seen = new Set()
  return items.filter((item) => {
    const key = createDedupeKey(item)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function createDedupeKey(item) {
  const category = normalizeCategory(item.category)
  const area = normalizeAreaForKey(item.area)
  const figma = normalizeKey(item.figmaValue)
  const web = normalizeKey(item.webValue)
  const numbers = numericTokens(`${item.figmaValue} ${item.webValue}`).join(',')
  if (figma || web || numbers) return `${category}:${area}:${figma}:${web}:${numbers}`
  return `${category}:${area}:${normalizeKey(item.title)}:${normalizeKey(item.description)}`
}

function compareIssueItems(first, second) {
  const sortDiff = (first.sortRank ?? getAreaRank(first.area)) - (second.sortRank ?? getAreaRank(second.area))
  if (sortDiff !== 0) return sortDiff
  return (CATEGORY_ORDER[normalizeCategory(first.category)] || 99) - (CATEGORY_ORDER[normalizeCategory(second.category)] || 99)
}

function createIssueTitle(issue, category) {
  const title = getString(issue.title)
  if (title) return title
  return createCanonicalTitle(category, normalizeVisualArea(issue))
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
  if (category === 'price') return area === 'Product Promotion' ? '프로모션 금액이 다릅니다.' : '금액 또는 숫자 값이 다릅니다.'
  if (category === 'cta') return area === 'Main Visual' ? 'Hero CTA 문구가 다릅니다.' : 'CTA 문구가 다릅니다.'
  if (category === 'media') return area === 'Main Visual' ? 'Hero 미디어 구성이 다릅니다.' : '미디어 구성이 다릅니다.'
  if (category === 'missing') return '한쪽에만 있는 항목입니다.'
  if (category === 'count') return '항목 개수가 다릅니다.'
  return area === 'Main Visual' ? 'Hero 메인 문구가 다릅니다.' : '문구가 다릅니다.'
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
  return /(원|만원|억원|%|퍼센트|월\s*\d|개월|금리|이자|납입|납부|가격|금액|할인|price|amount|payment|rate|interest|percent|monthly)/i.test(text)
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
  return /(사전예약|예약|상담|구매|신청|문의|apply|consult|reserve|buy|learn more)/i.test(`${item.figmaText || item.text || ''} ${item.webText || ''}`)
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
  return [category, area, figmaValue, webValue, raw?.sectionRole, raw?.role, raw?.sectionPath]
    .map(getString)
    .filter(Boolean)
}

function getSortRank(item, area) {
  const ratio = getYRatio(item.sectionYRatio ?? item.yRatio ?? item.figmaYRatio ?? item.webYRatio ?? item.figmaNode?.yRatio ?? item.webElement?.yRatio)
  if (ratio !== null) return ratio * 100
  return getAreaRank(area)
}

function getAreaRank(area) {
  return AREA_ORDER[area] || 90
}

function getDefaultAreaForCategory(category) {
  return ['media', 'image', 'layout', 'cta'].includes(category) ? 'Main Visual' : 'Page Content'
}

function categoriesAreCompatible(first, second) {
  if (first === second) return true
  return (first === 'cta' && second === 'count') || (first === 'count' && second === 'cta') || (first === 'media' && second === 'image') || (first === 'image' && second === 'media')
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
