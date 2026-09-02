import { shouldCreateDifference } from './textDiff.js'

const MAX_TEXT_ITEMS = 160
const MAX_MATCHED_PAIRS = 120
const MAX_PAIR_CANDIDATES = 300
const MAX_REJECTED_CANDIDATES = 120
const MAX_DIFFERENCES = 80
const MAX_TEXT_LENGTH = 300

export function createVisualTextDiagnostics({ figmaResult, webAnalysis, matchResult, differences, payload } = {}) {
  const figmaTextNodes = arrayOfObjects(figmaResult?.textNodes)
  const webTextNodes = arrayOfObjects(webAnalysis?.textNodes)
  const matchedPairs = arrayOfObjects(matchResult?.matchedPairs)
  const figmaOnly = arrayOfObjects(matchResult?.figmaOnly)
  const webOnly = arrayOfObjects(matchResult?.webOnly)
  const allPairs = arrayOfObjects(matchResult?.allPairs)
  const differenceCandidates = arrayOfObjects(differences)
  const selectedKeys = createSelectedPairKeys(matchedPairs)
  const consumedFigmaIds = new Set(matchedPairs.map((pair) => getFigmaSourceId(pair.figmaNode)).filter(Boolean))
  const consumedWebIds = new Set(matchedPairs.map((pair) => getWebSourceId(pair.webElement)).filter(Boolean))
  const pairCandidates = allPairs.map((pair) => createPairCandidateDiagnostic(pair, selectedKeys, consumedFigmaIds, consumedWebIds))
  const rejectedMatchedPairs = matchedPairs
    .filter((pair) => !hasDifferenceForPair(pair, differenceCandidates))
    .map(createRejectedMatchedPairDiagnostic)

  return {
    schemaVersion: 'visual-text-diagnostics-v1',
    generatedAt: new Date().toISOString(),
    bounded: true,
    limits: {
      textItems: MAX_TEXT_ITEMS,
      matchedPairs: MAX_MATCHED_PAIRS,
      pairCandidates: MAX_PAIR_CANDIDATES,
      rejectedCandidates: MAX_REJECTED_CANDIDATES,
      differences: MAX_DIFFERENCES,
      textLength: MAX_TEXT_LENGTH,
    },
    summary: {
      figmaTextCount: figmaTextNodes.length,
      webTextCount: webTextNodes.length,
      matchedCount: matchedPairs.length,
      figmaOnlyCount: figmaOnly.length,
      webOnlyCount: webOnly.length,
      differenceCandidateCount: differenceCandidates.length,
      allPairCount: allPairs.length,
      selectedPairCount: selectedKeys.size,
      rejectedMatchedPairCount: rejectedMatchedPairs.length,
      rejectedUnmatchedCandidateCount: pairCandidates.filter((pair) => pair.selectionStatus !== 'matched').length,
    },
    figmaText: {
      items: figmaTextNodes.slice(0, MAX_TEXT_ITEMS).map(createFigmaTextDiagnostic),
      topRegionMeaningful: figmaTextNodes.filter(isTopRegionMeaningfulText).slice(0, 40).map(createFigmaTextDiagnostic),
    },
    webText: {
      items: webTextNodes.slice(0, MAX_TEXT_ITEMS).map(createWebTextDiagnostic),
      topRegionMeaningful: webTextNodes.filter(isTopRegionMeaningfulText).slice(0, 60).map(createWebTextDiagnostic),
    },
    matching: {
      summary: matchResult?.summary || payload?.comparison || {},
      matchedPairs: matchedPairs.slice(0, MAX_MATCHED_PAIRS).map(createMatchedPairDiagnostic),
      figmaOnly: figmaOnly.slice(0, MAX_TEXT_ITEMS).map(createFigmaTextDiagnostic),
      webOnly: webOnly.slice(0, MAX_TEXT_ITEMS).map(createWebTextDiagnostic),
      consumedSourceIds: {
        figma: [...consumedFigmaIds].slice(0, MAX_TEXT_ITEMS),
        web: [...consumedWebIds].slice(0, MAX_TEXT_ITEMS),
      },
      pairCandidates: pairCandidates.sort(comparePairCandidateDiagnostics).slice(0, MAX_PAIR_CANDIDATES),
    },
    textDifferenceCandidates: {
      matchedDifferenceCandidates: differenceCandidates.slice(0, MAX_DIFFERENCES).map(createDifferenceDiagnostic),
      rejectedMatchedPairs: rejectedMatchedPairs.slice(0, MAX_REJECTED_CANDIDATES),
      rejectedUnmatchedPairCandidates: pairCandidates
        .filter((pair) => pair.selectionStatus !== 'matched' && pair.meaningfulTextDelta !== 'none')
        .sort(comparePairCandidateDiagnostics)
        .slice(0, MAX_REJECTED_CANDIDATES),
    },
    finalFlow: createFinalFlowDiagnostic(payload),
    safety: {
      openAiCalled: false,
      rawPromptIncluded: false,
      rawAiResponseIncluded: false,
      rawReferenceDataIncluded: false,
    },
  }
}

