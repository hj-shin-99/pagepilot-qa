import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { applySafeClickResult, classifyClickableCandidate, summarizeClickActionAudit } from './techClickAudit.js'

test('A normal anchor is valid-url and ok', () => {
  const item = classifyClickableCandidate(candidate({ tagName: 'a', href: '/product', url: 'https://example.com/product', label: 'Product' }))
  assert.equal(item.hrefState, 'valid-url')
  assert.equal(item.status, 'ok')
  assert.equal(item.actionClassification, 'verified-working')
  assert.equal(item.verificationMethod, 'valid-navigation-url')
  assert.equal(item.clickExecuted, false)
})

test('B role button CTA without href is ambiguous action for UID follow-up', () => {
  const item = classifyClickableCandidate(candidate({ tagName: 'div', role: 'button', className: 'primary-cta', label: 'Product' }))
  assert.equal(item.hrefState, 'missing-href')
  assert.equal(item.category, 'missing-navigation-action')
  assert.equal(item.status, 'warn')
  assert.equal(item.actionClassification, 'actionable-warning')
})

test('C javascript pseudo CTA keeps actual href and technical term', () => {
  const item = classifyClickableCandidate(candidate({ tagName: 'a', href: 'javascript:void(0)', label: 'Product', hasOnClick: true }))
  assert.equal(item.hrefState, 'javascript-pseudo-url')
  assert.equal(item.technicalTerm, 'javascript:void(0)')
  assert.equal(item.href, 'javascript:void(0)')
  assert.equal(item.status, 'warn')
})

test('D modal button is UI-control-no-url-required and not URL error', () => {
  const item = classifyClickableCandidate(candidate({ tagName: 'button', ariaControls: 'modal', label: 'Detail' }))
  assert.equal(item.category, 'UI-control-no-url-required')
  assert.equal(item.status, 'ok')
  assert.equal(item.actionClassification, 'ui-control-no-url-required')
})

test('E pointer-events none CTA is not interactable', () => {
  const item = classifyClickableCandidate(candidate({ tagName: 'a', href: '/product', url: 'https://example.com/product', pointerEvents: 'none', label: 'Product' }))
  assert.equal(item.category, 'covered-or-not-interactable')
  assert.equal(item.status, 'error')
})

test('F overlay covered CTA is covered-or-not-interactable', () => {
  const item = classifyClickableCandidate(candidate({ tagName: 'a', href: '/product', url: 'https://example.com/product', hitTargetSame: false, hitTestStatus: 'hitTestFailed', label: 'Product' }))
  assert.equal(item.category, 'covered-or-not-interactable')
  assert.equal(item.status, 'error')
})

test('G safe click with observable dialog or DOM change becomes ok', () => {
  const item = classifyClickableCandidate(candidate({ tagName: 'button', label: 'Open details', hasOnClick: true }))
  const checked = applySafeClickResult(item, { clicked: true, changed: true, after: { dialogVisible: true } })
  assert.equal(checked.category, 'observable-action')
  assert.equal(checked.status, 'ok')
  assert.equal(checked.actionClassification, 'verified-working')
})

test('H safe click with no observable change becomes no-observable-action', () => {
  const item = classifyClickableCandidate(candidate({ tagName: 'button', label: 'Custom action', hasOnClick: true }))
  const checked = applySafeClickResult(item, { clicked: true, changed: false })
  assert.equal(checked.category, 'no-observable-action')
  assert.equal(checked.status, 'error')
  assert.equal(checked.actionClassification, 'actual-error')
})

test('I dangerous action skips actual click and is not hard error', () => {
  const item = classifyClickableCandidate(candidate({ tagName: 'button', label: 'Delete item', hasOnClick: true }))
  assert.equal(item.category, 'skipped-safe-click')
  assert.equal(item.status, 'ok')
  assert.equal(item.actionClassification, 'safe-click-skipped')
  assert.equal(item.safeClickSkippedReason, 'dangerous-action')
})

test('click action summary preserves all problem items and meta counts', () => {
  const items = [
    classifyClickableCandidate(candidate({ tagName: 'a', href: '/ok', url: 'https://example.com/ok' })),
    classifyClickableCandidate(candidate({ tagName: 'a', href: 'javascript:void(0)', hasOnClick: true })),
    classifyClickableCandidate(candidate({ tagName: 'a', href: '/blocked', url: 'https://example.com/blocked', pointerEvents: 'none' })),
  ]
  const summary = summarizeClickActionAudit(items, { safeClickAttemptCount: 1 })
  assert.equal(summary.status, 'error')
  assert.equal(summary.items.length, 2)
  assert.equal(summary.meta.candidateCount, 3)
  assert.equal(summary.meta.safeClickAttemptCount, 1)
  assert.equal(summary.meta.actualErrorCount, 1)
  assert.equal(summary.meta.actionableWarningCount, 1)
})

