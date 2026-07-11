import assert from 'node:assert/strict'

process.env.PAGEPILOT_NO_LISTEN = '1'

const { createTextQaComparisonResult, mergeMockupIssues } = await import('../server/index.js')

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
      { figmaSectionId: 'figma-legal', webSectionId: 'web-legal', area: 'bottom', role: 'legal', figmaYRatio: 0.82, webYRatio: 0.82, confidence: 0.9 },
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

runCase('one character typo detected', {
  figma: [item({ id: 'f-typo', text: 'BMWW가 보장한 금액', sectionId: 'figma-content', sectionTitle: 'Guarantee', area: 'middle', yRatio: 0.42 })],
  web: [item({ id: 'w-typo', text: 'BMW가 보장한 금액', sectionId: 'web-content', sectionTitle: 'Guarantee', area: 'middle', yRatio: 0.421 })],
}, (result) => {
  assert.equal(result.issues.length, 1)
  assert.equal(result.issues[0].title, '문구 오타가 있습니다.')
})

runCase('percent numeric diff detected', {
  figma: [item({ id: 'f-percent', text: '연 4.99%', sectionId: 'figma-content', sectionTitle: 'Rate', area: 'middle', yRatio: 0.42 })],
  web: [item({ id: 'w-percent', text: '연 4.95%', sectionId: 'web-content', sectionTitle: 'Rate', area: 'middle', yRatio: 0.421 })],
}, (result) => {
  assert.ok(result.issues.some((issue) => issue.title === '퍼센트 수치가 다릅니다.' || issue.title === '퍼센트 문구가 다릅니다.'))
})

runCase('date diff detected', {
  figma: [item({ id: 'f-date', text: '2026.07.11', sectionId: 'figma-content', sectionTitle: 'Date', area: 'middle', yRatio: 0.42 })],
  web: [item({ id: 'w-date', text: '2026.07.12', sectionId: 'web-content', sectionTitle: 'Date', area: 'middle', yRatio: 0.421 })],
}, (result) => {
  assert.ok(result.issues.some((issue) => issue.title === '날짜 표기가 다릅니다.' || issue.title === '날짜/기간 수치 차이' || issue.title === '날짜/기간 문구가 다릅니다.'))
})

runCase('punctuation diff detected', {
  figma: [item({ id: 'f-punc', text: '신청하세요.', sectionId: 'figma-content', sectionTitle: 'CTA Copy', area: 'middle', yRatio: 0.42 })],
  web: [item({ id: 'w-punc', text: '신청하세요,', sectionId: 'web-content', sectionTitle: 'CTA Copy', area: 'middle', yRatio: 0.421 })],
}, (result) => {
  assert.equal(result.issues.length, 1)
})

runCase('1 to many monthly payment diff', {
  figma: [
    item({ id: 'f1', text: 'BMW 뉴 iX, 월 47만원.', sectionId: 'figma-content', sectionTitle: 'Benefits', area: 'middle', yRatio: 0.46 }),
    item({ id: 'f2', text: 'BMW i 구매 혜택.', sectionId: 'figma-content', sectionTitle: 'Benefits', area: 'middle', yRatio: 0.44 }),
  ],
  web: [
    item({ id: 'w1', text: 'BMW i 구매 혜택', sectionId: 'web-content', sectionTitle: 'Benefits', area: 'middle', yRatio: 0.44 }),
    item({ id: 'w2', text: 'BMW iX', sectionId: 'web-content', sectionTitle: 'Benefits', area: 'middle', yRatio: 0.46 }),
    item({ id: 'w3', text: '월 50만원', sectionId: 'web-content', sectionTitle: 'Benefits', area: 'middle', yRatio: 0.47 }),
  ],
}, (result) => {
  const monthlyIssue = result.issues.find((issue) => issue.title === '월 납입금 수치 차이')
  assert.ok(monthlyIssue)
  assert.equal(monthlyIssue.protectedTextQa, true)
  assert.match(monthlyIssue.figma, /47만원/)
  assert.match(monthlyIssue.web, /50만원/)
})

runCase('hero kv block diff', {
  figma: [
    item({ id: 'f1', text: 'THE NEW BMW iX3', sectionId: 'figma-hero', sectionTitle: 'Hero', area: 'top', yRatio: 0.08, tag: 'h1' }),
    item({ id: 'f2', text: 'BMW 스마트 리스로 지금 만나보세요.', sectionId: 'figma-hero', sectionTitle: 'Hero', area: 'top', yRatio: 0.12, tag: 'p' }),
  ],
  web: [
    item({ id: 'w1', text: 'THE NEW BMW iX3', sectionId: 'web-hero', sectionTitle: 'Hero', area: 'top', yRatio: 0.08, tag: 'h1' }),
    item({ id: 'w2', text: 'The first of a new era', sectionId: 'web-hero', sectionTitle: 'Hero', area: 'top', yRatio: 0.12, tag: 'p' }),
  ],
}, (result) => {
  const heroIssue = result.issues.find((issue) => issue.title === 'Hero KV 문구가 다릅니다.')
  assert.ok(heroIssue)
  assert.equal(heroIssue.protectedTextQa, true)
})

runCase('hero to footer rejected', {
  figma: [item({ id: 'f1', text: 'BMW iX 월 47만원', sectionId: 'figma-hero', sectionTitle: 'Hero', area: 'top', yRatio: 0.1 })],
  web: [item({ id: 'w1', text: 'BMW iX 월 50만원', sectionId: 'web-footer', sectionTitle: 'Footer', area: 'bottom', yRatio: 0.9 })],
}, (result) => assert.equal(result.issues.length, 0))

