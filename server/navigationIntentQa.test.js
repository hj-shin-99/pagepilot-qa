import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { collectActualNavigationCandidates, evaluateNavigationIntentQa, matchExpectedUrl, normalizeNavigationReferenceMap } from './navigationIntentQa.js'

test('exact label plus same href is matched-correct', () => {
  const result = evaluateNavigationIntentQa(referenceMap([item('ref-1', 'Apply', '/apply')]), scanResult({ links: [link('Apply', 'https://example.com/apply')] }))

  assert.equal(result.summary.correct, 1)
  assert.equal(result.items[0].status, 'matched-correct')
})

test('alias match plus same href is matched-correct', () => {
  const result = evaluateNavigationIntentQa(referenceMap([item('ref-1', 'Apply now', '/apply', { aliases: ['Start'] })]), scanResult({ links: [link('Start', 'https://example.com/apply')] }))

  assert.equal(result.items[0].status, 'matched-correct')
  assert.equal(result.items[0].matchEvidence.includes('alias exact match'), true)
})

test('exact label plus wrong href is matched-mismatch only for unique clear match', () => {
  const result = evaluateNavigationIntentQa(referenceMap([item('ref-1', 'Apply', '/apply')]), scanResult({ links: [link('Apply', 'https://example.com/other')] }))

  assert.equal(result.summary.mismatch, 1)
  assert.equal(result.items[0].status, 'matched-mismatch')
})

test('short generic label with multiple candidates is ambiguous, not mismatch', () => {
  const result = evaluateNavigationIntentQa(referenceMap([item('ref-1', 'More', '/target')]), scanResult({ links: [link('More', 'https://example.com/a'), link('More', 'https://example.com/b')] }))

  assert.equal(result.items[0].status, 'ambiguous-match')
  assert.equal(result.summary.mismatch, 0)
})

test('same label with one expected target match stays review because URL is not an identity selector', () => {
  const result = evaluateNavigationIntentQa(referenceMap([item('ref-1', 'Products', '/cars')]), scanResult({ links: [link('Products', 'https://example.com/vans'), link('Products', 'https://example.com/cars')] }))

  assert.equal(result.items[0].status, 'ambiguous-match')
  assert.equal(result.summary.mismatch, 0)
})

test('no actual element becomes reference-not-observed', () => {
  const result = evaluateNavigationIntentQa(referenceMap([item('ref-1', 'Apply', '/apply')]), scanResult({ links: [] }))

  assert.equal(result.items[0].status, 'reference-not-observed')
  assert.equal(result.summary.notObserved, 1)
  assert.equal(result.summary.mismatch, 0)
})

test('matched actual element without target evidence is unavailable review', () => {
  const result = evaluateNavigationIntentQa(referenceMap([item('ref-1', 'Apply', '/apply')]), scanResult({ clickActions: [{ label: 'Apply', role: 'button' }] }))

  assert.equal(result.items[0].status, 'target-evidence-unavailable')
  assert.equal(result.summary.review, 1)
})

test('relative expected matches same-origin absolute actual', () => {
  assert.equal(matchExpectedUrl({ raw: '/apply' }, 'https://example.com/apply', { baseUrl: 'https://example.com/page' }), true)
  assert.equal(matchExpectedUrl({ raw: '/tools/calc' }, 'https://example.test/tools/calc', { baseUrl: 'https://example.test/page' }), true)
  assert.equal(matchExpectedUrl({ raw: '/tools/calc' }, 'https://example.test/tools/other', { baseUrl: 'https://example.test/page' }), false)
})

test('query exact match and mismatch are deterministic', () => {
  assert.equal(matchExpectedUrl({ raw: '/list?tab=1' }, 'https://example.com/list?tab=1', { baseUrl: 'https://example.com' }), true)
  assert.equal(matchExpectedUrl({ raw: '/list?tab=1' }, 'https://example.com/list?tab=2', { baseUrl: 'https://example.com' }), false)
  assert.equal(matchExpectedUrl({ raw: '/tools/calc?mode=lease' }, 'https://example.test/tools/calc', { baseUrl: 'https://example.test' }), false)
})

test('hash and trailing slash policy are respected', () => {
  assert.equal(matchExpectedUrl({ raw: '/guide#top' }, 'https://example.com/guide#top', { baseUrl: 'https://example.com' }), true)
  assert.equal(matchExpectedUrl({ raw: '/guide#top' }, 'https://example.com/guide#bottom', { baseUrl: 'https://example.com' }), false)
  assert.equal(matchExpectedUrl({ raw: '/guide/', allowTrailingSlashVariant: true }, 'https://example.com/guide', { baseUrl: 'https://example.com' }), true)
  assert.equal(matchExpectedUrl({ raw: '/guide/', allowTrailingSlashVariant: false }, 'https://example.com/guide', { baseUrl: 'https://example.com' }), false)
})

