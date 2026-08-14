import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { chromium } from 'playwright'
import { auditLandingPages, classifyLandingObservation, createLandingAuditCandidates, LANDING_AUDIT_TEST_ONLY, mergeLandingAuditResults, normalizeLandingAuditItem } from './techLandingAudit.js'

test('landing audit dedupes navigation and new-window targets by requested URL', () => {
  const candidates = createLandingAuditCandidates([
    clickItem({ interactionOutcome: 'navigation', landingUrl: 'https://example.com/a', label: 'A1' }),
    clickItem({ interactionOutcome: 'navigation', landingUrl: 'https://example.com/a#hash', label: 'A2' }),
    clickItem({ interactionOutcome: 'new-window', landingUrl: 'https://example.com/b', label: 'B1' }),
    clickItem({ interactionOutcome: 'modal', landingUrl: 'https://example.com/c', label: 'C1' }),
  ], 'https://example.com')

  assert.equal(candidates.length, 2)
  assert.equal(candidates[0].sourceCount, 2)
  assert.equal(candidates[1].openedInNewWindow, true)
})

test('landing audit classifies normal page as ok', () => {
  const item = normalizeLandingAuditItem(candidate('https://example.com/ok'), {
    finalUrl: 'https://example.com/ok',
    statusCode: 200,
    pageTitle: 'Landing',
    bodyChildCount: 4,
    visibleElementCount: 8,
    bodyTextLength: 160,
    hasMainContent: true,
    hasMedia: false,
    browserErrorPage: false,
    consoleErrorCount: 0,
    pageErrorCount: 0,
    loadWarning: '',
    navigationError: '',
  })

  assert.equal(item.status, 'ok')
  assert.equal(item.category, 'landing-ok')
})

