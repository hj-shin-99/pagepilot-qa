import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createLinkItems, createTechQaViewModel, getVisibleLinkGroups } from './techQa.js'

test('A normal internal links show first five and preserve all twelve', () => {
  const view = createTechQaViewModel(result({ links: Array.from({ length: 12 }, (_, index) => link({ label: `Link ${index + 1}`, url: `https://example.com/${index + 1}` })) }))
  const groups = getVisibleLinkGroups(view.links)

  assert.equal(view.linkSummary.total, 12)
  assert.equal(groups.normals.length, 5)
  assert.equal(groups.hiddenNormals.length, 7)
  assert.equal(view.links.length, 12)
})

test('B errors are all visible before normal links', () => {
  const view = createTechQaViewModel(result({
    links: [
      ...Array.from({ length: 10 }, (_, index) => link({ label: `OK ${index + 1}`, url: `https://example.com/ok-${index}`, statusCode: 200 })),
      link({ label: 'Missing page 1', status: 'error', statusCode: 404, category: 'http-4xx' }),
      link({ label: 'Missing page 2', status: 'error', statusCode: 404, category: 'http-4xx' }),
    ],
  }))
  const groups = getVisibleLinkGroups(view.links)

  assert.equal(groups.errors.length, 2)
  assert.equal(groups.normals.length, 5)
  assert.equal(view.links[0].status, 'error')
  assert.equal(view.links[1].status, 'error')
})

test('C missing href navigation CTA is error with frontend publishing owner', () => {
  const [item] = createLinkItems([link({ label: 'Apply', href: '', url: '', status: 'error', category: 'missing-navigation-url' })])
  assert.equal(item.status, 'error')
  assert.equal(item.owner, 'UID팀')
})

test('D href # CTA is check needed with explanation', () => {
  const [item] = createLinkItems([link({ label: 'More details', href: '#', url: '', status: 'warn', category: 'same-page-anchor' })])
  assert.equal(item.status, 'warn')
  assert.equal(item.description.includes('anchor'), true)
})

test('E modal button and F accordion button are not URL errors', () => {
  const items = createLinkItems([
    link({ label: 'Open modal', status: 'ok', category: 'url-not-required-ui-control', note: 'modal' }),
    link({ label: 'Accordion toggle', status: 'ok', category: 'url-not-required-ui-control', note: 'accordion' }),
  ])
  assert.deepEqual(items.map((item) => item.status), ['ok', 'ok'])
})

test('G API 500 and H main document 500 owners are backend or infrastructure', () => {
  const view = createTechQaViewModel(result({
    checks: [
      check({ id: 'network-failures', status: 'error', value: '1건', items: [{ type: 'fetch', statusCode: 500, url: 'https://example.com/api' }] }),
      check({ id: 'http-status', status: 'error', value: '500' }),
    ],
  }))

  assert.equal(view.allItems.find((item) => item.id === 'network-failures').owner, '개발팀')
  assert.equal(view.allItems.find((item) => item.id === 'http-status').owner, '개발팀')
})

test('I image 404 is error and shared owner', () => {
  const view = createTechQaViewModel(result({ checks: [check({ id: 'images', status: 'error', value: '1건 실패', items: [{ src: '/missing.png', statusCode: 404 }] })] }))
  const item = view.allItems.find((entry) => entry.id === 'images')
  assert.equal(item.status, 'error')
  assert.equal(item.owner, 'UID팀')
})

test('J missing title is check needed for SEO planning', () => {
  const view = createTechQaViewModel(result({ pageTitle: '', checks: [check({ id: 'title', status: 'warn', value: '타이틀 없음' })] }))
  const item = view.allItems.find((entry) => entry.id === 'title')
  assert.equal(item.status, 'warn')
  assert.equal(item.owner, 'UID팀')
})

test('K console JavaScript error is frontend error', () => {
  const view = createTechQaViewModel(result({ checks: [check({ id: 'console-errors', status: 'error', value: '1건', items: [{ message: 'ReferenceError' }] })] }))
  const item = view.allItems.find((entry) => entry.id === 'console-errors')
  assert.equal(item.status, 'error')
  assert.equal(item.owner, 'UID팀')
})