function createFigmaTextDiagnostic(node = {}) {
  return {
    sourceId: getFigmaNodeId(node),
    parentId: normalizeText(node.parentId),
    layerPath: normalizeText(node.layerPath || node.path || node.name),
    text: normalizeText(node.characters || node.text),
    bbox: createBox(node.absoluteBoundingBox || node.boundingBox || node.bbox),
    xRatio: normalizeNumber(node.xRatio),
    yRatio: normalizeNumber(node.yRatio),
    widthRatio: normalizeNumber(node.widthRatio),
    heightRatio: normalizeNumber(node.heightRatio),
    role: normalizeText(node.role || node.textRole),
    context: normalizeText(node.parentFrameName || node.sectionHint || node.contextPath),
    effectivelyVisible: node.effectivelyVisible !== false,
  }
}

function createWebTextDiagnostic(element = {}) {
  return {
    sourceId: getWebSourceId(element),
    selector: normalizeText(element.selector),
    parentSelector: normalizeText(element.parentSelector),
    ancestorIdentity: normalizeText(element.ancestorIdentity || element.domPath || element.parentSelector),
    text: normalizeText(element.rawText || element.text),
    bbox: createBox(element.absoluteBoundingBox || element.relativeBoundingBox || element.boundingBox || element.bbox),
    xRatio: normalizeNumber(element.xRatio),
    yRatio: normalizeNumber(element.yRatio),
    widthRatio: normalizeNumber(element.widthRatio),
    heightRatio: normalizeNumber(element.heightRatio),
    role: normalizeText(element.role),
    context: normalizeText(element.sectionHint || element.domPath),
    visible: element.visible !== false,
    aggregateParent: element.aggregateParent === true || element.isAggregateParent === true || element.hasDescendantText === true,
    descendantTextActionRelation: normalizeText(element.descendantTextActionRelation || element.actionRelation || element.interactionOutcome),
  }
}

function createMatchedPairDiagnostic(pair = {}) {
  return {
    pairKey: createPairKey(pair),
    figma: createFigmaTextDiagnostic(pair.figmaNode),
    web: createWebTextDiagnostic(pair.webElement),
    matchScore: normalizeNumber(pair.matchScore),
    matchConfidence: normalizeText(pair.matchConfidence),
    matchReasons: normalizeStringArray(pair.matchReasons, 8),
    rejectReasons: normalizeStringArray(pair.rejectReasons, 8),
    scoreComponents: pair.diagnostics || null,
    textEqual: pair.rawTextEqual === true,
    normalizedTextEqual: pair.normalizedTextEqual === true,
  }
}

