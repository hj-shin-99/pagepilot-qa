import test from 'node:test'
import assert from 'node:assert/strict'
import { buildVisualQaPayloadArtifacts, createVisualQaPayload, normalizeTextForExactDisplayComparison } from './visualQaPayload.js'

function createFigmaTextNode(overrides = {}) {
  return {
    nodeId: overrides.nodeId || 'figma-text-1',
    id: overrides.id || overrides.nodeId || 'figma-text-1',
    characters: overrides.characters || '기본 문구',
    layerPath: overrides.layerPath || 'Hero / Title',
    parentFrameName: overrides.parentFrameName || 'Hero',
    yRatio: overrides.yRatio ?? 0.1,
    xRatio: overrides.xRatio ?? 0.1,
    widthRatio: overrides.widthRatio ?? 0.3,
    heightRatio: overrides.heightRatio ?? 0.05,
    fontSize: overrides.fontSize ?? 32,
    fontWeight: overrides.fontWeight ?? 700,
  }
}

function createFigmaFlatNode(overrides = {}) {
  return {
    id: overrides.id || 'figma-node-1',
    nodeId: overrides.nodeId || overrides.id || 'figma-node-1',
    name: overrides.name || 'Hero Button',
    type: overrides.type || 'FRAME',
    layerPath: overrides.layerPath || 'Hero / Button',
    parentId: overrides.parentId || '',
    parentName: overrides.parentName || 'Hero',
    childIds: overrides.childIds || [],
    characters: overrides.characters || '',
    yRatio: overrides.yRatio ?? 0.1,
    xRatio: overrides.xRatio ?? 0.1,
    widthRatio: overrides.widthRatio ?? 0.2,
    heightRatio: overrides.heightRatio ?? 0.08,
    absoluteBoundingBox: overrides.absoluteBoundingBox || { width: 320, height: 72 },
    effectivelyVisible: overrides.effectivelyVisible ?? true,
    hasImageFill: overrides.hasImageFill ?? false,
    hasVideoLikeContent: overrides.hasVideoLikeContent ?? false,
    hasSolidFill: overrides.hasSolidFill ?? false,
    strokes: overrides.strokes || [],
    cornerRadius: overrides.cornerRadius ?? 0,
    isInteractiveCandidate: overrides.isInteractiveCandidate ?? false,
  }
}

function createWebTextNode(overrides = {}) {
  return {
    id: overrides.id || 'web-text-1',
    text: overrides.text || '기본 문구',
    rawText: overrides.rawText || overrides.text || '기본 문구',
    selector: overrides.selector || 'main h1',
    parentSelector: overrides.parentSelector || 'main',
    domPath: overrides.domPath || 'body > main > h1',
    tagName: overrides.tagName || 'h1',
    role: overrides.role || 'heading',
    ariaRole: overrides.ariaRole || '',
    sectionHint: overrides.sectionHint || 'hero',
    yRatio: overrides.yRatio ?? 0.1,
    xRatio: overrides.xRatio ?? 0.1,
    widthRatio: overrides.widthRatio ?? 0.2,
    heightRatio: overrides.heightRatio ?? 0.05,
    href: overrides.href || '',
    visible: overrides.visible ?? true,
  }
}

function createWebCtaCandidate(overrides = {}) {
  return {
    type: overrides.type || 'cta',
    source: overrides.source || 'web',
    sourceId: overrides.sourceId || overrides.selector || 'web-cta-1',
    text: overrides.text || '자세히 보기',
    selector: overrides.selector || '.hero a',
    context: overrides.context || overrides.selector || '.hero a',
    parentContext: overrides.parentContext || '',
    parentSelector: overrides.parentSelector || '',
    tagName: overrides.tagName || 'a',
    href: overrides.href || '/detail',
    section: overrides.section || 'hero',
    confidence: overrides.confidence || 'high',
    reasons: overrides.reasons || ['interactive selector', 'has href'],
    yRatio: overrides.yRatio ?? 0.1,
    xRatio: overrides.xRatio,
    widthRatio: overrides.widthRatio,
    heightRatio: overrides.heightRatio,
    width: overrides.width,
    height: overrides.height,
    x: overrides.x,
    y: overrides.y,
    ariaRole: overrides.ariaRole || '',
    ariaHidden: overrides.ariaHidden,
    isDuplicate: overrides.isDuplicate,
    isActive: overrides.isActive,
    isCurrent: overrides.isCurrent,
  }
}

