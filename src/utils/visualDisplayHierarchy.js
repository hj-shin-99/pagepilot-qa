const EMPTY_CATEGORY_COUNTS = {
  cta: 0,
  media: 0,
  price: 0,
  text: 0,
  missing: 0,
}

export function createCoreVisualIssues(items = []) {
  const sourceItems = Array.isArray(items) ? items.filter((item) => item && typeof item === 'object') : []
  const excludedReasonCounts = countExcludedReasons(sourceItems)
  const coreCandidates = sourceItems.filter(isCoreVisualIssue).map(createCoreDisplayIssue)
  const coreItems = dedupeSemanticCoreIssues(coreCandidates)
  const heroTextEvidenceCount = sourceItems.filter(isHeroTextEvidence).length
  const heroTextCoreCount = coreItems.filter((item) => isHeroTextEvidence(item)).length
  return attachMeta(coreItems, {
    allIssueCount: sourceItems.length,
    sourceIssueCount: sourceItems.length,
    coreCandidateCount: coreCandidates.length,
    coreIssueCount: coreItems.length,
    coreAfterSemanticDedupeCount: coreItems.length,
    excludedFromCoreCount: sourceItems.length - coreCandidates.length,
    semanticDuplicateRemovedCount: coreCandidates.length - coreItems.length,
    excludedReasonCounts: {
      ...excludedReasonCounts,
      'semantic-duplicate': coreCandidates.length - coreItems.length,
    },
    heroTextEvidenceCount,
    heroTextDisplayCandidateCount: coreCandidates.filter((item) => isHeroTextEvidence(item)).length,
    heroTextCoreCount,
    heroTextExcludedCount: Math.max(0, heroTextEvidenceCount - heroTextCoreCount),
    heroTextExcludedReasonCounts: countHeroTextExcludedReasons(sourceItems),
    crossCategoryDedupeRejectedCount: 0,
    coreCategoryCounts: countCategories(coreItems),
    engineDataDeletedCount: 0,
  })
}

function isHeroTextEvidence(item = {}) {
  return normalizeDisplayCategory(item) === 'text' && isHeroMainArea(item) && Boolean(item.figmaValue && item.webValue)
}

function countHeroTextExcludedReasons(items = []) {
  const counts = {
    equivalent: 0,
    'low-value': 0,
    'particle-only': 0,
    'section-mismatch': 0,
    'semantic-duplicate': 0,
    'missing-pair': 0,
  }

  items.filter((item) => normalizeDisplayCategory(item) === 'text' && isHeroMainArea(item)).forEach((item) => {
    if (!item.figmaValue || !item.webValue) counts['missing-pair'] += 1
    else if (sameComparableText(item.figmaValue, item.webValue)) counts.equivalent += 1
    else if (isParticleOnlyTextDifference(item.figmaValue, item.webValue)) counts['particle-only'] += 1
    else if (!isCoreVisualIssue(item)) counts['low-value'] += 1
  })

  return counts
}

export function normalizeDisplayCategory(item = {}) {
  if (hasCtaEvidence(item)) return 'cta'
  if (hasPriceEvidence(item)) return 'price'
  if (hasMediaEvidence(item)) return 'media'
  if (normalizeCategory(item.category || item.categoryLabel) === 'missing') return 'missing'
  return 'text'
}

export function isCoreVisualIssue(item = {}) {
  if (!item || typeof item !== 'object') return false
  if (!item.__skipExclusionCheck && isCoreExclusion(item)) return false

  const category = normalizeDisplayCategory(item)
  if (hasJointCanonicalAiEvidence(item)) return true
  if (category === 'media') return true
  if (category === 'price') return true
  if (category === 'cta') return isClearCtaIssue(item)
  if (category === 'missing') return isPrimaryAreaIssue(item)
  if (category === 'text') return isMeaningChangingTextIssue(item)
  return false
}

function isCoreExclusion(item = {}) {
  return getExclusionReason(item) !== ''
}

function getExclusionReason(item = {}) {
  const text = issueText(item)
  if (!item.figmaValue && !item.webValue) return 'invalid'
  if (sameComparableText(item.figmaValue, item.webValue)) return 'low-value-text'
  if (isOrdinalOnlyDifference(item)) return 'ordinal-only'
  if (isLayerPathOnlyIssue(item)) return 'technical-path'
  if (/\b(cache|payload|selector|dom selector|system|raw vision|node id)\b/i.test(text)) return 'system'
  if (/일반적인\s*확인\s*필요|generic check/i.test(text)) return 'generic-check'
  return ''
}

