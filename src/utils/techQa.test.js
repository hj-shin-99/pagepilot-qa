import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createLinkItems, createTechQaViewModel, getSectionVisibility, getVisibleLinkGroups } from './techQa.js'
import { createTechDetailRows, createTechPanelDisplayModel, resolveTechQaEngine } from './techQaPanelView.js'

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
  assert.equal(groups.normals.length, 3)
  assert.equal(groups.hiddenNormals.length, 7)
  assert.equal(view.links[0].status, 'error')
  assert.equal(view.links[1].status, 'error')
})

test('B-1 section visibility keeps only first five error rows when errors exceed the limit', () => {
  const groups = getVisibleLinkGroups(Array.from({ length: 6 }, (_, index) => link({ label: `Error ${index + 1}`, status: 'error', statusCode: 404, category: 'http-4xx', url: `https://example.com/error-${index}` })))

  assert.equal(groups.errors.length, 5)
  assert.equal(groups.hiddenErrors.length, 1)
  assert.equal(groups.visibleItems.length, 5)
  assert.equal(groups.hiddenItems.length, 1)
})

test('B-2 section visibility fills remaining slots with warnings after errors', () => {
  const groups = getVisibleLinkGroups([
    ...Array.from({ length: 2 }, (_, index) => link({ label: `Error ${index + 1}`, status: 'error', statusCode: 500, category: 'http-5xx', url: `https://example.com/error-${index}` })),
    ...Array.from({ length: 4 }, (_, index) => link({ label: `Warn ${index + 1}`, status: 'warn', category: 'redirect', statusCode: 301, url: `https://example.com/warn-${index}` })),
  ])

  assert.equal(groups.errors.length, 2)
  assert.equal(groups.warnings.length, 3)
  assert.equal(groups.hiddenWarnings.length, 1)
  assert.equal(groups.visibleItems.length, 5)
  assert.equal(groups.hiddenItems.length, 1)
})

test('B-3 section visibility fills remaining slots with normal rows after warnings', () => {
  const groups = getVisibleLinkGroups([
    link({ label: 'Warn 1', status: 'warn', category: 'redirect', statusCode: 301, url: 'https://example.com/warn-1' }),
    ...Array.from({ length: 72 }, (_, index) => link({ label: `OK ${index + 1}`, url: `https://example.com/ok-${index}` })),
  ])

  assert.equal(groups.warnings.length, 1)
  assert.equal(groups.normals.length, 4)
  assert.equal(groups.hiddenNormals.length, 68)
  assert.equal(groups.visibleItems.length, 5)
  assert.equal(groups.hiddenItems.length, 68)
})

test('B-4 section visibility keeps only five normal rows when all rows are normal', () => {
  const groups = getVisibleLinkGroups(Array.from({ length: 73 }, (_, index) => link({ label: `OK ${index + 1}`, url: `https://example.com/ok-${index}` })))

  assert.equal(groups.errors.length, 0)
  assert.equal(groups.warnings.length, 0)
  assert.equal(groups.normals.length, 5)
  assert.equal(groups.hiddenNormals.length, 68)
})

test('B-5 section visibility keeps all rows visible when the total is five or less', () => {
  const groups = getVisibleLinkGroups(Array.from({ length: 5 }, (_, index) => link({ label: `OK ${index + 1}`, url: `https://example.com/ok-${index}` })))

  assert.equal(groups.visibleItems.length, 5)
  assert.equal(groups.hiddenItems.length, 0)
  assert.equal(groups.hiddenCount, 0)
})

