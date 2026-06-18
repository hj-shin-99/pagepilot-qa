const ZERO_WIDTH_CHARS = /[\u200B-\u200D\uFEFF]/g
const SPECIAL_WHITESPACE = /[\u00A0\u1680\u180E\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]/g
const REPEATED_WHITESPACE = /\s+/g
const COMPARE_TEXT_PUNCTUATION = /[.,，。:：;；()（）[\]{}]/g
const LAYOUT_TOLERANCE = 8
const OBVIOUS_LAYOUT_TOLERANCE = 40
const FUZZY_MATCH_THRESHOLD = 0.8
const MIN_FUZZY_TEXT_LENGTH = 6
const TOP_ISSUE_LIMIT = 5
const DECORATIVE_LAYER_PATTERN = /\b(vector|path|shape|rectangle|ellipse|line|icon|logo|blende|blend|group|frame)\b|icon\s*frame/i
const BUTTON_LAYER_PATTERN = /button|btn|cta|link-button|primary|secondary|버튼/i
const BUTTON_TEXT_PATTERN = /자세히|더 보기|더보기|바로가기|신청|구매|상담|예약|문의|프로모션/i
const TEXT_PAIR_SIMILARITY_THRESHOLD = 0.62
const TEXT_PAIR_TOKEN_OVERLAP_THRESHOLD = 0.5
const BUTTON_PAIR_SIMILARITY_THRESHOLD = 0.45
const BUTTON_PAIR_TOKEN_OVERLAP_THRESHOLD = 0.5
const PLANNER_SECTIONS = [
  { id: 'top', name: 'Hero/KV 영역', aliases: ['상단 영역'] },
  { id: 'product-overview', name: '상품 개요 영역', aliases: ['주요 콘텐츠 영역'] },
  { id: 'product-types', name: '상품 종류 영역', aliases: ['주요 콘텐츠 영역 2'] },
  { id: 'documents', name: '구비서류 영역', aliases: ['구비 서류 영역'] },
  { id: 'bottom-banner', name: '하단 배너 영역', aliases: ['하단 안내 영역'] },
  { id: 'footer-disclaimer', name: '푸터/디스클레이머' },
]

export function parseFigmaJsonInput(value) {
  const parsed = typeof value === 'string' ? JSON.parse(value) : value
  return extractFigmaElements(parsed)
}

export function extractFigmaElements(source) {
  const normalizedSource = source?.data && typeof source.data === 'object' ? source.data : source

  if (normalizedSource?.qaModel && typeof normalizedSource.qaModel === 'object') {
    return extractQaModelElements(normalizedSource.qaModel)
  }

  const structuredFallbackElements = extractStructuredFallbackElements(normalizedSource)
  if (structuredFallbackElements.length > 0) {
    return structuredFallbackElements
  }

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
    if (Array.isArray(normalizedSource?.imageCandidates)) {
      normalizedSource.imageCandidates.forEach((node, index) => {
        const element = createFigmaImageElement(node, elements.length + index + 1, {
          layerPath: getLayerPath(node),
          sections,
        })
        if (element) elements.push(element)
      })
    }
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

  const figmaTextElements = normalizedFigmaElements.filter((element) => isComparableTextElement(element) && !isImageElement(element))
  const webTextElements = normalizedWebElements.filter((element) => isComparableTextElement(element) && !isImageElement(element))
  const figmaButtons = figmaTextElements.filter(isButtonCandidate)
  const webButtons = webTextElements.filter(isButtonCandidate)
  const textComparison = matchComparableGroups(
    figmaTextElements.filter((element) => !isButtonCandidate(element)),
    webTextElements.filter((element) => !isButtonCandidate(element)),
    'text',
  )
  const buttonComparison = matchComparableGroups(figmaButtons, webButtons, 'button')
  const issues = []

  textComparison.similarMatches.forEach(({ figmaElement, webElement, matchedBy, score }) => {
    issues.push(createTextDifferenceIssue(figmaElement, webElement, matchedBy, score))
  })
  textComparison.unmatchedFigma.forEach((figmaElement) => issues.push(createTextOnlyIssue(figmaElement, 'figma')))
  textComparison.unmatchedWeb.forEach((webElement) => issues.push(createTextOnlyIssue(webElement, 'web')))

  buttonComparison.similarMatches.forEach(({ figmaElement, webElement, matchedBy, score }) => {
    const issue = createButtonPairIssue(figmaElement, webElement, matchedBy, score)
    if (issue) issues.push(issue)
  })
  buttonComparison.exactMatches.forEach(({ figmaElement, webElement }) => {
    const issue = createButtonPairIssue(figmaElement, webElement, 'compareText exact', 1)
    if (issue) issues.push(issue)
  })
  buttonComparison.unmatchedFigma.forEach((figmaElement) => issues.push(createButtonOnlyIssue(figmaElement, 'figma')))
  buttonComparison.unmatchedWeb.forEach((webElement) => issues.push(createButtonOnlyIssue(webElement, 'web')))

  return createComparisonResult(sortIssuesByPriority(issues))
}

export function normalizeDesignText(value) {
  return compareText(value)
}

function compareText(value) {
  return cleanText(value)
    .replace(COMPARE_TEXT_PUNCTUATION, ' ')
    .replace(REPEATED_WHITESPACE, ' ')
    .trim()
    .toLowerCase()
}

