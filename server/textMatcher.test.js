import test from 'node:test'
import assert from 'node:assert/strict'
import { createTextDifferenceCandidates, isVisualLinebreakOnlyDifference } from './textDiff.js'
import { matchTextNodes } from './textMatcher.js'

function createFigmaNode(overrides = {}) {
  return {
    id: overrides.nodeId || 'figma-1',
    nodeId: overrides.nodeId || 'figma-1',
    name: 'Layer',
    characters: 'Sample text',
    xRatio: 0.1,
    yRatio: 0.1,
    widthRatio: 0.2,
    heightRatio: 0.03,
    fontSize: 24,
    fontWeight: 700,
    siblingIndex: 0,
    layerPath: 'Root / Hero / Title',
    parentFrameName: 'Hero',
    parentType: 'FRAME',
    ...overrides,
  }
}

function createWebElement(overrides = {}) {
  return {
    id: overrides.id || 'web-1',
    text: 'Sample text',
    rawText: 'Sample text',
    normalizedText: 'sampletext',
    tagName: 'h1',
    role: null,
    href: null,
    visible: true,
    selector: '#hero-title',
    domPath: 'main > section.hero > h1',
    parentSelector: 'main > section.hero',
    parentTagName: 'section',
    sectionHint: 'hero',
    absoluteBoundingBox: { x: 100, y: 120, width: 240, height: 42 },
    relativeBoundingBox: { x: 100, y: 120, width: 240, height: 42 },
    xRatio: 0.1,
    yRatio: 0.1,
    widthRatio: 0.2,
    heightRatio: 0.03,
    fontSize: 24,
    fontWeight: 700,
    textAlign: 'left',
    depth: 3,
    siblingIndex: 0,
    ...overrides,
  }
}

test('same section and position can match and produce raw text difference', () => {
  const result = matchTextNodes(
    [createFigmaNode({ nodeId: 'f-1', characters: 'BMW' })],
    [createWebElement({ id: 'w-1', rawText: 'BMWW', text: 'BMWW' })],
    { includeAllPairs: true },
  )

  assert.equal(result.matchedPairs.length, 1)
  assert.match(result.matchedPairs[0].matchConfidence, /high|medium/)

  const differences = createTextDifferenceCandidates(result.matchedPairs)
  assert.equal(differences.length, 1)
  assert.equal(differences[0].figmaText, 'BMW')
  assert.equal(differences[0].webText, 'BMWW')
})

test('numeric difference creates a text difference candidate', () => {
  const result = matchTextNodes(
    [createFigmaNode({ nodeId: 'f-2', characters: '연 4.99%', fontSize: 18, fontWeight: 500, layerPath: 'Root / Price' })],
    [createWebElement({ id: 'w-2', rawText: '연 4.95%', text: '연 4.95%', tagName: 'span', domPath: 'main > section.offer > span.price', selector: '.price', fontSize: 18, fontWeight: 500 })],
  )

  const differences = createTextDifferenceCandidates(result.matchedPairs)
  assert.equal(differences.length, 1)
  assert.match(differences[0].category, /price|number/)
})

test('punctuation difference creates a text difference candidate', () => {
  const result = matchTextNodes(
    [createFigmaNode({ nodeId: 'f-3', characters: '신청하세요.', fontSize: 16, fontWeight: 600, layerPath: 'Root / CTA / Button' })],
    [createWebElement({ id: 'w-3', rawText: '신청하세요,', text: '신청하세요,', tagName: 'button', domPath: 'main > section.hero > button', selector: 'button.cta', fontSize: 16, fontWeight: 600 })],
  )

  const differences = createTextDifferenceCandidates(result.matchedPairs)
  assert.equal(differences.length, 1)
})

test('visual linebreak only difference does not create a text difference', () => {
  assert.equal(isVisualLinebreakOnlyDifference('지금\n신청하세요', '지금 신청하세요'), true)

  const result = matchTextNodes(
    [createFigmaNode({ nodeId: 'f-4', characters: '지금\n신청하세요', fontSize: 20, fontWeight: 700 })],
    [createWebElement({ id: 'w-4', rawText: '지금 신청하세요', text: '지금 신청하세요', tagName: 'button', selector: '.hero-cta' })],
  )

  const differences = createTextDifferenceCandidates(result.matchedPairs)
  assert.equal(differences.length, 0)
})

