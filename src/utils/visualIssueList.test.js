import test from 'node:test'
import assert from 'node:assert/strict'
import { classifyVisualDifferenceItem, createVisualDifferenceItems, normalizeVisualArea } from './visualIssueList.js'

const landingResult = {
  comparison: {
    differences: [
      { figmaText: 'Model X100 for teams', webText: 'Model X100', sectionRole: 'hero', role: 'heading', yRatio: 0.05, confidence: 'high' },
      { figmaText: 'Start free trial', webText: 'Book a demo', sectionRole: 'hero', role: 'primary-action', yRatio: 0.12 },
      { figmaText: 'Starter plan, $47 per month', webText: 'Starter plan, $50 per month', sectionPath: 'pricing card', yRatio: 0.55 },
    ],
  },
  aiHints: {
    heroMediaGroup: { comparisonHint: 'figma-image-vs-web-video', figma: { mediaTypes: ['image'] }, web: { mediaTypes: ['video'] } },
    heroCtaGroup: { figma: { count: 1 }, web: { count: 1 }, countDifference: 0, textDifferences: [] },
    prices: [{ source: 'web', numericType: 'monthly-payment', displayText: 'Starter plan, $50 per month' }],
  },
}

test('product model name with digits is classified as Text, not Price', () => {
  const category = classifyVisualDifferenceItem({ figmaText: 'Model X100 for teams', webText: 'Model X100', sectionRole: 'hero', role: 'heading' })
  assert.equal(category, 'text')
})

test('numeric amount is classified as Price', () => {
  const category = classifyVisualDifferenceItem({ figmaText: '$47 per month', webText: '$50 per month', numericType: 'monthly-payment' })
  assert.equal(category, 'price')
})

test('CTA and media categories are classified from evidence', () => {
  assert.equal(classifyVisualDifferenceItem({ figmaText: 'Start free trial', webText: 'Book a demo', role: 'primary-action' }), 'cta')
  assert.equal(classifyVisualDifferenceItem({ comparisonHint: 'figma-image-vs-web-video' }), 'media')
})

test('area names are normalized for user-facing cards', () => {
  assert.equal(normalizeVisualArea({ sectionPath: 'Hero / key visual / title' }), 'Main KV')
  assert.equal(normalizeVisualArea({ layerPath: 'footer / legal' }), 'Footer')
  assert.equal(normalizeVisualArea({ sectionPath: 'promotion / card' }), 'Page Content')
})

test('Vision visualDifferences drive default issue cards and merge with canonical media', () => {
  const items = createVisualDifferenceItems(landingResult, {
    meta: { openAiCalled: true, fallbackUsed: false },
    review: {
      visualDifferences: [{ area: 'Main Visual', category: 'Media', title: 'Hero KV visual is different.', summary: 'Figma shows a product hero image while Web shows a video frame.', figmaValue: 'Product hero image', webValue: 'Product video frame', severity: 'warning', confidence: 'high', order: 0 }],
      mustFix: [{ category: 'price', title: 'Monthly price must be fixed', description: 'The pricing card monthly amount is different.', evidence: ['Figma: Starter plan, $47 per month', 'Web: Starter plan, $50 per month'], severity: 'critical' }],
      verify: [],
    },
  })

  assert.equal(items.some((item) => item.title === 'Hero KV visual is different.'), true)
  assert.equal(items.find((item) => item.title === 'Hero KV visual is different.').source, 'merged')
  assert.equal(items.some((item) => item.title === 'Monthly price must be fixed'), true)
})

test('canonical Figma and Web values override AI guesses for exact strings', () => {
  const items = createVisualDifferenceItems(landingResult, {
    meta: { openAiCalled: true, fallbackUsed: false },
    review: { visualDifferences: [], mustFix: [{ category: 'price', title: 'Price mismatch', description: 'The price differs.', evidence: [], severity: 'critical' }], verify: [] },
  })
  const price = items.find((item) => item.title === 'Price mismatch')
  assert.equal(price.figmaValue, 'Starter plan, $47 per month')
  assert.equal(price.webValue, 'Starter plan, $50 per month')
  assert.equal(price.area, 'Page Content')
})