function createPairCandidateDiagnostic(pair = {}, selectedKeys, consumedFigmaIds, consumedWebIds) {
  const figmaId = getFigmaSourceId(pair.figmaNode)
  const webId = getWebSourceId(pair.webElement)
  const selected = selectedKeys.has(createPairKey(pair))
  const hardRejected = Array.isArray(pair.rejectReasons) && pair.rejectReasons.length > 0
  const eligible = Number(pair.matchScore || 0) >= 45 && !hardRejected
  const consumedByOther = !selected && (consumedFigmaIds.has(figmaId) || consumedWebIds.has(webId))
  const selectionStatus = selected ? 'matched' : hardRejected ? 'hard-rejected' : !eligible ? 'below-threshold' : consumedByOther ? 'source-reuse-conflict' : 'eligible-unselected'
  return {
    pairKey: createPairKey(pair),
    selectionStatus,
    rejectionGate: hardRejected ? 'context-role-hard-reject' : !eligible ? 'score-below-45' : consumedByOther ? 'greedy-source-reuse' : '',
    meaningfulTextDelta: classifyTextDelta(pair),
    figma: createFigmaTextDiagnostic(pair.figmaNode),
    web: createWebTextDiagnostic(pair.webElement),
    matchScore: normalizeNumber(pair.matchScore),
    matchConfidence: normalizeText(pair.matchConfidence),
    matchReasons: normalizeStringArray(pair.matchReasons, 8),
    rejectReasons: normalizeStringArray(pair.rejectReasons, 8),
    scoreComponents: pair.diagnostics || null,
  }
}

function createRejectedMatchedPairDiagnostic(pair = {}) {
  return {
    ...createMatchedPairDiagnostic(pair),
    rejectionGate: getDifferenceRejectionGate(pair),
    meaningfulTextDelta: classifyTextDelta(pair),
  }
}

function createDifferenceDiagnostic(difference = {}) {
  return {
    type: normalizeText(difference.type),
    category: normalizeText(difference.category),
    title: normalizeText(difference.title),
    figmaText: normalizeText(difference.figmaText || difference.text),
    webText: normalizeText(difference.webText),
    matchScore: normalizeNumber(difference.matchScore),
    matchConfidence: normalizeText(difference.matchConfidence || difference.confidence),
    figmaNodeId: normalizeText(difference.figmaNodeId),
    webSelector: normalizeText(difference.webSelector),
    evidence: normalizeStringArray(difference.evidence, 8),
    provenance: sanitizeObject(difference.provenance, 6),
  }
}

function createFinalFlowDiagnostic(payload = {}) {
  const comparisonDifferences = arrayOfObjects(payload?.comparison?.differences).slice(0, MAX_DIFFERENCES).map(createDifferenceDiagnostic)
  return {
    comparison: {
      matchedCount: normalizeNumber(payload?.comparison?.matchedCount),
      differenceCount: normalizeNumber(payload?.comparison?.differenceCount),
      figmaOnlyCount: normalizeNumber(payload?.comparison?.figmaOnlyCount),
      webOnlyCount: normalizeNumber(payload?.comparison?.webOnlyCount),
      differences: comparisonDifferences,
    },
    canonicalEvidence: {
      hero: sanitizeObject(payload?.aiHints?.heroSection, 10),
      heroCtaGroup: sanitizeObject(payload?.aiHints?.heroCtaGroup, 10),
      heroMediaGroup: sanitizeObject(payload?.aiHints?.heroMediaGroup, 10),
      prices: arrayOfObjects(payload?.aiHints?.prices).slice(0, 30).map((item) => sanitizeObject(item, 10)),
      media: arrayOfObjects(payload?.aiHints?.media).slice(0, 30).map((item) => sanitizeObject(item, 10)),
    },
    displayAndCoreInputs: {
      comparisonDifferences,
      aiReviewVisualDifferencesIncluded: false,
      note: 'Client display/core issue models are computed after Visual QA render from result plus AI review. This server artifact stores bounded inputs and provenance without raw AI response.',
    },
  }
}

function getDifferenceRejectionGate(pair) {
  const confidence = pair?.matchConfidence
  const score = Number(pair?.matchScore || 0)
  if (!(confidence === 'high' || (confidence === 'medium' && score >= 60))) return 'confidence-or-score-gate'
  if (!pair?.figmaNode?.characters || !(pair?.webElement?.rawText || pair?.webElement?.text)) return 'missing-text'
  if (!shouldCreateDifference(pair)) return pair?.figmaNode?.characters === (pair?.webElement?.rawText || pair?.webElement?.text) ? 'text-equal' : 'trivial-text-difference'
  return 'unknown'
}

