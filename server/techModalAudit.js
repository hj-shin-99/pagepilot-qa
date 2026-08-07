const MODAL_AUDIT_TIMEOUT_MS = 6000
const MAX_MODAL_CANDIDATES = 10
const MODAL_TRIGGER_PATTERN = /(modal|dialog|popup|layer|overlay)/i
const MODAL_TRIGGER_KO_PATTERN = /(모달|팝업|레이어|오버레이|대화상자)/i

export async function auditModalInteractions(browser, targetUrl, clickItems = [], instrumentation = null, contextOptions = {}) {
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 1280, height: 720 },
    serviceWorkers: 'block',
    ...contextOptions,
  })

  try {
    await context.route('**/*', async (route) => {
      const method = String(route.request().method() || '').toUpperCase()
      if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
        await route.abort('blockedbyclient')
        return
      }
      await route.continue()
    })
    const page = await context.newPage()
    incrementAuditCount(instrumentation, 'modalAuditPageCount')
    const candidateSnapshot = await collectModalCandidates(page, targetUrl, clickItems)
    await page.close().catch(() => {})

    if (candidateSnapshot.items.length === 0) {
      return { items: [], meta: createModalAuditMeta([], { candidateCount: 0, noTarget: true }) }
    }

    const items = []
    for (const candidate of candidateSnapshot.items.slice(0, MAX_MODAL_CANDIDATES)) {
      const pageForCandidate = await context.newPage()
      incrementAuditCount(instrumentation, 'modalAuditPageCount')
      try {
        items.push(await inspectModalCandidate(pageForCandidate, targetUrl, candidate))
      } finally {
        await pageForCandidate.close().catch(() => {})
      }
    }

    return {
      items,
      meta: createModalAuditMeta(items, { candidateCount: candidateSnapshot.candidateCount }),
    }
  } finally {
    await context.close().catch(() => {})
  }
}

export function createModalAuditCandidates(clickItems = [], domCandidates = []) {
  const merged = []
  const seen = new Set()
  ;[...(Array.isArray(clickItems) ? clickItems : []), ...(Array.isArray(domCandidates) ? domCandidates : [])].forEach((item, index) => {
    if (isModalCloseCandidate(item)) return
    const selector = textOf(item.selector)
    if (!selector) return
    const key = `${selector}|${textOf(item.ariaControls || item.dataTarget || item.dialogSelector)}`
    if (seen.has(key)) return
    seen.add(key)
    merged.push({
      auditId: item.auditId || `modal-${index + 1}`,
      selector,
      label: textOf(item.label || item.text || item.ariaLabel) || `모달 트리거 ${index + 1}`,
      ariaControls: textOf(item.ariaControls),
      dataTarget: textOf(item.dataTarget),
      dialogSelector: textOf(item.dialogSelector || item.dataTarget),
      section: textOf(item.section),
    })
  })
  return merged
}

export function classifyModalObservation(candidate = {}, observation = {}) {
  const warnings = []
  if (textOf(observation.error)) return { ...candidate, status: 'error', category: 'error', note: '모달 검사 중 오류가 발생했습니다.' }
  if (observation.opened !== true) return { ...candidate, status: 'error', category: 'error', note: '모달 트리거를 눌렀지만 모달이 열리지 않았습니다.' }
  if (Number(observation.visibleDialogCount || 0) > 1) return { ...candidate, status: 'error', category: 'error', note: '중복 modal 또는 dialog가 생성되었습니다.' }
  if (observation.closable === false) return { ...candidate, status: 'error', category: 'error', note: '모달을 닫을 수 없어 다음 검사에 영향을 줄 수 있습니다.' }
  if (Number(observation.consoleErrorCount || 0) > 0 || Number(observation.pageErrorCount || 0) > 0) return { ...candidate, status: 'error', category: 'error', note: '모달 조작 중 치명적 console 또는 page error가 발생했습니다.' }

  if (!textOf(observation.accessibleName)) warnings.push('accessible name이 없습니다.')
  if (observation.hasCloseButton !== true) warnings.push('닫기 버튼이 없습니다.')
  if (observation.escClosed !== true) warnings.push('ESC 닫기 동작을 확인하지 못했습니다.')
  if (observation.focusMovedInside !== true) warnings.push('포커스가 모달 내부로 이동하지 않았습니다.')
  if (observation.focusReturned !== true) warnings.push('모달 종료 후 트리거 포커스 복귀를 확인하지 못했습니다.')
  if (observation.scrollLockApplicable !== false && observation.scrollLocked !== true) warnings.push('body scroll lock을 확인하지 못했습니다.')
  if (observation.backdropChecked === true && observation.backdropClosed !== true) warnings.push('backdrop 클릭 닫기 동작이 불명확합니다.')

  return {
    ...candidate,
    status: warnings.length > 0 ? 'warn' : 'ok',
    category: warnings.length > 0 ? 'needs-review' : 'modal-ok',
    note: warnings.length > 0 ? warnings[0] : '모달 열기·닫기 및 기본 접근성 상태를 확인했습니다.',
    warnings,
  }
}