test('L external target blank without noopener is publishing check needed', () => {
  const view = createTechQaViewModel(result({ checks: [check({ id: 'external-links', status: 'warn', value: '1개 확인 필요' })] }))
  const item = view.allItems.find((entry) => entry.id === 'external-links')
  assert.equal(item.status, 'warn')
  assert.equal(item.owner, 'UID팀')
})

test('M unlabeled button is planning content check needed', () => {
  const view = createTechQaViewModel(result({ checks: [check({ id: 'unlabeled-clickables', status: 'warn', value: '1개 확인 필요' })] }))
  const item = view.allItems.find((entry) => entry.id === 'unlabeled-clickables')
  assert.equal(item.status, 'warn')
  assert.equal(item.owner, 'UID팀')
})

test('N same URL multiple sources preserves source count and dedupe meta', () => {
  const view = createTechQaViewModel(result({ links: [link({ sourceCount: 3, sources: [{}, {}, {}] })], linkAudit: { discoveredLinkCount: 3, uniqueRequestUrlCount: 1, actualHttpRequestCount: 1, dedupedLinkCount: 2 } }))
  assert.equal(view.links[0].raw.sourceCount, 3)
  assert.equal(view.linkSummary.actualHttpRequestCount, 1)
  assert.equal(view.linkSummary.dedupedLinkCount, 2)
})

test('O redirect final URL and status are preserved', () => {
  const [item] = createLinkItems([link({ status: 'warn', statusCode: 301, category: 'redirect', url: 'https://example.com/a', finalUrl: 'https://example.com/b' })])
  assert.equal(item.example, 'https://example.com/a -> https://example.com/b')
  assert.equal(item.status, 'warn')
})

test('P timeout is error priority', () => {
  const view = createTechQaViewModel(result({ links: [link({ label: 'Slow', status: 'error', category: 'timeout', note: 'timeout' }), link({ label: 'OK' })] }))
  assert.equal(view.links[0].title, 'Slow')
  assert.equal(view.links[0].status, 'error')
})

test('Q all normal result does not use blocking copy and has no priority items', () => {
  const view = createTechQaViewModel(result({ checks: [check({ id: 'access', status: 'ok' }), check({ id: 'bad-links', status: 'ok' })], links: [link()] }))
  assert.equal(view.counts.error, 0)
  assert.equal(view.priorityItems.length, 0)
  assert.equal(view.normalCheckItems.length, 2)
  assert.equal(view.statusMessage, '배포 차단 오류는 확인되지 않았습니다.')
})

test('sections keep planner SEO frontend backend separation', () => {
  const view = createTechQaViewModel(result({
    checks: [
      check({ id: 'meta', status: 'warn' }),
      check({ id: 'duplicate-ids', status: 'warn' }),
      check({ id: 'network-failures', status: 'error' }),
    ],
  }))
  assert.equal(view.sections.find((section) => section.id === 'seo').items.some((item) => item.id === 'meta'), true)
  assert.equal(view.sections.find((section) => section.id === 'frontend').items.some((item) => item.id === 'duplicate-ids'), true)
  assert.equal(view.sections.find((section) => section.id === 'backend').items.some((item) => item.id === 'network-failures'), true)
})

test('compact Tech QA summary cards use four meaningful KPI values', () => {
  const view = createTechQaViewModel(result({ links: [link(), link({ status: 'warn', category: 'same-page-anchor', href: '#' })], images: [{ status: 'ok' }], consoleMessages: [] }))
  const labels = view.summaryCards.map((card) => card.label)

  assert.deepEqual(labels, ['페이지 접속', '확인 필요', '오류', '검사 완료'])
  assert.equal(view.summaryCards.length, 4)
  assert.deepEqual(view.summaryCards.map((card) => card.status), ['ok', 'warn', 'ok', 'info'])
  assert.equal(view.summaryCards.find((card) => card.label === '검사 완료').value, '링크 2개 · 이미지 1개')
  assert.equal(labels.includes('콘솔'), false)
  assert.equal(labels.includes('이미지'), false)
})

