import test from 'node:test'
import assert from 'node:assert/strict'
import { createVisualDisplayIssues } from './visualDisplayIssues.js'
import { createCoreVisualIssues, normalizeDisplayCategory } from './visualDisplayHierarchy.js'
import { createVisualIssueGroups } from './visualIssueGroups.js'

test('core hierarchy keeps 4 priority issues while full findings keep all 10 source items', () => {
  const items = [
    issue({ category: 'media', categoryLabel: 'KV / Media', area: 'Main KV', title: 'KV 이미지가 다릅니다.', figmaValue: 'image', webValue: 'video', yRatio: 0.1 }),
    issue({ category: 'cta', categoryLabel: 'CTA', area: 'Main KV', title: 'CTA 문구가 다릅니다.', figmaValue: '상담 신청', webValue: '구매하기', yRatio: 0.12 }),
    issue({ category: 'text', area: 'Body', title: '정책 문구가 다릅니다.', figmaValue: '혜택 포함', webValue: '혜택 제외', yRatio: 0.42 }),
    issue({ category: 'price', categoryLabel: 'Price / Numeric', area: 'Product / Price', title: '금액/숫자를 확인해주세요.', figmaValue: '월 47만원', webValue: '월 50만원', yRatio: 0.5 }),
    issue({ category: 'text', area: 'Body', title: '순번 누락', figmaValue: '02', webValue: '', yRatio: 0.35 }),
    issue({ category: 'text', area: 'Body', figmaValue: '좋은 상품입니다', webValue: '좋은 상품이에요', yRatio: 0.38 }),
    issue({ category: 'text', area: 'Frame / Group / Layer / Promotion Card / Body Copy', figmaValue: 'Layer / Group / Text Node', webValue: 'Layer / Group / Text Node 2', yRatio: 0.45 }),
    issue({ category: 'missing', area: 'Body', title: '요소 유무가 다릅니다.', figmaValue: '일반 안내', webValue: '', yRatio: 0.58 }),
    issue({ category: 'cta', categoryLabel: 'CTA', area: 'Body', title: 'CTA 후보 확인 필요', figmaValue: '문의', webValue: '상담', yRatio: 0.62 }),
    issue({ category: 'text', area: 'Footer', figmaValue: '회사 정보', webValue: '회사 소개', yRatio: 0.9 }),
  ]

  const coreIssues = createCoreVisualIssues(items)
  const coreGroups = createVisualIssueGroups(coreIssues)
  const fullGroups = createVisualIssueGroups(items)

  assert.equal(items.length, 10)
  assert.equal(coreIssues.length, 4)
  assert.equal(coreGroups.meta.groupedIssueCount, 4)
  assert.equal(fullGroups.meta.groupedIssueCount, 10)
  assert.equal(coreIssues.meta.excludedFromCoreCount, 6)
  assert.deepEqual(coreIssues.meta.coreCategoryCounts, { cta: 1, media: 1, price: 1, text: 1, missing: 0 })
  assert.equal(coreIssues.meta.engineDataDeletedCount, 0)
})

test('ordinal-only differences are excluded from core but remain in full findings', () => {
  const items = [issue({ category: 'text', title: '순번 누락', figmaValue: '02', webValue: '' })]
  const coreIssues = createCoreVisualIssues(items)
  const fullGroups = createVisualIssueGroups(items)
  assert.equal(coreIssues.length, 0)
  assert.equal(fullGroups.meta.groupedIssueCount, 1)
})

test('policy and price differences are core findings', () => {
  const coreIssues = createCoreVisualIssues([
    issue({ category: 'text', figmaValue: '서비스 포함', webValue: '서비스 제외' }),
    issue({ category: 'price', categoryLabel: 'Price / Numeric', figmaValue: '월 47만원', webValue: '월 50만원' }),
  ])
  assert.equal(coreIssues.length, 2)
  assert.equal(coreIssues.meta.coreCategoryCounts.text, 1)
  assert.equal(coreIssues.meta.coreCategoryCounts.price, 1)
})

test('joint final and ai text evidence is core without changing source items', () => {
  const source = [issue({ category: 'text', figmaValue: '프로그램 안내', webValue: '상품 안내', evidenceSources: ['final', 'ai'] })]
  const coreIssues = createCoreVisualIssues(source)
  assert.equal(coreIssues.length, 1)
  assert.equal(source.length, 1)
})

