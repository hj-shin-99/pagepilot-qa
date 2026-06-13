/* global figma, __html__ */

var CTA_KEYWORDS = [
  'button',
  'btn',
  'cta',
  'link',
  'action',
  'submit',
  'apply',
  'contact',
  'download',
  'buy',
  'purchase',
  'reserve',
  'booking',
  'learn more',
  'read more',
  'view more',
  '더보기',
  '자세히',
  '자세히 보기',
  '신청',
  '신청하기',
  '구매',
  '구매하기',
  '상담',
  '상담하기',
  '다운로드',
  '예약',
  '예약하기',
  '문의',
  '문의하기',
  '가입',
  '가입하기',
  '시작',
  '시작하기',
  '확인',
  '바로가기',
  '알아보기',
]

var CTA_TEXT_PATTERNS = [
  /\b(button|btn|cta|link|submit|apply|contact|download|buy|purchase|reserve|booking)\b/i,
  /\b(learn|read|view|see|get|start|try|join|sign\s*up)\s+(more|now|today|free|in|up)\b/i,
  /(신청|구매|상담|예약|문의|가입|시작|확인|다운로드|바로가기|알아보기)\s*하기/,
  /자세히\s*보기|더\s*보기/,
]

var IMAGE_KEYWORDS = [
  'image',
  'img',
  'icon',
  'photo',
  'picture',
  'thumbnail',
  'avatar',
  'logo',
  '이미지',
  '사진',
  '아이콘',
  '로고',
]

var IMAGE_LIKE_TYPES = [
  'BOOLEAN_OPERATION',
  'ELLIPSE',
  'LINE',
  'POLYGON',
  'RECTANGLE',
  'SLICE',
  'STAR',
  'VECTOR',
]

var SECTION_LIKE_TYPES = [
  'COMPONENT',
  'COMPONENT_SET',
  'FRAME',
  'GROUP',
  'INSTANCE',
  'SECTION',
]

figma.showUI(__html__, { width: 520, height: 640, themeColors: true })

figma.ui.onmessage = function (message) {
  if (!message || message.type !== 'export-json') {
    return
  }

  var exportResult = createPagePilotExport()
  figma.ui.postMessage({ type: 'export-result', payload: exportResult })

  if (exportResult.ok) {
    figma.notify('PagePilot QA JSON exported: ' + exportResult.data.summary.textCount + ' text nodes')
  } else {
    figma.notify(exportResult.error, { error: true })
  }
}

function createPagePilotExport() {
  var selection = filterExportableRoots(figma.currentPage.selection)

  if (selection.length === 0) {
    return {
      ok: false,
      error: '프레임, 섹션, 컴포넌트, 인스턴스, 그룹 중 하나를 선택한 뒤 Export JSON을 눌러주세요.',
    }
  }

  var context = {
    textNodes: [],
    ctaCandidates: [],
    imageCandidates: [],
    sections: [],
  }

  var selectedNodes = []
  for (var selectionIndex = 0; selectionIndex < selection.length; selectionIndex += 1) {
    var selectedRoot = selection[selectionIndex]
    var rootBox = getAbsoluteBoundingBox(selectedRoot)
    selectedNodes.push(serializeNode(selectedRoot, context, {
      rootBox: rootBox,
      path: [],
      depth: 0,
      section: null,
      buttonContainer: null,
    }))
  }

  sortExportCollections(context)

  return {
    ok: true,
    data: {
      schema: 'pagepilot-qa.design-export.v1',
      source: {
        tool: 'figma-plugin',
        plugin: 'PagePilot QA Design Export',
        localOnly: true,
        network: 'disabled',
        exportedAt: new Date().toISOString(),
        page: {
          id: figma.currentPage.id,
          name: figma.currentPage.name,
        },
        selectionCount: selection.length,
      },
      summary: {
        selectedRootCount: selection.length,
        textCount: context.textNodes.length,
        ctaCandidateCount: context.ctaCandidates.length,
        imageCandidateCount: context.imageCandidates.length,
        sectionCount: context.sections.length,
      },
      document: {
        id: figma.currentPage.id,
        name: figma.currentPage.name,
        type: 'PAGE',
        children: selectedNodes,
      },
      textNodes: context.textNodes,
      ctaCandidates: context.ctaCandidates,
      imageCandidates: context.imageCandidates,
      sections: context.sections,
    },
  }
}