test('B-6 section visibility keeps visible and hidden items disjoint while preserving total count', () => {
  const view = createTechQaViewModel(result({
    links: [
      ...Array.from({ length: 2 }, (_, index) => link({ label: `Error ${index + 1}`, status: 'error', statusCode: 404, category: 'http-4xx', url: `https://example.com/error-${index}` })),
      ...Array.from({ length: 2 }, (_, index) => link({ label: `Warn ${index + 1}`, status: 'warn', category: 'redirect', statusCode: 301, url: `https://example.com/warn-${index}` })),
      ...Array.from({ length: 4 }, (_, index) => link({ label: `OK ${index + 1}`, url: `https://example.com/ok-${index}` })),
    ],
  }))
  const groups = getVisibleLinkGroups(view.links)
  const visibleKeys = new Set(groups.visibleItems.map((item) => item.id))

  assert.equal(groups.hiddenItems.some((item) => visibleKeys.has(item.id)), false)
  assert.equal(groups.visibleItems.length + groups.hiddenItems.length, 8)
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
    durationMs: 18234,
    scanOptions: { url: true, click: true, landing: true, form: true, hover: true, modal: true, scroll: true, responsive: true, download: true, cookie: true, image: true, markup: true },
    linkAudit: { playwrightRunCount: 1, uniqueRequestUrlCount: 98 },
    images: Array.from({ length: 25 }, () => ({ status: 'ok' })),
  })
  const view = createTechQaViewModel(base)
  const display = createTechPanelDisplayModel(base, view)
  const meta = Object.fromEntries(display.completion.meta.map((item) => [item.label, item.value]))

  assert.equal(display.completion.title, 'Tech QA 검사 완료')
  assert.equal(display.completion.steps.includes('페이지 기본 검사 완료'), true)
  assert.equal(display.completion.steps.includes('Desktop + Mobile 검사 완료'), true)
  assert.equal(display.completion.steps.includes('선택한 Tech QA 검사 완료'), true)
  assert.equal(display.completion.steps.includes('Tech QA 처리시간 18.2초'), false)
  assert.equal(meta['검사 엔진'], 'Playwright')
  assert.equal(meta['검사 환경'], 'Desktop + Mobile')
  assert.equal(meta['링크 검사'], '98개')
  assert.equal(meta['이미지 검사'], '25개')
  assert.equal(meta['처리시간'], '18.2초')
})

test('Tech QA completion copy does not claim unselected checks were completed', () => {
  const base = result({
    scanOptions: { url: false, click: false, landing: false, form: false, hover: false, modal: false, scroll: false, responsive: false, download: false, cookie: false, image: false, markup: false },
    checks: [check({ id: 'access', status: 'ok' })],
  })
  const view = createTechQaViewModel(base)
  const display = createTechPanelDisplayModel(base, view)

  assert.equal(display.completion.description.includes('링크 검사'), false)
  assert.equal(display.completion.description.includes('클릭 동작 검사'), false)
  assert.equal(display.completion.description.includes('마크업 및 접근성 검사'), false)
  assert.equal(display.completion.steps.includes('선택한 Tech QA 검사 완료'), false)
  assert.equal(display.completion.steps.includes('페이지 기본 검사 완료'), true)
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
  assert.equal(labels.includes('처리시간'), false)
  assert.equal(values.includes('undefined'), false)
  assert.equal(values.includes('NaN'), false)
})