function createBaseInput(overrides = {}) {
  return {
    figmaAnalysis: {
      render: { imageUrl: '/api/figma/render/render-1', localImagePath: '.cache/figma/renders/render-1.png', renderId: 'render-1' },
      textNodes: [createFigmaTextNode()],
      flatNodes: [],
      structureSummary: { totalNodeCount: 1 },
      ...overrides.figmaAnalysis,
    },
    webAnalysis: {
      screenshot: { path: '.cache/visual/screenshots/web.png', width: 1920, height: 1080, mimeType: 'image/png' },
      page: { viewportWidth: 1920, viewportHeight: 1080, scrollWidth: 1920, scrollHeight: 1080 },
      textNodes: [createWebTextNode()],
      ctaCandidates: [],
      imageCandidates: [],
      videoCandidates: [],
      sectionCandidates: [],
      ...overrides.webAnalysis,
    },
    textComparison: {
      summary: { matchedCount: 1, differenceCount: 0, figmaOnlyCount: 0, webOnlyCount: 0 },
      differences: [],
      figmaOnlyPreview: [],
      webOnlyPreview: [],
      ...overrides.textComparison,
    },
  }
}

test('display-equivalent normalization removes invisible characters only', () => {
  assert.equal(normalizeTextForExactDisplayComparison('BMW\u200B를 경험해 보세요.'), 'BMW를 경험해 보세요.')
  assert.equal(normalizeTextForExactDisplayComparison('소비자\u00A0정보포털'), '소비자 정보포털')
  assert.notEqual(normalizeTextForExactDisplayComparison('온라인견적'), normalizeTextForExactDisplayComparison('온라인 견적'))
})

test('zero-width only difference is removed from payload differences', () => {
  const { payload, payloadQuality } = buildVisualQaPayloadArtifacts(createBaseInput({
    textComparison: {
      summary: { matchedCount: 1, differenceCount: 1, figmaOnlyCount: 0, webOnlyCount: 0 },
      differences: [{ figmaText: 'BMW\u200B를 경험해 보세요.', webText: 'BMW를 경험해 보세요.', matchConfidence: 'high', evidence: ['same region'] }],
    },
  }))

  assert.equal(payload.comparison.differences.length, 0)
  assert.equal(payloadQuality.invisibleCharacterDiffRemovedCount, 1)
})

test('header nav menu link stays in navigation and is removed from CTA', () => {
  const { payload, payloadQuality } = buildVisualQaPayloadArtifacts(createBaseInput({
    webAnalysis: {
      textNodes: [createWebTextNode({ text: '프로모션', rawText: '프로모션', selector: 'header nav a', parentSelector: 'header nav', role: 'navigation', sectionHint: 'navigation', tagName: 'a', href: '/promo' })],
      ctaCandidates: [createWebCtaCandidate({ text: '프로모션', selector: 'header nav a', context: 'header nav a', parentContext: 'header nav', tagName: 'a', href: '/promo', section: 'navigation' })],
      sectionCandidates: [{ type: 'section', source: 'web', name: 'navigation', confidence: 'high', reasons: ['navigation cluster'] }],
    },
  }))

  assert.equal(payload.aiHints.navigation.webItems.length, 1)
  assert.equal(payload.aiHints.ctaButtons.length, 0)
  assert.equal(payload.aiHints.interactions.navigationItems.length, 1)
  assert.equal(payloadQuality.navigationRemovedFromCtaCount > 0, true)
})

