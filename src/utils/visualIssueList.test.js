import test from 'node:test'
import assert from 'node:assert/strict'
import { classifyVisualDifferenceItem, createVisualDifferenceItems, createVisualDifferenceReport, normalizeVisualArea } from './visualIssueList.js'

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
    meta: { openAiCalled: true, visionUsed: true, fallbackUsed: false },
    review: {
      visualDifferences: [{ area: 'Main Visual', category: 'Media', title: 'Hero KV visual is different.', summary: 'Figma shows a product hero image while Web shows a video frame.', figmaValue: 'Product hero image', webValue: 'Product video frame', severity: 'warning', confidence: 'high', order: 0 }],
      mustFix: [{ category: 'price', title: 'Monthly price must be fixed', description: 'The pricing card monthly amount is different.', evidence: ['Figma: Starter plan, $47 per month', 'Web: Starter plan, $50 per month'], severity: 'critical' }],
      verify: [],
    },
  })

  assert.equal(items[0].title, 'KV 이미지가 다릅니다.')
  assert.equal(items[0].source, 'merged')
  assert.equal(items.some((item) => item.title === 'Monthly price must be fixed'), false)
})

test('canonical Figma and Web values override AI guesses for exact strings', () => {
  const items = createVisualDifferenceItems(landingResult, {
    meta: { openAiCalled: true, fallbackUsed: false },
    review: { visualDifferences: [], mustFix: [{ category: 'price', title: 'Price mismatch', description: 'The price differs.', evidence: [], severity: 'critical' }], verify: [] },
  })
  const price = items.find((item) => item.figmaValue === 'Starter plan, $47 per month')
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
    meta: { openAiCalled: true, visionUsed: true, fallbackUsed: false },
    review: {
      visualDifferences: [{ area: 'Main Visual', category: 'Media', title: 'Hero media differs', summary: 'Image versus video.', figmaValue: 'image', webValue: 'video', severity: 'warning', confidence: 'high', order: 0 }],
      mustFix: [{ category: 'price', title: 'Monthly price must be fixed', description: 'The monthly amount differs.', evidence: ['Figma: Starter plan, $47 per month', 'Web: Starter plan, $50 per month'], severity: 'critical' }],
      verify: [{ category: 'text', title: 'Hero title copy should be checked', description: 'Hero heading is shortened.', evidence: ['Figma: Model X100 for teams', 'Web: Model X100'], severity: 'warning' }],
    },
  })

  assert.equal(items.some((item) => item.title === 'Monthly price must be fixed'), false)
  assert.equal(items.some((item) => item.title === 'Hero title copy should be checked'), false)
  assert.equal(items.some((item) => item.categoryLabel === 'CTA'), false)
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
    meta: { openAiCalled: true, visionUsed: true, fallbackUsed: false },
    review: { visualDifferences: [{ area: 'Main Visual', category: 'Image', title: 'Hero image content differs', summary: 'The main visual subject is different.', figmaValue: 'Outdoor product photo', webValue: 'Indoor detail photo', severity: 'warning', confidence: 'high', order: 0 }], mustFix: [], verify: [] },
  })
  assert.equal(items.length, 1)
  assert.equal(items[0].categoryLabel, 'KV / Media')
})

test('Vision success does not append full canonical list by default', () => {
  const items = createVisualDifferenceItems(landingResult, {
    meta: { visionUsed: true, fallbackUsed: false },
    review: {
      visualDifferences: [
        { area: 'Main Visual', category: 'Text', title: 'Hero text differs', summary: 'Hero heading differs.', figmaValue: 'Model X100 for teams', webValue: 'Model X100', severity: 'warning', confidence: 'high', order: 0 },
      ],
      mustFix: [],
      verify: [],
    },
  })

  assert.equal(items.length, 1)
  assert.equal(items.some((item) => item.categoryLabel === 'CTA'), false)
  assert.equal(items.some((item) => item.categoryLabel === 'KV / Media'), false)
  assert.equal(items.filter((item) => item.categoryLabel === 'Text').length, 1)
})