function countExcludedReasons(items = []) {
  const counts = {
    'low-value-text': 0,
    'ordinal-only': 0,
    'semantic-duplicate': 0,
    'non-core': 0,
    invalid: 0,
  }

  items.forEach((item) => {
    const reason = getExclusionReason(item)
    if (reason) {
      counts[reason] = (counts[reason] || 0) + 1
      return
    }
    if (!isCoreVisualIssue({ ...item, __skipExclusionCheck: true })) counts['non-core'] += 1
  })

  return counts
}

function createCoreDisplayIssue(item = {}) {
  const displayCategory = normalizeDisplayCategory(item)
  return {
    ...item,
    originalCategory: item.originalCategory || item.category,
    originalCategoryLabel: item.originalCategoryLabel || item.categoryLabel,
    displayCategory,
    displayCategoryLabel: getDisplayCategoryLabel(displayCategory),
    title: normalizeCoreTitle(item, displayCategory),
  }
}

function dedupeSemanticCoreIssues(items = []) {
  const deduped = []
  items.forEach((item) => {
    const currentIndex = deduped.findIndex((current) => createSemanticKey(current) === createSemanticKey(item))
    if (currentIndex < 0) {
      deduped.push(item)
      return
    }
    deduped[currentIndex] = preferCoreIssue(deduped[currentIndex], item)
  })
  return deduped
}

function preferCoreIssue(first, second) {
  const firstRank = getSourceRank(first)
  const secondRank = getSourceRank(second)
  const preferred = secondRank < firstRank ? second : first
  const fallback = preferred === first ? second : first
  const category = preferred.displayCategory || normalizeDisplayCategory(preferred)
  return {
    ...fallback,
    ...preferred,
    figmaValue: chooseRepresentativeValue(preferred.figmaValue, fallback.figmaValue, category),
    webValue: chooseRepresentativeValue(preferred.webValue, fallback.webValue, category),
    yRatio: firstNumber(preferred.yRatio, preferred.spatialEvidence?.yRatio, fallback.yRatio, fallback.spatialEvidence?.yRatio),
    xRatio: firstNumber(preferred.xRatio, preferred.spatialEvidence?.xRatio, fallback.xRatio, fallback.spatialEvidence?.xRatio),
    originalIndex: firstNumber(preferred.originalIndex, fallback.originalIndex),
    evidenceSources: uniqueStrings([...(fallback.evidenceSources || []), ...(preferred.evidenceSources || [])]),
  }
}

function chooseRepresentativeValue(preferred, fallback, category) {
  if (category !== 'media') return preferred || fallback
  const preferredText = textOf(preferred)
  const fallbackText = textOf(fallback)
  if (!preferredText) return fallbackText
  if (!fallbackText) return preferredText
  if (isGenericMediaValue(preferredText) && !isGenericMediaValue(fallbackText)) return fallbackText
  return preferredText.length >= fallbackText.length ? preferredText : fallbackText
}

function isGenericMediaValue(value) {
  return /^(image|video|still|motion|background|이미지|영상|동영상|비디오)$/i.test(textOf(value))
}

function getSourceRank(item = {}) {
  const sources = Array.isArray(item.evidenceSources) ? item.evidenceSources : []
  if (item.source === 'final') return 1
  if (sources.includes('final') && sources.includes('ai')) return 2
  if (item.source === 'ai') return 3
  return 4
}

function createSemanticKey(item = {}) {
  const category = item.displayCategory || normalizeDisplayCategory(item)
  return [
    category,
    createAreaKey(item),
    createValuePairKey(item),
    category === 'text' || category === 'missing' ? createTitleKey(item) : '',
  ].join(':')
}

function createAreaKey(item = {}) {
  const area = normalizeAreaText(item.readableCanonicalArea || item.canonicalArea || item.canonicalAreaName || item.sectionLabel || item.sectionName || item.normalizedArea || item.area)
  if (/mainvisual|mainkv|hero|kv/.test(area)) return 'mainvisual'
  const section = textOf(item.canonicalSectionId || item.sectionId || item.sectionRootId || item.sectionKey)
  if (section) return normalizeComparableText(section)
  const yRatio = firstNumber(item.yRatio, item.spatialEvidence?.yRatio)
  if (yRatio !== null) return `${area || 'page'}:${Math.floor(yRatio / 0.18)}`
  return area || 'page'
}

