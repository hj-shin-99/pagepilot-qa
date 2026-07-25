const FORM_AUDIT_TIMEOUT_MS = 6000
const MAX_FORM_CANDIDATES = 18

export async function auditForms(browser, targetUrl, instrumentation = null) {
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 1280, height: 720 },
    serviceWorkers: 'block',
  })

  try {
    await blockMutatingRequests(context)
    const page = await context.newPage()
    incrementAuditCount(instrumentation, 'formAuditPageCount')
    const candidateSnapshot = await collectFormAuditCandidates(page, targetUrl)
    await page.close().catch(() => {})

    if (candidateSnapshot.items.length === 0) {
      return { items: [], meta: createFormAuditMeta([], { candidateCount: 0, noTarget: true }) }
    }

    const items = []
    for (const candidate of candidateSnapshot.items.slice(0, MAX_FORM_CANDIDATES)) {
      if (candidate.skipReason || candidate.kind === 'form-summary') {
        items.push(classifyFormAuditItem(candidate, { skipped: true }))
        continue
      }
      const pageForCandidate = await context.newPage()
      incrementAuditCount(instrumentation, 'formAuditPageCount')
      try {
        items.push(await inspectFormCandidate(pageForCandidate, targetUrl, candidate))
      } finally {
        await pageForCandidate.close().catch(() => {})
      }
    }

    return {
      items,
      meta: createFormAuditMeta(items, { candidateCount: candidateSnapshot.candidateCount }),
    }
  } finally {
    await context.close().catch(() => {})
  }
}

export function classifyFormAuditItem(candidate = {}, observation = {}) {
  const issues = []
  const staticIssues = Array.isArray(candidate.staticIssues) ? candidate.staticIssues : []
  const validationState = observation.validationState || {}
  const submitAttempted = observation.submitAttempted === true
  const networkRequestCount = Number(observation.networkRequestCount || 0)
  const validationSignals = []

  if (candidate.skipReason || observation.skipped === true || candidate.kind === 'form-summary') {
    return {
      ...candidate,
      status: 'info',
      category: 'skipped',
      note: candidate.skipReason || candidate.note || '안전 정책으로 검사를 생략했습니다.',
      validationState,
      validationMessage: observation.validationMessage || '',
      ariaInvalid: observation.ariaInvalid || candidate.ariaInvalid || '',
      submitAttempted,
      submitBlocked: observation.submitBlocked !== false,
      networkRequestCount,
      requestMethods: observation.requestMethods || [],
    }
  }

  issues.push(...staticIssues)

  if (candidate.required === true && observation.requiredChecked === true) {
    if (validationState.valueMissing === true || observation.invalidEventCount > 0 || textOf(observation.validationMessage)) validationSignals.push('required validation 확인')
    else issues.push('required 필드의 브라우저 validation 반응을 확인하지 못했습니다.')
  }

  if (candidate.inputType === 'email' && observation.emailChecked === true) {
    if (validationState.typeMismatch === true || observation.invalidEventCount > 0 || textOf(observation.validationMessage)) validationSignals.push('email 형식 validation 확인')
    else issues.push('이메일 형식 validation 반응을 확인하지 못했습니다.')
  }

  if ((candidate.inputType === 'tel' || candidate.hasPattern === true) && observation.telChecked === true) {
    if (validationState.patternMismatch === true || validationState.typeMismatch === true || observation.invalidEventCount > 0 || textOf(observation.validationMessage)) validationSignals.push('전화번호 또는 pattern validation 확인')
    else if (candidate.hasPattern === true) issues.push('전화번호 또는 pattern validation 반응을 확인하지 못했습니다.')
  }

  if (submitAttempted !== true && candidate.hasSubmitButton === true && candidate.required === true) issues.push('빈 상태 submit 반응을 확인하지 못했습니다.')
  if (candidate.hasSubmitButton === false && candidate.kind !== 'form-control') issues.push('submit 역할 버튼이 없습니다.')
  if (networkRequestCount > 0) issues.push('실제 네트워크 전송 시도가 감지되었습니다.')

  const error = textOf(observation.error)
  const note = error
    ? '폼 검사 중 오류가 발생했습니다.'
    : issues.length > 0
      ? issues[0]
      : validationSignals.length > 0
        ? validationSignals.join(' · ')
        : candidate.note || '입력 필드와 유효성 반응이 정상적으로 확인되었습니다.'

  return {
    ...candidate,
    status: error || networkRequestCount > 0 ? 'error' : issues.length > 0 ? 'warn' : 'ok',
    category: error ? 'form-audit-error' : networkRequestCount > 0 ? 'submit-not-blocked' : issues.length > 0 ? 'needs-review' : 'form-ok',
    note,
    issues,
    validationState,
    validationMessage: observation.validationMessage || '',
    ariaInvalid: observation.ariaInvalid || candidate.ariaInvalid || '',
    focusedSelector: observation.focusedSelector || '',
    submitAttempted,
    submitBlocked: observation.submitBlocked !== false,
    networkRequestCount,
    requestMethods: observation.requestMethods || [],
    invalidEventCount: Number(observation.invalidEventCount || 0),
    submitSelector: candidate.submitSelector || '',
  }
}

