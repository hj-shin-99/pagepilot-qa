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

test('text matcher exposes score components only for diagnostic requests', () => {
  const normal = matchTextNodes(
    [createFigmaNode({ nodeId: 'f-diagnostic', characters: 'Primary copy' })],
    [createWebElement({ id: 'w-diagnostic', rawText: 'Primary copy changed', text: 'Primary copy changed' })],
    { includeAllPairs: true },
  )
  const diagnostic = matchTextNodes(
    [createFigmaNode({ nodeId: 'f-diagnostic', characters: 'Primary copy' })],
    [createWebElement({ id: 'w-diagnostic', rawText: 'Primary copy changed', text: 'Primary copy changed' })],
    { includeAllPairs: true, includeDiagnostics: true },
  )

  assert.equal('diagnostics' in normal.allPairs[0], false)
  assert.equal(typeof diagnostic.allPairs[0].diagnostics.normalizedSimilarity, 'number')
  assert.equal(diagnostic.allPairs[0].diagnostics.threshold.minimumMatchScore, 45)
  assert.equal(diagnostic.matchedPairs[0].diagnostics.gate, 'eligible')
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

test('bounded assignment resolves a local greedy source reuse trap without duplicate sources', () => {
  const result = matchTextNodes(
    [
      createFigmaNode({ nodeId: 'f-trap-a', characters: 'Launch summary', layerPath: 'Root / Feature / Copy', parentFrameName: 'Feature', yRatio: 0.1, siblingIndex: 0 }),
      createFigmaNode({ nodeId: 'f-trap-b', characters: 'Summary details', layerPath: 'Root / Feature / Copy', parentFrameName: 'Feature', yRatio: 0.12, siblingIndex: 1 }),
    ],
    [
      createWebElement({ id: 'w-trap-x', rawText: 'Launch summary', text: 'Launch summary', selector: '.feature-title', domPath: 'main > section.feature > p:nth-child(1)', sectionHint: 'top', yRatio: 0.1, siblingIndex: 0 }),
      createWebElement({ id: 'w-trap-y', rawText: 'Launch overview', text: 'Launch overview', selector: '.feature-copy', domPath: 'main > section.feature > p:nth-child(2)', sectionHint: 'top', yRatio: 0.12, siblingIndex: 1 }),
    ],
    { includeAllPairs: true, includeDiagnostics: true },
  )

  assert.match(result.assignment.strategy, /greedy|bounded-component/)
  assert.equal(result.matchedPairs.length, 2)
  assert.equal(new Set(result.matchedPairs.map((pair) => pair.figmaNode.nodeId)).size, 2)
  assert.equal(new Set(result.matchedPairs.map((pair) => pair.webElement.id)).size, 2)
  assert.equal(result.matchedPairs.some((pair) => pair.figmaNode.nodeId === 'f-trap-b'), true)

  const differences = createTextDifferenceCandidates(result.matchedPairs)
  assert.equal(differences.some((difference) => difference.figmaNodeId === 'f-trap-b'), true)
})

test('local sibling alternate adds a semantic replacement edge from strong adjacent anchor', () => {
  const result = matchTextNodes(
    [
      createFigmaNode({ nodeId: 'f-sibling-a', characters: 'Launch the new product', layerPath: 'Root / Product / Text Block', parentFrameName: 'Text Block', yRatio: 0.1, siblingIndex: 0 }),
      createFigmaNode({ nodeId: 'f-sibling-b', characters: 'Meet the product with flexible plan', layerPath: 'Root / Product / Text Block', parentFrameName: 'Text Block', yRatio: 0.12, siblingIndex: 1 }),
    ],
    [
      createWebElement({ id: 'w-sibling-a', rawText: 'Launch the new product', text: 'Launch the new product', selector: '.product-title', domPath: 'main > section.product > div.copy > p:nth-child(1)', sectionHint: 'top', role: 'heading', yRatio: 0.1, siblingIndex: 0 }),
      createWebElement({ id: 'w-sibling-b', rawText: 'Built for tomorrow drivers', text: 'Built for tomorrow drivers', selector: '.product-copy', domPath: 'main > section.product > div.copy > p:nth-child(2)', sectionHint: 'top', role: 'body', yRatio: 0.12, siblingIndex: 1 }),
    ],
    { includeAllPairs: true, includeDiagnostics: true },
  )

  const normalEdges = result.allPairs.filter((pair) => pair.edgeOrigin === 'normal' && !pair.rejected && pair.matchScore >= 45)
  const alternateEdge = result.allPairs.find((pair) => pair.edgeOrigin === 'local-sibling-alternate')
  assert.equal(new Set(normalEdges.map((pair) => pair.figmaNode.nodeId)).size, 2)
  assert.deepEqual([...new Set(normalEdges.map((pair) => pair.webElement.id))], ['w-sibling-a'])
  assert.equal(normalEdges.length, 2)
  assert.equal(alternateEdge.figmaNode.nodeId, 'f-sibling-b')
  assert.equal(alternateEdge.webElement.id, 'w-sibling-b')
  assert.equal(alternateEdge.anchorPairKey, '0:0')
  assert.equal(alternateEdge.diagnostics.edgeOrigin, 'local-sibling-alternate')
  assert.equal(result.matchedPairs.length, 2)
  assert.deepEqual(result.matchedPairs.map((pair) => [pair.figmaNode.nodeId, pair.webElement.id, pair.edgeOrigin]), [['f-sibling-a', 'w-sibling-a', 'normal'], ['f-sibling-b', 'w-sibling-b', 'local-sibling-alternate']])

  const differences = createTextDifferenceCandidates(result.matchedPairs)
  assert.equal(differences.some((difference) => difference.figmaNodeId === 'f-sibling-b' && difference.webSelector === '.product-copy'), true)
})

test('local sibling alternate is not created without a strong anchor', () => {
  const result = matchTextNodes(
    [
      createFigmaNode({ nodeId: 'f-no-anchor-a', characters: 'North signal', layerPath: 'Root / Block / Text', parentFrameName: 'Block', yRatio: 0.1, siblingIndex: 0 }),
      createFigmaNode({ nodeId: 'f-no-anchor-b', characters: 'Flexible product details', layerPath: 'Root / Block / Text', parentFrameName: 'Block', yRatio: 0.12, siblingIndex: 1 }),
    ],
    [
      createWebElement({ id: 'w-no-anchor-a', rawText: 'South marker', text: 'South marker', selector: '.block-title', domPath: 'main > section.block > p:nth-child(1)', sectionHint: 'top', yRatio: 0.1, siblingIndex: 0 }),
      createWebElement({ id: 'w-no-anchor-b', rawText: 'Modern journey details', text: 'Modern journey details', selector: '.block-copy', domPath: 'main > section.block > p:nth-child(2)', sectionHint: 'top', yRatio: 0.12, siblingIndex: 1 }),
    ],
    { includeAllPairs: true },
  )

  assert.equal(result.allPairs.some((pair) => pair.edgeOrigin === 'local-sibling-alternate'), false)
})

test('local sibling alternate does not cross CTA and body boundaries', () => {
  const result = matchTextNodes(
    [
      createFigmaNode({ nodeId: 'f-alt-cta-a', characters: 'Plan overview', layerPath: 'Root / Block / Title', parentFrameName: 'Block', yRatio: 0.1, siblingIndex: 0 }),
      createFigmaNode({ nodeId: 'f-alt-cta-b', characters: 'Start now', layerPath: 'Root / Block / Button', parentFrameName: 'Block', yRatio: 0.12, siblingIndex: 1 }),
    ],
    [
      createWebElement({ id: 'w-alt-cta-a', rawText: 'Plan overview', text: 'Plan overview', selector: '.block-title', domPath: 'main > section.block > h2', sectionHint: 'top', role: 'heading', yRatio: 0.1, siblingIndex: 0 }),
      createWebElement({ id: 'w-alt-cta-b', rawText: 'Detailed plan explanation for visitors', text: 'Detailed plan explanation for visitors', selector: '.block-copy', domPath: 'main > section.block > p', sectionHint: 'top', role: 'body', yRatio: 0.12, siblingIndex: 1 }),
    ],
    { includeAllPairs: true },
  )

  assert.equal(result.allPairs.some((pair) => pair.edgeOrigin === 'local-sibling-alternate'), false)
})

test('local sibling alternate does not cross navigation and content boundaries', () => {
  const result = matchTextNodes(
    [
      createFigmaNode({ nodeId: 'f-alt-nav-a', characters: 'Menu overview', layerPath: 'Root / Navigation / Item', parentFrameName: 'Navigation', yRatio: 0.04, siblingIndex: 0 }),
      createFigmaNode({ nodeId: 'f-alt-nav-b', characters: 'Products', layerPath: 'Root / Navigation / Item', parentFrameName: 'Navigation', yRatio: 0.06, siblingIndex: 1 }),
    ],
    [
      createWebElement({ id: 'w-alt-nav-a', rawText: 'Menu overview', text: 'Menu overview', selector: 'nav .overview', domPath: 'nav > a:nth-child(1)', sectionHint: 'navigation', role: 'navigation', yRatio: 0.04, siblingIndex: 0 }),
      createWebElement({ id: 'w-alt-nav-b', rawText: 'Products overview for the page', text: 'Products overview for the page', selector: '.content-copy', domPath: 'main > section.content > p', sectionHint: 'top', role: 'body', yRatio: 0.06, siblingIndex: 1 }),
    ],
    { includeAllPairs: true },
  )

  assert.equal(result.allPairs.some((pair) => pair.edgeOrigin === 'local-sibling-alternate'), false)
})

test('local sibling alternate does not cross footer legal and body boundaries', () => {
  const result = matchTextNodes(
    [
      createFigmaNode({ nodeId: 'f-alt-legal-a', characters: 'Content overview', layerPath: 'Root / Content / Title', parentFrameName: 'Content', yRatio: 0.1, siblingIndex: 0 }),
      createFigmaNode({ nodeId: 'f-alt-legal-b', characters: 'Helpful product information', layerPath: 'Root / Content / Body', parentFrameName: 'Content', yRatio: 0.12, siblingIndex: 1 }),
    ],
    [
      createWebElement({ id: 'w-alt-legal-a', rawText: 'Content overview', text: 'Content overview', selector: '.content-title', domPath: 'main > section.content > h2', sectionHint: 'top', role: 'heading', yRatio: 0.1, siblingIndex: 0 }),
      createWebElement({ id: 'w-alt-legal-b', rawText: 'Legal product information for visitors', text: 'Legal product information for visitors', selector: 'footer small', domPath: 'footer > small', sectionHint: 'legal', role: 'legal', yRatio: 0.12, siblingIndex: 1 }),
    ],
    { includeAllPairs: true },
  )

  assert.equal(result.allPairs.some((pair) => pair.edgeOrigin === 'local-sibling-alternate'), false)
})

test('local sibling alternate does not connect different peer cards by same column alone', () => {
  const result = matchTextNodes(
    [
      createFigmaNode({ nodeId: 'f-alt-card-a', characters: 'Card title', layerPath: 'Root / Card A / Title', parentFrameName: 'Card A', xRatio: 0.12, yRatio: 0.3, siblingIndex: 0 }),
      createFigmaNode({ nodeId: 'f-alt-card-b', characters: 'Flexible plan details', layerPath: 'Root / Card B / Copy', parentFrameName: 'Card B', xRatio: 0.62, yRatio: 0.3, siblingIndex: 1 }),
    ],
    [
      createWebElement({ id: 'w-alt-card-a', rawText: 'Card title', text: 'Card title', selector: '.card-a-title', domPath: 'main > section.cards > article.card-a > h3', sectionHint: 'middle', xRatio: 0.12, yRatio: 0.3, siblingIndex: 0 }),
      createWebElement({ id: 'w-alt-card-b', rawText: 'Modern journey details', text: 'Modern journey details', selector: '.card-a-copy', domPath: 'main > section.cards > article.card-a > p', sectionHint: 'middle', xRatio: 0.12, yRatio: 0.32, siblingIndex: 1 }),
    ],
    { includeAllPairs: true },
  )

  assert.equal(result.allPairs.some((pair) => pair.edgeOrigin === 'local-sibling-alternate'), false)
})

test('local sibling alternate does not create an inverted order edge', () => {
  const result = matchTextNodes(
    [
      createFigmaNode({ nodeId: 'f-alt-order-a', characters: 'Sequence title', layerPath: 'Root / Sequence / Title', parentFrameName: 'Sequence', yRatio: 0.1, siblingIndex: 0 }),
      createFigmaNode({ nodeId: 'f-alt-order-b', characters: 'Flexible sequence details', layerPath: 'Root / Sequence / Copy', parentFrameName: 'Sequence', yRatio: 0.12, siblingIndex: 1 }),
    ],
    [
      createWebElement({ id: 'w-alt-order-a', rawText: 'Sequence title', text: 'Sequence title', selector: '.sequence-title', domPath: 'main > section.sequence > h2', sectionHint: 'top', yRatio: 0.1, siblingIndex: 0 }),
      createWebElement({ id: 'w-alt-order-b', rawText: 'Modern sequence details', text: 'Modern sequence details', selector: '.sequence-copy', domPath: 'main > section.sequence > p', sectionHint: 'top', yRatio: 0.08, siblingIndex: 1 }),
    ],
    { includeAllPairs: true },
  )

  assert.equal(result.allPairs.some((pair) => pair.edgeOrigin === 'local-sibling-alternate'), false)
})

test('local sibling alternate does not use distant same-column text as a sibling', () => {
  const result = matchTextNodes(
    [
      createFigmaNode({ nodeId: 'f-alt-distant-a', characters: 'Column title', layerPath: 'Root / Column / Title', parentFrameName: 'Column', xRatio: 0.1, yRatio: 0.1, siblingIndex: 0 }),
      createFigmaNode({ nodeId: 'f-alt-distant-b', characters: 'Flexible column details', layerPath: 'Root / Column / Copy', parentFrameName: 'Column', xRatio: 0.1, yRatio: 0.42, siblingIndex: 1 }),
    ],
    [
      createWebElement({ id: 'w-alt-distant-a', rawText: 'Column title', text: 'Column title', selector: '.column-title', domPath: 'main > section.column > h2', sectionHint: 'top', xRatio: 0.1, yRatio: 0.1, siblingIndex: 0 }),
      createWebElement({ id: 'w-alt-distant-b', rawText: 'Modern column details', text: 'Modern column details', selector: '.column-copy', domPath: 'main > section.column > p', sectionHint: 'middle', xRatio: 0.1, yRatio: 0.42, siblingIndex: 1 }),
    ],
    { includeAllPairs: true },
  )

  assert.equal(result.allPairs.some((pair) => pair.edgeOrigin === 'local-sibling-alternate'), false)
})

test('bounded assignment prefers local reading order when adjacent alternatives are ambiguous', () => {
  const result = matchTextNodes(
    [
      createFigmaNode({ nodeId: 'f-order-a', characters: 'Alpha heading', layerPath: 'Root / Panel / Copy', parentFrameName: 'Panel', yRatio: 0.1, siblingIndex: 0 }),
      createFigmaNode({ nodeId: 'f-order-b', characters: 'Beta heading', layerPath: 'Root / Panel / Copy', parentFrameName: 'Panel', yRatio: 0.12, siblingIndex: 1 }),
    ],
    [
      createWebElement({ id: 'w-order-x', rawText: 'Beta heading', text: 'Beta heading', selector: '.panel-copy-a', domPath: 'main > section.panel > p:nth-child(1)', sectionHint: 'top', yRatio: 0.1, siblingIndex: 0 }),
      createWebElement({ id: 'w-order-y', rawText: 'Alpha heading', text: 'Alpha heading', selector: '.panel-copy-b', domPath: 'main > section.panel > p:nth-child(2)', sectionHint: 'top', yRatio: 0.12, siblingIndex: 1 }),
    ],
    { includeAllPairs: true, includeDiagnostics: true },
  )

  assert.equal(result.assignment.strategy, 'bounded-component')
  assert.deepEqual(result.matchedPairs.map((pair) => [pair.figmaNode.nodeId, pair.webElement.id]), [['f-order-a', 'w-order-x'], ['f-order-b', 'w-order-y']])
  assert.equal(result.assignment.components[0].refined.orderPenalty, 0)
})

test('bounded assignment does not force distant unrelated text into a match', () => {
  const result = matchTextNodes(
    [createFigmaNode({ nodeId: 'f-distant', characters: 'Launch summary', layerPath: 'Root / Feature / Copy', parentFrameName: 'Feature', yRatio: 0.08 })],
    [createWebElement({ id: 'w-distant', rawText: 'Launch summary', text: 'Launch summary', selector: '.footer-copy', domPath: 'footer > p', sectionHint: 'footer', yRatio: 0.92 })],
    { includeAllPairs: true, includeDiagnostics: true },
  )

  assert.equal(result.matchedPairs.length, 0)
  assert.equal(result.assignment.componentCount, 0)
  assert.match(result.allPairs[0].rejectReasons.join(' '), /yRatio 차이가 크/)
})

test('bounded assignment keeps repeated labels inside the correct peer containers', () => {
  const result = matchTextNodes(
    [
      createFigmaNode({ nodeId: 'f-card-a', characters: 'Learn more', layerPath: 'Root / Card A / Link', parentFrameName: 'Card A', xRatio: 0.12, yRatio: 0.3, siblingIndex: 0 }),
      createFigmaNode({ nodeId: 'f-card-b', characters: 'Learn more', layerPath: 'Root / Card B / Link', parentFrameName: 'Card B', xRatio: 0.62, yRatio: 0.3, siblingIndex: 0 }),
    ],
    [
      createWebElement({ id: 'w-card-a', rawText: 'Learn more', text: 'Learn more', selector: '.card-a a', domPath: 'main > section.grid > article.card-a > a', sectionHint: 'middle', xRatio: 0.12, yRatio: 0.3 }),
      createWebElement({ id: 'w-card-b', rawText: 'Learn more', text: 'Learn more', selector: '.card-b a', domPath: 'main > section.grid > article.card-b > a', sectionHint: 'middle', xRatio: 0.62, yRatio: 0.3 }),
    ],
  )

  assert.deepEqual(result.matchedPairs.map((pair) => [pair.figmaNode.nodeId, pair.webElement.id]), [['f-card-a', 'w-card-a'], ['f-card-b', 'w-card-b']])
})

test('bounded assignment does not cross-match CTA and body just to increase count', () => {
  const result = matchTextNodes(
    [
      createFigmaNode({ nodeId: 'f-cta-body-a', characters: 'Start now', layerPath: 'Root / Actions / Button', fontSize: 18, fontWeight: 700, yRatio: 0.2 }),
      createFigmaNode({ nodeId: 'f-cta-body-b', characters: 'Detailed product explanation for the selected plan', layerPath: 'Root / Content / Paragraph', fontSize: 16, fontWeight: 400, yRatio: 0.24 }),
    ],
    [
      createWebElement({ id: 'w-cta-body-a', rawText: 'Detailed product explanation for the selected plan', text: 'Detailed product explanation for the selected plan', tagName: 'p', selector: '.content p', domPath: 'main > section.content > p', role: 'body', fontSize: 16, fontWeight: 400, yRatio: 0.2 }),
      createWebElement({ id: 'w-cta-body-b', rawText: 'Start now', text: 'Start now', tagName: 'button', selector: '.actions button', domPath: 'main > section.actions > button', role: 'cta', fontSize: 18, fontWeight: 700, yRatio: 0.24 }),
    ],
    { includeAllPairs: true },
  )

  assert.equal(result.matchedPairs.length, 2)
  assert.deepEqual(result.matchedPairs.map((pair) => [pair.figmaNode.nodeId, pair.webElement.id]), [['f-cta-body-a', 'w-cta-body-b'], ['f-cta-body-b', 'w-cta-body-a']])
  assert.equal(result.allPairs.some((pair) => pair.rejectReasons.join(' ').includes('본문')), true)
})

test('bounded assignment keeps body and legal/footer text guards intact', () => {
  const result = matchTextNodes(
    [createFigmaNode({ nodeId: 'f-legal-guard', characters: 'Product details are available today', layerPath: 'Root / Content / Body', parentFrameName: 'Content', yRatio: 0.2, fontSize: 18, fontWeight: 400 })],
    [createWebElement({ id: 'w-legal-guard', rawText: 'Product details are available today', text: 'Product details are available today', selector: 'footer small', domPath: 'footer > small.legal', sectionHint: 'legal', role: 'legal', yRatio: 0.9, fontSize: 12, fontWeight: 400 })],
    { includeAllPairs: true },
  )

  assert.equal(result.matchedPairs.length, 0)
  assert.equal(result.figmaOnly.length, 1)
  assert.equal(result.webOnly.length, 1)
})

test('bounded assignment preserves clear exact and near-exact lexical matches', () => {
  const result = matchTextNodes(
    [
      createFigmaNode({ nodeId: 'f-exact-a', characters: 'Account overview', layerPath: 'Root / Panel / Title', parentFrameName: 'Panel', yRatio: 0.1, siblingIndex: 0 }),
      createFigmaNode({ nodeId: 'f-exact-b', characters: 'Monthly status', layerPath: 'Root / Panel / Copy', parentFrameName: 'Panel', yRatio: 0.14, siblingIndex: 1 }),
    ],
    [
      createWebElement({ id: 'w-exact-a', rawText: 'Account overview', text: 'Account overview', selector: '.panel-title', domPath: 'main > section.panel > h2', sectionHint: 'top', yRatio: 0.1, siblingIndex: 0 }),
      createWebElement({ id: 'w-exact-b', rawText: 'Monthly status updated', text: 'Monthly status updated', selector: '.panel-copy', domPath: 'main > section.panel > p', sectionHint: 'top', yRatio: 0.14, siblingIndex: 1 }),
    ],
  )

  assert.deepEqual(result.matchedPairs.map((pair) => [pair.figmaNode.nodeId, pair.webElement.id]), [['f-exact-a', 'w-exact-a'], ['f-exact-b', 'w-exact-b']])
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
