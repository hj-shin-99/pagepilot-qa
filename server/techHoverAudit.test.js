import test from 'node:test'
import assert from 'node:assert/strict'
import { classifyHoverObservation, dedupeHoverCandidates, HOVER_AUDIT_TEST_ONLY } from './techHoverAudit.js'

test('hover audit classifies submenu or dropdown reveal as ok', () => {
  const item = classifyHoverObservation(candidate({ kindHint: 'dropdown' }), { changed: true, restored: true, kind: 'dropdown' })

  assert.equal(item.status, 'ok')
  assert.equal(item.category, 'dropdown')
})

test('hover audit classifies tooltip reveal as ok', () => {
  const item = classifyHoverObservation(candidate({ kindHint: 'tooltip' }), { changed: true, restored: true, kind: 'tooltip' })

  assert.equal(item.status, 'ok')
  assert.equal(item.category, 'tooltip')
})

test('hover audit warns when there is no visible hover change', () => {
  const item = classifyHoverObservation(candidate(), { changed: false, restored: true })

  assert.equal(item.status, 'warn')
  assert.equal(item.category, 'no-change')
})

test('hover audit warns when panel is clipped outside the viewport', () => {
  const item = classifyHoverObservation(candidate(), { changed: true, clipped: true, restored: true })

  assert.equal(item.status, 'warn')
  assert.equal(item.category, 'clipped')
})

test('hover audit errors when hover is blocked or runtime errors occur', () => {
  const blocked = classifyHoverObservation(candidate(), { blocked: true, error: 'hover failed' })
  const errored = classifyHoverObservation(candidate(), { changed: true, restored: true, consoleErrorCount: 1 })

  assert.equal(blocked.status, 'error')
  assert.equal(errored.status, 'error')
})

test('hover audit dedupes repeated candidate selectors', () => {
  const deduped = dedupeHoverCandidates([
    candidate({ selector: '#menu', panelSelector: '#submenu' }),
    candidate({ selector: '#menu', panelSelector: '#submenu' }),
    candidate({ selector: '#tooltip', panelSelector: '', kindHint: 'tooltip' }),
  ])

  assert.equal(deduped.length, 2)
})

test('hover audit meta reports no target safely', () => {
  const meta = HOVER_AUDIT_TEST_ONLY.createHoverAuditMeta([], { candidateCount: 0, noTarget: true })

  assert.equal(meta.noTarget, true)
  assert.equal(meta.candidateCount, 0)
})

test('hover audit phase 3-b fixtures cover status boundaries and native tooltip false positive', () => {
  const problem = classifyHoverObservation(candidate(), { blocked: true, error: 'hover failed' })
  const review = classifyHoverObservation(candidate(), { changed: false, restored: true })
  const normal = classifyHoverObservation(candidate({ kindHint: 'dropdown' }), { changed: true, restored: true, kind: 'dropdown' })
  const notApplicable = HOVER_AUDIT_TEST_ONLY.createHoverAuditMeta([], { candidateCount: 0, noTarget: true })
  const previousFalsePositive = classifyHoverObservation(candidate({ kindHint: 'tooltip', panelSelector: '', titleAttr: 'More information' }), { changed: false, restored: true, kind: 'tooltip' })

  assert.equal(problem.status, 'error')
  assert.equal(review.status, 'warn')
  assert.equal(normal.status, 'ok')
  assert.equal(notApplicable.noTarget, true)
  assert.equal(previousFalsePositive.status, 'info')
  assert.equal(previousFalsePositive.category, 'native-tooltip')
})

function candidate(overrides = {}) {
  return {
    auditId: 'hover-1',
    selector: '#menu',
    panelSelector: '#submenu',
    label: 'Menu',
    kindHint: 'menu',
    ...overrides,
  }
}