test('generic fixture separates five click classifications for counting', () => {
  const items = [
    classifyClickableCandidate(candidate({ auditId: 'pointer', tagName: 'a', href: '/product', url: 'https://example.com/product', pointerEvents: 'none', label: 'Product' })),
    classifyClickableCandidate(candidate({ auditId: 'overlay', tagName: 'a', href: '/covered', url: 'https://example.com/covered', hitTargetSame: false, hitTestStatus: 'hitTestFailed', label: 'Covered' })),
    ...Array.from({ length: 5 }, (_, index) => classifyClickableCandidate(candidate({ auditId: `skip-${index}`, tagName: 'button', label: `Delete ${index}`, hasOnClick: true }))),
    ...Array.from({ length: 8 }, (_, index) => classifyClickableCandidate(candidate({ auditId: `ui-${index}`, tagName: 'button', ariaControls: `panel-${index}`, label: `Accordion ${index}` }))),
    ...Array.from({ length: 3 }, (_, index) => applySafeClickResult(classifyClickableCandidate(candidate({ auditId: `verified-${index}`, tagName: 'button', label: `Custom ${index}`, hasOnClick: true })), { clicked: true, changed: true, after: { mutationCount: 1 } })),
    applySafeClickResult(classifyClickableCandidate(candidate({ auditId: 'no-change', tagName: 'button', label: 'Custom action', hasOnClick: true })), { clicked: true, changed: false }),
  ]
  const summary = summarizeClickActionAudit(items)

  assert.equal(summary.meta.actualErrorCount, 3)
  assert.equal(summary.meta.actionableWarningCount, 0)
  assert.equal(summary.meta.safeClickSkippedCount, 5)
  assert.equal(summary.meta.uiControlNoUrlRequiredCount, 8)
  assert.equal(summary.meta.verifiedWorkingCount, 3)
  assert.equal(summary.items.length, 3)
})

test('valid absolute href is verified without safe click', () => {
  const item = classifyClickableCandidate(candidate({ tagName: 'a', href: 'https://example.com/product', url: 'https://example.com/product', label: 'Product' }))

  assert.equal(item.actionClassification, 'verified-working')
  assert.equal(item.verificationMethod, 'valid-navigation-url')
  assert.equal(item.safeClickEligible, false)
  assert.equal(item.clickExecuted, false)
})

test('valid relative href is verified when resolved URL exists', () => {
  const item = classifyClickableCandidate(candidate({ tagName: 'a', href: '/product', url: 'https://example.com/product', label: 'Product' }))

  assert.equal(item.hrefState, 'valid-url')
  assert.equal(item.actionClassification, 'verified-working')
})

test('target blank href is verified without popup click', () => {
  const item = classifyClickableCandidate(candidate({ tagName: 'a', href: '/product', url: 'https://example.com/product', target: '_blank', label: 'Product' }))

  assert.equal(item.actionClassification, 'verified-working')
  assert.equal(item.clickExecuted, false)
})

test('normal href with hitTestNotRun is not actual error', () => {
  const item = classifyClickableCandidate(candidate({ tagName: 'a', href: '/product', url: 'https://example.com/product', hitTargetSame: false, hitTestStatus: 'hitTestNotRun', label: 'Product' }))

  assert.equal(item.hitTestStatus, 'hitTestNotRun')
  assert.equal(item.actionClassification, 'verified-working')
  assert.notEqual(item.category, 'no-observable-action')
})

test('legacy hitTargetSame false without explicit hitTestFailed is not actual error', () => {
  const item = classifyClickableCandidate(candidate({ tagName: 'a', href: '/product', url: 'https://example.com/product', hitTargetSame: false, label: 'Product' }))

  assert.equal(item.hitTestStatus, 'hitTestNotRun')
  assert.equal(item.actionClassification, 'verified-working')
})

test('pointer-events none with valid href remains actual error', () => {
  const item = classifyClickableCandidate(candidate({ tagName: 'a', href: '/product', url: 'https://example.com/product', pointerEvents: 'none', label: 'Product' }))

  assert.equal(item.actionClassification, 'actual-error')
})

