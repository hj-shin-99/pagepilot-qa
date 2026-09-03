import { inferWebTextRole } from './webText.js'

const HARD_REJECT_SCORE = -1
const MIN_MATCH_SCORE = 45
const LOCAL_SIBLING_ALTERNATE_SCORE = 62
const MAX_LOCAL_SIBLING_ALTERNATE_EDGES = 80
const MAX_BOUNDED_COMPONENT_SIDE = 6
const MAX_BOUNDED_COMPONENT_EDGES = 24

export function normalizeTextForMatching(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\u00a0\u1680\u180e\u2000-\u200d\u2028\u2029\u202f\u205f\u3000\ufeff]+/g, '')
    .replace(/[.,，。ㆍ·:：;；!！?？"'“”‘’`´\-‐‑‒–—―_/\\()[\]{}<>《》]/g, '')
    .replace(/[^0-9a-z가-힣%]/g, '')
}

export function createComparableFigmaTextNode(node) {
  const rawText = String(node?.characters || '')
  return {
    source: 'figma',
    sourceId: node?.nodeId || node?.id || null,
    rawText,
    normalizedText: normalizeTextForMatching(rawText),
    role: inferFigmaTextRole(node),
    contextPath: String(node?.layerPath || ''),
    sectionHint: inferFigmaSectionHint(node),
    xRatio: normalizeNumber(node?.xRatio),
    yRatio: normalizeNumber(node?.yRatio),
    widthRatio: normalizeNumber(node?.widthRatio),
    heightRatio: normalizeNumber(node?.heightRatio),
    fontSize: normalizeNumber(node?.fontSize),
    fontWeight: normalizeNumber(node?.fontWeight),
    siblingIndex: normalizeInteger(node?.siblingIndex),
    ref: node,
  }
}

export function createComparableWebTextElement(element) {
  const rawText = String(element?.rawText || element?.text || '')
  return {
    source: 'web',
    sourceId: element?.id || element?.selector || null,
    rawText,
    normalizedText: normalizeTextForMatching(rawText),
    role: element?.role || inferWebTextRole(element),
    contextPath: String(element?.domPath || element?.selector || ''),
    sectionHint: inferWebSectionHint(element),
    xRatio: normalizeNumber(element?.xRatio),
    yRatio: normalizeNumber(element?.yRatio),
    widthRatio: normalizeNumber(element?.widthRatio),
    heightRatio: normalizeNumber(element?.heightRatio),
    fontSize: normalizeNumber(element?.fontSize),
    fontWeight: normalizeNumber(element?.fontWeight),
    siblingIndex: normalizeInteger(element?.siblingIndex),
    ref: element,
  }
}

export function inferFigmaTextRole(node) {
  const searchable = `${node?.layerPath || ''} ${node?.parentFrameName || ''} ${node?.name || ''}`.toLowerCase()
  const rawText = String(node?.characters || '')

  if (/nav|navigation|gnb|menu|header|tab|bar items/.test(searchable)) return 'navigation'
  if (/table|row|cell/.test(searchable)) return 'table'
  if (/button|btn|cta|link-button/.test(searchable) || looksLikeCtaText(rawText)) return 'cta'
  if (/legal|footer|disclaimer|privacy|terms|copyright|약관|유의사항|개인정보|대표자|사업자/.test(searchable) || looksLikeLegalText(rawText)) return 'legal'
  if (looksLikePriceText(rawText)) return 'price'
  if (looksLikeDateText(rawText)) return 'date'
  if (/label|field|input|form/.test(searchable) || (rawText.length > 0 && rawText.length <= 24 && /:$/.test(rawText))) return 'label'
  if (Number(node?.fontSize || 0) >= 28 || Number(node?.fontWeight || 0) >= 700 || /title|heading|headline|hero|kv/.test(searchable)) return 'heading'
  if (rawText) return 'body'
  return 'unknown'
}

export function inferWebSectionHint(element) {
  const explicit = String(element?.sectionHint || '').toLowerCase()
  if (explicit) return explicit

  const searchable = `${element?.selector || ''} ${element?.domPath || ''}`.toLowerCase()
  if (/nav|navigation|gnb|menu|header/.test(searchable)) return 'navigation'
  if (/footer/.test(searchable)) return 'footer'
  if (/legal|privacy|terms|cookie|disclaimer|약관|개인정보/.test(searchable)) return 'legal'
  if (/hero|kv|banner/.test(searchable)) return 'hero'
  return 'unknown'
}

export function inferFigmaSectionHint(node) {
  const searchable = `${node?.layerPath || ''} ${node?.parentFrameName || ''}`.toLowerCase()
  if (/nav|navigation|gnb|menu|header/.test(searchable)) return 'navigation'
  if (/footer/.test(searchable)) return 'footer'
  if (/legal|privacy|terms|cookie|disclaimer|약관|개인정보|유의사항/.test(searchable)) return 'legal'
  if (/hero|kv|banner|main.?visual/.test(searchable)) return 'hero'

  const yRatio = Number(node?.yRatio)
  if (!Number.isFinite(yRatio)) return 'unknown'
  if (yRatio < 0.33) return 'top'
  if (yRatio < 0.66) return 'middle'
  return 'bottom'
}

export function matchTextNodes(figmaTextNodes, webTextElements, options = {}) {
  const figmaItems = figmaTextNodes.map(createComparableFigmaTextNode)
  const webItems = webTextElements.map(createComparableWebTextElement)
  const allPairs = []

  figmaItems.forEach((figmaItem, figmaIndex) => {
    webItems.forEach((webItem, webIndex) => {
      const pair = evaluateTextPair(figmaItem, webItem)
      allPairs.push({
        figmaIndex,
        webIndex,
        figmaNode: figmaItem.ref,
        webElement: webItem.ref,
        edgeOrigin: 'normal',
        ...pair,
        ...(options.includeDiagnostics === true ? { diagnostics: createPairDiagnostics(figmaItem, webItem, pair) } : {}),
      })
    })
  })

  const normalCandidatePairs = allPairs
    .filter((pair) => !pair.rejected && pair.matchScore >= MIN_MATCH_SCORE)
    .sort(comparePairsForSelection)
  const alternatePairs = createLocalSiblingAlternatePairs({
    candidatePairs: normalCandidatePairs,
    allPairs,
    figmaItems,
    webItems,
    includeDiagnostics: options.includeDiagnostics === true,
  })
  const candidatePairs = [...normalCandidatePairs, ...alternatePairs].sort(comparePairsForSelection)

  const assignment = selectMatchedPairs(candidatePairs, figmaItems, webItems, options)
  const { usedFigma, usedWeb } = assignment

  const figmaOnly = figmaItems
    .filter((_, index) => !usedFigma.has(index))
    .map((item) => item.ref)
  const webOnly = webItems
    .filter((_, index) => !usedWeb.has(index))
    .map((item) => item.ref)

  return {
    matchedPairs: assignment.matchedPairs.map(stripPairIndexes),
    figmaOnly,
    webOnly,
    allPairs: options.includeAllPairs ? [...allPairs, ...alternatePairs].map(stripPairIndexes) : [],
    ...(options.includeDiagnostics === true ? { assignment: assignment.diagnostics } : {}),
  }
}

export function evaluateTextPair(figmaItem, webItem) {
  const rejectReasons = []
  const matchReasons = []
  const normalizedSimilarity = getTextSimilarity(figmaItem.normalizedText, webItem.normalizedText)
  const roleScore = getRoleCompatibilityScore(figmaItem, webItem, rejectReasons)
  if (roleScore === HARD_REJECT_SCORE) {
    return createRejectedPair(rejectReasons, normalizedSimilarity)
  }

  const contextSimilarity = getContextSimilarity(figmaItem.contextPath, webItem.contextPath)
  const sectionScore = getSectionCompatibilityScore(figmaItem.sectionHint, webItem.sectionHint)
  const yDiff = getDifference(figmaItem.yRatio, webItem.yRatio)
  const xDiff = getDifference(figmaItem.xRatio, webItem.xRatio)
  const yScore = getProximityScore(yDiff, 0.24)
  const xScore = getProximityScore(xDiff, 0.3)
  const fontSizeScore = getRelativeSimilarity(figmaItem.fontSize, webItem.fontSize, 0.45)
  const siblingScore = getSiblingSimilarity(figmaItem.siblingIndex, webItem.siblingIndex)
  const lengthRatio = getLengthRatio(figmaItem.normalizedText, webItem.normalizedText)

  if (shouldRejectForContext(figmaItem, webItem, yDiff, contextSimilarity, lengthRatio, rejectReasons)) {
    return createRejectedPair(rejectReasons, normalizedSimilarity)
  }

  const matchScore = roundScore(
    normalizedSimilarity * 55
    + roleScore * 12
    + yScore * 10
    + xScore * 6
    + fontSizeScore * 6
    + contextSimilarity * 6
    + sectionScore * 3
    + siblingScore * 2,
  )

  if (normalizedSimilarity >= 0.92) matchReasons.push('normalizedText가 거의 동일합니다.')
  else if (normalizedSimilarity >= 0.72) matchReasons.push('normalizedText가 유사합니다.')
  else if (normalizedSimilarity >= 0.45) matchReasons.push('normalizedText가 부분적으로 유사합니다.')

  if (roleScore >= 1) matchReasons.push(`role이 일치합니다. (${figmaItem.role})`)
  else if (roleScore >= 0.7) matchReasons.push('role이 호환됩니다.')

  if (sectionScore >= 1) matchReasons.push(`sectionHint가 일치합니다. (${figmaItem.sectionHint})`)
  if (yScore >= 0.75) matchReasons.push('세로 위치가 가깝습니다.')
  if (xScore >= 0.75) matchReasons.push('가로 위치가 가깝습니다.')
  if (contextSimilarity >= 0.45) matchReasons.push('contextPath가 유사합니다.')
  if (fontSizeScore >= 0.7) matchReasons.push('fontSize가 유사합니다.')
  if (lengthRatio >= 0.75) matchReasons.push('텍스트 길이 비율이 안정적입니다.')

  const matchConfidence = classifyMatchConfidence({
    matchScore,
    normalizedSimilarity,
    roleScore,
    yDiff,
    contextSimilarity,
  })

  return {
    matchScore,
    matchConfidence,
    matchReasons,
    rejectReasons,
    rawTextEqual: figmaItem.rawText === webItem.rawText,
    normalizedTextEqual: figmaItem.normalizedText === webItem.normalizedText,
    rejected: false,
  }
}

function createRejectedPair(rejectReasons, normalizedSimilarity) {
  return {
    matchScore: 0,
    matchConfidence: 'low',
    matchReasons: normalizedSimilarity >= 0.45 ? ['문자열 일부 유사성은 있으나 문맥 근거가 부족합니다.'] : [],
    rejectReasons,
    rawTextEqual: false,
    normalizedTextEqual: false,
    rejected: true,
  }
}

function createLocalSiblingAlternatePairs({ candidatePairs, allPairs, figmaItems, webItems, includeDiagnostics }) {
  const allPairsByKey = new Map(allPairs.map((pair) => [createIndexedPairKey(pair), pair]))
  const existingCandidateKeys = new Set(candidatePairs.map(createIndexedPairKey))
  const alternateKeys = new Set()
  const alternates = []

  candidatePairs.forEach((anchorPair) => {
    if (alternates.length >= MAX_LOCAL_SIBLING_ALTERNATE_EDGES) return
    if (!isStrongLocalSiblingAnchor(anchorPair)) return

    ;[-1, 1].forEach((direction) => {
      if (alternates.length >= MAX_LOCAL_SIBLING_ALTERNATE_EDGES) return
      const figmaIndex = anchorPair.figmaIndex + direction
      const webIndex = anchorPair.webIndex + direction
      const key = `${figmaIndex}:${webIndex}`
      if (existingCandidateKeys.has(key) || alternateKeys.has(key)) return

      const basePair = allPairsByKey.get(key)
      const figmaAnchor = figmaItems[anchorPair.figmaIndex]
      const webAnchor = webItems[anchorPair.webIndex]
      const figmaSibling = figmaItems[figmaIndex]
      const webSibling = webItems[webIndex]
      const evaluation = evaluateLocalSiblingAlternate({ anchorPair, basePair, figmaAnchor, figmaSibling, webAnchor, webSibling, direction })
      if (!evaluation.accepted) return

      const alternatePair = {
        ...basePair,
        figmaIndex,
        webIndex,
        figmaNode: figmaSibling.ref,
        webElement: webSibling.ref,
        edgeOrigin: 'local-sibling-alternate',
        anchorPairKey: createIndexedPairKey(anchorPair),
        localSiblingEvidence: evaluation.evidence,
        matchScore: Math.max(LOCAL_SIBLING_ALTERNATE_SCORE, Number(basePair?.matchScore || 0)),
        matchConfidence: 'medium',
        matchReasons: [
          'local sibling sequence가 strong anchor와 같은 순서로 정렬됩니다.',
          '인접 텍스트 블록의 구조/위치 근거가 충분합니다.',
          ...(Array.isArray(basePair?.matchReasons) ? basePair.matchReasons.slice(0, 2) : []),
        ],
        rejectReasons: [],
        rejected: false,
        rawTextEqual: figmaSibling.rawText === webSibling.rawText,
        normalizedTextEqual: figmaSibling.normalizedText === webSibling.normalizedText,
      }
      if (includeDiagnostics) alternatePair.diagnostics = createPairDiagnostics(figmaSibling, webSibling, alternatePair)
      alternateKeys.add(key)
      alternates.push(alternatePair)
    })
  })

  return alternates
}

function isStrongLocalSiblingAnchor(pair) {
  return pair.edgeOrigin === 'normal'
    && !pair.rejected
    && (pair.matchConfidence === 'high' || pair.matchConfidence === 'medium' || Number(pair.matchScore || 0) >= 72)
    && Number(pair.matchScore || 0) >= 60
}

function evaluateLocalSiblingAlternate({ anchorPair, basePair, figmaAnchor, figmaSibling, webAnchor, webSibling, direction }) {
  if (!basePair || !figmaAnchor || !figmaSibling || !webAnchor || !webSibling) return rejectLocalSiblingAlternate('missing-sibling')
  if (basePair.rejected) return rejectLocalSiblingAlternate('base-pair-hard-rejected')
  if (!isMeaningfulVisibleText(figmaSibling) || !isMeaningfulVisibleText(webSibling)) return rejectLocalSiblingAlternate('non-meaningful-or-hidden-text')
  if (!hasCompatibleSiblingRoles(figmaSibling, webSibling)) return rejectLocalSiblingAlternate('incompatible-role-boundary')
  if (!isLocallyAdjacent(figmaAnchor, figmaSibling) || !isLocallyAdjacent(webAnchor, webSibling)) return rejectLocalSiblingAlternate('not-local-adjacent-siblings')
  if (!hasSameReadingDirection(anchorPair, direction)) return rejectLocalSiblingAlternate('reading-order-mismatch')
  if (!hasSameVisualSiblingDirection(figmaAnchor, figmaSibling, webAnchor, webSibling)) return rejectLocalSiblingAlternate('visual-order-mismatch')
  if (!hasStableSiblingAlignment(figmaAnchor, figmaSibling, webAnchor, webSibling)) return rejectLocalSiblingAlternate('insufficient-alignment')
  if (!hasMinimumSiblingTextSanity(figmaSibling, webSibling)) return rejectLocalSiblingAlternate('text-shape-sanity-failed')

  return {
    accepted: true,
    evidence: {
      anchorPairKey: createIndexedPairKey(anchorPair),
      anchorFigmaSourceId: figmaAnchor.sourceId || '',
      anchorWebSourceId: webAnchor.sourceId || '',
      direction: direction > 0 ? 'next' : 'previous',
      figmaSiblingDelta: createSiblingDelta(figmaAnchor, figmaSibling),
      webSiblingDelta: createSiblingDelta(webAnchor, webSibling),
      normalizedSimilarity: roundScore(getTextSimilarity(figmaSibling.normalizedText, webSibling.normalizedText)),
      lengthRatio: roundScore(getLengthRatio(figmaSibling.normalizedText, webSibling.normalizedText)),
      basePairScore: normalizeNumber(basePair.matchScore),
    },
  }
}

function rejectLocalSiblingAlternate(reason) {
  return { accepted: false, reason }
}

function isMeaningfulVisibleText(item) {
  if (!item || item.ref?.effectivelyVisible === false || item.ref?.visible === false) return false
  const text = String(item.rawText || '').replace(/\s+/g, ' ').trim()
  if (text.length < 4) return false
  return String(item.normalizedText || '').length >= 3
}

function hasCompatibleSiblingRoles(figmaItem, webItem) {
  const firstRole = normalizeRoleBoundary(figmaItem.role)
  const secondRole = normalizeRoleBoundary(webItem.role)
  const blocked = new Set(['cta', 'navigation', 'legal', 'table', 'media-control'])
  if (blocked.has(firstRole) || blocked.has(secondRole)) return firstRole === secondRole
  return true
}

function normalizeRoleBoundary(role) {
  const value = String(role || '').toLowerCase()
  if (/cta|button|action|link/.test(value)) return 'cta'
  if (/nav|menu/.test(value)) return 'navigation'
  if (/legal|footer|privacy|terms/.test(value)) return 'legal'
  if (/table|row|cell/.test(value)) return 'table'
  if (/video|image|media|control/.test(value)) return 'media-control'
  if (/heading|title|body|label|price|date|unknown/.test(value)) return value
  return 'text'
}

function hasSameReadingDirection(anchorPair, direction) {
  const nextFigmaIndex = anchorPair.figmaIndex + direction
  const nextWebIndex = anchorPair.webIndex + direction
  return direction > 0 ? nextFigmaIndex > anchorPair.figmaIndex && nextWebIndex > anchorPair.webIndex : nextFigmaIndex < anchorPair.figmaIndex && nextWebIndex < anchorPair.webIndex
}

function hasSameVisualSiblingDirection(figmaAnchor, figmaSibling, webAnchor, webSibling) {
  const figmaDelta = createSiblingDelta(figmaAnchor, figmaSibling)
  const webDelta = createSiblingDelta(webAnchor, webSibling)
  if (hasOppositeSignedDelta(figmaDelta.y, webDelta.y, 0.006)) return false
  if (hasOppositeSignedDelta(figmaDelta.x, webDelta.x, 0.01)) return false
  return true
}

function hasOppositeSignedDelta(first, second, tolerance) {
  if (!Number.isFinite(first) || !Number.isFinite(second)) return false
  if (Math.abs(first) <= tolerance || Math.abs(second) <= tolerance) return false
  return Math.sign(first) !== Math.sign(second)
}

function hasStableSiblingAlignment(figmaAnchor, figmaSibling, webAnchor, webSibling) {
  const figmaDelta = createSiblingDelta(figmaAnchor, figmaSibling)
  const webDelta = createSiblingDelta(webAnchor, webSibling)
  const pairYDiff = getDifference(figmaSibling.yRatio, webSibling.yRatio)
  const pairXDiff = getDifference(figmaSibling.xRatio, webSibling.xRatio)
  const relativeXDiff = getDifference(figmaDelta.x, webDelta.x)
  const relativeYDiff = getDifference(figmaDelta.y, webDelta.y)
  const alignedX = pairXDiff === null || pairXDiff <= 0.12 || relativeXDiff === null || relativeXDiff <= 0.08
  const alignedY = pairYDiff === null || pairYDiff <= 0.08 || relativeYDiff === null || relativeYDiff <= 0.04
  return alignedX && alignedY
}

function createSiblingDelta(anchor, sibling) {
  return {
    x: Number.isFinite(anchor?.xRatio) && Number.isFinite(sibling?.xRatio) ? roundScore(sibling.xRatio - anchor.xRatio) : null,
    y: Number.isFinite(anchor?.yRatio) && Number.isFinite(sibling?.yRatio) ? roundScore(sibling.yRatio - anchor.yRatio) : null,
  }
}

function hasMinimumSiblingTextSanity(figmaItem, webItem) {
  const lengthRatio = getLengthRatio(figmaItem.normalizedText, webItem.normalizedText)
  if (lengthRatio < 0.32) return false
  const shortest = Math.min(String(figmaItem.normalizedText || '').length, String(webItem.normalizedText || '').length)
  return shortest >= 6
}

function selectMatchedPairs(candidatePairs, figmaItems, webItems, options = {}) {
  const components = createAmbiguityComponents(candidatePairs)
  const selectedPairs = []
  const componentDiagnostics = []
  let boundedComponentCount = 0

  components.forEach((component, componentIndex) => {
    const greedy = selectGreedyPairs(component.pairs, figmaItems, webItems)
    const bounded = canUseBoundedAssignment(component) ? selectBoundedComponentPairs(component.pairs, figmaItems, webItems) : null
    const chosen = bounded && compareAssignments(bounded, greedy) > 0 ? bounded : greedy
    if (chosen.strategy === 'bounded-component') boundedComponentCount += 1
    selectedPairs.push(...chosen.pairs)

    if (options.includeDiagnostics === true) {
      componentDiagnostics.push(createAssignmentComponentDiagnostic({
        component,
        componentIndex,
        greedy,
        bounded,
        chosen,
        figmaItems,
        webItems,
      }))
    }
  })

  const usedFigma = new Set(selectedPairs.map((pair) => pair.figmaIndex))
  const usedWeb = new Set(selectedPairs.map((pair) => pair.webIndex))

  return {
    matchedPairs: selectedPairs.sort(comparePairsForOutput),
    usedFigma,
    usedWeb,
    diagnostics: options.includeDiagnostics === true ? {
      strategy: boundedComponentCount > 0 ? 'bounded-component' : 'greedy',
      componentCount: components.length,
      boundedComponentCount,
      fallbackComponentCount: components.length - boundedComponentCount,
      components: componentDiagnostics,
    } : undefined,
  }
}

function createAmbiguityComponents(candidatePairs) {
  const nodeToPairs = new Map()
  candidatePairs.forEach((pair) => {
    addMapItem(nodeToPairs, `f:${pair.figmaIndex}`, pair)
    addMapItem(nodeToPairs, `w:${pair.webIndex}`, pair)
  })

  const visited = new Set()
  const components = []
  candidatePairs.forEach((startPair) => {
    const startKey = createIndexedPairKey(startPair)
    if (visited.has(startKey)) return
    const queue = [startPair]
    const pairs = []
    const figmaIndexes = new Set()
    const webIndexes = new Set()

    while (queue.length) {
      const pair = queue.shift()
      const pairKey = createIndexedPairKey(pair)
      if (visited.has(pairKey)) continue
      visited.add(pairKey)
      pairs.push(pair)
      figmaIndexes.add(pair.figmaIndex)
      webIndexes.add(pair.webIndex)

      ;[`f:${pair.figmaIndex}`, `w:${pair.webIndex}`].forEach((nodeKey) => {
        ;(nodeToPairs.get(nodeKey) || []).forEach((nextPair) => {
          if (!visited.has(createIndexedPairKey(nextPair))) queue.push(nextPair)
        })
      })
    }

    components.push({ pairs, figmaIndexes: [...figmaIndexes].sort(compareNumbers), webIndexes: [...webIndexes].sort(compareNumbers) })
  })

  return components
}

function canUseBoundedAssignment(component) {
  return component.figmaIndexes.length <= MAX_BOUNDED_COMPONENT_SIDE
    && component.webIndexes.length <= MAX_BOUNDED_COMPONENT_SIDE
    && component.pairs.length <= MAX_BOUNDED_COMPONENT_EDGES
}

function selectGreedyPairs(pairs, figmaItems, webItems) {
  const usedFigma = new Set()
  const usedWeb = new Set()
  const selected = []
  pairs.slice().sort(comparePairsForSelection).forEach((pair) => {
    if (usedFigma.has(pair.figmaIndex) || usedWeb.has(pair.webIndex)) return
    usedFigma.add(pair.figmaIndex)
    usedWeb.add(pair.webIndex)
    selected.push(pair)
  })
  return createAssignmentResult('greedy', selected, figmaItems, webItems)
}

function selectBoundedComponentPairs(pairs, figmaItems, webItems) {
  const edgesByFigma = new Map()
  pairs.forEach((pair) => addMapItem(edgesByFigma, pair.figmaIndex, pair))
  const figmaIndexes = [...edgesByFigma.keys()].sort(compareNumbers)
  let best = createAssignmentResult('bounded-component', [], figmaItems, webItems)

  function visit(figmaOffset, usedWeb, selected) {
    if (figmaOffset >= figmaIndexes.length) {
      const candidate = createAssignmentResult('bounded-component', selected, figmaItems, webItems)
      if (compareAssignments(candidate, best) > 0) best = candidate
      return
    }

    const figmaIndex = figmaIndexes[figmaOffset]
    const edges = (edgesByFigma.get(figmaIndex) || []).slice().sort(comparePairsForSelection)
    edges.forEach((edge) => {
      if (usedWeb.has(edge.webIndex)) return
      usedWeb.add(edge.webIndex)
      selected.push(edge)
      visit(figmaOffset + 1, usedWeb, selected)
      selected.pop()
      usedWeb.delete(edge.webIndex)
    })
    visit(figmaOffset + 1, usedWeb, selected)
  }

  visit(0, new Set(), [])
  return best
}

function createAssignmentResult(strategy, pairs, figmaItems, webItems) {
  const score = pairs.reduce((sum, pair) => sum + getAssignmentEdgeScore(pair, figmaItems, webItems), 0)
  const orderPenalty = getReadingOrderInversionCount(pairs) * 48
  const localOrderBonus = getLocalAdjacencyBonus(pairs, figmaItems, webItems)
  const objectiveScore = roundScore(pairs.length * 100 + score + localOrderBonus - orderPenalty)
  return {
    strategy,
    pairs: pairs.slice().sort(comparePairsForOutput),
    pairCount: pairs.length,
    rawScore: roundScore(score),
    localOrderBonus: roundScore(localOrderBonus),
    orderPenalty: roundScore(orderPenalty),
    objectiveScore,
  }
}

function compareAssignments(first, second) {
  if (first.pairCount !== second.pairCount) return first.pairCount - second.pairCount
  if (first.objectiveScore !== second.objectiveScore) return first.objectiveScore - second.objectiveScore
  if (first.rawScore !== second.rawScore) return first.rawScore - second.rawScore
  return compareAssignmentPairKeys(first.pairs, second.pairs)
}

function getAssignmentEdgeScore(pair, figmaItems = [], webItems = []) {
  const figmaItem = figmaItems[pair.figmaIndex]
  const webItem = webItems[pair.webIndex]
  if (!figmaItem || !webItem) return Number(pair.matchScore || 0)
  const yDiff = getDifference(figmaItem.yRatio, webItem.yRatio)
  const xDiff = getDifference(figmaItem.xRatio, webItem.xRatio)
  const normalizedSimilarity = getTextSimilarity(figmaItem.normalizedText, webItem.normalizedText)
  const roleScore = Math.max(0, getRoleCompatibilityScore(figmaItem, webItem, []))
  const contextSimilarity = getContextSimilarity(figmaItem.contextPath, webItem.contextPath)
  const sectionScore = getSectionCompatibilityScore(figmaItem.sectionHint, webItem.sectionHint)
  const geometryScore = getProximityScore(yDiff, 0.24) * 8 + getProximityScore(xDiff, 0.3) * 4
  const confidenceBonus = pair.matchConfidence === 'high' ? 4 : pair.matchConfidence === 'medium' ? 2 : 0

  return roundScore(
    Number(pair.matchScore || 0)
    + normalizedSimilarity * 10
    + roleScore * 4
    + contextSimilarity * 4
    + sectionScore * 3
    + geometryScore
    + confidenceBonus,
  )
}

function getReadingOrderInversionCount(pairs) {
  const sorted = pairs.slice().sort(comparePairsForOutput)
  let inversions = 0
  for (let leftIndex = 0; leftIndex < sorted.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < sorted.length; rightIndex += 1) {
      if (sorted[leftIndex].webIndex > sorted[rightIndex].webIndex) inversions += 1
    }
  }
  return inversions
}