test('compact Tech QA source keeps table UI and closed detail policy', () => {
  const source = fs.readFileSync('src/components/TechQaPanel.jsx', 'utf8')
  const css = fs.readFileSync('src/App.css', 'utf8')

  assert.equal(source.includes('view.summaryCards.map'), false)
  assert.equal(source.includes('tech-kpi-grid'), false)
  assert.equal(source.includes('TechCompletionCard'), true)
  assert.equal(source.includes('tech-completion-card'), true)
  assert.equal(source.includes('우선 확인 결과 ${display.priorityRows.length}개'), false)
  assert.equal(source.includes('우선 확인 결과 ${display.priorityRows.length}건'), false)
  assert.equal(source.includes('우선 확인 결과가 없습니다.'), false)
  assert.equal(source.includes('Tech QA 검사가 완료되었습니다. 아래 항목에서 오류 및 확인 필요 결과를 확인해 주세요.'), true)
  assert.equal(source.includes('tech-compact-table'), true)
  assert.equal(source.includes('tech-link-table'), true)
  assert.equal(source.includes('tech-owner-badge'), true)
  assert.equal(source.includes('display.priorityVisibility.visibleItems'), false)
  assert.equal(source.includes('CollapsedPriorityRows'), false)
  assert.equal(source.includes('PriorityTableRow'), false)
  assert.equal(source.includes('getCollapsedResultsLabel(groups.hiddenCount)'), true)
  assert.equal(source.includes('전체 검사 항목'), false)
  assert.equal(source.includes('주요 검사 결과'), true)
  assert.equal(source.includes('정상 검사 {view.normalCheckItems.length}개 펼치기'), false)
  assert.equal(source.includes('tech-click-summary'), false)
  assert.equal(source.includes('tech-click-issue-table'), true)
  assert.equal(source.includes('const visibility = getSectionVisibility(rows, { maxVisible: 5'), true)
  assert.equal(source.includes('getCollapsedResultsLabel(visibility.hiddenItems.length)'), true)
  assert.equal(source.includes('랜딩 페이지 검사'), true)
  assert.equal(source.includes('검사할 URL 이동 또는 새 창 결과가 없습니다.'), true)
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
  assert.equal(source.includes('1단계 ·'), false)
  assert.equal(source.includes('2단계 ·'), false)
  assert.equal(source.includes('3단계 ·'), false)
  assert.equal(source.includes('4단계 ·'), false)
  assert.equal(source.includes('5단계 ·'), false)
  assert.equal(source.includes('6단계 ·'), false)
  assert.equal(source.includes('페이지에서 수집한 링크와 이동 URL의 상태를 확인합니다.'), true)
  assert.equal(source.includes('버튼과 링크 등 클릭 가능한 요소의 실제 동작을 확인합니다.'), true)
  assert.equal(source.includes('수집된 이동 대상 페이지의 응답 상태와 기본 콘텐츠를 확인합니다.'), true)
  assert.equal(source.includes('입력 요소의 레이블, 필수값 및 기본 검증 동작을 확인합니다.'), true)
  assert.equal(source.includes('Hover, Dropdown 및 Tooltip 요소의 표시와 복원 동작을 확인합니다.'), true)
  assert.equal(source.includes('Modal의 열기, 닫기, 포커스 및 스크롤 동작을 확인합니다.'), true)
  assert.equal(source.includes('Scroll QA'), true)
  assert.equal(source.includes('Responsive QA'), true)
  assert.equal(source.includes('Download QA'), true)
  assert.equal(source.includes('Cookie QA'), true)
  assert.equal(source.includes('Image QA'), true)
  assert.equal(source.includes('Meta, 이미지 alt, 입력 레이블 등 기본 마크업과 접근성을 확인합니다.'), true)
  assert.equal(source.includes('Tech QA 처리시간 ${durationText}'), false)
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
  assert.equal(css.includes('max-width: 1720px;'), true)
})

test('Tech QA source defines separated click action display groups', () => {
  const source = fs.readFileSync('src/utils/techQa.js', 'utf8')

  assert.equal(source.includes('실제 오류'), true)
  assert.equal(source.includes('확인 필요'), true)
  assert.equal(source.includes('안전상 클릭 생략'), true)
  assert.equal(source.includes('URL이 필요 없는 UI control'), true)
  assert.equal(source.includes('정상 검증 완료'), true)
})

test('Tech QA priority implementation does not hardcode specific sites or hostname branches', () => {
  const panelSource = fs.readFileSync('src/components/TechQaPanel.jsx', 'utf8')
  const viewSource = fs.readFileSync('src/utils/techQaPanelView.js', 'utf8')
  const utilSource = fs.readFileSync('src/utils/techQa.js', 'utf8')
  const combined = [panelSource, viewSource, utilSource].join('\n')

  assert.equal(/BMW|NAVER/.test(combined), false)
  assert.equal(/hostname\s*===|location\.hostname|includes\(['"]naver|includes\(['"]bmw/i.test(combined), false)
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
      { category: 'no-observable-action', status: 'warn', label: 'No change', selector: '#no-change', reason: '안전 클릭 후 관찰 가능한 변화가 없습니다.' },
      { category: 'ambiguous-action', status: 'warn', label: 'Apply', selector: '#apply', hrefState: 'missing-href', reason: '이동 버튼처럼 보이지만 href 또는 action 근거가 불완전합니다.' },
      { category: 'skipped-safe-click', status: 'warn', label: 'Delete', safeClickSkippedReason: 'dangerous-action' },
    ],
  }))
  const clickItem = view.priorityItems.find((entry) => entry.id === 'click-actions')

  assert.equal(clickItem.status, 'error')
  assert.equal(clickItem.value, '실제 오류 1개 · 확인 필요 2개')
  assert.equal(clickItem.problemItems.length, 3)
  assert.equal(view.clickActionGroups.actualErrors.length, 1)
  assert.equal(view.clickActionGroups.warnings.length, 2)
  assert.equal(view.clickActionGroups.safeSkipped.length, 1)
})

