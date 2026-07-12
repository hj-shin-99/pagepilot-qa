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