test('typos and one-sided core content are core findings', () => {
  const coreIssues = createCoreVisualIssues([
    issue({ category: 'text', title: '오탈자 확인', figmaValue: '프로그램', webValue: '프로그렘' }),
    issue({ category: 'missing', title: '핵심 콘텐츠 누락', figmaValue: '가입 혜택', webValue: '' }),
  ])
  assert.equal(coreIssues.length, 2)
  assert.equal(coreIssues.meta.coreCategoryCounts.text, 1)
  assert.equal(coreIssues.meta.coreCategoryCounts.missing, 1)
})

test('AI media issue with text-only values is displayed as Text in core', () => {
  const coreIssues = createCoreVisualIssues([
    issue({ category: 'media', categoryLabel: 'KV / Media', title: 'KV 이미지가 다릅니다.', figmaValue: '상담 프로그램 안내', webValue: '상담 상품 안내', evidenceSources: ['final', 'ai'] }),
  ])
  assert.equal(coreIssues.length, 1)
  assert.equal(coreIssues[0].category, 'media')
  assert.equal(coreIssues[0].displayCategory, 'text')
  assert.equal(coreIssues[0].displayCategoryLabel, 'Text')
  assert.equal(coreIssues[0].title, '텍스트가 다릅니다.')
})

test('display category keeps media cta and price when evidence is explicit', () => {
  assert.equal(normalizeDisplayCategory(issue({ category: 'media', figmaValue: 'image', webValue: 'video' })), 'media')
  assert.equal(normalizeDisplayCategory(issue({ category: 'cta', sectionKey: 'hero-cta', figmaValue: '신청하기 / /apply', webValue: '구매하기 / /buy' })), 'cta')
  assert.equal(normalizeDisplayCategory(issue({ category: 'text', figmaValue: '월 47만원', webValue: '월 50만원' })), 'price')
})

test('core semantic duplicate keeps one representative while full source remains untouched', () => {
  const source = [
    issue({ id: 'final-media', source: 'final', category: 'media', figmaValue: 'image', webValue: 'video', yRatio: 0.1, sectionKey: 'hero-media' }),
    issue({ id: 'ai-media', source: 'ai', category: 'media', title: 'Hero image and Web video differ', figmaValue: 'Hero image', webValue: 'Web video', yRatio: 0.11, sectionKey: 'hero-media', evidenceSources: ['ai'] }),
  ]
  const coreIssues = createCoreVisualIssues(source)
  assert.equal(source.length, 2)
  assert.equal(coreIssues.length, 1)
  assert.equal(coreIssues[0].id, 'final-media')
  assert.equal(coreIssues.meta.semanticDuplicateRemovedCount, 1)
})

test('regression A: Main Visual media duplicate is represented once with CTA items kept', () => {
  const allIssues = [
    issue({ id: 'final-media-type', source: 'final', category: 'media', categoryLabel: 'KV / Media', area: 'Main Visual', sectionId: 'final-section-a', figmaValue: 'image', webValue: 'video', yRatio: null, originalIndex: 0 }),
    issue({ id: 'ai-media-scene', source: 'ai', category: 'media', categoryLabel: 'KV / Media', area: 'Main Visual', sectionId: 'ai-section-b', figmaValue: '정지 사진', webValue: '영상 프레임', yRatio: 0.11, originalIndex: 1 }),
    issue({ id: 'cta-label', source: 'final', category: 'cta', categoryLabel: 'CTA', area: 'Main Visual', sectionId: 'ai-section-b', figmaValue: '자세히 보기 / /a', webValue: '상담하기 / /a', yRatio: 0.12, originalIndex: 2 }),
    issue({ id: 'cta-href', source: 'final', category: 'cta', categoryLabel: 'CTA', area: 'Main Visual', sectionId: 'ai-section-b', figmaValue: '신청하기 / /apply', webValue: '신청하기 / /buy', yRatio: 0.13, originalIndex: 3 }),
  ]

  const coreIssues = createCoreVisualIssues(allIssues)
  const coreGroups = createVisualIssueGroups(coreIssues, { mergeReadableAreas: true })

  assert.equal(allIssues.length, 4)
  assert.equal(coreGroups.length, 1)
  assert.equal(coreGroups[0].label, 'Main Visual')
  assert.equal(coreGroups[0].items.length, 3)
  assert.equal(coreGroups[0].items.filter((item) => item.displayCategory === 'media').length, 1)
  assert.equal(coreGroups[0].items.filter((item) => item.displayCategory === 'cta').length, 2)
  assert.equal(coreGroups[0].items.find((item) => item.displayCategory === 'media').title, 'KV 미디어 타입이 다릅니다.')
  assert.equal(coreIssues.meta.semanticDuplicateRemovedCount, 1)
})

