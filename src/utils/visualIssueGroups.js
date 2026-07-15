const POSITION_BAND_SIZE = 0.24

const SECTION_ORDER = {
  hero: 10,
  main: 20,
  cta: 35,
  product: 45,
  price: 50,
  body: 60,
  faq: 75,
  footer: 90,
  page: 100,
}

export function createVisualIssueGroups(items = []) {
  const sourceItems = Array.isArray(items) ? items.filter((item) => item && typeof item === 'object') : []
  const seededGroups = createSeededGroups(sourceItems)
  const mergedGroups = mergeAreaFallbackGroups(seededGroups)
  const groups = mergedGroups
    .map((group, index) => finalizeGroup(group, index))
    .filter((group) => group.items.length > 0)
    .sort(compareGroups)

  const groupedIssueCount = groups.reduce((sum, group) => sum + group.items.length, 0)
  return attachMeta(groups, {
    sourceIssueCount: sourceItems.length,
    groupCount: groups.length,
    groupedIssueCount,
    duplicateIssueCount: sourceItems.length - groupedIssueCount,
  })
}

function createSeededGroups(items) {
  const groups = []
  const groupMap = new Map()
  items.forEach((item, inputIndex) => {
    const seed = createGroupSeed(item, inputIndex)
    let group = groupMap.get(seed.key)
    if (!group) {
      group = { ...seed, items: [] }
      groupMap.set(seed.key, group)
      groups.push(group)
    }
    group.items.push({ ...item, inputIndex: numberOrFallback(item.inputIndex, inputIndex) })
  })
  return groups
}

function createGroupSeed(item = {}, inputIndex) {
  const sectionId = textOf(item.canonicalSectionId || item.sectionId)
  const sectionRootId = textOf(item.sectionRootId)
  const sectionPath = textOf(item.sectionPath)
  const areaLabel = normalizeAreaLabel(item.area || item.sectionName || sectionPath || item.sectionKey)
  const yRatio = getYRatio(item)
  const xRatio = getXRatio(item)
  const originalIndex = firstNumber(item.originalIndex, item.order, inputIndex)

  if (sectionId) return createSeed(`section:${normalizeKey(sectionId)}`, areaLabel, yRatio, xRatio, originalIndex, inputIndex, false)
  if (sectionRootId) return createSeed(`root:${normalizeKey(sectionRootId)}`, areaLabel, yRatio, xRatio, originalIndex, inputIndex, false)
  if (sectionPath) return createSeed(`path:${normalizeKey(sectionPath)}`, areaLabel, yRatio, xRatio, originalIndex, inputIndex, false)

  if (isMeaningfulArea(areaLabel)) {
    const band = yRatio === null ? 'unknown' : getPositionBand(yRatio)
    return createSeed(`area:${normalizeKey(areaLabel)}:${band}`, areaLabel, yRatio, xRatio, originalIndex, inputIndex, band === 'unknown')
  }

  if (yRatio !== null) return createSeed(`position:${getPositionBand(yRatio)}`, inferAreaFromRatio(yRatio), yRatio, xRatio, originalIndex, inputIndex, false)
  return createSeed(`fallback:${normalizeKey(areaLabel || 'Page Content')}`, areaLabel || 'Page Content', yRatio, xRatio, originalIndex, inputIndex, true)
}

function createSeed(key, label, yRatio, xRatio, originalIndex, inputIndex, areaFallback) {
  return { key, label, yRatio, xRatio, originalIndex, inputIndex, areaFallback }
}

function mergeAreaFallbackGroups(groups) {
  const result = []
  groups.forEach((group) => {
    if (!group.areaFallback) {
      result.push(group)
      return
    }
    const target = result
      .filter((candidate) => candidate.label === group.label && !candidate.areaFallback)
      .sort(compareGroupSeeds)[0]
    if (target) {
      target.items.push(...group.items)
      target.yRatio = firstNumber(target.yRatio, group.yRatio)
      target.xRatio = firstNumber(target.xRatio, group.xRatio)
      target.originalIndex = minNullableNumber(target.originalIndex, group.originalIndex)
      target.inputIndex = Math.min(target.inputIndex, group.inputIndex)
      return
    }
    result.push(group)
  })
  return result
}

function finalizeGroup(group, index) {
  const items = dedupeExactItems(group.items)
    .sort(compareIssues)
    .map((item, itemIndex) => ({ ...item, groupItemId: item.id || `${group.key}-${itemIndex}` }))
  const first = items[0] || {}
  return {
    id: `visual-issue-group-${index}-${normalizeKey(group.key)}`,
    key: group.key,
    label: group.label || first.area || 'Page Content',
    items,
    yRatio: minItemNumber(items, 'yRatio', group.yRatio),
    xRatio: minItemNumber(items, 'xRatio', group.xRatio),
    originalIndex: minItemNumber(items, 'originalIndex', group.originalIndex),
    inputIndex: minItemNumber(items, 'inputIndex', group.inputIndex),
  }
}

function dedupeExactItems(items) {
  const seen = new Set()
  const deduped = []
  items.forEach((item) => {
    const key = createExactItemKey(item)
    if (seen.has(key)) return
    seen.add(key)
    deduped.push(item)
  })
  return deduped
}