function hasDifferenceForPair(pair, differences) {
  const figmaId = getFigmaSourceId(pair?.figmaNode)
  const webSelector = normalizeText(pair?.webElement?.selector)
  return differences.some((difference) => normalizeText(difference.figmaNodeId) === figmaId && normalizeText(difference.webSelector) === webSelector)
}

function createSelectedPairKeys(matchedPairs) {
  return new Set(matchedPairs.map(createPairKey).filter(Boolean))
}

function createPairKey(pair = {}) {
  return `${getFigmaSourceId(pair.figmaNode)}::${getWebSourceId(pair.webElement)}`
}

function getFigmaSourceId(node = {}) {
  return normalizeText(getFigmaNodeId(node))
}

function getFigmaNodeId(node = {}) {
  return node?.nodeId || node?.id || ''
}

function getWebSourceId(element = {}) {
  return normalizeText(element?.id || element?.selector || '')
}

function classifyTextDelta(pair = {}) {
  const figmaText = String(pair?.figmaNode?.characters || '')
  const webText = String(pair?.webElement?.rawText || pair?.webElement?.text || '')
  if (!figmaText || !webText) return 'missing-text'
  if (figmaText === webText || pair.rawTextEqual === true || pair.normalizedTextEqual === true) return 'none'
  if (!shouldCreateDifference(pair)) return 'trivial'
  return 'meaningful'
}

function comparePairCandidateDiagnostics(left, right) {
  const statusOrder = { matched: 0, 'source-reuse-conflict': 1, 'below-threshold': 2, 'hard-rejected': 3, 'eligible-unselected': 4 }
  const statusDiff = (statusOrder[left.selectionStatus] ?? 9) - (statusOrder[right.selectionStatus] ?? 9)
  if (statusDiff !== 0) return statusDiff
  const topDiff = topRegionRank(left) - topRegionRank(right)
  if (topDiff !== 0) return topDiff
  return Number(right.matchScore || 0) - Number(left.matchScore || 0)
}

function topRegionRank(pair) {
  const figmaY = Number(pair?.figma?.yRatio)
  const webY = Number(pair?.web?.yRatio)
  return (Number.isFinite(figmaY) && figmaY <= 0.4) || (Number.isFinite(webY) && webY <= 0.4) ? 0 : 1
}

function isTopRegionMeaningfulText(item = {}) {
  const text = String(item.characters || item.rawText || item.text || '').replace(/\s+/g, ' ').trim()
  const yRatio = Number(item.yRatio)
  return text.length >= 2 && Number.isFinite(yRatio) && yRatio <= 0.4
}

function createBox(box = {}) {
  if (!box || typeof box !== 'object' || Array.isArray(box)) return null
  return {
    x: normalizeNumber(box.x),
    y: normalizeNumber(box.y),
    width: normalizeNumber(box.width),
    height: normalizeNumber(box.height),
  }
}

function sanitizeObject(value, maxKeys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return Object.fromEntries(Object.entries(value).slice(0, maxKeys).map(([key, entry]) => [key, sanitizeValue(entry, 2)]))
}

function sanitizeValue(value, depth) {
  if (depth <= 0) return normalizeText(value)
  if (Array.isArray(value)) return value.slice(0, 12).map((entry) => sanitizeValue(entry, depth - 1))
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).slice(0, 12).map(([key, entry]) => [key, sanitizeValue(entry, depth - 1)]))
  if (typeof value === 'number') return normalizeNumber(value)
  if (typeof value === 'boolean') return value
  return normalizeText(value)
}

function normalizeStringArray(values, limit) {
  return Array.isArray(values) ? values.slice(0, limit).map(normalizeText).filter(Boolean) : []
}

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT_LENGTH)
}

function normalizeNumber(value) {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? Math.round(numeric * 1000000) / 1000000 : null
}

function arrayOfObjects(value) {
  return Array.isArray(value) ? value.filter((item) => item && typeof item === 'object' && !Array.isArray(item)) : []
}
