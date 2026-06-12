/* global figma, __html__ */

const CTA_KEYWORDS = [
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

const IMAGE_KEYWORDS = [
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

const IMAGE_LIKE_TYPES = new Set([
  'BOOLEAN_OPERATION',
  'ELLIPSE',
  'LINE',
  'POLYGON',
  'RECTANGLE',
  'SLICE',
  'STAR',
  'VECTOR',
])

figma.showUI(__html__, { width: 520, height: 640, themeColors: true })

figma.ui.onmessage = (message) => {
  if (!message || message.type !== 'export-json') return

  const exportResult = createPagePilotExport()
  figma.ui.postMessage({ type: 'export-result', payload: exportResult })

  if (exportResult.ok) {
    figma.notify(`PagePilot QA JSON exported: ${exportResult.data.summary.textCount} text nodes`)
  } else {
    figma.notify(exportResult.error, { error: true })
  }
}

function createPagePilotExport() {
  const selection = figma.currentPage.selection.filter(isExportableRoot)

  if (selection.length === 0) {
    return {
      ok: false,
      error: '프레임, 섹션, 컴포넌트, 인스턴스, 그룹 중 하나를 선택한 뒤 Export JSON을 눌러주세요.',
    }
  }

  const context = {
    textNodes: [],
    ctaCandidates: [],
    imageCandidates: [],
  }

  const selectedNodes = selection.map((node) => serializeNode(node, context))

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

function isExportableRoot(node) {
  return Boolean(node && 'children' in node)
}

function serializeNode(node, context) {
  const baseNode = createBaseNode(node)

  if (node.type === 'TEXT') {
    const textNode = createTextNode(node, baseNode)
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
    baseNode.children = node.children.map((child) => serializeNode(child, context))
  }

  return baseNode
}

function createBaseNode(node) {
  const box = getAbsoluteBoundingBox(node)

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
  const textStyle = createTextStyle(node)
  const fills = serializeFills(node.fills)

  return {
    ...baseNode,
    tag: 'TEXT',
    text: node.characters || '',
    characters: node.characters || '',
    fontFamily: textStyle.fontFamily,
    fontStyle: textStyle.fontStyle,
    fontSize: textStyle.fontSize,
    fontWeight: textStyle.fontWeight,
    lineHeight: textStyle.lineHeight,
    letterSpacing: textStyle.letterSpacing,
    color: getPaintColor(node.fills),
    fills,
    style: {
      fontFamily: textStyle.fontFamily,
      fontStyle: textStyle.fontStyle,
      fontSize: textStyle.fontSize,
      fontWeight: textStyle.fontWeight,
      lineHeightPx: textStyle.lineHeightPx,
      lineHeightPercentFontSize: textStyle.lineHeightPercentFontSize,
      lineHeightPercent: textStyle.lineHeightPercent,
      letterSpacing: textStyle.letterSpacing,
    },
  }
}

function createTextStyle(node) {
  const fontName = readFontName(node.fontName)
  const lineHeight = readLineHeight(node.lineHeight)
  const letterSpacing = readLetterSpacing(node.letterSpacing)

  return {
    fontFamily: fontName.family,
    fontStyle: fontName.style,
    fontSize: readMixedNumber(node.fontSize),
    fontWeight: inferFontWeight(fontName.style),
    lineHeight: lineHeight.display,
    lineHeightPx: lineHeight.px,
    lineHeightPercentFontSize: lineHeight.percentFontSize,
    lineHeightPercent: lineHeight.percent,
    letterSpacing,
  }
}

function createCandidate(kind, node, text) {
  const box = getAbsoluteBoundingBox(node)

  return {
    kind,
    id: node.id,
    name: node.name || '',
    type: node.type,
    text: text || '',
    matchedBy: getMatchedKeywords(`${node.name || ''} ${text || ''}`, CTA_KEYWORDS),
    x: box.x,
    y: box.y,
    width: box.width,
    height: box.height,
  }
}

function createImageCandidate(node) {
  const box = getAbsoluteBoundingBox(node)

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
  return getMatchedKeywords(`${node.name || ''} ${text || ''}`, CTA_KEYWORDS).length > 0
}

function isImageCandidate(node) {
  return hasImageFill(node) || IMAGE_LIKE_TYPES.has(node.type) || getMatchedKeywords(node.name || '', IMAGE_KEYWORDS).length > 0
}

function hasImageFill(node) {
  return Array.isArray(node.fills) && node.fills.some((paint) => paint && paint.type === 'IMAGE' && paint.visible !== false)
}

function getMatchedKeywords(value, keywords) {
  const normalized = String(value || '').toLowerCase()
  return keywords.filter((keyword) => normalized.includes(keyword.toLowerCase()))
}

function readFontName(fontName) {
  if (!fontName || fontName === figma.mixed) return { family: 'mixed', style: 'mixed' }
  return {
    family: fontName.family || '',
    style: fontName.style || '',
  }
}

function inferFontWeight(fontStyle) {
  const style = String(fontStyle || '').toLowerCase()
  if (style.includes('thin')) return 100
  if (style.includes('extra light') || style.includes('extralight') || style.includes('ultra light')) return 200
  if (style.includes('light')) return 300
  if (style.includes('medium')) return 500
  if (style.includes('semi bold') || style.includes('semibold') || style.includes('demi bold')) return 600
  if (style.includes('extra bold') || style.includes('extrabold') || style.includes('ultra bold')) return 800
  if (style.includes('black') || style.includes('heavy')) return 900
  if (style.includes('bold')) return 700
  if (style.includes('regular') || style.includes('normal') || style.includes('book')) return 400
  return ''
}

function readLineHeight(lineHeight) {
  if (!lineHeight || lineHeight === figma.mixed) {
    return { display: 'mixed', px: '', percentFontSize: '', percent: '' }
  }

  if (lineHeight.unit === 'AUTO') {
    return { display: 'AUTO', px: '', percentFontSize: '', percent: '' }
  }

  const value = readNumber(lineHeight.value, '')
  if (lineHeight.unit === 'PIXELS') {
    return { display: `${value}px`, px: value, percentFontSize: '', percent: '' }
  }

  if (lineHeight.unit === 'PERCENT') {
    return { display: `${value}%`, px: '', percentFontSize: value, percent: value }
  }

  return { display: value, px: '', percentFontSize: '', percent: '' }
}

function readLetterSpacing(letterSpacing) {
  if (!letterSpacing || letterSpacing === figma.mixed) return 'mixed'
  const value = readNumber(letterSpacing.value, '')
  if (value === '') return ''
  return letterSpacing.unit === 'PERCENT' ? `${value}%` : `${value}px`
}

function serializeFills(fills) {
  if (!Array.isArray(fills)) return []

  return fills.map((paint) => {
    if (!paint) return null

    const serialized = {
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

    return serialized
  }).filter(Boolean)
}

function getPaintColor(fills) {
  if (!Array.isArray(fills)) return ''

  const solidFill = fills.find((paint) => paint && paint.type === 'SOLID' && paint.visible !== false && paint.color)
  if (!solidFill) return ''

  return getRgbColor(solidFill.color, readNumber(solidFill.opacity, 1))
}

function getRgbColor(color, opacity) {
  const red = toRgbChannel(color.r)
  const green = toRgbChannel(color.g)
  const blue = toRgbChannel(color.b)
  const alpha = readNumber(opacity ?? color.a, 1)

  if (alpha < 1) return `rgba(${red}, ${green}, ${blue}, ${roundNumber(alpha)})`
  return `#${toHex(red)}${toHex(green)}${toHex(blue)}`
}

function getAbsoluteBoundingBox(node) {
  const box = node.absoluteBoundingBox || {}

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
  const number = Number(value)
  return Number.isFinite(number) ? roundNumber(number) : fallback
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
