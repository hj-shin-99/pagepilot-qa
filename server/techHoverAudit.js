const HOVER_AUDIT_TIMEOUT_MS = 5000
const MAX_HOVER_CANDIDATES = 12
const HOVER_STATE_CHANGE_TIMEOUT_MS = 800
const HOVER_STATE_RESET_TIMEOUT_MS = 500
const HOVER_STATE_POLL_INTERVAL_MS = 50

export async function auditHoverInteractions(browser, targetUrl, instrumentation = null, contextOptions = {}) {
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 1280, height: 720 },
    serviceWorkers: 'block',
    ...contextOptions,
  })

  try {
    const page = await context.newPage()
    incrementAuditCount(instrumentation, 'hoverAuditPageCount')
    const candidateSnapshot = await collectHoverCandidates(page, targetUrl)
    await page.close().catch(() => {})

    if (candidateSnapshot.items.length === 0) {
      return { items: [], meta: createHoverAuditMeta([], { candidateCount: 0, noTarget: true }) }
    }

    const items = []
    for (const candidate of candidateSnapshot.items.slice(0, MAX_HOVER_CANDIDATES)) {
      const pageForCandidate = await context.newPage()
      incrementAuditCount(instrumentation, 'hoverAuditPageCount')
      try {
        items.push(await inspectHoverCandidate(pageForCandidate, targetUrl, candidate))
      } finally {
        await pageForCandidate.close().catch(() => {})
      }
    }

    return {
      items,
      meta: createHoverAuditMeta(items, { candidateCount: candidateSnapshot.candidateCount }),
    }
  } finally {
    await context.close().catch(() => {})
  }
}

