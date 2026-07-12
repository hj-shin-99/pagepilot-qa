const CONTAINER_TYPES = new Set(['DOCUMENT', 'CANVAS', 'FRAME', 'GROUP', 'SECTION', 'INSTANCE', 'COMPONENT', 'COMPONENT_SET'])
const GRADIENT_TYPES = new Set(['GRADIENT_LINEAR', 'GRADIENT_RADIAL', 'GRADIENT_ANGULAR', 'GRADIENT_DIAMOND'])

export function extractFigmaStructure(rootNode) {
  if (!rootNode || typeof rootNode !== 'object') {
    return {
      figmaStructure: null,
      figmaFlatNodes: [],
      structureSummary: createEmptyStructureSummary(),
      structurePreview: [],
    }
  }

  const rootBoundingBox = getFigmaBoundingBox(rootNode)
  const figmaStructure = createFigmaStructureTree(rootNode, {
    rootBoundingBox,
    parent: null,
    ancestors: [],
    ancestorHidden: false,
    depth: 0,
    siblingIndex: 0,
  })
  const figmaFlatNodes = flattenFigmaStructure(figmaStructure)
  const structureSummary = createFigmaStructureSummary(figmaFlatNodes)
  const structurePreview = createFigmaStructurePreview(figmaFlatNodes)

  return {
    figmaStructure,
    figmaFlatNodes,
    structureSummary,
    structurePreview,
  }
}

export function createFigmaStructureTree(rootNode, context = {}) {
  if (!rootNode || typeof rootNode !== 'object') return null

  const normalizedNode = normalizeFigmaNode(rootNode, context)
  const rawChildren = Array.isArray(rootNode.children) ? rootNode.children : []
  const children = rawChildren
    .map((child, siblingIndex) => createFigmaStructureTree(child, {
      rootBoundingBox: context.rootBoundingBox || getFigmaBoundingBox(rootNode),
      parent: pickParentMeta(normalizedNode),
      ancestors: [...(context.ancestors || []), pickParentMeta(normalizedNode)],
      ancestorHidden: normalizedNode.ancestorHidden || normalizedNode.selfHidden,
      depth: (normalizedNode.depth ?? 0) + 1,
      siblingIndex,
    }))
    .filter(Boolean)

  const childIds = children.map((child) => child.id).filter(Boolean)
  const childCount = children.length
  const isContainer = childCount > 0 || CONTAINER_TYPES.has(normalizedNode.type)
  const isVisibleLeaf = normalizedNode.effectivelyVisible && childCount === 0 && hasMeaningfulLeafContent(normalizedNode)

  return {
    ...normalizedNode,
    childIds,
    childCount,
    isContainer,
    isVisibleLeaf,
    children,
  }
}

export function flattenFigmaStructure(tree) {
  const flatNodes = []

  visitFigmaStructure(tree, (node) => {
    const flatNode = { ...node }
    delete flatNode.children
    flatNodes.push(flatNode)
  })

  return flatNodes
}