test('regression B: Main Visual text omission stays separate from media dedupe', () => {
  const allIssues = [
    issue({ id: 'media', source: 'final', category: 'media', area: 'Main Visual', figmaValue: 'image', webValue: 'video', yRatio: 0.1 }),
    issue({ id: 'title-text', source: 'comparison', category: 'text', area: 'Main Visual', figmaValue: 'THE NEW PRODUCT를 특별한 프로그램으로 지금 만나보세요.', webValue: 'THE NEW PRODUCT', yRatio: 0.12 }),
  ]
  const coreIssues = createCoreVisualIssues(allIssues)
  const coreGroups = createVisualIssueGroups(coreIssues, { mergeReadableAreas: true })

  assert.equal(coreGroups.length, 1)
  assert.equal(coreGroups[0].items.length, 2)
  assert.equal(coreGroups[0].items.some((item) => item.displayCategory === 'media'), true)
  assert.equal(coreGroups[0].items.some((item) => item.displayCategory === 'text'), true)
})

test('regression C: particle-only text can stay out of core while full findings keep it', () => {
  const allIssues = [issue({ category: 'text', area: 'Main Visual', figmaValue: '상품을 확인하세요.', webValue: '상품 확인하세요.' })]
  const coreIssues = createCoreVisualIssues(allIssues)
  const fullGroups = createVisualIssueGroups(allIssues)

  assert.equal(coreIssues.length, 0)
  assert.equal(fullGroups.meta.groupedIssueCount, 1)
})

test('regression D: sentence suffix omission is core Text', () => {
  const coreIssues = createCoreVisualIssues([
    issue({ category: 'text', area: 'Main Visual', figmaValue: '상품을 새로운 금융 프로그램으로 지금 만나보세요.', webValue: '상품' }),
  ])

  assert.equal(coreIssues.length, 1)
  assert.equal(coreIssues[0].displayCategory, 'text')
})

test('regression E: Main Visual media and Footer text remain separate groups', () => {
  const coreIssues = createCoreVisualIssues([
    issue({ category: 'media', area: 'Main Visual', figmaValue: 'image', webValue: 'video', yRatio: 0.1 }),
    issue({ category: 'text', area: 'Footer', figmaValue: '서비스 포함', webValue: '서비스 제외', yRatio: 0.9 }),
  ])
  const groups = createVisualIssueGroups(coreIssues, { mergeReadableAreas: true })

  assert.deepEqual(groups.map((group) => group.label), ['Main Visual', 'Footer'])
})

test('generic A: same hero headline with different subtitle stays core Text from comparison evidence', () => {
  const allIssues = createVisualDisplayIssues({
    comparison: { differences: [{ figmaText: 'PRODUCT NAME\n새로운 프로그램으로 지금 만나보세요.', webText: 'PRODUCT NAME\nA NEW ERA BEGINS', area: 'Main Visual', sectionId: 'hero', yRatio: 0.1 }] },
    aiHints: {},
  })
  const coreIssues = createCoreVisualIssues(allIssues)
  const groups = createVisualIssueGroups(coreIssues, { mergeReadableAreas: true })

  assert.equal(allIssues.length, 1)
  assert.equal(coreIssues.length, 1)
  assert.equal(coreIssues[0].displayCategory, 'text')
  assert.equal(coreIssues[0].figmaValue, 'PRODUCT NAME\n새로운 프로그램으로 지금 만나보세요.')
  assert.equal(coreIssues[0].webValue, 'PRODUCT NAME\nA NEW ERA BEGINS')
  assert.equal(groups.length, 1)
  assert.equal(groups[0].label, 'Main Visual')
})

