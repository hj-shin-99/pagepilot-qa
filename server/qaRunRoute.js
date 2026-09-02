import { createDeviceDescriptor, normalizeDeviceIds } from '../shared/deviceProfiles.js'
import { normalizeTechScanOptions } from '../shared/techScanOptions.js'
import { evaluateNavigationIntentQa } from './navigationIntentQa.js'
import { createQaProgressReporter } from './qaProgress.js'

export const MAX_DEVICE_SCAN_CONCURRENCY = 2

export function createQaRunHandler(dependencies) {
  return async function qaRunHandler(req, res) {
    const webUrl = typeof req.body?.webUrl === 'string' ? req.body.webUrl.trim() : ''
    const figmaUrl = typeof req.body?.figmaUrl === 'string' ? req.body.figmaUrl.trim() : ''
    const scanOptions = req.body?.scanOptions
    const devices = req.body?.devices
    const navigationReference = req.body?.navigationReference

    if (!dependencies.isHttpUrl(webUrl)) {
      res.status(400).json({ message: 'http:// 또는 https://로 시작하는 Web URL만 사용할 수 있습니다.' })
      return
    }

    const result = await buildQaRunResponse({ webUrl, figmaUrl, scanOptions, devices, navigationReference, signal: createRequestAbortSignal(req) }, dependencies)
    res.json(result)
  }
}

export function createQaRunStreamHandler(dependencies) {
  return async function qaRunStreamHandler(req, res) {
    const webUrl = typeof req.body?.webUrl === 'string' ? req.body.webUrl.trim() : ''
    const figmaUrl = typeof req.body?.figmaUrl === 'string' ? req.body.figmaUrl.trim() : ''
    const scanOptions = req.body?.scanOptions
    const devices = req.body?.devices
    const navigationReference = req.body?.navigationReference

    if (!dependencies.isHttpUrl(webUrl)) {
      res.status(400).json({ message: 'http:// 또는 https://로 시작하는 Web URL만 사용할 수 있습니다.' })
      return
    }

    res.status(200)
    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8')
    res.setHeader('Cache-Control', 'no-cache, no-transform')
    res.setHeader('X-Accel-Buffering', 'no')
    res.flushHeaders?.()

    const writeEvent = (event) => writeNdjsonEvent(res, event)

    try {
      const result = await buildQaRunResponse({ webUrl, figmaUrl, scanOptions, devices, navigationReference, onProgress: writeEvent, signal: createRequestAbortSignal(req) }, dependencies)
      writeEvent({ type: 'result', result })
    } catch (error) {
      writeEvent({ type: 'error', message: createSafeErrorMessage(error, '통합 검사 요청에 실패했습니다.') })
    } finally {
      if (!res.destroyed && !res.writableEnded) res.end()
    }
  }
}

