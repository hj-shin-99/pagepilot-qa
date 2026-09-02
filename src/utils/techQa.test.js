import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createLinkItems, createNavigationIntentDisplayModel, createTechQaViewModel, getSectionVisibility, getVisibleLinkGroups } from './techQa.js'
import { createTechDetailRows, createTechPanelDisplayModel, createTechQaDetailViewModel, getDisplayPriorityOwner, resolveTechQaEngine } from './techQaPanelView.js'
import { isDeviceAccordionOpen, updateDeviceAccordionState } from './deviceAccordionState.js'
import { formatStatusClassificationTitle, TECH_QA_EXPLANATION_INVENTORY } from './techQaExplanationCatalog.js'

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
  assert.equal(view.statusMessage, '문제 확인 0개 · 검토 필요 0개입니다.')
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

  assert.deepEqual(labels, ['페이지 접속', '문제 확인', '검토 필요', '정상'])
  assert.equal(view.summaryCards.length, 4)
  assert.deepEqual(view.summaryCards.map((card) => card.status), ['ok', 'ok', 'warn', 'info'])
  assert.equal(view.summaryCards.find((card) => card.label === '검토 필요').value, '1개')
  assert.equal(view.summaryCards.find((card) => card.label === '검토 필요').detail, '1개 검사에서 발견')
  assert.equal(view.summaryCards.find((card) => card.label === '정상').value, 'URL 검사 후보 2개 · 이미지 1개')
  assert.equal(view.summaryCards.some((card) => `${card.value} ${card.detail || ''}`.includes('고유 요소')), false)
  assert.equal(view.summaryCards.some((card) => `${card.value} ${card.detail || ''}`.includes('근거')), false)
  assert.equal(labels.includes('콘솔'), false)
  assert.equal(labels.includes('이미지'), false)
})