test('Vision success dedupes equivalent KV media, CTA, text, and numeric issues', () => {
  const items = createVisualDifferenceItems(landingResult, {
    meta: { visionUsed: true, fallbackUsed: false },
    review: {
      visualDifferences: [
        { area: 'Main Visual', category: 'Text', title: 'Hero text differs', summary: 'Hero text differs.', figmaValue: 'Model X100 for teams', webValue: 'Model X100', severity: 'warning', confidence: 'high', order: 0 },
        { area: 'Main Visual', category: 'Price', title: 'Price differs', summary: 'Monthly price differs.', figmaValue: 'Starter plan, $47 per month', webValue: 'Starter plan, $50 per month', severity: 'critical', confidence: 'high', order: 1 },
        { area: 'Main Visual', category: 'CTA', title: 'CTA differs', summary: 'CTA differs.', figmaValue: 'Start free trial', webValue: 'Book a demo', severity: 'warning', confidence: 'high', order: 2 },
        { area: 'Main Visual', category: 'Media', title: 'Hero media differs', summary: 'Image versus video.', figmaValue: 'image', webValue: 'video', severity: 'warning', confidence: 'high', order: 3 },
        { area: 'Cookie popup', category: 'Missing', title: 'Cookie popup differs', summary: 'Transient cookie popup.', figmaValue: '없음', webValue: 'Cookie popup', severity: 'check', confidence: 'high', order: 4 },
      ],
      mustFix: [{ category: 'price', title: 'Duplicate price', description: 'Monthly price differs.', evidence: ['Figma: Starter plan, $47 per month', 'Web: Starter plan, $50 per month'], severity: 'critical' }],
      verify: [],
    },
  })

  assert.equal(items.length, 4)
  assert.equal(items.filter((item) => item.categoryLabel === 'KV / Media').length, 1)
  assert.equal(items.filter((item) => item.categoryLabel === 'CTA').length, 1)
  assert.equal(items.filter((item) => item.categoryLabel === 'Text').length, 2)
  assert.equal(items.some((item) => /Cookie/i.test(`${item.figmaValue} ${item.webValue}`)), false)
  assert.equal(items.every((item) => ['텍스트가 다릅니다.', 'CTA 구성을 확인해주세요.', 'KV 이미지가 다릅니다.'].includes(item.title)), true)
})

test('low value text count and spacing differences are excluded from default list', () => {
  const items = createVisualDifferenceItems({
    comparison: { differences: [
      { figmaText: 'Text node count 9', webText: 'Text node count 5', confidence: 'high' },
      { figmaText: '온라인견적', webText: '온라인 견적', confidence: 'high' },
      { figmaText: '가격 월 47만원', webText: '가격 월 50만원', confidence: 'high' },
    ] },
    aiHints: { prices: [{ numericType: 'monthly-payment', displayText: '가격 월 50만원' }] },
  })

  assert.equal(items.length, 1)
  assert.equal(items[0].categoryLabel, 'Text')
  assert.equal(items[0].figmaValue, '가격 월 47만원')
})

test('default issue list keeps all deduped data and reports initial display count', () => {
  const differences = Array.from({ length: 12 }, (_, index) => ({ figmaText: `Copy ${index}A`, webText: `Copy ${index}B`, confidence: 'high', yRatio: index / 20 }))
  const report = createVisualDifferenceReport({ comparison: { differences }, aiHints: {} })
  assert.equal(report.items.length, 12)
  assert.deepEqual(report.meta, { rawVisionCount: 0, canonicalSupplementCount: 0, mergedCount: 12, dedupedCount: 12, displayCount: 10, invalidIssueDroppedCount: 0, crossCategoryMergeRejectedCount: 0 })
})

test('issue sorting follows page y position without category priority', () => {
  const items = createVisualDifferenceItems({
    comparison: { differences: [
      { figmaText: 'CTA A', webText: 'CTA B', role: 'primary-action', confidence: 'high', yRatio: 0.7 },
      { figmaText: 'Text A', webText: 'Text B', confidence: 'high', yRatio: 0.2 },
      { figmaText: '월 47만원', webText: '월 50만원', confidence: 'high', yRatio: 0.5 },
    ] },
    aiHints: { prices: [{ numericType: 'monthly-payment', displayText: '월 50만원' }] },
  })
  assert.deepEqual(items.map((item) => item.figmaValue), ['Text A', '월 47만원', 'CTA A'])
})

