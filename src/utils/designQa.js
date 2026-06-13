const ZERO_WIDTH_CHARS = /[\u200B-\u200D\uFEFF]/g
const SPECIAL_WHITESPACE = /[\u00A0\u1680\u180E\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]/g
const REPEATED_WHITESPACE = /\s+/g
const PUNCTUATION_VARIANTS = /[.,，。ㆍ·:：;；!！?？"'“”‘’`´\-‐‑‒–—―_/\\()[\]{}<>《》]/g
const LAYOUT_TOLERANCE = 8
const FUZZY_MATCH_THRESHOLD = 0.8
const MIN_FUZZY_TEXT_LENGTH = 6
const TOP_ISSUE_LIMIT = 10

export function parseFigmaJsonInput(value) {
  const parsed = typeof value === 'string' ? JSON.parse(value) : value
  return extractFigmaElements(parsed)
}

export function extractFigmaElements(source) {
  const normalizedSource = source?.data && typeof source.data === 'object' ? source.data : source
  const sections = extractSections(normalizedSource)
  const elements = []

  if (Array.isArray(normalizedSource?.textNodes)) {
    normalizedSource.textNodes.forEach((node, index) => {
      const element = createFigmaElement(node, index + 1, {
        layerPath: getLayerPath(node),
        sections,
      })
      if (element) elements.push(element)
    })
  } else {
    getFigmaRoots(normalizedSource).forEach((root) => walkFigmaNode(root, elements, {
      layerPath: [],
      section: null,
      sections,
    }))
  }

  return withPositionRatios(elements, sections)
}

export function compareDesignElements(figmaElements = [], webElements = []) {
  const normalizedFigmaElements = prepareComparableElements(figmaElements, 'figma')
  const normalizedWebElements = prepareComparableElements(webElements, 'web')

  if (normalizedFigmaElements.length === 0) {
    const issues = [createComparisonWaitingIssue(normalizedWebElements.length)]

    return createComparisonResult(issues)
  }

  const figmaGroups = groupByText(normalizedFigmaElements)
  const webGroups = groupByText(normalizedWebElements)
  const issues = []
  const unmatchedFigma = []
  const unmatchedWeb = []

  figmaGroups.forEach((figmaGroup, textKey) => {
    const webGroup = webGroups.get(textKey)

    if (!webGroup) {
      unmatchedFigma.push(...figmaGroup.items)
      return
    }

    const figmaItems = sortByPosition(figmaGroup.items)
    const webItems = sortByPosition(webGroup.items)
    const pairCount = Math.min(figmaItems.length, webItems.length)

    for (let index = 0; index < pairCount; index += 1) {
      issues.push(compareMatchedElements(figmaItems[index], webItems[index], { matchIndex: index, matchType: 'exact' }))
    }

    unmatchedFigma.push(...figmaItems.slice(pairCount))
    unmatchedWeb.push(...webItems.slice(pairCount))
  })

  webGroups.forEach((webGroup, textKey) => {
    if (figmaGroups.has(textKey)) return
    unmatchedWeb.push(...webGroup.items)
  })

  const fuzzyMatches = createFuzzyMatches(unmatchedFigma, unmatchedWeb)
  const fuzzyFigma = new Set()
  const fuzzyWeb = new Set()

  fuzzyMatches.forEach((match) => {
    fuzzyFigma.add(match.figmaElement)
    fuzzyWeb.add(match.webElement)
    issues.push(compareMatchedElements(match.figmaElement, match.webElement, {
      matchIndex: 0,
      matchType: 'fuzzy',
      fuzzyScore: match.score,
    }))
  })

  unmatchedFigma
    .filter((figmaElement) => !fuzzyFigma.has(figmaElement))
    .forEach((figmaElement) => issues.push(createMissingFigmaIssue(figmaElement)))

  unmatchedWeb
    .filter((webElement) => !fuzzyWeb.has(webElement))
    .forEach((webElement) => issues.push(createWebOnlyIssue(webElement)))

  return createComparisonResult(sortIssuesByPriority(issues))
}

export function normalizeDesignText(value) {
  return cleanText(value)
    .replace(PUNCTUATION_VARIANTS, '')
    .replace(/[A-Z]/g, (letter) => letter.toLowerCase())
}

function getFigmaRoots(source) {
  if (!source || typeof source !== 'object') return []

  if (Array.isArray(source)) return source
  if (source.document) return [source.document]
  if (source.nodes && typeof source.nodes === 'object') {
    return Object.values(source.nodes).map((node) => node?.document || node).filter(Boolean)
  }
  if (Array.isArray(source.elements)) return source.elements
  if (Array.isArray(source.children)) return [source]
  return [source]
}

function extractSections(source) {
  const sectionCandidates = []

  if (Array.isArray(source?.sections)) {
    sectionCandidates.push(...source.sections)
  }

  getFigmaRoots(source).forEach((root) => collectSections(root, sectionCandidates))

  return sectionCandidates
    .map((section, index) => {
      const bounds = getNodeBounds(section)
      const name = cleanText(section.name || section.title || section.label || `섹션 ${index + 1}`)

      return {
        id: getString(section.id) || `section-${index + 1}`,
        name,
        layerPath: getLayerPath(section) || name,
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
        isFooterDisclaimer: isFooterDisclaimerText(`${name} ${getLayerPath(section)}`),
      }
    })
    .filter((section) => section.name)
}

function collectSections(node, sections) {
  if (!node || typeof node !== 'object') return
  if (node.type === 'SECTION' || /section|섹션|footer|푸터|disclaimer|유의|고지|약관/i.test(node.name || '')) {
    sections.push(node)
  }
  if (Array.isArray(node.children)) node.children.forEach((child) => collectSections(child, sections))
}

function walkFigmaNode(node, elements, context) {
  if (!node || typeof node !== 'object') return

  const name = cleanText(node.name || node.title || '')
  const layerPath = [...context.layerPath, name || node.type || 'Layer'].filter(Boolean)
  const nodeSection = getNodeSection(node, context.section)
  const element = createFigmaElement(node, elements.length + 1, {
    layerPath: layerPath.join(' / '),
    section: nodeSection,
    sections: context.sections,
  })

  if (element) elements.push(element)

  if (Array.isArray(node.children)) {
    node.children.forEach((child) => walkFigmaNode(child, elements, {
      ...context,
      layerPath,
      section: nodeSection,
    }))
  }
}

function createFigmaElement(node, index, context = {}) {
  const rawText = getFigmaNodeText(node)
  const text = cleanText(rawText)
  if (!text) return null

  const style = node.style || {}
  const bounds = getNodeBounds(node)
  const matchedSection = context.section || findSectionForBounds(bounds, context.sections)
  const layerPath = context.layerPath || getLayerPath(node)
  const sectionName = getString(node.sectionName) || matchedSection?.name || getRegionLabel({ ...node, text, layerPath }, bounds.y)

  return {
    index,
    tag: node.type || node.tag || 'FIGMA',
    text,
    normalizedText: normalizeDesignText(text),
    layerPath,
    sectionId: getString(node.sectionId) || matchedSection?.id || sectionName,
    sectionName,
    isFooterDisclaimer: Boolean(matchedSection?.isFooterDisclaimer) || isFooterDisclaimerText(`${text} ${layerPath} ${sectionName}`),
    fontFamily: style.fontFamily || node.fontFamily || '',
    fontStyle: style.fontStyle || node.fontStyle || '',
    fontSize: style.fontSize ?? node.fontSize ?? '',
    fontWeight: style.fontWeight ?? node.fontWeight ?? '',
    lineHeight: style.lineHeightPx ?? style.lineHeightPercentFontSize ?? style.lineHeightPercent ?? node.lineHeight ?? '',
    letterSpacing: style.letterSpacing ?? node.letterSpacing ?? '',
    color: getFigmaColor(node.fills) || node.color || '',
    opacity: node.opacity ?? '',
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    href: node.href || '',
    positionRatio: toRatio(node.positionRatio),
  }
}

function getNodeSection(node, fallbackSection) {
  if (node.type !== 'SECTION') return fallbackSection
  const bounds = getNodeBounds(node)
  const name = cleanText(node.name || node.title || 'Section')

  return {
    id: getString(node.id) || name,
    name,
    layerPath: getLayerPath(node) || name,
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    isFooterDisclaimer: isFooterDisclaimerText(name),
  }
}

function getNodeBounds(node) {
  const bounds = node.absoluteBoundingBox || node.absoluteRenderBounds || node.bounds || node.rect || {}

  return {
    x: firstNumber(bounds.x, node.x) ?? 0,
    y: firstNumber(bounds.y, node.y) ?? 0,
    width: firstNumber(bounds.width, node.width) ?? 0,
    height: firstNumber(bounds.height, node.height) ?? 0,
  }
}

function getLayerPath(node) {
  if (Array.isArray(node?.layerPath)) return node.layerPath.filter(Boolean).join(' / ')
  if (typeof node?.layerPath === 'string') return cleanText(node.layerPath)
  if (Array.isArray(node?.path)) return node.path.filter(Boolean).join(' / ')
  return cleanText(node?.name || '')
}

function getFigmaNodeText(node) {
  if (typeof node.characters === 'string') return node.characters
  if (typeof node.text === 'string') return node.text
  if (typeof node.normalizedText === 'string') return node.normalizedText
  if (typeof node.name === 'string' && (node.type === 'TEXT' || node.fontSize || node.style)) return node.name
  return ''
}

function getFigmaColor(fills) {
  if (!Array.isArray(fills)) return ''

  const fill = fills.find((item) => item?.type === 'SOLID' && item.visible !== false && item.color)
  if (!fill) return ''

  const alpha = fill.opacity ?? fill.color.a ?? 1
  const red = toRgbChannel(fill.color.r)
  const green = toRgbChannel(fill.color.g)
  const blue = toRgbChannel(fill.color.b)

  if (alpha < 1) return `rgba(${red}, ${green}, ${blue}, ${roundNumber(alpha)})`
  return `#${toHex(red)}${toHex(green)}${toHex(blue)}`
}

function withPositionRatios(elements, sections) {
  const maxBottom = getMaxBottom([...elements, ...sections]) || 1

  return elements.map((element) => ({
    ...element,
    positionRatio: toRatio(element.positionRatio) ?? clampRatio((toNumber(element.y) ?? 0) / maxBottom),
  }))
}

function prepareComparableElements(elements, source) {
  const maxBottom = getMaxBottom(elements) || 1

  return elements
    .map((element, index) => {
      const text = cleanText(element.text)
      if (!text) return null

      const y = firstNumber(element.y) ?? 0
      const sectionName = getString(element.sectionName) || getRegionLabel(element, y)
      const layerPath = getLayerPath(element)
      const isFooterDisclaimer = Boolean(element.isFooterDisclaimer) || isFooterDisclaimerText(`${text} ${layerPath} ${sectionName}`)

      return {
        ...element,
        index: element.index || index + 1,
        source,
        tag: element.tag || (source === 'figma' ? 'FIGMA' : 'element'),
        text,
        normalizedText: normalizeDesignText(text),
        layerPath,
        sectionId: getString(element.sectionId) || sectionName,
        sectionName,
        isFooterDisclaimer,
        x: firstNumber(element.x) ?? 0,
        y,
        width: firstNumber(element.width) ?? 0,
        height: firstNumber(element.height) ?? 0,
        positionRatio: toRatio(element.positionRatio) ?? clampRatio(y / maxBottom),
      }
    })
    .filter(Boolean)
}

function groupByText(elements) {
  return elements.reduce((groups, element) => {
    const textKey = element.normalizedText || normalizeDesignText(element.text)
    if (!textKey) return groups

    const group = groups.get(textKey) || { text: cleanText(element.text), items: [] }
    group.items.push(element)
    groups.set(textKey, group)
    return groups
  }, new Map())
}

function compareMatchedElements(figmaElement, webElement, options = {}) {
  const differences = []
  const styleLabels = []
  const matchType = options.matchType || 'exact'

  if (matchType === 'fuzzy') {
    differences.push(createDifference('text', '유사 문구 확인', `정확히 일치하지 않지만 ${Math.round((options.fuzzyScore || 0) * 100)}% 유사합니다. 문구 의도를 확인하세요.`))
  }

  const figmaFontSize = toNumber(figmaElement.fontSize)
  const webFontSize = toNumber(webElement.fontSize)

  if (figmaFontSize !== null && webFontSize !== null && Math.abs(figmaFontSize - webFontSize) > 1) {
    styleLabels.push('폰트 크기')
    differences.push(createDifference('style', '폰트 크기', `Figma ${formatSize(figmaFontSize)} / Web ${formatSize(webFontSize)}`))
  }

  const figmaFontFamily = normalizeFontFamily(figmaElement.fontFamily)
  const webFontFamily = normalizeFontFamily(webElement.fontFamily)
  if (figmaFontFamily && webFontFamily && figmaFontFamily !== webFontFamily) {
    styleLabels.push('폰트 패밀리')
    differences.push(createDifference('style', '폰트 패밀리', `Figma ${figmaElement.fontFamily} / Web ${webElement.fontFamily}`))
  }

  const figmaColor = normalizeColor(figmaElement.color)
  const webColor = normalizeColor(webElement.color)
  if (figmaColor && webColor && figmaColor !== webColor) {
    styleLabels.push('컬러')
    differences.push(createDifference('style', '컬러', `Figma ${figmaElement.color} / Web ${webElement.color}`))
  }

  if (hasLayoutDifference(figmaElement, webElement)) {
    differences.push(createDifference('layout', '위치/크기', `Figma (${formatRect(figmaElement)}) / Web (${formatRect(webElement)})`))
  }

  if (isCtaElement(figmaElement) || isCtaElement(webElement)) {
    differences.push(createDifference('cta', 'CTA 확인', getCtaDetail(figmaElement, webElement)))
  }

  if (differences.length === 0) {
    return createGroupedIssue({
      status: 'ok',
      label: options.matchIndex > 0 ? '반복 요소 일치' : '텍스트와 주요 스타일 일치',
      text: figmaElement.text,
      detail: '문구, 폰트 크기, 폰트 패밀리, 컬러가 기준 범위 안에 있습니다.',
      categories: [],
      differences: [],
      figmaElement,
      webElement,
      matchType,
    })
  }

  const categories = Array.from(new Set(differences.map((difference) => difference.type)))
  const label = getGroupedLabel(categories, styleLabels)

  return createGroupedIssue({
    status: 'warn',
    label,
    text: figmaElement.text,
    detail: differences.map((difference) => `${difference.label}: ${difference.detail}`).join(' · '),
    categories,
    differences,
    figmaElement,
    webElement,
    matchType,
  })
}

function createMissingFigmaIssue(figmaElement) {
  return createGroupedIssue({
    status: 'error',
    label: isCtaElement(figmaElement) ? '웹 화면 누락 CTA' : '웹 화면 누락 텍스트',
    text: figmaElement.text,
    detail: 'Figma에는 있지만 웹 화면에서 같은 문구를 찾지 못했습니다.',
    categories: isCtaElement(figmaElement) ? ['text', 'cta'] : ['text'],
    differences: [createDifference('text', '텍스트 누락', '웹 화면에서 동일 문구를 수집하지 못했습니다.')],
    figmaElement,
    webElement: null,
    matchType: 'missing-web',
  })
}

function createWebOnlyIssue(webElement) {
  return createGroupedIssue({
    status: 'error',
    label: isCtaElement(webElement) ? 'Figma 기준에 없는 CTA' : '웹에만 있는 텍스트',
    text: webElement.text,
    detail: '웹 화면에는 있지만 Figma JSON에서 같은 문구를 찾지 못했습니다.',
    categories: isCtaElement(webElement) ? ['text', 'cta'] : ['text'],
    differences: [createDifference('text', 'Figma 기준 누락', 'Figma JSON에서 동일 문구를 수집하지 못했습니다.')],
    figmaElement: null,
    webElement,
    matchType: 'web-only',
  })
}

function createGroupedIssue({ status, label, text, detail, categories, differences, figmaElement, webElement, matchType }) {
  const primaryElement = figmaElement || webElement
  const sort = getSortPosition(figmaElement, webElement)
  const sectionName = primaryElement?.sectionName || getRegionLabel(primaryElement, sort.y)
  const isFooterDisclaimer = Boolean(figmaElement?.isFooterDisclaimer || webElement?.isFooterDisclaimer || isFooterDisclaimerText(`${text} ${sectionName}`))
  const priority = getIssuePriority({ status, categories, figmaElement, webElement, isFooterDisclaimer })

  return {
    id: `${status}-${label}-${normalizeDesignText(text)}-${sort.y}-${sort.x}-${figmaElement?.index || 'no-figma'}-${webElement?.index || 'no-web'}-${matchType || 'match'}`,
    status,
    label,
    text: text || '텍스트 없음',
    normalizedText: normalizeDesignText(text),
    detail,
    region: sectionName,
    sectionId: primaryElement?.sectionId || sectionName,
    sectionName,
    isFooterDisclaimer,
    priority,
    severity: priority <= 3 && status !== 'ok' ? 'high' : status,
    categories,
    differences,
    matchType: matchType || 'exact',
    layerPath: primaryElement?.layerPath || '',
    anchor: { x: sort.x, y: sort.y, positionRatio: sort.positionRatio },
    figma: figmaElement ? pickEvidence(figmaElement) : null,
    web: webElement ? pickEvidence(webElement) : null,
  }
}

function createDifference(type, label, detail) {
  return { type, label, detail }
}

function createComparisonWaitingIssue(webElementCount) {
  return createGroupedIssue({
    status: 'warn',
    label: '비교 대기',
    text: 'Figma 기준 없음',
    detail: webElementCount > 0
      ? `웹에서 디자인 요소 ${webElementCount}개를 수집했습니다. Figma JSON을 입력하면 텍스트와 스타일 차이를 비교합니다.`
      : '좌측 패널에서 Figma JSON을 입력하고 URL 검사를 실행하면 시안 비교 QA가 생성됩니다.',
    categories: ['text'],
    differences: [createDifference('text', 'Figma 기준 없음', '비교할 Figma JSON이 아직 없습니다.')],
    figmaElement: null,
    webElement: null,
    matchType: 'waiting',
  })
}

function createComparisonResult(issues) {
  const sortedIssues = sortIssuesByPriority(issues)

  return {
    counts: getDesignCounts(sortedIssues),
    summaryCounts: getSummaryCounts(sortedIssues),
    sectionSummaries: getSectionSummaries(sortedIssues),
    topIssues: sortedIssues.filter((issue) => issue.status !== 'ok').slice(0, TOP_ISSUE_LIMIT),
    issues: sortedIssues,
  }
}

function pickEvidence(element) {
  return {
    tag: element.tag,
    text: element.text,
    normalizedText: element.normalizedText || normalizeDesignText(element.text),
    layerPath: element.layerPath,
    sectionName: element.sectionName,
    isFooterDisclaimer: Boolean(element.isFooterDisclaimer),
    fontFamily: element.fontFamily,
    fontStyle: element.fontStyle,
    fontSize: element.fontSize,
    fontWeight: element.fontWeight,
    lineHeight: element.lineHeight,
    letterSpacing: element.letterSpacing,
    color: element.color,
    opacity: element.opacity,
    x: element.x,
    y: element.y,
    width: element.width,
    height: element.height,
    href: element.href,
    positionRatio: element.positionRatio,
  }
}

function getDesignCounts(issues) {
  return issues.reduce(
    (counts, issue) => ({
      ...counts,
      [issue.status]: counts[issue.status] + 1,
    }),
    { ok: 0, warn: 0, error: 0 },
  )
}

function getSummaryCounts(issues) {
  return issues.reduce(
    (counts, issue) => {
      if (issue.status === 'ok') return counts

      return {
        total: counts.total + 1,
        high: counts.high + (issue.severity === 'high' ? 1 : 0),
        text: counts.text + (issue.categories.includes('text') ? 1 : 0),
        style: counts.style + (issue.categories.includes('style') ? 1 : 0),
        layout: counts.layout + (issue.categories.includes('layout') ? 1 : 0),
        cta: counts.cta + (issue.categories.includes('cta') ? 1 : 0),
        footer: counts.footer + (issue.isFooterDisclaimer ? 1 : 0),
      }
    },
    { total: 0, high: 0, text: 0, style: 0, layout: 0, cta: 0, footer: 0 },
  )
}

function getSectionSummaries(issues) {
  const summaries = new Map()

  issues.forEach((issue) => {
    if (issue.status === 'ok') return

    const key = issue.sectionId || issue.sectionName || '기타 섹션'
    const summary = summaries.get(key) || {
      id: key,
      name: issue.sectionName || key,
      total: 0,
      high: 0,
      text: 0,
      style: 0,
      layout: 0,
      cta: 0,
      footer: 0,
      isFooterDisclaimer: Boolean(issue.isFooterDisclaimer),
    }

    summary.total += 1
    summary.high += issue.severity === 'high' ? 1 : 0
    summary.text += issue.categories.includes('text') ? 1 : 0
    summary.style += issue.categories.includes('style') ? 1 : 0
    summary.layout += issue.categories.includes('layout') ? 1 : 0
    summary.cta += issue.categories.includes('cta') ? 1 : 0
    summary.footer += issue.isFooterDisclaimer ? 1 : 0
    summary.isFooterDisclaimer = summary.isFooterDisclaimer || issue.isFooterDisclaimer
    summaries.set(key, summary)
  })

  return Array.from(summaries.values()).sort((first, second) => {
    if (first.isFooterDisclaimer !== second.isFooterDisclaimer) return first.isFooterDisclaimer ? 1 : -1
    if (first.high !== second.high) return second.high - first.high
    return second.total - first.total
  })
}

function hasLayoutDifference(figmaElement, webElement) {
  return ['x', 'y', 'width', 'height'].some((key) => {
    const figmaValue = toNumber(figmaElement[key])
    const webValue = toNumber(webElement[key])
    return figmaValue !== null && webValue !== null && Math.abs(figmaValue - webValue) > LAYOUT_TOLERANCE
  })
}

function isCtaElement(element) {
  if (!element) return false
  return element.tag === 'a'
    || element.tag === 'button'
    || Boolean(element.href)
    || /\b(button|btn|cta|link)\b|더보기|자세히|신청|구매|상담|가입|예약|문의/i.test(`${element.text || ''} ${element.layerPath || ''}`)
}

function isCoreText(element) {
  if (!element || element.isFooterDisclaimer) return false
  const normalizedText = element.normalizedText || normalizeDesignText(element.text)
  return normalizedText.length >= MIN_FUZZY_TEXT_LENGTH || isCtaElement(element)
}

function getCtaDetail(figmaElement, webElement) {
  const textChanged = figmaElement && webElement && figmaElement.normalizedText !== webElement.normalizedText
  const hrefDetail = webElement?.href ? `웹 CTA가 ${webElement.href}로 이동합니다.` : '웹 버튼에 이동 URL이 없습니다.'
  const textDetail = textChanged ? 'Figma와 웹 CTA 문구가 완전히 같지 않습니다.' : 'CTA 문구와 링크 목적지가 기획 의도와 맞는지 확인하세요.'
  return `${hrefDetail} ${textDetail}`
}

function getGroupedLabel(categories, styleLabels) {
  const labels = []
  if (categories.includes('text')) labels.push('텍스트 확인 필요')
  if (categories.includes('style')) labels.push(styleLabels.length > 0 ? `${styleLabels.join('/')} 차이` : '스타일 차이')
  if (categories.includes('layout')) labels.push('위치/크기 확인 필요')
  if (categories.includes('cta')) labels.push('CTA 확인 필요')
  return labels.join(' + ')
}

function getIssuePriority({ status, categories, figmaElement, webElement, isFooterDisclaimer }) {
  if (status === 'ok') return 9
  if (isFooterDisclaimer) return 5
  if (!webElement && isCoreText(figmaElement)) return 1
  if (!figmaElement && isCoreText(webElement)) return 2
  if (categories.includes('cta')) return 3
  if (categories.includes('style') || categories.includes('layout')) return 4
  return 6
}

function getSortPosition(figmaElement, webElement) {
  const y = firstNumber(figmaElement?.y, webElement?.y) ?? 0
  const x = firstNumber(figmaElement?.x, webElement?.x) ?? 0
  const positionRatio = firstNumber(figmaElement?.positionRatio, webElement?.positionRatio) ?? 0
  return { x, y, positionRatio: clampRatio(positionRatio) }
}

function sortByPosition(elements) {
  return [...elements].sort((first, second) => {
    const firstY = toNumber(first.y) ?? Number.MAX_SAFE_INTEGER
    const secondY = toNumber(second.y) ?? Number.MAX_SAFE_INTEGER
    if (firstY !== secondY) return firstY - secondY
    return (toNumber(first.x) ?? Number.MAX_SAFE_INTEGER) - (toNumber(second.x) ?? Number.MAX_SAFE_INTEGER)
  })
}

function sortIssuesByPriority(issues) {
  return [...issues].sort((first, second) => {
    if (first.priority !== second.priority) return first.priority - second.priority
    if (first.anchor.y !== second.anchor.y) return first.anchor.y - second.anchor.y
    return first.anchor.x - second.anchor.x
  })
}

function createFuzzyMatches(figmaElements, webElements) {
  const candidates = []

  figmaElements.forEach((figmaElement) => {
    if (!canFuzzyMatch(figmaElement)) return

    webElements.forEach((webElement) => {
      if (!canFuzzyMatch(webElement)) return
      const score = getTextSimilarity(figmaElement.normalizedText, webElement.normalizedText)
      if (score >= FUZZY_MATCH_THRESHOLD) candidates.push({ figmaElement, webElement, score })
    })
  })

  const usedFigma = new Set()
  const usedWeb = new Set()
  const matches = []

  candidates
    .sort((first, second) => second.score - first.score)
    .forEach((candidate) => {
      if (usedFigma.has(candidate.figmaElement) || usedWeb.has(candidate.webElement)) return
      usedFigma.add(candidate.figmaElement)
      usedWeb.add(candidate.webElement)
      matches.push(candidate)
    })

  return matches
}

function canFuzzyMatch(element) {
  const normalizedText = element.normalizedText || normalizeDesignText(element.text)
  return normalizedText.length >= MIN_FUZZY_TEXT_LENGTH
}

function getTextSimilarity(firstText, secondText) {
  if (!firstText || !secondText) return 0
  if (firstText === secondText) return 1

  const maxLength = Math.max(firstText.length, secondText.length)
  if (maxLength === 0) return 1
  return 1 - (getEditDistance(firstText, secondText) / maxLength)
}

function getEditDistance(firstText, secondText) {
  const previous = Array.from({ length: secondText.length + 1 }, (_, index) => index)

  for (let firstIndex = 1; firstIndex <= firstText.length; firstIndex += 1) {
    let previousDiagonal = previous[0]
    previous[0] = firstIndex

    for (let secondIndex = 1; secondIndex <= secondText.length; secondIndex += 1) {
      const substitutionCost = firstText[firstIndex - 1] === secondText[secondIndex - 1] ? 0 : 1
      const nextDiagonal = previous[secondIndex]
      previous[secondIndex] = Math.min(
        previous[secondIndex] + 1,
        previous[secondIndex - 1] + 1,
        previousDiagonal + substitutionCost,
      )
      previousDiagonal = nextDiagonal
    }
  }

  return previous[secondText.length]
}

function getRegionLabel(element, y) {
  const text = cleanText(element?.text || '')
  const layerPath = cleanText(element?.layerPath || '')
  const searchableText = `${text} ${layerPath}`

  if (/hero|kv|히어로|키비주얼/i.test(searchableText)) return 'Hero/KV'
  if (isFooterDisclaimerText(searchableText)) return 'Footer/Disclaimer'
  const sectionMatch = searchableText.match(/(?:section|섹션)\s*([\w가-힣-]+)/i)
  if (sectionMatch) return `섹션 ${sectionMatch[1]}`
  if (y < 700) return 'Hero/KV'
  if (y < 1800) return 'Content Section'
  return 'Footer/Disclaimer'
}

function findSectionForBounds(bounds, sections = []) {
  if (!Array.isArray(sections) || sections.length === 0) return null

  return sections.find((section) => {
    if (!section.width || !section.height) return false
    const insideX = bounds.x >= section.x && bounds.x <= section.x + section.width
    const insideY = bounds.y >= section.y && bounds.y <= section.y + section.height
    return insideX && insideY
  }) || null
}

function isFooterDisclaimerText(value) {
  return /footer|푸터|disclaimer|유의|고지|약관|저작권|copyright|주의|안내사항|면책/i.test(value || '')
}

function getMaxBottom(elements) {
  return elements.reduce((maxBottom, element) => {
    const y = toNumber(element?.y)
    const height = toNumber(element?.height)
    if (y === null) return maxBottom
    return Math.max(maxBottom, y + (height ?? 0))
  }, 0)
}

function cleanText(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(ZERO_WIDTH_CHARS, '')
    .replace(SPECIAL_WHITESPACE, ' ')
    .replace(REPEATED_WHITESPACE, ' ')
    .trim()
}

function normalizeFontFamily(value) {
  return String(value || '').split(',')[0].replace(/["']/g, '').trim().toLowerCase()
}

function normalizeColor(value) {
  const color = String(value || '').trim().toLowerCase()
  const rgbMatch = color.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/)
  if (rgbMatch) {
    const hex = `#${toHex(Number(rgbMatch[1]))}${toHex(Number(rgbMatch[2]))}${toHex(Number(rgbMatch[3]))}`
    const alpha = rgbMatch[4] === undefined ? 1 : Number.parseFloat(rgbMatch[4])
    return Number.isFinite(alpha) && alpha < 1 ? `${hex}@${roundNumber(alpha)}` : hex
  }
  return color
}

function firstNumber(...values) {
  for (const value of values) {
    const number = toNumber(value)
    if (number !== null) return number
  }
  return null
}

function toNumber(value) {
  if (value === '' || value === null || value === undefined) return null
  const number = Number.parseFloat(String(value))
  return Number.isFinite(number) ? number : null
}

function toRatio(value) {
  const number = toNumber(value)
  if (number === null) return null
  return clampRatio(number > 1 ? number / 100 : number)
}

function clampRatio(value) {
  return Math.max(0, Math.min(1, Number(value) || 0))
}

function getString(value) {
  return typeof value === 'string' ? cleanText(value) : ''
}

function toRgbChannel(value) {
  return Math.round(Math.max(0, Math.min(1, Number(value) || 0)) * 255)
}

function toHex(value) {
  return Math.max(0, Math.min(255, Number(value) || 0)).toString(16).padStart(2, '0')
}

function roundNumber(value) {
  return Math.round(value * 100) / 100
}

function formatSize(value) {
  return `${roundNumber(value)}px`
}

function formatRect(element) {
  return `x ${element.x || '-'}, y ${element.y || '-'}, w ${element.width || '-'}, h ${element.height || '-'}`
}