function createValuePairKey(item = {}) {
  const category = item.displayCategory || normalizeDisplayCategory(item)
  if (category === 'media') return `${mediaToken(item.figmaValue)}>${mediaToken(item.webValue)}`
  if (category === 'cta') return `${ctaToken(item.figmaValue)}>${ctaToken(item.webValue)}`
  if (category === 'price') return numericTokens(`${item.figmaValue} ${item.webValue}`).join('|') || `${normalizeComparableText(item.figmaValue)}>${normalizeComparableText(item.webValue)}`
  return `${normalizeComparableText(item.figmaValue)}>${normalizeComparableText(item.webValue)}`
}

function createTitleKey(item = {}) {
  return normalizeComparableText(item.title).replace(/(figma|web|차이|다릅니다|확인|해주세요|kv|media|image|video|이미지|영상|미디어)/g, '')
}

function normalizeCoreTitle(item = {}, category) {
  const title = textOf(item.title)
  const misleadingMediaTitle = category === 'text' && /media|image|video|kv|이미지|영상|미디어/i.test(title)
  if (category === 'media') return 'KV 미디어 타입이 다릅니다.'
  if (category === 'cta') return 'CTA 구성을 확인해주세요.'
  if (category === 'price') return '금액/숫자를 확인해주세요.'
  if (category === 'missing') return '핵심 콘텐츠 유무가 다릅니다.'
  return !title || misleadingMediaTitle ? '텍스트가 다릅니다.' : title
}

function getDisplayCategoryLabel(category) {
  if (category === 'cta') return 'CTA'
  if (category === 'media') return 'KV / Media'
  if (category === 'price') return 'Price / Numeric'
  if (category === 'missing') return 'Missing'
  return 'Text'
}

function isClearCtaIssue(item = {}) {
  const text = issueText(item)
  if (/후보|candidate/i.test(text) && !/(개수|count|존재|missing|href|url|link|링크)/i.test(text)) return false
  if (/확인 필요|검토 필요/i.test(text) && !item.figmaValue && !item.webValue) return false
  if (/개수|count|존재|missing|href|url|link|링크|문구|label|button|cta|action|버튼/i.test(text)) return true
  return Boolean(item.figmaValue && item.webValue)
}

function isMeaningChangingTextIssue(item = {}) {
  const text = issueText(item)
  if (/오탈자|typo|spelling|철자/i.test(text)) return true
  if (isSubstantialSuffixOmission(item.figmaValue, item.webValue)) return true
  if (isHeroMainArea(item) && hasDivergentHeroCopy(item.figmaValue, item.webValue)) return true
  return hasOppositeMeaningPair(item.figmaValue, item.webValue)
}

function isHeroMainArea(item = {}) {
  return /hero|kv|main visual|main kv|메인|비주얼/i.test(`${item.area || ''} ${item.readableCanonicalArea || ''} ${item.canonicalArea || ''} ${item.sectionLabel || ''} ${item.sectionName || ''} ${item.normalizedArea || ''} ${item.sectionPath || ''} ${item.sectionKey || ''}`)
}

function hasDivergentHeroCopy(first, second) {
  const a = meaningfulTokens(first)
  const b = meaningfulTokens(second)
  if (a.length < 2 || b.length < 2) return false
  const prefixLength = commonPrefixLength(a, b)
  if (prefixLength < 1) return false
  const aSuffix = a.slice(prefixLength)
  const bSuffix = b.slice(prefixLength)
  if (!aSuffix.length || !bSuffix.length) return false
  if (isParticleOnlyTokenDiff(aSuffix, bSuffix)) return false
  const suffixOverlap = tokenOverlapRatio(aSuffix, bSuffix)
  const totalOverlap = tokenOverlapRatio(a, b)
  return suffixOverlap <= 0.5 || totalOverlap <= 0.58
}

function commonPrefixLength(firstTokens, secondTokens) {
  const max = Math.min(firstTokens.length, secondTokens.length)
  let index = 0
  while (index < max && firstTokens[index] === secondTokens[index]) index += 1
  return index
}

function tokenOverlapRatio(firstTokens, secondTokens) {
  const firstSet = new Set(firstTokens)
  const secondSet = new Set(secondTokens)
  const intersection = [...firstSet].filter((token) => secondSet.has(token)).length
  return intersection / Math.max(firstSet.size, secondSet.size, 1)
}

function isParticleOnlyTokenDiff(firstTokens, secondTokens) {
  const normalize = (tokens) => tokens.map((token) => token.replace(/(은|는|이|가|을|를)$/u, '')).filter(Boolean).join(' ')
  return normalize(firstTokens) === normalize(secondTokens)
}

