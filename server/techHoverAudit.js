const HOVER_AUDIT_TIMEOUT_MS = 5000
const MAX_HOVER_CANDIDATES = 12

export async function auditHoverInteractions(browser, targetUrl, instrumentation = null) {
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 1280, height: 720 },
    serviceWorkers: 'block',
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
  if (textOf(observation.error)) {
    return { ...candidate, status: 'error', category: 'error', note: 'Hover 검사 중 오류가 발생했습니다.' }
  }
  if (observation.blocked === true) {
    return { ...candidate, status: 'error', category: 'blocked', note: 'Hover 대상 요소를 실제로 조작하지 못했습니다.' }
  }
  if (consoleErrorCount > 0 || pageErrorCount > 0) {
    return { ...candidate, status: 'error', category: 'error', note: 'Hover 조작 중 console 또는 page error가 발생했습니다.' }
  }

  const kind = observation.kind || candidate.kindHint || 'ui-change'
  if (observation.clipped === true) {
    return { ...candidate, status: 'warn', category: 'clipped', note: '노출된 패널이 viewport 밖으로 잘리거나 일부가 가려졌을 수 있습니다.' }
  }
  if (observation.changed !== true) {
    return { ...candidate, status: 'warn', category: 'no-change', note: 'Hover 전후에 명확한 노출 변화가 확인되지 않았습니다.' }
  }
  if (observation.restored === false) {
    return { ...candidate, status: 'warn', category: kind, note: 'Hover 해제 후 원래 상태 복귀를 확인하지 못했습니다.' }
  }
  return {
    ...candidate,
    status: 'ok',
    category: kind,
    note: kind === 'tooltip'
      ? 'Hover 후 tooltip 노출을 확인했습니다.'
      : kind === 'menu'
        ? 'Hover 후 메뉴 또는 서브메뉴 노출을 확인했습니다.'
        : kind === 'dropdown'
          ? 'Hover 후 드롭다운 또는 패널 노출을 확인했습니다.'
          : 'Hover 전후 UI 변화를 확인했습니다.',
  }
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
      const kindHint = getKindHint(element, panelSelector)
      if (!kindHint && !panelSelector) return
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
      if (/menu|submenu|nav/.test(text)) return 'menu'
      if (/dropdown|listbox|popup/.test(text)) return 'dropdown'
      return panelSelector ? 'ui-change' : ''
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
  try {
    await page.locator(candidate.selector).first().hover({ timeout: HOVER_AUDIT_TIMEOUT_MS })
    await page.waitForTimeout(220)
  } catch (error) {
    return classifyHoverObservation(candidate, {
      blocked: true,
      error: error instanceof Error ? error.message : 'hover failed',
      consoleErrorCount: consoleErrors.length,
      pageErrorCount: pageErrors.length,
    })
  }

  const after = await readHoverState(page, candidate)
  await page.mouse.move(2, 2)
  await page.waitForTimeout(140)
  const reset = await readHoverState(page, candidate)
  return classifyHoverObservation(candidate, {
    kind: after.tooltipVisible ? 'tooltip' : after.menuVisible ? 'menu' : after.panelVisible ? 'dropdown' : 'ui-change',
    changed: Boolean(after.panelVisible !== before.panelVisible || after.tooltipVisible !== before.tooltipVisible || after.menuVisible !== before.menuVisible || after.ariaExpanded !== before.ariaExpanded),
    restored: after.panelVisible === reset.panelVisible && after.tooltipVisible === reset.tooltipVisible && after.menuVisible === reset.menuVisible && after.ariaExpanded === reset.ariaExpanded,
    clipped: after.clipped === true,
    consoleErrorCount: consoleErrors.length,
    pageErrorCount: pageErrors.length,
    before,
    after,
    reset,
  })
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

function incrementAuditCount(instrumentation, key) {
  if (!instrumentation || typeof instrumentation !== 'object') return
  instrumentation[key] = Number(instrumentation[key] || 0) + 1
}

function textOf(value) {
  return String(value || '').trim()
}

export const HOVER_AUDIT_TEST_ONLY = {
  createHoverAuditMeta,
}
