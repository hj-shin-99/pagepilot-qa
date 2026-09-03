import { inferFigmaSectionHint, inferFigmaTextRole, inferWebSectionHint, normalizeTextForMatching } from './textMatcher.js'
import { inferWebTextRole } from './webText.js'

const RECOVERY_MAX_Y_DIFF = 0.06
const RECOVERY_MAX_X_DIFF = 0.08
const RECOVERY_LOCAL_ANCHOR_DIFF = 0.12

export function createTextDifferenceCandidates(matchedPairs = [], matchResult = null) {
  const pairs = Array.isArray(matchedPairs) ? matchedPairs : []
  const matchedDifferences = pairs
    .filter((pair) => pair.matchConfidence === 'high' || (pair.matchConfidence === 'medium' && pair.matchScore >= 60))
    .filter((pair) => shouldCreateDifference(pair))
    .map(createDifferenceCandidate)

  return [
    ...matchedDifferences,
    ...createUnmatchedTextDifferenceCandidates(matchResult, pairs),
  ]
}

export function shouldCreateDifference(pair) {
  const figmaText = String(pair?.figmaNode?.characters || '')
  const webText = String(pair?.webElement?.rawText || pair?.webElement?.text || '')
  if (!figmaText || !webText) return false
  if (figmaText === webText) return false
  if (isVisualLinebreakOnlyDifference(figmaText, webText)) return false
  return true
}

export function isVisualLinebreakOnlyDifference(first, second) {
  return collapseWhitespace(first) === collapseWhitespace(second)
}

function inferTextDifferenceCategory(figmaText, webText) {
  const combined = `${figmaText || ''} ${webText || ''}`
  if (hasPricePattern(combined)) return 'price'
  if (hasDatePattern(combined)) return 'date'
  if (hasNumericPattern(combined)) return 'number'
  if (looksLikeCtaText(combined)) return 'cta'
  return 'copy'
}

function createDifferenceEvidence(pair) {
  return [
    pair.matchReasons?.[0],
    pair.matchReasons?.[1],
    pair.figmaNode?.layerPath ? `Figma: ${pair.figmaNode.layerPath}` : '',
    pair.webElement?.selector ? `Web: ${pair.webElement.selector}` : '',
  ].filter(Boolean)
}

function createDifferenceCandidate(pair) {
  return {
    type: 'text',
    category: inferTextDifferenceCategory(pair.figmaNode?.characters, pair.webElement?.rawText || pair.webElement?.text),
    title: '문구가 다릅니다.',
    figmaText: pair.figmaNode?.characters || '',
    webText: pair.webElement?.rawText || pair.webElement?.text || '',
    matchScore: pair.matchScore,
    matchConfidence: pair.matchConfidence,
    figmaNodeId: pair.figmaNode?.nodeId || pair.figmaNode?.id || null,
    webSelector: pair.webElement?.selector || null,
    figmaYRatio: normalizeNumber(pair.figmaNode?.yRatio),
    webYRatio: normalizeNumber(pair.webElement?.yRatio),
    figmaXRatio: normalizeNumber(pair.figmaNode?.xRatio),
    webXRatio: normalizeNumber(pair.webElement?.xRatio),
    evidence: createDifferenceEvidence(pair),
  }
}

function createUnmatchedTextDifferenceCandidates(matchResult, matchedPairs) {
  const figmaOnly = Array.isArray(matchResult?.figmaOnly) ? matchResult.figmaOnly : []
  const webOnly = Array.isArray(matchResult?.webOnly) ? matchResult.webOnly : []
  if (!figmaOnly.length || !webOnly.length) return []

  const candidates = []
  figmaOnly.forEach((figmaNode) => {
    webOnly.forEach((webElement) => {
      const candidate = createRecoveredCandidate(figmaNode, webElement, matchedPairs)
      if (candidate) candidates.push(candidate)
    })
  })

  const figmaCandidateCounts = countBy(candidates, (candidate) => candidate.figmaNodeId)
  const webCandidateCounts = countBy(candidates, (candidate) => candidate.webSelector || candidate.webId)

  return candidates
    .filter((candidate) => figmaCandidateCounts.get(candidate.figmaNodeId) === 1)
    .filter((candidate) => webCandidateCounts.get(candidate.webSelector || candidate.webId) === 1)
    .sort((first, second) => second.matchScore - first.matchScore)
}