export async function buildQaRunResponse(input, dependencies) {
  const now = dependencies.now || Date.now
  const startedAtMs = now()
  const wallStartedAtMs = Date.now()
  const startedAt = new Date(startedAtMs).toISOString()
  const hasFigmaUrl = Boolean(input.figmaUrl)
  const normalizedScanOptions = normalizeTechScanOptions(input?.scanOptions)
  const normalizedDevices = normalizeDeviceIds(input?.devices)
  const progressReporter = createQaProgressReporter({
    figmaUrl: input.figmaUrl,
    scanOptions: normalizedScanOptions,
    devices: normalizedDevices,
    onProgress: input?.onProgress,
  })
  const instrumentation = {
    playwrightRunCount: 0,
    browserLaunchCount: 0,
    desktopPageCount: 0,
    tabletPageCount: 0,
    mobilePageCount: 0,
    webScanInvocationCount: 0,
  }
  const timingMetrics = createQaTimingMetrics()
  const deviceConcurrency = Math.min(MAX_DEVICE_SCAN_CONCURRENCY, normalizedDevices.length)
  const useSharedMobileCompatibility = normalizedDevices.length > 1
  let figmaPreparationPromise = null
  let visualScanResult = null
  let visualScanError = null

  const startFigmaPreparation = () => {
    if (!hasFigmaUrl || figmaPreparationPromise || typeof dependencies.prepareVisualFigmaData !== 'function') return null
    const figmaStartedAt = Date.now()
    figmaPreparationPromise = dependencies.prepareVisualFigmaData({
      figmaUrl: input.figmaUrl,
      onProgress: progressReporter.complete,
    }, dependencies).then((prepared) => {
      timingMetrics.figmaPrepareMs = Math.max(0, Date.now() - figmaStartedAt)
      return prepared
    }, (error) => {
      timingMetrics.figmaPrepareMs = Math.max(0, Date.now() - figmaStartedAt)
      throw error
    })
    return figmaPreparationPromise
  }

  progressReporter.emitStart()

  throwIfAborted(input?.signal)

  let deviceResults = await runWithConcurrency(normalizedDevices, deviceConcurrency, async (deviceId) => {
    throwIfAborted(input?.signal)
    return scanDevice({
      deviceId,
      input,
      dependencies,
      normalizedDevices,
      normalizedScanOptions,
      hasFigmaUrl,
      instrumentation,
      progressReporter,
      timingMetrics,
      useSharedMobileCompatibility,
      startFigmaPreparation,
      setVisualScanResult(result) {
        visualScanResult = result
      },
    })
  }, { signal: input?.signal })

  throwIfAborted(input?.signal)

  if (useSharedMobileCompatibility) {
    const sharedMobileResult = await resolveSharedMobileCompatibility({
      input,
      dependencies,
      deviceResults,
      instrumentation,
    })
    if (sharedMobileResult) {
      deviceResults = applySharedMobileCompatibility(deviceResults, sharedMobileResult)
      if (visualScanResult?.deviceId === 'desktop') {
        visualScanResult = replaceMobileCompatibility(visualScanResult, sharedMobileResult)
      }
    }
  }

  if (hasFigmaUrl && !visualScanResult && !normalizedDevices.includes('desktop')) {
    const fallbackDeviceStartedAt = Date.now()
    try {
      timingMetrics.activeDeviceWorkers += 1
      timingMetrics.maxConcurrentDeviceWorkers = Math.max(timingMetrics.maxConcurrentDeviceWorkers, timingMetrics.activeDeviceWorkers)
      instrumentation.webScanInvocationCount += 1
      const result = await dependencies.scanUrl(input.webUrl, {
        includeVisualPayloadData: true,
        includeMobile: !useSharedMobileCompatibility,
        optionalAuditConcurrencyLimit: useSharedMobileCompatibility ? 1 : 2,
        techScanOptions: normalizedScanOptions,
        instrumentation,
        deviceId: 'desktop',
        onProgress: null,
      })

      if (dependencies.isWebScanNavigationFailure(result)) visualScanError = createWebScanFailureMessage(result, null)
      else {
        visualScanResult = decorateDeviceScanResult(result, 'desktop', normalizedDevices)
        startFigmaPreparation()
      }
    } catch (error) {
      visualScanError = createWebScanFailureMessage(null, error)
    } finally {
      timingMetrics.activeDeviceWorkers = Math.max(0, timingMetrics.activeDeviceWorkers - 1)
      timingMetrics.deviceMs.visualDesktop = Math.max(0, Date.now() - fallbackDeviceStartedAt)
    }
  }

  if (input.navigationReference !== undefined) {
    deviceResults = attachNavigationIntentQa(deviceResults, input.navigationReference)
    if (visualScanResult?.deviceId) {
      visualScanResult = deviceResults.find((entry) => entry.deviceId === visualScanResult.deviceId)?.result || visualScanResult
    }
  }

  const successfulDeviceResults = deviceResults.filter((entry) => entry.status === 'success' && entry.result)
  const primaryDeviceResult = successfulDeviceResults.find((entry) => entry.deviceId === 'desktop') || successfulDeviceResults[0] || null
  const scanResult = primaryDeviceResult?.result || null
  const response = {
    meta: {
      webScanInvocationCount: Number(instrumentation.webScanInvocationCount || normalizedDevices.length),
      openAiCalled: false,
      startedAt,
      completedAt: '',
      browserLaunchCount: Number(instrumentation.browserLaunchCount || 0),
      desktopPageCount: Number(instrumentation.desktopPageCount || 0),
      tabletPageCount: Number(instrumentation.tabletPageCount || 0),
      mobilePageCount: Number(instrumentation.mobilePageCount || 0),
      devices: normalizedDevices,
    },
    devices: normalizedDevices,
    deviceResults,
    tech: createEmptyBranch(),
    visual: createEmptyBranch(hasFigmaUrl ? 'error' : 'skipped'),
  }

  if (!scanResult) {
    const message = normalizedDevices.length === 1 && normalizedDevices[0] === 'desktop'
      ? createWebScanFailureMessage(null, deviceResults[0]?.error)
      : deviceResults[0]?.error || 'Web 페이지에 접속하지 못해 Tech QA를 수행할 수 없습니다.'
    response.tech = { status: 'error', result: null, error: message }
    response.visual = hasFigmaUrl
      ? { status: 'error', result: null, error: visualScanError || 'Web 페이지에 접속하지 못해 Visual QA를 수행할 수 없습니다.' }
      : { status: 'skipped', result: null, error: null }
    progressReporter.complete('result_prepare')
    response.meta.completedAt = new Date(now()).toISOString()
    timingMetrics.totalMs = Math.max(0, Date.now() - wallStartedAtMs)
    logQaTiming(timingMetrics, deviceConcurrency, dependencies)
    return response
  }

  response.tech = { status: 'success', result: attachDeviceResults(scanResult, normalizedDevices, deviceResults), error: null }

  if (!hasFigmaUrl) {
    response.visual = { status: 'skipped', result: null, error: null }
    progressReporter.complete('result_prepare')
    response.meta.completedAt = new Date(now()).toISOString()
    timingMetrics.totalMs = Math.max(0, Date.now() - wallStartedAtMs)
    logQaTiming(timingMetrics, deviceConcurrency, dependencies)
    return response
  }

  try {
    const visualResult = await dependencies.buildVisualPayloadFromScanResult({
      figmaUrl: input.figmaUrl,
      webUrl: input.webUrl,
      scanResult: visualScanResult || scanResult,
      debug: false,
      timings: { webScanMs: 0 },
      totalStartedAt: startedAtMs,
      onProgress: progressReporter.complete,
      figmaPreparationPromise,
      onTiming: (timings) => {
        timingMetrics.figmaPrepareMs = timingMetrics.figmaPrepareMs || Number(timings.figmaNodeLoadMs || 0) + Number(timings.figmaRenderLoadMs || 0)
        timingMetrics.visualCompareMs = Number(timings.textCompareMs || 0) + Number(timings.payloadBuildMs || 0)
      },
    }, dependencies)
    response.visual = { status: 'success', result: visualResult, error: null }
  } catch (error) {
    response.visual = { status: 'error', result: null, error: createSafeErrorMessage(error, 'Visual QA 생성 중 오류가 발생했습니다.') }
  }

  progressReporter.complete('result_prepare')
  response.meta.completedAt = new Date(now()).toISOString()
  timingMetrics.totalMs = Math.max(0, Date.now() - wallStartedAtMs)
  logQaTiming(timingMetrics, deviceConcurrency, dependencies)
  return response
}