export function normalizeFigmaNode(node, context = {}) {
  const rootBoundingBox = context.rootBoundingBox || getFigmaBoundingBox(node)
  const parent = context.parent || null
  const ancestors = Array.isArray(context.ancestors) ? context.ancestors : []
  const absoluteBoundingBox = getFigmaBoundingBox(node)
  const relativeBoundingBox = getRelativeBoundingBox(absoluteBoundingBox, rootBoundingBox)
  const paints = getFigmaMediaSummary(node)
  const interactionSummary = createFigmaInteractionSummary(node)
  const selfHidden = node?.visible === false
  const ancestorHidden = Boolean(context.ancestorHidden)
  const effectivelyVisible = !selfHidden && !ancestorHidden
  const textProperties = normalizeFigmaTextProperties(node)
  const childIds = Array.isArray(node?.children) ? node.children.map((child) => normalizeString(child?.id)).filter(Boolean) : []

  return {
    id: normalizeString(node?.id),
    nodeId: normalizeString(node?.id),
    name: normalizeString(node?.name),
    type: normalizeString(node?.type) || 'GENERIC_NODE',
    visible: node?.visible !== false,
    opacity: normalizeNumber(node?.opacity),
    blendMode: normalizeString(node?.blendMode),
    locked: node?.locked === true,
    parentId: normalizeString(parent?.id),
    parentName: normalizeString(parent?.name),
    parentType: normalizeString(parent?.type),
    childIds,
    childCount: childIds.length,
    siblingIndex: Number.isInteger(context.siblingIndex) ? context.siblingIndex : 0,
    depth: Number.isInteger(context.depth) ? context.depth : 0,
    layerPath: getFigmaLayerPath(ancestors, node),
    absoluteBoundingBox,
    relativeBoundingBox,
    xRatio: getRatio(relativeBoundingBox.x, rootBoundingBox.width),
    yRatio: getRatio(relativeBoundingBox.y, rootBoundingBox.height),
    widthRatio: getRatio(absoluteBoundingBox.width, rootBoundingBox.width),
    heightRatio: getRatio(absoluteBoundingBox.height, rootBoundingBox.height),
    clipsContent: node?.clipsContent === true,
    layoutMode: normalizeString(node?.layoutMode),
    primaryAxisAlignItems: normalizeString(node?.primaryAxisAlignItems),
    counterAxisAlignItems: normalizeString(node?.counterAxisAlignItems),
    itemSpacing: normalizeNumber(node?.itemSpacing),
    paddingLeft: normalizeNumber(node?.paddingLeft),
    paddingRight: normalizeNumber(node?.paddingRight),
    paddingTop: normalizeNumber(node?.paddingTop),
    paddingBottom: normalizeNumber(node?.paddingBottom),
    fills: normalizeFigmaPaints(node?.fills),
    strokes: normalizeFigmaPaints(node?.strokes),
    strokeWeight: normalizeNumber(node?.strokeWeight),
    cornerRadius: normalizeNumber(node?.cornerRadius),
    effects: normalizeFigmaEffects(node?.effects),
    textSummary: createFigmaTextSummary(node, textProperties),
    hasImageFill: paints.hasImageFill,
    imageFillCount: paints.imageFillCount,
    imageRefs: paints.imageRefs,
    imageScaleModes: paints.imageScaleModes,
    hasGradientFill: paints.hasGradientFill,
    hasSolidFill: paints.hasSolidFill,
    hasVideoLikeContent: detectVideoLikeContent(node),
    isInteractiveCandidate: isInteractiveFigmaNode(node),
    interactionSummary,
    prototypeInteractionCount: interactionSummary.prototypeInteractionCount,
    reactionCount: interactionSummary.reactionCount,
    hasPrototypeInteractions: interactionSummary.prototypeInteractionCount > 0,
    hasReactions: interactionSummary.reactionCount > 0,
    hasTransitionTarget: interactionSummary.hasTransitionTarget,
    transitionNodeId: interactionSummary.transitionNodeId,
    hasComponentPropertyReferences: interactionSummary.hasComponentPropertyReferences,
    componentPropertyReferenceCount: interactionSummary.componentPropertyReferenceCount,
    hasComponentProperties: interactionSummary.componentPropertyCount > 0,
    componentPropertyCount: interactionSummary.componentPropertyCount,
    componentId: interactionSummary.componentId,
    mainComponentId: interactionSummary.mainComponentId,
    hasOverrides: interactionSummary.overrideCount > 0,
    overrideCount: interactionSummary.overrideCount,
    isContainer: childIds.length > 0 || CONTAINER_TYPES.has(normalizeString(node?.type) || ''),
    isVisibleLeaf: false,
    selfHidden,
    ancestorHidden,
    effectivelyVisible,
    isOutsideRootBounds: isOutsideRootBounds(relativeBoundingBox, rootBoundingBox),
    characters: textProperties.characters,
    fontSize: textProperties.fontSize,
    fontWeight: textProperties.fontWeight,
    textAlignHorizontal: textProperties.textAlignHorizontal,
    textAlignVertical: textProperties.textAlignVertical,
    lineHeight: textProperties.lineHeight,
    letterSpacing: textProperties.letterSpacing,
  }
}

export function normalizeFigmaPaints(paints) {
  if (!Array.isArray(paints)) return []

  return paints.map((paint) => ({
    type: normalizeString(paint?.type),
    visible: paint?.visible !== false,
    opacity: normalizeNumber(paint?.opacity),
    blendMode: normalizeString(paint?.blendMode),
    color: normalizeFigmaColor(paint?.color, paint?.opacity),
    scaleMode: normalizeString(paint?.scaleMode),
    imageRef: normalizeString(paint?.imageRef),
    gradientStops: normalizeGradientStops(paint?.gradientStops),
  }))
}