function filterExportableRoots(nodes) {
  var results = []
  if (!Array.isArray(nodes)) {
    return results
  }

  for (var nodeIndex = 0; nodeIndex < nodes.length; nodeIndex += 1) {
    if (isExportableRoot(nodes[nodeIndex])) {
      results.push(nodes[nodeIndex])
    }
  }

  return results
}

function isExportableRoot(node) {
  return Boolean(node && 'children' in node)
}

function serializeNode(node, context, traversal) {
  var currentPath = traversal.path.slice(0)
  currentPath.push(node.name || '')
  var currentTraversal = {
    rootBox: traversal.rootBox,
    path: currentPath,
    depth: traversal.depth,
    section: traversal.section,
    buttonContainer: traversal.buttonContainer,
  }
  var baseNode = createBaseNode(node, currentTraversal)
  var currentSection = currentTraversal.section

  if ((currentTraversal.depth === 1 && isSectionCandidate(node)) || isSelectedSectionRoot(node, currentTraversal)) {
    currentSection = createSection(node, baseNode)
    context.sections.push(currentSection)
    currentTraversal.section = currentSection
  }

  if (node.type === 'TEXT') {
    var textNode = createTextNode(node, baseNode)
    var shouldExportText = isExportableTextNode(textNode)

    if (shouldExportText) {
      context.textNodes.push(textNode)
      addToSection(currentSection, 'texts', textNode)
    }

    if (shouldExportText && (isCtaCandidate(node, textNode.text) || currentTraversal.buttonContainer)) {
      var textMatchesCta = isCtaCandidate(node, textNode.text)
      var ctaKind = textMatchesCta ? 'TEXT_CTA' : 'BUTTON_TEXT_CTA'
      var ctaCandidate = createCandidate(ctaKind, node, textNode.text, currentTraversal)
      if (currentTraversal.buttonContainer) {
        addUniqueMatch(ctaCandidate.matchedBy, 'button-container')
      }
      context.ctaCandidates.push(ctaCandidate)
      addToSection(currentSection, 'ctas', ctaCandidate)
    }

    return textNode
  }

  if (isCtaCandidate(node, '')) {
    var nodeCtaCandidate = createCandidate('NODE_CTA', node, '', currentTraversal)
    context.ctaCandidates.push(nodeCtaCandidate)
    addToSection(currentSection, 'ctas', nodeCtaCandidate)
  }

  if (isImageCandidate(node)) {
    var imageCandidate = createImageCandidate(node, currentTraversal)
    context.imageCandidates.push(imageCandidate)
    addToSection(currentSection, 'images', imageCandidate)
  }

  if (isButtonLikeContainer(node)) {
    currentTraversal.buttonContainer = node
  }

  if ('children' in node && Array.isArray(node.children)) {
    baseNode.children = []
    for (var childIndex = 0; childIndex < node.children.length; childIndex += 1) {
      baseNode.children.push(serializeNode(node.children[childIndex], context, {
        rootBox: currentTraversal.rootBox,
        path: currentPath,
        depth: currentTraversal.depth + 1,
        section: currentSection,
        buttonContainer: currentTraversal.buttonContainer,
      }))
    }
  }

  return baseNode
}

function createBaseNode(node, traversal) {
  var box = getAbsoluteBoundingBox(node)

  return {
    id: node.id,
    name: node.name || '',
    type: node.type,
    visible: node.visible !== false,
    opacity: roundNumber(readNumber(node.opacity, 1)),
    x: box.x,
    y: box.y,
    width: box.width,
    height: box.height,
    absoluteBoundingBox: box,
    layerPath: traversal.path.slice(0),
    positionRatio: createPositionRatio(box, traversal.rootBox),
  }
}