async function scanDevice({
  deviceId,
  input,
  dependencies,
  normalizedDevices,
  normalizedScanOptions,
  hasFigmaUrl,
  instrumentation,
  progressReporter,
  timingMetrics,
  useSharedMobileCompatibility,
  startFigmaPreparation,
  setVisualScanResult,
}) {
  const device = createDeviceDescriptor(deviceId)
  const deviceStartedAt = Date.now()
  timingMetrics.activeDeviceWorkers += 1
  timingMetrics.maxConcurrentDeviceWorkers = Math.max(timingMetrics.maxConcurrentDeviceWorkers, timingMetrics.activeDeviceWorkers)
  try {
    instrumentation.webScanInvocationCount += 1
    const result = await dependencies.scanUrl(input.webUrl, {
      includeVisualPayloadData: hasFigmaUrl && deviceId === 'desktop',
      includeMobile: !useSharedMobileCompatibility || deviceId === 'mobile',
      optionalAuditConcurrencyLimit: useSharedMobileCompatibility ? 1 : 2,
      techScanOptions: normalizedScanOptions,
      instrumentation,
      deviceId,
      onProgress: (unitKey) => progressReporter.complete(`${deviceId}:${unitKey}`, device),
    })

    if (dependencies.isWebScanNavigationFailure(result)) {
      return createFailedDeviceResult(deviceId, result?.navigationError || 'navigation failed', 'navigation')
    }

    const decoratedResult = decorateDeviceScanResult(result, deviceId, normalizedDevices)
    if (deviceId === 'desktop') {
      setVisualScanResult(decoratedResult)
      startFigmaPreparation()
    }
    return { ...device, status: 'success', result: decoratedResult, errorType: '', error: '' }
  } catch (error) {
    if (error?.name === 'AbortError') throw error
    return createFailedDeviceResult(deviceId, error)
  } finally {
    timingMetrics.activeDeviceWorkers = Math.max(0, timingMetrics.activeDeviceWorkers - 1)
    timingMetrics.deviceMs[deviceId] = Math.max(0, Date.now() - deviceStartedAt)
  }
}