export function normalizeFigmaEffects(effects) {
  if (!Array.isArray(effects)) return []

  return effects.map((effect) => ({
    type: normalizeString(effect?.type),
    visible: effect?.visible !== false,
    radius: normalizeNumber(effect?.radius),
    spread: normalizeNumber(effect?.spread),
    blendMode: normalizeString(effect?.blendMode),
    offset: normalizeOffset(effect?.offset),
    color: normalizeFigmaColor(effect?.color),
  }))
}

export function getFigmaMediaSummary(node) {
  const fills = normalizeFigmaPaints(node?.fills)
  const imagePaints = fills.filter((paint) => paint.type === 'IMAGE')
  return {
    hasImageFill: imagePaints.length > 0,
    imageFillCount: imagePaints.length,
    imageRefs: uniqueStrings(imagePaints.map((paint) => paint.imageRef)),
    imageScaleModes: uniqueStrings(imagePaints.map((paint) => paint.scaleMode)),
    hasGradientFill: fills.some((paint) => GRADIENT_TYPES.has(paint.type)),
    hasSolidFill: fills.some((paint) => paint.type === 'SOLID'),
  }
}

export function getEffectiveVisibility(node, ancestorHidden = false) {
  const selfHidden = node?.visible === false
  return {
    selfHidden,
    ancestorHidden,
    effectivelyVisible: !selfHidden && !ancestorHidden,
  }
}

function createFigmaStructureSummary(flatNodes) {
  if (!Array.isArray(flatNodes) || flatNodes.length === 0) return createEmptyStructureSummary()

  return {
    totalNodeCount: flatNodes.length,
    visibleNodeCount: flatNodes.filter((node) => node.effectivelyVisible).length,
    hiddenNodeCount: flatNodes.filter((node) => !node.effectivelyVisible).length,
    containerCount: flatNodes.filter((node) => node.effectivelyVisible && node.isContainer).length,
    textNodeCount: flatNodes.filter((node) => node.effectivelyVisible && node.type === 'TEXT').length,
    imageFillNodeCount: flatNodes.filter((node) => node.effectivelyVisible && node.hasImageFill).length,
    interactiveCandidateCount: flatNodes.filter((node) => node.effectivelyVisible && node.isInteractiveCandidate).length,
    maxDepth: Math.max(...flatNodes.map((node) => Number(node.depth) || 0)),
  }
}

function createEmptyStructureSummary() {
  return {
    totalNodeCount: 0,
    visibleNodeCount: 0,
    hiddenNodeCount: 0,
    containerCount: 0,
    textNodeCount: 0,
    imageFillNodeCount: 0,
    interactiveCandidateCount: 0,
    maxDepth: 0,
  }
}

function createFigmaStructurePreview(flatNodes) {
  return (flatNodes || [])
    .filter((node) => node.effectivelyVisible)
    .sort((first, second) => {
      const scoreDiff = getStructurePreviewScore(second) - getStructurePreviewScore(first)
      if (scoreDiff !== 0) return scoreDiff
      const yDiff = (first.yRatio ?? 0) - (second.yRatio ?? 0)
      if (yDiff !== 0) return yDiff
      return (second.heightRatio ?? 0) - (first.heightRatio ?? 0)
    })
    .slice(0, 10)
    .map((node) => ({
      id: node.id,
      name: node.name,
      type: node.type,
      depth: node.depth,
      childCount: node.childCount,
      effectivelyVisible: node.effectivelyVisible,
      hasImageFill: node.hasImageFill,
      isContainer: node.isContainer,
      isInteractiveCandidate: node.isInteractiveCandidate,
      yRatio: node.yRatio,
      heightRatio: node.heightRatio,
    }))
}

function getStructurePreviewScore(node) {
  let score = 0
  if (node.depth === 1) score += 1000
  if (node.type === 'FRAME' || node.type === 'SECTION' || node.type === 'GROUP') score += 200
  if (node.isContainer) score += Math.min(node.childCount || 0, 40) * 6
  if (node.hasImageFill) score += 180
  if (node.isInteractiveCandidate) score += 140
  if (node.type === 'TEXT' && node.childCount > 0) score += 120
  score += Math.round((node.heightRatio || 0) * 100)
  return score
}