test('absolute expected URL keeps origin as meaningful evidence', () => {
  assert.equal(matchExpectedUrl({ raw: 'https://expected.example/tools/calc' }, 'https://example.test/tools/calc', { baseUrl: 'https://example.test' }), false)
  const result = evaluateNavigationIntentQa(referenceMap([item('ref-1', 'Calculator', 'https://expected.example/tools/calc')]), scanResult({ targetUrl: 'https://example.test/current', links: [link('Calculator', 'https://example.test/tools/calc')] }))

  assert.equal(result.items[0].status, 'matched-mismatch')
})

test('multiple expected URLs match when one actual target matches', () => {
  const result = evaluateNavigationIntentQa(referenceMap([item('ref-1', 'Notice', ['/notice', '/notice?type=all'])]), scanResult({ links: [link('Notice', 'https://example.com/notice?type=all')] }))

  assert.equal(result.items[0].status, 'matched-correct')
})

test('hierarchy atomic segment exact match can identify generic Reference labels when target matches', () => {
  const products = evaluateNavigationIntentQa(referenceMap([item('ref-1', 'Products / Calculator / Primary', '/tools/calc')]), scanResult({ targetUrl: 'https://example.test/current', links: [link('Calculator', 'https://example.test/tools/calc')] }))
  const services = evaluateNavigationIntentQa(referenceMap([item('ref-2', 'Services / Lease / Published', '/lease')]), scanResult({ targetUrl: 'https://example.test/current', links: [link('Lease', 'https://example.test/lease')] }))

  assert.equal(products.items[0].status, 'matched-correct')
  assert.equal(products.items[0].matchEvidence.includes('supporting atomic segment match'), true)
  assert.equal(services.items[0].status, 'matched-correct')
})

test('duplicate same identity with same target is equivalent duplicate and can be correct', () => {
  const result = evaluateNavigationIntentQa(referenceMap([item('ref-1', 'Calculator', '/tools/calc')]), scanResult({ targetUrl: 'https://example.test/current', links: [link('Calculator', 'https://example.test/tools/calc'), link('Calculator', 'https://example.test/tools/calc')] }))

  assert.equal(result.items[0].status, 'matched-correct')
  assert.equal(result.summary.correct, 1)
})

test('duplicate same identity with different targets stays review', () => {
  const result = evaluateNavigationIntentQa(referenceMap([item('ref-1', 'Calculator', '/tools/calc')]), scanResult({ targetUrl: 'https://example.test/current', links: [link('Calculator', 'https://example.test/tools/calc'), link('Calculator', 'https://example.test/tools/other')] }))

  assert.equal(result.items[0].status, 'ambiguous-match')
  assert.equal(result.summary.mismatch, 0)
})

test('depthPath atomic segment only with wrong actual URL does not create mismatch', () => {
  const result = evaluateNavigationIntentQa(referenceMap([item('ref-1', 'Primary Action', '/tools/calc', { depthPath: ['Products', 'Calculator'] })]), scanResult({ targetUrl: 'https://example.test/current', links: [link('Calculator', 'https://example.test/tools/other')] }))

  assert.equal(result.items[0].status, 'ambiguous-match')
  assert.equal(result.summary.mismatch, 0)
})

test('multiple hierarchy segments matching different actual targets stay review', () => {
  const result = evaluateNavigationIntentQa(referenceMap([item('ref-1', 'Products / Calculator / Primary', '/tools/calc')]), scanResult({ targetUrl: 'https://example.test/current', links: [link('Products', 'https://example.test/products'), link('Calculator', 'https://example.test/tools/calc')] }))

  assert.equal(result.items[0].status, 'ambiguous-match')
  assert.equal(result.summary.mismatch, 0)
})

test('short generic atomic segment match remains conservative review', () => {
  const result = evaluateNavigationIntentQa(referenceMap([item('ref-1', 'Menu / More / Primary', '/more')]), scanResult({ targetUrl: 'https://example.test/current', links: [link('More', 'https://example.test/more')] }))

  assert.equal(result.items[0].status, 'ambiguous-match')
  assert.equal(result.summary.mismatch, 0)
})

test('hierarchy atomic label match with wrong actual URL is review not mismatch', () => {
  const result = evaluateNavigationIntentQa(referenceMap([item('ref-1', 'Products / Calculator / Primary', '/tools/calc')]), scanResult({ targetUrl: 'https://example.test/current', links: [link('Calculator', 'https://example.test/tools/other')] }))

  assert.equal(result.items[0].status, 'ambiguous-match')
  assert.equal(result.summary.mismatch, 0)
})