async function resolveSharedMobileCompatibility({ input, dependencies, deviceResults, instrumentation }) {
  const mobileDeviceResult = deviceResults.find((entry) => entry?.deviceId === 'mobile' && entry.status === 'success' && entry.result?.mobile)
  if (mobileDeviceResult?.result?.mobile) return cloneMobileCompatibilityResult(mobileDeviceResult.result.mobile)
  if (typeof dependencies.createMobileCompatibilityResult !== 'function') return null
  return cloneMobileCompatibilityResult(await dependencies.createMobileCompatibilityResult(input.webUrl, instrumentation))
}

function applySharedMobileCompatibility(deviceResults, mobileResult) {
  return deviceResults.map((entry) => {
    if (!entry || entry.status !== 'success' || !entry.result) return entry
    return {
      ...entry,
      result: replaceMobileCompatibility(entry.result, mobileResult),
    }
  })
}

function replaceMobileCompatibility(result, mobileResult) {
  const mobile = cloneMobileCompatibilityResult(mobileResult)
  return {
    ...result,
    mobile,
    checks: replaceMobileCompatibilityChecks(result.checks, mobile),
  }
}

function replaceMobileCompatibilityChecks(checks, mobileResult) {
  if (!Array.isArray(checks)) return checks
  return checks.map((check) => {
    if (check?.id === 'mobile') {
      return {
        ...check,
        status: mobileResult.accessible ? 'ok' : 'error',
        value: mobileResult.statusCode ? String(mobileResult.statusCode) : '응답 없음',
        detail: mobileResult.note,
      }
    }
    if (check?.id === 'mobile-overflow') {
      return {
        ...check,
        status: mobileResult.hasHorizontalOverflow ? 'warn' : 'ok',
        value: mobileResult.hasHorizontalOverflow ? `${mobileResult.documentWidth}px / viewport ${mobileResult.viewportWidth}px` : '가로 넘침 없음',
        detail: mobileResult.hasHorizontalOverflow ? '모바일 화면 너비보다 문서가 넓어 가로 스크롤이 생길 수 있습니다.' : '모바일 viewport 기준 가로 넘침이 감지되지 않았습니다.',
      }
    }
    return check
  })
}

