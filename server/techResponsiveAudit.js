import { getDeviceProfiles } from '../shared/deviceProfiles.js'

const RESPONSIVE_AUDIT_TIMEOUT_MS = 6000
const RESPONSIVE_OVERFLOW_TOLERANCE_PX = 2
const CLEAR_PAGE_OVERFLOW_PX = 32
const MAX_RESPONSIVE_EVIDENCE = 6

export const RESPONSIVE_VIEWPORTS = Object.freeze(getDeviceProfiles(['desktop', 'tablet', 'mobile']).map((profile) => ({ label: profile.label, width: profile.viewport.width, height: profile.viewport.height })))

export async function auditResponsiveLayouts(browser, targetUrl, instrumentation = null) {
  const items = []
  for (const viewport of RESPONSIVE_VIEWPORTS) {
    const context = await browser.newContext({
      ignoreHTTPSErrors: true,
      viewport: { width: viewport.width, height: viewport.height },
      serviceWorkers: 'block',
    })
    try {
      const page = await context.newPage()
      incrementAuditCount(instrumentation, 'responsiveAuditPageCount')
      const consoleErrors = []
      const pageErrors = []
      page.on('console', (message) => {
        if (message.type() === 'error') consoleErrors.push(message.text())
      })
      page.on('pageerror', (error) => {
        pageErrors.push(error.message || 'page error')
      })
      try {
        await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: RESPONSIVE_AUDIT_TIMEOUT_MS })
        const observation = await readResponsiveObservation(page, viewport)
        items.push(classifyResponsiveViewportObservation(viewportCandidate(viewport), {
          ...observation,
          consoleErrorCount: consoleErrors.length,
          pageErrorCount: pageErrors.length,
        }))
      } catch (error) {
        items.push(classifyResponsiveViewportObservation(viewportCandidate(viewport), {
          navigationError: error instanceof Error ? error.message : 'responsive-audit-failed',
        }))
      } finally {
        await page.close().catch(() => {})
      }
    } finally {
      await context.close().catch(() => {})
    }
  }

  return {
    items,
    meta: createResponsiveAuditMeta(items, { candidateCount: RESPONSIVE_VIEWPORTS.length }),
  }
}

export function classifyResponsiveViewportObservation(candidate = {}, observation = {}) {
  const issues = []
  let owner = 'UID팀'
  if (observation.noTarget === true) {
    return { ...candidate, status: 'info', category: 'no-target', note: '해당 viewport에서 검사 대상 레이아웃 요소가 확인되지 않았습니다.', issues: [], owner }
  }
  if (String(observation.navigationError || '').trim()) {
    return { ...candidate, status: 'error', category: 'navigation-failed', note: '해당 viewport에서 페이지 접속에 실패했습니다.', issues: [String(observation.navigationError)], owner: '개발팀' }
  }
  if (Number(observation.consoleErrorCount || 0) > 0 || Number(observation.pageErrorCount || 0) > 0) {
    owner = '개발팀'
    issues.push('해당 viewport에서 first-party console 또는 page error가 발생했습니다.')
  }
  if (observation.blankLike === true || observation.mainVisible === false) {
    owner = '개발팀'
    issues.push('해당 viewport에서 주요 콘텐츠가 비어 있거나 렌더링되지 않았을 수 있습니다.')
  }
  const overflowAmount = Number(observation.overflowAmount || 0)
  const hasClearPageOverflow = overflowAmount > CLEAR_PAGE_OVERFLOW_PX
  if (overflowAmount > RESPONSIVE_OVERFLOW_TOLERANCE_PX) issues.push(`가로 overflow ${Math.round(overflowAmount)}px가 감지되었습니다.`)
  if (Number(observation.clippedCount || 0) > 0) issues.push(`viewport 밖으로 벗어난 주요 요소 ${Number(observation.clippedCount || 0)}개가 감지되었습니다.`)
  if (Number(observation.textClipCount || 0) > 0) issues.push(`의미 있는 텍스트 잘림 후보 ${Number(observation.textClipCount || 0)}개가 감지되었습니다.`)

  const status = hasClearPageOverflow || owner === '개발팀' && issues.length > 0 && (String(observation.navigationError || '').trim() || observation.blankLike === true || observation.mainVisible === false || Number(observation.consoleErrorCount || 0) > 0 || Number(observation.pageErrorCount || 0) > 0)
    ? 'error'
    : issues.length > 0 ? 'warn' : 'ok'

  return {
    ...candidate,
    status,
    category: status === 'error' ? 'responsive-error' : status === 'warn' ? 'needs-review' : 'responsive-ok',
    note: issues[0] || '해당 viewport에서 기본 레이아웃과 가로 넘침 상태를 확인했습니다.',
    issues,
    owner,
    viewportWidth: observation.viewportWidth,
    viewportHeight: observation.viewportHeight,
    overflowAmount: observation.overflowAmount,
    clippedCount: observation.clippedCount,
    textClipCount: observation.textClipCount,
  }
}