function createModalAuditMeta(items = [], context = {}) {
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

async function collectModalCandidates(page, targetUrl, clickItems = []) {
  await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: MODAL_AUDIT_TIMEOUT_MS })
  const domCandidates = await page.evaluate(() => {
    const selector = 'button, a, [role="button"], [aria-controls], [data-target], [data-bs-target], [data-toggle], [data-bs-toggle]'
    const items = []
    Array.from(document.querySelectorAll(selector)).forEach((element, index) => {
      const rect = element.getBoundingClientRect()
      const style = window.getComputedStyle(element)
      if (rect.width <= 0 || rect.height <= 0 || style.display === 'none' || style.visibility === 'hidden') return
      if (isModalCloseControl(element)) return
      const text = `${element.getAttribute('aria-controls') || ''} ${element.getAttribute('data-target') || element.getAttribute('data-bs-target') || ''} ${element.getAttribute('data-toggle') || element.getAttribute('data-bs-toggle') || ''} ${element.getAttribute('class') || ''} ${element.getAttribute('aria-label') || ''} ${element.textContent || ''}`.toLowerCase()
      if (!/modal|dialog|popup|layer|overlay/.test(text) && !/(모달|팝업|레이어|오버레이|대화상자)/.test(text)) return
      items.push({
        auditId: `modal-dom-${index + 1}`,
        selector: getCssSelector(element),
        label: getElementLabel(element, `모달 트리거 ${index + 1}`),
        ariaControls: element.getAttribute('aria-controls') || '',
        dataTarget: element.getAttribute('data-target') || element.getAttribute('data-bs-target') || '',
        dialogSelector: element.getAttribute('data-target') || element.getAttribute('data-bs-target') || '',
        section: estimateSection(element),
      })
    })
    return items

    function getElementLabel(element, fallback) {
      return normalizeText(element.innerText || element.textContent || '')
        || normalizeText(element.getAttribute('aria-label') || '')
        || fallback
    }

    function estimateSection(element) {
      const rect = element.getBoundingClientRect()
      const documentHeight = Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight || 0, window.innerHeight) || 1
      const ratio = (rect.y + window.scrollY) / documentHeight
      if (ratio < 0.33) return 'top'
      if (ratio < 0.66) return 'middle'
      return 'bottom'
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

    function isModalCloseControl(element) {
      if (element.hasAttribute('data-dismiss') || element.hasAttribute('data-bs-dismiss')) return true
      const text = normalizeText(`${element.getAttribute('aria-label') || ''} ${element.getAttribute('title') || ''} ${element.getAttribute('class') || ''} ${element.textContent || ''}`).toLowerCase()
      if (/\b(close|dismiss|cancel|btn-close)\b|^(x|×)$/.test(text) || /(닫기|취소)/.test(text)) return true
      return Boolean(element.closest('dialog, [role="dialog"], [aria-modal="true"]') && /\b(close|dismiss|cancel|btn-close)\b|닫기|취소/.test(text))
    }

    function cssEscape(value) {
      if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(value)
      return String(value || '').replace(/[^a-zA-Z0-9_-]/g, '\\$&')
    }
  }).catch(() => [])

  const modalClickItems = (Array.isArray(clickItems) ? clickItems : []).filter((item) => {
    if (isModalCloseCandidate(item)) return false
    const text = `${item.ariaControls || ''} ${item.dataTarget || ''} ${item.dataToggle || ''} ${item.uiControlSemantic || ''} ${item.label || ''} ${item.text || ''} ${item.interactionOutcome || ''}`
    return item.interactionOutcome === 'modal' || MODAL_TRIGGER_PATTERN.test(text) || MODAL_TRIGGER_KO_PATTERN.test(text)
  })
  const items = createModalAuditCandidates(modalClickItems, domCandidates)
  return { items, candidateCount: items.length }
}