function cloneMobileCompatibilityResult(mobileResult) {
  if (!mobileResult || typeof mobileResult !== 'object') return null
  return {
    ...mobileResult,
    viewport: mobileResult.viewport && typeof mobileResult.viewport === 'object' ? { ...mobileResult.viewport } : mobileResult.viewport,
  }
}

export async function runWithConcurrency(items, limit, worker, options = {}) {
  const safeItems = Array.isArray(items) ? items : []
  const safeLimit = Math.max(1, Math.min(Number(limit) || 1, safeItems.length || 1))
  const results = new Array(safeItems.length)
  let nextIndex = 0

  async function runWorker() {
    while (nextIndex < safeItems.length) {
      throwIfAborted(options.signal)
      const currentIndex = nextIndex
      nextIndex += 1
      results[currentIndex] = await worker(safeItems[currentIndex], currentIndex)
    }
  }

  const settlements = await Promise.allSettled(Array.from({ length: Math.min(safeLimit, safeItems.length) }, () => runWorker()))
  const rejection = settlements.find((settled) => settled.status === 'rejected')
  if (rejection) throw rejection.reason
  return results
}

function createRequestAbortSignal(req) {
  if (!req || typeof AbortController !== 'function') return null
  const controller = new AbortController()
  const abort = () => controller.abort(createAbortError())
  if (req.aborted === true || req.destroyed === true) abort()
  else req.once?.('aborted', abort)
  return controller.signal
}

function throwIfAborted(signal) {
  if (!signal?.aborted) return
  throw signal.reason instanceof Error ? signal.reason : createAbortError()
}

function createAbortError() {
  const error = new Error('QA request aborted')
  error.name = 'AbortError'
  return error
}

function createQaTimingMetrics() {
  return {
    totalMs: 0,
    activeDeviceWorkers: 0,
    maxConcurrentDeviceWorkers: 0,
    deviceMs: {},
    figmaPrepareMs: 0,
    visualCompareMs: 0,
    aiReviewMs: 0,
    resultFinalizationMs: 0,
  }
}

function logQaTiming(metrics, deviceConcurrency, dependencies) {
  if (!shouldLogQaTiming(dependencies)) return
  const deviceMs = metrics.deviceMs || {}
  console.info([
    '[QA Timing]',
    `totalMs=${Number(metrics.totalMs || 0)}`,
    `deviceConcurrency=${Number(deviceConcurrency || 0)}`,
    `maxConcurrentDeviceWorkers=${Number(metrics.maxConcurrentDeviceWorkers || 0)}`,
    `desktopMs=${Number(deviceMs.desktop || 0)}`,
    `tabletMs=${Number(deviceMs.tablet || 0)}`,
    `mobileMs=${Number(deviceMs.mobile || 0)}`,
    `figmaPrepareMs=${Number(metrics.figmaPrepareMs || 0)}`,
    `visualCompareMs=${Number(metrics.visualCompareMs || 0)}`,
    `aiReviewMs=${Number(metrics.aiReviewMs || 0)}`,
    `resultFinalizationMs=${Number(metrics.resultFinalizationMs || 0)}`,
  ].join('\n'))
}

function shouldLogQaTiming(dependencies) {
  if (dependencies?.debugQaTiming === true) return true
  return process.env.NODE_ENV === 'development' && process.env.QA_TIMING_LOG !== 'false'
}

export function isWebScanNavigationFailure(scanResult) {
  if (!scanResult || typeof scanResult !== 'object') return true
  return !scanResult.httpStatus && Boolean(scanResult.navigationError)
}

function createEmptyBranch(status = 'idle') {
  return { status, result: null, error: null }
}