function getLocalAdjacencyBonus(pairs, figmaItems = [], webItems = []) {
  const sorted = pairs.slice().sort(comparePairsForOutput)
  let bonus = 0
  for (let index = 0; index < sorted.length - 1; index += 1) {
    const current = sorted[index]
    const next = sorted[index + 1]
    if (current.figmaIndex >= next.figmaIndex || current.webIndex >= next.webIndex) continue
    const figmaCurrent = figmaItems[current.figmaIndex]
    const figmaNext = figmaItems[next.figmaIndex]
    const webCurrent = webItems[current.webIndex]
    const webNext = webItems[next.webIndex]
    if (isLocallyAdjacent(figmaCurrent, figmaNext) && isLocallyAdjacent(webCurrent, webNext)) bonus += 12
  }
  return bonus
}

function isLocallyAdjacent(first, second) {
  if (!first || !second) return false
  const yDiff = getDifference(first.yRatio, second.yRatio)
  const xDiff = getDifference(first.xRatio, second.xRatio)
  const contextSimilarity = getContextSimilarity(first.contextPath, second.contextPath)
  const sameSection = first.sectionHint && first.sectionHint === second.sectionHint
  return (yDiff === null || yDiff <= 0.08) && (xDiff === null || xDiff <= 0.18) && (contextSimilarity >= 0.2 || sameSection)
}