function createTextNode(node, baseNode) {
  var textStyle = createTextStyle(node)
  var fills = serializeFills(node.fills)
  var textNode = copyBaseNode(baseNode)

  textNode.tag = 'TEXT'
  textNode.text = node.characters || ''
  textNode.characters = node.characters || ''
  textNode.normalizedText = normalizeText(textNode.text)
  textNode.fontFamily = textStyle.fontFamily
  textNode.fontStyle = textStyle.fontStyle
  textNode.fontSize = textStyle.fontSize
  textNode.fontWeight = textStyle.fontWeight
  textNode.lineHeight = textStyle.lineHeight
  textNode.letterSpacing = textStyle.letterSpacing
  textNode.color = getPaintColor(node.fills)
  textNode.fills = fills
  textNode.style = {
    fontFamily: textStyle.fontFamily,
    fontStyle: textStyle.fontStyle,
    fontSize: textStyle.fontSize,
    fontWeight: textStyle.fontWeight,
    lineHeightPx: textStyle.lineHeightPx,
    lineHeightPercentFontSize: textStyle.lineHeightPercentFontSize,
    lineHeightPercent: textStyle.lineHeightPercent,
    letterSpacing: textStyle.letterSpacing,
  }

  return textNode
}

function copyBaseNode(baseNode) {
  var copiedNode = {}
  for (var key in baseNode) {
    if (Object.prototype.hasOwnProperty.call(baseNode, key)) {
      copiedNode[key] = baseNode[key]
    }
  }

  return copiedNode
}

function createTextStyle(node) {
  var fontName = readFontName(node.fontName)
  var lineHeight = readLineHeight(node.lineHeight)
  var letterSpacing = readLetterSpacing(node.letterSpacing)

  return {
    fontFamily: fontName.family,
    fontStyle: fontName.style,
    fontSize: readMixedNumber(node.fontSize),
    fontWeight: inferFontWeight(fontName.style),
    lineHeight: lineHeight.display,
    lineHeightPx: lineHeight.px,
    lineHeightPercentFontSize: lineHeight.percentFontSize,
    lineHeightPercent: lineHeight.percent,
    letterSpacing: letterSpacing,
  }
}

function createCandidate(kind, node, text, traversal) {
  var box = getAbsoluteBoundingBox(node)
  var candidateText = text || ''

  return {
    kind: kind,
    id: node.id,
    name: node.name || '',
    type: node.type,
    text: candidateText,
    normalizedText: normalizeText(candidateText || node.name || ''),
    matchedBy: getMatchedKeywords((node.name || '') + ' ' + candidateText, CTA_KEYWORDS),
    x: box.x,
    y: box.y,
    width: box.width,
    height: box.height,
    layerPath: traversal.path.slice(0),
    positionRatio: createPositionRatio(box, traversal.rootBox),
  }
}

function createImageCandidate(node, traversal) {
  var box = getAbsoluteBoundingBox(node)

  return {
    kind: hasImageFill(node) ? 'IMAGE_FILL' : 'ICON_OR_GRAPHIC',
    id: node.id,
    name: node.name || '',
    type: node.type,
    matchedBy: getMatchedKeywords(node.name || '', IMAGE_KEYWORDS),
    fills: serializeFills(node.fills),
    x: box.x,
    y: box.y,
    width: box.width,
    height: box.height,
    layerPath: traversal.path.slice(0),
    positionRatio: createPositionRatio(box, traversal.rootBox),
  }
}

function createSection(node, baseNode) {
  return {
    id: node.id,
    name: node.name || '',
    type: node.type,
    x: baseNode.x,
    y: baseNode.y,
    width: baseNode.width,
    height: baseNode.height,
    order: 0,
    layerPath: baseNode.layerPath.slice(0),
    positionRatio: copyPositionRatio(baseNode.positionRatio),
    texts: [],
    ctas: [],
    images: [],
  }
}