test('landing audit allows POST API content needed for initial render', async () => {
  const server = http.createServer((request, response) => {
    if (request.url === '/landing') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      response.end(`<!doctype html><html><head><title>POST Landing</title></head><body><div id="root"></div><script>
        fetch('/api/content', { method: 'POST' })
          .then((response) => response.json())
          .then((data) => { document.getElementById('root').innerHTML = '<main><h1>' + data.title + '</h1><p>' + data.copy + '</p></main>' })
      </script></body></html>`)
      return
    }
    if (request.url === '/api/content' && request.method === 'POST') {
      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
      response.end(JSON.stringify({ title: 'Loaded Landing', copy: 'Content rendered from a POST API response.' }))
      return
    }
    response.writeHead(404)
    response.end('not found')
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const browser = await chromium.launch({ headless: true })
  const url = `http://127.0.0.1:${server.address().port}/landing`

  try {
    const result = await auditLandingPages(browser, url, [clickItem({ landingUrl: url })])
    assert.equal(result.items.length, 1)
    assert.notEqual(result.items[0].status, 'error')
    assert.notEqual(result.items[0].category, 'blank-screen')
    assert.equal(result.items[0].bodyTextLength > 10, true)
  } finally {
    await browser.close()
    await new Promise((resolve) => server.close(resolve))
  }
})

test('landing audit classifies 4xx and 5xx as error', () => {
  const four = classifyLandingObservation({ statusCode: 404, pageTitle: '404', bodyChildCount: 2, visibleElementCount: 2, bodyTextLength: 40 }, candidate('https://example.com/404'))
  const five = classifyLandingObservation({ statusCode: 500, pageTitle: '500', bodyChildCount: 2, visibleElementCount: 2, bodyTextLength: 40 }, candidate('https://example.com/500'))

  assert.equal(four.status, 'error')
  assert.equal(four.category, 'http-4xx')
  assert.equal(five.status, 'error')
  assert.equal(five.category, 'http-5xx')
})

test('landing audit keeps successful redirect as ok when final page is healthy', () => {
  const item = normalizeLandingAuditItem(candidate('https://example.com/start'), {
    finalUrl: 'https://example.com/final',
    statusCode: 200,
    pageTitle: 'Landing',
    bodyChildCount: 3,
    visibleElementCount: 3,
    bodyTextLength: 60,
    hasMainContent: true,
    hasMedia: false,
    browserErrorPage: false,
    consoleErrorCount: 0,
    pageErrorCount: 0,
    criticalConsoleErrorCount: 0,
    advisoryConsoleErrorCount: 0,
    thirdPartyConsoleErrorCount: 0,
    unexpectedRedirect: false,
    loadWarning: '',
    navigationError: '',
  })

  assert.equal(item.redirected, true)
  assert.equal(item.status, 'ok')
  assert.equal(item.category, 'landing-redirect-ok')
})

test('landing audit keeps healthy 200 page with third-party console errors as ok', () => {
  const item = normalizeLandingAuditItem(candidate('https://example.com/final'), {
    finalUrl: 'https://example.com/final',
    statusCode: 200,
    pageTitle: 'Landing',
    bodyChildCount: 4,
    visibleElementCount: 6,
    bodyTextLength: 120,
    hasMainContent: true,
    hasMedia: true,
    browserErrorPage: false,
    consoleErrorCount: 2,
    pageErrorCount: 0,
    criticalConsoleErrorCount: 0,
    advisoryConsoleErrorCount: 2,
    thirdPartyConsoleErrorCount: 2,
    unexpectedRedirect: false,
    loadWarning: '',
    navigationError: '',
  })

  assert.equal(item.status, 'ok')
})

test('landing audit treats titleless page as warn', () => {
  const item = normalizeLandingAuditItem(candidate('https://example.com/final'), {
    finalUrl: 'https://example.com/final',
    statusCode: 200,
    pageTitle: '',
    bodyChildCount: 3,
    visibleElementCount: 3,
    bodyTextLength: 60,
    hasMainContent: true,
    hasMedia: false,
    browserErrorPage: false,
    consoleErrorCount: 0,
    pageErrorCount: 0,
    criticalConsoleErrorCount: 0,
    advisoryConsoleErrorCount: 0,
    thirdPartyConsoleErrorCount: 0,
    unexpectedRedirect: false,
    loadWarning: '',
    navigationError: '',
  })

  assert.equal(item.status, 'warn')
  assert.equal(item.category, 'missing-title')
})

test('landing audit treats weak content as warn', () => {
  const result = classifyLandingObservation({
    statusCode: 200,
    pageTitle: 'Sparse',
    bodyChildCount: 2,
    visibleElementCount: 1,
    bodyTextLength: 8,
    hasMainContent: false,
    hasMedia: false,
    browserErrorPage: false,
  }, candidate('https://example.com/sparse'))

  assert.equal(result.status, 'warn')
  assert.equal(result.category, 'needs-review')
})

test('landing audit treats blank screen candidate as error', () => {
  const result = classifyLandingObservation({
    statusCode: 200,
    pageTitle: 'Blank',
    bodyChildCount: 0,
    visibleElementCount: 0,
    bodyTextLength: 0,
    hasMainContent: false,
    hasMedia: false,
    browserErrorPage: false,
  }, candidate('https://example.com/blank'))

  assert.equal(result.status, 'error')
  assert.equal(result.category, 'blank-screen')
})

test('landing audit treats timeout and access restriction as warn', () => {
  const timeout = classifyLandingObservation({ navigationError: 'Timeout 12000ms exceeded', bodyChildCount: 2, visibleElementCount: 2, bodyTextLength: 40, hasMainContent: true }, candidate('https://example.com/slow'))
  const restricted = classifyLandingObservation({ navigationError: 'Access denied by security policy', statusCode: 403 }, candidate('https://example.com/secure'))

  assert.equal(timeout.status, 'warn')
  assert.equal(timeout.category, 'timeout')
  assert.equal(restricted.status, 'warn')
  assert.equal(restricted.category, 'restricted')
})

test('landing audit keeps healthy 200 page ok when only load timeout is observed', () => {
  const result = classifyLandingObservation({
    requestedUrl: 'https://example.com/ok',
    finalUrl: 'https://example.com/ok',
    statusCode: 200,
    pageTitle: 'Landing page',
    navigationError: 'page.waitForLoadState Timeout 4000ms exceeded',
    bodyChildCount: 4,
    visibleElementCount: 8,
    bodyTextLength: 160,
    hasMainContent: true,
    browserErrorPage: false,
    criticalConsoleErrorCount: 0,
  }, candidate('https://example.com/ok'))

  assert.equal(result.status, 'ok')
  assert.equal(result.category, 'landing-ok')
})

test('landing audit treats metrics read failure as review instead of blank screen', () => {
  const result = classifyLandingObservation({
    requestedUrl: 'https://example.com/metrics-failed',
    finalUrl: 'https://example.com/metrics-failed',
    statusCode: 200,
    pageTitle: 'Landing shell',
    loadWarning: 'page.waitForLoadState: Timeout 4000ms exceeded. "load" event fired',
    bodyChildCount: 0,
    visibleElementCount: 0,
    bodyTextLength: 0,
    hasMainContent: false,
    hasMedia: false,
    browserErrorPage: false,
    metricsReadFailed: true,
  }, candidate('https://example.com/metrics-failed'))

  assert.equal(result.status, 'warn')
  assert.equal(result.category, 'timeout')
})

test('landing audit keeps critical script error stronger than metrics read failure', () => {
  const result = classifyLandingObservation({
    requestedUrl: 'https://example.com/metrics-failed-critical',
    finalUrl: 'https://example.com/metrics-failed-critical',
    statusCode: 200,
    pageTitle: 'Landing shell',
    loadWarning: 'page.waitForLoadState: Timeout 4000ms exceeded. "load" event fired',
    bodyChildCount: 0,
    visibleElementCount: 0,
    bodyTextLength: 0,
    hasMainContent: false,
    hasMedia: false,
    browserErrorPage: false,
    metricsReadFailed: true,
    criticalConsoleErrorCount: 1,
  }, candidate('https://example.com/metrics-failed-critical'))

  assert.equal(result.status, 'error')
  assert.equal(result.category, 'critical-script-error')
})

test('landing audit keeps load warning with usable 200 content out of blank screen', () => {
  const result = classifyLandingObservation({
    requestedUrl: 'https://example.com/slow-network',
    finalUrl: 'https://example.com/slow-network',
    statusCode: 200,
    pageTitle: 'Slow network landing',
    loadWarning: 'page.waitForLoadState: Timeout 4000ms exceeded. "load" event fired',
    bodyChildCount: 4,
    visibleElementCount: 8,
    bodyTextLength: 160,
    hasMainContent: true,
    hasMedia: false,
    browserErrorPage: false,
    criticalConsoleErrorCount: 0,
  }, candidate('https://example.com/slow-network'))

  assert.equal(result.status, 'ok')
  assert.equal(result.category, 'landing-ok')
})

test('landing audit treats browser error page and critical page error as error', () => {
  const browserError = classifyLandingObservation({
    statusCode: 200,
    pageTitle: 'Error',
    bodyChildCount: 2,
    visibleElementCount: 2,
    bodyTextLength: 20,
    hasMainContent: true,
    browserErrorPage: true,
  }, candidate('https://example.com/browser-error'))
  const critical = classifyLandingObservation({
    statusCode: 200,
    pageTitle: 'Broken app',
    bodyChildCount: 3,
    visibleElementCount: 5,
    bodyTextLength: 80,
    hasMainContent: true,
    browserErrorPage: false,
    criticalConsoleErrorCount: 1,
  }, candidate('https://example.com/broken'))

  assert.equal(browserError.status, 'error')
  assert.equal(browserError.category, 'browser-error-page')
  assert.equal(critical.status, 'error')
  assert.equal(critical.category, 'critical-script-error')
})

test('landing browser-error detector keeps real browser error signatures', () => {
  assert.equal(LANDING_AUDIT_TEST_ONLY.isBrowserErrorPageSignature({
    title: 'This site can’t be reached',
    firstHeading: 'This site can’t be reached',
    bodyText: 'ERR_NAME_NOT_RESOLVED',
    browserErrorDom: true,
    visibleElementCount: 2,
  }), true)
  assert.equal(classifyLandingObservation({
    statusCode: 200,
    pageTitle: 'This site can’t be reached',
    bodyChildCount: 1,
    visibleElementCount: 2,
    bodyTextLength: 80,
    hasMainContent: false,
    browserErrorPage: true,
  }, candidate('https://example.com/browser-error')).category, 'browser-error-page')
})

test('landing browser-error detector does not flag healthy 200 content for generic error keywords', () => {
  const bodyText = 'Documentation includes examples for 404 responses, 500 responses, not found messages, and forbidden access states while the article content is otherwise healthy.'
  assert.equal(LANDING_AUDIT_TEST_ONLY.isBrowserErrorPageSignature({
    title: 'HTTP status guide',
    firstHeading: 'Handling responses',
    bodyText,
    browserErrorDom: false,
    visibleElementCount: 12,
  }), false)
  const result = classifyLandingObservation({
    requestedUrl: 'https://example.com/status-guide',
    finalUrl: 'https://example.com/status-guide',
    statusCode: 200,
    pageTitle: 'HTTP status guide',
    bodyChildCount: 8,
    visibleElementCount: 12,
    bodyTextLength: bodyText.length,
    hasMainContent: true,
    hasMedia: false,
    browserErrorPage: false,
    criticalConsoleErrorCount: 0,
  }, candidate('https://example.com/status-guide'))

  assert.equal(result.status, 'ok')
  assert.notEqual(result.category, 'browser-error-page')
})

test('landing blank or critical rendering failure policy is preserved for HTTP 200', () => {
  const blank = classifyLandingObservation({
    statusCode: 200,
    pageTitle: 'Blank',
    bodyChildCount: 0,
    visibleElementCount: 0,
    bodyTextLength: 0,
    hasMainContent: false,
    hasMedia: false,
    browserErrorPage: false,
  }, candidate('https://example.com/blank'))

  assert.equal(blank.status, 'error')
  assert.equal(blank.category, 'blank-screen')
})

test('landing audit treats unexpected final domain redirect as warn', () => {
  const item = normalizeLandingAuditItem(candidate('https://example.com/start'), {
    finalUrl: 'https://unexpected.example/final',
    statusCode: 200,
    pageTitle: 'Landing',
    bodyChildCount: 4,
    visibleElementCount: 4,
    bodyTextLength: 60,
    hasMainContent: true,
    hasMedia: false,
    browserErrorPage: false,
    unexpectedRedirect: true,
  })

  assert.equal(item.status, 'warn')
  assert.equal(item.category, 'unexpected-redirect-destination')
})

test('landing audit merges duplicate final URLs after redirect', () => {
  const merged = mergeLandingAuditResults([
    normalizeLandingAuditItem(candidate('https://example.com/a', 'one'), { finalUrl: 'https://example.com/final', statusCode: 200, pageTitle: 'Final', bodyChildCount: 2, visibleElementCount: 3, bodyTextLength: 30, hasMainContent: true }),
    normalizeLandingAuditItem(candidate('https://example.com/b', 'two'), { finalUrl: 'https://example.com/final', statusCode: 200, pageTitle: 'Final', bodyChildCount: 2, visibleElementCount: 3, bodyTextLength: 30, hasMainContent: true }),
  ])

  assert.equal(merged.length, 1)
  assert.equal(merged[0].sourceCount, 2)
})

function clickItem(overrides = {}) {
  return {
    auditId: 'click-1',
    label: 'CTA',
    selector: '#cta',
    section: 'hero',
    interactionOutcome: 'navigation',
    landingUrl: 'https://example.com/landing',
    ...overrides,
  }
}

function candidate(requestedUrl, label = 'CTA') {
  return {
    auditId: `landing-${label}`,
    requestedUrl,
    openedInNewWindow: false,
    sourceCount: 1,
    sources: [{ label, selector: '#cta', section: 'hero', interactionOutcome: 'navigation', requestedUrl }],
  }
}
