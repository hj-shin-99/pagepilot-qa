const SCROLL_AUDIT_TIMEOUT_MS = 6000
const SCROLL_STEP_RATIOS = [0, 0.25, 0.5, 0.75, 1]
const MAX_SCROLL_GROWTH_PASSES = 2
const BLOCKING_OVERLAY_RATIO = 0.35
const SCROLL_BOTTOM_TOLERANCE_PX = 24

export async function auditScrollInteractions(browser, targetUrl, instrumentation = null, contextOptions = {}) {
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 1280, height: 720 },
    serviceWorkers: 'block',
    ...contextOptions,
  })

  try {
    const page = await context.newPage()
    incrementAuditCount(instrumentation, 'scrollAuditPageCount')
    const consoleErrors = []
    const pageErrors = []
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text())
    })
    page.on('pageerror', (error) => {
      pageErrors.push(error.message || 'page error')
    })

    try {
      await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: SCROLL_AUDIT_TIMEOUT_MS })
    } catch (error) {
      const items = createScrollAuditItems({ error: error instanceof Error ? error.message : 'scroll-audit-failed' })
      return { items, meta: createScrollAuditMeta(items, { candidateCount: items.length }) }
    }

    const initial = await readScrollState(page)
    const observations = [initial]
    for (const targetY of createScrollStepTargets(initial.scrollHeight, initial.viewportHeight)) {
      await page.evaluate((nextY) => {
        window.scrollTo({ top: nextY, behavior: 'instant' })
      }, targetY).catch(() => {})
      await page.waitForTimeout(120)
      observations.push(await readScrollState(page))
    }

    let growthPasses = 0
    while (growthPasses < MAX_SCROLL_GROWTH_PASSES && shouldContinueScrollGrowthPass(observations)) {
      growthPasses += 1
      const current = observations[observations.length - 1]
      await page.evaluate((nextY) => {
        window.scrollTo({ top: nextY, behavior: 'instant' })
      }, Math.max(0, current.scrollHeight - current.viewportHeight)).catch(() => {})
      await page.waitForTimeout(160)
      observations.push(await readScrollState(page))
    }

    await page.evaluate(() => {
      window.scrollTo({ top: 0, behavior: 'instant' })
    }).catch(() => {})
    await page.waitForTimeout(80)
    const restored = await readScrollState(page)
    const items = createScrollAuditItems({
      initial,
      observations,
      restored,
      growthPasses,
      consoleErrorCount: consoleErrors.length,
      pageErrorCount: pageErrors.length,
    })
    return { items, meta: createScrollAuditMeta(items, { candidateCount: items.length }) }
  } finally {
    await context.close().catch(() => {})
  }
}

export function createScrollStepTargets(scrollHeight = 0, viewportHeight = 0) {
  const maxScrollY = Math.max(0, Number(scrollHeight || 0) - Number(viewportHeight || 0))
  return SCROLL_STEP_RATIOS.map((ratio) => Math.max(0, Math.round(maxScrollY * ratio)))
}

