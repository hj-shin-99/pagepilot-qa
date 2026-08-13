import test from 'node:test'
import assert from 'node:assert/strict'
import { createScrollAuditItems, createScrollStepTargets, SCROLL_AUDIT_TEST_ONLY } from './techScrollAudit.js'

test('scroll audit treats short pages as normal', () => {
  const items = createScrollAuditItems({
    initial: { canScroll: false, scrollHeight: 720, viewportHeight: 720, scrollY: 0 },
    observations: [{ canScroll: false, scrollHeight: 720, viewportHeight: 720, scrollY: 0, nearBottom: true }],
    restored: { scrollY: 0 },
  })

  assert.equal(items[0].status, 'ok')
  assert.equal(items[0].note.includes('짧은 페이지'), true)
})

test('scroll audit treats normal bottom reach as ok', () => {
  const items = createScrollAuditItems({
    initial: { canScroll: true, scrollHeight: 2000, viewportHeight: 720, scrollY: 0 },
    observations: [
      { canScroll: true, scrollHeight: 2000, viewportHeight: 720, scrollY: 0, nearBottom: false },
      { canScroll: true, scrollHeight: 2000, viewportHeight: 720, scrollY: 1280, nearBottom: true, lazyImageCount: 2, unresolvedLazyImageCount: 0, brokenLazyImageCount: 0, fixedElementCount: 1, blockingFixedElementCount: 0, fixedCoverageRatio: 0.08 },
    ],
    restored: { scrollY: 0 },
  })

  assert.equal(items[0].status, 'ok')
  assert.equal(items[1].status, 'ok')
  assert.equal(items[2].status, 'ok')
  assert.equal(items[3].status, 'ok')
})

test('scroll audit treats one lazy height increase as ok after bottom retry', () => {
  const items = createScrollAuditItems({
    initial: { canScroll: true, scrollHeight: 2000, viewportHeight: 720, scrollY: 0 },
    observations: [
      { canScroll: true, scrollHeight: 2000, viewportHeight: 720, scrollY: 1280, nearBottom: true },
      { canScroll: true, scrollHeight: 2600, viewportHeight: 720, scrollY: 1280, nearBottom: false },
      { canScroll: true, scrollHeight: 2600, viewportHeight: 720, scrollY: 1880, nearBottom: true, lazyImageCount: 1, unresolvedLazyImageCount: 0, brokenLazyImageCount: 0, fixedElementCount: 0, blockingFixedElementCount: 0, fixedCoverageRatio: 0 },
    ],
    restored: { scrollY: 0 },
    growthPasses: 1,
  })

  assert.equal(items[0].status, 'ok')
  assert.equal(items[0].nearBottom, true)
})

test('scroll audit warns on overflow hidden and lazy-load failures', () => {
  const items = createScrollAuditItems({
    initial: { canScroll: true, overflowHidden: true, scrollHeight: 2000, viewportHeight: 720, scrollY: 0 },
    observations: [{ canScroll: true, overflowHidden: true, scrollHeight: 2000, viewportHeight: 720, scrollY: 1280, nearBottom: true, lazyImageCount: 2, unresolvedLazyImageCount: 1, brokenLazyImageCount: 0, fixedElementCount: 0, blockingFixedElementCount: 0, fixedCoverageRatio: 0 }],
    restored: { scrollY: 0 },
  })

  assert.equal(items[0].status, 'warn')
  assert.equal(items[1].status, 'warn')
})

test('scroll audit errors on severe scroll lock and page errors', () => {
  const items = createScrollAuditItems({
    initial: { canScroll: true, scrollHeight: 2400, viewportHeight: 720, scrollY: 0 },
    observations: [{ canScroll: true, scrollHeight: 2400, viewportHeight: 720, scrollY: 0, nearBottom: false, lazyImageCount: 0, unresolvedLazyImageCount: 0, brokenLazyImageCount: 0, fixedElementCount: 0, blockingFixedElementCount: 0, fixedCoverageRatio: 0 }],
    restored: { scrollY: 0 },
    consoleErrorCount: 1,
  })

  assert.equal(items[0].status, 'error')
  assert.equal(items[0].owner, '개발팀')
})

test('scroll audit warns on blocking fixed overlays and restore failures', () => {
  const items = createScrollAuditItems({
    initial: { canScroll: true, scrollHeight: 2000, viewportHeight: 720, scrollY: 0 },
    observations: [{ canScroll: true, scrollHeight: 2000, viewportHeight: 720, scrollY: 1280, nearBottom: true, lazyImageCount: 0, unresolvedLazyImageCount: 0, brokenLazyImageCount: 0, fixedElementCount: 2, blockingFixedElementCount: 1, fixedCoverageRatio: 0.4 }],
    restored: { scrollY: 48 },
  })

  assert.equal(items[2].status, 'warn')
  assert.equal(items[3].status, 'warn')
})