test('Vision pipeline meta records raw merged deduped and display counts', () => {
  const report = createVisualDifferenceReport(landingResult, {
    meta: { visionUsed: true, fallbackUsed: false, rawVisionCount: 5 },
    review: {
      visualDifferences: [
        { area: 'Main Visual', category: 'Text', title: 'Hero text differs', summary: 'Hero text differs.', figmaValue: 'Model X100 for teams', webValue: 'Model X100', severity: 'warning', confidence: 'high', order: 0 },
        { area: 'Main Visual', category: 'Text', title: 'Hero text duplicate', summary: 'Hero text differs.', figmaValue: 'Model X100 for teams', webValue: 'Model X100', severity: 'warning', confidence: 'high', order: 1 },
        { area: 'Main Visual', category: 'CTA', title: 'CTA differs', summary: 'CTA differs.', figmaValue: 'Start free trial', webValue: 'Book a demo', severity: 'warning', confidence: 'high', order: 2 },
      ],
      mustFix: [],
      verify: [],
    },
  })

  assert.equal(report.meta.rawVisionCount, 5)
  assert.equal(report.meta.mergedCount >= 3, true)
  assert.equal(report.meta.dedupedCount, 2)
  assert.equal(report.meta.displayCount, 2)
})

test('provenance tracks merged vision and canonical source', () => {
  const report = createVisualDifferenceReport(landingResult, {
    meta: { visionUsed: true, fallbackUsed: false, rawVisionCount: 1 },
    review: {
      visualDifferences: [{ area: 'Hero', category: 'Media', title: 'Hero media differs', summary: 'Image versus video.', figmaValue: 'image', webValue: 'video', confidence: 'high' }],
      mustFix: [],
      verify: [],
    },
  }, { includeProvenance: true })
  const media = report.items.find((item) => item.categoryLabel === 'KV / Media')
  assert.equal(media.source, 'merged')
  assert.equal(media.provenance.origin, 'merged')
  assert.equal(media.provenance.matchedVisionIndex, 0)
  assert.equal(media.provenance.canonicalCategory, 'media')
})

test('Layout vision issue does not merge with unrelated Price canonical entity', () => {
  const report = createVisualDifferenceReport({
    comparison: { differences: [{ figmaText: '월 47만원', webText: '월 50만원', sectionPath: 'pricing card', confidence: 'high', yRatio: 0.6 }] },
    aiHints: { prices: [{ source: 'figma', numericType: 'monthly-payment', displayText: '월 47만원' }, { source: 'web', numericType: 'monthly-payment', displayText: '월 50만원' }] },
  }, {
    meta: { visionUsed: true, fallbackUsed: false, rawVisionCount: 1 },
    review: { visualDifferences: [{ area: 'Hero', category: 'Layout', title: 'Hero height ratio differs', summary: 'Hero layout differs.', figmaValue: '월 47만원', webValue: '월 50만원', confidence: 'high' }], mustFix: [], verify: [] },
  }, { includeProvenance: true })

  assert.equal(report.items.some((item) => item.source === 'merged' && item.category === 'price'), false)
  assert.equal(report.meta.crossCategoryMergeRejectedCount >= 1, true)
  assert.equal(report.meta.invalidIssueDroppedCount >= 1, true)
  assert.equal(report.items.some((item) => item.categoryLabel === 'Text' && item.figmaValue === '월 47만원'), true)
})

test('CTA label and general heading are not merged or kept as CTA without canonical action', () => {
  const report = createVisualDifferenceReport({ comparison: { differences: [] }, aiHints: { heroCtaGroup: { figma: { count: 0, actions: [] }, web: { count: 0, actions: [] }, countDifference: 0 } } }, {
    meta: { visionUsed: true, fallbackUsed: false, rawVisionCount: 1 },
    review: { visualDifferences: [{ area: 'Hero', category: 'CTA', title: 'CTA missing', summary: 'CTA count differs.', figmaValue: '02 Lower monthly payment', webValue: '', confidence: 'high' }], mustFix: [], verify: [] },
  })

  assert.equal(report.items.some((item) => item.categoryLabel === 'CTA'), false)
  assert.equal(report.meta.invalidIssueDroppedCount, 1)
})

test('CTA Vision issue does not merge with same-category body text canonical item', () => {
  const report = createVisualDifferenceReport({
    comparison: { differences: [{ figmaText: 'Read the full financing conditions before applying for this product.', webText: 'Long body copy about financing conditions shown in content.', sectionPath: 'hero copy', confidence: 'high', yRatio: 0.2 }] },
    aiHints: {},
  }, {
    meta: { visionUsed: true, fallbackUsed: false, rawVisionCount: 1 },
    review: { visualDifferences: [{ area: 'Hero', category: 'CTA', title: 'CTA missing', summary: 'Hero CTA missing.', figmaValue: 'Apply now', webValue: '', confidence: 'high', yRatio: 0.2 }], mustFix: [], verify: [] },
  }, { includeProvenance: true })

  assert.equal(report.items.some((item) => item.categoryLabel === 'CTA'), false)
  assert.equal(report.items.some((item) => item.source === 'merged' && item.provenance.mergeReason === 'same-category'), false)
})