test('hash-only href is actionable warning, not actual error', () => {
  const item = classifyClickableCandidate(candidate({ tagName: 'a', href: '#', url: '', label: 'Product' }))

  assert.equal(item.hrefState, 'hash-only')
  assert.equal(item.actionClassification, 'actionable-warning')
})

test('javascript pseudo URL is actionable warning, not actual error', () => {
  const item = classifyClickableCandidate(candidate({ tagName: 'a', href: 'javascript:void(0)', url: '', label: 'Product', hasOnClick: true }))

  assert.equal(item.hrefState, 'javascript-pseudo-url')
  assert.equal(item.actionClassification, 'actionable-warning')
})

test('safe click result records executed and observable states', () => {
  const base = classifyClickableCandidate(candidate({ tagName: 'button', label: 'Open details', hasOnClick: true }))
  const changed = applySafeClickResult(base, { clicked: true, changed: true, after: { mutationCount: 1 } })
  const unchanged = applySafeClickResult(base, { clicked: true, changed: false })
  const failed = applySafeClickResult(base, { clicked: false, changed: false, error: 'not clickable' })

  assert.equal(changed.actionClassification, 'verified-working')
  assert.equal(changed.clickExecuted, true)
  assert.equal(changed.observableChange, true)
  assert.equal(unchanged.actionClassification, 'actual-error')
  assert.equal(unchanged.clickExecuted, true)
  assert.equal(unchanged.observableChange, false)
  assert.equal(failed.actionClassification, 'actionable-warning')
  assert.equal(failed.clickExecuted, false)
})

test('bulk normal href regression does not inflate actual errors', () => {
  const items = [
    ...Array.from({ length: 50 }, (_, index) => classifyClickableCandidate(candidate({ auditId: `ok-${index}`, tagName: 'a', href: `/product-${index}`, url: `https://example.com/product-${index}`, label: `Product ${index}`, hitTargetSame: false, hitTestStatus: 'hitTestNotRun' }))),
    ...Array.from({ length: 2 }, (_, index) => classifyClickableCandidate(candidate({ auditId: `blocked-${index}`, tagName: 'a', href: `/blocked-${index}`, url: `https://example.com/blocked-${index}`, pointerEvents: 'none', label: `Blocked ${index}` }))),
    ...Array.from({ length: 3 }, (_, index) => classifyClickableCandidate(candidate({ auditId: `pseudo-${index}`, tagName: 'a', href: 'javascript:void(0)', label: `Pseudo ${index}`, hasOnClick: true }))),
  ]
  const summary = summarizeClickActionAudit(items)

  assert.equal(summary.meta.verifiedWorkingCount, 50)
  assert.equal(summary.meta.actualErrorCount, 2)
  assert.equal(summary.meta.actionableWarningCount, 3)
})

test('modal close control is URL-free UI control', () => {
  const item = classifyClickableCandidate(candidate({ tagName: 'button', label: 'Close', ariaLabel: 'Close', dataDismiss: 'modal', actionEvidence: 'data-dismiss' }))

  assert.equal(item.actionClassification, 'ui-control-no-url-required')
  assert.equal(item.status, 'ok')
  assert.equal(item.technicalTerm, 'UI 제어 동작')
  assert.notEqual(item.technicalTerm, 'href 누락')
})

test('carousel previous and next controls are URL-free UI controls', () => {
  const previous = classifyClickableCandidate(candidate({ tagName: 'button', label: 'Previous slide', ariaLabel: 'Previous slide', dataSlide: 'prev', actionEvidence: 'data-slide' }))
  const next = classifyClickableCandidate(candidate({ tagName: 'button', label: 'Next slide', ariaLabel: 'Next slide', dataSlide: 'next', actionEvidence: 'data-slide' }))

  assert.equal(previous.actionClassification, 'ui-control-no-url-required')
  assert.equal(next.actionClassification, 'ui-control-no-url-required')
})

test('menu toggle with aria controls is URL-free UI control', () => {
  const item = classifyClickableCandidate(candidate({ tagName: 'button', label: 'Menu', ariaExpanded: 'false', ariaControls: 'menu', actionEvidence: 'aria-controls, aria-expanded' }))

  assert.equal(item.actionClassification, 'ui-control-no-url-required')
})

