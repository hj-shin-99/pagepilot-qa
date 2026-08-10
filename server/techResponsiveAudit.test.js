import test from 'node:test'
import assert from 'node:assert/strict'
import { classifyResponsiveViewportObservation, RESPONSIVE_AUDIT_TEST_ONLY, shouldFlagResponsiveTextClip, shouldIgnoreResponsiveCandidate } from './techResponsiveAudit.js'

test('responsive audit keeps healthy viewport observations as ok', () => {
  const item = classifyResponsiveViewportObservation(candidate('Desktop'), {
    viewportWidth: 1440,
    viewportHeight: 900,
    overflowAmount: 2,
    clippedCount: 0,
    textClipCount: 0,
    mainVisible: true,
    blankLike: false,
    consoleErrorCount: 0,
    pageErrorCount: 0,
  })

  assert.equal(item.status, 'ok')
})

test('responsive audit errors on clear horizontal overflow and warns on clipped elements', () => {
  const item = classifyResponsiveViewportObservation(candidate('Tablet'), {
    viewportWidth: 768,
    viewportHeight: 1024,
    overflowAmount: 48,
    clippedCount: 2,
    textClipCount: 0,
    mainVisible: true,
    blankLike: false,
  })

  assert.equal(item.status, 'error')
  assert.equal(item.issues.some((issue) => issue.includes('overflow')), true)
})

test('responsive audit does not flag 1-2px tolerance as overflow issue', () => {
  const item = classifyResponsiveViewportObservation(candidate('Mobile'), {
    viewportWidth: 390,
    viewportHeight: 844,
    overflowAmount: 2,
    clippedCount: 0,
    textClipCount: 0,
    mainVisible: true,
    blankLike: false,
  })

  assert.equal(item.status, 'ok')
})

test('responsive audit errors on blank screens, navigation failure, and runtime errors', () => {
  const blank = classifyResponsiveViewportObservation(candidate('Mobile'), { blankLike: true, mainVisible: false })
  const navigationFailed = classifyResponsiveViewportObservation(candidate('Desktop'), { navigationError: 'ERR_NAME_NOT_RESOLVED' })
  const runtimeError = classifyResponsiveViewportObservation(candidate('Tablet'), { mainVisible: true, blankLike: false, consoleErrorCount: 1 })

  assert.equal(blank.status, 'error')
  assert.equal(navigationFailed.status, 'error')
  assert.equal(runtimeError.status, 'error')
})

test('responsive candidate filters exclude hidden inactive and offscreen UI without class-name assumptions', () => {
  assert.equal(shouldIgnoreResponsiveCandidate({ className: 'slide copy', display: 'block', visibility: 'visible', ariaHidden: 'true' }), true)
  assert.equal(shouldIgnoreResponsiveCandidate({ className: 'mobile panel', display: 'block', visibility: 'visible', offscreen: true }), true)
  assert.equal(shouldIgnoreResponsiveCandidate({ className: 'option', display: 'block', visibility: 'visible', selected: false, insideCompositeWidget: true }), true)
  assert.equal(shouldIgnoreResponsiveCandidate({ className: 'hero-title', display: 'block', visibility: 'visible' }), false)
})

test('responsive candidate filters exclude hidden dialog inert and non-interactive opacity zero candidates', () => {
  assert.equal(shouldIgnoreResponsiveCandidate({ className: 'modal', display: 'block', visibility: 'visible', dialogClosed: true }), true)
  assert.equal(shouldIgnoreResponsiveCandidate({ className: 'cta', display: 'block', visibility: 'visible', inert: true }), true)
  assert.equal(shouldIgnoreResponsiveCandidate({ className: 'cta', display: 'block', visibility: 'visible', opacity: 0, pointerEvents: 'none', interactive: false }), true)
})

test('responsive candidate filters exclude intended horizontal scroller children but keep root overflow and visible clipped cta warnings', () => {
  assert.equal(shouldIgnoreResponsiveCandidate({ className: 'card', display: 'block', visibility: 'visible', insideScrollableContainer: true }), true)
  const rootOverflow = classifyResponsiveViewportObservation(candidate('Desktop'), { viewportWidth: 1440, viewportHeight: 900, overflowAmount: 32, clippedCount: 0, textClipCount: 0, mainVisible: true, blankLike: false })
  const clippedCta = classifyResponsiveViewportObservation(candidate('Mobile'), { viewportWidth: 390, viewportHeight: 844, overflowAmount: 0, clippedCount: 1, textClipCount: 0, mainVisible: true, blankLike: false })
  assert.equal(rootOverflow.status, 'warn')
  assert.equal(clippedCta.status, 'warn')
})

test('phase 3A responsive fixtures separate problem review normal excluded and no-target cases', () => {
  const problem = classifyResponsiveViewportObservation(candidate('Mobile'), { viewportWidth: 390, viewportHeight: 844, overflowAmount: 80, clippedCount: 2, textClipCount: 0, mainVisible: true, blankLike: false })
  const review = classifyResponsiveViewportObservation(candidate('Tablet'), { viewportWidth: 768, viewportHeight: 1024, overflowAmount: 0, clippedCount: 1, textClipCount: 0, mainVisible: true, blankLike: false })
  const normal = classifyResponsiveViewportObservation(candidate('Desktop'), { viewportWidth: 1440, viewportHeight: 900, overflowAmount: 0, clippedCount: 0, textClipCount: 0, mainVisible: true, blankLike: false })
  const noTarget = classifyResponsiveViewportObservation(candidate('Mobile'), { noTarget: true })

  assert.equal(problem.status, 'error')
  assert.equal(review.status, 'warn')
  assert.equal(normal.status, 'ok')
  assert.equal(noTarget.status, 'info')
  assert.equal(shouldIgnoreResponsiveCandidate({ className: 'duplicate slide', display: 'block', visibility: 'visible', ariaHidden: 'true' }), true)
  assert.equal(shouldFlagResponsiveTextClip({ scrollWidth: 180, clientWidth: 120, hasEllipsis: true }), false)
})

test('responsive text clipping ignores intentional ellipsis and line clamp', () => {
  assert.equal(shouldFlagResponsiveTextClip({ scrollWidth: 180, clientWidth: 120, hasEllipsis: true }), false)
  assert.equal(shouldFlagResponsiveTextClip({ scrollHeight: 80, clientHeight: 20, lineClamp: 2 }), false)
  assert.equal(shouldFlagResponsiveTextClip({ scrollWidth: 220, clientWidth: 120, hasEllipsis: false, lineClamp: 0 }), true)
})

test('responsive audit meta reports no target safely', () => {
  const meta = RESPONSIVE_AUDIT_TEST_ONLY.createResponsiveAuditMeta([], { candidateCount: 0, noTarget: true })
  assert.equal(meta.noTarget, true)
  assert.equal(meta.candidateCount, 0)
})

function candidate(label) {
  return {
    auditId: `responsive-${label.toLowerCase()}`,
    label,
    category: 'viewport',
    type: '0x0',
  }
}
