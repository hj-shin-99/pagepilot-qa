import { inferWebTextRole } from './webText.js'

const HARD_REJECT_SCORE = -1

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
  if (/hero|kv|banner|main_visual/.test(searchable)) return 'hero'

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
        ...pair,
      })
    })
  })

  const candidatePairs = allPairs
    .filter((pair) => !pair.rejected && pair.matchScore >= 45)
    .sort(comparePairsForSelection)

  const usedFigma = new Set()
  const usedWeb = new Set()
  const matchedPairs = []

  candidatePairs.forEach((pair) => {
    if (usedFigma.has(pair.figmaIndex) || usedWeb.has(pair.webIndex)) return
    usedFigma.add(pair.figmaIndex)
    usedWeb.add(pair.webIndex)
    matchedPairs.push(stripPairIndexes(pair))
  })

  const figmaOnly = figmaItems
    .filter((_, index) => !usedFigma.has(index))
    .map((item) => item.ref)
  const webOnly = webItems
    .filter((_, index) => !usedWeb.has(index))
    .map((item) => item.ref)

  return {
    matchedPairs,
    figmaOnly,
    webOnly,
    allPairs: options.includeAllPairs ? allPairs.map(stripPairIndexes) : [],
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
