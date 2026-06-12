/* global figma, __html__ */

var CTA_KEYWORDS = [
  'button',
  'btn',
  'cta',
  'link',
  '더보기',
  '자세히',
  '신청',
  '구매',
  '상담',
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
  }

  var selectedNodes = []
  for (var selectionIndex = 0; selectionIndex < selection.length; selectionIndex += 1) {
    selectedNodes.push(serializeNode(selection[selectionIndex], context))
  }

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

function serializeNode(node, context) {
  var baseNode = createBaseNode(node)

  if (node.type === 'TEXT') {
    var textNode = createTextNode(node, baseNode)
    context.textNodes.push(textNode)

    if (isCtaCandidate(node, textNode.text)) {
      context.ctaCandidates.push(createCandidate('TEXT_CTA', node, textNode.text))
    }

    return textNode
  }

  if (isCtaCandidate(node, '')) {
    context.ctaCandidates.push(createCandidate('NODE_CTA', node, ''))
  }

  if (isImageCandidate(node)) {
    context.imageCandidates.push(createImageCandidate(node))
  }

  if ('children' in node && Array.isArray(node.children)) {
    baseNode.children = []
    for (var childIndex = 0; childIndex < node.children.length; childIndex += 1) {
      baseNode.children.push(serializeNode(node.children[childIndex], context))
    }
  }

  return baseNode
}

function createBaseNode(node) {
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
  }
}

function createTextNode(node, baseNode) {
  var textStyle = createTextStyle(node)
  var fills = serializeFills(node.fills)
  var textNode = copyBaseNode(baseNode)

  textNode.tag = 'TEXT'
  textNode.text = node.characters || ''
  textNode.characters = node.characters || ''
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

function createCandidate(kind, node, text) {
  var box = getAbsoluteBoundingBox(node)

  return {
    kind: kind,
    id: node.id,
    name: node.name || '',
    type: node.type,
    text: text || '',
    matchedBy: getMatchedKeywords((node.name || '') + ' ' + (text || ''), CTA_KEYWORDS),
    x: box.x,
    y: box.y,
    width: box.width,
    height: box.height,
  }
}

function createImageCandidate(node) {
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
  }
}

function isCtaCandidate(node, text) {
  return getMatchedKeywords((node.name || '') + ' ' + (text || ''), CTA_KEYWORDS).length > 0
}

function isImageCandidate(node) {
  return hasImageFill(node) || isImageLikeType(node.type) || getMatchedKeywords(node.name || '', IMAGE_KEYWORDS).length > 0
}

function isImageLikeType(type) {
  for (var typeIndex = 0; typeIndex < IMAGE_LIKE_TYPES.length; typeIndex += 1) {
    if (IMAGE_LIKE_TYPES[typeIndex] === type) {
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
  var normalized = String(value || '').toLowerCase()
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