test('CTA Vision issue merges with canonical action when label evidence matches', () => {
  const report = createVisualDifferenceReport({
    comparison: { differences: [{ figmaText: 'Apply now', webText: 'Apply online', role: 'primary-action', sectionPath: 'hero actions', href: '/apply', confidence: 'high', yRatio: 0.18, xRatio: 0.2 }] },
    aiHints: {},
  }, {
    meta: { visionUsed: true, fallbackUsed: false, rawVisionCount: 1 },
    review: { visualDifferences: [{ area: 'Hero', category: 'CTA', title: 'CTA differs', summary: 'Hero CTA differs.', figmaValue: 'Apply now', webValue: 'Apply online', confidence: 'high', sectionPath: 'hero actions', yRatio: 0.18, xRatio: 0.21 }], mustFix: [], verify: [] },
  }, { includeProvenance: true })
  const cta = report.items.find((item) => item.categoryLabel === 'CTA')

  assert.equal(cta.source, 'merged')
  assert.equal(cta.figmaValue, 'Apply now')
  assert.equal(cta.webValue, 'Apply online')
  assert.match(cta.provenance.mergeReason, /same-category/)
})

test('ordinal benefit text is classified as Text while real amount remains numeric text issue', () => {
  const report = createVisualDifferenceReport({
    comparison: { differences: [
      { figmaText: '02 낮은 월납입금으로 BMW 이용', webText: '02 낮은 월납입금으로 이용', confidence: 'high', yRatio: 0.2 },
      { figmaText: '03 타던 차량이 싫증날 때 선택', webText: '03 차량 변경이 필요할 때 선택', confidence: 'high', yRatio: 0.3 },
      { figmaText: 'BMW 뉴 iX, 월 50만원', webText: 'BMW 뉴 iX, 월 55만원', confidence: 'high', yRatio: 0.4 },
      { figmaText: 'BMW X3 모델', webText: 'BMW X3 xDrive 모델', confidence: 'high', yRatio: 0.5 },
      { figmaText: '금리 4.9%', webText: '금리 5.1%', confidence: 'high', yRatio: 0.6 },
    ] },
    aiHints: { prices: [{ numericType: 'monthly-payment', displayText: 'BMW 뉴 iX, 월 55만원' }, { numericType: 'interest-rate', displayText: '금리 5.1%' }] },
  })

  assert.equal(report.items.find((item) => item.figmaValue.startsWith('02'))?.category, 'text')
  assert.equal(report.items.find((item) => item.figmaValue.startsWith('03'))?.category, 'text')
  assert.equal(report.items.find((item) => item.figmaValue.includes('X3'))?.category, 'text')
  assert.equal(report.items.find((item) => item.figmaValue.includes('월 50만원'))?.category, 'price')
  assert.equal(report.items.find((item) => item.figmaValue.includes('금리'))?.category, 'price')
})

test('Vision success keeps high-confidence canonical text differences across long pages', () => {
  const report = createVisualDifferenceReport({
    comparison: { differences: [
      { figmaText: 'Legal disclaimer applies through December 31.', webText: 'Legal disclaimer applies through November 30.', sectionPath: 'footer disclaimer', confidence: 'high', yRatio: 0.92 },
      { figmaText: 'Content headline A', webText: 'Content headline B', sectionPath: 'content section', confidence: 'high', yRatio: 0.42 },
    ] },
    aiHints: {},
  }, {
    meta: { visionUsed: true, fallbackUsed: false, rawVisionCount: 1 },
    review: { visualDifferences: [{ area: 'Main Visual', category: 'Image', title: 'Hero image differs', summary: 'Main object differs.', figmaValue: 'Product image', webValue: 'Lifestyle image', confidence: 'high', order: 0 }], mustFix: [], verify: [] },
  })

  assert.equal(report.items.length, 3)
  assert.equal(report.meta.canonicalSupplementCount, 2)
  assert.deepEqual(report.items.map((item) => item.figmaValue), ['Product image', 'Content headline A', 'Legal disclaimer applies through December 31.'])
})