async function inspectModalCandidate(page, targetUrl, candidate) {
  const consoleErrors = []
  const pageErrors = []
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  page.on('pageerror', (error) => {
    pageErrors.push(error.message || 'page error')
  })
  await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: MODAL_AUDIT_TIMEOUT_MS })
  const opened = await openModal(page, candidate)
  if (!opened.opened) {
    return classifyModalObservation(candidate, {
      opened: false,
      error: opened.error || 'modal-open-failed',
      consoleErrorCount: consoleErrors.length,
      pageErrorCount: pageErrors.length,
    })
  }

  const openState = await readModalState(page, candidate)
  const closeButtonClosed = openState.closeButtonSelector ? await closeModalByButton(page, openState.closeButtonSelector) : false
  let escClosed = false
  let backdropClosed = false
  let backdropChecked = false
  if (closeButtonClosed !== true) {
    escClosed = await closeModalByEscape(page)
  }
  if (closeButtonClosed !== true && escClosed !== true) {
    backdropChecked = true
    backdropClosed = await closeModalByBackdrop(page, openState.dialogRect)
  }

  const postCloseState = await readModalState(page, candidate)
  const closable = closeButtonClosed || escClosed || backdropClosed || postCloseState.visibleDialogCount === 0
  return classifyModalObservation(candidate, {
    opened: true,
    visibleDialogCount: openState.visibleDialogCount,
    accessibleName: openState.accessibleName,
    hasCloseButton: Boolean(openState.closeButtonSelector),
    closeButtonClosed,
    escClosed,
    backdropChecked,
    backdropClosed,
    focusMovedInside: openState.focusMovedInside,
    focusReturned: postCloseState.focusReturned,
    scrollLocked: openState.scrollLocked,
    scrollLockApplicable: openState.pageCanScroll === true,
    closable,
    consoleErrorCount: consoleErrors.length,
    pageErrorCount: pageErrors.length,
  })
}

async function openModal(page, candidate) {
  try {
    await page.locator(candidate.selector).first().click({ timeout: MODAL_AUDIT_TIMEOUT_MS, noWaitAfter: true })
    await page.waitForTimeout(220)
    const state = await readModalState(page, candidate)
    return state.visibleDialogCount > 0 ? { opened: true } : { opened: false, error: 'dialog-not-visible' }
  } catch (error) {
    return { opened: false, error: error instanceof Error ? error.message : 'modal-open-failed' }
  }
}

async function closeModalByButton(page, closeButtonSelector) {
  try {
    await page.locator(closeButtonSelector).first().click({ timeout: 1500, noWaitAfter: true })
    await page.waitForTimeout(160)
    const count = await page.evaluate(() => document.querySelectorAll('dialog[open], [role="dialog"]:not([hidden]), [aria-modal="true"]:not([hidden])').length).catch(() => 1)
    return count === 0
  } catch {
    return false
  }
}

async function closeModalByEscape(page) {
  try {
    await page.keyboard.press('Escape')
    await page.waitForTimeout(160)
    const count = await page.evaluate(() => document.querySelectorAll('dialog[open], [role="dialog"]:not([hidden]), [aria-modal="true"]:not([hidden])').length).catch(() => 1)
    return count === 0
  } catch {
    return false
  }
}

async function closeModalByBackdrop(page, dialogRect) {
  if (!dialogRect) return false
  try {
    const x = Math.max(4, Math.floor(dialogRect.x) - 8)
    const y = Math.max(4, Math.floor(dialogRect.y) - 8)
    await page.mouse.click(x, y)
    await page.waitForTimeout(160)
    const count = await page.evaluate(() => document.querySelectorAll('dialog[open], [role="dialog"]:not([hidden]), [aria-modal="true"]:not([hidden])').length).catch(() => 1)
    return count === 0
  } catch {
    return false
  }
}

