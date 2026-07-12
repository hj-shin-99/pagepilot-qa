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
    yRatio: overrides.yRatio ?? 0.08,
    xRatio: overrides.xRatio ?? 0.08,
    widthRatio: overrides.widthRatio ?? 0.25,
    heightRatio: overrides.heightRatio ?? 0.03,
    fontSize: overrides.fontSize ?? 32,
    fontWeight: overrides.fontWeight ?? 700,
  }
}

function createFigmaFlatNode(overrides = {}) {
  return {
    id: overrides.id || 'figma-node-1',
    nodeId: overrides.nodeId || overrides.id || 'figma-node-1',
    name: overrides.name || 'Primary Button',
    type: overrides.type || 'INSTANCE',
    layerPath: overrides.layerPath || 'Hero / Actions / Primary Button',
    parentId: overrides.parentId || '',
    parentName: overrides.parentName || 'Hero',
    yRatio: overrides.yRatio ?? 0.1,
    xRatio: overrides.xRatio ?? 0.1,
    widthRatio: overrides.widthRatio ?? 0.18,
    heightRatio: overrides.heightRatio ?? 0.04,
    absoluteBoundingBox: overrides.absoluteBoundingBox || { width: 320, height: 64 },
    effectivelyVisible: overrides.effectivelyVisible ?? true,
    hasImageFill: overrides.hasImageFill ?? false,
    hasVideoLikeContent: overrides.hasVideoLikeContent ?? false,
    hasSolidFill: overrides.hasSolidFill ?? false,
    strokes: overrides.strokes || [],
    cornerRadius: overrides.cornerRadius ?? 0,
    isInteractiveCandidate: overrides.isInteractiveCandidate ?? false,
    characters: overrides.characters || '',
  }
}