function visitFigmaStructure(node, visitor) {
  if (!node) return
  visitor(node)
  if (!Array.isArray(node.children)) return
  node.children.forEach((child) => visitFigmaStructure(child, visitor))
}

function pickParentMeta(node) {
  return {
    id: node?.id || null,
    name: node?.name || null,
    type: node?.type || null,
  }
}

function getFigmaLayerPath(ancestors, node) {
  return [...(ancestors || []), node]
    .map((item) => normalizeNodeLabel(item))
    .filter(Boolean)
    .join(' / ')
}

function normalizeFigmaTextProperties(node) {
  const style = node?.style && typeof node.style === 'object' ? node.style : null
  return {
    characters: typeof node?.characters === 'string' ? node.characters : null,
    fontSize: getStyleNumber(node, style, 'fontSize'),
    fontWeight: getStyleNumber(node, style, 'fontWeight'),
    textAlignHorizontal: getStyleString(node, style, 'textAlignHorizontal'),
    textAlignVertical: getStyleString(node, style, 'textAlignVertical'),
    lineHeight: normalizeFigmaLineHeight(node, style),
    letterSpacing: normalizeFigmaLetterSpacing(node, style),
  }
}

function createFigmaTextSummary(node, textProperties) {
  if (node?.type !== 'TEXT') return null

  return {
    preview: typeof textProperties.characters === 'string' ? truncateText(textProperties.characters, 80) : '',
    characterCount: typeof textProperties.characters === 'string' ? textProperties.characters.trim().length : 0,
    fontSize: textProperties.fontSize,
    fontWeight: textProperties.fontWeight,
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

function getRelativeBoundingBox(box, rootBoundingBox) {
  return {
    x: box.x !== null && rootBoundingBox?.x !== null ? roundNumber(box.x - rootBoundingBox.x) : null,
    y: box.y !== null && rootBoundingBox?.y !== null ? roundNumber(box.y - rootBoundingBox.y) : null,
    width: box.width,
    height: box.height,
  }
}

function getRatio(value, total) {
  if (!Number.isFinite(value) || !Number.isFinite(total) || total === 0) return null
  return roundNumber(value / total)
}

function isOutsideRootBounds(relativeBoundingBox, rootBoundingBox) {
  if (!relativeBoundingBox || !Number.isFinite(relativeBoundingBox.x) || !Number.isFinite(relativeBoundingBox.y)) return false
  if (!Number.isFinite(rootBoundingBox?.width) || !Number.isFinite(rootBoundingBox?.height)) return false

  const x = relativeBoundingBox.x
  const y = relativeBoundingBox.y
  const width = Number(relativeBoundingBox.width) || 0
  const height = Number(relativeBoundingBox.height) || 0
  return x < 0 || y < 0 || x + width > rootBoundingBox.width || y + height > rootBoundingBox.height
}

function hasMeaningfulLeafContent(node) {
  if (node.type === 'TEXT') return typeof node.characters === 'string' && node.characters.trim().length > 0
  if (node.hasImageFill || node.hasSolidFill || node.hasGradientFill) return true
  if (Array.isArray(node.strokes) && node.strokes.length > 0) return true
  if (Array.isArray(node.effects) && node.effects.length > 0) return true
  if (Number(node.absoluteBoundingBox?.width) > 0 && Number(node.absoluteBoundingBox?.height) > 0) return true
  return false
}

function isInteractiveFigmaNode(node) {
  if (Array.isArray(node?.prototypeInteractions) && node.prototypeInteractions.length > 0) return true
  if (Array.isArray(node?.reactions) && node.reactions.length > 0) return true
  if (normalizeString(node?.transitionNodeID) || normalizeString(node?.transitionNodeId)) return true
  if (node?.componentPropertyReferences && typeof node.componentPropertyReferences === 'object' && Object.keys(node.componentPropertyReferences).length > 0) return true

  const type = normalizeString(node?.type) || ''
  const name = String(node?.name || '').toLowerCase()
  if (['INSTANCE', 'COMPONENT', 'FRAME'].includes(type) && /button|btn|cta|link/.test(name)) return true
  return false
}

function createFigmaInteractionSummary(node) {
  const prototypeInteractionCount = Array.isArray(node?.prototypeInteractions) ? node.prototypeInteractions.length : 0
  const reactionCount = Array.isArray(node?.reactions) ? node.reactions.length : 0
  const transitionNodeId = normalizeString(node?.transitionNodeID) || normalizeString(node?.transitionNodeId)
  const componentPropertyReferenceCount = node?.componentPropertyReferences && typeof node.componentPropertyReferences === 'object'
    ? Object.keys(node.componentPropertyReferences).length
    : 0
  const componentPropertyCount = node?.componentProperties && typeof node.componentProperties === 'object'
    ? Object.keys(node.componentProperties).length
    : 0
  const componentId = normalizeString(node?.componentId)
  const mainComponentId = normalizeString(node?.mainComponent?.id || node?.mainComponent?.nodeId)
  const overrideCount = Array.isArray(node?.overrides)
    ? node.overrides.length
    : (node?.overrides && typeof node.overrides === 'object' ? Object.keys(node.overrides).length : 0)

  return {
    prototypeInteractionCount,
    reactionCount,
    hasTransitionTarget: Boolean(transitionNodeId),
    transitionNodeId,
    hasComponentPropertyReferences: componentPropertyReferenceCount > 0,
    componentPropertyReferenceCount,
    componentPropertyCount,
    componentId: componentId || null,
    mainComponentId: mainComponentId || null,
    overrideCount,
  }
}

function detectVideoLikeContent(node) {
  if (node?.mediaData?.type === 'VIDEO') return true
  if (node?.videoData) return true
  if (node?.pluginData?.mediaType === 'video') return true
  return false
}

function normalizeGradientStops(stops) {
  if (!Array.isArray(stops)) return []
  return stops.map((stop) => ({
    position: normalizeNumber(stop?.position),
    color: normalizeFigmaColor(stop?.color),
  }))
}

function normalizeOffset(offset) {
  if (!offset || typeof offset !== 'object') return null
  return {
    x: normalizeNumber(offset.x),
    y: normalizeNumber(offset.y),
  }
}

function normalizeFigmaColor(color, opacity) {
  if (!color || typeof color !== 'object') return null

  const red = normalizeChannel(color.r)
  const green = normalizeChannel(color.g)
  const blue = normalizeChannel(color.b)
  const alpha = normalizeAlpha(color.a, opacity)

  if (red === null || green === null || blue === null) return null
  return { r: red, g: green, b: blue, a: alpha }
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

function normalizeFigmaLineHeight(node, style) {
  const lineHeightPx = getStyleNumber(node, style, 'lineHeightPx')
  if (lineHeightPx !== null) return { unit: 'PIXELS', value: lineHeightPx }

  const lineHeightPercentFontSize = getStyleNumber(node, style, 'lineHeightPercentFontSize')
  if (lineHeightPercentFontSize !== null) return { unit: 'PERCENT_FONT_SIZE', value: lineHeightPercentFontSize }

  const lineHeightPercent = getStyleNumber(node, style, 'lineHeightPercent')
  if (lineHeightPercent !== null) return { unit: 'PERCENT', value: lineHeightPercent }

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
  if (typeof value === 'number' && Number.isFinite(value)) return { unit: fallbackUnit, value: roundNumber(value) }
  if (typeof value !== 'string') return null

  const trimmed = value.trim()
  if (!trimmed) return null
  const match = trimmed.match(/^(-?\d+(?:\.\d+)?)\s*(px|%)?$/i)
  if (!match) return { unit: fallbackUnit, value: null }

  return {
    unit: match[2] === '%' ? 'PERCENT' : fallbackUnit,
    value: roundNumber(Number(match[1])),
  }
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

function normalizeNodeLabel(node) {
  return normalizeString(node?.name) || normalizeString(node?.type) || 'Unnamed layer'
}

function truncateText(value, maxLength) {
  const text = String(value || '')
  if (text.length <= maxLength) return text
  return `${text.slice(0, maxLength)}...`
}

function uniqueStrings(values) {
  return Array.from(new Set((values || []).filter(Boolean)))
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