function createRecoveredCandidate(figmaNode, webElement, matchedPairs) {
  const figmaText = String(figmaNode?.characters || '')
  const webText = String(webElement?.rawText || webElement?.text || '')
  if (!isMeaningfulText(figmaText) || !isMeaningfulText(webText)) return null
  if (!shouldCreateDifference({ figmaNode, webElement })) return null

  const figmaRole = inferFigmaTextRole(figmaNode)
  const webRole = webElement?.role || inferWebTextRole(webElement)
  if (!areRolesStructurallyCompatible(figmaRole, webRole)) return null

  const figmaYRatio = normalizeNumber(figmaNode?.yRatio)
  const webYRatio = normalizeNumber(webElement?.yRatio)
  const yDiff = getDifference(figmaYRatio, webYRatio)
  if (yDiff === null || yDiff > RECOVERY_MAX_Y_DIFF) return null

  const figmaSection = inferFigmaSectionHint(figmaNode)
  const webSection = String(webElement?.sectionHint || '').toLowerCase() || inferWebSectionHint(webElement)
  if (areKnownSectionsIncompatible(figmaSection, webSection)) return null

  const signals = [`세로 위치가 매우 가깝습니다. (yRatio diff ${formatRatio(yDiff)})`]
  const xDiff = getDifference(normalizeNumber(figmaNode?.xRatio), normalizeNumber(webElement?.xRatio))
  if (xDiff !== null && xDiff <= RECOVERY_MAX_X_DIFF) signals.push(`가로 위치가 가깝습니다. (xRatio diff ${formatRatio(xDiff)})`)

  const fontSimilarity = getRelativeSimilarity(normalizeNumber(figmaNode?.fontSize), normalizeNumber(webElement?.fontSize))
  if (fontSimilarity >= 0.75) signals.push('fontSize가 유사합니다.')

  const widthSimilarity = getRelativeSimilarity(normalizeNumber(figmaNode?.widthRatio), normalizeNumber(webElement?.widthRatio))
  if (widthSimilarity >= 0.55) signals.push('텍스트 박스 폭이 유사합니다.')

  const contextSimilarity = getContextSimilarity(createFigmaContext(figmaNode), createWebContext(webElement))
  if (contextSimilarity >= 0.2) signals.push('contextPath가 유사합니다.')

  const siblingDiff = getDifference(normalizeInteger(figmaNode?.siblingIndex), normalizeInteger(webElement?.siblingIndex))
  if (siblingDiff !== null && siblingDiff <= 2) signals.push('siblingIndex가 가깝습니다.')

  if (areSectionsCompatible(figmaSection, webSection)) signals.push(`sectionHint가 호환됩니다. (${figmaSection}/${webSection})`)

  const hasAnchorSupport = hasLocalAnchorSupport(figmaNode, webElement, matchedPairs)
  if (hasAnchorSupport) signals.push('주변 matched text와 같은 로컬 구조에 있습니다.')

  if (signals.length < 4 && !(hasAnchorSupport && signals.length >= 3)) return null

  return {
    type: 'text',
    category: inferTextDifferenceCategory(figmaText, webText),
    title: '문구가 다릅니다.',
    figmaText,
    webText,
    matchScore: Math.min(78, 60 + signals.length * 3 + (hasAnchorSupport ? 3 : 0)),
    matchConfidence: 'medium',
    figmaNodeId: figmaNode?.nodeId || figmaNode?.id || null,
    webId: webElement?.id || null,
    webSelector: webElement?.selector || null,
    figmaYRatio,
    webYRatio,
    figmaXRatio: normalizeNumber(figmaNode?.xRatio),
    webXRatio: normalizeNumber(webElement?.xRatio),
    recovered: true,
    evidence: [
      'unmatched figmaOnly/webOnly 텍스트를 로컬 구조 근거로 복구했습니다.',
      `role이 호환됩니다. (${figmaRole}/${webRole})`,
      ...signals,
    ],
  }
}

function isMeaningfulText(value) {
  const normalized = normalizeTextForMatching(value)
  if (normalized.length < 2) return false
  return /[0-9a-z가-힣]/i.test(normalized)
}