function createAssignmentComponentDiagnostic({ component, componentIndex, greedy, bounded, chosen, figmaItems, webItems }) {
  const chosenKeys = new Set(chosen.pairs.map(createIndexedPairKey))
  return {
    componentId: `component-${componentIndex + 1}`,
    strategy: chosen.strategy,
    fallbackReason: bounded ? '' : 'component-too-large',
    figmaCount: component.figmaIndexes.length,
    webCount: component.webIndexes.length,
    edgeCount: component.pairs.length,
    greedy: createAssignmentSummary(greedy),
    refined: bounded ? createAssignmentSummary(bounded) : null,
    candidateEdges: component.pairs.slice().sort(comparePairsForSelection).slice(0, 40).map((pair) => createAssignmentEdgeDiagnostic(pair, figmaItems, webItems, chosenKeys)),
    chosenEdges: chosen.pairs.map((pair) => createAssignmentEdgeDiagnostic(pair, figmaItems, webItems, chosenKeys)),
  }
}

function createAssignmentSummary(result) {
  return {
    strategy: result.strategy,
    pairCount: result.pairCount,
    rawScore: result.rawScore,
    objectiveScore: result.objectiveScore,
    localOrderBonus: result.localOrderBonus,
    orderPenalty: result.orderPenalty,
  }
}

