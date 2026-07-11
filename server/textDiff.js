export function createTextDifferenceCandidates(matchedPairs) {
  return matchedPairs
    .filter((pair) => pair.matchConfidence === 'high' || (pair.matchConfidence === 'medium' && pair.matchScore >= 60))
    .filter((pair) => shouldCreateDifference(pair))
    .map((pair) => ({
      type: 'text',
      category: inferTextDifferenceCategory(pair.figmaNode?.characters, pair.webElement?.rawText || pair.webElement?.text),
      title: '문구가 다릅니다.',
      figmaText: pair.figmaNode?.characters || '',
      webText: pair.webElement?.rawText || pair.webElement?.text || '',
      matchScore: pair.matchScore,
      matchConfidence: pair.matchConfidence,
      figmaNodeId: pair.figmaNode?.nodeId || pair.figmaNode?.id || null,
      webSelector: pair.webElement?.selector || null,
      evidence: createDifferenceEvidence(pair),
    }))
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