test('compact Tech QA source keeps table UI and closed detail policy', () => {
  const source = fs.readFileSync('src/components/TechQaPanel.jsx', 'utf8')

  assert.equal(source.includes('tech-kpi-grid'), true)
  assert.equal(source.includes('tech-compact-table'), true)
  assert.equal(source.includes('tech-link-table'), true)
  assert.equal(source.includes('tech-owner-badge'), true)
  assert.equal(source.includes('정상 링크 ${groups.hiddenNormals.length}개 더보기'), true)
  assert.equal(source.includes('전체 검사 항목'), false)
  assert.equal(source.includes('정상 검사 {view.normalCheckItems.length}개 펼치기'), true)
  assert.equal(source.includes('tech-kpi-icon'), true)
  assert.equal(source.includes('<details className="detail-card tech-detail-accordion">'), true)
  assert.equal(source.includes('<details className="detail-card tech-detail-accordion" open>'), false)
  assert.equal(source.includes('문제 예시:'), false)
  assert.equal(source.includes('담당 권장:'), false)
  assert.equal(source.includes('쉬운 설명'), true)
  assert.equal(source.includes('문제 요소'), true)
  assert.equal(source.includes('확인할 내용'), true)
  assert.equal(source.includes('리소스 및 네트워크'), false)
  assert.equal(source.includes('우선 확인 팀'), true)
  assert.equal(source.includes('UID팀'), false)
  assert.equal(source.includes('개발팀'), false)
})

test('Tech QA source defines separated click action display groups', () => {
  const source = fs.readFileSync('src/utils/techQa.js', 'utf8')

  assert.equal(source.includes('실제 오류'), true)
  assert.equal(source.includes('확인 필요'), true)
  assert.equal(source.includes('안전상 클릭 생략'), true)
  assert.equal(source.includes('URL이 필요 없는 UI control'), true)
  assert.equal(source.includes('정상 검증 완료'), true)
})

test('Tech QA click action detail preserves technical evidence items', () => {
  const view = createTechQaViewModel(result({
    checks: [check({
      id: 'click-actions',
      status: 'error',
      value: '1개 확인 필요',
      title: '클릭 동작 검사',
      items: [{
        label: 'Apply',
        tagName: 'a',
        role: 'button',
        selector: '#apply',
        domPath: 'main > a',
        section: 'hero',
        href: 'javascript:void(0)',
        hrefState: 'javascript-pseudo-url',
        technicalTerm: 'javascript:void(0)',
        category: 'javascript-pseudo-url',
        reason: '실제 이동 버튼이라면 목적지 URL이 누락됐을 수 있습니다.',
      }],
    })],
  }))
  const item = view.checkItems.find((entry) => entry.id === 'click-actions')

  assert.equal(item.owner, 'UID팀')
  assert.equal(item.technicalTerm, '클릭 동작 검사')
  assert.equal(item.raw.items[0].technicalTerm, 'javascript:void(0)')
  assert.equal(item.raw.items[0].selector, '#apply')
})

test('Tech QA priority count excludes safe click skips and normal UI controls', () => {
  const view = createTechQaViewModel(result({
    checks: [check({
      id: 'click-actions',
      status: 'warn',
      value: '3개 확인 필요',
      items: [{ category: 'skipped-safe-click', status: 'warn', label: 'Delete', safeClickSkippedReason: 'dangerous-action' }],
    })],
    clickActions: [
      { category: 'skipped-safe-click', status: 'warn', label: 'Delete', safeClickSkippedReason: 'dangerous-action' },
      { category: 'UI-control-no-url-required', status: 'ok', label: 'Open modal' },
      { category: 'valid-url', status: 'ok', label: 'Product', href: '/product' },
    ],
  }))
  const clickItem = view.checkItems.find((entry) => entry.id === 'click-actions')

  assert.equal(clickItem.status, 'ok')
  assert.equal(view.priorityItems.some((item) => item.id === 'click-actions'), false)
  assert.equal(view.priorityCounts.warn, 0)
  assert.equal(view.clickActionGroups.safeSkipped.length, 1)
  assert.equal(view.clickActionGroups.uiControls.length, 1)
  assert.equal(view.clickActionGroups.verified.length, 1)
})