function createFormAuditMeta(items = [], context = {}) {
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

async function inspectFormCandidate(page, targetUrl, candidate) {
  let nonGetRequestCount = 0
  const requestMethods = []
  page.on('request', (request) => {
    const method = String(request.method() || '').toUpperCase()
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
      nonGetRequestCount += 1
      requestMethods.push(method)
    }
  })

  await installFormProbe(page)
  await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: FORM_AUDIT_TIMEOUT_MS })
  const observation = await page.evaluate(async (sourceCandidate) => {
    const control = document.querySelector(sourceCandidate.selector)
    const state = window.__pagepilotFormAudit || { invalidEvents: [], submitEvents: [], focusedSelector: '' }
    if (!control) {
      return { error: 'field-not-found' }
    }

    const form = control.form || (sourceCandidate.formSelector ? document.querySelector(sourceCandidate.formSelector) : null)
    const originalValue = 'value' in control ? control.value : ''
    const originalChecked = 'checked' in control ? control.checked : false
    const originalSelectedIndex = 'selectedIndex' in control ? control.selectedIndex : -1
    let validationMessage = ''
    const validationState = {
      valid: Boolean(control.validity?.valid),
      valueMissing: Boolean(control.validity?.valueMissing),
      typeMismatch: Boolean(control.validity?.typeMismatch),
      patternMismatch: Boolean(control.validity?.patternMismatch),
    }

    function restoreControl() {
      if ('value' in control) control.value = originalValue
      if ('checked' in control) control.checked = originalChecked
      if ('selectedIndex' in control && originalSelectedIndex >= 0) control.selectedIndex = originalSelectedIndex
      form?.reset?.()
    }

    function recordValidity() {
      validationMessage = control.validationMessage || validationMessage
      validationState.valid = Boolean(control.validity?.valid)
      validationState.valueMissing = Boolean(control.validity?.valueMissing)
      validationState.typeMismatch = Boolean(control.validity?.typeMismatch)
      validationState.patternMismatch = Boolean(control.validity?.patternMismatch)
    }

    let requiredChecked = false
    let emailChecked = false
    let telChecked = false
    let submitAttempted = false
    let submitBlocked = false

    if (sourceCandidate.required === true && !sourceCandidate.disabled && !sourceCandidate.readOnly && !sourceCandidate.isCheckbox && !sourceCandidate.isRadio) {
      requiredChecked = true
      control.focus()
      if ('value' in control) control.value = ''
      control.checkValidity()
      recordValidity()
    }

    if (sourceCandidate.inputType === 'email' && !sourceCandidate.disabled && !sourceCandidate.readOnly) {
      emailChecked = true
      control.focus()
      control.value = 'invalid-email'
      control.dispatchEvent(new Event('input', { bubbles: true }))
      control.dispatchEvent(new Event('change', { bubbles: true }))
      control.checkValidity()
      recordValidity()
    }

    if ((sourceCandidate.inputType === 'tel' || sourceCandidate.hasPattern === true) && !sourceCandidate.disabled && !sourceCandidate.readOnly && !sourceCandidate.isCheckbox && !sourceCandidate.isRadio) {
      telChecked = true
      control.focus()
      control.value = 'invalid-pattern-value'
      control.dispatchEvent(new Event('input', { bubbles: true }))
      control.dispatchEvent(new Event('change', { bubbles: true }))
      control.checkValidity()
      recordValidity()
    }

    const submitTarget = sourceCandidate.submitSelector ? document.querySelector(sourceCandidate.submitSelector) : null
    if (submitTarget) {
      try {
        submitTarget.click()
        await new Promise((resolve) => setTimeout(resolve, 120))
        submitAttempted = state.submitEvents.length > 0 || state.invalidEvents.length > 0
        submitBlocked = state.submitEvents.some((event) => event.formSelector === sourceCandidate.formSelector)
      } catch {
        submitAttempted = false
      }
    }

    recordValidity()
    const invalidEventCount = state.invalidEvents.filter((entry) => entry.selector === sourceCandidate.selector).length
    const focusedSelector = state.focusedSelector || ''
    const ariaInvalid = control.getAttribute('aria-invalid') || ''
    restoreControl()
    return {
      requiredChecked,
      emailChecked,
      telChecked,
      submitAttempted,
      submitBlocked,
      invalidEventCount,
      focusedSelector,
      ariaInvalid,
      validationMessage,
      validationState,
    }
  }, candidate).catch((error) => ({ error: error instanceof Error ? error.message : 'form audit failed' }))

  return classifyFormAuditItem(candidate, { ...observation, networkRequestCount: nonGetRequestCount, requestMethods })
}

