import test from 'node:test'
import assert from 'node:assert/strict'
import { createVisualIssueGroups } from './visualIssueGroups.js'

test('same sectionId Text CTA and Media issues become one area group', () => {
  const groups = createVisualIssueGroups([
    issue({ category: 'text', sectionId: 'hero-section', title: '텍스트가 다릅니다.', figmaValue: 'Hero A', webValue: 'Hero B', yRatio: 0.1 }),
    issue({ category: 'cta', sectionId: 'hero-section', title: 'CTA 구성을 확인해주세요.', figmaValue: 'Apply', webValue: 'Buy', yRatio: 0.12 }),
    issue({ category: 'media', sectionId: 'hero-section', title: 'KV 이미지가 다릅니다.', figmaValue: 'image', webValue: 'video', yRatio: 0.11 }),
  ])
  assert.equal(groups.length, 1)
  assert.equal(groups[0].items.length, 3)
  assert.equal(groups.meta.groupedIssueCount, 3)
})

test('same area label with distant yRatio can split into separate groups', () => {
  const groups = createVisualIssueGroups([
    issue({ area: 'Body', figmaValue: 'Top A', webValue: 'Top B', yRatio: 0.1 }),
    issue({ area: 'Body', figmaValue: 'Bottom A', webValue: 'Bottom B', yRatio: 0.78 }),
  ])
  assert.equal(groups.length, 2)
})

test('exact duplicate issues render once inside a group', () => {
  const duplicate = issue({ sectionId: 'hero-section', title: '텍스트가 다릅니다.', figmaValue: 'Same A', webValue: 'Same B', yRatio: 0.1 })
  const groups = createVisualIssueGroups([duplicate, { ...duplicate, id: 'duplicate' }])
  assert.equal(groups.length, 1)
  assert.equal(groups[0].items.length, 1)
  assert.equal(groups.meta.duplicateIssueCount, 1)
})

test('different text values in the same area stay separate', () => {
  const groups = createVisualIssueGroups([
    issue({ sectionId: 'hero-section', figmaValue: 'First A', webValue: 'First B', yRatio: 0.1 }),
    issue({ sectionId: 'hero-section', figmaValue: 'Second A', webValue: 'Second B', yRatio: 0.12 }),
  ])
  assert.equal(groups.length, 1)
  assert.equal(groups[0].items.length, 2)
})

test('Hero Body Footer groups sort top to bottom', () => {
  const groups = createVisualIssueGroups([
    issue({ area: 'Footer', figmaValue: 'Footer A', webValue: 'Footer B', yRatio: 0.9 }),
    issue({ area: 'Main KV', figmaValue: 'Hero A', webValue: 'Hero B', yRatio: 0.1 }),
    issue({ area: 'Body', figmaValue: 'Body A', webValue: 'Body B', yRatio: 0.52 }),
  ])
  assert.deepEqual(groups.map((group) => group.label), ['Main Visual', 'Body', 'Footer'])
})

test('nine source issues keep nine grouped internal issues', () => {
  const items = Array.from({ length: 9 }, (_, index) => issue({
    sectionId: index < 3 ? 'hero-section' : index < 6 ? 'body-section' : 'footer-section',
    area: index < 3 ? 'Main KV' : index < 6 ? 'Body' : 'Footer',
    figmaValue: `Figma ${index}`,
    webValue: `Web ${index}`,
    yRatio: index < 3 ? 0.1 + index * 0.01 : index < 6 ? 0.45 + index * 0.01 : 0.85 + index * 0.01,
  }))
  const groups = createVisualIssueGroups(items)
  assert.equal(groups.length, 3)
  assert.equal(groups.meta.sourceIssueCount, 9)
  assert.equal(groups.meta.groupedIssueCount, 9)
})

test('history restored compact issues produce the same group result', () => {
  const historyItems = [
    issue({ area: '', sectionPath: 'product card', category: 'price', categoryLabel: 'Price / Numeric', figmaValue: '월 47만원', webValue: '월 50만원', yRatio: 0.45 }),
    issue({ area: '', sectionPath: 'product card', category: 'text', figmaValue: '혜택 A', webValue: '혜택 B', yRatio: 0.46 }),
  ]
  const groups = createVisualIssueGroups(historyItems)
  assert.equal(groups.length, 1)
  assert.equal(groups[0].items.length, 2)
  assert.equal(groups[0].label, 'Product / Price')
})

test('long technical layer paths are not exposed as user-facing area names', () => {
  const groups = createVisualIssueGroups([
    issue({ area: 'Frame / Group / Instance / Component / Deep Layer Name / Text Node', figmaValue: 'A', webValue: 'B', yRatio: 0.48 }),
  ])
  assert.equal(groups.length, 1)
  assert.equal(groups[0].label, '페이지 콘텐츠')
})

test('readable canonical area is preferred over technical section path', () => {
  const groups = createVisualIssueGroups([
    issue({ readableCanonicalArea: 'Product / Price', sectionPath: 'Frame / Group / Instance / Node 123 / Text', area: 'Frame / Group / Instance / Node 123 / Text', category: 'price', figmaValue: '47만원', webValue: '50만원' }),
  ])
  assert.equal(groups[0].label, 'Product / Price')
})

test('core grouping can merge same Main Visual readable area across source sections', () => {
  const groups = createVisualIssueGroups([
    issue({ sectionId: 'ai-hero', area: 'Main Visual', category: 'media', figmaValue: 'image', webValue: 'video', yRatio: 0.1 }),
    issue({ sectionId: 'canonical-hero', area: 'Main Visual', category: 'cta', figmaValue: '신청하기', webValue: '구매하기', yRatio: 0.12 }),
    issue({ sectionId: 'text-hero', area: 'Main Visual', category: 'text', figmaValue: '혜택 포함', webValue: '혜택 제외', yRatio: 0.14 }),
  ], { mergeReadableAreas: true })
  assert.equal(groups.length, 1)
  assert.equal(groups[0].label, 'Main Visual')
  assert.equal(groups[0].items.length, 3)
})

test('core grouping keeps Main Visual and Footer separate', () => {
  const groups = createVisualIssueGroups([
    issue({ area: 'Main Visual', figmaValue: 'Hero A', webValue: 'Hero B', yRatio: 0.1 }),
    issue({ area: 'Footer', figmaValue: 'Footer A', webValue: 'Footer B', yRatio: 0.9 }),
  ], { mergeReadableAreas: true })
  assert.deepEqual(groups.map((group) => group.label), ['Main Visual', 'Footer'])
})

function issue(overrides = {}) {
  return {
    id: `issue-${overrides.figmaValue || ''}-${overrides.webValue || ''}`,
    category: 'text',
    categoryLabel: 'Text',
    area: 'Main KV',
    title: '텍스트가 다릅니다.',
    description: 'Figma와 Web에서 표시되는 문구가 서로 다릅니다.',
    figmaValue: 'Figma',
    webValue: 'Web',
    inputIndex: 0,
    ...overrides,
  }
}
