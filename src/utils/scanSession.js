export function isValidHttpUrl(value) {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

export function isValidFigmaUrl(value) {
  try {
    const url = new URL(value)
    return url.hostname.includes('figma.com') && (url.protocol === 'http:' || url.protocol === 'https:')
  } catch {
    return false
  }
}

export async function runScanSession({ webUrl, figmaUrl, runTech, runVisual }) {
  const targetUrl = String(webUrl || '').trim()
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