export function createScrollAuditItems(summary = {}) {
  if (summary.error) {
    return [{
      auditId: 'scroll-summary',
      label: '페이지 스크롤',
      category: 'scroll',
      status: 'error',
      note: '스크롤 검사 중 오류가 발생했습니다.',
      issues: [String(summary.error)],
      owner: '개발팀',
    }]
  }

  const initial = summary.initial || {}
  const observations = Array.isArray(summary.observations) ? summary.observations : []
  const restored = summary.restored || {}
  const last = observations[observations.length - 1] || initial
  const canScroll = initial.canScroll === true
  const maxObservedScrollY = observations.reduce((maxValue, item) => Math.max(maxValue, Number(item.scrollY || 0)), 0)
  const bottomReached = observations.some((item) => item.nearBottom === true || Number(item.scrollY || 0) + Number(item.viewportHeight || 0) >= Number(item.scrollHeight || 0) - SCROLL_BOTTOM_TOLERANCE_PX)
  const growthUncertain = Number(summary.growthPasses || 0) >= MAX_SCROLL_GROWTH_PASSES && Number(last.scrollHeight || 0) > Number(initial.scrollHeight || 0) + Number(initial.viewportHeight || 0)
  const severeScrollLock = canScroll && maxObservedScrollY <= 4 && bottomReached !== true
  const overflowLocked = canScroll && (initial.overflowHidden === true || last.overflowHidden === true)
  const summaryIssues = []
  let summaryStatus = 'ok'
  let summaryOwner = 'UID팀'
  if (Number(summary.consoleErrorCount || 0) > 0 || Number(summary.pageErrorCount || 0) > 0) {
    summaryStatus = 'error'
    summaryOwner = '개발팀'
    summaryIssues.push('스크롤 중 first-party console 또는 page error가 발생했습니다.')
  }
  if (severeScrollLock) {
    summaryStatus = 'error'
    summaryIssues.push('스크롤 가능한 페이지이지만 실제 하단 접근이 차단되었습니다.')
  } else if (canScroll && bottomReached !== true && growthUncertain !== true) {
    summaryStatus = 'error'
    summaryIssues.push('페이지 하단에 명확하게 도달하지 못했습니다.')
  }
  if (summaryStatus !== 'error' && overflowLocked) {
    summaryStatus = 'warn'
    summaryIssues.push('overflow hidden 또는 scroll lock으로 하단 접근이 불명확합니다.')
  }
  if (summaryStatus !== 'error' && growthUncertain) {
    summaryStatus = 'warn'
    summaryIssues.push('페이지 높이가 계속 증가해 하단 판정이 불명확합니다.')
  }
  if (summaryIssues.length === 0) {
    summaryIssues.push(canScroll ? '하단 도달과 기본 스크롤 동작을 확인했습니다.' : '스크롤이 필요하지 않은 짧은 페이지입니다.')
  }

  const lazyIssues = []
  let lazyStatus = 'ok'
  if (Number(last.unresolvedLazyImageCount || 0) > 0 || Number(last.brokenLazyImageCount || 0) > 0) {
    lazyStatus = 'warn'
    lazyIssues.push('스크롤 후에도 일부 지연 로딩 이미지가 표시되지 않거나 깨진 상태로 남아 있습니다.')
  } else if (Number(last.lazyImageCount || 0) === 0) {
    lazyIssues.push('스크롤 기반 지연 로딩 이미지 후보가 없습니다.')
  } else {
    lazyIssues.push('스크롤 후 지연 로딩 이미지 상태를 확인했습니다.')
  }

  const stickyIssues = []
  let stickyStatus = 'ok'
  const blockingFixedElementCount = Number(last.blockingFixedElementCount || 0)
  const hasBlockingFixedEvidence = blockingFixedElementCount > 0 || (last.blockingFixedElementCount === undefined && Number(last.fixedCoverageRatio || 0) >= BLOCKING_OVERLAY_RATIO)
  if (hasBlockingFixedEvidence) {
    stickyStatus = 'warn'
    stickyIssues.push('고정 요소가 콘텐츠를 과도하게 가릴 가능성이 있습니다.')
  } else {
    stickyIssues.push(Number(last.fixedElementCount || 0) > 0 ? '일반적인 fixed 또는 sticky 요소 상태를 확인했습니다.' : '과도한 fixed 또는 sticky 요소가 감지되지 않았습니다.')
  }

  const restoreIssues = []
  let restoreStatus = 'ok'
  if (Math.abs(Number(restored.scrollY || 0)) > 2) {
    restoreStatus = 'warn'
    restoreIssues.push('검사 종료 후 스크롤 위치를 최상단으로 복원하지 못했습니다.')
  } else {
    restoreIssues.push('검사 종료 후 스크롤 위치를 최상단으로 복원했습니다.')
  }

  return [
    {
      auditId: 'scroll-summary',
      label: '페이지 스크롤',
      category: 'scroll',
      status: summaryStatus,
      note: summaryIssues[0],
      issues: summaryIssues,
      owner: summaryOwner,
      scrollHeight: last.scrollHeight,
      viewportHeight: last.viewportHeight,
      scrollY: last.scrollY,
      nearBottom: bottomReached,
      overflowHidden: initial.overflowHidden === true || last.overflowHidden === true,
    },
    {
      auditId: 'scroll-lazy',
      label: '지연 로딩',
      category: 'lazy-load',
      status: lazyStatus,
      note: lazyIssues[0],
      issues: lazyIssues,
      owner: 'UID팀',
      lazyImageCount: last.lazyImageCount,
      unresolvedLazyImageCount: last.unresolvedLazyImageCount,
      brokenLazyImageCount: last.brokenLazyImageCount,
    },
    {
      auditId: 'scroll-fixed',
      label: '고정 요소',
      category: 'fixed-sticky',
      status: stickyStatus,
      note: stickyIssues[0],
      issues: stickyIssues,
      owner: 'UID팀',
      fixedElementCount: last.fixedElementCount,
      blockingFixedElementCount: last.blockingFixedElementCount,
      fixedCoverageRatio: last.fixedCoverageRatio,
    },
    {
      auditId: 'scroll-restore',
      label: '스크롤 복원',
      category: 'restore',
      status: restoreStatus,
      note: restoreIssues[0],
      issues: restoreIssues,
      owner: 'UID팀',
      scrollY: restored.scrollY,
    },
  ]
}

function createScrollAuditMeta(items = [], context = {}) {
  const sourceItems = Array.isArray(items) ? items : []
  return {
    candidateCount: Number(context.candidateCount || sourceItems.length || 0),
    inspectedCount: sourceItems.length,
    okCount: sourceItems.filter((item) => item.status === 'ok').length,
    warningCount: sourceItems.filter((item) => item.status === 'warn').length,
    errorCount: sourceItems.filter((item) => item.status === 'error').length,
    skippedCount: sourceItems.filter((item) => item.status === 'info').length,
    noTarget: context.noTarget === true || sourceItems.length === 0,
  }
}

