import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createLinkItems, createTechQaViewModel, getVisibleLinkGroups } from './techQa.js'
import { createTechPanelDisplayModel, resolveTechQaEngine } from './techQaPanelView.js'

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
  assert.equal(view.issueCounts.errorElementCount, 0)
  assert.equal(view.priorityItems.length, 0)
  assert.equal(view.normalCheckItems.length, 2)
  assert.equal(view.statusMessage, '오류 0개 · 확인 필요 0개입니다.')
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

  assert.deepEqual(labels, ['페이지 접속', '오류', '확인 필요', '검사 완료'])
  assert.equal(view.summaryCards.length, 4)
  assert.deepEqual(view.summaryCards.map((card) => card.status), ['ok', 'ok', 'warn', 'info'])
  assert.equal(view.summaryCards.find((card) => card.label === '확인 필요').value, '1개')
  assert.equal(view.summaryCards.find((card) => card.label === '확인 필요').detail, '1개 검사에서 발견')
  assert.equal(view.summaryCards.find((card) => card.label === '검사 완료').value, '링크 2개 · 이미지 1개')
  assert.equal(view.summaryCards.some((card) => `${card.value} ${card.detail || ''}`.includes('고유 요소')), false)
  assert.equal(view.summaryCards.some((card) => `${card.value} ${card.detail || ''}`.includes('근거')), false)
  assert.equal(labels.includes('콘솔'), false)
  assert.equal(labels.includes('이미지'), false)
})

test('Tech QA panel display replaces top KPI cards with completion meta from existing data', () => {
  const base = result({
    linkAudit: { playwrightRunCount: 1, uniqueRequestUrlCount: 98 },
    images: Array.from({ length: 25 }, () => ({ status: 'ok' })),
  })
  const view = createTechQaViewModel(base)
  const display = createTechPanelDisplayModel(base, view)
  const meta = Object.fromEntries(display.completion.meta.map((item) => [item.label, item.value]))

  assert.equal(display.completion.title, 'Tech QA 검사 완료')
  assert.equal(meta['검사 엔진'], 'Playwright')
  assert.equal(meta['검사 환경'], 'Desktop + Mobile')
  assert.equal(meta['링크 검사'], '98개')
  assert.equal(meta['이미지 검사'], '25개')
  assert.equal('처리 시간' in meta, false)
})

test('Tech QA panel display resolves Playwright engine from Tech QA evidence without run count', () => {
  const base = result({
    linkAudit: { uniqueRequestUrlCount: 12 },
    checks: [check({ id: 'access', status: 'ok' }), check({ id: 'links', status: 'ok' })],
    links: [link()],
  })
  const view = createTechQaViewModel(base)
  const display = createTechPanelDisplayModel(base, view)
  const meta = Object.fromEntries(display.completion.meta.map((item) => [item.label, item.value]))

  assert.equal(resolveTechQaEngine(base, view), 'Playwright')
  assert.equal(meta['검사 엔진'], 'Playwright')
})

test('Tech QA panel display resolves Playwright for history compact results with partial meta', () => {
  const restored = {
    targetUrl: 'https://example.com',
    checks: [check({ id: 'access', status: 'ok' })],
    links: [link()],
    images: [],
    mobile: { accessible: true, statusCode: 200, viewport: { width: 390, height: 844 } },
    linkAudit: {},
  }
  const view = createTechQaViewModel(restored)
  const display = createTechPanelDisplayModel(restored, view)
  const meta = Object.fromEntries(display.completion.meta.map((item) => [item.label, item.value]))

  assert.equal(meta['검사 엔진'], 'Playwright')
  assert.equal(display.completion.meta.some((item) => !item.label || item.value === undefined || item.value === ''), false)
})

test('Tech QA panel display hides unavailable completion meta for history fallback', () => {
  const restored = { targetUrl: 'https://example.com', checks: [], links: [], images: [] }
  const view = createTechQaViewModel(restored)
  const display = createTechPanelDisplayModel(restored, view)
  const labels = display.completion.meta.map((item) => item.label)
  const values = display.completion.meta.map((item) => item.value).join(' ')

  assert.equal(labels.includes('검사 엔진'), false)
  assert.equal(labels.includes('처리 시간'), false)
  assert.equal(values.includes('undefined'), false)
  assert.equal(values.includes('NaN'), false)
})