test('scroll audit warns when page height keeps growing near bottom', () => {
  const items = createScrollAuditItems({
    initial: { canScroll: true, scrollHeight: 2000, viewportHeight: 720, scrollY: 0 },
    observations: [
      { canScroll: true, scrollHeight: 2000, viewportHeight: 720, scrollY: 1280, nearBottom: true },
      { canScroll: true, scrollHeight: 3200, viewportHeight: 720, scrollY: 2480, nearBottom: true },
    ],
    restored: { scrollY: 0 },
    growthPasses: 2,
  })

  assert.equal(items[0].status, 'warn')
})

test('scroll audit step targets cover top to bottom ratios', () => {
  assert.deepEqual(createScrollStepTargets(2000, 500), [0, 375, 750, 1125, 1500])
})

test('scroll audit meta reports no target safely', () => {
  const meta = SCROLL_AUDIT_TEST_ONLY.createScrollAuditMeta([], { candidateCount: 0, noTarget: true })
  assert.equal(meta.noTarget, true)
  assert.equal(meta.candidateCount, 0)
})

test('scroll audit growth pass guard only continues on meaningful bottom growth', () => {
  assert.equal(SCROLL_AUDIT_TEST_ONLY.shouldContinueScrollGrowthPass([{ scrollHeight: 1000, nearBottom: true }, { scrollHeight: 1080, nearBottom: true }]), true)
  assert.equal(SCROLL_AUDIT_TEST_ONLY.shouldContinueScrollGrowthPass([{ scrollHeight: 1000, nearBottom: false }, { scrollHeight: 1020, nearBottom: false }]), false)
  assert.equal(SCROLL_AUDIT_TEST_ONLY.shouldContinueScrollGrowthPass([{ scrollHeight: 2000, viewportHeight: 720, scrollY: 1280, nearBottom: true }, { canScroll: true, scrollHeight: 2600, viewportHeight: 720, scrollY: 1280, nearBottom: false }]), true)
})

test('scroll audit phase 3-b fixtures cover status boundaries and non-blocking fixed false positive', () => {
  const problem = createScrollAuditItems({ initial: { canScroll: true, scrollHeight: 2200, viewportHeight: 720, scrollY: 0 }, observations: [{ canScroll: true, scrollHeight: 2200, viewportHeight: 720, scrollY: 0, nearBottom: false }], restored: { scrollY: 0 } })
  const review = createScrollAuditItems({ initial: { canScroll: true, scrollHeight: 2200, viewportHeight: 720, scrollY: 0 }, observations: [{ canScroll: true, scrollHeight: 2200, viewportHeight: 720, scrollY: 1480, nearBottom: true, lazyImageCount: 1, unresolvedLazyImageCount: 1, fixedElementCount: 0, blockingFixedElementCount: 0, fixedCoverageRatio: 0 }], restored: { scrollY: 0 } })
  const normal = createScrollAuditItems({ initial: { canScroll: true, scrollHeight: 2200, viewportHeight: 720, scrollY: 0 }, observations: [{ canScroll: true, scrollHeight: 2200, viewportHeight: 720, scrollY: 1480, nearBottom: true, lazyImageCount: 0, fixedElementCount: 0, blockingFixedElementCount: 0, fixedCoverageRatio: 0 }], restored: { scrollY: 0 } })
  const notApplicable = SCROLL_AUDIT_TEST_ONLY.createScrollAuditMeta([], { candidateCount: 0, noTarget: true })
  const previousFalsePositive = createScrollAuditItems({ initial: { canScroll: true, scrollHeight: 2200, viewportHeight: 720, scrollY: 0 }, observations: [{ canScroll: true, scrollHeight: 2200, viewportHeight: 720, scrollY: 1480, nearBottom: true, lazyImageCount: 0, fixedElementCount: 1, blockingFixedElementCount: 0, fixedCoverageRatio: 0.45 }], restored: { scrollY: 0 } })

  assert.equal(problem[0].status, 'error')
  assert.equal(review[1].status, 'warn')
  assert.equal(normal.every((item) => item.status === 'ok'), true)
  assert.equal(notApplicable.noTarget, true)
  assert.equal(previousFalsePositive[2].status, 'ok')
})