test('CTA wrapper with two anchor children keeps only leaf actions', () => {
  const { payload, payloadQuality } = buildVisualQaPayloadArtifacts(createBaseInput({
    webAnalysis: {
      textNodes: [],
      ctaCandidates: [
        createWebCtaCandidate({ text: '프로모션 바로가기 온라인 구매 상담', selector: 'div.btn_wrap', context: 'div.btn_wrap', tagName: 'div', href: '', section: 'hero' }),
        createWebCtaCandidate({ text: '프로모션 바로가기', selector: 'div.btn_wrap > a:nth-of-type(1)', parentContext: 'div.btn_wrap', tagName: 'a', href: '/promo', section: 'hero', xRatio: 0.1 }),
        createWebCtaCandidate({ text: '온라인 구매 상담', selector: 'div.btn_wrap > a:nth-of-type(2)', parentContext: 'div.btn_wrap', tagName: 'a', href: '/consult', section: 'hero', xRatio: 0.3 }),
      ],
    },
  }))

  assert.deepEqual(payload.aiHints.ctaButtons.map((item) => item.text), ['프로모션 바로가기', '온라인 구매 상담'])
  assert.equal(payload.aiHints.ctaButtons.some((item) => item.selector === 'div.btn_wrap'), false)
  assert.equal(payloadQuality.parentCtaRemovedCount, 1)
})

test('tablist button is excluded from CTA and included in tabs', () => {
  const { payload, payloadQuality } = buildVisualQaPayloadArtifacts(createBaseInput({
    webAnalysis: {
      textNodes: [createWebTextNode({ text: '상품 1', selector: 'div[role="tablist"] button', parentSelector: 'div[role="tablist"]', tagName: 'button', role: 'tab', ariaRole: 'tab', sectionHint: 'hero' })],
      ctaCandidates: [createWebCtaCandidate({ text: '상품 1', selector: 'div[role="tablist"] button', context: 'div[role="tablist"] button', parentContext: 'div[role="tablist"]', tagName: 'button', href: '', section: 'hero', ariaRole: 'tab' })],
    },
  }))

  assert.equal(payload.aiHints.ctaButtons.length, 0)
  assert.equal(payload.aiHints.interactions.tabs.length, 1)
  assert.equal(payloadQuality.tabRemovedFromCtaCount > 0, true)
})

test('video pause button is separated as media control', () => {
  const { payload, payloadQuality } = buildVisualQaPayloadArtifacts(createBaseInput({
    webAnalysis: {
      textNodes: [],
      ctaCandidates: [createWebCtaCandidate({ text: '일시정지', selector: '.hero .video-controls button.pause', context: '.hero .video-controls button.pause', parentContext: '.hero .video-controls', tagName: 'button', href: '', section: 'hero' })],
    },
  }))

  assert.equal(payload.aiHints.ctaButtons.length, 0)
  assert.equal(payload.aiHints.interactions.mediaControls.length, 1)
  assert.equal(payloadQuality.mediaControlRemovedFromCtaCount > 0, true)
})

test('swiper duplicate CTA is excluded from visual candidates', () => {
  const { payload, payloadQuality } = buildVisualQaPayloadArtifacts(createBaseInput({
    webAnalysis: {
      textNodes: [],
      ctaCandidates: [
        createWebCtaCandidate({ text: '프로모션 바로가기', selector: '.swiper-slide-duplicate a.btn', context: '.swiper-slide-duplicate a.btn', tagName: 'a', href: '/dup', section: 'hero', isDuplicate: true, isActive: false, isCurrent: false }),
        createWebCtaCandidate({ text: '프로모션 바로가기', selector: '.swiper-slide-active a.btn', context: '.swiper-slide-active a.btn', tagName: 'a', href: '/active', section: 'hero', isActive: true, isCurrent: true }),
      ],
    },
  }))

  assert.equal(payload.aiHints.ctaButtons.length, 1)
  assert.equal(payload.aiHints.ctaButtons[0].selector, '.swiper-slide-active a.btn')
  assert.equal(payloadQuality.offscreenCandidateRemovedCount, 1)
})

test('xRatio outside viewport removes web candidates from visual hints', () => {
  const { payload, payloadQuality } = buildVisualQaPayloadArtifacts(createBaseInput({
    webAnalysis: {
      textNodes: [],
      ctaCandidates: [
        createWebCtaCandidate({ text: '왼쪽 밖', selector: '.hero a.left', xRatio: -0.1, tagName: 'a', href: '/left' }),
        createWebCtaCandidate({ text: '오른쪽 밖', selector: '.hero a.right', xRatio: 1.2, tagName: 'a', href: '/right' }),
      ],
    },
  }))

  assert.equal(payload.aiHints.ctaButtons.length, 0)
  assert.equal(payloadQuality.offscreenCandidateRemovedCount, 2)
})