test('exact identity match with wrong actual URL remains mismatch', () => {
  const result = evaluateNavigationIntentQa(referenceMap([item('ref-1', 'Calculator', '/tools/calc')]), scanResult({ targetUrl: 'https://example.test/current', links: [link('Calculator', 'https://example.test/tools/other')] }))

  assert.equal(result.items[0].status, 'matched-mismatch')
  assert.equal(result.summary.mismatch, 1)
})

test('hierarchy sibling wrong target plus expected target elsewhere is identity-unresolved not mismatch', () => {
  const result = evaluateNavigationIntentQa(referenceMap([item('ref-1', 'Advisor / Consultation / Smart Tool', '/tools/smart')]), scanResult({ targetUrl: 'https://example.test/current', links: [link('Consultation', 'https://example.test/consultation'), link('Estimate', 'https://example.test/tools/smart')] }))

  assert.equal(result.items[0].status, 'identity-unresolved')
  assert.equal(result.summary.mismatch, 0)
})

test('no identity but expected target observed becomes identity-unresolved review', () => {
  const result = evaluateNavigationIntentQa(referenceMap([item('ref-1', 'Unknown action', '/tools/calc')]), scanResult({ targetUrl: 'https://example.test/current', links: [link('Calculator', 'https://example.test/tools/calc')] }))

  assert.equal(result.items[0].status, 'identity-unresolved')
  assert.equal(result.summary.review, 1)
  assert.equal(result.summary.notObserved, 0)
})

test('no identity and no expected target remains not observed', () => {
  const result = evaluateNavigationIntentQa(referenceMap([item('ref-1', 'Unknown action', '/tools/calc')]), scanResult({ targetUrl: 'https://example.test/current', links: [link('Calculator', 'https://example.test/tools/other')] }))

  assert.equal(result.items[0].status, 'reference-not-observed')
  assert.equal(result.summary.notObserved, 1)
})

test('redirect policy allows or rejects final URL matching', () => {
  const allowed = evaluateNavigationIntentQa(referenceMap([item('ref-1', 'Start', [{ raw: '/new', allowRedirect: true }])]), scanResult({ landingPages: [landing('Start', 'https://example.com/old', 'https://example.com/new')] }))
  const blocked = evaluateNavigationIntentQa(referenceMap([item('ref-1', 'Start', [{ raw: '/new', allowRedirect: false }])]), scanResult({ landingPages: [landing('Start', 'https://example.com/old', 'https://example.com/new')] }))

  assert.equal(allowed.items[0].status, 'matched-correct')
  assert.equal(blocked.items[0].status, 'matched-mismatch')
})

test('pattern template matches dynamic path segment', () => {
  assert.equal(matchExpectedUrl({ raw: '/products/{productId}', matchMode: 'pattern', dynamicParameters: ['productId'] }, 'https://example.com/products/123', { baseUrl: 'https://example.com' }), true)
})

test('click navigation outcome, popup, and landing final evidence are reused', () => {
  assert.equal(evaluateNavigationIntentQa(referenceMap([item('ref-1', 'Click', '/next')]), scanResult({ clickActions: [{ label: 'Click', interactionOutcome: 'navigation', landingUrl: 'https://example.com/next' }] })).items[0].status, 'matched-correct')
  assert.equal(evaluateNavigationIntentQa(referenceMap([item('ref-2', 'Popup', '/popup')]), scanResult({ clickActions: [{ label: 'Popup', interactionOutcome: 'new-window', landingUrl: 'https://example.com/popup' }] })).items[0].status, 'matched-correct')
  assert.equal(evaluateNavigationIntentQa(referenceMap([item('ref-3', 'Landing', '/final')]), scanResult({ landingPages: [landing('Landing', 'https://example.com/final', 'https://example.com/final')] })).items[0].status, 'matched-correct')
})

test('conflicting target evidence is review instead of mismatch', () => {
  const result = evaluateNavigationIntentQa(referenceMap([item('ref-1', 'Apply', '/apply')]), scanResult({ clickActions: [{ label: 'Apply', url: 'https://example.com/apply', interactionOutcome: 'navigation', landingUrl: 'https://example.com/other' }] }))

  assert.equal(result.items[0].status, 'ambiguous-match')
  assert.equal(result.summary.mismatch, 0)
})