async function collectFormAuditCandidates(page, targetUrl) {
  await installFormProbe(page)
  await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: FORM_AUDIT_TIMEOUT_MS })
  return page.evaluate(() => {
    const items = []
    const forms = Array.from(document.querySelectorAll('form'))
    const standaloneControls = Array.from(document.querySelectorAll('input:not([type="hidden"]), textarea, select')).filter((control) => !control.form)
    const sources = forms.length > 0 ? forms.map((form) => ({ form, controls: Array.from(form.querySelectorAll('input:not([type="hidden"]), textarea, select')) })) : []
    if (standaloneControls.length > 0) sources.push({ form: null, controls: standaloneControls })

    sources.forEach(({ form, controls }, sourceIndex) => {
      const formSelector = form ? getCssSelector(form) : ''
      const formLabel = form ? getFormLabel(form) : '독립 입력 요소'
      const searchableText = [formLabel, form?.action || '', form?.method || '', ...controls.map((control) => `${getAccessibleName(control)} ${control.getAttribute('name') || ''} ${control.getAttribute('placeholder') || ''} ${control.getAttribute('autocomplete') || ''}`)].join(' ')
      const hasPassword = controls.some((control) => (control.getAttribute('type') || '').toLowerCase() === 'password')
      const hasCaptcha = /captcha|recaptcha|hcaptcha|turnstile|verification|otp|sms|phone verification|identity/i.test(searchableText) || /(캡차|인증|본인인증|휴대폰 인증|문자 인증|보안문자)/i.test(searchableText)
      const riskyReason = hasPassword || /login|log in|sign in|sign up|register|password|passwd|payment|pay|card|cvv|checkout|order|purchase|billing|account|consult|contact|apply|reserve|booking|delete|remove|logout|member|profile|email verification|otp|sms/i.test(searchableText) || /(로그인|회원가입|비밀번호|결제|카드|주문|구매|청구|계정|상담|문의|신청|예약|삭제|탈퇴|로그아웃|이메일 인증|문자 인증|본인인증)/i.test(searchableText)
        ? '실제 개인정보 입력 또는 제출 위험이 있는 폼이라 자동 입력 검사를 생략했습니다.'
        : ''
      const submitButton = form ? form.querySelector('button[type="submit"], input[type="submit"], button:not([type]), [role="button"][type="submit"]') : null

      if (form && !submitButton && controls.length > 0) {
        items.push({
          auditId: `form-summary-${sourceIndex + 1}`,
          kind: 'form-summary',
          label: formLabel,
          title: formLabel,
          selector: formSelector,
          formSelector,
          formId: form.id || '',
          section: estimateSection(form),
          hasSubmitButton: false,
          staticIssues: ['submit 역할 버튼이 없습니다.'],
          note: 'submit 역할 버튼이 없어 기본 제출 동작을 확인할 수 없습니다.',
        })
      }

      controls.forEach((control, controlIndex) => {
        const inputType = (control.getAttribute('type') || control.tagName.toLowerCase()).toLowerCase()
        const label = getAccessibleName(control) || `${inputType} ${controlIndex + 1}`
        const name = control.getAttribute('name') || ''
        const hasLabel = hasProgrammaticLabel(control)
        const hasAccessibleName = Boolean(getAccessibleName(control))
        const placeholder = control.getAttribute('placeholder') || ''
        const autocomplete = control.getAttribute('autocomplete') || ''
        const isCheckbox = inputType === 'checkbox'
        const isRadio = inputType === 'radio'
        const staticIssues = []
        const skipReason = inputType === 'file'
          ? '파일 input은 안전 정책상 조작하지 않습니다.'
          : hasCaptcha
            ? 'CAPTCHA 또는 본인인증 요소가 포함되어 자동 입력 검사를 생략합니다.'
            : riskyReason
        if (!hasLabel && !hasAccessibleName) staticIssues.push(isCheckbox || isRadio ? '체크박스 또는 라디오의 label 연결이 없습니다.' : 'label 또는 접근성 이름이 없습니다.')
        if (!name && !isCheckbox && !isRadio) staticIssues.push('name 속성이 없습니다.')
        if (!hasLabel && !hasAccessibleName && placeholder) staticIssues.push('placeholder만 label 대신 사용하고 있습니다.')
        if (requiresAutocomplete(inputType) && !autocomplete) staticIssues.push('autocomplete 설정이 없습니다.')

        items.push({
          auditId: `${formSelector || 'standalone'}-${controlIndex + 1}`,
          kind: 'form-control',
          label,
          title: label,
          name,
          selector: getCssSelector(control),
          formSelector,
          formId: form?.id || '',
          submitSelector: submitButton ? getCssSelector(submitButton) : '',
          section: estimateSection(control),
          tagName: control.tagName.toLowerCase(),
          inputType,
          required: control.required === true,
          disabled: control.disabled === true,
          readOnly: control.readOnly === true,
          placeholder,
          autocomplete,
          hasPattern: Boolean(control.getAttribute('pattern')),
          pattern: control.getAttribute('pattern') || '',
          ariaInvalid: control.getAttribute('aria-invalid') || '',
          hasLabel,
          hasAccessibleName,
          hasSubmitButton: Boolean(submitButton),
          usesPlaceholderOnly: !hasLabel && !hasAccessibleName && Boolean(placeholder),
          isCheckbox,
          isRadio,
          staticIssues,
          skipReason,
          note: '입력 필드와 브라우저 validation 상태를 확인했습니다.',
        })
      })
    })

    return { items, candidateCount: items.length }

    function getFormLabel(form) {
      return normalizeText(form.getAttribute('aria-label') || '')
        || normalizeText(form.querySelector('legend,h1,h2,h3,h4,label')?.textContent || '')
        || form.getAttribute('id')
        || '폼'
    }

    function requiresAutocomplete(inputType) {
      return ['text', 'email', 'tel', 'search', 'url', 'password'].includes(String(inputType || '').toLowerCase())
    }

    function hasProgrammaticLabel(control) {
      const id = control.getAttribute('id') || ''
      if (id && document.querySelector(`label[for="${cssEscape(id)}"]`)) return true
      if (control.closest('label')) return true
      if (normalizeText(control.getAttribute('aria-labelledby') || '')) return true
      return false
    }

    function getAccessibleName(control) {
      return normalizeText(control.getAttribute('aria-label') || '')
        || normalizeText(control.getAttribute('aria-labelledby') || '')
        || normalizeText((() => {
          const id = control.getAttribute('id') || ''
          return id ? document.querySelector(`label[for="${cssEscape(id)}"]`)?.textContent || '' : ''
        })())
        || normalizeText(control.closest('label')?.textContent || '')
        || normalizeText(control.getAttribute('title') || '')
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

    function cssEscape(value) {
      if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(value)
      return String(value || '').replace(/[^a-zA-Z0-9_-]/g, '\\$&')
    }
  }).catch(() => ({ items: [], candidateCount: 0 }))
}