runCase('cookie popup excluded from hero block', {
  figma: [
    item({ id: 'f1', text: 'THE NEW BMW iX3', sectionId: 'figma-hero', sectionTitle: 'Hero', area: 'top', yRatio: 0.08, tag: 'h1' }),
    item({ id: 'f2', text: 'BMW 스마트 리스', sectionId: 'figma-hero', sectionTitle: 'Hero', area: 'top', yRatio: 0.11, tag: 'p' }),
  ],
  web: [
    item({ id: 'w1', text: 'THE NEW BMW iX3', sectionId: 'web-hero', sectionTitle: 'Hero', area: 'top', yRatio: 0.08, tag: 'h1' }),
    item({ id: 'w2', text: 'BMW 스마트 리스', sectionId: 'web-hero', sectionTitle: 'Hero', area: 'top', yRatio: 0.11, tag: 'p' }),
    item({ id: 'w3', text: '쿠키를 수락해 주세요', sectionId: 'web-hero', sectionTitle: 'Cookie Popup', area: 'top', yRatio: 0.1, tag: 'div', selector: '.cookie-popup' }),
  ],
}, (result) => {
  assert.equal(result.issues.length, 0)
})

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

runCase('long product paragraph to footer legal rejected', {
  figma: [item({ id: 'f-long', text: '상품 설명 문단입니다. 다양한 혜택과 조건을 자세히 안내합니다. 신청 전에 내용을 확인하세요.', sectionId: 'figma-content', sectionTitle: 'Product Description', area: 'middle', yRatio: 0.42, layerPath: 'section > div > p' })],
  web: [item({ id: 'w-legal', text: '운용리스 중도해지 시 위약금은 중도해지 시점과 상품에 따라 차등 적용되며 자세한 사항은 약관을 확인하시기 바랍니다.', sectionId: 'web-legal', sectionTitle: 'Legal', area: 'bottom', yRatio: 0.84, layerPath: 'footer > div > p' })],
}, (result) => assert.equal(result.issues.length, 0))

runCase('same number different section rejected', {
  figma: [item({ id: 'f-number', text: '36개월', sectionId: 'figma-content', sectionTitle: 'Product Terms', area: 'middle', yRatio: 0.44 })],
  web: [item({ id: 'w-number', text: '36개월', sectionId: 'web-legal', sectionTitle: 'Legal Terms', area: 'bottom', yRatio: 0.84 })],
}, (result) => assert.equal(result.issues.length, 0))

runCase('punctuation percent diff', {
  figma: [item({ id: 'f1', text: '금리 3.5%', sectionId: 'figma-content', sectionTitle: 'Rate', area: 'middle', yRatio: 0.4 })],
  web: [item({ id: 'w1', text: '금리 3,5%', sectionId: 'web-content', sectionTitle: 'Rate', area: 'middle', yRatio: 0.4 })],
}, (result) => {
  assert.equal(result.issues.length, 1)
  assert.equal(result.issues[0].protectedTextQa, true)
})

{
  const merged = mergeMockupIssues({
    textIssues: [],
    ctaIssues: [],
    visionIssues: [],
    imageIssues: [
      {
        type: '이미지',
        area: 'top',
        title: '주요 이미지가 다릅니다.',
        figma: '차량 주행 이미지',
        web: '실내 주행 영상 프레임',
        reason: 'Hero 이미지 주제가 다릅니다.',
        memo: '이미지 기준',
        status: '확인 필요',
        priority: 3,
        confidence: 0.8,
        verification: 'kept',
      },
      {
        type: '이미지',
        area: 'top',
        title: 'Hero 배경 미디어가 다릅니다.',
        figma: '정적인 배경 이미지',
        web: '동영상 프레임',
        reason: 'Hero 배경이 이미지와 영상으로 다릅니다.',
        memo: '미디어 형식 기준',
        status: '확인 필요',
        priority: 2,
        confidence: 0.86,
        verification: 'kept',
      },
    ],
  })
  assert.equal(merged.length, 1)
  assert.equal(merged[0].title, 'Hero 메인 비주얼이 다릅니다.')
  console.log('Text QA passed: hero image issues merged')
}

{
  const merged = mergeMockupIssues({
    textIssues: [
      {
        source: 'text-qa',
        textQa: true,
        protectedTextQa: true,
        matchConfidence: 'high',
        matchScore: 0.92,
        diffKind: 'content',
        area: 'middle',
        type: '문구',
        status: '수정 필요',
        priority: 1,
        title: '문구 오타가 있습니다.',
        figma: 'BMWW가 보장한 금액',
        web: 'BMW가 보장한 금액',
        figmaRawText: 'BMWW가 보장한 금액',
        webRawText: 'BMW가 보장한 금액',
        confidence: 0.96,
      },
    ],
    ctaIssues: [],
    visionIssues: [],
    imageIssues: [
      {
        type: '레이아웃',
        area: 'middle',
        title: '카드 간격이 약간 다릅니다.',
        figma: '카드 간격 24px',
        web: '카드 간격 22px',
        reason: '미세 간격 차이',
        memo: '약한 레이아웃 이슈',
        status: '확인 필요',
        priority: 8,
        confidence: 0.55,
        verification: 'kept',
      },
    ],
  })
  assert.equal(merged[0].title, '문구 오타가 있습니다.')
  console.log('Text QA passed: typo prioritized over weak layout')
}