async function readModalState(page, candidate) {
  return page.evaluate((sourceCandidate) => {
    const trigger = document.querySelector(sourceCandidate.selector)
    const dialogs = Array.from(document.querySelectorAll('dialog[open], [role="dialog"]:not([hidden]), [aria-modal="true"]:not([hidden])')).filter((dialog) => {
      const rect = dialog.getBoundingClientRect()
      const style = window.getComputedStyle(dialog)
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden'
    })
    const dialog = dialogs[0] || null
    const closeButton = dialog ? Array.from(dialog.querySelectorAll('button, [role="button"], a')).find((element) => {
      const text = `${element.getAttribute('aria-label') || ''} ${element.getAttribute('title') || ''} ${element.textContent || ''}`.trim()
      return /close|dismiss|cancel|back|done|x|×/i.test(text) || /(닫기|취소|뒤로|완료)/.test(text)
    }) : null
    const activeElement = document.activeElement
    const dialogRect = dialog ? dialog.getBoundingClientRect() : null
    return {
      visibleDialogCount: dialogs.length,
      accessibleName: dialog ? getDialogName(dialog) : '',
      closeButtonSelector: closeButton ? getCssSelector(closeButton) : '',
      focusMovedInside: Boolean(dialog && activeElement instanceof HTMLElement && dialog.contains(activeElement)),
      focusReturned: Boolean(trigger && activeElement instanceof HTMLElement && activeElement === trigger),
      scrollLocked: isScrollLocked(),
      pageCanScroll: Math.max(document.documentElement.scrollHeight || 0, document.body?.scrollHeight || 0) > (window.innerHeight || document.documentElement.clientHeight || 0) + 4,
      dialogRect: dialogRect ? { x: dialogRect.x, y: dialogRect.y, width: dialogRect.width, height: dialogRect.height } : null,
    }

    function isScrollLocked() {
      const bodyStyle = window.getComputedStyle(document.body)
      const htmlStyle = window.getComputedStyle(document.documentElement)
      return /hidden|clip/.test(bodyStyle.overflow + bodyStyle.overflowY + htmlStyle.overflow + htmlStyle.overflowY) || bodyStyle.position === 'fixed'
    }

    function getDialogName(dialog) {
      const ariaLabel = dialog.getAttribute('aria-label') || ''
      if (ariaLabel) return ariaLabel.trim()
      const labelledBy = dialog.getAttribute('aria-labelledby') || ''
      if (labelledBy) return document.getElementById(labelledBy)?.textContent?.trim() || ''
      return dialog.querySelector('h1,h2,h3,h4,h5,strong,[data-title]')?.textContent?.trim() || ''
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

    function cssEscape(value) {
      if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(value)
      return String(value || '').replace(/[^a-zA-Z0-9_-]/g, '\\$&')
    }
  }, candidate).catch(() => ({ visibleDialogCount: 0, accessibleName: '', closeButtonSelector: '', focusMovedInside: false, focusReturned: false, scrollLocked: false, pageCanScroll: false, dialogRect: null }))
}

function incrementAuditCount(instrumentation, key) {
  if (!instrumentation || typeof instrumentation !== 'object') return
  instrumentation[key] = Number(instrumentation[key] || 0) + 1
}

function textOf(value) {
  return String(value || '').trim()
}

function isModalCloseCandidate(item = {}) {
  if (textOf(item.dataDismiss || item.dataBsDismiss || item.dataDismissTarget)) return true
  if (/dialog-close-control/i.test(textOf(item.uiControlSemantic || item.actionEvidence))) return true
  const text = textOf(`${item.label || ''} ${item.text || ''} ${item.ariaLabel || ''} ${item.title || ''} ${item.className || ''}`).toLowerCase()
  return /\b(close|dismiss|cancel|btn-close)\b|^(x|×)$/.test(text) || /(닫기|취소)/.test(text)
}

export const MODAL_AUDIT_TEST_ONLY = {
  createModalAuditMeta,
  isModalCloseCandidate,
}