test('compact Tech QA source keeps table UI and closed detail policy', () => {
  const source = fs.readFileSync('src/components/TechQaPanel.jsx', 'utf8')

  assert.equal(source.includes('view.summaryCards.map'), false)
  assert.equal(source.includes('tech-kpi-grid'), false)
  assert.equal(source.includes('TechCompletionCard'), true)
  assert.equal(source.includes('tech-completion-card'), true)
  assert.equal(source.includes('우선 확인 결과 ${display.priorityRows.length}개'), false)
  assert.equal(source.includes('우선 확인 결과 ${display.priorityRows.length}건'), true)
  assert.equal(source.includes('우선 확인 결과가 없습니다.'), true)
  assert.equal(source.includes('tech-compact-table'), true)
  assert.equal(source.includes('tech-link-table'), true)
  assert.equal(source.includes('tech-owner-badge'), true)
  assert.equal(source.includes('정상 링크 ${groups.hiddenNormals.length}개 더보기'), true)
  assert.equal(source.includes('전체 검사 항목'), false)
  assert.equal(source.includes('기본 진단 결과'), true)
  assert.equal(source.includes('정상 검사 {view.normalCheckItems.length}개 펼치기'), false)
  assert.equal(source.includes('tech-click-summary'), false)
  assert.equal(source.includes('tech-click-issue-table'), true)
  assert.equal(source.includes('안전상 클릭 생략 ${safeSkipped.length}개 보기'), true)
  assert.equal(source.includes('정상 동작 ${normalItems.length}개 더보기'), true)
  assert.equal(source.includes('groups.definitions.map'), false)
  assert.equal(source.includes('클릭 동작 검사 요약'), false)
  assert.equal(source.includes('안전상 클릭 생략 전체'), true)
  assert.equal(source.includes('tech-kpi-icon'), false)
  assert.equal(source.includes('<details className="detail-card tech-detail-accordion">'), true)
  assert.equal(source.includes('<details className="detail-card tech-detail-accordion" open>'), false)
  assert.equal(source.includes('문제 예시:'), false)
  assert.equal(source.includes('담당 권장:'), false)
  assert.equal(source.includes('검사 목적'), true)
  assert.equal(source.includes('검사 결과'), true)
  assert.equal(source.includes('문제 및 확인 항목'), false)
  assert.equal(source.includes('담당 팀에서 확인할 내용'), false)
  assert.equal(source.includes('기술 정보 보기'), true)
  assert.equal(source.includes('판정 결과'), true)
  assert.equal(source.includes('확인 이유'), true)
  assert.equal(source.includes('고유 요소 오류'), false)
  assert.equal(source.includes('검사 근거 오류'), false)
  assert.equal(source.includes('쉬운 설명'), false)
  assert.equal(source.includes('error message'), false)
  assert.equal(source.includes('label="영향"'), false)
  assert.equal(source.includes('selector/위치'), false)
  assert.equal(source.includes('확인할 요소'), true)
  assert.equal(source.includes('확인할 내용'), true)
  assert.equal(source.includes('리소스 및 네트워크'), false)
  assert.equal(source.includes('우선 확인 팀'), false)
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

test('Tech QA panel priority A splits click states and matches rendered row counts', () => {
  const view = createTechQaViewModel(result({
    images: Array.from({ length: 25 }, (_, index) => ({ src: `https://example.com/image-${index}.png` })),
    links: [link({ label: 'Pseudo CTA', status: 'warn', category: 'javascript-pseudo-url', href: 'javascript:void(0)', url: '', selector: '#pseudo' })],
    checks: [
      check({ id: 'click-actions', status: 'error' }),
      check({ id: 'meta', status: 'warn', items: [{ label: 'Meta description', status: 'warn' }] }),
      check({ id: 'image-alt', status: 'warn', items: [{ src: 'https://example.com/missing-alt.png', status: 'warn' }] }),
      check({ id: 'external-links', status: 'warn', totalCount: 12, items: [{ href: 'https://external.example', status: 'warn' }] }),
    ],
    clickActions: [
      clickAction({ label: 'Blocked', selector: '#blocked', actionClassification: 'actual-error', status: 'error' }),
      clickAction({ label: 'Ambiguous', selector: '#ambiguous', actionClassification: 'actionable-warning', status: 'warn' }),
    ],
  }))
  const display = createTechPanelDisplayModel({}, view)

  assert.equal(display.priorityRows.length, 6)
  assert.equal(display.priorityCounts.error, 1)
  assert.equal(display.priorityCounts.warn, 5)
  assert.deepEqual(display.priorityRows.slice(0, 2).map((item) => item.title), ['클릭 동작 오류', '클릭 동작 확인 필요'])
  assert.equal(display.priorityRows.find((item) => item.id === 'click-actions-actual-errors').value, '실제 오류 1개')
  assert.equal(display.priorityRows.find((item) => item.id === 'click-actions-warnings').value, '확인 필요 1개')
})

test('Tech QA panel priority B only creates click warning row when click error is zero', () => {
  const view = createTechQaViewModel(result({
    checks: [check({ id: 'click-actions', status: 'warn' })],
    clickActions: [clickAction({ actionClassification: 'actionable-warning', status: 'warn' })],
  }))
  const display = createTechPanelDisplayModel({}, view)

  assert.equal(display.priorityRows.filter((item) => String(item.id).startsWith('click-actions')).length, 1)
  assert.equal(display.priorityRows[0].id, 'click-actions-warnings')
  assert.equal(display.priorityCounts.error, 0)
  assert.equal(display.priorityCounts.warn, 1)
})

test('Tech QA panel priority C creates one click error row for multiple actual errors', () => {
  const view = createTechQaViewModel(result({
    checks: [check({ id: 'click-actions', status: 'error' })],
    clickActions: [
      clickAction({ label: 'Error 1', actionClassification: 'actual-error', status: 'error' }),
      clickAction({ label: 'Error 2', actionClassification: 'actual-error', status: 'error' }),
    ],
  }))
  const display = createTechPanelDisplayModel({}, view)

  assert.equal(display.priorityRows.length, 1)
  assert.equal(display.priorityRows[0].id, 'click-actions-actual-errors')
  assert.equal(display.priorityRows[0].value, '실제 오류 2개')
  assert.equal(display.priorityCounts.error, 1)
})

test('Tech QA panel priority D counts image alt as one row while preserving problem count in value', () => {
  const view = createTechQaViewModel(result({
    images: Array.from({ length: 25 }, (_, index) => ({ src: `https://example.com/image-${index}.png` })),
    checks: [check({ id: 'image-alt', status: 'warn', items: Array.from({ length: 5 }, (_, index) => ({ src: `https://example.com/missing-alt-${index}.png`, status: 'warn' })) })],
  }))
  const display = createTechPanelDisplayModel({}, view)

  assert.equal(display.priorityRows.length, 1)
  assert.equal(display.priorityRows[0].id, 'image-alt')
  assert.equal(display.priorityRows[0].value, '총 25개 · alt 확인 필요 5개')
  assert.equal(display.priorityCounts.warn, 1)
})

test('Tech QA panel priority E keeps completion card and empty priority state when no issues exist', () => {
  const view = createTechQaViewModel(result({ checks: [check({ id: 'access', status: 'ok' })] }))
  const display = createTechPanelDisplayModel(result(), view)

  assert.equal(display.priorityRows.length, 0)
  assert.equal(display.priorityCounts.error, 0)
  assert.equal(display.priorityCounts.warn, 0)
  assert.equal(display.completion.title, 'Tech QA 검사 완료')
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
  assert.equal(view.issueCounts.warningElementCount, 0)
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
  assert.equal(clickItem.value, '실제 오류 2개 · 확인 필요 1개')
  assert.equal(clickItem.problemItems.length, 3)
  assert.equal(view.clickActionGroups.actualErrors.length, 2)
  assert.equal(view.clickActionGroups.warnings.length, 1)
  assert.equal(view.clickActionGroups.safeSkipped.length, 1)
})

test('click display fixture keeps only actual errors and actionable warnings in body counts', () => {
  const clickActions = [
    ...Array.from({ length: 2 }, (_, index) => clickAction({ label: `Error ${index}`, selector: `#error-${index}`, status: 'error', actionClassification: 'actual-error', category: 'covered-or-not-interactable' })),
    ...Array.from({ length: 3 }, (_, index) => clickAction({ label: `Warn ${index}`, selector: `#warn-${index}`, status: 'warn', actionClassification: 'actionable-warning', category: 'ambiguous-action' })),
    ...Array.from({ length: 20 }, (_, index) => clickAction({ label: `Skip ${index}`, selector: `#skip-${index}`, status: 'ok', actionClassification: 'safe-click-skipped', category: 'skipped-safe-click' })),
    ...Array.from({ length: 50 }, (_, index) => clickAction({ label: `Control ${index}`, selector: `#control-${index}`, status: 'ok', actionClassification: 'ui-control-no-url-required', category: 'UI-control-no-url-required' })),
    ...Array.from({ length: 10 }, (_, index) => clickAction({ label: `Verified ${index}`, selector: `#verified-${index}`, status: 'ok', actionClassification: 'verified-working', category: 'observable-action' })),
  ]
  const view = createTechQaViewModel(result({ checks: [check({ id: 'click-actions', status: 'error' })], clickActions }))
  const bodyItems = view.clickActionGroups.actualErrors.concat(view.clickActionGroups.warnings)

  assert.equal(view.clickActionGroups.actualErrors.length, 2)
  assert.equal(view.clickActionGroups.warnings.length, 3)
  assert.equal(view.clickActionGroups.safeSkipped.length, 20)
  assert.equal(view.clickActionGroups.uiControls.length, 50)
  assert.equal(view.clickActionGroups.verified.length, 10)
  assert.equal(bodyItems.length, 5)
  assert.equal(view.issueCounts.errorElementCount, 2)
  assert.equal(view.issueCounts.warningElementCount, 3)
})

test('click summary remains when only non-actionable click classifications exist', () => {
  const clickActions = [
    ...Array.from({ length: 40 }, (_, index) => clickAction({ label: `Skip ${index}`, selector: `#skip-only-${index}`, status: 'ok', actionClassification: 'safe-click-skipped' })),
    ...Array.from({ length: 40 }, (_, index) => clickAction({ label: `Control ${index}`, selector: `#control-only-${index}`, status: 'ok', actionClassification: 'ui-control-no-url-required' })),
    ...Array.from({ length: 20 }, (_, index) => clickAction({ label: `Verified ${index}`, selector: `#verified-only-${index}`, status: 'ok', actionClassification: 'verified-working' })),
  ]
  const view = createTechQaViewModel(result({ checks: [check({ id: 'click-actions', status: 'ok' })], clickActions }))

  assert.equal(view.priorityItems.some((item) => item.id === 'click-actions'), false)
  assert.equal(view.clickActionGroups.total, 100)
  assert.equal(view.clickActionGroups.actualErrors.length + view.clickActionGroups.warnings.length, 0)
  assert.equal(view.issueCounts.errorElementCount, 0)
  assert.equal(view.issueCounts.warningElementCount, 0)
})

test('same CTA in link and click warning is counted once and shown once in priority display', () => {
  const view = createTechQaViewModel(result({
    links: [link({ label: 'Apply', status: 'warn', category: 'javascript-pseudo-url', href: 'javascript:void(0)', url: '', selector: '#same-cta' })],
    checks: [check({ id: 'click-actions', status: 'warn' })],
    clickActions: [clickAction({ label: 'Apply', status: 'warn', actionClassification: 'actionable-warning', category: 'javascript-pseudo-url', href: 'javascript:void(0)', selector: '#same-cta' })],
  }))

  assert.equal(view.priorityItems.filter((item) => item.type === 'link' || item.id === 'click-actions').length, 1)
  assert.equal(view.links.length, 1)
  assert.equal(view.clickActionGroups.warnings.length, 1)
  assert.equal(view.issueCounts.warningElementCount, 1)
  assert.equal(view.issueCounts.warningEvidenceCount, 2)
  assert.equal(view.issueCounts.warningUniqueElementCount, 1)
  assert.equal(view.issueCounts.warningCheckCount, 2)
})

test('Tech QA panel priority rows do not use deduped evidence counts as row counts', () => {
  const scanResult = result({
    links: [link({ label: 'Apply', status: 'warn', category: 'javascript-pseudo-url', href: 'javascript:void(0)', url: '', selector: '#same-cta' })],
    checks: [check({ id: 'click-actions', status: 'warn' })],
    clickActions: [clickAction({ label: 'Apply', status: 'warn', actionClassification: 'actionable-warning', category: 'javascript-pseudo-url', href: 'javascript:void(0)', selector: '#same-cta' })],
  })
  const view = createTechQaViewModel(scanResult)
  const display = createTechPanelDisplayModel(scanResult, view)

  assert.equal(view.issueCounts.warningUniqueElementCount, 1)
  assert.equal(display.priorityRows.filter((item) => item.type === 'link' || String(item.id).startsWith('click-actions')).length, 2)
  assert.equal(display.priorityCounts.warn, 2)
})

test('console repeated duplicate contributes one top-level element and preserves repeatCount', () => {
  const view = createTechQaViewModel(result({
    checks: [check({
      id: 'console-errors',
      status: 'error',
      items: [{ message: 'ReferenceError: app is not defined', status: 'error', sourceUrl: 'https://example.com/app.js', repeatCount: 10 }],
    })],
  }))

  assert.equal(view.issueCounts.errorElementCount, 1)
  assert.equal(view.issueCounts.errorEvidenceCount, 1)
  assert.equal(view.issueCounts.errorUniqueElementCount, 1)
  assert.equal(view.priorityItems[0].problemItems[0].repeatCount, 10)
})

test('count contract A separates warning evidence and unique counts for distinct elements', () => {
  const view = createTechQaViewModel(result({
    checks: [check({ id: 'meta', status: 'warn', items: Array.from({ length: 5 }, (_, index) => ({ id: `meta-${index}`, status: 'warn', label: `Meta ${index}` })) })],
  }))

  assert.equal(view.issueCounts.warningEvidenceCount, 5)
  assert.equal(view.issueCounts.warningUniqueElementCount, 5)
  assert.equal(view.issueCounts.warningCheckCount, 1)
})

test('count contract B keeps duplicated link and click CTA as two evidence and one unique element', () => {
  const view = createTechQaViewModel(result({
    links: [link({ label: 'Apply', status: 'warn', category: 'javascript-pseudo-url', href: 'javascript:void(0)', url: '', selector: '#same-contract-cta' })],
    checks: [check({ id: 'click-actions', status: 'warn' })],
    clickActions: [clickAction({ label: 'Apply', status: 'warn', actionClassification: 'actionable-warning', category: 'javascript-pseudo-url', href: 'javascript:void(0)', selector: '#same-contract-cta' })],
  }))

  assert.equal(view.issueCounts.warningEvidenceCount, 2)
  assert.equal(view.issueCounts.warningUniqueElementCount, 1)
  assert.equal(view.issueCounts.warningCheckCount, 2)
  assert.equal(view.issueCounts.duplicateEvidenceMergedCount, 1)
})

test('count contract C counts error check with actual error and warning in both check totals', () => {
  const view = createTechQaViewModel(result({
    checks: [check({ id: 'click-actions', status: 'error' })],
    clickActions: [
      clickAction({ label: 'Blocked', selector: '#blocked', actionClassification: 'actual-error', status: 'error', category: 'covered-or-not-interactable' }),
      clickAction({ label: 'Ambiguous', selector: '#ambiguous', actionClassification: 'actionable-warning', status: 'warn', category: 'ambiguous-action' }),
    ],
  }))

  assert.equal(view.issueCounts.errorCheckCount, 1)
  assert.equal(view.issueCounts.warningCheckCount, 1)
  assert.equal(view.issueCounts.errorEvidenceCount, 1)
  assert.equal(view.issueCounts.warningEvidenceCount, 1)
  assert.equal(view.issueCounts.errorUniqueElementCount, 1)
  assert.equal(view.issueCounts.warningUniqueElementCount, 1)
})

test('count contract D uses console representative count while preserving repeatCount', () => {
  const view = createTechQaViewModel(result({
    checks: [check({ id: 'console-errors', status: 'error', items: [{ message: 'ReferenceError: repeated', status: 'error', sourceUrl: 'https://example.com/app.js', repeatCount: 10 }] })],
  }))

  assert.equal(view.issueCounts.errorEvidenceCount, 1)
  assert.equal(view.issueCounts.errorUniqueElementCount, 1)
  assert.equal(view.priorityItems[0].problemItems[0].repeatCount, 10)
})

test('count contract E sums warning evidence across meta alt external and console checks', () => {
  const view = createTechQaViewModel(result({
    images: Array.from({ length: 25 }, (_, index) => ({ src: `https://example.com/image-${index}.png` })),
    checks: [
      check({ id: 'meta', status: 'warn', items: Array.from({ length: 4 }, (_, index) => ({ id: `meta-${index}`, status: 'warn', label: `Meta ${index}` })) }),
      check({ id: 'image-alt', status: 'warn', items: Array.from({ length: 5 }, (_, index) => ({ src: `https://example.com/missing-alt-${index}.png`, status: 'warn' })) }),
      check({ id: 'external-links', status: 'warn', totalCount: 20, items: Array.from({ length: 12 }, (_, index) => ({ selector: `#external-${index}`, href: `https://external.example/${index}`, status: 'warn' })) }),
      check({ id: 'console-errors', status: 'warn', meta: { firstPartyRuntimeErrorCount: 0, firstPartyConsoleErrorCount: 0, thirdPartyScriptErrorCount: 1, representativeCount: 1 }, items: [{ message: 'Third-party error', status: 'warn', sourceUrl: 'https://cdn.example.com/script.js', party: 'third-party' }] }),
    ],
  }))

  assert.equal(view.issueCounts.warningEvidenceCount, 22)
  assert.equal(view.issueCounts.warningUniqueElementCount, 22)
  assert.equal(view.issueCounts.warningCheckCount, 4)
  assert.equal(view.checkItems.find((item) => item.id === 'image-alt').value, '총 25개 · alt 확인 필요 5개')
  assert.equal(view.checkItems.find((item) => item.id === 'external-links').value, '총 20개 · rel 확인 필요 12개')
})

test('count contract F keeps evidence totals while reducing unique count for cross-check overlaps', () => {
  const view = createTechQaViewModel(result({
    images: Array.from({ length: 25 }, (_, index) => ({ src: `https://example.com/image-${index}.png` })),
    checks: [
      check({ id: 'meta', status: 'warn', items: Array.from({ length: 4 }, (_, index) => ({ id: `meta-overlap-${index}`, status: 'warn', label: `Meta ${index}` })) }),
      check({ id: 'image-alt', status: 'warn', items: Array.from({ length: 5 }, (_, index) => ({ src: `https://example.com/missing-alt-overlap-${index}.png`, status: 'warn' })) }),
      check({ id: 'external-links', status: 'warn', totalCount: 20, items: Array.from({ length: 12 }, (_, index) => ({ selector: `#overlap-${index}`, href: `https://external.example/${index}`, status: 'warn' })) }),
      check({ id: 'console-errors', status: 'warn', meta: { thirdPartyScriptErrorCount: 1, representativeCount: 1 }, items: [{ message: 'Third-party error', status: 'warn', sourceUrl: 'https://cdn.example.com/script.js', party: 'third-party' }] }),
      check({ id: 'click-actions', status: 'warn' }),
    ],
    clickActions: Array.from({ length: 3 }, (_, index) => clickAction({ label: `Overlapping CTA ${index}`, selector: `#overlap-${index}`, status: 'warn', actionClassification: 'actionable-warning' })),
  }))

  assert.equal(view.issueCounts.warningEvidenceCount, 25)
  assert.equal(view.issueCounts.warningUniqueElementCount, 22)
  assert.equal(view.issueCounts.duplicateEvidenceMergedCount, 3)
  assert.equal(view.issueCounts.warningCheckCount, 5)
})

test('basic diagnostic table keeps normal rows visible without accordion', () => {
  const view = createTechQaViewModel(result({
    checks: [
      check({ id: 'access', status: 'ok', value: '접속 가능' }),
      check({ id: 'http-status', status: 'ok', value: '200' }),
      check({ id: 'title', status: 'ok', value: 'Example' }),
      check({ id: 'console-errors', status: 'ok', value: 'first-party 0 · third-party 0' }),
      check({ id: 'images', status: 'ok', value: '25개 중 실패 0' }),
      check({ id: 'links', status: 'ok', value: '10개' }),
      check({ id: 'missing-href', status: 'ok', value: '0개' }),
      check({ id: 'mobile', status: 'ok', value: '200' }),
      check({ id: 'headings', status: 'ok', value: 'h1 1개' }),
      check({ id: 'duplicate-ids', status: 'ok', value: '0개 확인 필요' }),
      check({ id: 'network-failures', status: 'ok', value: '0건 확인 필요' }),
      check({ id: 'forms', status: 'ok', value: '폼 요소 없음' }),
    ],
  }))

  assert.deepEqual(view.basicCheckItems.map((item) => item.id), ['access', 'http-status', 'title', 'console-errors', 'images', 'links', 'missing-href', 'mobile', 'headings', 'duplicate-ids', 'network-failures', 'forms'])
  assert.equal(view.basicCheckItems.every((item) => item.status === 'ok'), true)
  assert.equal(view.basicCheckItems.find((item) => item.id === 'access').value, '접속 가능 · HTTP 200')
  assert.equal(view.basicCheckItems.find((item) => item.id === 'images').value, '총 25개 · 실패 0개')
  assert.equal(view.basicCheckItems.find((item) => item.id === 'links').value, '총 10개 · 요청 오류 0개')
})

test('generic Tech QA display A keeps all basic checks normal with objective counts', () => {
  const view = createTechQaViewModel(result({
    links: Array.from({ length: 102 }, (_, index) => link({ label: `Link ${index + 1}`, url: `https://example.com/${index}` })),
    images: Array.from({ length: 25 }, () => ({ status: 'ok' })),
    checks: [
      check({ id: 'access', status: 'ok' }),
      check({ id: 'http-status', status: 'ok', value: '200' }),
      check({ id: 'title', status: 'ok', value: 'Example' }),
      check({ id: 'console-errors', status: 'ok', meta: { firstPartyRuntimeErrorCount: 0, firstPartyConsoleErrorCount: 0, thirdPartyScriptErrorCount: 0, representativeCount: 0 } }),
      check({ id: 'images', status: 'ok' }),
      check({ id: 'links', status: 'ok' }),
      check({ id: 'missing-href', status: 'ok' }),
      check({ id: 'mobile', status: 'ok' }),
      check({ id: 'headings', status: 'ok', value: 'h1 1개' }),
      check({ id: 'duplicate-ids', status: 'ok' }),
      check({ id: 'network-failures', status: 'ok' }),
      check({ id: 'forms', status: 'ok', value: '폼 0개' }),
    ],
  }))

  assert.equal(view.basicCheckItems.every((item) => item.status === 'ok'), true)
  assert.equal(view.issueCounts.errorElementCount, 0)
  assert.equal(view.issueCounts.warningElementCount, 0)
  assert.equal(view.basicCheckItems.find((item) => item.id === 'images').value, '총 25개 · 실패 0개')
  assert.equal(view.basicCheckItems.find((item) => item.id === 'links').value, '총 102개 · 요청 오류 0개')
})

test('generic Tech QA display B reports failed image count and preserves image URLs', () => {
  const view = createTechQaViewModel(result({
    images: Array.from({ length: 25 }, (_, index) => ({ src: `https://example.com/image-${index}.png`, status: index < 2 ? 'error' : 'ok' })),
    checks: [check({ id: 'images', status: 'error', items: [{ src: 'https://example.com/broken-1.png', status: 'error' }, { src: 'https://example.com/broken-2.png', status: 'error' }] })],
  }))
  const item = view.basicCheckItems.find((entry) => entry.id === 'images')

  assert.equal(item.status, 'error')
  assert.equal(item.value, '총 25개 · 실패 2개')
  assert.deepEqual(item.problemItems.map((entry) => entry.src), ['https://example.com/broken-1.png', 'https://example.com/broken-2.png'])
})

test('generic Tech QA display C and D classify console party counts objectively', () => {
  const firstParty = createTechQaViewModel(result({
    checks: [check({ id: 'console-errors', status: 'error', meta: { firstPartyRuntimeErrorCount: 1, thirdPartyScriptErrorCount: 0, representativeCount: 1 }, items: [{ message: 'ReferenceError', status: 'error', party: 'first-party', sourceUrl: 'https://example.com/app.js', stack: 'stack', repeatCount: 1 }] })],
  })).basicCheckItems.find((entry) => entry.id === 'console-errors')
  const thirdParty = createTechQaViewModel(result({
    checks: [check({ id: 'console-errors', status: 'warn', meta: { firstPartyRuntimeErrorCount: 0, firstPartyConsoleErrorCount: 0, thirdPartyScriptErrorCount: 2, representativeCount: 2 }, items: [{ message: 'Third party', status: 'warn', party: 'third-party' }] })],
  })).basicCheckItems.find((entry) => entry.id === 'console-errors')

  assert.equal(firstParty.status, 'error')
  assert.equal(firstParty.value, 'first-party 1개 · third-party 0개')
  assert.equal(firstParty.owner, 'UID팀')
  assert.equal(firstParty.problemItems[0].repeatCount, 1)
  assert.equal(thirdParty.status, 'warn')
  assert.equal(thirdParty.value, 'first-party 0개 · third-party 2개')
})

test('generic Tech QA display E and F keeps click error and warning counts aligned', () => {
  const warningOnly = createTechQaViewModel(result({ checks: [check({ id: 'click-actions', status: 'warn' })], clickActions: [clickAction({ actionClassification: 'actionable-warning', status: 'warn' })] }))
  const mixed = createTechQaViewModel(result({
    checks: [check({ id: 'click-actions', status: 'error' })],
    clickActions: [
      ...Array.from({ length: 2 }, (_, index) => clickAction({ label: `Error ${index}`, selector: `#error-${index}`, actionClassification: 'actual-error', status: 'error', category: 'covered-or-not-interactable' })),
      ...Array.from({ length: 3 }, (_, index) => clickAction({ label: `Warn ${index}`, selector: `#warn-${index}`, actionClassification: 'actionable-warning', status: 'warn', category: 'ambiguous-action' })),
    ],
  }))

  assert.equal(warningOnly.checkItems.find((item) => item.id === 'click-actions').status, 'warn')
  assert.equal(warningOnly.checkItems.find((item) => item.id === 'click-actions').value, '실제 오류 0개 · 확인 필요 1개')
  assert.equal(warningOnly.issueCounts.errorElementCount, 0)
  assert.equal(warningOnly.issueCounts.warningElementCount, 1)
  assert.equal(mixed.checkItems.find((item) => item.id === 'click-actions').status, 'error')
  assert.equal(mixed.checkItems.find((item) => item.id === 'click-actions').value, '실제 오류 2개 · 확인 필요 3개')
  assert.equal(mixed.issueCounts.errorElementCount, 2)
  assert.equal(mixed.issueCounts.warningElementCount, 3)
})

test('generic Tech QA display G keeps UI controls and verified clicks out of issue counts', () => {
  const view = createTechQaViewModel(result({
    checks: [check({ id: 'click-actions', status: 'ok' })],
    clickActions: [
      ...Array.from({ length: 30 }, (_, index) => clickAction({ label: `Control ${index}`, selector: `#control-${index}`, status: 'ok', actionClassification: 'ui-control-no-url-required', category: 'UI-control-no-url-required' })),
      ...Array.from({ length: 60 }, (_, index) => clickAction({ label: `Verified ${index}`, selector: `#verified-${index}`, status: 'ok', actionClassification: 'verified-working', category: 'valid-url' })),
    ],
  }))

  assert.equal(view.issueCounts.errorElementCount, 0)
  assert.equal(view.issueCounts.warningElementCount, 0)
  assert.equal(view.checkItems.find((item) => item.id === 'click-actions').status, 'ok')
  assert.equal(view.clickActionGroups.uiControls.length, 30)
  assert.equal(view.clickActionGroups.verified.length, 60)
})

test('generic Tech QA display H and I keep raw selector out of default copy but in technical evidence', () => {
  const source = fs.readFileSync('src/components/TechQaPanel.jsx', 'utf8')

  assert.equal(source.includes('<span className="tech-url-cell">{item.selector'), false)
  assert.equal(source.includes('selector/위치'), false)
  assert.equal(source.includes('label="selector"'), true)
  assert.equal(source.includes('label="raw failure"'), true)
  assert.equal(source.includes('label="영향"'), false)
})

test('compact Tech QA CSS uses table rows instead of large repeated cards', () => {
  const css = fs.readFileSync('src/App.css', 'utf8')

  assert.equal(css.includes('.tech-table-row'), true)
  assert.equal(css.includes('.tech-link-row'), true)
  assert.equal(css.includes('.tech-kpi-grid'), false)
  assert.equal(css.includes('.tech-completion-card'), true)
  assert.equal(css.includes('.tech-completion-meta'), true)
  assert.equal(css.includes('.tech-normal-details p'), true)
})

test('sidebar topbar aligns brand badge and collapse button without positional offsets', () => {
  const css = fs.readFileSync('src/App.css', 'utf8')

  assert.equal(css.includes('.sidebar-topbar'), true)
  assert.equal(css.includes('align-items: center;'), true)
  assert.equal(css.includes('.sidebar-topbar .sidebar-toggle-button'), true)
  assert.equal(css.includes('margin: 0;'), true)
  assert.equal(css.includes('.sidebar-topbar .sidebar-toggle-button {\n  transform'), false)
  assert.equal(css.includes('.sidebar-topbar .sidebar-toggle-button {\n  position: relative'), false)
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

function clickAction(overrides = {}) {
  return {
    label: 'Click action',
    text: 'Click action',
    selector: '#click-action',
    domPath: 'main > a',
    href: '',
    actionType: 'click-handler',
    status: 'warn',
    actionClassification: 'actionable-warning',
    category: 'ambiguous-action',
    reason: '확인 필요',
    ...overrides,
  }
}