export function shouldIgnoreResponsiveCandidate(candidate = {}) {
  const styleDisplay = String(candidate.display || '').toLowerCase()
  const styleVisibility = String(candidate.visibility || '').toLowerCase()
  const opacity = Number(candidate.opacity)
  const pointerEvents = String(candidate.pointerEvents || '').toLowerCase()
  if (candidate.hidden === true || candidate.ariaHidden === true || candidate.ariaHidden === 'true' || candidate.ancestorAriaHidden === true) return true
  if (candidate.inert === true || candidate.ancestorInert === true) return true
  if (styleDisplay === 'none' || styleVisibility === 'hidden') return true
  if (Number.isFinite(opacity) && opacity === 0 && (pointerEvents === 'none' || candidate.interactive !== true)) return true
  if (candidate.activeDescendant === false || candidate.current === false || candidate.selected === false && candidate.insideCompositeWidget === true) return true
  if (candidate.dialogClosed === true) return true
  if (candidate.insideScrollableContainer === true) return true
  if (candidate.offscreen === true) return true
  return false
}

export function shouldFlagResponsiveTextClip(candidate = {}) {
  if (shouldIgnoreResponsiveCandidate(candidate)) return false
  if (candidate.hasEllipsis === true) return false
  if (Number(candidate.lineClamp || 0) > 0) return false
  return Number(candidate.scrollWidth || 0) > Number(candidate.clientWidth || 0) + RESPONSIVE_OVERFLOW_TOLERANCE_PX
    || Number(candidate.scrollHeight || 0) > Number(candidate.clientHeight || 0) + RESPONSIVE_OVERFLOW_TOLERANCE_PX
}