test('Tech QA click action priority keeps only actionable click failures', () => {
  const view = createTechQaViewModel(result({
    checks: [check({ id: 'click-actions', status: 'error', value: '4개 확인 필요' })],
    clickActions: [
      { category: 'covered-or-not-interactable', status: 'error', label: 'Hidden CTA', selector: '#hidden', reason: 'pointer-events:none 상태라 사용자가 클릭할 수 없습니다.' },
      { category: 'no-observable-action', status: 'error', label: 'No change', selector: '#no-change', reason: '안전 클릭 후 관찰 가능한 변화가 없습니다.' },
      { category: 'ambiguous-action', status: 'warn', label: 'Apply', selector: '#apply', hrefState: 'missing-href', reason: '이동 버튼처럼 보이지만 href 또는 action 근거가 불완전합니다.' },
      { category: 'skipped-safe-click', status: 'warn', label: 'Delete', safeClickSkippedReason: 'dangerous-action' },
    ],
  }))
  const clickItem = view.priorityItems.find((entry) => entry.id === 'click-actions')

  assert.equal(clickItem.status, 'error')
  assert.equal(clickItem.value, '3개 확인 필요')
  assert.equal(clickItem.problemItems.length, 3)
  assert.equal(view.clickActionGroups.actualErrors.length, 2)
  assert.equal(view.clickActionGroups.warnings.length, 1)
  assert.equal(view.clickActionGroups.safeSkipped.length, 1)
})

test('compact Tech QA CSS uses table rows instead of large repeated cards', () => {
  const css = fs.readFileSync('src/App.css', 'utf8')

  assert.equal(css.includes('.tech-table-row'), true)
  assert.equal(css.includes('.tech-link-row'), true)
  assert.equal(css.includes('grid-template-columns: repeat(4, minmax(0, 1fr));'), true)
})

test('frontend owner badges are normalized to UID team or dev team only', () => {
  const view = createTechQaViewModel(result({
    checks: [
      check({ id: 'meta', status: 'warn' }),
      check({ id: 'network-failures', status: 'error', items: [{ type: 'fetch', statusCode: 500 }] }),
      check({ id: 'duplicate-ids', status: 'warn' }),
    ],
    links: [link({ status: 'error', statusCode: 500, category: 'http-5xx' }), link({ status: 'warn', category: 'same-page-anchor' })],
  }))
  const owners = new Set(view.allItems.filter((item) => item.status !== 'ok').map((item) => item.owner))

  assert.deepEqual([...owners].sort(), ['UID팀', '개발팀'].sort())
})

function result(overrides = {}) {
  return {
    targetUrl: 'https://example.com',
    scannedAt: '2026-07-16T00:00:00.000Z',
    pageTitle: 'Example',
    httpStatus: 200,
    accessible: true,
    checks: [],
    links: [],
    images: [],
    consoleMessages: [],
    counts: { anchors: 0, buttons: 0 },
    mobile: { accessible: true, statusCode: 200, viewport: { width: 390, height: 844 }, note: 'ok' },
    linkAudit: {},
    ...overrides,
  }
}

function check(overrides = {}) {
  return {
    id: 'access',
    title: 'Check',
    status: 'ok',
    value: '정상',
    detail: 'detail',
    items: [],
    ...overrides,
  }
}

function link(overrides = {}) {
  return {
    label: 'Normal link',
    status: 'ok',
    statusCode: 200,
    category: 'http-ok',
    url: 'https://example.com/ok',
    finalUrl: 'https://example.com/ok',
    sourceCount: 1,
    sources: [{}],
    ...overrides,
  }
}