test('Tech QA panel display replaces top KPI cards with completion meta from existing data', () => {
  const base = result({
    durationMs: 18234,
    totalDurationMs: 24321,
    scanOptions: { url: true, click: true, landing: true, form: true, hover: true, modal: true, scroll: true, responsive: true, download: true, cookie: true, image: true, performance: true, seo: true, markup: true },
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
  assert.equal(meta['검사 환경'], undefined)
  assert.equal(meta['HTTP 검사 URL'], '98개')
  assert.equal(meta['이미지 검사'], '25개')
  assert.equal(meta['처리시간'], '18.2초')
  assert.equal(meta['총 검사 시간'], '24.3초')
})

test('Tech QA completion copy does not claim unselected checks were completed', () => {
  const base = result({
    scanOptions: { url: false, click: false, landing: false, form: false, hover: false, modal: false, scroll: false, responsive: false, download: false, cookie: false, image: false, performance: false, seo: false, markup: false },
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
  assert.equal(labels.includes('총 검사 시간'), false)
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
  assert.equal(source.includes('Tech QA 검사가 완료되었습니다. 아래 항목에서 문제 확인 및 검토 필요 결과를 확인해 주세요.'), true)
  assert.equal(source.includes('tech-compact-table'), true)
  assert.equal(source.includes('tech-link-table'), true)
  assert.equal(source.includes('tech-owner-badge'), true)
  assert.equal(source.includes('display.priorityVisibility.visibleItems'), false)
  assert.equal(source.includes('CollapsedPriorityRows'), false)
  assert.equal(source.includes('PriorityTableRow'), false)
  assert.equal(source.includes('getCollapsedResultsLabel(groups.hiddenCount)'), true)
  assert.equal(source.includes('전체 검사 항목'), false)
  assert.equal(source.includes('핵심 기본 검사 결과'), true)
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
  assert.equal(source.includes('className="detail-card tech-detail-accordion"'), true)
  assert.equal(source.includes('accordionKey="developer-details"'), true)
  assert.equal(source.includes('<details className="detail-card tech-detail-accordion" open>'), false)
  assert.equal(source.includes('문제 예시:'), false)
  assert.equal(source.includes('담당 권장:'), false)
  assert.equal(source.includes('이 결과의 의미'), true)
  assert.equal(source.includes('대표 원인'), true)
  assert.equal(source.includes('웹에서 확인하는 방법'), true)
  assert.equal(source.includes('확인 후 판단 기준'), true)
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
  assert.equal(source.includes('Performance QA'), true)
  assert.equal(source.includes('SEO QA'), true)
  assert.equal(source.includes('Meta, 이미지 alt, 입력 레이블 등 기본 마크업과 접근성을 확인합니다.'), true)
  assert.equal(source.includes('Tech QA 처리시간 ${durationText}'), false)
  assert.equal(source.includes('고유 요소 오류'), false)
  assert.equal(source.includes('검사 근거 오류'), false)
  assert.equal(source.includes('쉬운 설명'), false)
  assert.equal(source.includes('error message'), false)
  assert.equal(source.includes('확인 후 판단 기준'), true)
  assert.equal(source.includes('selector/위치'), false)
  assert.equal(source.includes('확인할 요소'), true)
  assert.equal(source.includes('권장 조치'), false)
  assert.equal(source.includes('리소스 및 네트워크'), false)
  assert.equal(source.includes('우선 확인 팀'), false)
  assert.equal(source.includes('UID팀'), false)
  assert.equal(source.includes('개발팀'), false)
  assert.equal(css.includes('max-width: 1720px;'), true)
})

test('Tech QA source defines separated click action display groups', () => {
  const source = fs.readFileSync('src/utils/techQa.js', 'utf8')

  assert.equal(source.includes('문제 확인'), true)
  assert.equal(source.includes('검토 필요'), true)
  assert.equal(source.includes('안전상 클릭 생략'), true)
  assert.equal(source.includes('URL이 필요 없는 UI control'), true)
  assert.equal(source.includes('정상'), true)
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

test('Tech QA keeps URL and Click UI-control classifications aligned for url-free controls', () => {
  const view = createTechQaViewModel(result({
    scanOptions: { url: true, click: true },
    links: [
      link({ label: 'Current option', href: 'javascript:void(0)', url: '', status: 'ok', statusCode: null, category: 'url-not-required-ui-control' }),
      link({ label: 'Apply now', href: 'javascript:void(0)', url: '', status: 'warn', statusCode: null, category: 'javascript-pseudo-url' }),
    ],
    clickActions: [
      clickAction({ label: 'Current option', status: 'ok', actionClassification: 'ui-control-no-url-required', category: 'UI-control-no-url-required', href: 'javascript:void(0)', hrefState: 'javascript-pseudo-url' }),
      clickAction({ label: 'Apply now', status: 'warn', actionClassification: 'actionable-warning', category: 'javascript-pseudo-url', href: 'javascript:void(0)', hrefState: 'javascript-pseudo-url' }),
    ],
  }))

  assert.equal(view.links.filter((item) => item.status === 'ok').length, 1)
  assert.equal(view.links.filter((item) => item.status === 'warn').length, 1)
  assert.equal(view.clickActionGroups.uiControls.length, 1)
  assert.equal(view.clickActionGroups.warnings.length, 1)
  assert.equal(view.issueCounts.warningElementCount, 1)
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
  assert.equal(clickItem.value, '문제 확인 1개 · 검토 필요 2개')
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
      check({ id: 'performance-resource', status: 'warn', items: [{ label: '대형 리소스', status: 'warn', category: 'large-resource', note: '큰 script가 있습니다.' }], meta: { candidateCount: 8, inspectedCount: 8, noTarget: false } }),
      check({ id: 'seo-readiness', status: 'warn', items: [{ label: 'Canonical', status: 'warn', category: 'canonical', note: 'canonical 확인 필요' }], meta: { candidateCount: 8, inspectedCount: 8, noTarget: false } }),
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
  assert.equal(display.detailRows.performanceRows.length, 1)
  assert.equal(display.detailRows.seoRows.length, 1)
  assert.equal(display.detailRows.formRows[0].rowId.startsWith('tech-form-'), true)
  assert.equal(display.detailRows.hoverRows[0].rowId.startsWith('tech-hover-'), true)
  assert.equal(display.detailRows.modalRows[0].rowId.startsWith('tech-modal-'), true)
  assert.equal(display.detailRows.scrollRows[0].rowId.startsWith('tech-scroll-'), true)
  assert.equal(display.detailRows.responsiveRows[0].rowId.startsWith('tech-responsive-'), true)
  assert.equal(display.detailRows.downloadRows[0].rowId.startsWith('tech-download-'), true)
  assert.equal(display.detailRows.cookieRows[0].rowId.startsWith('tech-cookie-'), true)
  assert.equal(display.detailRows.imageRows[0].rowId.startsWith('tech-image-'), true)
  assert.equal(display.detailRows.performanceRows[0].rowId.startsWith('tech-performance-'), true)
  assert.equal(display.detailRows.seoRows[0].rowId.startsWith('tech-seo-'), true)
})

test('tech qa panel source keeps new section order between modal and markup', () => {
  const source = fs.readFileSync('src/components/TechQaPanel.jsx', 'utf8')
  const modalIndex = source.indexOf('title="Modal QA"')
  const scrollIndex = source.indexOf('title="Scroll QA"')
  const responsiveIndex = source.indexOf('title="Responsive QA"')
  const downloadIndex = source.indexOf('title="Download QA"')
  const cookieIndex = source.indexOf('title="Cookie QA"')
  const imageIndex = source.indexOf('title="Image QA"')
  const performanceIndex = source.indexOf('title="Performance QA"')
  const seoIndex = source.indexOf('title="SEO QA"')
  const markupIndex = source.indexOf('title="마크업 및 접근성 검사"')

  assert.equal(modalIndex > -1 && scrollIndex > modalIndex && responsiveIndex > scrollIndex && downloadIndex > responsiveIndex && cookieIndex > downloadIndex && imageIndex > cookieIndex && performanceIndex > imageIndex && seoIndex > performanceIndex && markupIndex > seoIndex, true)
})

test('Navigation Intent QA display model dedupes identical actual URLs for compact table display', () => {
  const intent = createNavigationIntentDisplayModel({
    meta: { available: true },
    summary: { evaluated: 1, correct: 1, mismatch: 0, review: 0, notObserved: 0 },
    items: [{ referenceId: 'intent-1', label: 'Apply', status: 'matched-correct', expectedUrls: [{ raw: '/apply' }], actualUrlEvidence: [{ url: 'https://example.com/apply', kind: 'href' }, { url: 'https://example.com/apply', kind: 'landing-final' }] }],
  })

  assert.deepEqual(intent.rows[0].actualUrls, ['https://example.com/apply'])
})

test('tech qa panel source renders Navigation Intent QA only when result is present', () => {
  const source = fs.readFileSync('src/components/TechQaPanel.jsx', 'utf8')

  assert.equal(source.includes('view.navigationIntent.visible ? <NavigationIntentSection intent={view.navigationIntent} /> : null'), true)
  assert.equal(source.includes('id="navigation-intent-qa-section"'), true)
  assert.equal(source.includes('Reference 적용 항목과 현재 페이지에서 관찰된 링크/클릭/랜딩 URL evidence를 비교합니다.'), true)
  assert.equal(source.indexOf('<TechCompletionCard completion={display.completion} />') < source.indexOf('<NavigationIntentSection'), true)
  assert.equal(source.indexOf('<NavigationIntentSection') < source.indexOf('id="tech-basic-section"'), true)
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
  assert.equal(view.checkItems.find((item) => item.id === 'image-alt').value, '총 25개 · alt 검토 필요 5개')
  assert.equal(view.checkItems.find((item) => item.id === 'external-links').value, '총 20개 · rel 검토 필요 12개')
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
  assert.equal(view.basicCheckItems.find((item) => item.id === 'access').value, '정상 · HTTP 200')
  assert.equal(view.basicCheckItems.find((item) => item.id === 'images').value, '총 25개 · 실패 0개')
  assert.equal(view.basicCheckItems.find((item) => item.id === 'resource-size').value, '큰 리소스 없음')
  assert.equal(view.basicCheckItems.find((item) => item.id === 'links').value, 'URL 검사 후보 10개 · HTTP 요청 문제 0개')
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
  assert.equal(item.value, '2개 검토 필요')
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
  assert.equal(view.basicCheckItems.find((item) => item.id === 'links').value, 'URL 검사 후보 102개 · HTTP 요청 문제 0개')
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
  assert.equal(warningOnly.checkItems.find((item) => item.id === 'click-actions').value, '문제 확인 0개 · 검토 필요 1개')
  assert.equal(warningOnly.issueCounts.errorElementCount, 0)
  assert.equal(warningOnly.issueCounts.warningElementCount, 1)
  assert.equal(mixed.checkItems.find((item) => item.id === 'click-actions').status, 'error')
  assert.equal(mixed.checkItems.find((item) => item.id === 'click-actions').value, '문제 확인 2개 · 검토 필요 3개')
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
  assert.equal(source.includes('확인 후 판단 기준'), true)
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

test('Tech QA device tabs keep accordion state isolated per device without remounting panel', () => {
  const source = fs.readFileSync('src/components/TechQaPanel.jsx', 'utf8')
  const appSource = fs.readFileSync('src/App.jsx', 'utf8')

  assert.equal(appSource.includes('<TechQaPanel result={techResult} onNewScan={resetToNewScan} />'), true)
  assert.equal(appSource.includes('<TechQaPanel key='), false)
  assert.equal(source.includes('const [expandedByDevice, setExpandedByDevice] = useState({})'), true)
  assert.equal(source.includes('activeDeviceId: activeDeviceEntry?.deviceId || resolvedActiveDeviceId'), true)
  assert.equal(source.includes('isDeviceAccordionOpen(context.expandedByDevice, deviceId, accordionKey)'), true)
  assert.equal(source.includes('updateDeviceAccordionState(previous, deviceId, accordionKey, open)'), true)
  assert.equal(source.includes('function DetailRow({ id, className, summaryClassName = \'\', children, detail })'), true)
  assert.equal(source.includes('const [isOpen, setIsOpen] = useDeviceAccordionState(id)'), true)
  assert.equal(source.includes('stateKey="tech-links:hidden"'), true)
  assert.equal(source.includes('stateKey="tech-landing:hidden"'), true)
  assert.equal(source.includes('stateKey={`${id}:hidden`}'), true)
})

test('Tech QA accordion state transition keeps Desktop Tablet Mobile independent', () => {
  let expandedByDevice = {}

  expandedByDevice = updateDeviceAccordionState(expandedByDevice, 'desktop', 'tech-landing-row-1', true)
  assert.equal(isDeviceAccordionOpen(expandedByDevice, 'desktop', 'tech-landing-row-1'), true)
  assert.equal(isDeviceAccordionOpen(expandedByDevice, 'desktop', 'tech-links:hidden'), false)
  assert.equal(isDeviceAccordionOpen(expandedByDevice, 'tablet', 'tech-landing-row-1'), false)
  assert.equal(isDeviceAccordionOpen(expandedByDevice, 'tablet', 'tech-links:hidden'), false)

  expandedByDevice = updateDeviceAccordionState(expandedByDevice, 'tablet', 'tech-links:hidden', true)
  assert.equal(isDeviceAccordionOpen(expandedByDevice, 'tablet', 'tech-links:hidden'), true)
  assert.equal(isDeviceAccordionOpen(expandedByDevice, 'tablet', 'tech-landing-row-1'), false)
  assert.equal(isDeviceAccordionOpen(expandedByDevice, 'desktop', 'tech-landing-row-1'), true)
  assert.equal(isDeviceAccordionOpen(expandedByDevice, 'desktop', 'tech-links:hidden'), false)

  assert.equal(isDeviceAccordionOpen(expandedByDevice, 'mobile', 'tech-landing-row-1'), false)
  assert.equal(isDeviceAccordionOpen(expandedByDevice, 'mobile', 'tech-links:hidden'), false)
  assert.equal(isDeviceAccordionOpen(expandedByDevice, 'desktop', 'tech-landing-row-1'), true)
  assert.equal(isDeviceAccordionOpen(expandedByDevice, 'tablet', 'tech-links:hidden'), true)
})

test('Tech QA phase 2 detail view model explains problem results without changing status counts', () => {
  const view = createTechQaViewModel(result({
    links: [link({ label: 'Missing', status: 'error', statusCode: 404, category: 'http-4xx', url: 'https://example.com/missing' })],
  }))
  const row = createTechDetailRows(view).linkRows[0]

  assert.equal(row.displayStatus, '문제 확인')
  assert.equal(row.meaning.includes('서버에서 찾을 수 없거나 사용할 수 없는 상태'), true)
  assert.equal(Array.isArray(row.commonCauses), true)
  assert.equal(row.classificationReason.includes('HTTP 404'), true)
  assert.equal(row.verifySteps.some((step) => step.includes('브라우저 주소창의 최종 URL')), true)
  assert.equal(Array.isArray(row.decisionGuide), true)
  assert.equal(row.finding, row.meaning)
  assert.equal(row.reason, row.classificationReason)
  assert.equal(row.technicalEvidence.some((entry) => entry.label === 'HTTP status' && entry.value === '404'), true)
  assert.equal(view.linkSummary.error, 1)
  assert.equal(view.linkSummary.warn, 0)
  assert.equal(view.linkSummary.ok, 0)
})

test('Tech QA phase 2 review detail explains why direct confirmation is needed', () => {
  const view = createTechQaViewModel(result({
    links: [link({ label: 'Anchor CTA', status: 'warn', statusCode: undefined, category: 'same-page-anchor', href: '#', url: '#' })],
  }))
  const row = createTechDetailRows(view).linkRows[0]

  assert.equal(row.displayStatus, '검토 필요')
  assert.equal(row.meaning.includes('같은 페이지 내부 위치'), true)
  assert.equal(row.classificationReason.includes('anchor'), true)
  assert.equal(row.verifySteps.some((step) => step.includes('페이지 위치')), true)
  assert.equal(row.decisionGuide.some((guide) => guide.includes('임시 링크')), true)
})

test('Tech QA phase 2 normal detail does not claim absolute integrity', () => {
  const row = createTechDetailRows(createTechQaViewModel(result({ checks: [check({ id: 'access', status: 'ok' })] }))).basicRows[0]

  assert.equal(row.displayStatus, '정상')
  assert.equal(row.meaning.includes('브라우저에서 열리는지'), true)
  assert.equal(row.meaning.includes('문제가 전혀 없습니다'), false)
  assert.equal(row.classificationReason.includes('정상'), true)
})

test('Tech QA phase 2 not applicable detail keeps target absence reason', () => {
  const detail = createTechQaDetailViewModel({ id: 'modal-interaction', status: 'info', meta: { noTarget: true } })

  assert.equal(detail.displayStatus, '해당 없음')
  assert.equal(detail.meaning.includes('확인할 대상이 없습니다'), true)
  assert.equal(detail.classificationReason.includes('noTarget'), true)
})

test('Tech QA phase 2 unavailable detail distinguishes existing failure signals', () => {
  const timeout = createTechQaDetailViewModel({ status: 'error', category: 'timeout', message: 'timeout exceeded' })
  const network = createTechQaDetailViewModel({ status: 'error', category: 'request-failed', message: 'net::ERR_NAME_NOT_RESOLVED' })
  const login = createTechQaDetailViewModel({ status: 'error', statusCode: 401, message: 'login required' })

  assert.equal(timeout.displayStatus, '검사 불가')
  assert.equal(timeout.meaning.includes('timeout'), true)
  assert.equal(network.displayStatus, '검사 불가')
  assert.equal(network.meaning.includes('network'), true)
  assert.equal(login.displayStatus, '검사 불가')
  assert.equal(login.meaning.includes('login required'), true)
})

test('Tech QA phase 2 detail evidence hides missing technical fields', () => {
  const detail = createTechQaDetailViewModel({ status: 'warn', value: '검토 필요' })
  const labels = detail.technicalEvidence.map((entry) => entry.label)

  assert.equal(labels.includes('selector'), false)
  assert.equal(labels.includes('URL'), false)
  assert.equal(labels.includes('HTTP status'), false)
  assert.equal(labels.includes('raw value'), true)
})

test('Tech QA phase 2 detail UI keeps inline closed expansion behavior', () => {
  const source = fs.readFileSync('src/components/TechQaPanel.jsx', 'utf8')

  assert.equal(source.includes('function TechExplanationDetails'), true)
  assert.equal(source.includes('이 결과의 의미'), true)
  assert.equal(source.includes('대표 원인'), true)
  assert.equal(source.includes('formatStatusClassificationTitle(displayStatus)'), true)
  assert.equal(source.includes('웹에서 확인하는 방법'), true)
  assert.equal(source.includes('확인 후 판단 기준'), true)
  assert.equal(source.includes('function NormalExplanationDetails'), true)
  assert.equal(source.includes('function NotApplicableExplanationDetails'), true)
  assert.equal(source.includes('확인된 내용'), true)
  assert.equal(source.includes('현재 페이지 상태와 검사 시점 기준 결과입니다.'), true)
  assert.equal(source.includes('function TechnicalEvidenceDetails'), true)
  assert.equal(source.includes('open={isOpen}'), true)
  assert.equal(source.includes('aria-expanded={isOpen}'), true)
})

test('Tech QA display priority owner is hidden only for normal and not applicable rows', () => {
  assert.equal(getDisplayPriorityOwner({ status: 'ok', owner: 'UID팀' }), '-')
  assert.equal(getDisplayPriorityOwner({ status: 'info', owner: 'UID팀' }), '-')
  assert.equal(getDisplayPriorityOwner({ displayStatus: '정상', owner: '개발팀' }), '-')
  assert.equal(getDisplayPriorityOwner({ displayStatus: '해당 없음', owner: 'UID팀' }), '-')
  assert.equal(getDisplayPriorityOwner({ status: 'warn', owner: 'UID팀' }), 'UID팀')
  assert.equal(getDisplayPriorityOwner({ status: 'error', owner: '개발팀' }), '개발팀')
  assert.equal(getDisplayPriorityOwner({ status: 'unavailable', owner: '개발팀' }), '개발팀')
})

test('Tech QA status classification title uses the correct Korean postposition', () => {
  assert.equal(formatStatusClassificationTitle('정상'), "왜 '정상'으로 분류됐나요?")
  assert.equal(formatStatusClassificationTitle('문제 확인'), "왜 '문제 확인'으로 분류됐나요?")
  assert.equal(formatStatusClassificationTitle('검토 필요'), "왜 '검토 필요'로 분류됐나요?")
  assert.equal(formatStatusClassificationTitle('해당 없음'), "왜 '해당 없음'으로 분류됐나요?")
  assert.equal(formatStatusClassificationTitle('검사 불가'), "왜 '검사 불가'로 분류됐나요?")
})

test('Tech QA markup and accessibility table keeps standard column order', () => {
  const source = fs.readFileSync('src/components/TechQaPanel.jsx', 'utf8')
  const headerStart = source.indexOf('<div className="tech-markup-head">')
  const headerEnd = source.indexOf('</div>', headerStart)
  const headerSource = source.slice(headerStart, headerEnd)
  const rowStart = source.indexOf('function MarkupCheckRow')
  const rowEnd = source.indexOf('function MarkupCheckDetails', rowStart)
  const rowSource = source.slice(rowStart, rowEnd)

  assert.equal(headerSource.indexOf('<span>상태</span>') < headerSource.indexOf('<span>검사 대상</span>'), true)
  assert.equal(headerSource.indexOf('<span>검사 대상</span>') < headerSource.indexOf('<span>유형</span>'), true)
  assert.equal(headerSource.indexOf('<span>유형</span>') < headerSource.indexOf('<span>결과</span>'), true)
  assert.equal(headerSource.indexOf('<span>결과</span>') < headerSource.indexOf('<span>우선 확인</span>'), true)
  assert.equal(headerSource.indexOf('<span>우선 확인</span>') < headerSource.indexOf('<span>상세</span>'), true)
  assert.equal(rowSource.indexOf('status-badge') < rowSource.indexOf('<strong>{item.title}</strong>'), true)
  assert.equal(rowSource.indexOf('<strong>{item.title}</strong>') < rowSource.indexOf('tech-category-chip'), true)
  assert.equal(rowSource.includes('getDisplayPriorityOwner(item)'), true)
})

test('Tech QA markup review element fallback never reports review rows as normal', () => {
  const source = fs.readFileSync('src/components/TechQaPanel.jsx', 'utf8')
  const formatStart = source.indexOf('function formatElementIssue')
  const formatEnd = source.indexOf('function getReviewElementFallbackReason', formatStart)
  const fallbackStart = source.indexOf('function getReviewElementFallbackReason')
  const fallbackEnd = source.indexOf('function getEntryStatus', fallbackStart)
  const formatSource = source.slice(formatStart, formatEnd)
  const fallbackSource = source.slice(fallbackStart, fallbackEnd)

  assert.equal(formatSource.includes('item.reason || item.message || item.detail || item.issue'), true)
  assert.equal(formatSource.includes("getEntryStatus(item) !== 'ok'"), true)
  assert.equal(formatSource.includes('정상으로 확인되었습니다.'), false)
  assert.equal(fallbackSource.includes('canonical URL이 확인되지 않았습니다.'), true)
  assert.equal(fallbackSource.includes('OG 메타 값이 확인되지 않았습니다.'), true)
  assert.equal(fallbackSource.includes('접근 가능한 이름이 없거나 불명확합니다.'), true)
})

test('Tech QA normal explanations override issue-oriented generic copy for download and failed resources', () => {
  const download = createTechQaDetailViewModel({ status: 'ok', category: 'download-ok', label: '자료 및 양식 다운로드', value: '정상' })
  const failedResource = createTechQaDetailViewModel({ rowId: 'tech-performance-failed-resource', status: 'ok', category: 'failed-resource', label: '실패 리소스', value: '정상' })

  assert.equal(download.displayStatus, '정상')
  assert.equal(download.meaning, '다운로드 링크의 응답 상태와 주요 헤더가 현재 검사 조건에서 정상 범위로 확인됐습니다.')
  assert.equal(download.meaning.includes('추가 확인이 필요한 신호'), false)
  assert.equal(failedResource.displayStatus, '정상')
  assert.equal(failedResource.meaning, '페이지 구성에 필요한 핵심 first-party 리소스 요청에서 실패 신호가 확인되지 않았습니다.')
  assert.equal(failedResource.meaning.includes('실패 응답이 확인됐습니다'), false)
})

test('Tech QA modal and hreflang display paths fix remaining Korean grammar mistakes', () => {
  const modalView = createTechQaViewModel(result({
    scanOptions: { modal: true },
    checks: [check({ id: 'modal-interaction', status: 'error', meta: { candidateCount: 1 } })],
    modalInteractions: [{ status: 'error', category: 'runtime-error', label: 'Modal', note: '모달 검사 중 오류가 발생했습니다.' }],
  }))
  const seoView = createTechQaViewModel(result({
    scanOptions: { seo: true },
    checks: [check({ id: 'seo-readiness', status: 'info', meta: { candidateCount: 1 } })],
    seoItems: [{ status: 'info', category: 'hreflang', label: 'hreflang', note: 'hreflang 링크가 없어도 자동 오류로 보지 않았습니다.' }],
  }))

  const modalRow = createTechDetailRows(modalView).modalRows[0]
  const seoRow = createTechDetailRows(seoView).seoRows[0]

  assert.equal(modalRow.value, '모달 검사 중 문제가 확인되었습니다.')
  assert.equal(modalRow.value.includes(['문제 확인', '가'].join('')), false)
  assert.equal(seoRow.value, 'hreflang 링크가 없다는 이유만으로 문제 확인 상태로 분류하지 않았습니다.')
  assert.equal(seoRow.value.includes(['문제 확인', '로'].join('')), false)
})

test('Tech QA landing display uses canonical ok status over stale unavailable label', () => {
  const detail = createTechQaDetailViewModel({ rowId: 'tech-landing-ok-stale-label', status: 'ok', statusLabel: '검사 불가', category: 'landing-ok', statusCode: 200, label: '랜딩 페이지', value: '검사 불가 · HTTP 200 · 최종 랜딩 페이지가 정상적으로 열렸습니다.', note: '최종 랜딩 페이지가 정상적으로 열렸습니다.', loadWarning: 'networkidle timeout' })

  assert.equal(detail.displayStatus, '정상')
  assert.equal(detail.summary, '정상 · HTTP 200 · 최종 랜딩 페이지가 정상적으로 열렸습니다.')
  assert.equal(detail.summary.includes('검사 불가'), false)
  assert.equal(detail.meaning.includes('기본 콘텐츠와 성공 응답'), true)
  assert.equal(detail.meaning.includes('끝까지 확인하지 못했습니다'), false)
  assert.equal(detail.technicalEvidence.some((entry) => entry.label === 'raw value' && entry.value.includes('검사 불가')), true)
})

test('Tech QA landing display keeps unavailable fallback only when canonical evidence does not override it', () => {
  const restricted = createTechQaDetailViewModel({ rowId: 'tech-landing-restricted', status: 'warn', statusLabel: '검사 불가', category: 'restricted', statusCode: 403, label: '랜딩 페이지', value: '검사 불가 · HTTP 403' })
  const needsReview = createTechQaDetailViewModel({ rowId: 'tech-landing-review', status: 'warn', category: 'needs-review', statusCode: 200, label: '랜딩 페이지' })
  const browserError = createTechQaDetailViewModel({ rowId: 'tech-landing-browser-error', status: 'error', category: 'browser-error-page', statusCode: 200, label: '랜딩 페이지' })
  const legacy = createTechQaDetailViewModel({ rowId: 'tech-landing-legacy', statusLabel: '검사 불가', label: 'Legacy landing', value: '검사 불가' })

  assert.equal(restricted.displayStatus, '검사 불가')
  assert.equal(needsReview.displayStatus, '검토 필요')
  assert.equal(browserError.displayStatus, '문제 확인')
  assert.equal(legacy.displayStatus, '검사 불가')
})

test('Tech QA technical owner guidance is hidden only for normal and not applicable detail entries', () => {
  const source = fs.readFileSync('src/components/TechQaPanel.jsx', 'utf8')
  const helperStart = source.indexOf('function shouldShowTeamCheck')
  const helperEnd = source.indexOf('function formatDecisionResult', helperStart)
  const helperSource = source.slice(helperStart, helperEnd)
  const cardStart = source.indexOf('function ProblemElementCard')
  const cardEnd = source.indexOf('function shouldShowTeamCheck', cardStart)
  const cardSource = source.slice(cardStart, cardEnd)

  assert.equal(cardSource.includes('showTeamCheck ?'), true)
  assert.equal(helperSource.includes("displayStatus !== '정상' && displayStatus !== '해당 없음'"), true)
  assert.equal(helperSource.includes('getDisplayStatusLabel'), true)
})

test('Tech QA evidence labels are selected from display status without changing issue arrays', () => {
  const source = fs.readFileSync('src/components/TechQaPanel.jsx', 'utf8')

  assert.equal(source.includes('function getInteractionEvidenceDisplay'), true)
  assert.equal(source.includes("displayStatus === '정상') return { label: '확인된 내용', items }"), true)
  assert.equal(source.includes("displayStatus === '해당 없음') return { label: '참고 정보', items }"), true)
  assert.equal(source.includes("displayStatus === '문제 확인') return { label: '문제 확인 사유', items }"), true)
  assert.equal(source.includes("displayStatus === '검사 불가') return { label: '검사 불가 사유', items }"), true)
  assert.equal(source.includes("return { label: '검토 필요 사유', items }"), true)
  assert.equal(source.includes('isRepeatedEvidenceSummary(item, items)'), true)
  assert.equal(source.includes('item.issues.filter'), true)
})

test('Tech QA panel normal details and click decision labels prefer canonical success display text', () => {
  const source = fs.readFileSync('src/components/TechQaPanel.jsx', 'utf8')

  assert.equal(source.includes('function getConfirmedNormalDetailText'), true)
  assert.equal(source.includes('formatCanonicalSuccessDisplay(item)'), true)
  assert.equal(source.includes('function getNormalInteractionOutcomeLabel'), true)
  assert.equal(source.includes("if (outcome) return `${status} · ${outcome}`"), true)
})

test('ProblemElementCard keeps href action display separate from source URL evidence', () => {
  const source = fs.readFileSync('src/components/TechQaPanel.jsx', 'utf8')
  const cardStart = source.indexOf('function ProblemElementCard')
  const cardEnd = source.indexOf('function formatDecisionResult', cardStart)
  const cardSource = source.slice(cardStart, cardEnd)
  const helperStart = source.indexOf('function getHrefActionDisplayValue')
  const helperEnd = source.indexOf('function getNormalInteractionOutcomeLabel', helperStart)
  const helperSource = source.slice(helperStart, helperEnd)

  assert.equal(cardSource.includes('value={getHrefActionDisplayValue(entry)}'), true)
  assert.equal(cardSource.includes('value={entry.href || entry.formAction || entry.actionType || entry.actionEvidence}'), false)
  assert.equal(cardSource.includes('label="source URL" value={entry.sourceUrl || entry.source}'), true)
  assert.equal(helperSource.includes('if (entry.href || entry.formAction) return entry.href || entry.formAction'), true)
  assert.equal(helperSource.includes('if (entry.actionEvidence) return entry.actionEvidence'), true)
  assert.equal(helperSource.includes('if (entry.hasOnClick === true && entry.actionType) return entry.actionType'), true)
})

test('Tech QA detail display copy fixes remaining Korean postposition mistakes', () => {
  const sources = [
    'src/components/TechQaPanel.jsx',
    'src/utils/techQaExplanationCatalog.js',
    'src/utils/techQaPanelView.js',
    'src/utils/techQa.test.js',
    'src/utils/inputPanelSource.test.js',
  ].map((filePath) => fs.readFileSync(filePath, 'utf8')).join('\n')
  const badPatterns = [
    ['문제 확인', '로'].join(''),
    ['정상', '로'].join(''),
    ['해당 없음', '로'].join(''),
    ['검사 불가', '로'].join(''),
    ['문제 확인', '가'].join(''),
    ['검토 필요', '가 발생'].join(''),
  ]

  badPatterns.forEach((pattern) => assert.equal(sources.includes(pattern), false))
  assert.equal(sources.includes('hreflang 링크가 없다는 이유만으로 문제 확인 상태로 분류하지 않았습니다.'), true)
})

test('Tech QA normal Title row uses Title-specific explanation instead of SEO-wide fallback', () => {
  const detail = createTechQaDetailViewModel({ rowId: 'tech-basic-title', id: 'title', status: 'ok', value: 'BMWFS' })

  assert.equal(detail.displayStatus, '정상')
  assert.equal(detail.meaning, '문서 title이 존재하고 현재 값이 정상적으로 수집됐는지 확인한 결과입니다.')
  assert.equal(detail.meaning.includes('description, robots, OG, hreflang, sitemap'), false)
})

test('Tech QA detail explanation changes do not mutate original status result or evidence arrays', () => {
  const item = {
    rowId: 'tech-performance-render-blocking',
    status: 'ok',
    category: 'render-blocking',
    value: '정상 · 렌더링 차단 가능 리소스 없음',
    issues: ['렌더링 차단 가능 리소스 없음'],
    owner: '개발팀',
  }
  const original = JSON.parse(JSON.stringify(item))
  const detail = createTechQaDetailViewModel(item)

  assert.deepEqual(item, original)
  assert.equal(item.status, original.status)
  assert.equal(item.value, original.value)
  assert.deepEqual(item.issues, original.issues)
  assert.equal(detail.technicalEvidence.some((entry) => entry.label === 'raw value' && entry.value === original.value), true)
})

test('Tech QA responsive explanation accepts non-array history issues safely', () => {
  const stringIssue = createTechQaDetailViewModel({ id: 'responsive-layout', category: 'overflow', raw: { issues: '가로 overflow' } })
  const objectIssue = createTechQaDetailViewModel({ id: 'responsive-layout', category: 'overflow', raw: { issues: { message: '모바일 잘림' } } })
  const emptyIssue = createTechQaDetailViewModel({ id: 'responsive-layout', category: 'overflow', raw: { issues: null } })

  assert.match(stringIssue.reason, /가로 overflow/)
  assert.match(objectIssue.reason, /모바일 잘림/)
  assert.equal(objectIssue.reason.includes('[object Object]'), false)
  assert.match(emptyIssue.reason, /viewport 관찰값/)
})

test('Tech QA phase 2 detail view remains safe for restored history-shaped rows', () => {
  const view = createTechQaViewModel(result({ checks: [check({ id: 'resource-size', status: 'warn', value: '2개 확인 필요', items: undefined })] }))
  const row = createTechDetailRows(view).basicRows.find((item) => item.id === 'resource-size')

  assert.equal(row.displayStatus, '검토 필요')
  assert.equal(Boolean(row.finding), true)
  assert.equal(Boolean(row.reason), true)
  assert.equal(Array.isArray(row.verifySteps), true)
  assert.equal(Array.isArray(row.technicalEvidence), true)
})

test('Tech QA explanation inventory covers every displayed Tech QA section', () => {
  const screenNames = TECH_QA_EXPLANATION_INVENTORY.map((entry) => entry.screenName)

  assert.deepEqual(screenNames, [
    '주요 검사 결과',
    'URL 검사',
    '클릭 동작 검사',
    '랜딩 페이지 검사',
    'Form QA',
    'Hover / Dropdown QA',
    'Modal QA',
    'Scroll QA',
    'Responsive QA',
    'Download QA',
    'Cookie QA',
    'Image QA',
    'Performance QA',
    'SEO QA',
    '마크업 및 접근성 검사',
  ])
  assert.equal(TECH_QA_EXPLANATION_INVENTORY.every((entry) => Array.isArray(entry.categories) && entry.categories.length > 0), true)
})

test('Tech QA explanation common contract preserves result and technical evidence shape', () => {
  const item = {
    rowId: 'tech-click-apply',
    status: 'error',
    statusLabel: '문제 확인',
    value: 'hit-test 결과 unrelated overlay가 실제 클릭 지점을 막고 있습니다.',
    label: '프로모션 바로가기',
    category: 'covered-or-not-interactable',
    actionClassification: 'actual-error',
    hitTestStatus: 'hitTestFailed',
    unrelatedOverlay: true,
    overlaySelector: '#overlay',
    selector: '#promotion',
  }
  const detail = { ...item, ...createTechQaDetailViewModel(item) }

  assert.equal(detail.value, 'hit-test 결과 unrelated overlay가 실제 클릭 지점을 막고 있습니다.')
  assert.equal(detail.status, 'error')
  assert.equal(detail.displayStatus, '문제 확인')
  assertExplanation(detail)
  assert.equal(detail.meaning.includes('프로모션 바로가기'), true)
  assert.equal(detail.meaning.includes('클릭 좌표 위에 다른 화면 요소'), true)
  assert.equal(detail.verifySteps.some((step) => step.includes('클릭')), true)
  assert.equal(detail.commonCauses.some((cause) => cause.includes('overlay') || cause.includes('팝업')), true)
  assert.equal(detail.technicalEvidence.some((entry) => entry.label === 'overlay selector' && entry.value === '#overlay'), true)
})

test('URL explanation templates cover special links access errors timeout and sparse success', () => {
  const cases = [
    { category: 'javascript-pseudo-url', href: 'javascript:void(0)', status: 'warn', expect: 'JavaScript', step: '클릭' },
    { category: 'http-4xx', statusCode: 403, status: 'warn', expect: '접근 권한', step: '로그인' },
    { category: 'http-4xx', statusCode: 404, status: 'error', expect: '찾을 수 없거나', step: '최종 URL' },
    { category: 'timeout', status: 'error', message: 'timeout exceeded', expect: '제한 시간', step: 'Network' },
    { category: 'special-scheme', linkType: 'mailto', href: 'mailto:hello@example.com', status: 'ok', expect: '메일 앱', step: 'href' },
    { category: 'special-scheme', linkType: 'tel', href: 'tel:01012345678', status: 'ok', expect: '전화 앱', step: 'href' },
    { category: 'sparse-success-page', statusCode: 200, status: 'warn', expect: 'HTTP 200', step: '콘텐츠' },
  ]

  cases.forEach((entry) => {
    const detail = createTechQaDetailViewModel({ type: 'link', title: 'Link', label: 'Link', url: 'https://example.com', ...entry })
    assertExplanation(detail)
    assert.equal(detail.meaning.includes(entry.expect) || detail.classificationReason.includes(entry.expect), true)
    assert.equal(detail.verifySteps.some((step) => step.includes(entry.step)), true)
  })
})

test('Click explanation templates cover overlay timeout no-change UI control navigation and missing target', () => {
  const cases = [
    { rowId: 'tech-click-overlay', status: 'error', category: 'covered-or-not-interactable', label: 'Apply', actionClassification: 'actual-error', hitTestStatus: 'hitTestFailed', unrelatedOverlay: true, expect: '클릭 좌표', step: '클릭' },
    { rowId: 'tech-click-timeout', status: 'error', category: 'covered-or-not-interactable', label: 'Open', actionClassification: 'actual-error', message: 'Timeout 2500ms exceeded', expect: '제한 시간', step: 'spinner' },
    { rowId: 'tech-click-no-change', status: 'warn', category: 'no-observable-action', label: 'Track', actionClassification: 'actionable-warning', expect: '변화가 관찰되지 않았습니다', step: 'Console' },
    { rowId: 'tech-click-control', status: 'ok', category: 'UI-control-no-url-required', label: 'Menu', actionClassification: 'ui-control-no-url-required', expect: 'UI 제어', step: '키보드' },
    { rowId: 'tech-click-nav', status: 'ok', category: 'valid-url', label: 'Product', actionClassification: 'verified-working', expect: '확인됐습니다', step: '클릭' },
    { rowId: 'tech-click-missing', status: 'warn', category: 'missing-navigation-action', label: 'CTA', actionClassification: 'actionable-warning', expect: '충분히 명확', step: '클릭' },
  ]

  cases.forEach((item) => {
    const detail = createTechQaDetailViewModel(item)
    assertExplanation(detail)
    assert.equal(`${detail.meaning} ${detail.classificationReason}`.includes(item.expect), true)
    assert.equal(detail.verifySteps.some((step) => step.includes(item.step)), true)
  })
})

test('Click normal explanation follows final ok status even when hit-test evidence is preserved', () => {
  const detail = createTechQaDetailViewModel({ rowId: 'tech-click-valid-url-stale-hit-test', status: 'ok', category: 'valid-url', label: '프로모션 바로가기', actionClassification: 'verified-working', hitTestStatus: 'hitTestFailed', unrelatedOverlay: true, overlaySelector: '#overlay', interactionOutcome: 'navigation' })

  assert.equal(detail.displayStatus, '정상')
  assert.equal(detail.meaning.includes('URL 이동'), true)
  assert.equal(detail.classificationReason.includes('정상으로 분류했습니다'), true)
  assert.equal(detail.classificationReason.includes('문제 확인'), false)
  assert.equal(detail.meaning.includes('클릭 좌표 위에 다른 화면 요소'), false)
  assert.equal(detail.technicalEvidence.some((entry) => entry.label === 'overlay selector' && entry.value === '#overlay'), true)
})

test('Click ok scroll result uses final interaction label instead of stale href technical term', () => {
  const detail = createTechQaDetailViewModel({ rowId: 'tech-click-scroll', status: 'ok', category: 'observable-action', label: 'Scroll target', technicalTerm: 'href 누락', hrefState: 'missing-href', interactionOutcome: 'scroll', actionClassification: 'verified-working', value: '동일 페이지 내 스크롤 또는 anchor 이동이 감지되었습니다.' })

  assert.equal(detail.displayStatus, '정상')
  assert.equal(detail.summary, '정상')
  assert.equal(detail.technicalEvidence.some((entry) => entry.label === 'href state' && entry.value === 'missing-href'), true)
})

test('Click non-ok explanations keep warning and error semantics', () => {
  const review = createTechQaDetailViewModel({ rowId: 'tech-click-active-overlay', status: 'warn', category: 'blocked-by-active-overlay', label: '열기', actionClassification: 'actionable-warning', hitTestStatus: 'hitTestFailed', unrelatedOverlay: true })
  const problem = createTechQaDetailViewModel({ rowId: 'tech-click-covered', status: 'error', category: 'covered-or-not-interactable', label: '신청', actionClassification: 'actual-error', hitTestStatus: 'hitTestFailed', unrelatedOverlay: true })
  const navigation = createTechQaDetailViewModel({ rowId: 'tech-click-navigation', status: 'ok', category: 'observable-action', label: '자세히 보기', actionClassification: 'verified-working', interactionOutcome: 'navigation' })
  const missing = createTechQaDetailViewModel({ rowId: 'tech-click-missing-action', status: 'warn', category: 'missing-navigation-action', label: 'CTA', actionClassification: 'actionable-warning', hrefState: 'missing-href', technicalTerm: 'href 누락' })

  assert.equal(review.displayStatus, '검토 필요')
  assert.equal(review.classificationReason.includes('문제 확인'), false)
  assert.equal(problem.displayStatus, '문제 확인')
  assert.equal(problem.classificationReason.includes('문제 확인'), true)
  assert.equal(navigation.displayStatus, '정상')
  assert.equal(navigation.meaning.includes('URL 이동'), true)
  assert.equal(missing.displayStatus, '검토 필요')
  assert.equal(missing.meaning.includes('충분히 명확하지 않았습니다'), true)
})

test('Landing explanation templates cover http errors weak content restrictions and normal page', () => {
  const cases = [
    { rowId: 'tech-landing-http', status: 'error', category: 'http-5xx', statusCode: 500, label: 'CTA', expect: 'HTTP 500', step: 'Network' },
    { rowId: 'tech-landing-browser-error', status: 'error', category: 'browser-error-page', statusCode: 200, label: 'CTA', expect: '화면 오류', step: 'Console' },
    { rowId: 'tech-landing-sparse', status: 'warn', category: 'needs-review', statusCode: 200, label: 'CTA', expect: '충분하지 않았습니다', step: '본문' },
    { rowId: 'tech-landing-restricted', status: 'warn', category: 'restricted', statusCode: 403, label: 'CTA', expect: '확인하지 못했습니다', step: '권한' },
    { rowId: 'tech-landing-ok', status: 'ok', category: 'landing-ok', statusCode: 200, label: 'CTA', expect: '기본 콘텐츠', step: '최종 랜딩 URL' },
  ]

  cases.forEach((item) => {
    const detail = createTechQaDetailViewModel(item)
    assertExplanation(detail)
    assert.equal(`${detail.meaning} ${detail.classificationReason}`.includes(item.expect), true)
    assert.equal(detail.verifySteps.some((step) => step.includes(item.step)), true)
  })
})

test('Interaction explanation templates cover form hover modal scroll download cookie and image', () => {
  const cases = [
    { rowId: 'tech-form-email', status: 'error', category: 'submit-not-blocked', label: 'Email', expect: '제출', step: 'POST' },
    { rowId: 'tech-hover-menu', status: 'warn', category: 'no-change', label: 'Menu', expect: '마우스', step: '마우스' },
    { rowId: 'tech-modal-open', status: 'warn', category: 'accessibility-review', label: 'Open modal', expect: 'ESC', step: 'ESC' },
    { rowId: 'tech-scroll-bottom', status: 'warn', category: 'height-growth', label: 'Page scroll', expect: '하단', step: '스크롤' },
    { rowId: 'tech-download-pdf', status: 'error', category: 'mime-mismatch', label: 'PDF', expect: '파일 형식', step: 'Content-Type' },
    { rowId: 'tech-cookie-sid', status: 'warn', category: 'httponly-review', label: 'session_token', expect: 'HttpOnly', step: 'Application' },
    { rowId: 'tech-image-hero', status: 'warn', category: 'aspect-ratio', label: 'hero.webp', expect: '이미지', step: 'natural size' },
  ]

  cases.forEach((item) => {
    const detail = createTechQaDetailViewModel(item)
    assertExplanation(detail)
    assert.equal(`${detail.meaning} ${detail.commonCauses.join(' ')}`.includes(item.expect), true)
    assert.equal(detail.verifySteps.some((step) => step.includes(item.step)), true)
  })
})

test('Responsive Performance SEO and Markup explanations use audit-specific verification paths', () => {
  const cases = [
    { rowId: 'tech-responsive-mobile', status: 'error', category: 'viewport', label: 'Mobile', type: '390x844', expectStep: 'viewport', expectText: '가로 스크롤' },
    { rowId: 'tech-performance-large', status: 'warn', category: 'large-resource', label: 'large.js', expectStep: 'Network', expectText: '큰 용량' },
    { rowId: 'tech-performance-compression', status: 'warn', category: 'compression', label: 'app.js', expectStep: 'Encoding', expectText: '압축' },
    { rowId: 'tech-performance-failed', status: 'error', category: 'failed-resource', label: 'app.js', expectStep: 'Status', expectText: '실패 응답' },
    { rowId: 'tech-seo-canonical', status: 'warn', category: 'canonical', label: 'Canonical', expectStep: 'canonical', expectText: 'canonical' },
    { rowId: 'tech-seo-jsonld', status: 'error', category: 'structured-data', label: 'JSON-LD', expectStep: 'application/ld+json', expectText: 'JSON-LD' },
    { rowId: 'tech-markup-alt', id: 'image-alt', status: 'warn', label: '이미지 alt', expectStep: 'img', expectText: '대체 텍스트' },
    { rowId: 'tech-markup-rel', id: 'external-links', status: 'warn', label: '새 창 외부 링크', expectStep: 'rel', expectText: 'rel 보안' },
    { rowId: 'tech-markup-heading', id: 'headings', status: 'warn', label: 'Heading', expectStep: 'heading', expectText: 'heading 구조' },
    { rowId: 'tech-markup-form', id: 'forms', status: 'warn', label: 'Form label', expectStep: 'label', expectText: 'label' },
  ]

  cases.forEach((item) => {
    const detail = createTechQaDetailViewModel(item)
    assertExplanation(detail)
    assert.equal(`${detail.meaning} ${detail.commonCauses.join(' ')}`.includes(item.expectText), true)
    assert.equal(detail.verifySteps.some((step) => step.includes(item.expectStep)), true)
  })
})

test('Generic fallback is useful and does not force opening URLs in new tabs', () => {
  const item = { rowId: 'tech-unknown-row', status: 'warn', category: 'new-category', message: 'unexpected signal', value: '원본 결과 문구' }
  const detail = { ...item, ...createTechQaDetailViewModel(item) }

  assert.equal(detail.value, '원본 결과 문구')
  assertExplanation(detail)
  assert.equal(detail.meaning.includes('추가 확인'), true)
  assert.equal(detail.classificationReason.includes('unexpected signal'), true)
  assert.equal(detail.verifySteps.some((step) => step.includes('새 탭')), false)
})

test('Legacy history and device-shaped detail rows receive explanations at render view-model time', () => {
  const base = result({
    deviceResults: [
      { deviceId: 'desktop', status: 'success', result: result({ links: [link({ label: 'Desktop Missing', status: 'error', statusCode: 404, category: 'http-4xx' })] }) },
      { deviceId: 'mobile', status: 'success', result: result({ checks: [check({ id: 'seo-readiness', status: 'warn', items: [{ label: 'Canonical', category: 'canonical', status: 'warn' }] })] }) },
    ],
  })
  const desktopView = createTechQaViewModel(base.deviceResults[0].result)
  const mobileView = createTechQaViewModel(base.deviceResults[1].result)

  assertExplanation(createTechDetailRows(desktopView).linkRows[0])
  assertExplanation(createTechDetailRows(mobileView).seoRows[0])
})

function assertExplanation(detail) {
  assert.equal(typeof detail.meaning, 'string')
  assert.equal(detail.meaning.length > 0, true)
  assert.equal(Array.isArray(detail.commonCauses), true)
  assert.equal(typeof detail.classificationReason, 'string')
  assert.equal(detail.classificationReason.length > 0, true)
  assert.equal(Array.isArray(detail.verifySteps), true)
  assert.equal(detail.verifySteps.length > 0, true)
  assert.equal(Array.isArray(detail.decisionGuide), true)
  assert.equal(detail.decisionGuide.length > 0, true)
  assert.equal(Array.isArray(detail.technicalEvidence), true)
}

test('Tech QA phase 2 does not change API payload scan options visual QA or progress contracts', () => {
  const panelSource = fs.readFileSync('src/components/TechQaPanel.jsx', 'utf8')
  const viewSource = fs.readFileSync('src/utils/techQaPanelView.js', 'utf8')
  const appSource = fs.readFileSync('src/App.jsx', 'utf8')
  const streamSource = fs.readFileSync('src/utils/qaRunStream.js', 'utf8')
  const scanOptionsSource = fs.readFileSync('shared/techScanOptions.js', 'utf8')

  assert.equal(panelSource.includes('/api/qa/run'), false)
  assert.equal(viewSource.includes('/api/qa/run'), false)
  assert.equal(appSource.includes('<VisualQaPanel'), true)
  assert.equal(appSource.includes("fetch('/api/qa/run'"), true)
  assert.equal(streamSource.includes("fetchFn('/api/qa/run-stream'"), true)
  assert.equal(scanOptionsSource.includes('TECH_SCAN_OPTION_DEFINITIONS'), true)
  assert.equal(scanOptionsSource.includes('finding'), false)
  assert.equal(scanOptionsSource.includes('recommendation'), false)
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