test('supporting-only identity with wrong external absolute target is review not mismatch', () => {
  const result = evaluateNavigationIntentQa(
    referenceMap([item('ref-1', 'Catalog / External / Primary', 'https://external-a.example/path')]),
    scanResult({ targetUrl: 'https://example.com/current', links: [link('External', 'https://external-b.example/path')] }),
  )

  assert.equal(result.items[0].status, 'ambiguous-match')
  assert.equal(result.summary.mismatch, 0)
})

test('supporting-only identity missing required query is review not hard correct', () => {
  const result = evaluateNavigationIntentQa(
    referenceMap([item('ref-1', 'Section / Notice / Primary', '/notice?type=a')]),
    scanResult({ links: [link('Notice', 'https://example.com/notice')] }),
  )

  assert.equal(result.items[0].status, 'ambiguous-match')
  assert.equal(result.summary.correct, 0)
})

test('query-specific actual id mismatch depends on identity strength', () => {
  const strong = evaluateNavigationIntentQa(referenceMap([item('ref-1', 'Article', '/article?id=100')]), scanResult({ links: [link('Article', 'https://example.com/article?id=200')] }))
  const supporting = evaluateNavigationIntentQa(referenceMap([item('ref-2', 'News / Article / Primary', '/article?id=100')]), scanResult({ links: [link('Article', 'https://example.com/article?id=200')] }))

  assert.equal(strong.items[0].status, 'matched-mismatch')
  assert.equal(supporting.items[0].status, 'ambiguous-match')
  assert.equal(supporting.summary.mismatch, 0)
})

test('detail page reference item without main page evidence is not observed', () => {
  const result = evaluateNavigationIntentQa(referenceMap([item('ref-1', 'Product Detail View', '/products/123')]), scanResult({ links: [link('Catalog', 'https://example.com/products')] }))

  assert.equal(result.items[0].status, 'reference-not-observed')
  assert.equal(result.summary.notObserved, 1)
})

test('malformed reference fails safe without throwing', () => {
  const normalized = normalizeNavigationReferenceMap({ schemaVersion: 'bad', items: [] })
  const result = evaluateNavigationIntentQa({ schemaVersion: 'bad', items: [] }, scanResult())

  assert.equal(normalized.available, false)
  assert.equal(result.meta.available, false)
  assert.equal(result.summary.review, 1)
})

test('pending and excluded items are filtered from validation', () => {
  const normalized = normalizeNavigationReferenceMap(referenceMap([
    item('ref-1', 'Confirmed', '/ok'),
    { ...item('ref-2', 'Pending', '/pending'), userDecision: { status: 'pending' } },
    { ...item('ref-3', 'Excluded', '/excluded'), userDecision: { status: 'excluded' } },
  ]))

  assert.deepEqual(normalized.items.map((entry) => entry.referenceId), ['ref-1'])
})

test('collecting actual candidates does not require another scan call', () => {
  const result = scanResult({ links: [link('Apply', 'https://example.com/apply')] })

  assert.equal(collectActualNavigationCandidates(result).length, 1)
})

test('intent evaluator source does not call OpenAI Playwright or scanUrl', () => {
  const source = fs.readFileSync('server/navigationIntentQa.js', 'utf8')

  assert.equal(/openai|aiReview|scanUrl|playwright|chromium/i.test(source), false)
})

function scanResult(overrides = {}) {
  return { targetUrl: 'https://example.com/current', deviceId: 'desktop', links: [], clickActions: [], landingPages: [], ...overrides }
}

function referenceMap(items) {
  return { schemaVersion: 'navigation-intent-reference-v1', sourceDocument: { fileName: 'reference.xlsx' }, items }
}

function item(referenceId, label, urls, options = {}) {
  const rawUrls = Array.isArray(urls) ? urls : [urls]
  return {
    referenceId,
    source: { sheetName: 'Reference', rowNumber: Number(referenceId.split('-')[1]) || 1, evidenceText: label },
    pageContext: { sectionHint: options.sectionHint || '', depthPath: options.depthPath || [] },
    element: { label, aliases: options.aliases || [], roleHint: options.roleHint || 'link', actionHint: 'navigation' },
    expected: { type: 'url', urls: rawUrls.map((entry) => typeof entry === 'string' ? { raw: entry, matchMode: 'path-and-query', allowSameOrigin: true, allowRedirect: false, allowTrailingSlashVariant: true, dynamicParameters: [] } : entry) },
    userDecision: options.userDecision || { status: 'confirmed', edited: false, excludedReason: '' },
  }
}

function link(label, url) {
  return { label, url, href: url, status: 'ok' }
}

function landing(label, requestedUrl, finalUrl) {
  return { label, requestedUrl, finalUrl, redirected: requestedUrl !== finalUrl, status: 'ok' }
}