test('general hero action link remains as CTA', () => {
  const { payload } = buildVisualQaPayloadArtifacts(createBaseInput({
    webAnalysis: {
      textNodes: [createWebTextNode({ text: '자세히 보기', rawText: '자세히 보기', selector: '.hero a', parentSelector: '.hero', role: 'cta', sectionHint: 'hero', tagName: 'a', href: '/detail' })],
      ctaCandidates: [createWebCtaCandidate({ text: '자세히 보기', selector: '.hero a', context: '.hero a', parentContext: '.hero', tagName: 'a', href: '/detail', section: 'hero' })],
    },
  }))

  assert.equal(payload.aiHints.ctaButtons.length, 1)
  assert.equal(payload.aiHints.ctaButtons[0].text, '자세히 보기')
})

test('Figma button component with text creates one Figma CTA candidate', () => {
  const buttonId = 'figma-button-1'
  const { payload, payloadQuality } = buildVisualQaPayloadArtifacts(createBaseInput({
    figmaAnalysis: {
      textNodes: [],
      flatNodes: [
        createFigmaFlatNode({ id: buttonId, nodeId: buttonId, name: 'Primary CTA Button', layerPath: 'Hero / CTA Button', isInteractiveCandidate: true, hasSolidFill: true, cornerRadius: 16 }),
        createFigmaFlatNode({ id: 'figma-text-child', nodeId: 'figma-text-child', type: 'TEXT', name: 'Label', layerPath: 'Hero / CTA Button / Label', parentId: buttonId, characters: '시승 신청', isInteractiveCandidate: false, widthRatio: 0.1, heightRatio: 0.03 }),
      ],
    },
    webAnalysis: { textNodes: [], ctaCandidates: [] },
  }))

  assert.equal(payload.aiHints.ctaButtons.length, 1)
  assert.equal(payload.aiHints.ctaButtons[0].source, 'figma')
  assert.equal(payload.aiHints.ctaButtons[0].text, '시승 신청')
  assert.equal(Array.isArray(payload.aiHints.ctaButtons[0].interactionEvidence), true)
  assert.equal(payloadQuality.figmaCtaDetectedCount, 1)
})

test('Figma navigation button is classified as navigation instead of CTA', () => {
  const navId = 'figma-nav-1'
  const { payload } = buildVisualQaPayloadArtifacts(createBaseInput({
    figmaAnalysis: {
      textNodes: [],
      flatNodes: [
        createFigmaFlatNode({ id: navId, nodeId: navId, name: 'Nav Item Button', layerPath: 'Header / Nav / Item Button', parentName: 'Header', isInteractiveCandidate: true, hasSolidFill: true }),
        createFigmaFlatNode({ id: 'figma-nav-text', nodeId: 'figma-nav-text', type: 'TEXT', name: 'Label', layerPath: 'Header / Nav / Item Button / Label', parentId: navId, characters: '브랜드 소개', isInteractiveCandidate: false }),
      ],
    },
    webAnalysis: { textNodes: [], ctaCandidates: [] },
  }))

  assert.equal(payload.aiHints.ctaButtons.length, 0)
  assert.equal(payload.aiHints.interactions.navigationItems.length, 1)
})

test('model names are classified as model-name and excluded from prices', () => {
  const { payload } = buildVisualQaPayloadArtifacts(createBaseInput({
    figmaAnalysis: {
      textNodes: [
        createFigmaTextNode({ nodeId: 'model-1', characters: 'iX3', layerPath: 'Hero / Tabs / Item', fontSize: 18, fontWeight: 600 }),
        createFigmaTextNode({ nodeId: 'model-2', characters: 'THE 5', layerPath: 'Hero / Tabs / Item', fontSize: 18, fontWeight: 600 }),
        createFigmaTextNode({ nodeId: 'model-3', characters: 'THE X3', layerPath: 'Hero / Tabs / Item', fontSize: 18, fontWeight: 600 }),
      ],
    },
    webAnalysis: { textNodes: [] },
  }))

  assert.equal(payload.aiHints.prices.length, 0)
  assert.deepEqual(payload.aiHints.numericEntities.map((item) => item.numericType), ['model-name', 'model-name', 'model-name'])
})