test('same numeric text is deduped as one Text issue', () => {
  const report = createVisualDifferenceReport({
    comparison: { differences: [
      { figmaText: '월 47만원', webText: '월 50만원', confidence: 'high', yRatio: 0.3 },
      { figmaText: '월 47만원', webText: '월 50만원', confidence: 'high', yRatio: 0.3 },
    ] },
    aiHints: { prices: [{ numericType: 'monthly-payment', displayText: '월 50만원' }] },
  })
  assert.equal(report.items.length, 1)
  assert.equal(report.items[0].categoryLabel, 'Text')
})

test('image video type and scene description merge into one KV Media issue', () => {
  const report = createVisualDifferenceReport({ comparison: { differences: [] }, aiHints: { heroMediaGroup: { comparisonHint: 'figma-image-vs-web-video', figma: { mediaTypes: ['image'] }, web: { mediaTypes: ['video'] } } } }, {
    meta: { visionUsed: true, fallbackUsed: false, rawVisionCount: 2 },
    review: { visualDifferences: [
      { area: 'Hero', category: 'Media', title: 'Hero media type differs', summary: 'Image versus video.', figmaValue: 'image', webValue: 'video', confidence: 'high' },
      { area: 'Hero', category: 'Image', title: 'Hero scene differs', summary: 'Scene composition differs.', figmaValue: 'still product image', webValue: 'product video scene', confidence: 'high' },
    ], mustFix: [], verify: [] },
  })
  assert.equal(report.items.filter((item) => item.categoryLabel === 'KV / Media').length, 1)
})

test('identical page emits no visual issue', () => {
  const report = createVisualDifferenceReport({ comparison: { differences: [] }, aiHints: { heroMediaGroup: { comparisonHint: '', figma: { mediaTypes: ['image'] }, web: { mediaTypes: ['image'] } }, heroCtaGroup: { figma: { actions: [] }, web: { actions: [] } } } })
  assert.equal(report.items.length, 0)
})

test('similar text in different sections is not merged', () => {
  const report = createVisualDifferenceReport({
    comparison: { differences: [
      { figmaText: 'Apply now', webText: 'Apply today', sectionPath: 'hero actions', confidence: 'high', yRatio: 0.12 },
      { figmaText: 'Apply now', webText: 'Apply today', sectionPath: 'footer links', confidence: 'high', yRatio: 0.88 },
    ] },
    aiHints: {},
  })
  assert.equal(report.items.length, 2)
})

test('canonical supplements preserve yRatio page order and index fallback', () => {
  const yReport = createVisualDifferenceReport({
    comparison: { differences: [
      { figmaText: 'Bottom', webText: 'Bottom changed', confidence: 'high', yRatio: 0.9 },
      { figmaText: 'Top', webText: 'Top changed', confidence: 'high', yRatio: 0.1 },
      { figmaText: 'Middle', webText: 'Middle changed', confidence: 'high', yRatio: 0.5 },
    ] },
    aiHints: {},
  })
  const indexReport = createVisualDifferenceReport({
    comparison: { differences: [
      { figmaText: 'First no position', webText: 'First changed', confidence: 'high' },
      { figmaText: 'Second no position', webText: 'Second changed', confidence: 'high' },
    ] },
    aiHints: {},
  })

  assert.deepEqual(yReport.items.map((item) => item.figmaValue), ['Top', 'Middle', 'Bottom'])
  assert.deepEqual(indexReport.items.map((item) => item.figmaValue), ['First no position', 'Second no position'])
  assert.equal(yReport.items[0].yRatio, 0.1)
})

test('Vision and canonical supplements share page-order sorting', () => {
  const report = createVisualDifferenceReport({
    comparison: { differences: [
      { figmaText: 'Content text', webText: 'Content text changed', confidence: 'high', yRatio: 0.6 },
      { figmaText: 'Top text', webText: 'Top text changed', confidence: 'high', yRatio: 0.1 },
    ] },
    aiHints: {},
  }, {
    meta: { visionUsed: true, fallbackUsed: false, rawVisionCount: 1 },
    review: { visualDifferences: [{ area: 'Hero', category: 'Image', title: 'Hero image differs', summary: 'Image differs.', figmaValue: 'image', webValue: 'video', confidence: 'high', yRatio: 0.3 }], mustFix: [], verify: [] },
  })

  assert.deepEqual(report.items.map((item) => item.figmaValue), ['Top text', 'image', 'Content text'])
})
