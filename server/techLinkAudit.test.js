import test from 'node:test'
import assert from 'node:assert/strict'
import { createCheckedLinkFailure, createTechLinkAudit, mergeTechLinkAuditResults, normalizeCheckedLinkResult } from './techLinkAudit.js'

test('Tech link audit includes normal internal links and dedupes duplicate request URLs', () => {
  const targets = [
    anchor({ label: 'One', href: '/one' }),
    anchor({ label: 'One duplicate', href: '/one#section' }),
    anchor({ label: 'Two', href: '/two' }),
  ]

  const audit = createTechLinkAudit(targets, 'https://example.com/page')

  assert.equal(audit.meta.discoveredLinkCount, 3)
  assert.equal(audit.requestableLinks.length, 2)
  assert.equal(audit.meta.dedupedLinkCount, 1)
  assert.equal(audit.requestableLinks[0].sourceCount, 2)
})

test('Tech link audit classifies missing navigation CTA as error evidence', () => {
  const audit = createTechLinkAudit([button({ label: 'Apply now', href: '' })], 'https://example.com')
  const result = mergeTechLinkAuditResults(audit, [])

  assert.equal(audit.missingHrefLinks.length, 1)
  assert.equal(result.links[0].status, 'error')
  assert.equal(result.links[0].category, 'missing-navigation-url')
})

test('Tech link audit flags # and javascript navigation CTAs without treating UI controls as URL errors', () => {
  const audit = createTechLinkAudit([
    anchor({ label: 'More details', href: '#' }),
    anchor({ label: 'Apply now', href: 'javascript:void(0)' }),
    button({ label: 'Open modal', ariaControls: 'dialog-1' }),
    button({ label: 'Accordion toggle', ariaExpanded: 'false' }),
  ], 'https://example.com/page')
  const result = mergeTechLinkAuditResults(audit, [])

  assert.equal(result.links.filter((item) => item.status === 'warn').length, 2)
  assert.equal(result.links.filter((item) => item.category === 'url-not-required-ui-control').length, 2)
  assert.equal(audit.missingHrefLinks.length, 0)
  assert.equal(audit.uiControlsWithoutUrl.length, 2)
})

test('Tech link audit preserves redirect final URL and timeout as priority error', () => {
  const audit = createTechLinkAudit([
    anchor({ label: 'Redirect', href: '/redirect' }),
    anchor({ label: 'Slow', href: '/slow' }),
  ], 'https://example.com')
  const checked = [
    normalizeCheckedLinkResult(audit.requestableLinks[0], { statusCode: 200, finalUrl: 'https://example.com/final' }),
    createCheckedLinkFailure(audit.requestableLinks[1], new Error('Request timed out after 7000ms')),
  ]
  const result = mergeTechLinkAuditResults(audit, checked)

  assert.equal(result.meta.actualHttpRequestCount, 2)
  assert.equal(result.meta.redirectCount, 1)
  assert.equal(result.meta.timeoutCount, 1)
  assert.equal(result.links[0].category, 'timeout')
  assert.equal(result.links.find((item) => item.label === 'Redirect').finalUrl, 'https://example.com/final')
})

function anchor(overrides = {}) {
  return {
    kind: 'a',
    label: 'Link',
    text: 'Link',
    href: '/target',
    url: overrides.href?.startsWith('http') ? overrides.href : '',
    boundingBox: { width: 120, height: 32 },
    ...overrides,
  }
}

function button(overrides = {}) {
  return {
    kind: 'button',
    label: 'Button',
    text: 'Button',
    href: '',
    url: '',
    boundingBox: { width: 120, height: 32 },
    ...overrides,
  }
}
