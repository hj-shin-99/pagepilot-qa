import test from 'node:test'
import assert from 'node:assert/strict'
import { applySafeClickResult, classifyClickableCandidate, summarizeClickActionAudit } from './techClickAudit.js'

test('A normal anchor is valid-url and ok', () => {
  const item = classifyClickableCandidate(candidate({ tagName: 'a', href: '/product', url: 'https://example.com/product', label: 'Product' }))
  assert.equal(item.hrefState, 'valid-url')
  assert.equal(item.status, 'ok')
})

test('B role button CTA without href is ambiguous action for UID follow-up', () => {
  const item = classifyClickableCandidate(candidate({ tagName: 'div', role: 'button', className: 'primary-cta', label: 'Product' }))
  assert.equal(item.hrefState, 'missing-href')
  assert.equal(item.category, 'ambiguous-action')
  assert.equal(item.status, 'warn')
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
})

test('E pointer-events none CTA is not interactable', () => {
  const item = classifyClickableCandidate(candidate({ tagName: 'a', href: '/product', url: 'https://example.com/product', pointerEvents: 'none', label: 'Product' }))
  assert.equal(item.category, 'covered-or-not-interactable')
  assert.equal(item.status, 'error')
})

test('F overlay covered CTA is covered-or-not-interactable', () => {
  const item = classifyClickableCandidate(candidate({ tagName: 'a', href: '/product', url: 'https://example.com/product', hitTargetSame: false, label: 'Product' }))
  assert.equal(item.category, 'covered-or-not-interactable')
  assert.equal(item.status, 'error')
})

test('G safe click with observable dialog or DOM change becomes ok', () => {
  const item = classifyClickableCandidate(candidate({ tagName: 'button', label: 'Open details', hasOnClick: true }))
  const checked = applySafeClickResult(item, { clicked: true, changed: true, after: { dialogVisible: true } })
  assert.equal(checked.category, 'observable-action')
  assert.equal(checked.status, 'ok')
})

test('H safe click with no observable change becomes no-observable-action', () => {
  const item = classifyClickableCandidate(candidate({ tagName: 'button', label: 'Custom action', hasOnClick: true }))
  const checked = applySafeClickResult(item, { clicked: true, changed: false })
  assert.equal(checked.category, 'no-observable-action')
  assert.equal(checked.status, 'error')
})

test('I dangerous action skips actual click and is not hard error', () => {
  const item = classifyClickableCandidate(candidate({ tagName: 'button', label: 'Delete item', hasOnClick: true }))
  assert.equal(item.category, 'skipped-safe-click')
  assert.equal(item.status, 'warn')
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