test('landing page groups support new section and remain compatible with optional history data', () => {
  const current = createTechQaViewModel(result({
    checks: [check({
      id: 'landing-pages',
      status: 'warn',
      items: [
        { auditId: 'landing-1', label: 'CTA', requestedUrl: 'https://example.com/go', finalUrl: 'https://example.com/final', statusCode: 200, redirected: true, status: 'warn', category: 'redirect', note: '리다이렉트 발생', sources: [{ label: 'CTA', interactionOutcome: 'navigation' }] },
      ],
      meta: { candidateCount: 1, inspectedCount: 1, noTarget: false },
    })],
  }))
  const history = createTechQaViewModel(result({ checks: [] }))

  assert.equal(current.landingPageGroups.total, 1)
  assert.equal(current.landingPageGroups.hasTargets, true)
  assert.equal(current.landingPageGroups.warnings.length, 1)
  assert.equal(history.landingPageGroups.total, 0)
  assert.equal(history.landingPageGroups.hasTargets, false)
})

test('form hover and modal groups remain compatible with optional history data', () => {
  const current = createTechQaViewModel(result({
    checks: [
      check({ id: 'form-interaction', status: 'warn', items: [{ auditId: 'form-1', label: 'Email', status: 'warn', inputType: 'email', note: 'autocomplete 설정이 없습니다.' }], meta: { candidateCount: 1, inspectedCount: 1, noTarget: false } }),
      check({ id: 'hover-interaction', status: 'warn', items: [{ auditId: 'hover-1', label: 'Menu', status: 'warn', category: 'no-change', note: 'Hover 전후 변화 없음' }], meta: { candidateCount: 1, inspectedCount: 1, noTarget: false } }),
      check({ id: 'modal-interaction', status: 'warn', items: [{ auditId: 'modal-1', label: 'Open modal', status: 'warn', category: 'needs-review', note: 'ESC 닫기 확인 필요' }], meta: { candidateCount: 1, inspectedCount: 1, noTarget: false } }),
    ],
  }))
  const history = createTechQaViewModel(result({ checks: [] }))

  assert.equal(current.formInteractionGroups.total, 1)
  assert.equal(current.hoverInteractionGroups.total, 1)
  assert.equal(current.modalInteractionGroups.total, 1)
  assert.equal(current.formInteractionGroups.hasTargets, true)
  assert.equal(current.hoverInteractionGroups.hasTargets, true)
  assert.equal(current.modalInteractionGroups.hasTargets, true)
  assert.equal(history.formInteractionGroups.total, 0)
  assert.equal(history.hoverInteractionGroups.total, 0)
  assert.equal(history.modalInteractionGroups.total, 0)
})

test('landing page groups reuse existing visible row limits for initial display and more view', () => {
  const view = createTechQaViewModel(result({
    checks: [check({
      id: 'landing-pages',
      status: 'warn',
      items: [
        ...Array.from({ length: 7 }, (_, index) => ({ auditId: `landing-warn-${index}`, label: `Warn ${index}`, requestedUrl: `https://example.com/warn-${index}`, finalUrl: `https://example.com/warn-${index}`, statusCode: 200, status: 'warn', category: 'missing-title' })),
        ...Array.from({ length: 8 }, (_, index) => ({ auditId: `landing-ok-${index}`, label: `OK ${index}`, requestedUrl: `https://example.com/ok-${index}`, finalUrl: `https://example.com/ok-${index}`, statusCode: 200, status: 'ok', category: 'landing-ok' })),
      ],
      meta: { candidateCount: 15, inspectedCount: 15, noTarget: false },
    })],
  }))
  const visible = getVisibleLinkGroups(view.landingPageGroups.items)

  assert.equal(visible.warnings.length, 5)
  assert.equal(visible.hiddenWarnings.length, 2)
  assert.equal(visible.normals.length, 0)
  assert.equal(visible.hiddenNormals.length, 8)
  assert.equal(visible.visibleItems.length, 5)
  assert.equal(visible.hiddenItems.length, 10)
})