function createAssignmentEdgeDiagnostic(pair, figmaItems, webItems, chosenKeys) {
  const figmaItem = figmaItems[pair.figmaIndex]
  const webItem = webItems[pair.webIndex]
  return {
    edgeId: createIndexedPairKey(pair),
    chosen: chosenKeys.has(createIndexedPairKey(pair)),
    rejectedReason: chosenKeys.has(createIndexedPairKey(pair)) ? '' : 'not-selected-by-assignment',
    figmaIndex: pair.figmaIndex,
    webIndex: pair.webIndex,
    figmaSourceId: figmaItem?.sourceId || '',
    webSourceId: webItem?.sourceId || '',
    edgeOrigin: pair.edgeOrigin || 'normal',
    anchorPairKey: pair.anchorPairKey || '',
    matchScore: normalizeNumber(pair.matchScore),
    assignmentScore: getAssignmentEdgeScore(pair, figmaItems, webItems),
    matchConfidence: pair.matchConfidence,
    diagnostics: pair.diagnostics || createPairDiagnostics(figmaItem, webItem, pair),
  }
}

function addMapItem(map, key, value) {
  const values = map.get(key) || []
  values.push(value)
  map.set(key, values)
}

function createIndexedPairKey(pair) {
  return `${pair.figmaIndex}:${pair.webIndex}`
}

