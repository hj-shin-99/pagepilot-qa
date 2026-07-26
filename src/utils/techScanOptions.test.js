import test from 'node:test'
import assert from 'node:assert/strict'
import { createTechQaViewModel } from './techQa.js'
import { areAllTechScanOptionsSelected, createDefaultTechScanOptions, normalizeStoredTechScanOptions, normalizeTechScanOptions } from '../../shared/techScanOptions.js'

test('tech scan options default to all selected and normalize invalid values safely', () => {
  assert.deepEqual(createDefaultTechScanOptions(), {
    url: true,
    click: true,
    landing: true,
    form: true,
    hover: true,
    modal: true,
    scroll: true,
    responsive: true,
    download: true,
    cookie: true,
    image: true,
    markup: true,
  })
  assert.deepEqual(normalizeTechScanOptions(null), createDefaultTechScanOptions())
  assert.deepEqual(normalizeTechScanOptions({ url: false, click: 'nope', unknown: false }), {
    url: false,
    click: true,
    landing: true,
    form: true,
    hover: true,
    modal: true,
    scroll: true,
    responsive: true,
    download: true,
    cookie: true,
    image: true,
    markup: true,
  })
  assert.equal(areAllTechScanOptionsSelected({ url: false }), false)
  assert.equal(areAllTechScanOptionsSelected(createDefaultTechScanOptions()), true)
})

test('stored tech scan options keep legacy history from showing newly added sections', () => {
  assert.deepEqual(normalizeStoredTechScanOptions(null, { checks: [{ id: 'links' }, { id: 'click-actions' }] }), {
    url: true,
    click: true,
    landing: true,
    form: true,
      hover: true,
      modal: true,
      scroll: false,
      responsive: false,
      download: false,
      cookie: false,
      image: false,
      markup: true,
    })

  assert.deepEqual(normalizeStoredTechScanOptions({ url: true, click: true, landing: true, form: true, hover: true, modal: true, markup: true }, {}), {
    url: true,
    click: true,
    landing: true,
    form: true,
      hover: true,
      modal: true,
      scroll: false,
      responsive: false,
      download: false,
      cookie: false,
      image: false,
      markup: true,
    })
})

test('tech qa view model excludes unselected option checks and counts while keeping common checks', () => {
  const view = createTechQaViewModel({
    targetUrl: 'https://example.com',
    pageTitle: 'Example',
    scanOptions: { url: false, click: false, landing: false, form: false, hover: false, modal: false, scroll: false, responsive: false, download: false, cookie: false, image: false, markup: false },
    checks: [
      { id: 'access', status: 'ok', title: '접속', value: '가능' },
      { id: 'links', status: 'warn', title: '링크 목록 수집', value: '2개' },
      { id: 'missing-href', status: 'error', title: '링크/버튼 URL 누락 여부', value: '1개', items: [{ selector: '#cta', status: 'error' }] },
      { id: 'meta', status: 'warn', title: '메타 정보 검사', value: '1개 확인 필요', items: [{ label: 'description', status: 'warn' }] },
      { id: 'click-actions', status: 'error', title: '클릭 동작 검사', items: [{ selector: '#cta', status: 'error', actionClassification: 'actual-error' }] },
      { id: 'network-failures', status: 'ok', title: '네트워크 실패 요청', value: '0건 확인 필요', items: [] },
    ],
    links: [{ label: 'Broken', url: 'https://example.com/broken', status: 'error', statusCode: 404, category: 'http-4xx' }],
    linkAudit: { discoveredLinkCount: 1 },
    clickActions: [{ selector: '#cta', status: 'error', actionClassification: 'actual-error' }],
  })

  assert.deepEqual(view.scanOptions, {
    url: false,
    click: false,
    landing: false,
    form: false,
    hover: false,
    modal: false,
    scroll: false,
    responsive: false,
    download: false,
    cookie: false,
    image: false,
    markup: false,
  })
  assert.equal(view.checkItems.some((item) => item.id === 'links'), false)
  assert.equal(view.checkItems.some((item) => item.id === 'meta'), false)
  assert.equal(view.checkItems.some((item) => item.id === 'click-actions'), false)
  assert.equal(view.links.length, 0)
  assert.equal(view.issueCounts.errorElementCount, 0)
  assert.equal(view.issueCounts.warningElementCount, 0)
  assert.equal(view.basicCheckItems.some((item) => item.id === 'access'), true)
  assert.equal(view.basicCheckItems.some((item) => item.id === 'network-failures'), true)
})

test('legacy results without stored options keep existing sections and hide new ones', () => {
  const view = createTechQaViewModel({
    targetUrl: 'https://example.com',
    pageTitle: 'Example',
    checks: [
      { id: 'links', status: 'ok', title: '링크 목록 수집', value: '1개', items: [] },
      { id: 'click-actions', status: 'ok', title: '클릭 동작 검사', value: '정상', items: [] },
    ],
    links: [{ label: 'Link', url: 'https://example.com/a', status: 'ok', statusCode: 200, category: 'http-ok' }],
  })

  assert.equal(view.scanOptions.url, true)
  assert.equal(view.scanOptions.click, true)
  assert.equal(view.scanOptions.scroll, false)
  assert.equal(view.scanOptions.responsive, false)
  assert.equal(view.scanOptions.download, false)
  assert.equal(view.scanOptions.cookie, false)
  assert.equal(view.scanOptions.image, false)
})