test('generic B: common prefix with different meaningful suffix stays core Text', () => {
  const allIssues = [issue({ category: 'text', area: 'Main Visual', figmaValue: 'PRODUCT NAME BENEFIT COPY A', webValue: 'PRODUCT NAME CAMPAIGN COPY B', yRatio: 0.1 })]
  const coreIssues = createCoreVisualIssues(allIssues)
  assert.equal(coreIssues.length, 1)
  assert.equal(coreIssues[0].displayCategory, 'text')
})

test('generic C: particle-only copy difference can stay out of core', () => {
  const allIssues = [issue({ category: 'text', area: 'Main Visual', figmaValue: '상품을 확인하세요.', webValue: '상품 확인하세요.', yRatio: 0.1 })]
  const coreIssues = createCoreVisualIssues(allIssues)
  assert.equal(coreIssues.length, 0)
  assert.equal(coreIssues.meta.heroTextExcludedReasonCounts['particle-only'], 1)
})

test('generic D: whitespace and punctuation only difference can stay out of core', () => {
  const allIssues = createVisualDisplayIssues({ comparison: { differences: [{ figmaText: '지금, 만나보세요.', webText: '지금 만나보세요.', area: 'Main Visual' }] }, aiHints: {} })
  const coreIssues = createCoreVisualIssues(allIssues)
  assert.equal(coreIssues.length, 0)
})

test('generic E: Main Visual Media Text and CTA coexist without cross-category dedupe', () => {
  const allIssues = [
    issue({ id: 'media', category: 'media', area: 'Main Visual', figmaValue: 'image', webValue: 'video', yRatio: 0.1 }),
    issue({ id: 'text', category: 'text', area: 'Main Visual', figmaValue: 'PRODUCT NAME BENEFIT COPY A', webValue: 'PRODUCT NAME CAMPAIGN COPY B', yRatio: 0.11 }),
    issue({ id: 'cta', category: 'cta', categoryLabel: 'CTA', area: 'Main Visual', figmaValue: 'Label A / /a', webValue: 'Label B / /b', yRatio: 0.12 }),
  ]
  const coreIssues = createCoreVisualIssues(allIssues)
  const groups = createVisualIssueGroups(coreIssues, { mergeReadableAreas: true })

  assert.equal(groups.length, 1)
  assert.equal(groups[0].items.length, 3)
  assert.deepEqual(groups[0].items.map((item) => item.displayCategory).sort(), ['cta', 'media', 'text'])
})

test('generic F: similar Hero and Footer text are not merged', () => {
  const coreIssues = createCoreVisualIssues([
    issue({ category: 'text', area: 'Main Visual', figmaValue: 'PRODUCT NAME BENEFIT COPY A', webValue: 'PRODUCT NAME CAMPAIGN COPY B', yRatio: 0.1 }),
    issue({ category: 'text', area: 'Footer', figmaValue: 'PRODUCT NAME BENEFIT COPY A', webValue: 'PRODUCT NAME CAMPAIGN COPY B', yRatio: 0.9, evidenceSources: ['final', 'ai'] }),
  ])
  const groups = createVisualIssueGroups(coreIssues, { mergeReadableAreas: true })
  assert.deepEqual(groups.map((group) => group.label), ['Main Visual', 'Footer'])
})

test('generic G: page without hero evidence does not invent a hero text issue', () => {
  const allIssues = createVisualDisplayIssues({ comparison: { differences: [] }, aiHints: {} })
  const coreIssues = createCoreVisualIssues(allIssues)
  assert.equal(allIssues.length, 0)
  assert.equal(coreIssues.length, 0)
})

test('generic H: identical hero copy creates no Text issue', () => {
  const allIssues = createVisualDisplayIssues({ comparison: { differences: [{ figmaText: 'PRODUCT NAME SAME COPY', webText: 'PRODUCT NAME SAME COPY', area: 'Main Visual', yRatio: 0.1 }] }, aiHints: {} })
  const coreIssues = createCoreVisualIssues(allIssues)
  assert.equal(allIssues.length, 0)
  assert.equal(coreIssues.length, 0)
})

function issue(overrides = {}) {
  return {
    id: `issue-${overrides.category || 'text'}-${overrides.figmaValue || ''}-${overrides.webValue || ''}`,
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
