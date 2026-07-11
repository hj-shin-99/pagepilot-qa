const FRAME_LIKE_TYPES = new Set(['FRAME', 'GROUP', 'INSTANCE', 'COMPONENT', 'COMPONENT_SET', 'SECTION', 'PAGE'])

export function extractVisibleFigmaTextNodes(rootNode) {
  const result = {
    textNodes: [],
    visibleTextCount: 0,
    totalDescendantCount: 0,
  }

  if (!rootNode || typeof rootNode !== 'object') return result

  const rootBoundingBox = getFigmaBoundingBox(rootNode)
  const rootHidden = rootNode.visible === false
  const rootAncestors = [createAncestorMeta(rootNode)]

  if (!Array.isArray(rootNode.children)) return result

  rootNode.children.forEach((child, siblingIndex) => {
    visitFigmaNode(child, {
      rootBoundingBox,
      hidden: rootHidden,
      ancestors: rootAncestors,
      depth: 1,
      siblingIndex,
    }, result)
  })

  result.visibleTextCount = result.textNodes.length
  return result
}

export function normalizeFigmaTextNode(node, context = {}) {
  const rootBoundingBox = context.rootBoundingBox || { x: null, y: null, width: null, height: null }
  const absoluteBoundingBox = getFigmaBoundingBox(node)
  const relativeBoundingBox = getRelativeBoundingBox(absoluteBoundingBox, rootBoundingBox)
  const parentFrame = getFigmaParentFrame(context.ancestors)
  const style = getFigmaStyle(node)

  return {
    id: normalizeString(node?.id),
    nodeId: normalizeString(node?.id),
    name: normalizeString(node?.name),
    type: normalizeString(node?.type),
    characters: normalizeCharacters(node?.characters),
    visible: node?.visible !== false,
    absoluteBoundingBox,
    relativeBoundingBox,
    xRatio: getRatio(relativeBoundingBox.x, rootBoundingBox.width),
    yRatio: getRatio(relativeBoundingBox.y, rootBoundingBox.height),
    widthRatio: getRatio(absoluteBoundingBox.width, rootBoundingBox.width),
    heightRatio: getRatio(absoluteBoundingBox.height, rootBoundingBox.height),
    fontSize: getStyleNumber(node, style, 'fontSize'),
    fontWeight: getStyleNumber(node, style, 'fontWeight'),
    textAlignHorizontal: getStyleString(node, style, 'textAlignHorizontal'),
    textAlignVertical: getStyleString(node, style, 'textAlignVertical'),
    lineHeight: normalizeFigmaLineHeight(node, style),
    letterSpacing: normalizeFigmaLetterSpacing(node, style),
    fills: normalizeFigmaPaints(node?.fills),
    parentFrameId: normalizeString(parentFrame?.id),
    parentFrameName: normalizeString(parentFrame?.name),
    parentType: normalizeString(parentFrame?.type),
    layerPath: getFigmaLayerPath(context.ancestors, node),
    depth: Number.isInteger(context.depth) ? context.depth : null,
    siblingIndex: Number.isInteger(context.siblingIndex) ? context.siblingIndex : null,
  }
}

export function getFigmaLayerPath(ancestors = [], node) {
  return [...ancestors, node]
    .map((item) => normalizeNodeLabel(item))
    .filter(Boolean)
    .join(' / ')
}

export function getFigmaParentFrame(ancestors = []) {
  for (let index = ancestors.length - 1; index >= 0; index -= 1) {
    const ancestor = ancestors[index]
    if (FRAME_LIKE_TYPES.has(ancestor?.type)) return ancestor
  }

  return ancestors.length > 0 ? ancestors[ancestors.length - 1] : null
}

export function normalizeFigmaPaints(fills) {
  if (!Array.isArray(fills)) return []

  return fills.map((fill) => ({
    type: normalizeString(fill?.type),
    visible: fill?.visible !== false,
    opacity: normalizeNumber(fill?.opacity),
    blendMode: normalizeString(fill?.blendMode),
    color: normalizeFigmaColor(fill?.color, fill?.opacity),
  }))
}

export function createFigmaTextPreview(textNodes, limit = 5) {
  if (!Array.isArray(textNodes)) return []
  return textNodes.slice(0, limit)
}

function visitFigmaNode(node, context, result) {
  if (!node || typeof node !== 'object') return

  result.totalDescendantCount += 1

  const hidden = context.hidden || node.visible === false
  const ancestors = [...context.ancestors, createAncestorMeta(node)]

  if (shouldIncludeVisibleFigmaTextNode(node, hidden)) {
    result.textNodes.push(normalizeFigmaTextNode(node, {
      rootBoundingBox: context.rootBoundingBox,
      ancestors: context.ancestors,
      depth: context.depth,
      siblingIndex: context.siblingIndex,
    }))
  }

  if (!Array.isArray(node.children)) return

  node.children.forEach((child, siblingIndex) => {
    visitFigmaNode(child, {
      rootBoundingBox: context.rootBoundingBox,
      hidden,
      ancestors,
      depth: context.depth + 1,
      siblingIndex,
    }, result)
  })
}

function shouldIncludeVisibleFigmaTextNode(node, hidden) {
  if (!node || node.type !== 'TEXT') return false
  if (hidden) return false

  return hasVisibleCharacters(node.characters)
}

