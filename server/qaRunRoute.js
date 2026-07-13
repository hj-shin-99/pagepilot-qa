export function createQaRunHandler(dependencies) {
  return async function qaRunHandler(req, res) {
    const webUrl = typeof req.body?.webUrl === 'string' ? req.body.webUrl.trim() : ''
    const figmaUrl = typeof req.body?.figmaUrl === 'string' ? req.body.figmaUrl.trim() : ''

    if (!dependencies.isHttpUrl(webUrl)) {
      res.status(400).json({ message: 'http:// 또는 https://로 시작하는 Web URL만 사용할 수 있습니다.' })
      return
    }

    const result = await buildQaRunResponse({ webUrl, figmaUrl }, dependencies)
    res.json(result)
  }
}

export async function buildQaRunResponse(input, dependencies) {
  const now = dependencies.now || Date.now
  const startedAtMs = now()
  const startedAt = new Date(startedAtMs).toISOString()
  const hasFigmaUrl = Boolean(input.figmaUrl)
  const instrumentation = {
    playwrightRunCount: 0,
    browserLaunchCount: 0,
    desktopPageCount: 0,
    mobilePageCount: 0,
  }
  let scanResult = null
  let scanError = null

  try {
    scanResult = await dependencies.scanUrl(input.webUrl, {
      includeVisualPayloadData: hasFigmaUrl,
      includeMobile: true,
      instrumentation,
    })
  } catch (error) {
    scanError = error
  }

  const webScanFailed = Boolean(scanError) || dependencies.isWebScanNavigationFailure(scanResult)
  const response = {
    meta: {
      webScanInvocationCount: 1,
      openAiCalled: false,
      startedAt,
      completedAt: '',
      browserLaunchCount: Number(instrumentation.browserLaunchCount || 0),
      desktopPageCount: Number(instrumentation.desktopPageCount || 0),
      mobilePageCount: Number(instrumentation.mobilePageCount || 0),
    },
    tech: createEmptyBranch(),
    visual: createEmptyBranch(hasFigmaUrl ? 'error' : 'skipped'),
  }

  if (webScanFailed) {
    const message = createWebScanFailureMessage(scanResult, scanError)
    response.tech = { status: 'error', result: null, error: message }
    response.visual = hasFigmaUrl
      ? { status: 'error', result: null, error: 'Web 페이지에 접속하지 못해 Visual QA를 수행할 수 없습니다.' }
      : { status: 'skipped', result: null, error: null }
    response.meta.completedAt = new Date(now()).toISOString()
    return response
  }

  response.tech = { status: 'success', result: scanResult, error: null }

  if (!hasFigmaUrl) {
    response.visual = { status: 'skipped', result: null, error: null }
    response.meta.completedAt = new Date(now()).toISOString()
    return response
  }

  try {
    const visualResult = await dependencies.buildVisualPayloadFromScanResult({
      figmaUrl: input.figmaUrl,
      webUrl: input.webUrl,
      scanResult,
      debug: false,
      timings: { webScanMs: 0 },
      totalStartedAt: startedAtMs,
    }, dependencies)
    response.visual = { status: 'success', result: visualResult, error: null }
  } catch (error) {
    response.visual = { status: 'error', result: null, error: error instanceof Error ? error.message : 'Visual QA 생성 중 오류가 발생했습니다.' }
  }

  response.meta.completedAt = new Date(now()).toISOString()
  return response
}

export function isWebScanNavigationFailure(scanResult) {
  if (!scanResult || typeof scanResult !== 'object') return true
  return !scanResult.httpStatus && Boolean(scanResult.navigationError)
}

function createEmptyBranch(status = 'idle') {
  return { status, result: null, error: null }
}

function createWebScanFailureMessage(scanResult, scanError) {
  if (scanError instanceof Error && scanError.message) return `Web 페이지에 접속하지 못해 Tech QA를 수행할 수 없습니다. (${scanError.message})`
  if (scanResult?.navigationError) return `Web 페이지에 접속하지 못해 Tech QA를 수행할 수 없습니다. (${scanResult.navigationError})`
  return 'Web 페이지에 접속하지 못해 Tech QA를 수행할 수 없습니다.'
}