test('click section visibility applies the same first-five rule with error warn info and normal ordering', () => {
  const visibility = getSectionVisibility([
    ...Array.from({ length: 2 }, (_, index) => ({ id: `error-${index}`, displayStatus: 'error' })),
    ...Array.from({ length: 4 }, (_, index) => ({ id: `warn-${index}`, displayStatus: 'warn' })),
    ...Array.from({ length: 3 }, (_, index) => ({ id: `info-${index}`, displayStatus: 'info' })),
    ...Array.from({ length: 6 }, (_, index) => ({ id: `ok-${index}`, displayStatus: 'ok' })),
  ], { maxVisible: 5, getStatus: (item) => item.displayStatus, statusOrder: ['error', 'warn', 'info', 'ok'] })
  const visibleIds = visibility.visibleItems.map((item) => item.id)

  assert.deepEqual(visibleIds, ['error-0', 'error-1', 'warn-0', 'warn-1', 'warn-2'])
  assert.equal(visibility.hiddenItems.length, 10)
  assert.equal(new Set(visibility.visibleItems.map((item) => item.id)).size, 5)
})

test('new interaction detail rows are created for form hover and modal sections', () => {
  const view = createTechQaViewModel(result({
    checks: [
      check({ id: 'form-interaction', status: 'warn', items: [{ auditId: 'form-1', label: 'Email', status: 'warn', inputType: 'email', note: 'autocomplete 설정이 없습니다.' }], meta: { candidateCount: 1, inspectedCount: 1, noTarget: false } }),
      check({ id: 'hover-interaction', status: 'ok', items: [{ auditId: 'hover-1', label: 'Menu', status: 'ok', category: 'menu', note: 'Hover 후 메뉴 노출 확인' }], meta: { candidateCount: 1, inspectedCount: 1, noTarget: false } }),
      check({ id: 'modal-interaction', status: 'warn', items: [{ auditId: 'modal-1', label: 'Open modal', status: 'warn', category: 'needs-review', note: '닫기 버튼 확인 필요' }], meta: { candidateCount: 1, inspectedCount: 1, noTarget: false } }),
      check({ id: 'scroll-interaction', status: 'warn', items: [{ auditId: 'scroll-1', label: '페이지 스크롤', status: 'warn', category: 'scroll', note: '하단 접근 불명확' }], meta: { candidateCount: 4, inspectedCount: 4, noTarget: false } }),
      check({ id: 'responsive-layout', status: 'warn', items: [{ auditId: 'responsive-1', label: 'Mobile', status: 'warn', category: 'viewport', type: '390x844', note: 'overflow 감지' }], meta: { candidateCount: 3, inspectedCount: 3, noTarget: false } }),
      check({ id: 'download-resource', status: 'warn', items: [{ auditId: 'download-1', label: 'PDF', status: 'warn', category: 'pdf', note: 'HEAD fallback 사용' }], meta: { candidateCount: 1, inspectedCount: 1, noTarget: false } }),
      check({ id: 'cookie-security', status: 'warn', items: [{ label: 'sid', status: 'warn', category: 'first-party', note: 'HttpOnly 설정 확인 필요' }], meta: { candidateCount: 1, inspectedCount: 1, noTarget: false } }),
      check({ id: 'image-rendering', status: 'warn', items: [{ label: 'hero.webp', status: 'warn', category: 'img', note: '원본 해상도에 비해 확대되었습니다.' }], meta: { candidateCount: 1, inspectedCount: 1, noTarget: false } }),
    ],
  }))
  const display = createTechPanelDisplayModel(result(), view)

  assert.equal(display.detailRows.formRows.length, 1)
  assert.equal(display.detailRows.hoverRows.length, 1)
  assert.equal(display.detailRows.modalRows.length, 1)
  assert.equal(display.detailRows.scrollRows.length, 1)
  assert.equal(display.detailRows.responsiveRows.length, 1)
  assert.equal(display.detailRows.downloadRows.length, 1)
  assert.equal(display.detailRows.cookieRows.length, 1)
  assert.equal(display.detailRows.imageRows.length, 1)
  assert.equal(display.detailRows.formRows[0].rowId.startsWith('tech-form-'), true)
  assert.equal(display.detailRows.hoverRows[0].rowId.startsWith('tech-hover-'), true)
  assert.equal(display.detailRows.modalRows[0].rowId.startsWith('tech-modal-'), true)
  assert.equal(display.detailRows.scrollRows[0].rowId.startsWith('tech-scroll-'), true)
  assert.equal(display.detailRows.responsiveRows[0].rowId.startsWith('tech-responsive-'), true)
  assert.equal(display.detailRows.downloadRows[0].rowId.startsWith('tech-download-'), true)
  assert.equal(display.detailRows.cookieRows[0].rowId.startsWith('tech-cookie-'), true)
  assert.equal(display.detailRows.imageRows[0].rowId.startsWith('tech-image-'), true)
})