export function dedupeHoverCandidates(candidates = []) {
  const sourceItems = Array.isArray(candidates) ? candidates : []
  const seen = new Set()
  return sourceItems.filter((item) => {
    const key = `${item.panelSelector || ''}|${item.selector || ''}|${item.kindHint || ''}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function classifyHoverObservation(candidate = {}, observation = {}) {
  const consoleErrorCount = Number(observation.consoleErrorCount || 0)
  const pageErrorCount = Number(observation.pageErrorCount || 0)
  if (textOf(observation.automationError) || textOf(observation.error)) {
    return withHoverEvidence(candidate, observation, {
      status: 'warn',
      category: 'automation-runtime',
      note: '자동화 환경에서 Hover 조작을 완료하지 못했습니다. 실제 브라우저에서 동작 확인이 필요합니다.',
    })
  }
  if (observation.blocked === true) {
    return withHoverEvidence(candidate, observation, {
      status: 'warn',
      category: 'blocked',
      note: 'Hover 대상 위에 다른 pointer target이 있어 자동 검사에서 의도한 대상을 확정하지 못했습니다.',
    })
  }
  if (consoleErrorCount > 0 || pageErrorCount > 0) {
    return withHoverEvidence(candidate, observation, { status: 'error', category: 'error', note: 'Hover 조작 중 console 또는 page error가 발생했습니다.' })
  }

  const kind = observation.kind || candidate.kindHint || 'ui-change'
  if (kind === 'tooltip' && textOf(candidate.titleAttr) && !textOf(candidate.panelSelector) && observation.changed !== true) {
    return withHoverEvidence(candidate, observation, { status: 'info', category: 'native-tooltip', note: '브라우저 기본 title tooltip은 DOM 변화로 확인할 수 없어 참고 항목으로 분류했습니다.' })
  }
  if (observation.clipped === true) {
    return withHoverEvidence(candidate, observation, { status: 'warn', category: 'clipped', note: '노출된 패널이 viewport 밖으로 잘리거나 일부가 가려졌을 수 있습니다.' })
  }
  if (observation.changed !== true) {
    return withHoverEvidence(candidate, observation, { status: 'warn', category: 'no-change', note: 'Hover 전후에 명확한 노출 변화가 확인되지 않았습니다.' })
  }
  if (observation.restored === false) {
    return withHoverEvidence(candidate, observation, { status: 'warn', category: kind, note: 'Hover 해제 후 원래 상태 복귀를 확인하지 못했습니다.' })
  }
  return withHoverEvidence(candidate, observation, {
    status: 'ok',
    category: kind,
    note: kind === 'tooltip'
      ? 'Hover 후 tooltip 노출을 확인했습니다.'
      : kind === 'menu'
        ? 'Hover 후 메뉴 또는 서브메뉴 노출을 확인했습니다.'
        : kind === 'dropdown'
          ? 'Hover 후 드롭다운 또는 패널 노출을 확인했습니다.'
          : 'Hover 전후 UI 변화를 확인했습니다.',
  })
}

function withHoverEvidence(candidate = {}, observation = {}, result = {}) {
  const evidence = {}
  if (textOf(observation.automationError) || textOf(observation.error)) evidence.automationError = limitText(observation.automationError || observation.error, 1000)
  if (textOf(observation.actionFailureReason)) evidence.actionFailureReason = limitText(observation.actionFailureReason, 200)
  if (textOf(observation.hoverSelector) && observation.hoverSelector !== candidate.selector) evidence.hoverSelector = observation.hoverSelector
  if (textOf(observation.hitTargetSelector)) evidence.hitTargetSelector = observation.hitTargetSelector
  if (textOf(observation.hitTargetRelation)) evidence.hitTargetRelation = observation.hitTargetRelation
  return { ...candidate, ...evidence, ...result }
}

function createHoverAuditMeta(items = [], context = {}) {
  const sourceItems = Array.isArray(items) ? items : []
  return {
    candidateCount: Number(context.candidateCount || sourceItems.length || 0),
    inspectedCount: sourceItems.length,
    okCount: sourceItems.filter((item) => item.status === 'ok').length,
    warningCount: sourceItems.filter((item) => item.status === 'warn').length,
    errorCount: sourceItems.filter((item) => item.status === 'error').length,
    skippedCount: sourceItems.filter((item) => item.status === 'info').length,
    noTarget: context.noTarget === true || (Number(context.candidateCount || 0) === 0 && sourceItems.length === 0),
  }
}

async function collectHoverCandidates(page, targetUrl) {
  await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: HOVER_AUDIT_TIMEOUT_MS })
  const snapshot = await page.evaluate(() => {
    const raw = []
    const selector = [
      '[aria-haspopup]',
      '[aria-expanded]',
      '[data-toggle*="dropdown"]',
      '[data-bs-toggle*="dropdown"]',
      '[onmouseover]',
      '[onmouseenter]',
      '[title]',
      'nav a',
      'nav button',
      '[role="menuitem"]',
    ].join(', ')

    Array.from(document.querySelectorAll(selector)).forEach((element, index) => {
      const rect = element.getBoundingClientRect()
      const style = window.getComputedStyle(element)
      if (rect.width <= 0 || rect.height <= 0 || style.display === 'none' || style.visibility === 'hidden') return
      const panelSelector = getPanelSelector(element)
      if (!hasHoverInteractionEvidence(element, panelSelector)) return
      const kindHint = getKindHint(element, panelSelector) || 'ui-change'
      raw.push({
        auditId: `hover-${index + 1}`,
        selector: getCssSelector(element),
        label: getElementLabel(element, `Hover ${index + 1}`),
        panelSelector,
        titleAttr: element.getAttribute('title') || '',
        ariaHaspopup: element.getAttribute('aria-haspopup') || '',
        ariaExpanded: element.getAttribute('aria-expanded') || '',
        section: estimateSection(element),
        kindHint,
      })
    })

    return { items: raw, candidateCount: raw.length }

    function getPanelSelector(element) {
      const ariaControls = element.getAttribute('aria-controls') || ''
      if (ariaControls) return `#${cssEscape(ariaControls)}`
      const dataTarget = element.getAttribute('data-target') || element.getAttribute('data-bs-target') || ''
      if (dataTarget) return dataTarget.trim()
      const sibling = element.nextElementSibling
      if (sibling && sibling.matches('ul, [role="menu"], [role="tooltip"], .dropdown-menu, .submenu, .tooltip, .menu')) return getCssSelector(sibling)
      const descendant = element.querySelector('[role="menu"], [role="tooltip"], .dropdown-menu, .submenu, .tooltip, .menu')
      if (descendant) return getCssSelector(descendant)
      return ''
    }

    function getKindHint(element, panelSelector) {
      const text = `${element.getAttribute('title') || ''} ${element.getAttribute('aria-haspopup') || ''} ${element.getAttribute('class') || ''} ${panelSelector}`.toLowerCase()
      if (element.getAttribute('title')) return 'tooltip'
      if (/tooltip/.test(text)) return 'tooltip'
      if (/menu|submenu/.test(text)) return 'menu'
      if (/dropdown|listbox|popup/.test(text)) return 'dropdown'
      return panelSelector ? 'ui-change' : ''
    }

    function hasHoverInteractionEvidence(element, panelSelector) {
      if (panelSelector) return true
      const text = `${element.getAttribute('aria-haspopup') || ''} ${element.getAttribute('aria-expanded') || ''} ${element.getAttribute('data-toggle') || ''} ${element.getAttribute('data-bs-toggle') || ''} ${element.getAttribute('class') || ''} ${element.getAttribute('id') || ''} ${element.getAttribute('role') || ''} ${element.getAttribute('title') || ''}`.toLowerCase()
      if (element.getAttribute('aria-haspopup') && element.getAttribute('aria-haspopup') !== 'false') return true
      if (element.hasAttribute('aria-expanded')) return true
      if (element.tagName.toLowerCase() === 'a' && element.hasAttribute('href') && !(element.hasAttribute('onmouseover') || element.hasAttribute('onmouseenter') || element.hasAttribute('title'))) return false
      if (/dropdown|tooltip|popover|submenu|\bmenu\b/.test(text)) return true
      if ((element.hasAttribute('onmouseover') || element.hasAttribute('onmouseenter')) && /hover|dropdown|tooltip|popover|submenu|\bmenu\b/.test(text)) return true
      if (element.getAttribute('role') === 'menuitem') return Boolean(element.closest('[role="menu"], .dropdown-menu, .submenu, .menu'))
      return false
    }

    function estimateSection(element) {
      const rect = element.getBoundingClientRect()
      const documentHeight = Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight || 0, window.innerHeight) || 1
      const ratio = (rect.y + window.scrollY) / documentHeight
      if (ratio < 0.33) return 'top'
      if (ratio < 0.66) return 'middle'
      return 'bottom'
    }

    function getElementLabel(element, fallback) {
      return normalizeText(element.innerText || element.textContent || '')
        || normalizeText(element.getAttribute('aria-label') || '')
        || normalizeText(element.getAttribute('title') || '')
        || fallback
    }

    function getCssSelector(element) {
      if (!element || !element.tagName) return ''
      if (element.id) return `#${cssEscape(element.id)}`
      const parts = []
      let current = element
      let depth = 0
      while (current && current !== document.body && depth < 5) {
        const tagName = current.tagName.toLowerCase()
        const classNames = Array.from(current.classList || []).slice(0, 2).map((className) => `.${cssEscape(className)}`).join('')
        const siblings = current.parentElement ? Array.from(current.parentElement.children).filter((sibling) => sibling.tagName === current.tagName) : []
        const nth = siblings.length > 1 ? `:nth-of-type(${siblings.indexOf(current) + 1})` : ''
        parts.unshift(`${tagName}${classNames}${nth}`)
        current = current.parentElement
        depth += 1
      }
      return parts.join(' > ')
    }

    function normalizeText(value) {
      return String(value || '').replace(/\s+/g, ' ').trim()
    }

    function cssEscape(value) {
      if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(value)
      return String(value || '').replace(/[^a-zA-Z0-9_-]/g, '\\$&')
    }
  }).catch(() => ({ items: [], candidateCount: 0 }))
  return { items: dedupeHoverCandidates(snapshot.items), candidateCount: snapshot.candidateCount }
}