function createPositionRatio(box, rootBox) {
  var rootWidth = readNumber(rootBox.width, 0)
  var rootHeight = readNumber(rootBox.height, 0)
  var xRatio = 0
  var yRatio = 0
  var widthRatio = 0
  var heightRatio = 0

  if (rootWidth > 0) {
    xRatio = (box.x - rootBox.x) / rootWidth
    widthRatio = box.width / rootWidth
  }

  if (rootHeight > 0) {
    yRatio = (box.y - rootBox.y) / rootHeight
    heightRatio = box.height / rootHeight
  }

  return {
    xRatio: roundRatio(xRatio),
    yRatio: roundRatio(yRatio),
    widthRatio: roundRatio(widthRatio),
    heightRatio: roundRatio(heightRatio),
  }
}

function copyPositionRatio(positionRatio) {
  return {
    xRatio: positionRatio.xRatio,
    yRatio: positionRatio.yRatio,
    widthRatio: positionRatio.widthRatio,
    heightRatio: positionRatio.heightRatio,
  }
}

function addToSection(section, key, item) {
  if (!section || !Array.isArray(section[key])) {
    return
  }

  section[key].push(item)
}

function sortExportCollections(context) {
  sortByPosition(context.textNodes)
  sortByPosition(context.ctaCandidates)
  sortByPosition(context.imageCandidates)
  sortByPosition(context.sections)

  for (var sectionIndex = 0; sectionIndex < context.sections.length; sectionIndex += 1) {
    var section = context.sections[sectionIndex]
    section.order = sectionIndex + 1
    sortByPosition(section.texts)
    sortByPosition(section.ctas)
    sortByPosition(section.images)
  }
}

function sortByPosition(items) {
  items.sort(function (left, right) {
    if (left.y !== right.y) return left.y - right.y
    if (left.x !== right.x) return left.x - right.x
    return String(left.id || '').localeCompare(String(right.id || ''))
  })
}

function isSectionCandidate(node) {
  return isTypeInList(node.type, SECTION_LIKE_TYPES)
}

function isSelectedSectionRoot(node, traversal) {
  return traversal.depth === 0 && node.type === 'SECTION'
}

function isButtonLikeContainer(node) {
  var box = getAbsoluteBoundingBox(node)
  if (!isContainerNode(node) || box.width < 24 || box.height < 12) {
    return false
  }

  if (box.width > 360 || box.height > 80 || box.width / box.height < 1.2) {
    return false
  }

  return hasVisibleFill(node)
}

function isContainerNode(node) {
  return node && (node.type === 'FRAME' || node.type === 'GROUP' || node.type === 'INSTANCE' || node.type === 'COMPONENT')
}

function hasVisibleFill(node) {
  if (!Array.isArray(node.fills)) {
    return false
  }

  for (var fillIndex = 0; fillIndex < node.fills.length; fillIndex += 1) {
    var paint = node.fills[fillIndex]
    if (paint && paint.visible !== false && paint.type !== 'IMAGE') {
      return true
    }
  }

  return false
}

function isExportableTextNode(textNode) {
  if (!textNode || textNode.normalizedText === '') {
    return false
  }

  if (textNode.width < 2 || textNode.height < 2) {
    return false
  }

  if (isDecorativeTextNode(textNode)) {
    return false
  }

  return true
}

function isDecorativeTextNode(textNode) {
  var normalizedText = textNode.normalizedText || ''
  var rawText = textNode.text || textNode.characters || ''
  var fontSize = readNumber(textNode.fontSize, 0)

  if (!hasMeaningfulTextCharacter(normalizedText)) {
    return normalizedText.length <= 3
  }

  if (isCtaCandidate(textNode, rawText)) {
    return false
  }

  if (normalizedText.length <= 1 && fontSize > 0 && fontSize <= 10) {
    return true
  }

  if (normalizedText.length <= 2 && fontSize > 0 && fontSize <= 8 && textNode.width <= 16 && textNode.height <= 16) {
    return true
  }

  return false
}

