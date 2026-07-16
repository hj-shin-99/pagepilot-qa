const CTA_ROLES = new Set(['primary-action', 'secondary-action'])
const PRICE_TYPES = new Set(['amount', 'percentage', 'interest-rate', 'monthly-payment', 'duration', 'date'])
const INTERNAL_LABELS = ['canonicalEvidence', 'payloadVersion', 'openAiCalled', 'playwrightRunCount']

export function createFigmaImageUrl(figma = {}) {
  const displayImageUrl = getTrustedDisplayImageUrl(figma.displayImageUrl)
  if (displayImageUrl) return displayImageUrl

  const renderId = getString(figma.renderId)
  if (renderId) return `/api/figma/render/${encodeURIComponent(renderId)}`

  const imageUrl = getString(figma.imageUrl || figma.image)
  if (!imageUrl) return ''
  if (/^https?:\/\//.test(imageUrl) || imageUrl.startsWith('data:') || imageUrl.startsWith('/api/')) return imageUrl

  return ''
}

export function createWebScreenshotUrl(path) {
  const value = getString(path)
  if (!value) return ''
  if (/^https?:\/\//.test(value) || value.startsWith('data:') || value.startsWith('/api/')) return value
  if (value.includes('..')) return ''

  const normalized = value.replace(/\\/g, '/')
  const fileName = normalized.split('/').filter(Boolean).at(-1) || ''
  if (!/^[a-f0-9]{24}\.png$/i.test(fileName)) return ''

  return `/api/visual/screenshot/${encodeURIComponent(fileName)}`
}

export function createWebDisplayImageUrl(web = {}) {
  const displayImageUrl = getTrustedDisplayImageUrl(web.displayImageUrl)
  if (displayImageUrl) return displayImageUrl
  return createWebScreenshotUrl(web.localImagePath || web.screenshotPath || web.imageUrl || web.image)
}

export function createVisualIssueCards(result = {}) {
  const cards = []
  const comparison = result.comparison || {}
  const differences = Array.isArray(comparison.differences) ? comparison.differences : []
  const aiHints = result.aiHints || {}
  const heroCtaGroup = aiHints.heroCtaGroup || {}
  const heroMediaGroup = aiHints.heroMediaGroup || {}

  differences.slice(0, 12).forEach((item) => {
    cards.push(createTextDifferenceCard(item))
  })

  if (Number(heroCtaGroup.countDifference || 0) > 0) {
    cards.push({
      category: 'cta-count',
      severity: 'warning',
      title: 'Hero CTA 개수가 다릅니다.',
      detail: `Figma ${heroCtaGroup.figma?.count || 0}개 / Web ${heroCtaGroup.web?.count || 0}개`,
      figmaText: String(heroCtaGroup.figma?.count || 0),
      webText: String(heroCtaGroup.web?.count || 0),
      entityKey: 'hero-cta-count',
      technical: 'Hero CTA count mismatch',
    })
  }

  createHeroCtaTextDifferenceCards(heroCtaGroup, differences).forEach((card) => cards.push(card))

  const mediaCard = createHeroMediaCard(heroMediaGroup)
  if (mediaCard) cards.push(mediaCard)

  const dedupedCards = dedupeIssueCards(cards)
  if (dedupedCards.length > 0) return dedupedCards

  return [{
    category: 'check',
    severity: 'check',
    title: '주요 차이를 찾지 못했습니다.',
    detail: '자동 규칙 기준으로 Critical 또는 Warning 항목이 없습니다.',
    figmaText: '',
    webText: '',
    entityKey: 'no-major-difference',
    technical: 'No major visual QA issue generated',
  }]
}

export function countIssueCards(cards = []) {
  return cards.reduce((counts, card) => ({
    ...counts,
    [card.severity]: counts[card.severity] + 1,
  }), { critical: 0, warning: 0, check: 0 })
}

export function createHeroSummary(aiHints = {}) {
  const evidenceHero = aiHints.evidenceSummary?.hero || {}
  const heroMediaGroup = aiHints.heroMediaGroup || {}
  const heroCtaGroup = aiHints.heroCtaGroup || {}

  return {
    figmaTextCount: Number(evidenceHero.figmaTextCount || 0),
    webTextCount: Number(evidenceHero.webTextCount || 0),
    figmaCtaCount: Number(evidenceHero.figmaCtaCount ?? heroCtaGroup.figma?.count ?? 0),
    webCtaCount: Number(evidenceHero.webCtaCount ?? heroCtaGroup.web?.count ?? 0),
    figmaMediaTypes: arrayOfStrings(evidenceHero.figmaMediaTypes || heroMediaGroup.figma?.mediaTypes),
    webMediaTypes: arrayOfStrings(evidenceHero.webMediaTypes || heroMediaGroup.web?.mediaTypes),
  }
}

export function createActionItems(aiHints = {}) {
  const actions = [
    ...(Array.isArray(aiHints.heroCtaGroup?.figma?.actions) ? aiHints.heroCtaGroup.figma.actions : []),
    ...(Array.isArray(aiHints.heroCtaGroup?.web?.actions) ? aiHints.heroCtaGroup.web.actions : []),
    ...(Array.isArray(aiHints.ctaButtons) ? aiHints.ctaButtons : []),
  ]

  return dedupeEntities(actions)
    .filter((item) => CTA_ROLES.has(item.role))
    .filter((item) => ['primary', 'secondary', ''].includes(getString(item.comparisonScope)))
    .filter((item) => !isReferenceOnly(item))
    .slice(0, 8)
    .map((item, index) => ({
      id: item.entityId || `action-${index}`,
      title: item.text || item.displayText || 'CTA',
      detail: `${formatSource(item.source)} · ${formatRole(item.role)}`,
      meta: item.href || '',
      sectionRole: item.sectionRole || inferSectionRole(item),
      technical: item.sectionPath || item.contextPath || item.selector || '',
    }))
}

export function createOtherInteractionItems(aiHints = {}) {
  const interactions = Array.isArray(aiHints.interactions?.allActions) ? aiHints.interactions.allActions : []
  return dedupeEntities(interactions)
    .filter((item) => !CTA_ROLES.has(item.role))
    .slice(0, 8)
    .map((item, index) => ({
      id: item.entityId || `other-action-${index}`,
      title: item.text || item.displayText || item.role || 'Interaction',
      detail: `${formatSource(item.source)} · ${formatRole(item.role)}`,
      meta: item.href || '',
    }))
}

export function createPriceItems(aiHints = {}, comparison = {}) {
  const prices = Array.isArray(aiHints.prices) ? aiHints.prices : []
  const differences = Array.isArray(comparison.differences) ? comparison.differences : []

  return prices
    .filter((item) => PRICE_TYPES.has(item.numericType))
    .slice(0, 8)
    .map((item, index) => ({
      id: item.entityId || `price-${index}`,
      title: item.displayText || item.text || '금액/숫자',
      detail: `${formatSource(item.source)} · ${formatNumericType(item.numericType)}`,
      meta: findRelatedDifferenceText(item, differences),
      technical: item.fullContextText || item.sectionPath || item.contextPath || '',
    }))
}

export function createMediaSummary(aiHints = {}) {
  const heroMediaGroup = aiHints.heroMediaGroup || {}
  const evidenceContent = aiHints.evidenceSummary?.content || {}
  const figmaPrimary = Array.isArray(heroMediaGroup.figma?.primaryCandidates) ? heroMediaGroup.figma.primaryCandidates : []
  const webPrimary = Array.isArray(heroMediaGroup.web?.primaryCandidates) ? heroMediaGroup.web.primaryCandidates : []

  return {
    comparisonText: formatMediaComparisonHint(heroMediaGroup.comparisonHint),
    heroPrimary: [...figmaPrimary, ...webPrimary].slice(0, 4).map((item, index) => ({
      id: item.entityId || `hero-media-${index}`,
      title: item.mediaType || item.type || 'media',
      detail: `${formatSource(item.source)} · ${formatMediaRole(item.role)}`,
      meta: item.sectionRole || 'Hero',
    })),
    counts: {
      figmaImage: Number(evidenceContent.figmaImageCount || 0),
      webImage: Number(evidenceContent.webImageCount || 0),
      webVideo: Number(evidenceContent.webVideoCount || 0),
    },
  }
}

export function createDifferenceItems(comparison = {}) {
  const differences = Array.isArray(comparison.differences) ? comparison.differences : []
  return differences.slice(0, 8).map((item, index) => ({
    id: `difference-${index}-${normalizeText(item.text || item.figmaText || '')}`,
    title: createDifferenceTitle(item),
    detail: `Figma: ${item.figmaText || '-'} / Web: ${item.webText || '-'}`,
    meta: formatConfidence(item.confidence),
  }))
}

export function createVisualSummary(result = {}) {
  const cards = createVisualIssueCards(result)
  const counts = countIssueCards(cards)
  const comparison = result.comparison || {}
  const meta = result.meta || {}

  return `${meta.webUrl || '대상 페이지'} Visual QA 결과: Critical ${counts.critical}건, Warning ${counts.warning}건, Check ${counts.check}건입니다. 텍스트 매칭 ${comparison.matchedCount || 0}건, 차이 ${comparison.differenceCount || 0}건 기준으로 정리했습니다.`
}

export function createCompactVisualResult(result = {}) {
  const aiHints = result.aiHints || {}

  return {
    meta: result.meta || {},
    figma: result.figma || {},
    web: result.web || {},
    comparison: {
      ...(result.comparison || {}),
      differences: Array.isArray(result.comparison?.differences) ? result.comparison.differences : [],
    },
    aiHints: {
      evidenceSummary: aiHints.evidenceSummary || {},
      heroSection: compactHeroSection(aiHints.heroSection),
      heroMediaGroup: compactHeroMediaGroup(aiHints.heroMediaGroup),
      heroCtaGroup: compactHeroCtaGroup(aiHints.heroCtaGroup),
      ctaButtons: Array.isArray(aiHints.ctaButtons) ? aiHints.ctaButtons.map(compactAction) : [],
      prices: Array.isArray(aiHints.prices) ? aiHints.prices.map(compactNumeric) : [],
    },
  }
}

export function hasInternalLabels(card = {}) {
  const text = `${card.title || ''} ${card.detail || ''} ${card.meta || ''}`
  return INTERNAL_LABELS.some((label) => text.includes(label))
}

function createTextDifferenceCard(item = {}) {
  const title = createDifferenceTitle(item)
  const category = classifyDifferenceCategory(item)

  return {
    category,
    severity: classifyDifferenceSeverity(item, category),
    title,
    detail: `Figma: ${item.figmaText || '-'} / Web: ${item.webText || '-'}`,
    figmaText: item.figmaText || item.text || '',
    webText: item.webText || '',
    entityKey: item.entityId || item.sectionId || item.webSelector || item.figmaNodeId || item.text || '',
    technical: formatConfidence(item.confidence),
  }
}

function createHeroCtaTextDifferenceCards(heroCtaGroup = {}, differences = []) {
  const textDifferences = Array.isArray(heroCtaGroup.textDifferences) ? heroCtaGroup.textDifferences : []
  return textDifferences
    .filter((item) => !hasRelatedComparisonDifference(item, differences))
    .slice(0, 8)
    .map((item) => ({
      category: 'cta-text',
      severity: 'warning',
      title: 'Hero CTA 문구가 다릅니다.',
      detail: `${formatSource(item.source)}: ${item.text || '-'}`,
      figmaText: item.source === 'figma' ? item.text || '' : '',
      webText: item.source === 'web' ? item.text || '' : '',
      entityKey: `hero-cta:${item.source || ''}:${item.text || ''}`,
      technical: 'Hero CTA text difference',
    }))
}

function hasRelatedComparisonDifference(item, differences) {
  const text = normalizeText(item?.text)
  if (!text) return false
  return differences.some((difference) => {
    if (!looksCtaDifference(difference)) return false
    return normalizeText(difference.figmaText).includes(text)
      || normalizeText(difference.webText).includes(text)
      || text.includes(normalizeText(difference.figmaText))
      || text.includes(normalizeText(difference.webText))
  })
}

function createHeroMediaCard(heroMediaGroup = {}) {
  if (!heroMediaGroup.comparisonHint) return null
  return {
    category: 'media-type',
    severity: 'check',
    title: 'Hero 미디어 구성을 확인하세요.',
    detail: formatMediaComparisonHint(heroMediaGroup.comparisonHint),
    figmaText: arrayOfStrings(heroMediaGroup.figma?.mediaTypes).join(','),
    webText: arrayOfStrings(heroMediaGroup.web?.mediaTypes).join(','),
    entityKey: 'hero-media',
    technical: heroMediaGroup.comparisonHint,
  }
}

function dedupeIssueCards(cards) {
  const seen = new Set()
  const deduped = []

  cards.forEach((card) => {
    const key = createSemanticIssueKey(card)
    if (seen.has(key)) return
    seen.add(key)
    deduped.push(card)
  })

  return deduped
}

function createSemanticIssueKey(card) {
  return [
    card.category || '',
    normalizeText(card.title),
    normalizeText(card.figmaText),
    normalizeText(card.webText),
    normalizeText(card.entityKey),
  ].join('|')
}

function classifyDifferenceCategory(item) {
  const text = `${item.text || ''} ${item.figmaText || ''} ${item.webText || ''}`
  if (looksNumericDifference(text)) return 'numeric'
  if (looksHeroDifference(item)) return 'hero-text'
  if (looksCtaDifference(item)) return 'cta-text'
  return 'text'
}

function classifyDifferenceSeverity(item, category) {
  if (category === 'numeric') return 'critical'
  if (category === 'hero-text' && item.confidence === 'high') return 'critical'
  if (category === 'cta-text') return 'warning'
  return item.confidence === 'low' ? 'check' : 'warning'
}

function createDifferenceTitle(item) {
  const text = `${item.text || ''} ${item.figmaText || ''} ${item.webText || ''}`
  if (looksNumericDifference(text)) return '핵심 숫자 문구가 다릅니다.'
  if (looksHeroDifference(item)) return 'Hero 핵심 문구가 다릅니다.'
  if (looksCtaDifference(item)) return 'CTA 문구가 다릅니다.'
  if (isWhitespaceOnlyDifference(item.figmaText, item.webText)) return '띄어쓰기 차이가 있습니다.'
  return '문구가 다릅니다.'
}

function looksNumericDifference(text) {
  return /\d/.test(text) && /(원|만원|억원|%|퍼센트|월|년|개월|일|금리|이자|납입|가격|price|amount|rate|date)/i.test(text)
}

function looksHeroDifference(item) {
  const text = `${item.reasons?.join(' ') || ''} ${item.role || ''} ${item.section || ''} ${item.sectionRole || ''}`
  return /hero|heading|title|kv|main/i.test(text) || item.confidence === 'high'
}

function looksCtaDifference(item) {
  const text = `${item.text || ''} ${item.figmaText || ''} ${item.webText || ''} ${item.role || ''}`
  return /(cta|button|apply|consult|reserve|buy|learn more|바로가기|신청|상담|예약|구매|자세히)/i.test(text)
}

function isWhitespaceOnlyDifference(first, second) {
  if (!first || !second || first === second) return false
  return normalizeText(first) === normalizeText(second)
}

function findRelatedDifferenceText(item, differences) {
  const text = normalizeText(`${item.displayText || ''} ${item.text || ''}`)
  const related = differences.find((difference) => normalizeText(`${difference.figmaText || ''} ${difference.webText || ''}`).includes(text) || text.includes(normalizeText(difference.text)))
  if (!related) return ''
  return `차이: ${related.figmaText || '-'} / ${related.webText || '-'}`
}

function compactHeroSection(heroSection) {
  if (!heroSection || typeof heroSection !== 'object') return null
  return {
    type: heroSection.type,
    source: heroSection.source,
    confidence: heroSection.confidence,
    figmaSectionId: heroSection.figmaSectionId,
    webSectionId: heroSection.webSectionId,
    mediaTypes: heroSection.mediaTypes,
    figmaTextCount: heroSection.figmaTextCount,
    webTextCount: heroSection.webTextCount,
    sections: Array.isArray(heroSection.sections) ? heroSection.sections.slice(0, 4).map(compactSection) : [],
  }
}

function compactSection(item = {}) {
  return {
    sectionId: item.sectionId || '',
    source: item.source || '',
    role: item.role || '',
    rootSourceId: item.rootSourceId || '',
    path: item.path || item.sectionPath || '',
    xRatio: nullableNumber(item.xRatio),
    yRatio: nullableNumber(item.yRatio),
    widthRatio: nullableNumber(item.widthRatio),
    heightRatio: nullableNumber(item.heightRatio),
    spatialEvidence: compactSpatialEvidence(item.spatialEvidence || item),
  }
}

function compactHeroMediaGroup(group) {
  if (!group || typeof group !== 'object') return null
  return {
    type: group.type,
    figma: {
      mediaTypes: arrayOfStrings(group.figma?.mediaTypes),
      candidateCount: Number(group.figma?.candidateCount || 0),
      primaryCount: Number(group.figma?.primaryCount || 0),
      primaryCandidates: Array.isArray(group.figma?.primaryCandidates) ? group.figma.primaryCandidates.map(compactMedia) : [],
    },
    web: {
      mediaTypes: arrayOfStrings(group.web?.mediaTypes),
      candidateCount: Number(group.web?.candidateCount || 0),
      primaryCount: Number(group.web?.primaryCount || 0),
      primaryCandidates: Array.isArray(group.web?.primaryCandidates) ? group.web.primaryCandidates.map(compactMedia) : [],
    },
    comparisonHint: group.comparisonHint || '',
    confidence: group.confidence || '',
  }
}

function compactHeroCtaGroup(group) {
  if (!group || typeof group !== 'object') return null
  return {
    type: group.type,
    figma: {
      count: Number(group.figma?.count || 0),
      actions: Array.isArray(group.figma?.actions) ? group.figma.actions.map(compactAction) : [],
    },
    web: {
      count: Number(group.web?.count || 0),
      actions: Array.isArray(group.web?.actions) ? group.web.actions.map(compactAction) : [],
    },
    countDifference: Number(group.countDifference || 0),
    textDifferences: Array.isArray(group.textDifferences) ? group.textDifferences : [],
    confidence: group.confidence || '',
  }
}

function compactAction(item = {}) {
  return {
    entityId: item.entityId || '',
    source: item.source || '',
    role: item.role || '',
    text: item.text || item.displayText || '',
    displayText: item.displayText || item.text || '',
    href: item.href || '',
    comparisonScope: item.comparisonScope || '',
    sectionId: item.sectionId || '',
    sectionRootId: item.sectionRootId || '',
    sectionRole: item.sectionRole || '',
    sectionPath: item.sectionPath || '',
    ...compactSpatialFields(item),
    spatialEvidence: compactSpatialEvidence(item.spatialEvidence || item),
  }
}

function compactNumeric(item = {}) {
  return {
    entityId: item.entityId || '',
    source: item.source || '',
    numericType: item.numericType || '',
    text: item.text || '',
    displayText: item.displayText || item.text || '',
    fullContextText: item.fullContextText || '',
    sectionId: item.sectionId || '',
    sectionRootId: item.sectionRootId || '',
    sectionPath: item.sectionPath || '',
    ...compactSpatialFields(item),
    spatialEvidence: compactSpatialEvidence(item.spatialEvidence || item),
  }
}

function compactMedia(item = {}) {
  return {
    entityId: item.entityId || '',
    source: item.source || '',
    mediaType: item.mediaType || item.type || '',
    type: item.type || item.mediaType || '',
    text: item.text || '',
    role: item.role || '',
    sectionRole: item.sectionRole || '',
    sectionId: item.sectionId || '',
    sectionRootId: item.sectionRootId || '',
    sectionPath: item.sectionPath || '',
    comparisonScope: item.comparisonScope || '',
    isHeroPrimary: item.isHeroPrimary === true,
    ...compactSpatialFields(item),
    spatialEvidence: compactSpatialEvidence(item.spatialEvidence || item),
  }
}

function compactSpatialEvidence(item = {}) {
  if (!item || typeof item !== 'object') return null
  const fields = compactSpatialFields(item)
  const hasRatio = fields.xRatio !== null && fields.yRatio !== null && fields.widthRatio !== null && fields.heightRatio !== null
  const hasPixel = fields.x !== null && fields.y !== null && fields.width !== null && fields.height !== null
  if (!hasRatio && !hasPixel && !getString(item.sectionId) && !getString(item.sectionPath || item.path)) return null
  return {
    coordinateSpace: hasRatio ? 'ratio' : hasPixel ? 'pixel' : '',
    ...fields,
    sourceWidth: nullableNumber(item.sourceWidth || item.imageWidth || item.viewportWidth || item.scrollWidth),
    sourceHeight: nullableNumber(item.sourceHeight || item.imageHeight || item.viewportHeight || item.scrollHeight),
    sectionId: getString(item.sectionId),
    sectionRootId: getString(item.sectionRootId || item.rootSourceId),
    sectionPath: getString(item.sectionPath || item.path || item.contextPath || item.context || item.layerPath),
  }
}

function compactSpatialFields(item = {}) {
  const box = item.boundingBox || item.absoluteBoundingBox || item.bbox || item.rect || item.bounds || item.box || item
  const x = nullableNumber(box.x ?? box.left)
  const y = nullableNumber(box.y ?? box.top)
  const right = nullableNumber(box.right)
  const bottom = nullableNumber(box.bottom)
  return {
    xRatio: nullableNumber(item.xRatio ?? item.positionRatio?.xRatio),
    yRatio: nullableNumber(item.yRatio ?? item.positionRatio?.yRatio),
    widthRatio: nullableNumber(item.widthRatio ?? item.positionRatio?.widthRatio),
    heightRatio: nullableNumber(item.heightRatio ?? item.positionRatio?.heightRatio),
    x,
    y,
    width: nullableNumber(box.width ?? (right !== null && x !== null ? right - x : null)),
    height: nullableNumber(box.height ?? (bottom !== null && y !== null ? bottom - y : null)),
  }
}

function dedupeEntities(items) {
  const seen = new Set()
  return items.filter((item) => {
    const key = item.entityId || `${item.source}:${item.role}:${item.text}:${item.href}:${item.sectionPath}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function isReferenceOnly(item) {
  const text = `${item.comparisonScope || ''} ${item.role || ''} ${item.sectionRole || ''}`
  return /reference|excluded|navigation|tab|form-control|carousel-control|media-control|utility-control/i.test(text)
}

function inferSectionRole(item) {
  return /hero|main|kv|visual/i.test(`${item.sectionRole || ''} ${item.sectionPath || ''}`) ? 'hero' : ''
}

function formatMediaComparisonHint(value) {
  if (value === 'figma-image-vs-web-video') return 'Figma는 이미지, Web은 영상으로 구성되어 있습니다.'
  if (value === 'figma-video-vs-web-image') return 'Figma는 영상, Web은 이미지로 구성되어 있습니다.'
  if (value === 'mixed-media') return 'Hero 영역에 이미지와 영상이 함께 감지되었습니다.'
  return value ? 'Hero 미디어 구성을 확인해야 합니다.' : '주요 미디어 차이가 감지되지 않았습니다.'
}

function formatRole(value) {
  if (value === 'primary-action') return 'Primary CTA'
  if (value === 'secondary-action') return 'Secondary CTA'
  return value || 'action'
}

function formatSource(value) {
  if (value === 'figma') return 'Figma'
  if (value === 'web') return 'Web'
  if (value === 'combined') return 'Figma/Web'
  return value || 'Unknown'
}

function formatNumericType(value) {
  if (value === 'monthly-payment') return '월 납입금'
  if (value === 'interest-rate') return '금리'
  if (value === 'percentage') return '퍼센트'
  if (value === 'duration') return '기간'
  if (value === 'date') return '날짜'
  if (value === 'amount') return '금액'
  return value || '숫자'
}

function formatMediaRole(value) {
  if (value === 'foreground-primary') return '주요 전경'
  if (value === 'background-primary') return '주요 배경'
  return value || '미디어'
}

function formatConfidence(value) {
  if (value === 'high') return '높은 신뢰도'
  if (value === 'medium') return '중간 신뢰도'
  if (value === 'low') return '낮은 신뢰도'
  return '신뢰도 확인 필요'
}

function normalizeText(value) {
  return getString(value).toLowerCase().replace(/[\s\u00a0.,:;!?"'“”‘’()[\]{}<>_/\\-]/g, '')
}

function arrayOfStrings(value) {
  return Array.isArray(value) ? value.map(getString).filter(Boolean) : []
}

function nullableNumber(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function getTrustedDisplayImageUrl(value) {
  const url = getString(value)
  if (!url) return ''
  if (/^https?:\/\//.test(url) || url.startsWith('data:') || url.startsWith('/api/')) return url
  return ''
}

function getString(value) {
  return typeof value === 'string' ? value : ''
}