test('tech qa panel source keeps new section order between modal and markup', () => {
  const source = fs.readFileSync('src/components/TechQaPanel.jsx', 'utf8')
  const modalIndex = source.indexOf('title="Modal QA"')
  const scrollIndex = source.indexOf('title="Scroll QA"')
  const responsiveIndex = source.indexOf('title="Responsive QA"')
  const downloadIndex = source.indexOf('title="Download QA"')
  const cookieIndex = source.indexOf('title="Cookie QA"')
  const imageIndex = source.indexOf('title="Image QA"')
  const markupIndex = source.indexOf('title="마크업 및 접근성 검사"')

  assert.equal(modalIndex > -1 && scrollIndex > modalIndex && responsiveIndex > scrollIndex && downloadIndex > responsiveIndex && cookieIndex > downloadIndex && imageIndex > cookieIndex && markupIndex > imageIndex, true)
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

test('Tech QA detail rows keep link and click entries separate even when evidence is deduped elsewhere', () => {
  const scanResult = result({
    links: [link({ label: 'Apply', status: 'warn', category: 'javascript-pseudo-url', href: 'javascript:void(0)', url: '', selector: '#same-cta' })],
    checks: [check({ id: 'click-actions', status: 'warn' })],
    clickActions: [clickAction({ label: 'Apply', status: 'warn', actionClassification: 'actionable-warning', category: 'javascript-pseudo-url', href: 'javascript:void(0)', selector: '#same-cta' })],
  })
  const view = createTechQaViewModel(scanResult)
  const display = createTechPanelDisplayModel(scanResult, view)

  assert.equal(view.issueCounts.warningUniqueElementCount, 1)
  assert.equal(display.detailRows.linkRows.filter((item) => item.status === 'warn').length, 1)
  assert.equal(display.detailRows.clickRows.filter((item) => item.status === 'warn').length, 1)
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
      check({ id: 'resource-size', status: 'ok', value: '0개 확인 필요', detail: '1MB 이상으로 수집된 리소스가 없습니다.' }),
      check({ id: 'links', status: 'ok', value: '10개' }),
      check({ id: 'missing-href', status: 'ok', value: '0개' }),
      check({ id: 'mobile', status: 'ok', value: '200' }),
      check({ id: 'headings', status: 'ok', value: 'h1 1개' }),
      check({ id: 'duplicate-ids', status: 'ok', value: '0개 확인 필요' }),
      check({ id: 'network-failures', status: 'ok', value: '0건 확인 필요' }),
      check({ id: 'forms', status: 'ok', value: '폼 요소 없음' }),
    ],
  }))

  assert.deepEqual(view.basicCheckItems.map((item) => item.id), ['access', 'http-status', 'title', 'console-errors', 'images', 'resource-size', 'links', 'missing-href', 'mobile', 'headings', 'duplicate-ids', 'network-failures', 'forms'])
  assert.equal(view.basicCheckItems.every((item) => item.status === 'ok'), true)
  assert.equal(view.basicCheckItems.find((item) => item.id === 'access').value, '접속 가능 · HTTP 200')
  assert.equal(view.basicCheckItems.find((item) => item.id === 'images').value, '총 25개 · 실패 0개')
  assert.equal(view.basicCheckItems.find((item) => item.id === 'resource-size').value, '큰 리소스 없음')
  assert.equal(view.basicCheckItems.find((item) => item.id === 'links').value, '총 10개 · 요청 오류 0개')
})