function comparePairsForOutput(first, second) {
  if (first.figmaIndex !== second.figmaIndex) return first.figmaIndex - second.figmaIndex
  return first.webIndex - second.webIndex
}

function compareAssignmentPairKeys(firstPairs, secondPairs) {
  const firstKey = firstPairs.map(createIndexedPairKey).join('|')
  const secondKey = secondPairs.map(createIndexedPairKey).join('|')
  return secondKey.localeCompare(firstKey)
}

function compareNumbers(first, second) {
  return first - second
}

function createPairDiagnostics(figmaItem, webItem, pair) {
  const yDiff = getDifference(figmaItem.yRatio, webItem.yRatio)
  const xDiff = getDifference(figmaItem.xRatio, webItem.xRatio)
  const roleRejectReasons = []
  const roleScore = getRoleCompatibilityScore(figmaItem, webItem, roleRejectReasons)
  const contextSimilarity = getContextSimilarity(figmaItem.contextPath, webItem.contextPath)
  const sectionScore = getSectionCompatibilityScore(figmaItem.sectionHint, webItem.sectionHint)
  const normalizedSimilarity = getTextSimilarity(figmaItem.normalizedText, webItem.normalizedText)

  return {
    normalizedSimilarity: roundScore(normalizedSimilarity),
    lengthRatio: roundScore(getLengthRatio(figmaItem.normalizedText, webItem.normalizedText)),
    geometry: {
      xDiff,
      yDiff,
      xScore: roundScore(getProximityScore(xDiff, 0.3)),
      yScore: roundScore(getProximityScore(yDiff, 0.24)),
    },
    contextSimilarity: roundScore(contextSimilarity),
    sectionScore: roundScore(sectionScore),
    roleScore,
    fontSizeScore: roundScore(getRelativeSimilarity(figmaItem.fontSize, webItem.fontSize, 0.45)),
    siblingScore: roundScore(getSiblingSimilarity(figmaItem.siblingIndex, webItem.siblingIndex)),
    threshold: {
      minimumMatchScore: 45,
      mediumDifferenceScore: 60,
    },
    gate: pair.rejected ? 'hard-reject' : pair.matchScore >= 45 ? 'eligible' : 'below-threshold',
    edgeOrigin: pair.edgeOrigin || 'normal',
    anchorPairKey: pair.anchorPairKey || '',
    localSiblingEvidence: pair.localSiblingEvidence || null,
  }
}