function createExactItemKey(item = {}) {
  return [
    normalizeCategory(item.category || item.categoryLabel),
    normalizeComparableText(item.figmaValue),
    normalizeComparableText(item.webValue),
    normalizeComparableText(item.title),
  ].join(':')
}

function compareGroups(first, second) {
  const yDiff = compareNullableNumber(first.yRatio, second.yRatio)
  if (yDiff !== 0) return yDiff
  const sectionDiff = getSectionRank(first.label) - getSectionRank(second.label)
  if (sectionDiff !== 0) return sectionDiff
  const xDiff = compareNullableNumber(first.xRatio, second.xRatio)
  if (xDiff !== 0) return xDiff
  const indexDiff = compareNullableNumber(first.originalIndex, second.originalIndex)
  if (indexDiff !== 0) return indexDiff
  return first.inputIndex - second.inputIndex
}

function compareGroupSeeds(first, second) {
  const yDiff = compareNullableNumber(first.yRatio, second.yRatio)
  if (yDiff !== 0) return yDiff
  return first.inputIndex - second.inputIndex
}

function compareIssues(first, second) {
  const yDiff = compareNullableNumber(first.yRatio, second.yRatio)
  if (yDiff !== 0) return yDiff
  const xDiff = compareNullableNumber(first.xRatio, second.xRatio)
  if (xDiff !== 0) return xDiff
  const indexDiff = compareNullableNumber(first.originalIndex, second.originalIndex)
  if (indexDiff !== 0) return indexDiff
  return numberOrFallback(first.inputIndex, 0) - numberOrFallback(second.inputIndex, 0)
}

function normalizeAreaLabel(value) {
  const text = textOf(value)
  if (!text) return 'Page Content'
  if (/hero|kv|main visual|main[_\s-]*visual|메인|비주얼/i.test(text)) return 'Main KV'
  if (/footer|푸터/i.test(text)) return 'Footer'
  if (/faq|accordion|question/i.test(text)) return 'FAQ'
  if (/product|price|pricing|card|amount|numeric/i.test(text)) return 'Product / Price'
  if (/body|content|section/i.test(text)) return 'Body'
  return text
}

function isMeaningfulArea(value) {
  return Boolean(value && value !== 'Page Content')
}

function inferAreaFromRatio(value) {
  if (value < 0.24) return 'Main KV'
  if (value > 0.82) return 'Footer'
  return 'Page Content'
}

function getPositionBand(value) {
  return Math.floor(value / POSITION_BAND_SIZE)
}

function getSectionRank(value) {
  const text = textOf(value).toLowerCase()
  if (/hero|kv|main visual|main kv/.test(text)) return SECTION_ORDER.hero
  if (/cta|action|button/.test(text)) return SECTION_ORDER.cta
  if (/product|card/.test(text)) return SECTION_ORDER.product
  if (/price|numeric|amount|pricing/.test(text)) return SECTION_ORDER.price
  if (/faq|question/.test(text)) return SECTION_ORDER.faq
  if (/footer/.test(text)) return SECTION_ORDER.footer
  if (/body|content/.test(text)) return SECTION_ORDER.body
  if (/main/.test(text)) return SECTION_ORDER.main
  return SECTION_ORDER.page
}

function getYRatio(item = {}) {
  return firstNumber(item.yRatio, item.sectionYRatio, item.spatialEvidence?.yRatio)
}

function getXRatio(item = {}) {
  return firstNumber(item.xRatio, item.spatialEvidence?.xRatio)
}

function compareNullableNumber(first, second) {
  const a = numberOrNull(first)
  const b = numberOrNull(second)
  if (a !== null && b !== null && a !== b) return a - b
  if (a !== null && b === null) return -1
  if (a === null && b !== null) return 1
  return 0
}

function minItemNumber(items, field, fallback) {
  return minNullableNumber(...items.map((item) => item[field]), fallback)
}

function minNullableNumber(...values) {
  const numbers = values.map(numberOrNull).filter((value) => value !== null)
  return numbers.length > 0 ? Math.min(...numbers) : null
}

function firstNumber(...values) {
  for (const value of values) {
    const number = numberOrNull(value)
    if (number !== null) return number
  }
  return null
}

function numberOrFallback(value, fallback) {
  const number = numberOrNull(value)
  return number === null ? fallback : number
}

function numberOrNull(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function normalizeCategory(value) {
  const text = textOf(value).toLowerCase()
  if (/cta|button|action/.test(text)) return 'cta'
  if (/price|numeric|amount/.test(text)) return 'price'
  if (/media|image|video|kv/.test(text)) return 'media'
  if (/missing|count|only/.test(text)) return 'missing'
  return 'text'
}

function normalizeComparableText(value) {
  return textOf(value)
    .toLowerCase()
    .replace(/[\u200b-\u200d\ufeff]/g, '')
    .replace(/[\s\u00a0.,:;!?"'“”‘’()[\]{}<>_/\\\-·|]+/g, '')
}

function normalizeKey(value) {
  return normalizeComparableText(value) || 'page'
}

function textOf(value) {
  return typeof value === 'string' ? value.trim() : value === undefined || value === null ? '' : String(value).trim()
}

function attachMeta(groups, meta) {
  Object.defineProperty(groups, 'meta', { value: meta, enumerable: false })
  return groups
}