function createAncestorMeta(node) {
  return {
    id: normalizeString(node?.id),
    name: normalizeString(node?.name),
    type: normalizeString(node?.type),
  }
}

function getFigmaBoundingBox(node) {
  const rawBox = node?.absoluteBoundingBox || {
    x: node?.x,
    y: node?.y,
    width: node?.width,
    height: node?.height,
  }

  return {
    x: normalizeNumber(rawBox?.x),
    y: normalizeNumber(rawBox?.y),
    width: normalizeNumber(rawBox?.width),
    height: normalizeNumber(rawBox?.height),
  }
}

function getRelativeBoundingBox(box, rootBoundingBox = {}) {
  return {
    x: box.x !== null && rootBoundingBox.x !== null ? roundNumber(box.x - rootBoundingBox.x) : null,
    y: box.y !== null && rootBoundingBox.y !== null ? roundNumber(box.y - rootBoundingBox.y) : null,
    width: box.width,
    height: box.height,
  }
}

function getRatio(value, total) {
  if (!Number.isFinite(value) || !Number.isFinite(total) || total === 0) return null
  return roundNumber(value / total)
}

function normalizeFigmaLineHeight(node, style) {
  const lineHeightPx = getStyleNumber(node, style, 'lineHeightPx')
  if (lineHeightPx !== null) {
    return { unit: 'PIXELS', value: lineHeightPx }
  }

  const lineHeightPercentFontSize = getStyleNumber(node, style, 'lineHeightPercentFontSize')
  if (lineHeightPercentFontSize !== null) {
    return { unit: 'PERCENT_FONT_SIZE', value: lineHeightPercentFontSize }
  }

  const lineHeightPercent = getStyleNumber(node, style, 'lineHeightPercent')
  if (lineHeightPercent !== null) {
    return { unit: 'PERCENT', value: lineHeightPercent }
  }

  return normalizeMeasurementString(node?.lineHeight, 'PIXELS')
}

function normalizeFigmaLetterSpacing(node, style) {
  const letterSpacing = getStyleNumber(node, style, 'letterSpacing')
  if (letterSpacing !== null) {
    return {
      unit: getStyleString(node, style, 'letterSpacingUnit') || 'PIXELS',
      value: letterSpacing,
    }
  }

  return normalizeMeasurementString(node?.letterSpacing, 'PIXELS')
}

function normalizeMeasurementString(value, fallbackUnit) {
  if (isMixedFigmaValue(value)) return null
  if (typeof value === 'number' && Number.isFinite(value)) {
    return { unit: fallbackUnit, value: roundNumber(value) }
  }

  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null

  const match = trimmed.match(/^(-?\d+(?:\.\d+)?)\s*(px|%)?$/i)
  if (!match) {
    return { unit: fallbackUnit, value: null }
  }

  const unit = match[2] === '%' ? 'PERCENT' : fallbackUnit
  return { unit, value: roundNumber(Number(match[1])) }
}

function getFigmaStyle(node) {
  return node?.style && typeof node.style === 'object' ? node.style : null
}

function getStyleNumber(node, style, key) {
  const styleValue = normalizeNumber(style?.[key])
  if (styleValue !== null) return styleValue
  return normalizeNumber(node?.[key])
}

function getStyleString(node, style, key) {
  const styleValue = normalizeString(style?.[key])
  if (styleValue !== null) return styleValue
  return normalizeString(node?.[key])
}

function normalizeFigmaColor(color, opacity) {
  if (!color || typeof color !== 'object') return null

  const red = normalizeChannel(color.r)
  const green = normalizeChannel(color.g)
  const blue = normalizeChannel(color.b)
  const alpha = normalizeAlpha(color.a, opacity)

  if (red === null || green === null || blue === null) return null

  return {
    r: red,
    g: green,
    b: blue,
    a: alpha,
  }
}

function normalizeChannel(value) {
  const numeric = normalizeNumber(value)
  if (numeric === null) return null
  if (numeric >= 0 && numeric <= 1) return Math.round(numeric * 255)
  if (numeric >= 0 && numeric <= 255) return Math.round(numeric)
  return null
}

function normalizeAlpha(colorAlpha, fillOpacity) {
  const alpha = normalizeNumber(colorAlpha)
  const opacity = normalizeNumber(fillOpacity)
  if (alpha !== null && opacity !== null) return roundNumber(alpha * opacity)
  if (alpha !== null) return alpha
  if (opacity !== null) return opacity
  return null
}

function normalizeCharacters(value) {
  return typeof value === 'string' ? value : ''
}

function hasVisibleCharacters(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function normalizeNodeLabel(node) {
  return normalizeString(node?.name) || normalizeString(node?.type) || 'Unnamed layer'
}

function normalizeString(value) {
  if (isMixedFigmaValue(value)) return null
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed || null
}

function normalizeNumber(value) {
  if (isMixedFigmaValue(value)) return null
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return null
  return roundNumber(numeric)
}

function isMixedFigmaValue(value) {
  return typeof value === 'string' && value.trim().toLowerCase() === 'mixed'
}

function roundNumber(value) {
  return Math.round(value * 1000000) / 1000000
}