test('resource size check remains in basic results and preserves raw evidence for detail rendering', () => {
  const view = createTechQaViewModel(result({
    checks: [check({
      id: 'resource-size',
      status: 'warn',
      value: '1개 확인 필요',
      detail: '1MB 이상으로 추정되는 큰 리소스가 있어 로딩 속도 확인이 필요합니다.',
      items: [{ url: 'https://cdn.example.com/app.js', type: 'script', sizeBytes: 1572864 }],
    })],
  }))
  const item = view.basicCheckItems.find((entry) => entry.id === 'resource-size')

  assert.equal(item.status, 'warn')
  assert.equal(item.value, '기준 초과 1개')
  assert.equal(item.problemItems.length, 1)
  assert.equal(item.problemItems[0].url, 'https://cdn.example.com/app.js')
  assert.equal(item.problemItems[0].type, 'script')
  assert.equal(item.problemItems[0].sizeBytes, 1572864)
})

test('resource size issue appears in both priority rows and basic detail rows', () => {
  const scanResult = result({
    checks: [check({
      id: 'resource-size',
      status: 'warn',
      detail: '1MB 이상으로 추정되는 큰 리소스가 있어 로딩 속도 확인이 필요합니다.',
      items: [{ url: 'https://cdn.example.com/app.js', type: 'script', sizeBytes: 1572864 }],
    })],
  })
  const view = createTechQaViewModel(scanResult)
  const display = createTechPanelDisplayModel(scanResult, view)

  assert.equal(display.detailRows.basicRows.some((item) => item.id === 'resource-size' && item.status === 'warn'), true)
  assert.equal(view.basicCheckItems.some((item) => item.id === 'resource-size'), true)
})

test('resource size ok state keeps a normal basic row without creating a priority row', () => {
  const scanResult = result({
    checks: [check({ id: 'resource-size', status: 'ok', detail: '1MB 이상으로 수집된 리소스가 없습니다.', items: [] })],
  })
  const view = createTechQaViewModel(scanResult)
  const display = createTechPanelDisplayModel(scanResult, view)

  assert.equal(view.basicCheckItems.some((item) => item.id === 'resource-size' && item.status === 'ok'), true)
  assert.equal(display.detailRows.basicRows.some((item) => item.id === 'resource-size' && item.status === 'ok'), true)
})

test('resource size history fallback stays safe even when detail fields are missing', () => {
  const view = createTechQaViewModel(result({
    checks: [check({ id: 'resource-size', status: 'warn', value: '2개 확인 필요', items: [] })],
  }))
  const item = view.basicCheckItems.find((entry) => entry.id === 'resource-size')

  assert.equal(item.status, 'warn')
  assert.equal(item.value, '2개 확인 필요')
  assert.deepEqual(item.problemItems, [])
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

test('priority detail rows can be recreated from display detail rows without loss', () => {
  const view = createTechQaViewModel(result({
    checks: [check({ id: 'meta', status: 'warn', items: [{ label: 'Meta description', status: 'warn' }] })],
    clickActions: [clickAction({ label: 'Apply', selector: '#apply', actionClassification: 'actionable-warning', status: 'warn' })],
  }))
  const detailRows = createTechDetailRows(view)
  const display = createTechPanelDisplayModel(result(), view)

  assert.equal(Array.isArray(detailRows.basicRows), true)
  assert.equal(Array.isArray(detailRows.linkRows), true)
  assert.equal(Array.isArray(detailRows.clickRows), true)
  assert.equal(Array.isArray(detailRows.landingRows), true)
  assert.equal(Array.isArray(detailRows.markupRows), true)
  assert.equal(detailRows.clickRows.every((item) => item.rowId && item.rowKey && item.detailTargetId === item.rowId), true)
  assert.equal('priorityRows' in display, false)
  assert.equal('priorityCounts' in display, false)
  assert.equal('priorityVisibility' in display, false)
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