function isParticleOnlyTextDifference(first, second) {
  const a = meaningfulTokens(first)
  const b = meaningfulTokens(second)
  return a.length > 0 && b.length > 0 && isParticleOnlyTokenDiff(a, b)
}

function isSubstantialSuffixOmission(first, second) {
  const a = normalizeMeaningText(first)
  const b = normalizeMeaningText(second)
  if (!a || !b) return false
  const longer = a.length >= b.length ? a : b
  const shorter = longer === a ? b : a
  if (shorter.length < 2 || longer.length - shorter.length < 8) return false
  if (!longer.startsWith(shorter)) return false
  const missingSuffix = longer.slice(shorter.length).trim()
  if (isLowValueSuffix(missingSuffix)) return false
  const longerTokens = meaningfulTokens(longer)
  if (longerTokens.length < 3) return missingSuffix.length >= 8
  const shorterTokenSet = new Set(meaningfulTokens(shorter))
  const missingTokenCount = longerTokens.filter((token) => !shorterTokenSet.has(token)).length
  return missingTokenCount / longerTokens.length >= 0.35 || missingSuffix.length >= 10
}

function isLowValueSuffix(value) {
  return /^[\s.,:;!?"'“”‘’()[\]{}<>·~-]*(은|는|이|가|을|를|요|다|입니다|합니다)?[\s.,:;!?"'“”‘’()[\]{}<>·~-]*$/.test(textOf(value))
}

function meaningfulTokens(value) {
  return textOf(value)
    .toLowerCase()
    .split(/[^0-9a-z가-힣]+/i)
    .map((token) => token.replace(/(은|는|이|가|을|를)$/u, ''))
    .filter((token) => token.length >= 2)
}

function hasJointCanonicalAiEvidence(item = {}) {
  const sources = Array.isArray(item.evidenceSources) ? item.evidenceSources : []
  return sources.includes('final') && sources.includes('ai')
}

function hasOppositeMeaningPair(first, second) {
  const a = normalizeMeaningText(first)
  const b = normalizeMeaningText(second)
  if (!a || !b) return false
  return hasPair(a, b, '포함', '제외')
    || hasPair(a, b, 'include', 'exclude')
    || hasPair(a, b, 'included', 'excluded')
    || hasPair(a, b, 'and', 'or')
    || hasPair(a, b, '프로그램', '상품')
    || hasPair(a, b, '가능', '불가')
    || hasPair(a, b, '필수', '선택')
}

function hasPair(first, second, left, right) {
  return (containsTerm(first, left) && containsTerm(second, right)) || (containsTerm(first, right) && containsTerm(second, left))
}

function containsTerm(value, term) {
  if (/^[a-z]+$/i.test(term)) return new RegExp(`\\b${escapeRegex(term)}\\b`, 'i').test(value)
  return value.includes(term)
}

function isPrimaryAreaIssue(item = {}) {
  return /hero|kv|main visual|main kv|navigation|nav|product|price|cta|button|core content|key content|주요|핵심|메인|상품|가격/i.test(issueText(item))
}

function isOrdinalOnlyDifference(item = {}) {
  const values = [item.figmaValue, item.webValue].map(textOf).filter(Boolean)
  if (!values.length) return false
  const normalizedValues = values.map((value) => value.replace(/^0+/, '') || '0')
  const ordinalValuesOnly = values.every((value) => /^0?\d{1,2}$/.test(value))
  if (ordinalValuesOnly) return true
  return normalizedValues.every((value) => /^\d{1,2}$/.test(value)) && /순번|번호|index|order/i.test(issueText(item))
}

function isLayerPathOnlyIssue(item = {}) {
  const values = [item.area, item.sectionPath, item.title, item.figmaValue, item.webValue].map(textOf).filter(Boolean)
  const longPathValues = values.filter(isLongTechnicalPath)
  return longPathValues.length > 0 && longPathValues.length === values.length
}

function isLongTechnicalPath(value) {
  const text = textOf(value)
  if (text.length < 36) return false
  return /[/\\>]|node|frame|group|instance|component|selector|#|\.\w+/i.test(text)
}

function countCategories(items = []) {
  return items.reduce((counts, item) => {
    const category = item.displayCategory || normalizeDisplayCategory(item)
    return { ...counts, [category]: (counts[category] || 0) + 1 }
  }, { ...EMPTY_CATEGORY_COUNTS })
}

function hasCtaEvidence(item = {}) {
  const text = issueText(item)
  const category = textOf(item.canonicalCategory || item.category || item.categoryLabel).toLowerCase()
  if (/cta|button|action/.test(category)) return isClearCtaIssue(item)
  if (/hero-cta|cta-count|href|url|link|링크|button|action|cta|버튼/i.test(text)) return isClearCtaIssue(item)
  return false
}

function hasPriceEvidence(item = {}) {
  const text = issueText(item)
  const category = textOf(item.canonicalCategory || item.category || item.categoryLabel || item.numericType).toLowerCase()
  if (/price|numeric|amount|monthly|interest|percentage|duration|date/.test(category)) return true
  return /[₩$€¥]|원|만원|%|개월|년|월|금리|납입|기간|날짜|date|duration|amount|price/i.test(text) && numericTokens(text).length > 0
}

function hasMediaEvidence(item = {}) {
  const category = textOf(item.canonicalCategory || item.category || item.categoryLabel).toLowerCase()
  const mediaFields = `${item.mediaType || ''} ${item.figmaMediaType || ''} ${item.webMediaType || ''} ${item.mediaPair || ''} ${item.sectionKey || ''}`
  if (/media|image|video|kv/.test(textOf(item.canonicalCategory).toLowerCase())) return true
  if (hasMediaValuePair(item.figmaValue, item.webValue)) return true
  if (/hero-media|media-pair|figma-image-vs-web-video|web-image-vs-figma-video/i.test(mediaFields)) return true
  return /media|image|video|kv/.test(category) && hasMediaValuePair(item.figmaValue, item.webValue)
}

function hasMediaValuePair(first, second) {
  const a = mediaToken(first)
  const b = mediaToken(second)
  return Boolean(a && b && (a === 'image' || a === 'video' || a === 'motion' || a === 'background') && (b === 'image' || b === 'video' || b === 'motion' || b === 'background'))
}

function mediaToken(value) {
  const text = textOf(value).toLowerCase()
  if (/video|movie|motion|동영상|영상|비디오/.test(text)) return 'video'
  if (/image|img|still|photo|picture|background|이미지|사진|배경/.test(text)) return /background|배경/.test(text) ? 'background' : 'image'
  return ''
}

function ctaToken(value) {
  return normalizeComparableText(value).replace(/https?:\/\//g, '')
}

function normalizeCategory(value) {
  const text = textOf(value).toLowerCase()
  if (/cta|button|action/.test(text)) return 'cta'
  if (/price|numeric|amount|monthly|interest|percentage|duration|date/.test(text)) return 'price'
  if (/media|image|video|layout|kv/.test(text)) return 'media'
  if (/missing|count|only/.test(text)) return 'missing'
  return 'text'
}

function normalizeMeaningText(value) {
  return textOf(value).toLowerCase().replace(/\s+/g, ' ')
}

function sameComparableText(first, second) {
  const a = normalizeComparableText(first)
  const b = normalizeComparableText(second)
  return Boolean(a && b && a === b)
}

function normalizeComparableText(value) {
  return textOf(value)
    .toLowerCase()
    .replace(/[\u200b-\u200d\ufeff]/g, '')
    .replace(/[\s\u00a0.,:;!?"'“”‘’()[\]{}<>_/\\\-·|]+/g, '')
}

function normalizeAreaText(value) {
  const text = textOf(value).toLowerCase()
  if (/hero|kv|main visual|main kv|메인|비주얼/.test(text)) return 'mainvisual'
  if (/footer|푸터/.test(text)) return 'footer'
  if (/product|price|pricing|card|amount|numeric/.test(text)) return 'productprice'
  if (/body|content|section/.test(text)) return 'body'
  return normalizeComparableText(text)
}

function issueText(item = {}) {
  return `${item.category || ''} ${item.categoryLabel || ''} ${item.area || ''} ${item.sectionPath || ''} ${item.title || ''} ${item.description || ''} ${item.figmaValue || ''} ${item.webValue || ''}`
}

function textOf(value) {
  return typeof value === 'string' ? value.trim() : value === undefined || value === null ? '' : String(value).trim()
}

function numericTokens(value) {
  return textOf(value).match(/\d+(?:[.,]\d+)?/g) || []
}

function firstNumber(...values) {
  for (const value of values) {
    const number = Number(value)
    if (Number.isFinite(number)) return number
  }
  return null
}

function uniqueStrings(values = []) {
  return [...new Set(values.map(textOf).filter(Boolean))]
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function attachMeta(items, meta) {
  Object.defineProperty(items, 'meta', { value: meta, enumerable: false })
  return items
}