function shouldRejectForContext(figmaItem, webItem, yDiff, contextSimilarity, lengthRatio, rejectReasons) {
  if (figmaItem.role === 'cta' && webItem.role === 'body' && webItem.rawText.length >= 25) {
    rejectReasons.push('CTA와 긴 본문을 매칭하지 않습니다.')
    return true
  }

  if (figmaItem.role === 'body' && webItem.role === 'cta' && figmaItem.rawText.length >= 25) {
    rejectReasons.push('긴 본문과 CTA를 매칭하지 않습니다.')
    return true
  }

  if (figmaItem.role === 'heading' && webItem.role === 'legal') {
    rejectReasons.push('heading과 legal 문단을 매칭하지 않습니다.')
    return true
  }

  if (figmaItem.role === 'legal' && webItem.role === 'heading') {
    rejectReasons.push('legal 문단과 heading을 매칭하지 않습니다.')
    return true
  }

  if (yDiff !== null && yDiff > 0.55 && contextSimilarity < 0.2) {
    rejectReasons.push('yRatio 차이가 크고 context 근거가 없습니다.')
    return true
  }

  if (lengthRatio < 0.2 && getTextSimilarity(figmaItem.normalizedText, webItem.normalizedText) < 0.8) {
    rejectReasons.push('텍스트 길이 비율 차이가 지나치게 큽니다.')
    return true
  }

  return false
}