async function inspectHoverCandidate(page, targetUrl, candidate) {
  const consoleErrors = []
  const pageErrors = []
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  page.on('pageerror', (error) => {
    pageErrors.push(error.message || 'page error')
  })

  await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: HOVER_AUDIT_TIMEOUT_MS })
  const before = await readHoverState(page, candidate)
  const targetResolution = await resolveHoverTarget(page, candidate)
  if (targetResolution.automationError) {
    return classifyHoverObservation(candidate, {
      automationError: targetResolution.automationError,
      actionFailureReason: targetResolution.actionFailureReason,
      consoleErrorCount: consoleErrors.length,
      pageErrorCount: pageErrors.length,
    })
  }
  if (targetResolution.blocked === true) {
    return classifyHoverObservation(candidate, {
      blocked: true,
      actionFailureReason: targetResolution.actionFailureReason,
      hitTargetSelector: targetResolution.hitTargetSelector,
      hitTargetRelation: targetResolution.hitTargetRelation,
      consoleErrorCount: consoleErrors.length,
      pageErrorCount: pageErrors.length,
    })
  }

  const hoverSelector = targetResolution.hoverSelector || candidate.selector
  try {
    await page.locator(hoverSelector).first().hover({ timeout: HOVER_AUDIT_TIMEOUT_MS })
  } catch (error) {
    return classifyHoverObservation(candidate, {
      automationError: error instanceof Error ? error.message : 'hover failed',
      actionFailureReason: classifyAutomationFailure(error),
      hoverSelector,
      hitTargetSelector: targetResolution.hitTargetSelector,
      hitTargetRelation: targetResolution.hitTargetRelation,
      consoleErrorCount: consoleErrors.length,
      pageErrorCount: pageErrors.length,
    })
  }

  const after = await waitForHoverStateChange(page, candidate, before)
  await page.mouse.move(2, 2)
  const reset = await waitForHoverStateReset(page, candidate, before)
  return classifyHoverObservation(candidate, {
    ...createHoverObservationFromStates(before, after, reset),
    clipped: after.clipped === true,
    hoverSelector,
    hitTargetSelector: targetResolution.hitTargetSelector,
    hitTargetRelation: targetResolution.hitTargetRelation,
    consoleErrorCount: consoleErrors.length,
    pageErrorCount: pageErrors.length,
    before,
    after,
    reset,
  })
}