function createResponsiveAuditMeta(items = [], context = {}) {
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

async function readResponsiveObservation(page, viewport) {
  return page.evaluate(({ tolerancePx, maxEvidence, viewportLabel }) => {
    const doc = document.documentElement
    const body = document.body || document.createElement('body')
    const viewportWidth = window.innerWidth || doc.clientWidth || 0
    const viewportHeight = window.innerHeight || doc.clientHeight || 0
    const visibleGeometry = getVisibleDocumentGeometry()
    const documentWidth = Math.max(viewportWidth, visibleGeometry.right)
    const overflowAmount = Math.max(0, documentWidth - viewportWidth)
    const visibleTextLength = String(document.body?.innerText || '').replace(/\s+/g, ' ').trim().length
    const main = document.querySelector('main, [role="main"]')
    const mainVisible = isVisible(main) || Number(document.body?.children?.length || 0) > 0
    const blankLike = visibleTextLength < 20 && Array.from(document.body?.children || []).filter((element) => isVisible(element)).length <= 1
    const clippedCandidates = Array.from(document.querySelectorAll('h1, h2, h3, p, button, a[href], img, main, nav, header, footer, [role="button"]'))
      .map((element, index) => buildEvidenceCandidate(element, index))
      .filter((candidate) => !ignoreCandidate(candidate) && candidate.overflowAmount > tolerancePx)
      .slice(0, maxEvidence)
    const textClipCandidates = Array.from(document.querySelectorAll('h1, h2, h3, p, button, a[href], span, strong, em'))
      .map((element, index) => buildTextClipCandidate(element, index))
      .filter((candidate) => !ignoreCandidate(candidate) && !candidate.hasEllipsis && Number(candidate.lineClamp || 0) === 0 && candidate.textOverflowAmount > tolerancePx)
      .slice(0, maxEvidence)

    return {
      viewportLabel,
      viewportWidth,
      viewportHeight,
      documentWidth,
      overflowAmount,
      clippedCount: clippedCandidates.length,
      textClipCount: textClipCandidates.length,
      mainVisible,
      blankLike,
      clippedCandidates,
      textClipCandidates,
      overflowX: `${window.getComputedStyle(doc).overflowX || ''} / ${window.getComputedStyle(body).overflowX || ''}`,
    }

    function buildEvidenceCandidate(element, index) {
      const rect = element.getBoundingClientRect()
      return {
        label: getElementLabel(element, `요소 ${index + 1}`),
        selector: getCssSelector(element),
        role: element.getAttribute('role') || '',
        className: typeof element.className === 'string' ? element.className : '',
        ariaHidden: element.getAttribute('aria-hidden') || '',
        ancestorAriaHidden: Boolean(element.closest('[aria-hidden="true"]')),
        inert: element.hasAttribute('inert'),
        ancestorInert: Boolean(element.closest('[inert]')),
        activeDescendant: isActiveDescendant(element),
        selected: getSelectedState(element),
        current: getCurrentState(element),
        insideCompositeWidget: Boolean(element.closest('[role="tablist"], [role="listbox"], [role="menu"], [aria-roledescription]')),
        hidden: element.hasAttribute('hidden'),
        display: window.getComputedStyle(element).display,
        visibility: window.getComputedStyle(element).visibility,
        opacity: window.getComputedStyle(element).opacity,
        pointerEvents: window.getComputedStyle(element).pointerEvents,
        interactive: element.matches('button, a[href], input, select, textarea, [role="button"], [tabindex]'),
        insideScrollableContainer: isInsideScrollableContainer(element),
        dialogClosed: isInsideClosedDialog(element),
        offscreen: rect.right < -20 || rect.left > viewportWidth + 20,
        overflowAmount: Math.max(0, rect.right - viewportWidth, -rect.left),
      }
    }

    function buildTextClipCandidate(element, index) {
      const style = window.getComputedStyle(element)
      return {
        label: getElementLabel(element, `텍스트 ${index + 1}`),
        selector: getCssSelector(element),
        role: element.getAttribute('role') || '',
        className: typeof element.className === 'string' ? element.className : '',
        ariaHidden: element.getAttribute('aria-hidden') || '',
        ancestorAriaHidden: Boolean(element.closest('[aria-hidden="true"]')),
        inert: element.hasAttribute('inert'),
        ancestorInert: Boolean(element.closest('[inert]')),
        activeDescendant: isActiveDescendant(element),
        selected: getSelectedState(element),
        current: getCurrentState(element),
        insideCompositeWidget: Boolean(element.closest('[role="tablist"], [role="listbox"], [role="menu"], [aria-roledescription]')),
        hidden: element.hasAttribute('hidden'),
        display: style.display,
        visibility: style.visibility,
        opacity: style.opacity,
        pointerEvents: style.pointerEvents,
        interactive: element.matches('button, a[href], input, select, textarea, [role="button"], [tabindex]'),
        insideScrollableContainer: isInsideScrollableContainer(element),
        dialogClosed: isInsideClosedDialog(element),
        hasEllipsis: style.textOverflow === 'ellipsis',
        lineClamp: Number(style.webkitLineClamp || 0),
        textOverflowAmount: Math.max(0, element.scrollWidth - element.clientWidth, element.scrollHeight - element.clientHeight),
      }
    }

    function ignoreCandidate(candidate) {
      return shouldIgnoreCandidateLocally(candidate)
    }

    function shouldIgnoreCandidateLocally(candidate) {
      const opacity = Number(candidate.opacity)
      const pointerEvents = String(candidate.pointerEvents || '').toLowerCase()
      if (candidate.hidden || candidate.ariaHidden === 'true' || candidate.ancestorAriaHidden) return true
      if (candidate.inert || candidate.ancestorInert) return true
      if (candidate.display === 'none' || candidate.visibility === 'hidden') return true
      if (Number.isFinite(opacity) && opacity === 0 && (pointerEvents === 'none' || candidate.interactive !== true)) return true
      if (candidate.activeDescendant === false || candidate.current === false || candidate.selected === false && candidate.insideCompositeWidget === true) return true
      if (candidate.dialogClosed === true) return true
      if (candidate.insideScrollableContainer === true) return true
      if (candidate.offscreen === true) return true
      return false
    }

    function getVisibleDocumentGeometry() {
      const elements = Array.from(document.body?.querySelectorAll('*') || [])
      return elements.reduce((geometry, element, index) => {
        const candidate = buildEvidenceCandidate(element, index)
        if (ignoreCandidate(candidate)) return geometry
        const rect = element.getBoundingClientRect()
        if (rect.width <= 0 || rect.height <= 0) return geometry
        return { right: Math.max(geometry.right, Math.ceil(rect.right)) }
      }, { right: viewportWidth })
    }

    function isVisible(element) {
      if (!element) return false
      const rect = element.getBoundingClientRect()
      const style = window.getComputedStyle(element)
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || '1') > 0
    }

    function getElementLabel(element, fallback) {
      return String(element?.innerText || element?.textContent || element?.getAttribute?.('aria-label') || '').replace(/\s+/g, ' ').trim() || fallback
    }

    function isInsideScrollableContainer(element) {
      const container = element.closest('[role="tablist"], [role="listbox"]') || findScrollableAncestor(element)
      if (!container || container === document.body) return false
      const style = window.getComputedStyle(container)
      const scrollableX = ['auto', 'scroll', 'overlay'].includes(String(style.overflowX || '').toLowerCase())
      return scrollableX && Number(container.scrollWidth || 0) > Number(container.clientWidth || 0) + tolerancePx
    }

    function findScrollableAncestor(element) {
      let current = element.parentElement
      while (current && current !== document.body) {
        const style = window.getComputedStyle(current)
        const scrollableX = ['auto', 'scroll', 'overlay'].includes(String(style.overflowX || '').toLowerCase())
        if (scrollableX && Number(current.scrollWidth || 0) > Number(current.clientWidth || 0) + tolerancePx) return current
        current = current.parentElement
      }
      return null
    }

    function isInsideClosedDialog(element) {
      const dialog = element.closest('dialog, [role="dialog"], [aria-modal="true"]')
      if (!dialog) return false
      const style = window.getComputedStyle(dialog)
      if (dialog.hasAttribute('hidden')) return true
      if (dialog.getAttribute('aria-hidden') === 'true') return true
      if (dialog.hasAttribute('inert')) return true
      if (style.display === 'none' || style.visibility === 'hidden') return true
      if (dialog.tagName.toLowerCase() === 'dialog' && dialog.open !== true) return true
      return false
    }

    function isActiveDescendant(element) {
      const owner = element.closest('[aria-activedescendant]')
      if (!owner) return true
      const activeId = owner.getAttribute('aria-activedescendant')
      if (!activeId) return true
      return element.id === activeId || Boolean(element.querySelector(`#${cssEscape(activeId)}`))
    }

    function getSelectedState(element) {
      const value = element.getAttribute('aria-selected')
      return value === null ? null : value === 'true'
    }

    function getCurrentState(element) {
      const value = element.getAttribute('aria-current')
      return value === null ? null : value !== 'false'
    }

    function getCssSelector(element) {
      if (!element || !element.tagName) return ''
      if (element.id) return `#${cssEscape(element.id)}`
      const parts = []
      let current = element
      let depth = 0
      while (current && current !== document.body && depth < 4) {
        const tagName = current.tagName.toLowerCase()
        const classNames = Array.from(current.classList || []).slice(0, 2).map((className) => `.${cssEscape(className)}`).join('')
        parts.unshift(`${tagName}${classNames}`)
        current = current.parentElement
        depth += 1
      }
      return parts.join(' > ')
    }

    function cssEscape(value) {
      if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(value)
      return String(value || '').replace(/[^a-zA-Z0-9_-]/g, '\\$&')
    }
  }, { tolerancePx: RESPONSIVE_OVERFLOW_TOLERANCE_PX, maxEvidence: MAX_RESPONSIVE_EVIDENCE, viewportLabel: viewport.label }).catch(() => ({
    viewportLabel: viewport.label,
    viewportWidth: viewport.width,
    viewportHeight: viewport.height,
    documentWidth: viewport.width,
    overflowAmount: 0,
    clippedCount: 0,
    textClipCount: 0,
    mainVisible: false,
    blankLike: true,
  }))
}

function viewportCandidate(viewport = {}) {
  return {
    auditId: `responsive-${String(viewport.label || '').toLowerCase()}`,
    label: viewport.label || 'Viewport',
    category: 'viewport',
    type: `${viewport.width}x${viewport.height}`,
  }
}

function incrementAuditCount(instrumentation, key) {
  if (!instrumentation || typeof instrumentation !== 'object') return
  instrumentation[key] = Number(instrumentation[key] || 0) + 1
}

export const RESPONSIVE_AUDIT_TEST_ONLY = {
  createResponsiveAuditMeta,
}