function getRoleCompatibilityScore(figmaItem, webItem, rejectReasons) {
  if (figmaItem.role === webItem.role) return 1

  const pairKey = `${figmaItem.role}:${webItem.role}`
  const compatiblePairs = new Map([
    ['heading:body', 0.45],
    ['body:heading', 0.45],
    ['label:body', 0.4],
    ['body:label', 0.4],
    ['navigation:cta', 0.4],
    ['cta:navigation', 0.4],
  ])

  if ((figmaItem.role === 'navigation' && !['navigation', 'cta'].includes(webItem.role))
    || (webItem.role === 'navigation' && !['navigation', 'cta'].includes(figmaItem.role))) {
    rejectReasons.push('navigation과 main content 역할은 직접 매칭하지 않습니다.')
    return HARD_REJECT_SCORE
  }

  return compatiblePairs.get(pairKey) || 0.15
}

function getSectionCompatibilityScore(first, second) {
  if (!first || !second) return 0
  if (first === second) return 1
  const pair = new Set([first, second])
  if (pair.has('hero') && pair.has('top')) return 0.8
  if (pair.has('legal') && pair.has('footer')) return 0.8
  if (pair.has('navigation') && pair.has('top')) return 0.7
  return 0
}

function getContextSimilarity(first, second) {
  const firstTokens = tokenizeContext(first)
  const secondTokens = tokenizeContext(second)
  if (firstTokens.size === 0 || secondTokens.size === 0) return 0

  let overlap = 0
  firstTokens.forEach((token) => {
    if (secondTokens.has(token)) overlap += 1
  })

  return overlap / Math.max(firstTokens.size, secondTokens.size)
}