function areTextsEquivalent(firstText, secondText) {
  return compareText(firstText) === compareText(secondText)
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

function extractQaModelElements(qaModel) {
  const sections = extractQaModelSections(qaModel)
  const elements = []

  if (Array.isArray(qaModel.texts)) {
    qaModel.texts.forEach((node, index) => {
      if (node.importance === 'button') return
      const element = createQaModelTextElement(node, index + 1, sections)
      if (element) elements.push(element)
    })
  }

  if (Array.isArray(qaModel.buttons)) {
    qaModel.buttons.forEach((node, index) => {
      const element = createQaModelTextElement({ ...node, importance: 'button', tag: 'button' }, elements.length + index + 1, sections)
      if (element) elements.push(element)
    })
  }

  if (Array.isArray(qaModel.keyImages)) {
    qaModel.keyImages.forEach((node, index) => {
      const element = createQaModelImageElement(node, elements.length + index + 1, sections)
      if (element) elements.push(element)
    })
  }

  return withPositionRatios(dedupeQaModelElements(elements), sections)
}

function extractStructuredFallbackElements(source) {
  if (!source || typeof source !== 'object') return []

  const hasStructuredArrays = Array.isArray(source?.texts)
    || Array.isArray(source?.ctas)
    || Array.isArray(source?.images)
    || Array.isArray(source?.sections)

  if (!hasStructuredArrays) return []

  const sections = extractSections(source)
  const elements = []
  const pushText = (node, index, isButton = false) => {
    const element = createFigmaElement(isButton ? { ...node, tag: 'button', qaImportance: 'button' } : node, index, {
      layerPath: getLayerPath(node),
      sections,
    })
    if (element) elements.push(element)
  }
  const pushImage = (node, index) => {
    const element = createFigmaImageElement(node, index, {
      layerPath: getLayerPath(node),
      sections,
    })
    if (element) elements.push(element)
  }

  if (Array.isArray(source.texts)) {
    source.texts.forEach((node, index) => pushText(node, elements.length + index + 1))
  }

  if (Array.isArray(source.ctas)) {
    source.ctas.forEach((node, index) => pushText(node, elements.length + index + 1, true))
  }

  if (Array.isArray(source.images)) {
    source.images.forEach((node, index) => pushImage(node, elements.length + index + 1))
  }

  if (Array.isArray(source.sections)) {
    source.sections.forEach((section) => {
      if (Array.isArray(section.texts)) {
        section.texts.forEach((node) => pushText({ ...node, sectionName: section.name || node.sectionName }, elements.length + 1))
      }
      if (Array.isArray(section.ctas)) {
        section.ctas.forEach((node) => pushText({ ...node, sectionName: section.name || node.sectionName }, elements.length + 1, true))
      }
      if (Array.isArray(section.images)) {
        section.images.forEach((node) => pushImage({ ...node, sectionName: section.name || node.sectionName }, elements.length + 1))
      }
    })
  }

  return withPositionRatios(dedupeQaModelElements(elements), sections)
}

function extractQaModelSections(qaModel) {
  if (!Array.isArray(qaModel.sections)) return []

  return qaModel.sections.map((section, index) => {
    const bounds = getNodeBounds(section)
    const sectionName = cleanText(section.qaLabel || section.label || section.name || `섹션 ${index + 1}`)

    return {
      id: getString(section.id) || `qa-section-${index + 1}`,
      name: sectionName,
      rawName: cleanText(section.sourceName || section.name || ''),
      layerPath: cleanText(section.sourceName || section.name || sectionName),
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      isFooterDisclaimer: sectionName === '푸터/디스클레이머' || isFooterDisclaimerText(`${sectionName} ${section.sourceName || ''}`),
    }
  })
}

function createQaModelTextElement(node, index, sections) {
  if (!isVisibleFigmaNode(node)) return null

  const text = cleanText(node.text || node.label || node.characters || '')
  if (!text) return null

  const bounds = getNodeBounds(node)
  const matchedSection = findSectionForBounds(bounds, sections)
  const sectionName = cleanText(node.sectionLabel || matchedSection?.name || getPlannerSectionName(node, bounds.y))
  const importance = cleanText(node.importance || 'body')
  const isReferenceOnly = importance === 'note' || importance === 'nav' || sectionName === '푸터/디스클레이머'

  return {
    index,
    tag: node.tag || (importance === 'button' ? 'button' : 'TEXT'),
    text,
    normalizedText: normalizeDesignText(node.normalizedText || text),
    layerPath: getLayerPath(node),
    sectionId: getPlannerSectionId(sectionName),
    sectionName,
    qaImportance: importance,
    isReferenceOnly,
    isFooterDisclaimer: isReferenceOnly && (importance === 'note' || sectionName === '푸터/디스클레이머'),
    fontSize: node.fontSize ?? '',
    fontWeight: node.fontWeight ?? '',
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    href: node.href || '',
    positionRatio: getVerticalPositionRatio(node.positionRatio),
  }
}

function createQaModelImageElement(node, index, sections) {
  if (!isVisibleFigmaNode(node)) return null

  const bounds = getNodeBounds(node)
  const sectionName = cleanText(node.sectionLabel || findSectionForBounds(bounds, sections)?.name || getPlannerSectionName(node, bounds.y))
  const kind = node.kind || 'contentImage'

  return {
    index,
    tag: 'img',
    kind,
    text: cleanText(node.text || node.name || `이미지 ${index}`),
    normalizedText: normalizeDesignText(node.normalizedText || node.text || node.name || `이미지 ${index}`),
    layerPath: getLayerPath(node),
    sectionId: getPlannerSectionId(sectionName),
    sectionName,
    isReferenceOnly: kind === 'iconOrGraphic',
    isFooterDisclaimer: sectionName === '푸터/디스클레이머',
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    positionRatio: getVerticalPositionRatio(node.positionRatio),
  }
}

function dedupeQaModelElements(elements) {
  const seen = new Set()
  return elements.filter((element) => {
    const key = `${element.tag}-${element.normalizedText}-${Math.round(element.y)}-${Math.round(element.x)}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
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
      const rawName = cleanText(section.name || section.title || section.label || `섹션 ${index + 1}`)
      const name = getPlannerSectionName({ ...section, text: rawName, layerPath: getLayerPath(section) }, bounds.y)

      return {
        id: getString(section.id) || `section-${index + 1}`,
        name,
        rawName,
        layerPath: getLayerPath(section) || rawName,
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
        isFooterDisclaimer: isFooterDisclaimerText(`${rawName} ${getLayerPath(section)}`) || name === '푸터/디스클레이머',
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
  if (!isVisibleFigmaNode(node)) return null

  const rawText = getFigmaNodeText(node)
  const text = cleanText(rawText)
  if (!text) return null

  const style = node.style || {}
  const bounds = getNodeBounds(node)
  const matchedSection = context.section || findSectionForBounds(bounds, context.sections)
  const layerPath = context.layerPath || getLayerPath(node)
  const sectionName = getPlannerSectionName({ ...node, text, layerPath, sectionName: getString(node.sectionName) || matchedSection?.name }, bounds.y)

  return {
    index,
    tag: node.type || node.tag || 'FIGMA',
    text,
    normalizedText: normalizeDesignText(text),
    layerPath,
    sectionId: getPlannerSectionId(sectionName),
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
    positionRatio: getVerticalPositionRatio(node.positionRatio),
  }
}

function createFigmaImageElement(node, index, context = {}) {
  if (!isVisibleFigmaNode(node)) return null

  const bounds = getNodeBounds(node)
  const layerPath = context.layerPath || getLayerPath(node)
  const matchedSection = context.section || findSectionForBounds(bounds, context.sections)
  const text = cleanText(node.alt || node.text || node.name || `이미지 ${index}`)
  const sectionName = getPlannerSectionName({ ...node, text, layerPath, sectionName: getString(node.sectionName) || matchedSection?.name }, bounds.y)

  return {
    index,
    tag: 'img',
    kind: node.kind || 'IMAGE',
    text,
    normalizedText: normalizeDesignText(text),
    layerPath,
    sectionId: getPlannerSectionId(sectionName),
    sectionName,
    isFooterDisclaimer: Boolean(matchedSection?.isFooterDisclaimer) || isFooterDisclaimerText(`${text} ${layerPath} ${sectionName}`),
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    positionRatio: getVerticalPositionRatio(node.positionRatio),
  }
}

function getNodeSection(node, fallbackSection) {
  if (node.type !== 'SECTION') return fallbackSection
  const bounds = getNodeBounds(node)
  const rawName = cleanText(node.name || node.title || 'Section')
  const name = getPlannerSectionName({ ...node, text: rawName, layerPath: getLayerPath(node) }, bounds.y)

  return {
    id: getPlannerSectionId(name),
    name,
    rawName,
    layerPath: getLayerPath(node) || rawName,
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    isFooterDisclaimer: isFooterDisclaimerText(rawName) || name === '푸터/디스클레이머',
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
  if (typeof node.label === 'string') return node.label
  return ''
}

function isVisibleFigmaNode(node) {
  if (!node || typeof node !== 'object') return false
  if (node.visible === false || node.hidden === true) return false

  const opacity = firstNumber(node.opacity)
  if (opacity !== null && opacity <= 0) return false

  const bounds = getNodeBounds(node)
  if ((bounds.width <= 0 || bounds.height <= 0) && !cleanText(node.text || node.characters || node.label || '')) return false
  return true
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
    positionRatio: getVerticalPositionRatio(element.positionRatio) ?? (hasPositionData(element) ? clampRatio((toNumber(element.y) ?? 0) / maxBottom) : null),
  }))
}

function prepareComparableElements(elements, source) {
  const maxBottom = getMaxBottom(elements) || 1

  return elements
    .map((element, index) => {
      const text = cleanText(element.text || element.alt || element.label || element.name || (isImageElement(element) ? `이미지 ${index + 1}` : ''))
      if (!text && !isImageElement(element)) return null

      const rawY = firstNumber(element.y)
      const y = rawY ?? 0
      const layerPath = getLayerPath(element)
      const sectionName = getPlannerSectionName({ ...element, text, layerPath }, y)
      const isFooterDisclaimer = Boolean(element.isFooterDisclaimer) || isFooterDisclaimerText(`${text} ${layerPath} ${sectionName}`)

      return {
        ...element,
        index: element.index || index + 1,
        source,
        tag: element.tag || (source === 'figma' ? 'FIGMA' : 'element'),
        text,
        normalizedText: normalizeDesignText(text),
        layerPath,
        sectionId: getPlannerSectionId(sectionName),
        sectionName,
        isFooterDisclaimer,
        x: firstNumber(element.x) ?? 0,
        y,
        width: firstNumber(element.width) ?? 0,
        height: firstNumber(element.height) ?? 0,
        positionRatio: getVerticalPositionRatio(element.positionRatio) ?? (hasPositionData(element) ? clampRatio(y / maxBottom) : null),
      }
    })
    .filter(Boolean)
}

function matchComparableGroups(figmaElements, webElements, group) {
  const exactMatches = []
  const remainingWebByKey = new Map()

  webElements.forEach((element) => {
    const key = compareText(element.text)
    const matches = remainingWebByKey.get(key) || []
    matches.push(element)
    remainingWebByKey.set(key, matches)
  })

  const unmatchedFigma = []
  figmaElements.forEach((element) => {
    const key = compareText(element.text)
    const matches = remainingWebByKey.get(key)
    if (matches && matches.length > 0) {
      exactMatches.push({ figmaElement: element, webElement: matches.shift(), matchedBy: 'compareText exact', score: 1 })
      if (matches.length === 0) remainingWebByKey.delete(key)
      return
    }

    unmatchedFigma.push(element)
  })

  const unmatchedWeb = Array.from(remainingWebByKey.values()).flat()
  const candidates = []

  unmatchedFigma.forEach((figmaElement) => {
    unmatchedWeb.forEach((webElement) => {
      const candidate = createSimilarityCandidate(figmaElement, webElement, group)
      if (candidate) candidates.push(candidate)
    })
  })

  const usedFigma = new Set()
  const usedWeb = new Set()
  const similarMatches = []

  candidates
    .sort((first, second) => {
      if (first.score !== second.score) return second.score - first.score
      return first.positionDelta - second.positionDelta
    })
    .forEach((candidate) => {
      if (usedFigma.has(candidate.figmaElement) || usedWeb.has(candidate.webElement)) return
      usedFigma.add(candidate.figmaElement)
      usedWeb.add(candidate.webElement)
      similarMatches.push(candidate)
    })

  return {
    exactMatches,
    similarMatches,
    unmatchedFigma: unmatchedFigma.filter((element) => !usedFigma.has(element)),
    unmatchedWeb: unmatchedWeb.filter((element) => !usedWeb.has(element)),
  }
}

function createSimilarityCandidate(figmaElement, webElement, group) {
  const figmaText = compareText(figmaElement.text)
  const webText = compareText(webElement.text)
  if (!figmaText || !webText || figmaText === webText) return null

  const similarity = getTextSimilarity(figmaText, webText)
  const tokenOverlap = getTokenOverlapScore(figmaText, webText)
  const containsMatch = figmaText.includes(webText) || webText.includes(figmaText)
  const positionDelta = getPositionDelta(figmaElement, webElement)
  const isButtonGroup = group === 'button'
  const hasStrongTextSimilarity = similarity >= TEXT_PAIR_SIMILARITY_THRESHOLD
  const hasStrongTokenOverlap = tokenOverlap >= TEXT_PAIR_TOKEN_OVERLAP_THRESHOLD
  const hasButtonSimilarity = similarity >= BUTTON_PAIR_SIMILARITY_THRESHOLD
  const hasButtonTokenOverlap = tokenOverlap >= BUTTON_PAIR_TOKEN_OVERLAP_THRESHOLD
  const hasHybridTextSimilarity = similarity >= 0.48 && tokenOverlap >= 0.34
  const hasHybridButtonSimilarity = similarity >= 0.36 && tokenOverlap >= 0.34
  const isEligible = isButtonGroup
    ? containsMatch || hasButtonSimilarity || hasButtonTokenOverlap || hasHybridButtonSimilarity
    : containsMatch || hasStrongTextSimilarity || hasStrongTokenOverlap || hasHybridTextSimilarity || ((isKeyCopyElement(figmaElement) || isKeyCopyElement(webElement)) && similarity >= 0.45 && tokenOverlap >= 0.2)

  if (!isEligible) return null

  const containsScore = containsMatch ? 0.08 : 0
  const keyCopyScore = !isButtonGroup && (isKeyCopyElement(figmaElement) || isKeyCopyElement(webElement)) ? 0.04 : 0
  const score = (similarity * (isButtonGroup ? 0.48 : 0.66))
    + (tokenOverlap * (isButtonGroup ? 0.18 : 0.22))
    + containsScore
    + keyCopyScore

  return {
    figmaElement,
    webElement,
    matchedBy: containsMatch ? 'similar compareText' : tokenOverlap >= 0.5 ? 'token overlap' : 'text similarity',
    score,
    positionDelta,
  }
}

function getTokenOverlapScore(firstText, secondText) {
  const firstTokens = getCoreTokens(firstText)
  const secondTokens = getCoreTokens(secondText)
  if (firstTokens.length === 0 || secondTokens.length === 0) return 0

  const secondTokenSet = new Set(secondTokens)
  const overlapCount = firstTokens.filter((token) => secondTokenSet.has(token)).length
  return overlapCount / Math.max(firstTokens.length, secondTokens.length)
}

function getCoreTokens(value) {
  return compareText(value)
    .split(' ')
    .map((token) => token.trim())
    .filter(Boolean)
}

function createTextDifferenceIssue(figmaElement, webElement, matchedBy, similarityScore) {
  return createGroupedIssue({
    status: 'warn',
    label: '문구 차이',
    text: figmaElement.text || webElement.text,
    detail: '시안과 웹의 문구가 완전히 같지 않습니다.',
    categories: ['text'],
    differences: [createDifference('text', '문구 차이', '시안과 웹 문구를 다시 확인해 주세요.')],
    figmaElement,
    webElement,
    matchType: 'text-difference',
    matchedBy,
    similarityScore,
    primaryCandidate: true,
    issueType: 'text-difference',
  })
}

function createTextOnlyIssue(element, source) {
  const isFigma = source === 'figma'

  return createGroupedIssue({
    status: 'error',
    label: isFigma ? '시안에만 있음' : '웹에만 있음',
    text: element.text,
    detail: isFigma ? '시안에는 있지만 웹에서는 같은 문구를 찾지 못했습니다.' : '웹에는 있지만 시안에서는 같은 문구를 찾지 못했습니다.',
    categories: ['text'],
    differences: [createDifference('text', isFigma ? '시안에만 있음' : '웹에만 있음', isFigma ? '웹 대응 문구를 찾지 못했습니다.' : '시안 대응 문구를 찾지 못했습니다.')],
    figmaElement: isFigma ? element : null,
    webElement: isFigma ? null : element,
    matchType: isFigma ? 'figma-only' : 'web-only',
    primaryCandidate: true,
    issueType: isFigma ? 'figma-only' : 'web-only',
  })
}

function createButtonPairIssue(figmaElement, webElement, matchedBy, similarityScore) {
  const labels = []
  const differences = []
  const categories = ['cta']

  if (!areTextsEquivalent(figmaElement.text, webElement.text)) {
    labels.push('버튼 문구 차이')
    categories.push('text')
    differences.push(createDifference('cta', '버튼 문구 차이', '시안과 웹 버튼 문구가 다릅니다.'))
  }

  if (hasMissingButtonHref(webElement)) {
    labels.push('버튼 링크 확인')
    differences.push(createDifference('cta', '버튼 링크 확인', '웹 링크 버튼에 href가 비어 있습니다.'))
  }

  if (labels.length === 0) return null

  return createGroupedIssue({
    status: labels.includes('버튼 문구 차이') ? 'warn' : 'error',
    label: labels.join(' / '),
    text: figmaElement.text || webElement.text,
    detail: labels.includes('버튼 문구 차이')
      ? '버튼 문구와 링크를 함께 확인해 주세요.'
      : '웹 링크 버튼의 href 값을 확인해 주세요.',
    categories: Array.from(new Set(categories)),
    differences,
    figmaElement,
    webElement,
    matchType: 'button-check',
    matchedBy,
    similarityScore,
    primaryCandidate: true,
    issueType: 'button',
  })
}

function createButtonOnlyIssue(element, source) {
  const isFigma = source === 'figma'
  const labels = [isFigma ? '시안 버튼만 있음' : '웹 버튼만 있음']
  const differences = [createDifference('cta', labels[0], isFigma ? '웹 대응 버튼을 찾지 못했습니다.' : '시안 대응 버튼을 찾지 못했습니다.')]

  if (!isFigma && hasMissingButtonHref(element)) {
    labels.push('버튼 링크 확인')
    differences.push(createDifference('cta', '버튼 링크 확인', '웹 링크 버튼에 href가 비어 있습니다.'))
  }

  return createGroupedIssue({
    status: 'error',
    label: labels.join(' / '),
    text: element.text,
    detail: isFigma ? '시안 버튼은 있지만 웹 버튼에서 같은 문구를 찾지 못했습니다.' : '웹 버튼은 있지만 시안 버튼에서 같은 문구를 찾지 못했습니다.',
    categories: labels.includes('버튼 링크 확인') ? ['cta', 'text'] : ['cta'],
    differences,
    figmaElement: isFigma ? element : null,
    webElement: isFigma ? null : element,
    matchType: isFigma ? 'figma-button-only' : 'web-button-only',
    primaryCandidate: true,
    issueType: 'button',
  })
}

function hasMissingButtonHref(element) {
  return Boolean(element && String(element.tag || '').toLowerCase() === 'a' && !String(element.href || '').trim())
}

// eslint-disable-next-line no-unused-vars
function createTextMatches(figmaElements, webElements) {
  const candidates = []

  figmaElements.forEach((figmaElement) => {
    webElements.forEach((webElement) => {
      const candidate = getTextMatchCandidate(figmaElement, webElement)
      if (candidate) candidates.push(candidate)
    })
  })

  const usedFigma = new Set()
  const usedWeb = new Set()
  const matches = []

  candidates
    .sort((first, second) => {
      if (first.priority !== second.priority) return first.priority - second.priority
      if (first.score !== second.score) return second.score - first.score
      return first.positionDelta - second.positionDelta
    })
    .forEach((candidate) => {
      if (usedFigma.has(candidate.figmaElement) || usedWeb.has(candidate.webElement)) return
      usedFigma.add(candidate.figmaElement)
      usedWeb.add(candidate.webElement)
      matches.push(candidate)
    })

  return {
    matches,
    unmatchedFigma: figmaElements.filter((element) => !usedFigma.has(element)),
    unmatchedWeb: webElements.filter((element) => !usedWeb.has(element)),
  }
}

function getTextMatchCandidate(figmaElement, webElement) {
  const figmaText = figmaElement.normalizedText || normalizeDesignText(figmaElement.text)
  const webText = webElement.normalizedText || normalizeDesignText(webElement.text)
  if (!figmaText || !webText) return null

  const positionDelta = getPositionDelta(figmaElement, webElement)
  if (figmaText === webText) {
    return createTextMatchCandidate(figmaElement, webElement, 'exact', 'normalizedText', 1, 1, positionDelta)
  }

  if (figmaText.includes(webText) || webText.includes(figmaText)) {
    return createTextMatchCandidate(figmaElement, webElement, 'contains', 'normalizedText 포함', 0.95, 2, positionDelta)
  }

  const similarity = getTextSimilarity(figmaText, webText)
  if (similarity >= FUZZY_MATCH_THRESHOLD) {
    return createTextMatchCandidate(figmaElement, webElement, 'fuzzy', '유사 문구', similarity, 3, positionDelta)
  }

  if (isSameSection(figmaElement, webElement) && (similarity >= 0.55 || (((isCtaElement(figmaElement) && isCtaElement(webElement)) || (isKeyCopyElement(figmaElement) && isKeyCopyElement(webElement))) && positionDelta <= 0.15))) {
    return createTextMatchCandidate(figmaElement, webElement, 'near-section', '같은 영역 위치 근접', similarity, 4, positionDelta)
  }

  return null
}

function createTextMatchCandidate(figmaElement, webElement, matchType, matchedBy, score, priority, positionDelta) {
  return { figmaElement, webElement, matchType, matchedBy, score, priority, positionDelta }
}

function getPositionDelta(figmaElement, webElement) {
  return Math.abs((getVerticalPositionRatio(figmaElement.positionRatio) ?? 0) - (getVerticalPositionRatio(webElement.positionRatio) ?? 0))
}

function isSameSection(figmaElement, webElement) {
  return Boolean(figmaElement.sectionId && webElement.sectionId && figmaElement.sectionId === webElement.sectionId)
    || Boolean(figmaElement.sectionName && webElement.sectionName && figmaElement.sectionName === webElement.sectionName)
}

// eslint-disable-next-line no-unused-vars
function compareMatchedElements(figmaElement, webElement, options = {}) {
  const differences = []
  const matchType = options.matchType || 'exact'
  const textChanged = !areTextsEquivalent(figmaElement.text, webElement.text)

  if (textChanged) {
    differences.push(createDifference('text', getTextDifferenceLabel(figmaElement, webElement), '문구가 다릅니다.'))
  }

  const fontFamilyChanged = hasFontFamilyDifference(figmaElement, webElement)
  const layoutDifference = getLayoutDifference(figmaElement, webElement)

  if (hasMissingCtaLink(figmaElement, webElement) || hasCtaTextMismatch(figmaElement, webElement, matchType)) {
    differences.push(createDifference('cta', '버튼 확인', getCtaDetail(figmaElement, webElement)))
  }

  if (differences.length === 0) {
    return createGroupedIssue({
      status: 'ok',
      label: options.matchIndex > 0 ? '반복 문구 일치' : '문구와 주요 디자인 일치',
      text: figmaElement.text,
      detail: fontFamilyChanged
        ? '문구와 주요 디자인이 기준 범위 안에 있습니다. 글꼴 이름 차이는 참고 정보로만 처리했습니다.'
        : '문구와 주요 디자인이 기준 범위 안에 있습니다.',
      categories: [],
      differences: [],
      figmaElement,
      webElement,
      matchType,
      matchedBy: options.matchedBy,
      similarityScore: options.fuzzyScore,
    })
  }

  const categories = Array.from(new Set(differences.map((difference) => difference.type)))
  const label = getGroupedLabel(categories, [])

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
    matchedBy: options.matchedBy,
    similarityScore: options.fuzzyScore,
    primaryCandidate: isPrimaryMatchedIssue({ categories, figmaElement, webElement, matchType, layoutDifference }),
  })
}

// eslint-disable-next-line no-unused-vars
function createMissingFigmaIssue(figmaElement) {
  const isActionable = isActionableMissingElement(figmaElement)

  return createGroupedIssue({
    status: figmaElement.isFooterDisclaimer ? 'warn' : 'error',
    label: isCtaElement(figmaElement) ? '웹 화면 버튼 확인' : '웹 화면 문구 확인',
    text: figmaElement.text,
    detail: 'Figma에는 있지만 웹 화면에서 같은 문구를 찾지 못했습니다.',
    categories: isCtaElement(figmaElement) ? ['text', 'cta'] : ['text'],
    differences: [createDifference('text', '문구 누락', '웹 화면에서 동일 문구를 수집하지 못했습니다.')],
    figmaElement,
    webElement: null,
    matchType: 'missing-web',
    primaryCandidate: isActionable,
    forceReference: !isActionable,
  })
}

// eslint-disable-next-line no-unused-vars
function createWebOnlyIssue(webElement) {
  const isActionable = isActionableMissingElement(webElement)

  return createGroupedIssue({
    status: webElement.isFooterDisclaimer ? 'warn' : 'error',
    label: isCtaElement(webElement) ? '피그마 기준에 없는 버튼' : '웹에만 있는 문구',
    text: webElement.text,
    detail: '웹 화면에는 있지만 Figma JSON에서 같은 문구를 찾지 못했습니다.',
    categories: isCtaElement(webElement) ? ['text', 'cta'] : ['text'],
    differences: [createDifference('text', '피그마 기준 누락', 'Figma JSON에서 동일 문구를 수집하지 못했습니다.')],
    figmaElement: null,
    webElement,
    matchType: 'web-only',
    primaryCandidate: isActionable,
    forceReference: !isActionable,
  })
}

function createGroupedIssue({ status, label, text, detail, categories, differences, figmaElement, webElement, matchType, primaryCandidate = false, forceReference = false, matchedBy = '', similarityScore = null, issueType = 'text' }) {
  const primaryElement = figmaElement || webElement
  const sort = getSortPosition(figmaElement, webElement)
  const sectionName = getPlannerSectionName(primaryElement, sort.y)
  const isFooterDisclaimer = Boolean(figmaElement?.isFooterDisclaimer || webElement?.isFooterDisclaimer || isFooterDisclaimerText(`${text} ${sectionName}`))
  const isReferenceOnly = Boolean(figmaElement?.isReferenceOnly || webElement?.isReferenceOnly)
  const isReference = forceReference || isFooterDisclaimer || isReferenceOnly || !isPrimaryIssue({ status, categories, figmaElement, webElement, isFooterDisclaimer, primaryCandidate })
  const priority = getIssuePriority({ status, categories, figmaElement, webElement, isFooterDisclaimer, isReference })
  const issueGroup = isReference ? 'reference' : 'primary'

  return {
    id: `${status}-${label}-${normalizeDesignText(text)}-${sort.y}-${sort.x}-${figmaElement?.index || 'no-figma'}-${webElement?.index || 'no-web'}-${matchType || 'match'}`,
    status,
    label,
    text: text || '문구 없음',
    normalizedText: normalizeDesignText(text),
    detail,
    region: sectionName,
    sectionId: getPlannerSectionId(sectionName),
    sectionName,
    isFooterDisclaimer,
    priority,
    severity: priority <= 3 && status !== 'ok' && !isReference ? 'check-required' : status,
    issueGroup,
    plannerType: issueGroup,
    isReference,
    issueType,
    categories,
    differences,
    matchType: matchType || 'exact',
    matchedBy,
    similarityScore,
    layerPath: '',
    anchor: { x: sort.x, y: sort.y, xRatio: sort.xRatio, positionRatio: sort.positionRatio },
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
    text: '피그마 기준 없음',
    detail: webElementCount > 0
      ? `웹에서 디자인 요소 ${webElementCount}개를 수집했습니다. Figma JSON을 입력하면 문구와 디자인 차이를 비교합니다.`
      : '좌측 패널에서 Figma JSON을 입력하고 URL 검사를 실행하면 시안 비교 QA가 생성됩니다.',
    categories: ['text'],
    differences: [createDifference('text', '피그마 기준 없음', '비교할 Figma JSON이 아직 없습니다.')],
    figmaElement: null,
    webElement: null,
    matchType: 'waiting',
    primaryCandidate: true,
    issueType: 'waiting',
  })
}

function createComparisonResult(issues) {
  const sortedIssues = sortIssuesByPriority(issues)
  const primaryIssues = sortedIssues.filter((issue) => issue.status !== 'ok' && !issue.isReference)
  const primaryIds = new Set(primaryIssues.map((issue) => issue.id))
  const referenceIssues = sortedIssues.filter((issue) => issue.status !== 'ok' && !primaryIds.has(issue.id))
  const textDifferences = primaryIssues.filter((issue) => issue.issueType === 'text-difference')
  const figmaOnly = primaryIssues.filter((issue) => issue.issueType === 'figma-only')
  const webOnly = primaryIssues.filter((issue) => issue.issueType === 'web-only')
  const buttonIssues = primaryIssues.filter((issue) => issue.issueType === 'button')
  const waitingIssues = primaryIssues.filter((issue) => issue.issueType === 'waiting')
  const actionableIssues = [...textDifferences, ...figmaOnly, ...webOnly, ...buttonIssues]
  const visibleIssues = actionableIssues.length > 0 ? actionableIssues : waitingIssues

  return {
    counts: getDesignCounts(sortedIssues),
    summaryCounts: getSummaryCounts(primaryIssues, referenceIssues),
    sectionSummaries: getSectionSummaries(primaryIssues),
    topIssues: visibleIssues.slice(0, TOP_ISSUE_LIMIT),
    primaryIssues: visibleIssues,
    referenceIssues,
    textDifferences,
    figmaOnly,
    webOnly,
    buttonIssues,
    waitingIssues,
    emptyMessage: visibleIssues.length === 0 ? '큰 문구 차이를 찾지 못했습니다.' : '',
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

function getSummaryCounts(issues, referenceIssues = []) {
  return issues.reduce(
    (counts, issue) => {
      if (issue.status === 'ok') return counts

      return {
        reference: counts.reference,
        total: counts.total + 1,
        high: counts.high + (issue.severity === 'check-required' ? 1 : 0),
        text: counts.text + (issue.categories.includes('text') ? 1 : 0),
        style: counts.style + (issue.categories.includes('style') ? 1 : 0),
        layout: counts.layout + (issue.categories.includes('layout') ? 1 : 0),
        cta: counts.cta + (issue.categories.includes('cta') ? 1 : 0),
        footer: counts.footer + (issue.isFooterDisclaimer ? 1 : 0),
        checkRequired: counts.checkRequired + 1,
        textCheck: counts.textCheck + (issue.categories.includes('text') ? 1 : 0),
        ctaCheck: counts.ctaCheck + (issue.categories.includes('cta') ? 1 : 0),
        designCheck: counts.designCheck + (issue.categories.includes('style') || issue.categories.includes('layout') || issue.categories.includes('image') ? 1 : 0),
      }
    },
    {
      total: 0,
      high: 0,
      text: 0,
      style: 0,
      layout: 0,
      cta: 0,
      footer: referenceIssues.filter((issue) => issue.isFooterDisclaimer).length,
      checkRequired: 0,
      textCheck: 0,
      ctaCheck: 0,
      designCheck: 0,
      reference: referenceIssues.length,
    },
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
    summary.high += issue.severity === 'check-required' ? 1 : 0
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

function getLayoutDifference(figmaElement, webElement) {
  const deltas = ['x', 'y', 'width', 'height'].map((key) => {
    const figmaValue = toNumber(figmaElement[key])
    const webValue = toNumber(webElement[key])
    return figmaValue !== null && webValue !== null ? Math.abs(figmaValue - webValue) : 0
  })
  const ratioDelta = Math.abs((getVerticalPositionRatio(figmaElement.positionRatio) ?? 0) - (getVerticalPositionRatio(webElement.positionRatio) ?? 0))
  const maxDelta = Math.max(...deltas, ratioDelta * 1000)

  return {
    hasDifference: maxDelta > LAYOUT_TOLERANCE,
    isObvious: maxDelta > OBVIOUS_LAYOUT_TOLERANCE || ratioDelta > 0.12,
  }
}

// eslint-disable-next-line no-unused-vars
function compareImageElements(figmaImages, webImages) {
  const issues = []
  const usedWeb = new Set()
  let hasHeroImageIssue = false

  figmaImages.forEach((figmaImage) => {
    const match = findClosestImageMatch(figmaImage, webImages, usedWeb)
    if (match && match.score <= 0.18) {
      usedWeb.add(match.webImage)
      if (isHeroImageCandidate(figmaImage) && !hasHeroImageIssue) {
        hasHeroImageIssue = true
        issues.push(createGroupedIssue({
          status: 'warn',
          label: 'Hero 대표 이미지 확인',
          text: figmaImage.text,
          detail: '상단 대표 이미지가 시안과 같은 이미지인지 확인하세요.',
          categories: ['image'],
          differences: [createDifference('image', '대표 이미지 확인', '웹과 시안의 상단 이미지가 같은지 확인이 필요합니다.')],
          figmaElement: figmaImage,
          webElement: match.webImage,
          matchType: 'hero-image-check',
          primaryCandidate: true,
        }))
      } else if (match.score > 0.1) {
        issues.push(createGroupedIssue({
          status: 'warn',
          label: '이미지 위치 참고',
          text: figmaImage.text,
          detail: 'Figma 이미지와 웹 이미지가 비슷한 위치에서 확인됩니다. 위치 차이만 참고 이슈로 분리했습니다.',
          categories: ['image', 'layout'],
          differences: [createDifference('layout', '이미지 위치 참고', `위치 유사도 ${Math.round((1 - match.score) * 100)}%`) ],
          figmaElement: figmaImage,
          webElement: match.webImage,
          matchType: 'image-position',
          forceReference: true,
        }))
      }
      return
    }

    const isHeroImage = isHeroImageCandidate(figmaImage)
    const isPrimaryImage = isHeroImage
      ? !hasHeroImageIssue
      : isLargeImageCandidate(figmaImage) && !figmaImage.isReferenceOnly && figmaImage.kind !== 'iconOrGraphic'
    if (isHeroImage) hasHeroImageIssue = true

    issues.push(createGroupedIssue({
      status: isPrimaryImage ? 'error' : 'warn',
      label: isPrimaryImage && isHeroImage ? 'Hero 대표 이미지 확인' : isPrimaryImage ? '웹 화면 이미지 확인' : '이미지 참고',
      text: figmaImage.text,
      detail: 'Figma 이미지 후보와 비슷한 위치의 웹 이미지를 찾지 못했습니다.',
      categories: ['image'],
      differences: [createDifference('image', '이미지 누락', '웹 화면에서 대응 이미지를 확인하지 못했습니다.')],
      figmaElement: figmaImage,
      webElement: null,
      matchType: 'missing-web-image',
      primaryCandidate: isPrimaryImage,
      forceReference: !isPrimaryImage,
    }))
  })

  return issues
}

function isLargeImageCandidate(element) {
  const width = toNumber(element?.width) ?? 0
  const height = toNumber(element?.height) ?? 0
  return width >= 240 && height >= 120
}

function isHeroImageCandidate(element) {
  if (!element || element.kind === 'iconOrGraphic') return false
  const yRatio = getVerticalPositionRatio(element.positionRatio)
  const width = toNumber(element.width) ?? 0
  const height = toNumber(element.height) ?? 0
  const nameText = `${element.text || ''} ${element.name || ''} ${element.layerPath || ''}`
  return height >= 100 && width >= 240 && (yRatio === null || yRatio < 0.28 || /hero|kv|visual|main[_\s-]*visual|메인|비주얼/i.test(nameText))
}

function findClosestImageMatch(figmaImage, webImages, usedWeb) {
  return webImages
    .filter((webImage) => !usedWeb.has(webImage))
    .map((webImage) => ({ webImage, score: getImagePositionScore(figmaImage, webImage) }))
    .sort((first, second) => first.score - second.score)[0]
}

function getImagePositionScore(figmaImage, webImage) {
  const figmaRatio = getVerticalPositionRatio(figmaImage.positionRatio) ?? 0
  const webRatio = getVerticalPositionRatio(webImage.positionRatio) ?? 0
  const yDelta = Math.abs(figmaRatio - webRatio)
  const figmaSide = getImageSide(figmaImage)
  const webSide = getImageSide(webImage)
  return yDelta + (figmaSide === webSide ? 0 : 0.08)
}

function getImageSide(element) {
  const ratio = getHorizontalPositionRatio(element.positionRatio)
  if (ratio !== null) return ratio < 0.45 ? 'left' : ratio > 0.55 ? 'right' : 'center'
  const x = toNumber(element.x) ?? 0
  return x < 320 ? 'left' : x > 700 ? 'right' : 'center'
}

// eslint-disable-next-line no-unused-vars
function aggregateFooterReferenceIssues(issues) {
  const footerIssues = issues.filter((issue) => issue.status !== 'ok' && issue.isFooterDisclaimer)
  if (footerIssues.length <= 1) return issues

  const nonFooterIssues = issues.filter((issue) => !(issue.status !== 'ok' && issue.isFooterDisclaimer))
  const firstIssue = sortIssuesByPriority(footerIssues)[0]
  const categories = Array.from(new Set(footerIssues.flatMap((issue) => issue.categories)))
  const aggregate = createGroupedIssue({
    status: 'warn',
    label: '푸터/디스클레이머 참고 묶음',
    text: `푸터/디스클레이머 참고 ${footerIssues.length}건`,
    detail: `반복 고지/약관/푸터성 차이 ${footerIssues.length}건을 하나로 접었습니다. 주요 예: ${firstIssue.text}`,
    categories: categories.length > 0 ? categories : ['text'],
    differences: [createDifference('text', '접힌 참고 이슈', `${footerIssues.length}건의 푸터/디스클레이머 차이를 참고 이슈로 묶었습니다.`)],
    figmaElement: firstIssue.figma,
    webElement: firstIssue.web,
    matchType: 'footer-aggregate',
    forceReference: true,
  })

  return sortIssuesByPriority([...nonFooterIssues, aggregate])
}

function isCtaElement(element) {
  if (!element) return false
  if (isNavLikeElement(element)) return false
  if (element.qaImportance && element.qaImportance !== 'button') return false

  return element.tag === 'button'
    || element.qaImportance === 'button'
    || /\b(button|btn|cta|link)\b|더보기|자세히|신청|구매|상담|가입|예약|문의/i.test(`${element.text || ''} ${element.layerPath || ''}`)
}

function isButtonCandidate(element) {
  if (!element || element.isFooterDisclaimer || isNavLikeElement(element)) return false

  const tag = String(element.tag || '').toLowerCase()
  const layerText = `${element.layerPath || ''} ${element.text || ''}`
  const text = cleanText(element.text || '')
  if (tag === 'a' || tag === 'button') return true
  if (element.qaImportance === 'button') return true
  return BUTTON_LAYER_PATTERN.test(layerText) || (text.length <= 24 && BUTTON_TEXT_PATTERN.test(text))
}

function isCoreText(element) {
  if (!element || element.isFooterDisclaimer) return false
  const normalizedText = element.normalizedText || normalizeDesignText(element.text)
  return normalizedText.length >= MIN_FUZZY_TEXT_LENGTH || isCtaElement(element)
}

function isKeyCopyElement(element) {
  if (!element || element.isFooterDisclaimer) return false
  const tag = String(element.tag || '').toLowerCase()
  return element.qaImportance === 'title' || (toNumber(element.fontSize) ?? 0) >= 28 || tag === 'h1' || tag === 'h2' || /headline|title|heading|h1|h2|타이틀|제목/i.test(`${element.layerPath || ''} ${element.text || ''}`)
}

function isImageElement(element) {
  if (!element) return false
  const tag = String(element.tag || element.type || '').toLowerCase()
  return tag === 'img' || /image|graphic|icon|이미지|아이콘/i.test(`${element.kind || ''} ${element.name || ''} ${element.layerPath || ''}`)
}

function isComparableTextElement(element) {
  if (!element || isImageElement(element)) return false
  if (isNavLikeElement(element)) return false
  const text = cleanText(element.text || '')
  if (text.length < 2) return false
  if (!/[A-Za-z0-9가-힣]/.test(text)) return false
  if (isDecorativeLayerElement(element) && isRawLayerLikeText(text)) return false
  if (isRawLayerLikeText(text) && !isCtaElement(element)) return false
  return true
}

// eslint-disable-next-line no-unused-vars
function isComparableImageElement(element) {
  if (!element || element.kind === 'iconOrGraphic') return false
  if (isRawLayerLikeText(element.text || element.name || element.kind) && !isHeroImageCandidate(element)) return false
  return isLargeImageCandidate(element)
}

// eslint-disable-next-line no-unused-vars
function isPlannerVisibleIssue(issue) {
  if (issue.isFooterDisclaimer) return false
  if (issue.categories.includes('image')) return isHeroImageCandidate(issue.figma) || (isLargeImageCandidate(issue.figma) && issue.figma?.kind !== 'iconOrGraphic' && !isDecorativeLayerElement(issue.figma))
  const element = issue.figma || issue.web
  if (!isComparableTextElement(element)) return false
  return issue.categories.includes('text') || issue.categories.includes('cta')
}

function isDecorativeLayerElement(element) {
  const layerText = `${element?.layerPath || ''} ${element?.tag || ''} ${element?.kind || ''} ${element?.name || ''}`
  return DECORATIVE_LAYER_PATTERN.test(layerText)
}

function isRawLayerLikeText(value) {
  const text = String(value || '').trim()
  return DECORATIVE_LAYER_PATTERN.test(text)
    || /^(image|img|graphic|icon|logo|vector|path|shape|rectangle|ellipse|line|group|frame|blende|blend)([_\s-]?\d*)?$/i.test(text)
}

function isPrimaryMatchedIssue({ categories, figmaElement, webElement, matchType, layoutDifference }) {
  if (categories.includes('cta') && (hasCtaTextMismatch(figmaElement, webElement, matchType) || hasMissingCtaLink(figmaElement, webElement))) return true
  if (categories.includes('text') && isKeyCopyElement(figmaElement)) return true
  return categories.includes('layout') && layoutDifference.isObvious
}

function isActionableMissingElement(element) {
  if (!element || element.isFooterDisclaimer || element.isReferenceOnly || isNavLikeElement(element) || !isComparableTextElement(element)) return false
  return isCtaElement(element) || isKeyCopyElement(element) || element.qaImportance === 'title' || element.qaImportance === 'button'
}

function isNavLikeElement(element) {
  if (!element) return false
  const text = cleanText(element.text || '')
  const tag = String(element.tag || '').toLowerCase()
  const layerText = String(element.layerPath || '').toLowerCase()
  const y = toNumber(element.y) ?? 0
  const height = toNumber(element.height) ?? 0
  const fontSize = toNumber(element.fontSize) ?? 0

  return element.qaImportance === 'nav'
    || /gnb|nav|navigation|header|menu|메뉴|네비|내비/i.test(layerText)
    || ((tag === 'a' || tag === 'button') && y < 160 && height <= 120)
    || (y < 160 && height <= 160 && fontSize < 24 && text.length <= 40)
}

function isPrimaryIssue({ status, figmaElement, webElement, isFooterDisclaimer, primaryCandidate }) {
  if (status === 'ok' || isFooterDisclaimer) return false
  if (primaryCandidate) return true
  if (!webElement && isCoreText(figmaElement)) return true
  if (!figmaElement && isCoreText(webElement)) return true
  return false
}

function hasCtaTextMismatch(figmaElement, webElement, matchType) {
  return Boolean(isCtaElement(figmaElement) && isCtaElement(webElement) && !areTextsEquivalent(figmaElement.text, webElement.text) && matchType !== 'exact')
}

function hasMissingCtaLink(figmaElement, webElement) {
  if (!isCtaElement(figmaElement) && !isCtaElement(webElement)) return false
  return Boolean(webElement && !webElement.href && String(webElement.tag || '').toLowerCase() === 'a')
}

function getTextDifferenceLabel(figmaElement, webElement) {
  if (isCtaElement(figmaElement) || isCtaElement(webElement)) return '버튼 문구 확인'
  if (isKeyCopyElement(figmaElement)) return '핵심 문구 확인'
  return '참고 문구 확인'
}

function hasFontFamilyDifference(figmaElement, webElement) {
  const figmaFontFamily = normalizeFontFamily(figmaElement.fontFamily)
  const webFontFamily = normalizeFontFamily(webElement.fontFamily)
  return Boolean(figmaFontFamily && webFontFamily && figmaFontFamily !== webFontFamily)
}

function getCtaDetail(figmaElement, webElement) {
  const textChanged = figmaElement && webElement && !areTextsEquivalent(figmaElement.text, webElement.text)
  const hrefDetail = webElement?.href ? `웹 버튼이 ${webElement.href}로 이동합니다.` : '웹 버튼에 이동 URL이 없습니다.'
  const textDetail = textChanged ? 'Figma와 웹 버튼 문구가 완전히 같지 않습니다.' : '버튼 문구와 연결 목적지가 기획 의도와 맞는지 확인하세요.'
  return `${hrefDetail} ${textDetail}`
}

function getGroupedLabel(categories, styleLabels) {
  const labels = []
  if (categories.includes('text')) labels.push('문구 확인 필요')
  if (categories.includes('style')) labels.push(styleLabels.length > 0 ? `${styleLabels.join('/')} 차이` : '디자인 차이')
  if (categories.includes('layout')) labels.push('위치/크기 확인 필요')
  if (categories.includes('cta')) labels.push('버튼 확인 필요')
  return labels.join(' + ')
}

function getIssuePriority({ status, categories, figmaElement, webElement, isFooterDisclaimer, isReference }) {
  if (status === 'ok') return 9
  if (isReference || isFooterDisclaimer) return 6
  if (!webElement && isCoreText(figmaElement)) return 1
  if (!figmaElement && isCoreText(webElement)) return 2
  if (categories.includes('cta')) return 3
  if (categories.includes('image')) return 3
  if (categories.includes('layout')) return 4
  return 6
}

function getSortPosition(figmaElement, webElement) {
  const y = firstNumber(figmaElement?.y, webElement?.y) ?? 0
  const x = firstNumber(figmaElement?.x, webElement?.x) ?? 0
  const positionRatio = getVerticalPositionRatio(figmaElement?.positionRatio) ?? getVerticalPositionRatio(webElement?.positionRatio)
  const xRatio = getHorizontalPositionRatio(figmaElement?.positionRatio) ?? getHorizontalPositionRatio(webElement?.positionRatio) ?? 0
  return { x, y, xRatio: clampRatio(xRatio), positionRatio: positionRatio === null || positionRatio === undefined ? null : clampRatio(positionRatio) }
}

function sortIssuesByPriority(issues) {
  return [...issues].sort((first, second) => {
    const firstYRatio = first.anchor.positionRatio ?? 1
    const secondYRatio = second.anchor.positionRatio ?? 1
    if (firstYRatio !== secondYRatio) return firstYRatio - secondYRatio
    const firstXRatio = first.anchor.xRatio ?? 0
    const secondXRatio = second.anchor.xRatio ?? 0
    if (firstXRatio !== secondXRatio) return firstXRatio - secondXRatio
    if (first.anchor.y !== second.anchor.y) return first.anchor.y - second.anchor.y
    return first.anchor.x - second.anchor.x
  })
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

function getPlannerSectionName(element, y) {
  if (!element) return PLANNER_SECTIONS[1].name
  const text = cleanText(element?.text || '')
  const explicitSectionName = cleanText(element?.sectionName || '')
  const layerPath = cleanText(element?.layerPath || '')
  const searchableText = `${text} ${explicitSectionName} ${layerPath}`
  const positionRatio = getVerticalPositionRatio(element?.positionRatio)

  const explicitPlannerSection = findPlannerSection(explicitSectionName)
  if (explicitPlannerSection) return explicitPlannerSection.name
  if (isFooterDisclaimerText(searchableText)) return PLANNER_SECTIONS[5].name
  if (/hero|kv|main[_\s-]*visual|히어로|키비주얼|메인/i.test(searchableText)) return PLANNER_SECTIONS[0].name
  if (/구비|서류|document/i.test(searchableText)) return PLANNER_SECTIONS[3].name
  if (/종류|type|program\s*type|프로그램\s*종류|con(?:tent)?[_\s-]*2|section[_\s-]*2|섹션\s*2/i.test(searchableText)) return PLANNER_SECTIONS[2].name
  if (/하단\s*배너|bottom\s*banner|banner|배너/i.test(searchableText)) return PLANNER_SECTIONS[4].name
  if (/con(?:tent)?|section|섹션|본문|콘텐츠/i.test(searchableText)) return PLANNER_SECTIONS[1].name
  if (/notice|info|guide|안내|유의/i.test(searchableText)) return PLANNER_SECTIONS[4].name
  if (positionRatio !== null) return getSectionByRatio(positionRatio)
  if (y < 700) return PLANNER_SECTIONS[0].name
  if (y < 1800) return PLANNER_SECTIONS[1].name
  if (y < 2600) return PLANNER_SECTIONS[2].name
  return PLANNER_SECTIONS[4].name
}

function getSectionByRatio(positionRatio) {
  if (positionRatio < 0.16) return PLANNER_SECTIONS[0].name
  if (positionRatio < 0.42) return PLANNER_SECTIONS[1].name
  if (positionRatio < 0.64) return PLANNER_SECTIONS[2].name
  if (positionRatio < 0.78) return PLANNER_SECTIONS[3].name
  if (positionRatio < 0.9) return PLANNER_SECTIONS[4].name
  return PLANNER_SECTIONS[5].name
}

function getPlannerSectionId(sectionName) {
  return findPlannerSection(sectionName)?.id || 'product-overview'
}

function findPlannerSection(sectionName) {
  const normalizedName = cleanText(sectionName)
  if (!normalizedName) return null

  return PLANNER_SECTIONS.find((section) => section.name === normalizedName || section.aliases?.includes(normalizedName)) || null
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

function hasPositionData(element) {
  if (!element) return false
  if (getVerticalPositionRatio(element.positionRatio) !== null) return true
  return [element.x, element.y, element.width, element.height].some((value) => {
    const number = toNumber(value)
    return number !== null && number !== 0
  })
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

function getVerticalPositionRatio(value) {
  if (value && typeof value === 'object') return toRatio(value.yRatio ?? value.top ?? value.y)
  return toRatio(value)
}

function getHorizontalPositionRatio(value) {
  if (value && typeof value === 'object') return toRatio(value.xRatio ?? value.left ?? value.x)
  return null
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