test('hero heading does not match footer legal sentence', () => {
  const result = matchTextNodes(
    [createFigmaNode({ nodeId: 'f-5', characters: '지금 시작하세요', layerPath: 'Root / Hero / Title', fontSize: 40, fontWeight: 700 })],
    [createWebElement({ id: 'w-5', rawText: '본 서비스는 약관에 따라 제공됩니다. 개인정보 처리방침을 확인하세요.', text: '본 서비스는 약관에 따라 제공됩니다. 개인정보 처리방침을 확인하세요.', tagName: 'small', domPath: 'footer > small.legal', selector: 'footer .legal', sectionHint: 'legal', fontSize: 12, fontWeight: 400, yRatio: 0.95 })],
    { includeAllPairs: true },
  )

  assert.equal(result.matchedPairs.length, 0)
  assert.equal(result.figmaOnly.length, 1)
  assert.equal(result.webOnly.length, 1)
  assert.match(result.allPairs[0].rejectReasons.join(' '), /heading|legal|navigation|yRatio/)
})

test('CTA does not match long body paragraph', () => {
  const result = matchTextNodes(
    [createFigmaNode({ nodeId: 'f-6', characters: '자세히 보기', layerPath: 'Root / CTA / Button', fontSize: 18, fontWeight: 700 })],
    [createWebElement({ id: 'w-6', rawText: '이 상품은 여러 혜택과 조건을 포함하며 자세한 내용은 아래 안내 문단을 확인해 주세요.', text: '이 상품은 여러 혜택과 조건을 포함하며 자세한 내용은 아래 안내 문단을 확인해 주세요.', tagName: 'p', domPath: 'main > section.content > p', selector: '.content p', fontSize: 16, fontWeight: 400 })],
    { includeAllPairs: true },
  )

  assert.equal(result.matchedPairs.length, 0)
  assert.match(result.allPairs[0].rejectReasons.join(' '), /CTA|본문/)
})

test('duplicate text uses position and context for one-to-one matching', () => {
  const figmaNodes = [
    createFigmaNode({ nodeId: 'f-7a', characters: '더 보기', yRatio: 0.12, layerPath: 'Root / Hero / CTA', siblingIndex: 0 }),
    createFigmaNode({ nodeId: 'f-7b', characters: '더 보기', yRatio: 0.82, layerPath: 'Root / Footer / CTA', parentFrameName: 'Footer', siblingIndex: 0 }),
  ]
  const webElements = [
    createWebElement({ id: 'w-7a', rawText: '더 보기', text: '더 보기', yRatio: 0.13, domPath: 'main > section.hero > a.cta', selector: '.hero .cta', sectionHint: 'hero' }),
    createWebElement({ id: 'w-7b', rawText: '더 보기', text: '더 보기', yRatio: 0.81, domPath: 'footer > a.cta', selector: 'footer .cta', sectionHint: 'footer' }),
  ]

  const result = matchTextNodes(figmaNodes, webElements)
  assert.equal(result.matchedPairs.length, 2)

  const heroPair = result.matchedPairs.find((pair) => pair.figmaNode.nodeId === 'f-7a')
  const footerPair = result.matchedPairs.find((pair) => pair.figmaNode.nodeId === 'f-7b')
  assert.equal(heroPair.webElement.id, 'w-7a')
  assert.equal(footerPair.webElement.id, 'w-7b')
})

test('one web element is not matched to multiple figma nodes', () => {
  const result = matchTextNodes(
    [
      createFigmaNode({ nodeId: 'f-8a', characters: '혜택 보기', yRatio: 0.2, layerPath: 'Root / Section / Link A' }),
      createFigmaNode({ nodeId: 'f-8b', characters: '혜택 보기', yRatio: 0.21, layerPath: 'Root / Section / Link B' }),
    ],
    [createWebElement({ id: 'w-8', rawText: '혜택 보기', text: '혜택 보기', yRatio: 0.205, selector: '.benefit-link' })],
  )

  assert.equal(result.matchedPairs.length, 1)
  assert.equal(result.webOnly.length, 0)
  assert.equal(result.figmaOnly.length, 1)
})

test('large yRatio gap without context support is rejected', () => {
  const result = matchTextNodes(
    [createFigmaNode({ nodeId: 'f-9', characters: '프로모션', yRatio: 0.08, layerPath: 'Root / Hero / Promo' })],
    [createWebElement({ id: 'w-9', rawText: '프로모션', text: '프로모션', yRatio: 0.91, domPath: 'main > section.misc > span', selector: '.misc span', sectionHint: 'bottom' })],
    { includeAllPairs: true },
  )

  assert.equal(result.matchedPairs.length, 0)
  assert.match(result.allPairs[0].rejectReasons.join(' '), /yRatio 차이가 크/)
})