test('search and sitemap toggles are URL-free UI controls without site-specific copy', () => {
  const search = classifyClickableCandidate(candidate({ tagName: 'button', label: 'Search menu', className: 'header-search-toggle' }))
  const sitemap = classifyClickableCandidate(candidate({ tagName: 'button', label: 'Open sitemap', className: 'site-map-toggle' }))

  assert.equal(search.actionClassification, 'ui-control-no-url-required')
  assert.equal(sitemap.actionClassification, 'ui-control-no-url-required')
})

test('generated Clickable label without action evidence is not actual error', () => {
  const item = classifyClickableCandidate(candidate({ label: 'Clickable 79', text: '', generatedLabel: true, className: 'clickable-looking', hitTestStatus: 'hitTestNotRun' }))

  assert.equal(item.actionClassification, 'actionable-warning')
  assert.notEqual(item.status, 'error')
})

test('unnamed role button with click evidence is actionable warning before safe click', () => {
  const item = classifyClickableCandidate(candidate({ tagName: 'div', role: 'button', label: 'Clickable 80', text: '', generatedLabel: true, hasOnClick: true, actionEvidence: 'onclick' }))

  assert.equal(item.actionClassification, 'actionable-warning')
  assert.equal(item.status, 'warn')
})

test('button with child span hit target is hit-test passed', () => {
  const item = classifyClickableCandidate(candidate({ tagName: 'button', label: 'Close', dataDismiss: 'modal', hitTestStatus: 'hitTestPassed', hitTargetTag: 'span', descendantMatch: true, hitTargetSame: true }))

  assert.equal(item.hitTestStatus, 'hitTestPassed')
  assert.equal(item.actionClassification, 'ui-control-no-url-required')
  assert.notEqual(item.status, 'error')
})

test('unrelated overlay remains actual error with overlay evidence', () => {
  const item = classifyClickableCandidate(candidate({ tagName: 'button', label: 'Open', hitTestStatus: 'hitTestFailed', unrelatedOverlay: true, overlaySelector: '#overlay', hitTargetSelector: '#overlay' }))

  assert.equal(item.actionClassification, 'actual-error')
  assert.equal(item.reason.includes('unrelated overlay'), true)
})

test('collapsed or hit-test unavailable UI control is not actual error', () => {
  const item = classifyClickableCandidate(candidate({ tagName: 'button', label: 'Next slide', dataSlide: 'next', hitTestStatus: 'hitTestUnavailable', viewportState: 'outsideViewport' }))

  assert.equal(item.actionClassification, 'ui-control-no-url-required')
  assert.notEqual(item.status, 'error')
})

test('safe click timeout without explicit failure is actionable warning', () => {
  const base = classifyClickableCandidate(candidate({ tagName: 'div', role: 'button', label: 'Open panel', hasOnClick: true, actionEvidence: 'onclick' }))
  const checked = applySafeClickResult(base, { clicked: false, changed: false, error: 'Timeout 2500ms exceeded' })

  assert.equal(checked.actionClassification, 'actionable-warning')
  assert.notEqual(checked.status, 'error')
})

test('clickable candidate source dedupes parent descendant actions generically', () => {
  const source = fs.readFileSync('server/index.js', 'utf8')

  assert.equal(source.includes('shouldSkipDescendantClickableCandidate'), true)
  assert.equal(source.includes('isPrimaryInteractiveElement'), true)
  assert.equal(source.includes('hasPrimaryInteractiveDescendant'), true)
  assert.equal(source.includes('generatedLabel'), true)
  assert.equal(source.includes('uiControlSemantic'), true)
  assert.equal(source.includes('shouldKeepVisualEvidenceCandidate'), true)
  assert.equal(source.includes('isPlainTextContainer'), true)
  assert.equal(source.includes('[data-action]'), true)
})

test('one anchor with text descendants stays one verified action in classification summary', () => {
  const items = [classifyClickableCandidate(candidate({ tagName: 'a', href: '/product', url: 'https://example.com/product', label: 'Product title Description' }))]
  const summary = summarizeClickActionAudit(items)

  assert.equal(summary.meta.verifiedWorkingCount, 1)
  assert.equal(summary.meta.actualErrorCount, 0)
  assert.equal(summary.meta.actionableWarningCount, 0)
})

function candidate(overrides = {}) {
  return {
    auditId: 'candidate-1',
    tagName: 'button',
    kind: 'button',
    label: 'Button',
    text: 'Button',
    href: '',
    url: '',
    role: '',
    type: '',
    selector: '#button',
    domPath: 'main > button',
    section: 'main',
    pointerEvents: 'auto',
    hitTargetSame: true,
    boundingBox: { width: 120, height: 32 },
    ...overrides,
  }
}