test('business registration number is excluded from prices', () => {
  const { payload } = buildVisualQaPayloadArtifacts(createBaseInput({
    figmaAnalysis: {
      textNodes: [createFigmaTextNode({ nodeId: 'biz-1', characters: '사업자등록번호 123-45-67890', layerPath: 'Footer / Legal', parentFrameName: 'Footer', fontSize: 12, fontWeight: 400, yRatio: 0.95 })],
    },
    webAnalysis: { textNodes: [] },
  }))

  assert.equal(payload.aiHints.prices.length, 0)
  assert.equal(payload.aiHints.numericEntities[0].numericType, 'business-registration-number')
})

test('phone number is excluded from prices', () => {
  const { payload } = buildVisualQaPayloadArtifacts(createBaseInput({
    figmaAnalysis: {
      textNodes: [createFigmaTextNode({ nodeId: 'phone-1', characters: '고객센터 02-1234-5678', layerPath: 'Footer / Contact', parentFrameName: 'Footer', fontSize: 12, fontWeight: 400, yRatio: 0.96 })],
    },
    webAnalysis: { textNodes: [] },
  }))

  assert.equal(payload.aiHints.prices.length, 0)
  assert.equal(payload.aiHints.numericEntities[0].numericType, 'phone-number')
})

test('copyright year is excluded from prices', () => {
  const { payload } = buildVisualQaPayloadArtifacts(createBaseInput({
    figmaAnalysis: {
      textNodes: [createFigmaTextNode({ nodeId: 'copyright-1', characters: 'Copyright 2026 Example Corp.', layerPath: 'Footer / Copyright', parentFrameName: 'Footer', fontSize: 12, fontWeight: 400, yRatio: 0.98 })],
    },
    webAnalysis: { textNodes: [] },
  }))

  assert.equal(payload.aiHints.prices.length, 0)
  assert.equal(payload.aiHints.numericEntities[0].numericType, 'copyright-year')
})

test('monthly payment is included in prices', () => {
  const { payload } = buildVisualQaPayloadArtifacts(createBaseInput({
    figmaAnalysis: {
      textNodes: [createFigmaTextNode({ nodeId: 'price-1', characters: '월 47만원', layerPath: 'Hero / Price', parentFrameName: 'Hero' })],
    },
    webAnalysis: { textNodes: [] },
  }))

  assert.equal(payload.aiHints.prices[0].numericType, 'monthly-payment')
})

test('interest rate is included in prices', () => {
  const { payload } = buildVisualQaPayloadArtifacts(createBaseInput({
    figmaAnalysis: {
      textNodes: [createFigmaTextNode({ nodeId: 'rate-1', characters: '연 4.99%', layerPath: 'Card / Rate', parentFrameName: 'Card', fontSize: 18, fontWeight: 600, yRatio: 0.4 })],
    },
    webAnalysis: { textNodes: [] },
  }))

  assert.equal(payload.aiHints.prices[0].numericType, 'interest-rate')
})

test('duration is included in prices', () => {
  const { payload } = buildVisualQaPayloadArtifacts(createBaseInput({
    figmaAnalysis: {
      textNodes: [createFigmaTextNode({ nodeId: 'duration-1', characters: '계약기간 36개월', layerPath: 'Card / Duration', parentFrameName: 'Card', fontSize: 18, fontWeight: 600, yRatio: 0.4 })],
    },
    webAnalysis: { textNodes: [] },
  }))

  assert.equal(payload.aiHints.prices[0].numericType, 'duration')
})