async function resolveHoverTarget(page, candidate) {
  return page.evaluate((sourceCandidate) => {
    const target = document.querySelector(sourceCandidate.selector)
    if (!target) {
      return {
        hoverSelector: sourceCandidate.selector,
        automationError: 'hover candidate not found',
        actionFailureReason: 'candidate-missing',
      }
    }

    const rect = getUsableRect(target)
    if (!rect) {
      return {
        hoverSelector: sourceCandidate.selector,
        automationError: 'hover candidate has no visible hit area',
        actionFailureReason: 'candidate-not-visible',
      }
    }

    const point = getHitPoint(rect)
    const rawHit = document.elementFromPoint(point.x, point.y)
    const hitTarget = getInteractiveElement(rawHit) || rawHit
    const hitTargetSelector = hitTarget ? getCssSelector(hitTarget) : ''

    if (!hitTarget || hitTarget === target || target.contains(hitTarget)) {
      return {
        hoverSelector: sourceCandidate.selector,
        hitTargetSelector,
        hitTargetRelation: hitTarget && target.contains(hitTarget) && hitTarget !== target ? 'candidate-descendant' : 'candidate',
      }
    }

    if (canUseHitTargetAsHoverFallback(target, hitTarget, sourceCandidate)) {
      return {
        hoverSelector: hitTargetSelector,
        hitTargetSelector,
        hitTargetRelation: 'semantic-fallback',
      }
    }

    return {
      hoverSelector: sourceCandidate.selector,
      blocked: true,
      actionFailureReason: 'pointer-target-blocked',
      hitTargetSelector,
      hitTargetRelation: target.contains(rawHit) ? 'candidate-descendant' : hitTarget.contains(target) ? 'hit-target-ancestor' : 'unrelated-hit-target',
    }

    function getUsableRect(element) {
      const rects = Array.from(element.getClientRects ? element.getClientRects() : [])
        .filter((candidateRect) => candidateRect.width > 0 && candidateRect.height > 0)
      const rect = rects[0] || element.getBoundingClientRect()
      if (!rect || rect.width <= 0 || rect.height <= 0) return null
      const style = window.getComputedStyle(element)
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return null
      return rect
    }

    function getHitPoint(rect) {
      return {
        x: Math.max(0, Math.min(window.innerWidth - 1, rect.left + rect.width / 2)),
        y: Math.max(0, Math.min(window.innerHeight - 1, rect.top + rect.height / 2)),
      }
    }

    function canUseHitTargetAsHoverFallback(candidateElement, hitElement, source) {
      if (!candidateElement || !hitElement || candidateElement === hitElement || candidateElement.contains(hitElement)) return false
      if (!isInteractive(candidateElement) || !isInteractive(hitElement)) return false
      if (candidateElement.contains(hitElement) || hitElement.contains(candidateElement)) return haveCompatibleSemantics(candidateElement, hitElement, source)
      const candidateContainer = getInteractiveContainer(candidateElement)
      const hitContainer = getInteractiveContainer(hitElement)
      if (!candidateContainer || candidateContainer !== hitContainer) return false
      return haveCompatibleSemantics(candidateElement, hitElement, source)
    }

    function haveCompatibleSemantics(first, second, source) {
      const firstControls = normalizeIdRef(first.getAttribute('aria-controls') || '')
      const secondControls = normalizeIdRef(second.getAttribute('aria-controls') || '')
      if (firstControls && secondControls && firstControls === secondControls) return true
      const hasSharedPopupContext = hasPopupContext(first) || hasPopupContext(second) || Boolean(source.panelSelector)
      return hasSharedPopupContext && haveCompatibleNames(first, second)
    }

    function hasPopupContext(element) {
      return Boolean(element.getAttribute('aria-haspopup') || element.hasAttribute('aria-expanded') || element.getAttribute('aria-controls'))
    }

    function haveCompatibleNames(first, second) {
      const firstName = normalizeControlName(getAccessibleName(first))
      const secondName = normalizeControlName(getAccessibleName(second))
      if (!firstName || !secondName) return false
      return firstName === secondName || firstName.includes(secondName) || secondName.includes(firstName)
    }

    function normalizeControlName(value) {
      return normalizeText(value)
        .toLowerCase()
        .replace(/\b(menu|button|link|open|close|toggle|expand|collapse)\b/g, ' ')
        .replace(/\b(메뉴|버튼|링크|열기|닫기|토글|확장|축소|펼치기|접기)\b/g, ' ')
        .replace(/[^0-9a-z가-힣]+/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim()
    }

    function getAccessibleName(element) {
      if (!element) return ''
      const labelledBy = element.getAttribute('aria-labelledby') || ''
      const labelledText = labelledBy.split(/\s+/).map((id) => document.getElementById(id)?.textContent || '').join(' ')
      return labelledText || element.getAttribute('aria-label') || element.innerText || element.textContent || element.getAttribute('title') || ''
    }

    function getInteractiveElement(element) {
      return element?.closest?.('a, button, input, select, textarea, summary, [role="button"], [role="link"], [role="menuitem"], [role="tab"], [aria-controls], [aria-expanded], [aria-haspopup], [tabindex]') || null
    }

    function isInteractive(element) {
      if (!element || !element.matches) return false
      return element.matches('a[href], button, input, select, textarea, summary, [role="button"], [role="link"], [role="menuitem"], [role="tab"], [aria-controls], [aria-expanded], [aria-haspopup], [tabindex]')
    }

    function getInteractiveContainer(element) {
      return element?.closest?.('li, [role="listitem"], [role="menuitem"], [role="none"], [role="presentation"]') || null
    }

    function normalizeIdRef(value) {
      return String(value || '').trim().split(/\s+/).filter(Boolean).sort().join(' ')
    }

    function getCssSelector(element) {
      if (!element || !element.tagName) return ''
      if (element.id) return `#${cssEscape(element.id)}`
      const parts = []
      let current = element
      let depth = 0
      while (current && current !== document.body && depth < 5) {
        const tagName = current.tagName.toLowerCase()
        const classNames = Array.from(current.classList || []).slice(0, 2).map((className) => `.${cssEscape(className)}`).join('')
        const siblings = current.parentElement ? Array.from(current.parentElement.children).filter((sibling) => sibling.tagName === current.tagName) : []
        const nth = siblings.length > 1 ? `:nth-of-type(${siblings.indexOf(current) + 1})` : ''
        parts.unshift(`${tagName}${classNames}${nth}`)
        current = current.parentElement
        depth += 1
      }
      return parts.join(' > ')
    }

    function normalizeText(value) {
      return String(value || '').replace(/\s+/g, ' ').trim()
    }

    function cssEscape(value) {
      if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(value)
      return String(value || '').replace(/[^a-zA-Z0-9_-]/g, '\\$&')
    }
  }, candidate).catch((error) => ({
    hoverSelector: candidate.selector,
    automationError: error instanceof Error ? error.message : 'hover target resolution failed',
    actionFailureReason: 'target-resolution-failed',
  }))
}

async function waitForHoverStateChange(page, candidate, before) {
  return waitForHoverState(page, candidate, HOVER_STATE_CHANGE_TIMEOUT_MS, (state) => createHoverObservationFromStates(before, state, before).changed === true)
}

async function waitForHoverStateReset(page, candidate, before) {
  return waitForHoverState(page, candidate, HOVER_STATE_RESET_TIMEOUT_MS, (state) => createHoverObservationFromStates(before, before, state).restored === true)
}

async function waitForHoverState(page, candidate, timeoutMs, isExpectedState) {
  const startedAt = Date.now()
  let current = await readHoverState(page, candidate)
  while (Date.now() - startedAt < timeoutMs) {
    if (isExpectedState(current)) return current
    await page.waitForTimeout(HOVER_STATE_POLL_INTERVAL_MS)
    current = await readHoverState(page, candidate)
  }
  return current
}

function createHoverObservationFromStates(before = {}, after = {}, reset = {}) {
  return {
    kind: after.tooltipVisible ? 'tooltip' : after.menuVisible ? 'menu' : after.panelVisible ? 'dropdown' : 'ui-change',
    changed: Boolean(after.panelVisible !== before.panelVisible || after.tooltipVisible !== before.tooltipVisible || after.menuVisible !== before.menuVisible || after.ariaExpanded !== before.ariaExpanded || after.ariaHidden !== before.ariaHidden),
    restored: before.panelVisible === reset.panelVisible && before.tooltipVisible === reset.tooltipVisible && before.menuVisible === reset.menuVisible && before.ariaExpanded === reset.ariaExpanded && before.ariaHidden === reset.ariaHidden,
  }
}

async function readHoverState(page, candidate) {
  return page.evaluate((sourceCandidate) => {
    const target = document.querySelector(sourceCandidate.selector)
    if (!target) return { exists: false, panelVisible: false, tooltipVisible: false, menuVisible: false, clipped: false, ariaExpanded: '' }
    const panel = sourceCandidate.panelSelector ? document.querySelector(sourceCandidate.panelSelector) : null
    const tooltip = document.querySelector('[role="tooltip"]:not([hidden]), .tooltip:not([hidden])')
    const menu = document.querySelector('[role="menu"]:not([hidden]), .dropdown-menu:not([hidden]), .submenu:not([hidden]), .menu:not([hidden])')
    return {
      exists: true,
      panelVisible: isVisible(panel),
      tooltipVisible: isVisible(tooltip),
      menuVisible: isVisible(menu),
      ariaExpanded: target.getAttribute('aria-expanded') || '',
      ariaHidden: panel ? panel.getAttribute('aria-hidden') || '' : '',
      clipped: panel ? isClipped(panel.getBoundingClientRect()) : false,
    }

    function isVisible(element) {
      if (!element) return false
      const rect = element.getBoundingClientRect()
      const style = window.getComputedStyle(element)
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0'
    }

    function isClipped(rect) {
      return rect.left < 0 || rect.top < 0 || rect.right > window.innerWidth || rect.bottom > window.innerHeight
    }
  }, candidate).catch(() => ({ exists: false, panelVisible: false, tooltipVisible: false, menuVisible: false, clipped: false, ariaExpanded: '' }))
}

function classifyAutomationFailure(error) {
  const message = error instanceof Error ? error.message : String(error || '')
  if (/timeout|timed\s*out/i.test(message)) return 'timeout'
  if (/detached|not attached|stale/i.test(message)) return 'detached-element'
  if (/execution context|context was destroyed/i.test(message)) return 'execution-context-destroyed'
  if (/navigation|frame was detached|target closed|page closed|browser has been closed/i.test(message)) return 'navigation-or-context-closed'
  if (/intercepts pointer events|not visible|not stable|outside of the viewport|not enabled/i.test(message)) return 'actionability-failed'
  return 'hover-action-failed'
}

function incrementAuditCount(instrumentation, key) {
  if (!instrumentation || typeof instrumentation !== 'object') return
  instrumentation[key] = Number(instrumentation[key] || 0) + 1
}

function textOf(value) {
  return String(value || '').trim()
}

function limitText(value, maxLength) {
  const text = textOf(value)
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text
}

export const HOVER_AUDIT_TEST_ONLY = {
  createHoverAuditMeta,
  createHoverObservationFromStates,
  inspectHoverCandidate,
  resolveHoverTarget,
  waitForHoverStateChange,
}