function decorateDeviceScanResult(result, deviceId, devices) {
  const device = createDeviceDescriptor(deviceId)
  return {
    ...result,
    devices,
    device,
    deviceId: device.deviceId,
    deviceLabel: device.deviceLabel,
    viewport: device.viewport,
    hasTouch: device.hasTouch,
    isMobile: device.isMobile,
  }
}

function attachDeviceResults(result, devices, deviceResults) {
  if (!result) return result
  return {
    ...result,
    devices,
    deviceResults,
  }
}

function attachNavigationIntentQa(deviceResults, navigationReference) {
  return deviceResults.map((entry) => {
    if (!entry || entry.status !== 'success' || !entry.result) return entry
    return {
      ...entry,
      result: attachNavigationIntentQaToResult(entry.result, navigationReference, entry.deviceId),
    }
  })
}

function attachNavigationIntentQaToResult(result, navigationReference, deviceId) {
  try {
    return {
      ...result,
      navigationIntentQa: evaluateNavigationIntentQa(navigationReference, result, { baseUrl: result.targetUrl, device: deviceId || result.deviceId }),
    }
  } catch (error) {
    return {
      ...result,
      navigationIntentQa: {
        summary: { evaluated: 0, correct: 0, mismatch: 0, review: 1, notObserved: 0 },
        items: [],
        meta: { available: false, reason: createSafeErrorMessage(error, 'navigation-intent-evaluator-failed') },
      },
    }
  }
}

function createFailedDeviceResult(deviceId, error, forcedType = '') {
  const device = createDeviceDescriptor(deviceId)
  const errorType = forcedType || classifyDeviceError(error)
  return {
    ...device,
    status: 'error',
    result: null,
    errorType,
    error: createDeviceFailureMessage(errorType, error),
  }
}

function classifyDeviceError(error) {
  const message = error instanceof Error ? error.message : String(error || '')
  if (/timeout|timed\s*out/i.test(message)) return 'timeout'
  if (/net::|network|dns|connection|ECONN|ENOTFOUND|ERR_/i.test(message)) return 'network'
  if (/context|browser|target closed|has been closed/i.test(message)) return 'browser context'
  if (/unsupported/i.test(message)) return 'unsupported'
  if (/navigation|goto|navigate/i.test(message)) return 'navigation'
  return 'unknown'
}

function createDeviceFailureMessage(errorType, error) {
  const detail = createSafeErrorMessage(error, '')
  const reason = ['navigation', 'timeout', 'network', 'browser context', 'unsupported', 'unknown'].includes(errorType) ? errorType : 'unknown'
  return detail ? `해당 기기 환경을 검사할 수 없습니다. (${reason}: ${detail})` : `해당 기기 환경을 검사할 수 없습니다. (${reason})`
}

function createWebScanFailureMessage(scanResult, scanError) {
  if (scanError instanceof Error && scanError.message) return `Web 페이지에 접속하지 못해 Tech QA를 수행할 수 없습니다. (${createSafeErrorMessage(scanError)})`
  if (scanResult?.navigationError) return `Web 페이지에 접속하지 못해 Tech QA를 수행할 수 없습니다. (${createSafeErrorMessage(scanResult.navigationError)})`
  return 'Web 페이지에 접속하지 못해 Tech QA를 수행할 수 없습니다.'
}

function createSafeErrorMessage(error, fallback = 'Unknown scan error') {
  const message = error instanceof Error ? error.message : String(error || '')
  return message
    .split('\n')
    .filter((line) => !/^\s*at\s+/.test(line))
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 2)
    .join(' ')
    .slice(0, 220) || fallback
}

function writeNdjsonEvent(res, event) {
  if (res.destroyed || res.writableEnded) return
  try {
    res.write(`${JSON.stringify(event)}\n`)
  } catch {
    // Client disconnects should not interrupt the scan lifecycle.
  }
}