test('long card text extracts a price-focused snippet', () => {
  const { payload, payloadQuality } = buildVisualQaPayloadArtifacts(createBaseInput({
    figmaAnalysis: { textNodes: [] },
    webAnalysis: {
      textNodes: [createWebTextNode({ text: '구매 혜택. 플래그십 모델, 월 50만원. 프로모션 바로가기', rawText: '구매 혜택. 플래그십 모델, 월 50만원. 프로모션 바로가기', selector: '.card p', parentSelector: '.card', tagName: 'p', role: 'body', sectionHint: 'hero' })],
    },
  }))

  assert.equal(payload.aiHints.prices.length, 1)
  assert.equal(payload.aiHints.prices[0].text.includes('월 50만원'), true)
  assert.equal(payload.aiHints.prices[0].fullContextText.includes('프로모션 바로가기'), true)
  assert.equal(payloadQuality.priceSnippetExtractedCount, 1)
})

test('hero background media selects one primary candidate from nested large layers', () => {
  const { payload } = buildVisualQaPayloadArtifacts(createBaseInput({
    figmaAnalysis: {
      flatNodes: [
        createFigmaFlatNode({ id: 'bg-1', nodeId: 'bg-1', name: 'Hero BG 1', layerPath: 'Hero / Background / Base', hasImageFill: true, widthRatio: 0.95, heightRatio: 0.52, yRatio: 0.02 }),
        createFigmaFlatNode({ id: 'bg-2', nodeId: 'bg-2', name: 'Hero BG 2', layerPath: 'Hero / Background / Overlay', hasImageFill: true, widthRatio: 0.93, heightRatio: 0.5, yRatio: 0.03 }),
        createFigmaFlatNode({ id: 'bg-3', nodeId: 'bg-3', name: 'Hero BG 3', layerPath: 'Hero / Background / Shadow', hasImageFill: true, widthRatio: 0.9, heightRatio: 0.48, yRatio: 0.04 }),
      ],
    },
    webAnalysis: { textNodes: [] },
  }))

  assert.equal(payload.aiHints.heroMediaGroup.figma.candidateCount, 3)
  assert.equal(payload.aiHints.heroMediaGroup.figma.primaryCandidates.length, 1)
  assert.equal(payload.aiHints.heroMediaGroup.figma.primaryCandidates[0].role, 'background-primary')
})

test('web hero video stays primary while video controls stay outside CTA', () => {
  const { payload } = buildVisualQaPayloadArtifacts(createBaseInput({
    figmaAnalysis: { textNodes: [] },
    webAnalysis: {
      textNodes: [],
      ctaCandidates: [createWebCtaCandidate({ text: '일시정지', selector: '.hero .video-controls button.pause', context: '.hero .video-controls button.pause', parentContext: '.hero .video-controls', tagName: 'button', href: '', section: 'hero' })],
      videoCandidates: [{ type: 'video', source: 'web', sourceId: 'hero-video', text: 'Hero Video', selector: '.hero video', context: '.hero video', section: 'hero', confidence: 'high', reasons: ['video element'], width: 1600, height: 900, yRatio: 0.05 }],
    },
  }))

  assert.equal(payload.aiHints.interactions.mediaControls.length, 1)
  assert.equal(payload.aiHints.heroMediaGroup.web.primaryCandidates.length, 1)
  assert.equal(payload.aiHints.heroMediaGroup.web.primaryCandidates[0].type, 'video')
  assert.equal(payload.aiHints.ctaButtons.length, 0)
})

