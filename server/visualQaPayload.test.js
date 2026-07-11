import test from 'node:test'
import assert from 'node:assert/strict'
import { buildVisualQaPayloadArtifacts, createVisualQaPayload, normalizeTextForExactDisplayComparison } from './visualQaPayload.js'

function createFigmaTextNode(overrides = {}) {
  return {
    nodeId: overrides.nodeId || 'figma-1',
    characters: overrides.characters || '기본 문구',
    layerPath: overrides.layerPath || 'Hero / Title',
    parentFrameName: overrides.parentFrameName || 'Hero',
    yRatio: overrides.yRatio ?? 0.1,
    xRatio: overrides.xRatio ?? 0.1,
    fontSize: overrides.fontSize ?? 32,
    fontWeight: overrides.fontWeight ?? 700,
  }
}

function createWebTextNode(overrides = {}) {
  return {
    id: overrides.id || 'web-1',
    text: overrides.text || '기본 문구',
    rawText: overrides.rawText || overrides.text || '기본 문구',
    selector: overrides.selector || 'main h1',
    parentSelector: overrides.parentSelector || 'main',
    domPath: overrides.domPath || 'body > main > h1',
    tagName: overrides.tagName || 'h1',
    role: overrides.role || 'heading',
    sectionHint: overrides.sectionHint || 'hero',
    yRatio: overrides.yRatio ?? 0.1,
    xRatio: overrides.xRatio ?? 0.1,
    href: overrides.href || '',
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
  assert.equal(normalizeTextForExactDisplayComparison('온라인 견적'), '온라인 견적')
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

test('NBSP and normal space only difference is removed from payload differences', () => {
  const { payload, payloadQuality } = buildVisualQaPayloadArtifacts(createBaseInput({
    textComparison: {
      summary: { matchedCount: 1, differenceCount: 1, figmaOnlyCount: 0, webOnlyCount: 0 },
      differences: [{ figmaText: '소비자\u00A0정보포털', webText: '소비자 정보포털', matchConfidence: 'high', evidence: ['same region'] }],
    },
  }))

  assert.equal(payload.comparison.differences.length, 0)
  assert.equal(payloadQuality.invisibleCharacterDiffRemovedCount, 1)
})

test('visible text changes remain as differences', () => {
  const { payload } = buildVisualQaPayloadArtifacts(createBaseInput({
    textComparison: {
      summary: { matchedCount: 3, differenceCount: 3, figmaOnlyCount: 0, webOnlyCount: 0 },
      differences: [
        { figmaText: 'BMW', webText: 'BMWW', matchConfidence: 'high', evidence: ['same region'] },
        { figmaText: '온라인견적', webText: '온라인 견적', matchConfidence: 'high', evidence: ['same region'] },
        { figmaText: '신청하세요.', webText: '신청하세요,', matchConfidence: 'high', evidence: ['same region'] },
      ],
    },
  }))

  assert.equal(payload.comparison.differences.length, 3)
})

test('header nav menu link stays in navigation and is removed from CTA', () => {
  const { payload, payloadQuality } = buildVisualQaPayloadArtifacts(createBaseInput({
    webAnalysis: {
      textNodes: [createWebTextNode({ text: '프로모션', rawText: '프로모션', selector: 'header nav a', parentSelector: 'header nav', role: 'navigation', sectionHint: 'navigation', tagName: 'a', href: '/promo' })],
      ctaCandidates: [{ type: 'cta', source: 'web', text: '프로모션', selector: 'header nav a', context: 'header nav a', href: '/promo', section: 'navigation', confidence: 'medium', reasons: ['interactive selector', 'has href'] }],
      sectionCandidates: [{ type: 'section', source: 'web', name: 'navigation', confidence: 'high', reasons: ['navigation cluster'] }],
    },
  }))

  assert.equal(payload.aiHints.navigation.webItems.length, 1)
  assert.equal(payload.aiHints.ctaButtons.length, 0)
  assert.equal(payloadQuality.navigationRemovedFromCtaCount > 0, true)
})

test('hero content button remains as CTA', () => {
  const { payload } = buildVisualQaPayloadArtifacts(createBaseInput({
    webAnalysis: {
      textNodes: [createWebTextNode({ text: '구매상담 신청', rawText: '구매상담 신청', selector: 'main .hero button', parentSelector: 'main .hero', role: 'cta', sectionHint: 'hero', tagName: 'button' })],
      ctaCandidates: [{ type: 'cta', source: 'web', text: '구매상담 신청', selector: 'main .hero button', context: 'main .hero button', href: '', section: 'hero', confidence: 'high', reasons: ['interactive selector', 'visible', 'top section'] }],
    },
  }))

  assert.equal(payload.aiHints.ctaButtons.length >= 1, true)
  assert.equal(payload.aiHints.ctaButtons[0].text, '구매상담 신청')
})

test('long disclaimer with numeric tokens is excluded from prices', () => {
  const { payload, payloadQuality } = buildVisualQaPayloadArtifacts(createBaseInput({
    figmaAnalysis: {
      textNodes: [createFigmaTextNode({
        nodeId: 'legal-1',
        characters: '기준금리 4.99% 및 계약기간 36개월 관련 상세 안내 문장으로 여러 숫자가 포함된 긴 계약 안내 전체 문단입니다.',
        layerPath: 'Footer / Legal / Disclaimer',
        parentFrameName: 'Footer',
        yRatio: 0.92,
        fontSize: 12,
        fontWeight: 400,
      })],
    },
  }))

  assert.equal(payload.aiHints.prices.length, 0)
  assert.equal(payloadQuality.priceNoiseRemovedCount, 1)
})

test('short amount and rate phrases are included in prices with tokens and reasons', () => {
  const { payload } = buildVisualQaPayloadArtifacts(createBaseInput({
    figmaAnalysis: {
      textNodes: [
        createFigmaTextNode({ nodeId: 'price-1', characters: '월 47만원', layerPath: 'Hero / Price', parentFrameName: 'Hero' }),
        createFigmaTextNode({ nodeId: 'price-2', characters: '4.99%', layerPath: 'Card / Rate', parentFrameName: 'Card', fontSize: 18, fontWeight: 600, yRatio: 0.4 }),
      ],
    },
    webAnalysis: { textNodes: [] },
  }))

  assert.equal(payload.aiHints.prices.length, 2)
  assert.deepEqual(payload.aiHints.prices[0].numericTokens.length > 0, true)
  assert.deepEqual(payload.aiHints.prices[0].unitTokens.length > 0, true)
  assert.equal(typeof payload.aiHints.prices[0].context, 'string')
  assert.equal(Array.isArray(payload.aiHints.prices[0].reasons), true)
})

test('hero image candidates and web video candidate create hero media group', () => {
  const { payload, payloadQuality } = buildVisualQaPayloadArtifacts(createBaseInput({
    figmaAnalysis: {
      flatNodes: [
        { nodeId: 'img-1', name: 'Hero Image 1', layerPath: 'Hero / Image 1', yRatio: 0.05, widthRatio: 0.8, heightRatio: 0.4, effectivelyVisible: true, hasImageFill: true, hasVideoLikeContent: false, isInteractiveCandidate: false },
        { nodeId: 'img-2', name: 'Hero Image 2', layerPath: 'Hero / Image 2', yRatio: 0.08, widthRatio: 0.75, heightRatio: 0.35, effectivelyVisible: true, hasImageFill: true, hasVideoLikeContent: false, isInteractiveCandidate: false },
        { nodeId: 'img-3', name: 'Hero Image 3', layerPath: 'Hero / Image 3', yRatio: 0.1, widthRatio: 0.7, heightRatio: 0.3, effectivelyVisible: true, hasImageFill: true, hasVideoLikeContent: false, isInteractiveCandidate: false },
      ],
    },
    webAnalysis: {
      videoCandidates: [{ type: 'video', source: 'web', sourceId: 'video-1', text: 'Hero Video', selector: 'main video', context: 'main video', section: 'hero', confidence: 'high', reasons: ['video element', 'top section'], yRatio: 0.1, width: 1600, height: 900, visible: true }],
    },
  }))

  assert.equal(payload.aiHints.heroMediaGroup.type, 'hero-media')
  assert.deepEqual(payload.aiHints.heroMediaGroup.figma.mediaTypes, ['image'])
  assert.deepEqual(payload.aiHints.heroMediaGroup.web.mediaTypes, ['video'])
  assert.equal(payload.aiHints.heroMediaGroup.figma.candidateCount, 3)
  assert.equal(payload.aiHints.heroMediaGroup.web.candidateCount, 1)
  assert.equal(payload.aiHints.heroMediaGroup.comparisonHint, 'figma-image-vs-web-video')
  assert.equal(payloadQuality.heroMediaGroupCreated, true)
})

test('duplicate candidates are deduplicated but same text in different positions remains', () => {
  const { payload, payloadQuality } = buildVisualQaPayloadArtifacts(createBaseInput({
    webAnalysis: {
      ctaCandidates: [
        { type: 'cta', source: 'web', sourceId: 'button-1', text: 'Apply', selector: 'button.apply', context: 'button.apply', section: 'hero', confidence: 'high', reasons: ['interactive selector'], yRatio: 0.1 },
        { type: 'cta', source: 'web', sourceId: 'button-1', text: 'Apply', selector: 'button.apply', context: 'button.apply', section: 'hero', confidence: 'medium', reasons: ['has href'], yRatio: 0.1 },
        { type: 'cta', source: 'web', sourceId: 'button-2', text: 'Apply', selector: 'section.footer button', context: 'section.footer button', section: 'bottom', confidence: 'high', reasons: ['interactive selector'], yRatio: 0.8 },
      ],
      textNodes: [],
    },
  }))

  assert.equal(payload.aiHints.ctaButtons.length, 2)
  assert.equal(payloadQuality.candidateDeduplicatedCount >= 1, true)
})

test('createVisualQaPayload excludes raw internals and includes evidence summary', () => {
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
  const serialized = JSON.stringify(payload)
  assert.equal(serialized.includes('matchedPairs'), false)
  assert.equal(serialized.includes('allPairs'), false)
  assert.equal(serialized.includes('<html>secret</html>'), false)
  assert.equal(serialized.includes('raw-json-should-not-appear'), false)
})
