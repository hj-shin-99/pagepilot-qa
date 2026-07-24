import test from 'node:test'
import assert from 'node:assert/strict'
import { classifyLandingObservation, createLandingAuditCandidates, mergeLandingAuditResults, normalizeLandingAuditItem } from './techLandingAudit.js'

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
