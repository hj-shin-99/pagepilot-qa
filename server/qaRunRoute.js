import { createDeviceDescriptor, normalizeDeviceIds } from '../shared/deviceProfiles.js'
import { normalizeTechScanOptions } from '../shared/techScanOptions.js'
import { createQaProgressReporter } from './qaProgress.js'

export function createQaRunHandler(dependencies) {
  return async function qaRunHandler(req, res) {
    const webUrl = typeof req.body?.webUrl === 'string' ? req.body.webUrl.trim() : ''
    const figmaUrl = typeof req.body?.figmaUrl === 'string' ? req.body.figmaUrl.trim() : ''
    const scanOptions = req.body?.scanOptions
    const devices = req.body?.devices

    if (!dependencies.isHttpUrl(webUrl)) {
      res.status(400).json({ message: 'http:// 또는 https://로 시작하는 Web URL만 사용할 수 있습니다.' })
      return
    }

    const result = await buildQaRunResponse({ webUrl, figmaUrl, scanOptions, devices }, dependencies)
    res.json(result)
  }
}

export function createQaRunStreamHandler(dependencies) {
  return async function qaRunStreamHandler(req, res) {
    const webUrl = typeof req.body?.webUrl === 'string' ? req.body.webUrl.trim() : ''
    const figmaUrl = typeof req.body?.figmaUrl === 'string' ? req.body.figmaUrl.trim() : ''
    const scanOptions = req.body?.scanOptions
    const devices = req.body?.devices

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
      const result = await buildQaRunResponse({ webUrl, figmaUrl, scanOptions, devices, onProgress: writeEvent }, dependencies)
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
  const deviceResults = []
  let visualScanResult = null
  let visualScanError = null

  progressReporter.emitStart()

  for (const deviceId of normalizedDevices) {
    const device = createDeviceDescriptor(deviceId)
    try {
      instrumentation.webScanInvocationCount += 1
      const result = await dependencies.scanUrl(input.webUrl, {
        includeVisualPayloadData: hasFigmaUrl && deviceId === 'desktop',
        includeMobile: true,
        techScanOptions: normalizedScanOptions,
        instrumentation,
        deviceId,
        onProgress: (unitKey) => progressReporter.complete(`${deviceId}:${unitKey}`, device),
      })

      if (dependencies.isWebScanNavigationFailure(result)) {
        deviceResults.push(createFailedDeviceResult(deviceId, result?.navigationError || 'navigation failed', 'navigation'))
        continue
      }

      const decoratedResult = decorateDeviceScanResult(result, deviceId, normalizedDevices)
      deviceResults.push({ ...device, status: 'success', result: decoratedResult, errorType: '', error: '' })
      if (deviceId === 'desktop') visualScanResult = decoratedResult
    } catch (error) {
      deviceResults.push(createFailedDeviceResult(deviceId, error))
    }
  }

  if (hasFigmaUrl && !visualScanResult && !normalizedDevices.includes('desktop')) {
    try {
      instrumentation.webScanInvocationCount += 1
      const result = await dependencies.scanUrl(input.webUrl, {
        includeVisualPayloadData: true,
        includeMobile: true,
        techScanOptions: normalizedScanOptions,
        instrumentation,
        deviceId: 'desktop',
        onProgress: null,
      })

      if (dependencies.isWebScanNavigationFailure(result)) visualScanError = createWebScanFailureMessage(result, null)
      else visualScanResult = decorateDeviceScanResult(result, 'desktop', normalizedDevices)
    } catch (error) {
      visualScanError = createWebScanFailureMessage(null, error)
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
    return response
  }

  response.tech = { status: 'success', result: attachDeviceResults(scanResult, normalizedDevices, deviceResults), error: null }

  if (!hasFigmaUrl) {
    response.visual = { status: 'skipped', result: null, error: null }
    progressReporter.complete('result_prepare')
    response.meta.completedAt = new Date(now()).toISOString()
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
    }, dependencies)
    response.visual = { status: 'success', result: visualResult, error: null }
  } catch (error) {
    response.visual = { status: 'error', result: null, error: createSafeErrorMessage(error, 'Visual QA 생성 중 오류가 발생했습니다.') }
  }

  progressReporter.complete('result_prepare')
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