function shouldContinueScrollGrowthPass(observations = []) {
  if (observations.length < 2) return false
  const last = observations[observations.length - 1] || {}
  const previous = observations[observations.length - 2] || {}
  const heightGrew = Number(last.scrollHeight || 0) > Number(previous.scrollHeight || 0) + 40
  const bottomReached = isObservationNearBottom(last)
  return heightGrew || (last.canScroll === true && bottomReached !== true)
}

function isObservationNearBottom(item = {}) {
  return item.nearBottom === true || Number(item.scrollY || 0) + Number(item.viewportHeight || 0) >= Number(item.scrollHeight || 0) - SCROLL_BOTTOM_TOLERANCE_PX
}

async function readScrollState(page) {
  return page.evaluate(({ blockingOverlayRatio, bottomTolerancePx }) => {
    const doc = document.documentElement
    const body = document.body || document.createElement('body')
    const viewportHeight = window.innerHeight || doc.clientHeight || 0
    const viewportWidth = window.innerWidth || doc.clientWidth || 0
    const scrollHeight = Math.max(Number(doc.scrollHeight || 0), Number(body.scrollHeight || 0), viewportHeight)
    const scrollY = Math.max(0, Number(window.scrollY || window.pageYOffset || 0))
    const overflowHidden = isOverflowLocked(doc) || isOverflowLocked(body)
    const canScroll = scrollHeight > viewportHeight + 4
    const nearBottom = scrollY + viewportHeight >= scrollHeight - bottomTolerancePx
    const lazyImages = Array.from(document.images).filter((image) => {
      if (!isVisible(image)) return false
      const width = Number(image.naturalWidth || image.width || 0)
      const height = Number(image.naturalHeight || image.height || 0)
      if (width <= 24 || height <= 24) return false
      return image.getAttribute('loading') === 'lazy'
        || image.hasAttribute('data-src')
        || image.hasAttribute('data-lazy')
        || image.hasAttribute('data-original')
    })
    const unresolvedLazyImageCount = lazyImages.filter((image) => !image.complete || (!image.currentSrc && !image.src)).length
    const brokenLazyImageCount = lazyImages.filter((image) => image.complete && Number(image.naturalWidth || 0) === 0).length
    const fixedElements = Array.from(document.body?.querySelectorAll('*') || []).filter((element) => {
      if (!isVisible(element)) return false
      const style = window.getComputedStyle(element)
      if (!['fixed', 'sticky'].includes(style.position)) return false
      const rect = element.getBoundingClientRect()
      if (rect.width < 24 || rect.height < 24) return false
      return rect.bottom > 0 && rect.top < viewportHeight
    }).slice(0, 20)
    const fixedCoverageRatio = fixedElements.reduce((maxRatio, element) => {
      const rect = element.getBoundingClientRect()
      const widthRatio = viewportWidth > 0 ? rect.width / viewportWidth : 0
      const heightRatio = viewportHeight > 0 ? rect.height / viewportHeight : 0
      return Math.max(maxRatio, widthRatio * heightRatio)
    }, 0)
    const blockingFixedElementCount = fixedElements.filter((element) => {
      const rect = element.getBoundingClientRect()
      const style = window.getComputedStyle(element)
      const widthRatio = viewportWidth > 0 ? rect.width / viewportWidth : 0
      const heightRatio = viewportHeight > 0 ? rect.height / viewportHeight : 0
      if (style.pointerEvents === 'none' || Number(style.opacity || '1') === 0) return false
      return widthRatio >= 0.7 && heightRatio >= blockingOverlayRatio
    }).length

    return {
      viewportHeight,
      scrollHeight,
      scrollY,
      overflowHidden,
      canScroll,
      nearBottom,
      lazyImageCount: lazyImages.length,
      unresolvedLazyImageCount,
      brokenLazyImageCount,
      fixedElementCount: fixedElements.length,
      blockingFixedElementCount,
      fixedCoverageRatio,
    }

    function isOverflowLocked(element) {
      if (!element) return false
      const style = window.getComputedStyle(element)
      return ['hidden', 'clip'].includes(String(style.overflowY || '').toLowerCase())
        || ['hidden', 'clip'].includes(String(style.overflow || '').toLowerCase())
      }

    function isVisible(element) {
      if (!element) return false
      const rect = element.getBoundingClientRect()
      const style = window.getComputedStyle(element)
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || '1') > 0
    }
  }, { blockingOverlayRatio: BLOCKING_OVERLAY_RATIO, bottomTolerancePx: SCROLL_BOTTOM_TOLERANCE_PX }).catch(() => ({
    viewportHeight: 0,
    scrollHeight: 0,
    scrollY: 0,
    overflowHidden: false,
    canScroll: false,
    nearBottom: false,
    lazyImageCount: 0,
    unresolvedLazyImageCount: 0,
    brokenLazyImageCount: 0,
    fixedElementCount: 0,
    blockingFixedElementCount: 0,
    fixedCoverageRatio: 0,
  }))
}

function incrementAuditCount(instrumentation, key) {
  if (!instrumentation || typeof instrumentation !== 'object') return
  instrumentation[key] = Number(instrumentation[key] || 0) + 1
}

export const SCROLL_AUDIT_TEST_ONLY = {
  createScrollAuditMeta,
  shouldContinueScrollGrowthPass,
}