function createWebTextNode(overrides = {}) {
  return {
    id: overrides.id || 'web-text-1',
    text: overrides.text || '기본 문구',
    rawText: overrides.rawText || overrides.text || '기본 문구',
    selector: overrides.selector || '.hero h1',
    parentSelector: overrides.parentSelector || '.hero',
    domPath: overrides.domPath || 'body > main > section.hero > h1',
    tagName: overrides.tagName || 'h1',
    role: overrides.role || 'heading',
    ariaRole: overrides.ariaRole || '',
    sectionHint: overrides.sectionHint || 'hero',
    yRatio: overrides.yRatio ?? 0.08,
    xRatio: overrides.xRatio ?? 0.08,
    widthRatio: overrides.widthRatio ?? 0.2,
    heightRatio: overrides.heightRatio ?? 0.03,
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
    selector: overrides.selector || '.hero a.primary',
    context: overrides.context || overrides.selector || '.hero a.primary',
    parentContext: overrides.parentContext || '.hero',
    parentSelector: overrides.parentSelector || '.hero',
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

test('1288x542 oversized figma section frame is rejected as CTA', () => {
  const { payload, payloadQuality } = buildVisualQaPayloadArtifacts(createBaseInput({
    figmaAnalysis: {
      textNodes: [],
      flatNodes: [
        createFigmaFlatNode({ id: 'section-1', nodeId: 'section-1', name: 'BMW i Section', type: 'FRAME', layerPath: 'BMW i / Section', widthRatio: 0.72, heightRatio: 0.22, absoluteBoundingBox: { width: 1288, height: 542 }, isInteractiveCandidate: true, hasSolidFill: true }),
        createFigmaFlatNode({ id: 'section-title', nodeId: 'section-title', type: 'TEXT', layerPath: 'BMW i / Section / Title', parentId: 'section-1', characters: 'BMW i 전체 라인업 소개 문장입니다.' }),
      ],
    },
    webAnalysis: { textNodes: [] },
  }))

  assert.equal(payload.aiHints.ctaButtons.some((item) => item.source === 'figma'), false)
  assert.equal(payloadQuality.oversizedFigmaActionRejectedCount > 0, true)
})

test('1282x150 hero title group is rejected as CTA', () => {
  const { payload } = buildVisualQaPayloadArtifacts(createBaseInput({
    figmaAnalysis: {
      textNodes: [],
      flatNodes: [
        createFigmaFlatNode({ id: 'title-group', nodeId: 'title-group', name: 'Hero Title Group', type: 'FRAME', layerPath: 'Hero / Title Group', widthRatio: 0.7, heightRatio: 0.08, absoluteBoundingBox: { width: 1282, height: 150 }, isInteractiveCandidate: true, hasSolidFill: false }),
        createFigmaFlatNode({ id: 'title-text', nodeId: 'title-text', type: 'TEXT', layerPath: 'Hero / Title Group / Label', parentId: 'title-group', characters: '새로운 메인 비주얼 제목 그룹입니다.' }),
      ],
    },
    webAnalysis: { textNodes: [] },
  }))

  assert.equal(payload.aiHints.ctaButtons.some((item) => item.source === 'figma'), false)
})

test('500x168 content frame is rejected as CTA', () => {
  const { payload } = buildVisualQaPayloadArtifacts(createBaseInput({
    figmaAnalysis: {
      textNodes: [],
      flatNodes: [
        createFigmaFlatNode({ id: 'content-frame', nodeId: 'content-frame', name: '구매 혜택 Frame', type: 'FRAME', layerPath: 'Hero / Benefits Copy', widthRatio: 0.28, heightRatio: 0.08, absoluteBoundingBox: { width: 500, height: 168 }, isInteractiveCandidate: true }),
        createFigmaFlatNode({ id: 'content-text', nodeId: 'content-text', type: 'TEXT', layerPath: 'Hero / Benefits Copy / Label', parentId: 'content-frame', characters: '구매 혜택에 대한 긴 설명 문장입니다.' }),
      ],
    },
    webAnalysis: { textNodes: [] },
  }))

  assert.equal(payload.aiHints.ctaButtons.some((item) => item.source === 'figma'), false)
})

test('interaction instance with child text becomes one canonical action', () => {
  const { payload, payloadQuality } = buildVisualQaPayloadArtifacts(createBaseInput({
    figmaAnalysis: {
      textNodes: [],
      flatNodes: [
        createFigmaFlatNode({ id: 'btn-1', nodeId: 'btn-1', type: 'INSTANCE', layerPath: 'Hero / Actions / Primary Button', isInteractiveCandidate: true, hasSolidFill: true, cornerRadius: 16 }),
        createFigmaFlatNode({ id: 'btn-1-label', nodeId: 'btn-1-label', type: 'TEXT', layerPath: 'Hero / Actions / Primary Button / Label', parentId: 'btn-1', characters: '프로모션 바로가기' }),
      ],
    },
    webAnalysis: { textNodes: [] },
  }))

  assert.equal(payload.aiHints.canonicalEvidence.actions.filter((item) => item.source === 'figma' && item.role === 'primary-action').length, 1)
  assert.equal(payload.aiHints.canonicalEvidence.actions[0].sources.length, 1)
  assert.equal(payloadQuality.figmaCtaDetectedCount, 1)
})

test('same web selector and href across text and hint merge into one action', () => {
  const { payload, payloadQuality } = buildVisualQaPayloadArtifacts(createBaseInput({
    figmaAnalysis: { textNodes: [] },
    webAnalysis: {
      textNodes: [createWebTextNode({ id: 'web-text-10', text: '프로모션 바로가기', rawText: '프로모션 바로가기', selector: '.hero a.primary', parentSelector: '.hero .actions', role: 'cta', tagName: 'a', href: '/promo', sectionHint: 'hero', yRatio: 0.1, xRatio: 0.1 })],
      ctaCandidates: [createWebCtaCandidate({ sourceId: 'hint-1', text: '프로모션 바로가기', selector: '.hero a.primary', parentContext: '.hero .actions', href: '/promo', section: 'hero', yRatio: 0.1, xRatio: 0.1 })],
    },
  }))

  const actions = payload.aiHints.canonicalEvidence.actions.filter((item) => item.source === 'web' && item.role === 'primary-action')
  assert.equal(actions.length, 1)
  assert.equal(actions[0].sources.length, 2)
  assert.equal(payloadQuality.webActionSourcesMergedCount, 1)
})

test('different sourceIds for same DOM action still merge', () => {
  const { payload } = buildVisualQaPayloadArtifacts(createBaseInput({
    figmaAnalysis: { textNodes: [] },
    webAnalysis: {
      textNodes: [createWebTextNode({ id: 'web-text-a', text: '상담 신청', selector: '.hero a.cta', parentSelector: '.hero .actions', role: 'cta', tagName: 'a', href: '/apply', sectionHint: 'hero', yRatio: 0.1, xRatio: 0.1 })],
      ctaCandidates: [createWebCtaCandidate({ sourceId: 'web-hint-b', text: '상담 신청', selector: '.hero a.cta', parentContext: '.hero .actions', href: '/apply', section: 'hero', yRatio: 0.1, xRatio: 0.1 })],
    },
  }))

  assert.equal(payload.aiHints.canonicalEvidence.actions.filter((item) => item.source === 'web' && item.text === '상담 신청').length, 1)
})

test('same CTA text in different positions remains separate actions', () => {
  const { payload } = buildVisualQaPayloadArtifacts(createBaseInput({
    figmaAnalysis: { textNodes: [] },
    webAnalysis: {
      textNodes: [],
      ctaCandidates: [
        createWebCtaCandidate({ sourceId: 'hero-cta', text: 'Apply', selector: '.hero a.cta', parentContext: '.hero .actions', href: '/apply', section: 'hero', yRatio: 0.1, xRatio: 0.1 }),
        createWebCtaCandidate({ sourceId: 'footer-cta', text: 'Apply', selector: 'footer a.cta', parentContext: 'footer .links', href: '/apply', section: 'footer', yRatio: 0.9, xRatio: 0.1 }),
      ],
    },
  }))

  assert.equal(payload.aiHints.canonicalEvidence.actions.filter((item) => item.text === 'Apply').length, 2)
})

test('only hero container descendant action is included in hero CTA group', () => {
  const { payload } = buildVisualQaPayloadArtifacts(createBaseInput({
    figmaAnalysis: { textNodes: [] },
    webAnalysis: {
      textNodes: [createWebTextNode({ text: 'Hero Title', selector: '.hero h1', parentSelector: '.hero', role: 'heading', tagName: 'h1', sectionHint: 'hero' })],
      ctaCandidates: [
        createWebCtaCandidate({ text: 'Hero Action', selector: '.hero a.primary', parentContext: '.hero .actions', href: '/hero', section: 'hero', yRatio: 0.12, xRatio: 0.1 }),
        createWebCtaCandidate({ text: 'Top Notice Action', selector: '.notice a', parentContext: '.notice', href: '/notice', section: 'top', yRatio: 0.14, xRatio: 0.6 }),
      ],
      imageCandidates: [{ type: 'image', source: 'web', sourceId: 'hero-img', selector: '.hero img', section: 'hero', alt: 'Hero', loaded: true, naturalWidth: 1200, naturalHeight: 700 }],
    },
  }))

  assert.equal(payload.aiHints.heroCtaGroup.web.count, 1)
  assert.equal(payload.aiHints.heroCtaGroup.web.actions[0].text, 'Hero Action')
})

test('top-ish non-hero action is excluded from hero CTA group', () => {
  const { payload } = buildVisualQaPayloadArtifacts(createBaseInput({
    figmaAnalysis: { textNodes: [] },
    webAnalysis: {
      textNodes: [createWebTextNode({ text: 'Hero Title', selector: '.hero h1', parentSelector: '.hero', role: 'heading', tagName: 'h1', sectionHint: 'hero' })],
      ctaCandidates: [
        createWebCtaCandidate({ text: 'Outside Action', selector: '.promo-strip a', parentContext: '.promo-strip', href: '/promo-strip', section: 'top', yRatio: 0.11, xRatio: 0.75 }),
      ],
      imageCandidates: [{ type: 'image', source: 'web', sourceId: 'hero-img', selector: '.hero img', section: 'hero', alt: 'Hero', loaded: true, naturalWidth: 1200, naturalHeight: 700 }],
    },
  }))

  assert.equal(payload.aiHints.heroCtaGroup.web.count, 0)
})

test('card-wide price text and child price text merge into one canonical numeric entity', () => {
  const { payload, payloadQuality } = buildVisualQaPayloadArtifacts(createBaseInput({
    figmaAnalysis: { textNodes: [] },
    webAnalysis: {
      textNodes: [
        createWebTextNode({ id: 'card-text', text: '구매 혜택. BMW 뉴 iX, 월 50만원. 프로모션 바로가기', rawText: '구매 혜택. BMW 뉴 iX, 월 50만원. 프로모션 바로가기', selector: '.card', parentSelector: '.cards', role: 'body', tagName: 'div', sectionHint: 'content', yRatio: 0.4, xRatio: 0.1 }),
        createWebTextNode({ id: 'child-price', text: 'BMW 뉴 iX, 월 50만원.', rawText: 'BMW 뉴 iX, 월 50만원.', selector: '.card p.price', parentSelector: '.card', role: 'body', tagName: 'p', sectionHint: 'content', yRatio: 0.41, xRatio: 0.12 }),
      ],
    },
  }))

  assert.equal(payload.aiHints.prices.length, 1)
  assert.equal(payload.aiHints.prices[0].sources.length, 2)
  assert.equal(payloadQuality.duplicateNumericMergedCount, 1)
})

test('swiper duplicate and offscreen prices are excluded while active price remains', () => {
  const { payload, payloadQuality } = buildVisualQaPayloadArtifacts(createBaseInput({
    figmaAnalysis: { textNodes: [] },
    webAnalysis: {
      textNodes: [
        createWebTextNode({ id: 'active-price', text: '월 50만원', rawText: '월 50만원', selector: '.swiper-slide-active p.price', parentSelector: '.swiper-slide-active', role: 'body', tagName: 'p', sectionHint: 'content', yRatio: 0.4, xRatio: 0.2 }),
        createWebTextNode({ id: 'dup-price', text: '월 50만원', rawText: '월 50만원', selector: '.swiper-slide-duplicate p.price', parentSelector: '.swiper-slide-duplicate', role: 'body', tagName: 'p', sectionHint: 'content', yRatio: 0.4, xRatio: 0.2 }),
        createWebTextNode({ id: 'offscreen-price', text: '월 50만원', rawText: '월 50만원', selector: '.card.offscreen p.price', parentSelector: '.card.offscreen', role: 'body', tagName: 'p', sectionHint: 'content', yRatio: 0.4, xRatio: 1.2 }),
      ],
    },
  }))

  assert.equal(payload.aiHints.prices.length, 1)
  assert.equal(payload.aiHints.prices[0].sources.length, 1)
  assert.equal(payload.aiHints.prices[0].sources[0].source, 'web-text')
  assert.equal(payloadQuality.offscreenCandidateRemovedCount >= 2, true)
})

test('canonical action preserves source evidence', () => {
  const { payload } = buildVisualQaPayloadArtifacts(createBaseInput({
    figmaAnalysis: { textNodes: [] },
    webAnalysis: {
      textNodes: [createWebTextNode({ id: 'web-source-1', text: '상담 신청', selector: '.hero a.cta', parentSelector: '.hero .actions', role: 'cta', tagName: 'a', href: '/apply', sectionHint: 'hero', yRatio: 0.1, xRatio: 0.1 })],
      ctaCandidates: [createWebCtaCandidate({ sourceId: 'web-source-2', text: '상담 신청', selector: '.hero a.cta', parentContext: '.hero .actions', href: '/apply', section: 'hero', yRatio: 0.1, xRatio: 0.1 })],
    },
  }))

  const action = payload.aiHints.canonicalEvidence.actions.find((item) => item.text === '상담 신청')
  assert.equal(Array.isArray(action.sources), true)
  assert.equal(action.sources.length, 2)
})

test('canonical numeric preserves source evidence', () => {
  const { payload } = buildVisualQaPayloadArtifacts(createBaseInput({
    figmaAnalysis: { textNodes: [] },
    webAnalysis: {
      textNodes: [
        createWebTextNode({ id: 'price-source-1', text: '혜택 안내. 월 47만원.', rawText: '혜택 안내. 월 47만원.', selector: '.card', parentSelector: '.cards', role: 'body', tagName: 'div', sectionHint: 'content', yRatio: 0.4, xRatio: 0.2 }),
        createWebTextNode({ id: 'price-source-2', text: '월 47만원', rawText: '월 47만원', selector: '.card p.price', parentSelector: '.card', role: 'body', tagName: 'p', sectionHint: 'content', yRatio: 0.41, xRatio: 0.22 }),
      ],
    },
  }))

  assert.equal(payload.aiHints.canonicalEvidence.numericValues.length >= 1, true)
  assert.equal(payload.aiHints.prices[0].sources.length, 2)
})

test('aiHints CTA and prices are canonical entities instead of raw candidates', () => {
  const payload = createVisualQaPayload(createBaseInput({
    figmaAnalysis: { textNodes: [] },
    webAnalysis: {
      textNodes: [createWebTextNode({ text: '월 47만원', rawText: '월 47만원', selector: '.card p.price', parentSelector: '.card', role: 'body', tagName: 'p', sectionHint: 'content', yRatio: 0.4, xRatio: 0.2 })],
      ctaCandidates: [createWebCtaCandidate({ text: '상담 신청', selector: '.hero a.cta', parentContext: '.hero .actions', href: '/apply', section: 'hero', yRatio: 0.1, xRatio: 0.1 })],
    },
  }))

  assert.equal(Array.isArray(payload.aiHints.canonicalEvidence.actions), true)
  assert.equal(Array.isArray(payload.aiHints.canonicalEvidence.numericValues), true)
  assert.equal('context' in payload.aiHints.ctaButtons[0], false)
  assert.equal('sectionId' in payload.aiHints.ctaButtons[0], true)
  assert.equal('sources' in payload.aiHints.prices[0], true)
})

test('evidenceSummary counts use canonical evidence', () => {
  const { payload } = buildVisualQaPayloadArtifacts(createBaseInput({
    figmaAnalysis: { textNodes: [] },
    webAnalysis: {
      textNodes: [createWebTextNode({ text: '월 47만원', rawText: '월 47만원', selector: '.card p.price', parentSelector: '.card', role: 'body', tagName: 'p', sectionHint: 'content', yRatio: 0.4, xRatio: 0.2 })],
      ctaCandidates: [
        createWebCtaCandidate({ text: '상담 신청', selector: '.hero a.cta', parentContext: '.hero .actions', href: '/apply', section: 'hero', yRatio: 0.1, xRatio: 0.1 }),
        createWebCtaCandidate({ text: '상품 탭', selector: '[role="tablist"] button', parentContext: '[role="tablist"]', href: '', section: 'hero', ariaRole: 'tab', yRatio: 0.12, xRatio: 0.5, tagName: 'button' }),
      ],
      videoCandidates: [{ type: 'video', source: 'web', sourceId: 'hero-video', text: 'Hero Video', selector: '.hero video', context: '.hero video', section: 'hero', confidence: 'high', reasons: ['video element'], width: 1600, height: 900, yRatio: 0.05 }],
    },
  }))

  assert.equal(payload.aiHints.evidenceSummary.interactions.primaryActionCount, 1)
  assert.equal(payload.aiHints.evidenceSummary.interactions.tabCount, 1)
  assert.equal(payload.aiHints.evidenceSummary.numeric.priceCount, 1)
  assert.equal(payload.aiHints.evidenceSummary.canonical.actionCount >= 2, true)
})

test('payloadQuality exposes canonical merge counters', () => {
  const { payloadQuality } = buildVisualQaPayloadArtifacts(createBaseInput({
    figmaAnalysis: {
      textNodes: [],
      flatNodes: [
        createFigmaFlatNode({ id: 'hero-bg', nodeId: 'hero-bg', name: 'Hero Background', layerPath: 'Hero / Background', type: 'FRAME', hasImageFill: true, widthRatio: 0.92, heightRatio: 0.45, yRatio: 0.03, absoluteBoundingBox: { width: 1400, height: 700 } }),
        createFigmaFlatNode({ id: 'btn-merge', nodeId: 'btn-merge', type: 'INSTANCE', layerPath: 'Hero / Actions / Primary Button', isInteractiveCandidate: true, hasSolidFill: true }),
        createFigmaFlatNode({ id: 'btn-merge-label', nodeId: 'btn-merge-label', type: 'TEXT', layerPath: 'Hero / Actions / Primary Button / Label', parentId: 'btn-merge', characters: '지금 신청' }),
      ],
    },
    webAnalysis: {
      textNodes: [
        createWebTextNode({ id: 'price-merge-1', text: '혜택 안내. 월 50만원.', rawText: '혜택 안내. 월 50만원.', selector: '.card', parentSelector: '.cards', role: 'body', tagName: 'div', sectionHint: 'content', yRatio: 0.4, xRatio: 0.2 }),
        createWebTextNode({ id: 'price-merge-2', text: '월 50만원', rawText: '월 50만원', selector: '.card p.price', parentSelector: '.card', role: 'body', tagName: 'p', sectionHint: 'content', yRatio: 0.41, xRatio: 0.22 }),
        createWebTextNode({ id: 'action-text', text: '상담 신청', rawText: '상담 신청', selector: '.hero a.cta', parentSelector: '.hero .actions', role: 'cta', tagName: 'a', href: '/apply', sectionHint: 'hero', yRatio: 0.1, xRatio: 0.1 }),
      ],
      ctaCandidates: [
        createWebCtaCandidate({ text: '상담 신청', selector: '.hero a.cta', parentContext: '.hero .actions', href: '/apply', section: 'hero', yRatio: 0.1, xRatio: 0.1 }),
      ],
      imageCandidates: [{ type: 'image', source: 'web', sourceId: 'hero-img', selector: '.hero img', section: 'hero', alt: 'Hero', loaded: true, naturalWidth: 1200, naturalHeight: 700 }],
    },
  }))

  assert.equal(typeof payloadQuality.canonicalActionCount, 'number')
  assert.equal(typeof payloadQuality.canonicalNumericCount, 'number')
  assert.equal(typeof payloadQuality.rawActionCount, 'number')
  assert.equal(typeof payloadQuality.rawNumericCount, 'number')
  assert.equal(payloadQuality.webActionSourcesMergedCount >= 1, true)
  assert.equal(payloadQuality.figmaHeroCanonicalActionCount >= 0, true)
  assert.equal(typeof payloadQuality.heroSectionDetected, 'boolean')
})

test('root page container is not selected as hero and figma hero membership stays descendant-only', () => {
  const { payload, payloadQuality } = buildVisualQaPayloadArtifacts(createBaseInput({
    figmaAnalysis: {
      textNodes: [
        createFigmaTextNode({ nodeId: 'hero-title', layerPath: 'Page / Hero / Title', parentFrameName: 'Hero', characters: 'Hero Title', yRatio: 0.08 }),
        createFigmaTextNode({ nodeId: 'hero-body', layerPath: 'Page / Hero / Body', parentFrameName: 'Hero', characters: 'Hero Body', yRatio: 0.12, fontSize: 20, fontWeight: 500 }),
        createFigmaTextNode({ nodeId: 'content-title', layerPath: 'Page / Smart Advisor / Title', parentFrameName: 'Smart Advisor', characters: 'Smart Advisor', yRatio: 0.42, fontSize: 24, fontWeight: 700 }),
      ],
      flatNodes: [
        createFigmaFlatNode({ id: 'page-root', nodeId: 'page-root', name: 'Page', type: 'FRAME', layerPath: 'Page', widthRatio: 0.96, heightRatio: 0.96, absoluteBoundingBox: { width: 1440, height: 4200 } }),
        createFigmaFlatNode({ id: 'hero-frame', nodeId: 'hero-frame', name: 'Hero', type: 'FRAME', layerPath: 'Page / Hero', parentId: 'page-root', widthRatio: 0.92, heightRatio: 0.34, yRatio: 0.03, absoluteBoundingBox: { width: 1400, height: 720 }, hasImageFill: true }),
        createFigmaFlatNode({ id: 'hero-cta', nodeId: 'hero-cta', name: 'Primary Button', type: 'INSTANCE', layerPath: 'Page / Hero / CTA', parentId: 'hero-frame', isInteractiveCandidate: true, hasSolidFill: true, yRatio: 0.16 }),
        createFigmaFlatNode({ id: 'content-frame', nodeId: 'content-frame', name: 'Smart Advisor', type: 'FRAME', layerPath: 'Page / Smart Advisor', parentId: 'page-root', widthRatio: 0.92, heightRatio: 0.18, yRatio: 0.4, absoluteBoundingBox: { width: 1400, height: 460 } }),
      ],
    },
    webAnalysis: { textNodes: [] },
  }))

  assert.equal(payload.aiHints.heroSection.sections[0].path, 'Hero')
  assert.notEqual(payload.aiHints.heroSection.figmaSectionId, 'section:figma:page-root')
  assert.equal(payload.aiHints.heroSection.figmaTextCount, 2)
  assert.equal(payload.aiHints.evidenceSummary.hero.figmaTextCount, 2)
  assert.equal(payload.aiHints.canonicalEvidence.sections.some((section) => section.sectionId === 'section:figma:page-root' && section.role === 'hero'), false)
  assert.equal(payloadQuality.figmaHeroTextCount, 2)
})

test('web hero video descendant is included and non-hero video is excluded from hero media group', () => {
  const { payload, payloadQuality } = buildVisualQaPayloadArtifacts(createBaseInput({
    figmaAnalysis: { textNodes: [] },
    webAnalysis: {
      textNodes: [createWebTextNode({ text: 'Hero Title', selector: '.hero h1', parentSelector: '.hero', role: 'heading', tagName: 'h1', sectionHint: 'hero' })],
      ctaCandidates: [createWebCtaCandidate({ text: 'Hero Action', selector: '.hero a.primary', parentContext: '.hero .actions', href: '/hero', section: 'hero', yRatio: 0.12, xRatio: 0.1 })],
      imageCandidates: [],
      videoCandidates: [
        { type: 'video', source: 'web', sourceId: 'hero-video', text: 'Hero Video', selector: '.hero video', parentContext: '.hero', section: 'hero', confidence: 'high', reasons: ['video element'], width: 1600, height: 900, yRatio: 0.05 },
        { type: 'video', source: 'web', sourceId: 'notice-video', text: 'Notice Video', selector: '.notice video', parentContext: '.notice', section: 'top', confidence: 'medium', reasons: ['video element'], width: 600, height: 320, yRatio: 0.18 },
      ],
    },
  }))

  assert.equal(payload.aiHints.heroSection.webSectionId, 'section:web:.hero')
  assert.equal(payload.aiHints.heroMediaGroup.web.candidateCount, 1)
  assert.equal(payload.aiHints.heroMediaGroup.web.primaryCandidates[0].mediaType, 'video')
  assert.equal(payload.aiHints.evidenceSummary.hero.webPrimaryMediaCount, 1)
  assert.equal(payloadQuality.webHeroMediaCount, 1)
})

test('hero action keeps hero sectionId while other section action stays out of hero group', () => {
  const { payload } = buildVisualQaPayloadArtifacts(createBaseInput({
    figmaAnalysis: { textNodes: [] },
    webAnalysis: {
      textNodes: [createWebTextNode({ text: 'Hero Title', selector: '.hero h1', parentSelector: '.hero', role: 'heading', tagName: 'h1', sectionHint: 'hero' })],
      ctaCandidates: [
        createWebCtaCandidate({ text: 'Hero Action', selector: '.hero a.primary', parentContext: '.hero .actions', href: '/hero', section: 'hero', yRatio: 0.12, xRatio: 0.1 }),
        createWebCtaCandidate({ text: 'Advisor Start', selector: '.smart-advisor a.primary', parentContext: '.smart-advisor .actions', href: '/advisor', section: 'content', yRatio: 0.42, xRatio: 0.2 }),
      ],
      imageCandidates: [{ type: 'image', source: 'web', sourceId: 'hero-img', selector: '.hero img', parentContext: '.hero', section: 'hero', alt: 'Hero', loaded: true, naturalWidth: 1200, naturalHeight: 700 }],
    },
  }))

  const heroAction = payload.aiHints.canonicalEvidence.actions.find((item) => item.text === 'Hero Action')
  const advisorAction = payload.aiHints.canonicalEvidence.actions.find((item) => item.text === 'Advisor Start')

  assert.equal(heroAction.sectionId, payload.aiHints.heroSection.webSectionId)
  assert.notEqual(advisorAction.sectionId, payload.aiHints.heroSection.webSectionId)
  assert.deepEqual(payload.aiHints.heroCtaGroup.web.actions.map((item) => item.text), ['Hero Action'])
})

test('canonical counts and section assignment stay consistent across payload and quality', () => {
  const { payload, payloadQuality } = buildVisualQaPayloadArtifacts(createBaseInput({
    figmaAnalysis: { textNodes: [] },
    webAnalysis: {
      textNodes: [
        createWebTextNode({ text: '월 47만원', rawText: '월 47만원', selector: '.card p.price', parentSelector: '.card', role: 'body', tagName: 'p', sectionHint: 'content', yRatio: 0.4, xRatio: 0.2 }),
        createWebTextNode({ text: 'Footer Legal', selector: 'footer .legal', parentSelector: 'footer', role: 'body', tagName: 'small', sectionHint: 'legal', yRatio: 0.92, xRatio: 0.1 }),
      ],
      ctaCandidates: [
        createWebCtaCandidate({ text: 'Hero Action', selector: '.hero a.cta', parentContext: '.hero .actions', href: '/hero', section: 'hero', yRatio: 0.1, xRatio: 0.1 }),
        createWebCtaCandidate({ text: 'Legal Link', selector: 'footer .legal a', parentContext: 'footer .legal', parentSelector: 'footer .legal', href: '/legal', section: 'footer', yRatio: 0.93, xRatio: 0.1 }),
      ],
      imageCandidates: [{ type: 'image', source: 'web', sourceId: 'hero-img', selector: '.hero img', parentContext: '.hero', section: 'hero', alt: 'Hero', loaded: true, naturalWidth: 1200, naturalHeight: 700 }],
    },
    textComparison: {
      summary: { matchedCount: 0, differenceCount: 3, figmaOnlyCount: 1, webOnlyCount: 2 },
      differences: [
        { figmaText: 'A', webText: 'B', matchConfidence: 'high', evidence: ['hero'] },
        { figmaText: 'C', webText: 'D', matchConfidence: 'medium', evidence: ['content'] },
        { figmaText: 'E', webText: 'F', matchConfidence: 'low', evidence: ['footer'] },
      ],
    },
  }))

  const allCanonicalEntities = [
    ...payload.aiHints.canonicalEvidence.actions,
    ...payload.aiHints.canonicalEvidence.numericValues,
    ...payload.aiHints.canonicalEvidence.media,
    ...payload.aiHints.canonicalEvidence.texts,
  ]
  const legalAction = payload.aiHints.canonicalEvidence.actions.find((item) => item.text === 'Legal Link')

  assert.equal(payload.aiHints.evidenceSummary.canonical.actionCount, payloadQuality.canonicalActionCount)
  assert.equal(payload.aiHints.evidenceSummary.canonical.numericCount, payloadQuality.canonicalNumericCount)
  assert.equal(payload.comparison.differenceCount, 3)
  assert.equal(allCanonicalEntities.every((item) => typeof item.sectionId === 'string' && item.sectionId.length > 0), true)
  assert.equal(payloadQuality.unassignedCanonicalEntityCount, 0)
  assert.equal(payloadQuality.multiAssignedCanonicalEntityCount, 0)
  assert.equal(payloadQuality.canonicalCountConsistencyPassed, true)
  assert.equal(legalAction.comparisonScope, 'reference-only')
  assert.equal(payload.aiHints.ctaButtons.some((item) => item.text === 'Legal Link'), false)
  assert.equal(payload.aiHints.ctaButtons.every((item) => item.comparisonScope === 'primary' || item.comparisonScope === 'secondary'), true)
})

test('source hero consistency and candidate trace metrics are true when figma and web hero roots both resolve once', () => {
  const { payloadQuality, debugArtifacts } = buildVisualQaPayloadArtifacts(createBaseInput({
    figmaAnalysis: {
      textNodes: [
        createFigmaTextNode({ nodeId: 'figma-hero-title', layerPath: 'Page / Hero / Title', parentFrameName: 'Hero', characters: 'Hero Title' }),
        createFigmaTextNode({ nodeId: 'figma-hero-body', layerPath: 'Page / Hero / Body', parentFrameName: 'Hero', characters: 'Hero Body', yRatio: 0.12, fontSize: 20, fontWeight: 500 }),
      ],
      flatNodes: [
        createFigmaFlatNode({ id: 'figma-page', nodeId: 'figma-page', name: 'Page', type: 'FRAME', layerPath: 'Page', widthRatio: 0.96, heightRatio: 0.96, absoluteBoundingBox: { width: 1440, height: 4200 } }),
        createFigmaFlatNode({ id: 'figma-hero', nodeId: 'figma-hero', name: 'Main_visual', type: 'FRAME', layerPath: 'Page / Hero', parentId: 'figma-page', widthRatio: 0.92, heightRatio: 0.32, yRatio: 0.03, absoluteBoundingBox: { width: 1400, height: 680 }, hasImageFill: true }),
        createFigmaFlatNode({ id: 'figma-hero-btn', nodeId: 'figma-hero-btn', name: 'Primary Button', type: 'INSTANCE', layerPath: 'Page / Hero / CTA', parentId: 'figma-hero', isInteractiveCandidate: true, hasSolidFill: true }),
        createFigmaFlatNode({ id: 'figma-hero-btn-label', nodeId: 'figma-hero-btn-label', type: 'TEXT', layerPath: 'Page / Hero / CTA / Label', parentId: 'figma-hero-btn', characters: 'Apply Now' }),
      ],
    },
    webAnalysis: {
      textNodes: [
        createWebTextNode({ text: 'Hero Title', selector: '.hero h2', parentSelector: '.hero .txt', domPath: 'body > main > section.hero > div.txt > h2', role: 'heading', tagName: 'h2', sectionHint: 'hero' }),
        createWebTextNode({ text: 'Hero Body', selector: '.hero p', parentSelector: '.hero .txt', domPath: 'body > main > section.hero > div.txt > p', role: 'body', tagName: 'p', sectionHint: 'hero', yRatio: 0.12 }),
      ],
      ctaCandidates: [createWebCtaCandidate({ text: 'Hero Action', selector: '.hero a.primary', parentContext: '.hero .btn_wrap', parentSelector: '.hero .btn_wrap', href: '/hero', section: 'hero', yRatio: 0.14, xRatio: 0.1 })],
      videoCandidates: [{ type: 'video', source: 'web', sourceId: 'hero-video', text: 'Hero Video', selector: '.hero video', parentContext: '.hero', parentSelector: '.hero', section: 'hero', confidence: 'high', reasons: ['video element'], width: 1600, height: 900, yRatio: 0.05 }],
    },
  }))

  assert.equal(payloadQuality.sourceHeroCountConsistencyPassed, true)
  assert.equal(payloadQuality.figmaHeroCandidateCount > 0, true)
  assert.equal(payloadQuality.webHeroCandidateCount > 0, true)
  assert.equal(payloadQuality.figmaHeroContainsText, true)
  assert.equal(payloadQuality.webHeroContainsMedia, true)
  assert.equal(Array.isArray(debugArtifacts.heroCandidateTrace.figma), true)
  assert.equal(debugArtifacts.heroCandidateTrace.figma.some((item) => item.selected === true), true)
  assert.equal(debugArtifacts.heroCandidateTrace.web.some((item) => item.selected === true), true)
})

test('leaf hero descendants do not each create separate section entities', () => {
  const { payload } = buildVisualQaPayloadArtifacts(createBaseInput({
    figmaAnalysis: { textNodes: [] },
    webAnalysis: {
      textNodes: [
        createWebTextNode({ text: 'Hero Title', selector: '.hero h2', parentSelector: '.hero .txt', domPath: 'body > main > section.hero > div.txt > h2', role: 'heading', tagName: 'h2', sectionHint: 'hero' }),
        createWebTextNode({ text: 'Hero Body', selector: '.hero p', parentSelector: '.hero .txt', domPath: 'body > main > section.hero > div.txt > p', role: 'body', tagName: 'p', sectionHint: 'hero', yRatio: 0.12 }),
      ],
      ctaCandidates: [createWebCtaCandidate({ text: 'Hero Action', selector: '.hero a.primary', parentContext: '.hero .btn_wrap', parentSelector: '.hero .btn_wrap', href: '/hero', section: 'hero', yRatio: 0.14, xRatio: 0.1 })],
      videoCandidates: [{ type: 'video', source: 'web', sourceId: 'hero-video', text: 'Hero Video', selector: '.hero video', parentContext: '.hero', parentSelector: '.hero', section: 'hero', confidence: 'high', reasons: ['video element'], width: 1600, height: 900, yRatio: 0.05 }],
    },
  }))

  const webSections = payload.aiHints.canonicalEvidence.sections.filter((item) => item.source === 'web')
  assert.equal(webSections.filter((item) => item.role === 'hero').length, 1)
  assert.equal(webSections.some((item) => /\.hero h2|\.hero p|\.hero video|\.hero a\.primary/.test(item.path)), false)
  assert.equal(webSections.length <= 2, true)
})

test('hero-root descendant figma button instances resolve to hero actions while wrapper is excluded', () => {
  const { payload, payloadQuality, debugArtifacts } = buildVisualQaPayloadArtifacts(createBaseInput({
    figmaAnalysis: {
      textNodes: [
        createFigmaTextNode({ nodeId: 'hero-title', layerPath: 'Page / Hero / Title', parentFrameName: 'Hero', characters: 'Hero Title' }),
      ],
      flatNodes: [
        createFigmaFlatNode({ id: 'page-root', nodeId: 'page-root', name: 'Page', type: 'FRAME', layerPath: 'Page', widthRatio: 0.96, heightRatio: 0.96, absoluteBoundingBox: { width: 1440, height: 4200 } }),
        createFigmaFlatNode({ id: 'hero-root', nodeId: 'hero-root', name: 'Main_visual', type: 'FRAME', layerPath: 'Page / Hero', parentId: 'page-root', widthRatio: 0.92, heightRatio: 0.34, yRatio: 0.03, absoluteBoundingBox: { width: 1400, height: 720 }, hasImageFill: true }),
        createFigmaFlatNode({ id: 'btn-wrap', nodeId: 'btn-wrap', name: 'btn', type: 'FRAME', layerPath: 'Page / Hero / CTA Wrap', parentId: 'hero-root', widthRatio: 0.32, heightRatio: 0.08, yRatio: 0.16 }),
        createFigmaFlatNode({ id: 'btn-a', nodeId: 'btn-a', name: 'Button', type: 'INSTANCE', layerPath: 'Page / Hero / CTA Wrap / Primary Button', parentId: 'btn-wrap', widthRatio: 0.15, heightRatio: 0.04, isInteractiveCandidate: true, hasSolidFill: true, cornerRadius: 12 }),
        createFigmaFlatNode({ id: 'btn-a-label', nodeId: 'btn-a-label', name: 'Label', type: 'TEXT', layerPath: 'Page / Hero / CTA Wrap / Primary Button / Label', parentId: 'btn-a', characters: '프로모션 바로가기' }),
        createFigmaFlatNode({ id: 'btn-b', nodeId: 'btn-b', name: 'Button', type: 'INSTANCE', layerPath: 'Page / Hero / CTA Wrap / Secondary Button', parentId: 'btn-wrap', widthRatio: 0.15, heightRatio: 0.04, isInteractiveCandidate: true, hasSolidFill: true, cornerRadius: 12, xRatio: 0.28 }),
        createFigmaFlatNode({ id: 'btn-b-label', nodeId: 'btn-b-label', name: 'Label', type: 'TEXT', layerPath: 'Page / Hero / CTA Wrap / Secondary Button / Label', parentId: 'btn-b', characters: '온라인 구매 상담' }),
      ],
    },
    webAnalysis: {
      textNodes: [createWebTextNode({ text: 'Hero Title', selector: '.hero h2', parentSelector: '.hero', role: 'heading', tagName: 'h2', sectionHint: 'hero' })],
      ctaCandidates: [createWebCtaCandidate({ text: 'Hero Action', selector: '.hero a.primary', parentContext: '.hero .actions', href: '/hero', section: 'hero', yRatio: 0.12, xRatio: 0.1 })],
      videoCandidates: [{ type: 'video', source: 'web', sourceId: 'hero-video', text: 'Hero Video', selector: '.hero video', parentContext: '.hero', parentSelector: '.hero', section: 'hero', confidence: 'high', reasons: ['video element'], width: 1600, height: 900, yRatio: 0.05 }],
    },
  }))

  const figmaActions = payload.aiHints.canonicalEvidence.actions.filter((item) => item.source === 'figma')
  assert.equal(figmaActions.length, 2)
  assert.equal(figmaActions.every((item) => item.sectionId === payload.aiHints.heroSection.figmaSectionId), true)
  assert.equal(figmaActions.some((item) => item.text === '프로모션 바로가기'), true)
  assert.equal(figmaActions.some((item) => item.text === '온라인 구매 상담'), true)
  assert.equal(payload.aiHints.heroCtaGroup.figma.count, 2)
  assert.equal(debugArtifacts.figmaActionInputTrace.heroDescendantNodeCount >= 5, true)
  assert.equal(debugArtifacts.figmaActionInputTrace.buttonLikeNodeCount >= 3, true)
  assert.equal(debugArtifacts.figmaActionInputTrace.rawActionCandidateCount, 2)
  assert.equal(debugArtifacts.figmaActionInputTrace.nodes.some((item) => item.id === 'btn-wrap' && item.candidateCreated === false), true)
  assert.equal(debugArtifacts.entitySectionTrace.figmaHeroActions.length >= 2, true)
  assert.equal(payloadQuality.figmaHeroDescendantNodeCount >= 5, true)
  assert.equal(payloadQuality.figmaButtonLikeNodeCount >= 3, true)
  assert.equal(payloadQuality.figmaInteractiveNodeCount >= 2, true)
  assert.equal(payloadQuality.rawFigmaActionCandidateCount, 2)
  assert.equal(payloadQuality.canonicalFigmaActionCount, 2)
  assert.equal(payloadQuality.rawFigmaHeroActionCandidateCount >= 2, true)
  assert.equal(payloadQuality.resolvedFigmaHeroActionCount, 2)
  assert.equal(payloadQuality.heroActionResolutionPassed, true)
})

test('oversized parent wrapper does not suppress child figma hero buttons', () => {
  const { payload } = buildVisualQaPayloadArtifacts(createBaseInput({
    figmaAnalysis: {
      textNodes: [],
      flatNodes: [
        createFigmaFlatNode({ id: 'page-root', nodeId: 'page-root', name: 'Page', type: 'FRAME', layerPath: 'Page', widthRatio: 0.96, heightRatio: 0.96, absoluteBoundingBox: { width: 1440, height: 4200 } }),
        createFigmaFlatNode({ id: 'hero-root', nodeId: 'hero-root', name: 'Main_visual', type: 'FRAME', layerPath: 'Page / Hero', parentId: 'page-root', widthRatio: 0.92, heightRatio: 0.34, yRatio: 0.03, absoluteBoundingBox: { width: 1400, height: 720 }, hasImageFill: true }),
        createFigmaFlatNode({ id: 'huge-wrap', nodeId: 'huge-wrap', name: 'CTA Wrap', type: 'FRAME', layerPath: 'Page / Hero / CTA Wrap', parentId: 'hero-root', widthRatio: 0.7, heightRatio: 0.16, absoluteBoundingBox: { width: 1100, height: 220 }, isInteractiveCandidate: true }),
        createFigmaFlatNode({ id: 'btn-a', nodeId: 'btn-a', name: 'Button', type: 'INSTANCE', layerPath: 'Page / Hero / CTA Wrap / Button', parentId: 'huge-wrap', widthRatio: 0.16, heightRatio: 0.04, absoluteBoundingBox: { width: 280, height: 64 }, isInteractiveCandidate: true, hasSolidFill: true }),
        createFigmaFlatNode({ id: 'btn-a-label', nodeId: 'btn-a-label', name: 'Label', type: 'TEXT', layerPath: 'Page / Hero / CTA Wrap / Button / Label', parentId: 'btn-a', characters: '신청하기' }),
      ],
    },
    webAnalysis: { textNodes: [] },
  }))

  assert.equal(payload.aiHints.canonicalEvidence.actions.filter((item) => item.source === 'figma').length, 1)
})

test('web video parent selector descendant resolves into hero media and trace', () => {
  const { payload, payloadQuality, debugArtifacts } = buildVisualQaPayloadArtifacts(createBaseInput({
    figmaAnalysis: {
      textNodes: [createFigmaTextNode({ characters: 'Hero Title', layerPath: 'Page / Hero / Title', parentFrameName: 'Hero' })],
      flatNodes: [createFigmaFlatNode({ id: 'hero-root', nodeId: 'hero-root', name: 'Hero', type: 'FRAME', layerPath: 'Page / Hero', widthRatio: 0.92, heightRatio: 0.34, hasImageFill: true })],
    },
    webAnalysis: {
      scanResult: {
        visualPayloadData: {
          videoCandidates: [{ sourceId: 'hero-video', selector: 'div.main_visual.active video', parentSelector: 'div.main_visual.active', domPath: 'body > main > div.main_visual.active > video', autoplay: true, controls: false, visible: true }],
        },
      },
      textNodes: [createWebTextNode({ text: 'Hero Title', selector: 'div.main_visual.active div.txt h2', parentSelector: 'div.main_visual.active div.txt', domPath: 'body > main > div.main_visual.active > div.txt > h2', role: 'heading', tagName: 'h2', sectionHint: 'hero' })],
      ctaCandidates: [createWebCtaCandidate({ text: 'Hero Action', selector: 'div.main_visual.active div.btn_wrap a.primary', parentContext: 'div.main_visual.active div.btn_wrap', parentSelector: 'div.main_visual.active div.btn_wrap', href: '/hero', section: 'hero', yRatio: 0.12, xRatio: 0.1 })],
      videoCandidates: [{ type: 'video', source: 'web', sourceId: 'hero-video', text: 'Hero Video', selector: 'div.main_visual.active video', parentContext: 'div.main_visual.active', parentSelector: 'div.main_visual.active', contextPath: 'body > main > div.main_visual.active > video', section: 'hero', confidence: 'high', reasons: ['video element'], width: 1600, height: 900, xRatio: 0.02, yRatio: 0.05, widthRatio: 0.83, heightRatio: 0.22 }],
    },
  }))

  assert.equal(payload.aiHints.heroMediaGroup.web.candidateCount, 1)
  assert.equal(payload.aiHints.heroMediaGroup.web.mediaTypes.includes('video'), true)
  assert.equal(debugArtifacts.webVideoPipelineTrace.scanResultCount, 1)
  assert.equal(debugArtifacts.webVideoPipelineTrace.webAnalysisCount, 1)
  assert.equal(debugArtifacts.webVideoPipelineTrace.rawMediaCandidateCount, 1)
  assert.equal(debugArtifacts.webVideoPipelineTrace.canonicalMediaCount, 1)
  assert.equal(payloadQuality.resolvedWebHeroMediaCount, 1)
  assert.equal(payloadQuality.heroMediaResolutionPassed, true)
  assert.equal(debugArtifacts.webVideoTrace[0].heroDescendant, true)
})

test('web selector signature merges full and short selector hero CTAs into one canonical action', () => {
  const { payload, payloadQuality } = buildVisualQaPayloadArtifacts(createBaseInput({
    figmaAnalysis: { textNodes: [] },
    webAnalysis: {
      textNodes: [createWebTextNode({ text: 'Hero Title', selector: '.hero h2', parentSelector: '.hero', role: 'heading', tagName: 'h2', sectionHint: 'hero' })],
      ctaCandidates: [
        createWebCtaCandidate({ sourceId: 'cta-long', text: '프로모션 바로가기', selector: 'body > main > div.container > section.hero > div.btn_wrap > a.btn.primary', parentContext: 'body > main > div.container > section.hero > div.btn_wrap', parentSelector: 'section.hero > div.btn_wrap', href: '/promo', section: 'hero', yRatio: 0.12, xRatio: 0.1, widthRatio: 0.14, heightRatio: 0.04 }),
        createWebCtaCandidate({ sourceId: 'cta-short', text: '프로모션 바로가기', selector: 'section.hero > div.btn_wrap > a.btn.primary', parentContext: 'section.hero > div.btn_wrap', parentSelector: 'section.hero > div.btn_wrap', href: '/promo', section: 'hero', yRatio: 0.121, xRatio: 0.1, widthRatio: 0.14, heightRatio: 0.04 }),
      ],
      imageCandidates: [{ type: 'image', source: 'web', sourceId: 'hero-img', selector: '.hero img', parentContext: '.hero', parentSelector: '.hero', section: 'hero', alt: 'Hero', loaded: true, naturalWidth: 1200, naturalHeight: 700 }],
    },
  }))

  const heroActions = payload.aiHints.canonicalEvidence.actions.filter((item) => item.source === 'web' && item.text === '프로모션 바로가기')
  assert.equal(heroActions.length, 1)
  assert.equal(heroActions[0].sources.length, 2)
  assert.equal(payloadQuality.webSelectorSignatureMergedCount >= 1, true)
})

test('same text and href in different positions remain separate web actions', () => {
  const { payload } = buildVisualQaPayloadArtifacts(createBaseInput({
    figmaAnalysis: { textNodes: [] },
    webAnalysis: {
      textNodes: [createWebTextNode({ text: 'Hero Title', selector: '.hero h2', parentSelector: '.hero', role: 'heading', tagName: 'h2', sectionHint: 'hero' })],
      ctaCandidates: [
        createWebCtaCandidate({ sourceId: 'hero-cta-a', text: '온라인 구매 상담', selector: 'section.hero > div.btn_wrap > a.btn', parentContext: 'section.hero > div.btn_wrap', parentSelector: 'section.hero > div.btn_wrap', href: '/consult', section: 'hero', yRatio: 0.12, xRatio: 0.1 }),
        createWebCtaCandidate({ sourceId: 'content-cta-b', text: '온라인 구매 상담', selector: 'section.offer > div.btn_wrap > a.btn', parentContext: 'section.offer > div.btn_wrap', parentSelector: 'section.offer > div.btn_wrap', href: '/consult', section: 'content', yRatio: 0.42, xRatio: 0.1 }),
      ],
      imageCandidates: [{ type: 'image', source: 'web', sourceId: 'hero-img', selector: '.hero img', parentContext: '.hero', parentSelector: '.hero', section: 'hero', alt: 'Hero', loaded: true, naturalWidth: 1200, naturalHeight: 700 }],
    },
  }))

  assert.equal(payload.aiHints.canonicalEvidence.actions.filter((item) => item.text === '온라인 구매 상담').length, 2)
})

test('hero numeric duplicates merge and active slide remains preferred', () => {
  const { payload, payloadQuality } = buildVisualQaPayloadArtifacts(createBaseInput({
    figmaAnalysis: { textNodes: [] },
    webAnalysis: {
      textNodes: [
        createWebTextNode({ id: 'hero-card-price', text: 'BMW 뉴 iX, 월 50만원.', rawText: 'BMW 뉴 iX, 월 50만원.', selector: '.swiper-slide-active .card', parentSelector: '.swiper-slide-active', role: 'body', tagName: 'div', sectionHint: 'content', yRatio: 0.41, xRatio: 0.2 }),
        createWebTextNode({ id: 'hero-card-price-child', text: 'BMW 뉴 iX, 월 50만원.', rawText: 'BMW 뉴 iX, 월 50만원.', selector: '.swiper-slide-active .card p.price', parentSelector: '.swiper-slide-active .card', role: 'body', tagName: 'p', sectionHint: 'content', yRatio: 0.415, xRatio: 0.21 }),
        createWebTextNode({ id: 'dup-slide-price', text: 'BMW 뉴 iX, 월 50만원.', rawText: 'BMW 뉴 iX, 월 50만원.', selector: '.swiper-slide-duplicate .card p.price', parentSelector: '.swiper-slide-duplicate .card', role: 'body', tagName: 'p', sectionHint: 'content', yRatio: 0.415, xRatio: 0.21 }),
      ],
    },
  }))

  assert.equal(payload.aiHints.prices.length, 1)
  assert.equal(payload.aiHints.prices[0].sources.length, 2)
  assert.equal(payloadQuality.duplicateNumericMergedCount >= 1, true)
})