function tokenizeContext(value) {
  return new Set(
    String(value || '')
      .toLowerCase()
      .split(/[^0-9a-z가-힣]+/i)
      .map((token) => token.trim())
      .filter((token) => token.length >= 2),
  )
}

function getTextSimilarity(first, second) {
  if (!first || !second) return 0
  if (first === second) return 1
  if (first.includes(second) || second.includes(first)) {
    return Math.min(first.length, second.length) / Math.max(first.length, second.length)
  }

  const firstTokens = createBigramSet(first)
  const secondTokens = createBigramSet(second)
  if (firstTokens.size === 0 || secondTokens.size === 0) return 0

  let overlap = 0
  firstTokens.forEach((token) => {
    if (secondTokens.has(token)) overlap += 1
  })

  return overlap / Math.max(firstTokens.size, secondTokens.size)
}

function createBigramSet(value) {
  const tokens = new Set()
  const text = String(value || '')
  for (let index = 0; index < text.length - 1; index += 1) {
    tokens.add(text.slice(index, index + 2))
  }
  return tokens
}

function classifyMatchConfidence({ matchScore, normalizedSimilarity, roleScore, yDiff, contextSimilarity }) {
  if (matchScore >= 78 && normalizedSimilarity >= 0.55 && roleScore >= 0.7 && (yDiff === null || yDiff <= 0.22 || contextSimilarity >= 0.4)) {
    return 'high'
  }
  if (matchScore >= 60 && normalizedSimilarity >= 0.42) return 'medium'
  return 'low'
}

function comparePairsForSelection(first, second) {
  if (second.matchScore !== first.matchScore) return second.matchScore - first.matchScore
  if (second.matchConfidence !== first.matchConfidence) return confidenceRank(second.matchConfidence) - confidenceRank(first.matchConfidence)
  return second.matchReasons.length - first.matchReasons.length
}

function confidenceRank(value) {
  if (value === 'high') return 3
  if (value === 'medium') return 2
  return 1
}

function stripPairIndexes(pair) {
  const result = { ...pair }
  delete result.figmaIndex
  delete result.webIndex
  delete result.rejected
  return result
}

function getDifference(first, second) {
  if (!Number.isFinite(first) || !Number.isFinite(second)) return null
  return Math.abs(first - second)
}

function getProximityScore(difference, threshold) {
  if (!Number.isFinite(difference)) return 0
  return Math.max(0, 1 - difference / threshold)
}

function getRelativeSimilarity(first, second, threshold) {
  if (!Number.isFinite(first) || !Number.isFinite(second) || first <= 0 || second <= 0) return 0
  const ratio = Math.min(first, second) / Math.max(first, second)
  if (ratio >= 1 - threshold) return ratio
  return 0
}

function getSiblingSimilarity(first, second) {
  if (!Number.isInteger(first) || !Number.isInteger(second)) return 0
  const difference = Math.abs(first - second)
  return Math.max(0, 1 - difference / 6)
}

function getLengthRatio(first, second) {
  const firstLength = String(first || '').length
  const secondLength = String(second || '').length
  if (!firstLength || !secondLength) return 0
  return Math.min(firstLength, secondLength) / Math.max(firstLength, secondLength)
}

function normalizeNumber(value) {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? Math.round(numeric * 1000000) / 1000000 : null
}

function normalizeInteger(value) {
  const numeric = Number(value)
  return Number.isInteger(numeric) ? numeric : null
}

function roundScore(value) {
  return Math.round(value * 100) / 100
}

function looksLikeCtaText(text) {
  const value = String(text || '').replace(/\s+/g, ' ').trim()
  if (!value || value.length > 24) return false
  return /신청|예약|상담|자세히|더\s*보기|구매|시작|문의|바로가기|확인|submit|apply|learn more|start/i.test(value)
}

function looksLikePriceText(text) {
  return /(?:₩|\$|€|¥|원|만원|krw|usd|eur|jpy|%|연\s*\d)/i.test(String(text || '')) && /\d/.test(String(text || ''))
}

function looksLikeDateText(text) {
  return /(\d{4}[./-]\d{1,2}[./-]\d{1,2}|\d{1,2}[./-]\d{1,2}|\d+\s*(일|개월|년|월))/i.test(String(text || ''))
}

function looksLikeLegalText(text) {
  const value = String(text || '')
  return value.length >= 40 && /약관|유의사항|개인정보|법적|고지|면책|동의|copyright|all rights reserved/i.test(value)
}