test('hero CTA group aligns figma and web action counts', () => {
  const figmaPrimaryId = 'figma-cta-1'
  const figmaSecondaryId = 'figma-cta-2'
  const { payload } = buildVisualQaPayloadArtifacts(createBaseInput({
    figmaAnalysis: {
      textNodes: [],
      flatNodes: [
        createFigmaFlatNode({ id: figmaPrimaryId, nodeId: figmaPrimaryId, name: 'Primary Button', layerPath: 'Hero / Actions / Primary Button', isInteractiveCandidate: true, hasSolidFill: true }),
        createFigmaFlatNode({ id: 'figma-cta-text-1', nodeId: 'figma-cta-text-1', type: 'TEXT', layerPath: 'Hero / Actions / Primary Button / Label', parentId: figmaPrimaryId, characters: '시승 신청' }),
        createFigmaFlatNode({ id: figmaSecondaryId, nodeId: figmaSecondaryId, name: 'Secondary Button', layerPath: 'Hero / Actions / Secondary Button', isInteractiveCandidate: true, hasSolidFill: true, xRatio: 0.3 }),
        createFigmaFlatNode({ id: 'figma-cta-text-2', nodeId: 'figma-cta-text-2', type: 'TEXT', layerPath: 'Hero / Actions / Secondary Button / Label', parentId: figmaSecondaryId, characters: '자세히 보기', xRatio: 0.3 }),
      ],
    },
    webAnalysis: {
      textNodes: [],
      ctaCandidates: [
        createWebCtaCandidate({ text: '시승 신청', selector: '.hero .actions a.primary', parentContext: '.hero .actions', tagName: 'a', href: '/apply', xRatio: 0.1 }),
        createWebCtaCandidate({ text: '자세히 보기', selector: '.hero .actions a.secondary', parentContext: '.hero .actions', tagName: 'a', href: '/detail', xRatio: 0.3 }),
      ],
    },
  }))

  assert.equal(payload.aiHints.heroCtaGroup.figma.count, 2)
  assert.equal(payload.aiHints.heroCtaGroup.web.count, 2)
  assert.equal(payload.aiHints.heroCtaGroup.countDifference, 0)
})

test('evidence summary is recalculated from semantic candidates', () => {
  const { payload } = buildVisualQaPayloadArtifacts(createBaseInput({
    figmaAnalysis: {
      textNodes: [createFigmaTextNode({ nodeId: 'price-summary', characters: '월 47만원', layerPath: 'Hero / Price' })],
      flatNodes: [createFigmaFlatNode({ id: 'hero-bg', nodeId: 'hero-bg', name: 'Hero Background', layerPath: 'Hero / Background', hasImageFill: true, widthRatio: 0.9, heightRatio: 0.5, yRatio: 0.03 })],
    },
    webAnalysis: {
      textNodes: [],
      ctaCandidates: [
        createWebCtaCandidate({ text: '상담 신청', selector: '.hero a.primary', parentContext: '.hero .actions', tagName: 'a', href: '/apply' }),
        createWebCtaCandidate({ text: '상품 1', selector: '[role="tablist"] button', parentContext: '[role="tablist"]', tagName: 'button', href: '', ariaRole: 'tab' }),
        createWebCtaCandidate({ text: '일시정지', selector: '.hero .video-controls button.pause', context: '.hero .video-controls button.pause', parentContext: '.hero .video-controls', tagName: 'button', href: '' }),
      ],
      videoCandidates: [{ type: 'video', source: 'web', sourceId: 'hero-video', text: 'Hero Video', selector: '.hero video', context: '.hero video', section: 'hero', confidence: 'high', reasons: ['video element'], width: 1600, height: 900, yRatio: 0.05 }],
    },
  }))

  assert.equal(payload.aiHints.evidenceSummary.interactions.primaryActionCount, 1)
  assert.equal(payload.aiHints.evidenceSummary.interactions.tabCount, 1)
  assert.equal(payload.aiHints.evidenceSummary.interactions.mediaControlCount, 1)
  assert.equal(payload.aiHints.evidenceSummary.numeric.priceCount, 1)
  assert.equal(payload.aiHints.evidenceSummary.content.heroPrimaryMediaCount >= 1, true)
})