async function installFormProbe(page) {
  await page.addInitScript(() => {
    window.__pagepilotFormAudit = { invalidEvents: [], submitEvents: [], focusedSelector: '' }
    document.addEventListener('invalid', (event) => {
      const target = event.target
      if (!(target instanceof HTMLElement)) return
      window.__pagepilotFormAudit.invalidEvents.push({
        selector: getCssSelector(target),
        message: 'validationMessage' in target ? String(target.validationMessage || '') : '',
      })
    }, true)
    document.addEventListener('submit', (event) => {
      const target = event.target
      window.__pagepilotFormAudit.submitEvents.push({
        formSelector: target instanceof HTMLElement ? getCssSelector(target) : '',
      })
      event.preventDefault()
    }, true)
    document.addEventListener('focusin', (event) => {
      const target = event.target
      if (!(target instanceof HTMLElement)) return
      window.__pagepilotFormAudit.focusedSelector = getCssSelector(target)
    }, true)

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
  })
}

async function blockMutatingRequests(context) {
  await context.route('**/*', async (route) => {
    const method = String(route.request().method() || '').toUpperCase()
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
      await route.abort('blockedbyclient')
      return
    }
    await route.continue()
  })
}

function incrementAuditCount(instrumentation, key) {
  if (!instrumentation || typeof instrumentation !== 'object') return
  instrumentation[key] = Number(instrumentation[key] || 0) + 1
}

function textOf(value) {
  return String(value || '').trim()
}

export const FORM_AUDIT_TEST_ONLY = {
  createFormAuditMeta,
}
