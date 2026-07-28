export function createPublicWebUrlState(value) {
  const rawValue = String(value || '')
  const trimmedValue = rawValue.trim()
  const normalizedCandidate = createNormalizedWebUrlCandidate(trimmedValue)
  const isValid = isValidWebUrlCandidate(normalizedCandidate)

  return {
    rawValue,
    normalizedCandidate,
    normalizedUrl: isValid ? normalizedCandidate : '',
    isValid,
  }
}

export function isValidHttpUrl(value) {
  return isValidWebUrl(value)
}

export function isValidWebUrl(value) {
  const normalizedCandidate = createNormalizedWebUrlCandidate(String(value || '').trim())
  return isValidWebUrlCandidate(normalizedCandidate)
}

export function normalizeWebUrlInput(value) {
  const state = createPublicWebUrlState(value)
  return state.isValid ? state.normalizedUrl : state.rawValue.trim()
}

export function createWebUrlInputState(value, { isConfirmed = false } = {}) {
  const state = createPublicWebUrlState(value)
  return {
    ...state,
    isSyntacticallyValid: state.isValid,
    isConfirmed: Boolean(isConfirmed && state.isValid),
  }
}

export function confirmWebUrlInput(value) {
  const state = createPublicWebUrlState(value)
  return {
    ...state,
    inputValue: state.isValid ? state.normalizedUrl : state.rawValue.trim(),
    isConfirmed: state.isValid,
  }
}

function createNormalizedWebUrlCandidate(value) {
  if (!value) return ''
  if (/^[a-z][a-z\d+.-]*:/i.test(value)) return value
  return `https://${value}`
}

function isValidWebUrlCandidate(value) {
  if (!value || hasDuplicateHttpProtocol(value) || hasBlockedProtocol(value)) return false

  try {
    const url = new URL(value)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
    if (url.username || url.password) return false
    if (url.port) {
      const port = Number(url.port)
      if (!Number.isInteger(port) || port < 1 || port > 65535) return false
    }
    return isValidPublicHostname(url.hostname)
  } catch {
    return false
  }
}

function hasBlockedProtocol(value) {
  return /^(?:javascript|data|file|mailto|tel):/i.test(value)
}

function isValidPublicHostname(hostname) {
  if (!hostname || hostname.length > 253 || /\s/.test(hostname)) return false
  if (!hostname.includes('.') || hostname.startsWith('.') || hostname.endsWith('.') || hostname.includes('..')) return false
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname)) return false

  const labels = hostname.split('.')
  const tld = labels.at(-1)
  if (!tld || tld.length < 2 || !/^[a-z]+$/i.test(tld)) return false
  if (labels.length === 2 && labels[0].toLowerCase() === 'www') return false
  return labels.every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label))
}

function hasDuplicateHttpProtocol(value) {
  return /^https?:\/\/https?:\/\//i.test(value)
}

export function isValidFigmaUrl(value) {
  try {
    const url = new URL(value)
    const hostname = url.hostname.toLowerCase()
    return (url.protocol === 'http:' || url.protocol === 'https:') && (hostname === 'figma.com' || hostname.endsWith('.figma.com'))
  } catch {
    return false
  }
}

export async function runScanSession({ webUrl, figmaUrl, runTech, runVisual }) {
  const targetUrl = normalizeWebUrlInput(webUrl)
  const frameUrl = String(figmaUrl || '').trim()
  const hasFigmaUrl = Boolean(frameUrl)
  const canRunVisual = hasFigmaUrl && isValidFigmaUrl(frameUrl)

  if (!isValidHttpUrl(targetUrl)) {
    return {
      ok: false,
      inputError: 'http:// 또는 https://로 시작하는 Web URL을 입력해 주세요.',
      activeTab: 'tech',
      tech: { status: 'idle', result: null, error: '' },
      visual: { status: hasFigmaUrl ? 'error' : 'skipped', result: null, error: hasFigmaUrl ? 'Figma Frame URL 형식을 확인해 주세요.' : '' },
      shouldSaveCombined: false,
      webUrl: targetUrl,
      figmaUrl: frameUrl,
    }
  }

  const tasks = [{ key: 'tech', run: () => runTech(targetUrl) }]
  if (canRunVisual) tasks.push({ key: 'visual', run: () => runVisual(targetUrl, frameUrl) })

  const settled = await Promise.allSettled(tasks.map((task) => task.run()))
  const taskResults = new Map(tasks.map((task, index) => [task.key, settled[index]]))
  const tech = createSettledState(taskResults.get('tech'), 'Tech QA 검사 중 오류가 발생했습니다.')
  const visual = canRunVisual
    ? createSettledState(taskResults.get('visual'), 'Visual QA 검사 중 오류가 발생했습니다.')
    : {
        status: hasFigmaUrl ? 'error' : 'skipped',
        result: null,
        error: hasFigmaUrl ? 'Figma Frame URL 형식을 확인해 주세요.' : '',
      }

  return {
    ok: tech.status === 'success' || visual.status === 'success',
    inputError: '',
    figmaError: hasFigmaUrl && !canRunVisual ? 'Figma Frame URL 형식을 확인해 주세요.' : '',
    activeTab: hasFigmaUrl ? 'visual' : 'tech',
    tech,
    visual,
    shouldSaveCombined: canRunVisual,
    webUrl: targetUrl,
    figmaUrl: frameUrl,
  }
}

function createSettledState(settlement, fallbackMessage) {
  if (settlement?.status === 'fulfilled') return { status: 'success', result: settlement.value, error: '' }
  const reason = settlement?.reason
  return {
    status: 'error',
    result: null,
    error: reason instanceof Error ? reason.message : fallbackMessage,
  }
}
