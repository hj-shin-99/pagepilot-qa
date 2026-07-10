import assert from 'node:assert/strict'

process.env.PAGEPILOT_NO_LISTEN = '1'

const { createTextQaComparisonResult } = await import('../server/index.js')

function runCase(name, payload, expected) {
  const result = createTextQaComparisonResult(createPayload(payload), { sectionMapping: createMapping() })
  expected(result)
  console.log(`Text QA passed: ${name}`)
}

function createPayload({ figma = [], web = [] }) {
  return {
    figmaElementSummary: figma,
    webElementSummary: web,
    figmaCtaHints: [],
    webCtaHints: [],
    figmaTexts: [],
    webTexts: [],
  }
}

function createMapping() {
  return {
    mappedSections: [
      { figmaSectionId: 'figma-hero', webSectionId: 'web-hero', area: 'top', role: 'hero', figmaYRatio: 0.1, webYRatio: 0.1, confidence: 0.9 },
      { figmaSectionId: 'figma-footer', webSectionId: 'web-footer', area: 'bottom', role: 'footer', figmaYRatio: 0.9, webYRatio: 0.9, confidence: 0.9 },
      { figmaSectionId: 'figma-content', webSectionId: 'web-content', area: 'middle', role: 'content', figmaYRatio: 0.45, webYRatio: 0.45, confidence: 0.9 },
    ],
  }
}

function item(overrides) {
  return {
    id: overrides.id,
    text: overrides.text,
    tag: overrides.tag || 'p',
    role: overrides.role || 'body',
    sectionId: overrides.sectionId,
    sectionTitle: overrides.sectionTitle || '',
    area: overrides.area,
    yRatio: overrides.yRatio,
    layerPath: overrides.layerPath || '',
    selector: overrides.selector || '',
    isCta: Boolean(overrides.isCta),
    visible: overrides.visible !== false,
  }
}

runCase('same section money diff', {
  figma: [item({ id: 'f1', text: 'BMW iX 월 47만원', sectionId: 'figma-hero', sectionTitle: 'Hero', area: 'top', yRatio: 0.12 })],
  web: [item({ id: 'w1', text: 'BMW iX 월 50만원', sectionId: 'web-hero', sectionTitle: 'Hero', area: 'top', yRatio: 0.13 })],
}, (result) => {
  assert.equal(result.issues.length, 1)
  assert.equal(result.issues[0].protectedTextQa, true)
  assert.equal(result.issues[0].matchConfidence, 'high')
})

runCase('hero to footer rejected', {
  figma: [item({ id: 'f1', text: 'BMW iX 월 47만원', sectionId: 'figma-hero', sectionTitle: 'Hero', area: 'top', yRatio: 0.1 })],
  web: [item({ id: 'w1', text: 'BMW iX 월 50만원', sectionId: 'web-footer', sectionTitle: 'Footer', area: 'bottom', yRatio: 0.9 })],
}, (result) => assert.equal(result.issues.length, 0))

runCase('cta to body rejected', {
  figma: [item({ id: 'f1', text: '상담 신청', sectionId: 'figma-hero', sectionTitle: 'Hero', area: 'top', yRatio: 0.2, tag: 'button', role: 'cta', isCta: true })],
  web: [item({ id: 'w1', text: '상담 신청은 아래 내용을 확인한 뒤 진행됩니다.', sectionId: 'web-hero', sectionTitle: 'Hero', area: 'top', yRatio: 0.2, tag: 'p', role: 'body' })],
}, (result) => assert.equal(result.issues.length, 0))

runCase('tab code to benefit rejected', {
  figma: [item({ id: 'f1', text: 'TAB05', sectionId: 'figma-content', sectionTitle: 'Tabs', area: 'middle', yRatio: 0.5, role: 'tab' })],
  web: [item({ id: 'w1', text: 'BMW 7시리즈 구매 혜택', sectionId: 'web-content', sectionTitle: 'Benefits', area: 'middle', yRatio: 0.5 })],
}, (result) => assert.equal(result.issues.length, 0))

runCase('linebreak only ignored', {
  figma: [item({ id: 'f1', text: 'BMW Financial\nServices', sectionId: 'figma-footer', sectionTitle: 'Footer', area: 'bottom', yRatio: 0.9 })],
  web: [item({ id: 'w1', text: 'BMW Financial Services', sectionId: 'web-footer', sectionTitle: 'Footer', area: 'bottom', yRatio: 0.9 })],
}, (result) => assert.equal(result.issues.length, 0))

runCase('punctuation percent diff', {
  figma: [item({ id: 'f1', text: '금리 3.5%', sectionId: 'figma-content', sectionTitle: 'Rate', area: 'middle', yRatio: 0.4 })],
  web: [item({ id: 'w1', text: '금리 3,5%', sectionId: 'web-content', sectionTitle: 'Rate', area: 'middle', yRatio: 0.4 })],
}, (result) => {
  assert.equal(result.issues.length, 1)
  assert.equal(result.issues[0].protectedTextQa, true)
})