test('payload quality reports new semantic counters', () => {
  const buttonId = 'quality-figma-cta'
  const { payloadQuality } = buildVisualQaPayloadArtifacts(createBaseInput({
    figmaAnalysis: {
      textNodes: [createFigmaTextNode({ nodeId: 'quality-price', characters: '혜택 안내. 월 50만원. 프로모션 바로가기', layerPath: 'Hero / Card / Copy' })],
      flatNodes: [
        createFigmaFlatNode({ id: buttonId, nodeId: buttonId, name: 'Hero CTA Button', layerPath: 'Hero / CTA Button', isInteractiveCandidate: true, hasSolidFill: true }),
        createFigmaFlatNode({ id: 'quality-figma-label', nodeId: 'quality-figma-label', type: 'TEXT', layerPath: 'Hero / CTA Button / Label', parentId: buttonId, characters: '지금 신청' }),
        createFigmaFlatNode({ id: 'quality-hero-bg', nodeId: 'quality-hero-bg', name: 'Hero Background', layerPath: 'Hero / Background', hasImageFill: true, widthRatio: 0.9, heightRatio: 0.5, yRatio: 0.03 }),
      ],
    },
    webAnalysis: {
      textNodes: [],
      ctaCandidates: [
        createWebCtaCandidate({ text: '신청 상담 자세히 보기', selector: 'div.btn_wrap', context: 'div.btn_wrap', tagName: 'div', href: '', section: 'hero' }),
        createWebCtaCandidate({ text: '신청 상담', selector: 'div.btn_wrap > a.primary', parentContext: 'div.btn_wrap', tagName: 'a', href: '/apply', section: 'hero', xRatio: 0.1 }),
        createWebCtaCandidate({ text: '자세히 보기', selector: 'div.btn_wrap > a.secondary', parentContext: 'div.btn_wrap', tagName: 'a', href: '/detail', section: 'hero', xRatio: 0.3 }),
        createWebCtaCandidate({ text: '탭 1', selector: '[role="tablist"] button', parentContext: '[role="tablist"]', tagName: 'button', href: '', section: 'hero', ariaRole: 'tab' }),
        createWebCtaCandidate({ text: '일시정지', selector: '.hero .video-controls button.pause', context: '.hero .video-controls button.pause', parentContext: '.hero .video-controls', tagName: 'button', href: '', section: 'hero' }),
        createWebCtaCandidate({ text: '중복 CTA', selector: '.swiper-slide-duplicate a.btn', context: '.swiper-slide-duplicate a.btn', tagName: 'a', href: '/dup', section: 'hero', isDuplicate: true, isActive: false, isCurrent: false }),
      ],
      videoCandidates: [{ type: 'video', source: 'web', sourceId: 'quality-hero-video', text: 'Hero Video', selector: '.hero video', context: '.hero video', section: 'hero', confidence: 'high', reasons: ['video element'], width: 1600, height: 900, yRatio: 0.05 }],
    },
  }))

  assert.equal(payloadQuality.parentCtaRemovedCount, 1)
  assert.equal(payloadQuality.tabRemovedFromCtaCount > 0, true)
  assert.equal(payloadQuality.mediaControlRemovedFromCtaCount > 0, true)
  assert.equal(payloadQuality.offscreenCandidateRemovedCount, 1)
  assert.equal(payloadQuality.priceSnippetExtractedCount, 1)
  assert.equal(payloadQuality.figmaCtaDetectedCount, 1)
  assert.equal(payloadQuality.webCtaDetectedCount, 2)
  assert.equal(payloadQuality.heroPrimaryMediaCount >= 1, true)
})

test('createVisualQaPayload excludes raw internals and includes semantic evidence summary', () => {
  const payload = createVisualQaPayload(createBaseInput({
    textComparison: {
      summary: { matchedCount: 1, differenceCount: 1, figmaOnlyCount: 12, webOnlyCount: 11 },
      differences: [{ figmaText: 'Figma', webText: 'Web', matchConfidence: 'high', evidence: ['same region'] }],
      figmaOnlyPreview: Array.from({ length: 12 }, (_, index) => ({ text: `Figma Only ${index}` })),
      webOnlyPreview: Array.from({ length: 11 }, (_, index) => ({ text: `Web Only ${index}` })),
      matchedPairs: [{ secret: true }],
      allPairs: [{ secret: true }],
    },
    webAnalysis: {
      scanResult: { rawHtml: '<html>secret</html>' },
    },
    figmaAnalysis: {
      figmaStructure: { secret: 'raw-json-should-not-appear' },
    },
  }))

  assert.equal(Array.isArray(payload.aiHints.evidenceSummary.hero.figmaMediaTypes), true)
  assert.equal(typeof payload.aiHints.evidenceSummary.interactions.primaryActionCount, 'number')
  const serialized = JSON.stringify(payload)
  assert.equal(serialized.includes('matchedPairs'), false)
  assert.equal(serialized.includes('allPairs'), false)
  assert.equal(serialized.includes('<html>secret</html>'), false)
  assert.equal(serialized.includes('raw-json-should-not-appear'), false)
})