test('fallback or missing AI uses canonical cards without vague content title', () => {
  const items = createVisualDifferenceItems(landingResult, { meta: { openAiCalled: true, fallbackUsed: true }, review: { mustFix: [], verify: [], visualDifferences: [] } })
  assert.equal(items.length >= 4, true)
  assert.equal(items.some((item) => item.title === '콘텐츠'), false)
  assert.equal(items.some((item) => item.area === '콘텐츠'), false)
  assert.equal(items.some((item) => item.categoryLabel === 'Text'), true)
  assert.equal(items.every((item) => ['Text', 'CTA', 'KV / Media', 'Missing'].includes(item.categoryLabel)), true)
})

test('equivalent AI and canonical issues merge while distinct issues remain', () => {
  const items = createVisualDifferenceItems(landingResult, {
    meta: { openAiCalled: true, fallbackUsed: false },
    review: {
      visualDifferences: [{ area: 'Main Visual', category: 'Media', title: 'Hero media differs', summary: 'Image versus video.', figmaValue: 'image', webValue: 'video', severity: 'warning', confidence: 'high', order: 0 }],
      mustFix: [{ category: 'price', title: 'Monthly price must be fixed', description: 'The monthly amount differs.', evidence: ['Figma: Starter plan, $47 per month', 'Web: Starter plan, $50 per month'], severity: 'critical' }],
      verify: [{ category: 'text', title: 'Hero title copy should be checked', description: 'Hero heading is shortened.', evidence: ['Figma: Model X100 for teams', 'Web: Model X100'], severity: 'warning' }],
    },
  })

  assert.equal(items.filter((item) => item.title === 'Monthly price must be fixed').length, 1)
  assert.equal(items.some((item) => item.title === 'Hero title copy should be checked'), true)
  assert.equal(items.some((item) => item.categoryLabel === 'CTA'), true)
  assert.equal(items.filter((item) => item.categoryLabel === 'KV / Media').length, 1)
})

test('issue sorting follows page order before category order', () => {
  const items = createVisualDifferenceItems(landingResult)
  assert.deepEqual(items.slice(0, 4).map((item) => item.categoryLabel), ['Text', 'CTA', 'KV / Media', 'Text'])
})

test('cards expose Figma and Web values when evidence exists', () => {
  const items = createVisualDifferenceItems(landingResult)
  const text = items.find((item) => item.categoryLabel === 'Text')
  assert.equal(text.figmaValue, 'Model X100 for teams')
  assert.equal(text.webValue, 'Model X100')
})

test('page without hero does not invent a Hero issue', () => {
  const items = createVisualDifferenceItems({ comparison: { differences: [{ figmaText: 'Card A - $10', webText: 'Card A - $12', sectionPath: 'product card 1', yRatio: 0.4 }] }, aiHints: { prices: [{ numericType: 'amount', displayText: 'Card A - $12' }] } })
  assert.equal(items.some((item) => item.area === 'Main KV'), false)
})

test('same price in different cards stays separate when section evidence differs', () => {
  const items = createVisualDifferenceItems({
    comparison: { differences: [
      { figmaText: 'Basic $20', webText: 'Basic $25', sectionPath: 'product card basic', yRatio: 0.4 },
      { figmaText: 'Pro $20', webText: 'Pro $25', sectionPath: 'product card pro', yRatio: 0.55 },
    ] },
    aiHints: { prices: [{ numericType: 'amount', displayText: 'Basic $25' }, { numericType: 'amount', displayText: 'Pro $25' }] },
  })
  assert.equal(items.filter((item) => item.categoryLabel === 'Text').length, 2)
})

test('image-equivalent page does not create a Vision issue without Vision evidence', () => {
  const items = createVisualDifferenceItems({ comparison: { differences: [] }, aiHints: { heroMediaGroup: { comparisonHint: '', figma: { mediaTypes: ['image'] }, web: { mediaTypes: ['image'] } } } })
  assert.equal(items.some((item) => item.categoryLabel === 'KV / Media'), false)
})

test('text identical but Hero image different creates Vision-only issue', () => {
  const items = createVisualDifferenceItems({ comparison: { differences: [] }, aiHints: {} }, {
    meta: { openAiCalled: true, fallbackUsed: false },
    review: { visualDifferences: [{ area: 'Main Visual', category: 'Image', title: 'Hero image content differs', summary: 'The main visual subject is different.', figmaValue: 'Outdoor product photo', webValue: 'Indoor detail photo', severity: 'warning', confidence: 'high', order: 0 }], mustFix: [], verify: [] },
  })
  assert.equal(items.length, 1)
  assert.equal(items[0].categoryLabel, 'KV / Media')
})