function hasMeaningfulTextCharacter(value) {
  return /[A-Za-z0-9가-힣]/.test(value)
}

function normalizeText(value) {
  var text = String(value || '')
  if (text.normalize) {
    text = text.normalize('NFKC')
  }

  return text
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/[\u00A0\u1680\u180E\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]/g, ' ')
    .replace(/[.,，。ㆍ·:：;；!！?？"'“”‘’`´\-‐‑‒–—―_/\\()[\]{}<>《》]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^\s+|\s+$/g, '')
    .replace(/[A-Z]/g, function (letter) { return letter.toLowerCase() })
}

function addUniqueMatch(matches, match) {
  for (var matchIndex = 0; matchIndex < matches.length; matchIndex += 1) {
    if (matches[matchIndex] === match) {
      return
    }
  }

  matches.push(match)
}

function isCtaCandidate(node, text) {
  var searchableText = (node.name || '') + ' ' + (text || '')
  if (getMatchedKeywords(searchableText, CTA_KEYWORDS).length > 0) {
    return true
  }

  return matchesAnyPattern(searchableText, CTA_TEXT_PATTERNS)
}

function matchesAnyPattern(value, patterns) {
  var text = String(value || '')
  for (var patternIndex = 0; patternIndex < patterns.length; patternIndex += 1) {
    if (patterns[patternIndex].test(text)) {
      return true
    }
  }

  return false
}

function isImageCandidate(node) {
  return hasImageFill(node) || isImageLikeType(node.type) || getMatchedKeywords(node.name || '', IMAGE_KEYWORDS).length > 0
}

function isImageLikeType(type) {
  return isTypeInList(type, IMAGE_LIKE_TYPES)
}

function isTypeInList(type, types) {
  for (var typeIndex = 0; typeIndex < types.length; typeIndex += 1) {
    if (types[typeIndex] === type) {
      return true
    }
  }

  return false
}

function hasImageFill(node) {
  if (!Array.isArray(node.fills)) {
    return false
  }

  for (var fillIndex = 0; fillIndex < node.fills.length; fillIndex += 1) {
    var paint = node.fills[fillIndex]
    if (paint && paint.type === 'IMAGE' && paint.visible !== false) {
      return true
    }
  }

  return false
}

function getMatchedKeywords(value, keywords) {
  var normalized = normalizeText(value)
  var matches = []

  for (var keywordIndex = 0; keywordIndex < keywords.length; keywordIndex += 1) {
    var keyword = keywords[keywordIndex]
    if (normalized.indexOf(keyword.toLowerCase()) !== -1) {
      matches.push(keyword)
    }
  }

  return matches
}

function readFontName(fontName) {
  if (!fontName || fontName === figma.mixed) return { family: 'mixed', style: 'mixed' }
  return {
    family: fontName.family || '',
    style: fontName.style || '',
  }
}

function inferFontWeight(fontStyle) {
  var style = String(fontStyle || '').toLowerCase()
  if (style.indexOf('thin') !== -1) return 100
  if (style.indexOf('extra light') !== -1 || style.indexOf('extralight') !== -1 || style.indexOf('ultra light') !== -1) return 200
  if (style.indexOf('light') !== -1) return 300
  if (style.indexOf('medium') !== -1) return 500
  if (style.indexOf('semi bold') !== -1 || style.indexOf('semibold') !== -1 || style.indexOf('demi bold') !== -1) return 600
  if (style.indexOf('extra bold') !== -1 || style.indexOf('extrabold') !== -1 || style.indexOf('ultra bold') !== -1) return 800
  if (style.indexOf('black') !== -1 || style.indexOf('heavy') !== -1) return 900
  if (style.indexOf('bold') !== -1) return 700
  if (style.indexOf('regular') !== -1 || style.indexOf('normal') !== -1 || style.indexOf('book') !== -1) return 400
  return ''
}

function readLineHeight(lineHeight) {
  if (!lineHeight || lineHeight === figma.mixed) {
    return { display: 'mixed', px: '', percentFontSize: '', percent: '' }
  }

  if (lineHeight.unit === 'AUTO') {
    return { display: 'AUTO', px: '', percentFontSize: '', percent: '' }
  }

  var value = readNumber(lineHeight.value, '')
  if (lineHeight.unit === 'PIXELS') {
    return { display: value + 'px', px: value, percentFontSize: '', percent: '' }
  }

  if (lineHeight.unit === 'PERCENT') {
    return { display: value + '%', px: '', percentFontSize: value, percent: value }
  }

  return { display: value, px: '', percentFontSize: '', percent: '' }
}

function readLetterSpacing(letterSpacing) {
  if (!letterSpacing || letterSpacing === figma.mixed) return 'mixed'
  var value = readNumber(letterSpacing.value, '')
  if (value === '') return ''
  return letterSpacing.unit === 'PERCENT' ? value + '%' : value + 'px'
}

function serializeFills(fills) {
  if (!Array.isArray(fills)) return []

  var serializedFills = []

  for (var fillIndex = 0; fillIndex < fills.length; fillIndex += 1) {
    var paint = fills[fillIndex]
    if (!paint) {
      continue
    }

    var serialized = {
      type: paint.type,
      visible: paint.visible !== false,
      opacity: roundNumber(readNumber(paint.opacity, 1)),
    }

    if (paint.type === 'SOLID' && paint.color) {
      serialized.color = getRgbColor(paint.color, serialized.opacity)
    }

    if (paint.type === 'IMAGE') {
      serialized.scaleMode = paint.scaleMode || ''
      serialized.imageHash = paint.imageHash || ''
    }

    serializedFills.push(serialized)
  }

  return serializedFills
}

function getPaintColor(fills) {
  if (!Array.isArray(fills)) return ''

  for (var fillIndex = 0; fillIndex < fills.length; fillIndex += 1) {
    var solidFill = fills[fillIndex]
    if (solidFill && solidFill.type === 'SOLID' && solidFill.visible !== false && solidFill.color) {
      return getRgbColor(solidFill.color, readNumber(solidFill.opacity, 1))
    }
  }

  return ''
}

function getRgbColor(color, opacity) {
  var red = toRgbChannel(color.r)
  var green = toRgbChannel(color.g)
  var blue = toRgbChannel(color.b)
  var alphaSource = opacity !== null && opacity !== undefined ? opacity : color.a
  var alpha = readNumber(alphaSource, 1)

  if (alpha < 1) return 'rgba(' + red + ', ' + green + ', ' + blue + ', ' + roundNumber(alpha) + ')'
  return '#' + toHex(red) + toHex(green) + toHex(blue)
}

function getAbsoluteBoundingBox(node) {
  var box = node.absoluteBoundingBox || {}

  return {
    x: roundNumber(readNumber(box.x, 0)),
    y: roundNumber(readNumber(box.y, 0)),
    width: roundNumber(readNumber(box.width, 0)),
    height: roundNumber(readNumber(box.height, 0)),
  }
}

function readMixedNumber(value) {
  if (value === figma.mixed) return 'mixed'
  return readNumber(value, '')
}

function readNumber(value, fallback) {
  var number = Number(value)
  return typeof number === 'number' && isFinite(number) ? roundNumber(number) : fallback
}

function toRgbChannel(value) {
  return Math.round(Math.max(0, Math.min(1, Number(value) || 0)) * 255)
}

function toHex(value) {
  var hex = Math.max(0, Math.min(255, Number(value) || 0)).toString(16)
  return hex.length === 1 ? '0' + hex : hex
}

function roundNumber(value) {
  return Math.round(value * 100) / 100
}

function roundRatio(value) {
  return Math.round(value * 10000) / 10000
}