function areRolesStructurallyCompatible(figmaRole, webRole) {
  if (!figmaRole || !webRole || figmaRole === 'unknown' || webRole === 'unknown') return false
  if (figmaRole === webRole) return true
  const pairKey = `${figmaRole}:${webRole}`
  return new Set([
    'heading:body',
    'body:heading',
    'label:body',
    'body:label',
    'navigation:cta',
    'cta:navigation',
  ]).has(pairKey)
}

function areKnownSectionsIncompatible(figmaSection, webSection) {
  if (!figmaSection || !webSection || figmaSection === 'unknown' || webSection === 'unknown') return false
  return !areSectionsCompatible(figmaSection, webSection)
}

function areSectionsCompatible(figmaSection, webSection) {
  if (!figmaSection || !webSection) return false
  if (figmaSection === webSection) return true
  const pair = new Set([figmaSection, webSection])
  return (pair.has('hero') && pair.has('top'))
    || (pair.has('legal') && pair.has('footer'))
    || (pair.has('navigation') && pair.has('top'))
}

function hasLocalAnchorSupport(figmaNode, webElement, matchedPairs) {
  if (!Array.isArray(matchedPairs) || matchedPairs.length === 0) return false
  const figmaYRatio = normalizeNumber(figmaNode?.yRatio)
  const webYRatio = normalizeNumber(webElement?.yRatio)
  if (!Number.isFinite(figmaYRatio) || !Number.isFinite(webYRatio)) return false

  return matchedPairs.some((pair) => {
    const anchorFigmaY = normalizeNumber(pair?.figmaNode?.yRatio)
    const anchorWebY = normalizeNumber(pair?.webElement?.yRatio)
    if (!Number.isFinite(anchorFigmaY) || !Number.isFinite(anchorWebY)) return false
    if (Math.abs(anchorFigmaY - figmaYRatio) > RECOVERY_LOCAL_ANCHOR_DIFF) return false
    if (Math.abs(anchorWebY - webYRatio) > RECOVERY_LOCAL_ANCHOR_DIFF) return false
    return Math.sign(anchorFigmaY - figmaYRatio) === Math.sign(anchorWebY - webYRatio)
      || Math.abs(anchorFigmaY - figmaYRatio) <= 0.02
      || Math.abs(anchorWebY - webYRatio) <= 0.02
  })
}

function countBy(items, getKey) {
  const counts = new Map()
  items.forEach((item) => {
    const key = getKey(item)
    if (!key) return
    counts.set(key, (counts.get(key) || 0) + 1)
  })
  return counts
}

function createFigmaContext(node) {
  return `${node?.layerPath || ''} ${node?.parentFrameName || ''} ${node?.name || ''}`
}

function createWebContext(element) {
  return `${element?.domPath || ''} ${element?.selector || ''} ${element?.sectionHint || ''}`
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

function getDifference(first, second) {
  if (!Number.isFinite(first) || !Number.isFinite(second)) return null
  return Math.abs(first - second)
}

function getRelativeSimilarity(first, second) {
  if (!Number.isFinite(first) || !Number.isFinite(second) || first <= 0 || second <= 0) return 0
  return Math.min(first, second) / Math.max(first, second)
}

function normalizeNumber(value) {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? Math.round(numeric * 1000000) / 1000000 : null
}

function normalizeInteger(value) {
  const numeric = Number(value)
  return Number.isInteger(numeric) ? numeric : null
}

function formatRatio(value) {
  return Number.isFinite(value) ? value.toFixed(3) : 'unknown'
}

function collapseWhitespace(value) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

function hasNumericPattern(value) {
  return /\d/.test(String(value || ''))
}

function hasPricePattern(value) {
  return /(?:₩|\$|€|¥|원|만원|krw|usd|eur|jpy|%|연\s*\d)/i.test(String(value || '')) && /\d/.test(String(value || ''))
}

function hasDatePattern(value) {
  return /(\d{4}[./-]\d{1,2}[./-]\d{1,2}|\d{1,2}[./-]\d{1,2}|\d+\s*(일|개월|년|월))/i.test(String(value || ''))
}

function looksLikeCtaText(value) {
  const text = String(value || '').replace(/\s+/g, ' ').trim()
  if (!text || text.length > 24) return false
  return /신청|예약|상담|자세히|더\s*보기|구매|시작|문의|바로가기|확인|submit|apply|learn more|start/i.test(text)
}
