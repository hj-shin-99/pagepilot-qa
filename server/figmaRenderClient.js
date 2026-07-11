import { createFigmaRenderCache } from './figmaRenderCache.js'
import { FigmaApiError, FigmaRateLimitError } from './figmaApiClient.js'
import { maskFigmaFileKey } from './figmaCache.js'

const FIGMA_API_BASE_URL = 'https://api.figma.com/v1'
const DEFAULT_MAX_BYTES = 20 * 1024 * 1024

export function createFigmaRenderClient(options = {}) {
  const fetchImpl = options.fetchImpl || fetch
  const logger = options.logger || console
  const cache = options.cache || createFigmaRenderCache({ ttlMs: options.ttlMs, cacheDir: options.cacheDir })
  const maxBytes = normalizeMaxBytes(options.maxBytes)
  const inFlightRequests = new Map()

  return {
    cache,
    getFigmaRenderedImage,
    getLocalRenderFile,
    clearCache,
    clearAllCache,
  }

  async function getFigmaRenderedImage({ fileKey, nodeId, token, nodeName = '이름 없음', format = 'png', scale = 2, forceRefresh = false }) {
    const normalizedFormat = normalizeFormat(format)
    const normalizedScale = normalizeScale(scale)
    const cacheKey = cache.createCacheKey({ fileKey, nodeId, format: normalizedFormat, scale: normalizedScale })
    const now = Date.now()

    if (!forceRefresh) {
      const freshEntry = cache.getFresh({ fileKey, nodeId, format: normalizedFormat, scale: normalizedScale, now })
      if (freshEntry) {
        logCacheEvent('HIT', freshEntry.cache.source, {
          fileKey,
          nodeId,
          format: normalizedFormat,
          scale: normalizedScale,
          ageMs: freshEntry.cache.ageMs,
        })
        return createFigmaRenderResult({ fileKey, nodeId, nodeName, entry: freshEntry })
      }
    }

    const staleEntry = cache.getStale({ fileKey, nodeId, format: normalizedFormat, scale: normalizedScale, now })
    if (inFlightRequests.has(cacheKey)) {
      return inFlightRequests.get(cacheKey)
    }

    logCacheEvent('MISS', null, { fileKey, nodeId, format: normalizedFormat, scale: normalizedScale })

    const promise = requestAndCacheRenderedImage({
      fileKey,
      nodeId,
      token,
      nodeName,
      format: normalizedFormat,
      scale: normalizedScale,
      staleEntry,
    }).finally(() => {
      inFlightRequests.delete(cacheKey)
    })

    inFlightRequests.set(cacheKey, promise)
    return promise
  }

  function getLocalRenderFile({ renderId }) {
    return cache.resolveRenderFile({ renderId })
  }

  function clearCache({ fileKey, nodeId }) {
    return cache.clearByNode({ fileKey, nodeId })
  }

  function clearAllCache() {
    return cache.clearAll()
  }

  async function requestAndCacheRenderedImage({ fileKey, nodeId, token, nodeName, format, scale, staleEntry }) {
    logApiEvent('Request started', { fileKey, nodeId, format, scale })

    try {
      const imageUrl = await fetchRenderedImageUrl({ fileKey, nodeId, token, format, scale })
      logApiEvent('Metadata received', { fileKey, nodeId, format, scale })

      const download = await downloadRenderedImage({ imageUrl })
      logApiEvent('Image downloaded', {
        fileKey,
        nodeId,
        format,
        scale,
        sizeBytes: download.sizeBytes,
      })

      const cached = cache.set({
        fileKey,
        nodeId,
        format,
        scale,
        buffer: download.buffer,
        mimeType: download.mimeType,
        width: download.width,
        height: download.height,
        now: Date.now(),
      })

      return createFigmaRenderResult({ fileKey, nodeId, nodeName, entry: cached })
    } catch (error) {
      if (error instanceof FigmaRateLimitError) {
        logApiEvent('Rate limited', {
          fileKey,
          nodeId,
          format,
          scale,
          retryAfterSeconds: error.retryAfterSeconds,
        })
      }

      if (shouldUseStaleFallback(error) && staleEntry) {
        logCacheEvent('STALE fallback', staleEntry.cache.source, {
          fileKey,
          nodeId,
          format,
          scale,
          ageMs: staleEntry.cache.ageMs,
        })
        return createFigmaRenderResult({
          fileKey,
          nodeId,
          nodeName,
          entry: {
            ...staleEntry,
            cache: {
              ...staleEntry.cache,
              hit: true,
              stale: true,
            },
          },
        })
      }

      if (error instanceof FigmaRateLimitError) {
        error.cacheAvailable = Boolean(staleEntry)
      }

      throw error
    }
  }

  async function fetchRenderedImageUrl({ fileKey, nodeId, token, format, scale }) {
    const requestUrl = `${FIGMA_API_BASE_URL}/images/${encodeURIComponent(fileKey)}?ids=${encodeURIComponent(nodeId)}&format=${encodeURIComponent(format)}&scale=${encodeURIComponent(scale)}`

    let response
    try {
      response = await fetchImpl(requestUrl, {
        headers: {
          'X-Figma-Token': token,
        },
      })
    } catch {
      throw new FigmaApiError(502, 'figma_render_network_error', 'Figma Render API 네트워크 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.', {
        temporary: true,
      })
    }

    if (!response.ok) {
      throw await createFigmaApiErrorFromResponse(response)
    }

    let payload
    try {
      payload = await response.json()
    } catch {
      throw new FigmaApiError(502, 'figma_render_response_invalid', 'Figma Render API 응답을 처리하지 못했습니다.', {
        temporary: true,
      })
    }

    const imageUrl = payload?.images?.[nodeId]
    if (typeof imageUrl !== 'string' || !imageUrl.trim()) {
      throw new FigmaApiError(502, 'figma_render_url_missing', 'Figma Render API 응답에 이미지 URL이 없습니다.', {
        temporary: true,
      })
    }

    return imageUrl
  }

  async function downloadRenderedImage({ imageUrl }) {
    let response
    try {
      response = await fetchImpl(imageUrl)
    } catch {
      throw new FigmaApiError(502, 'figma_render_download_network_error', 'Figma 렌더 이미지를 다운로드하지 못했습니다.', {
        temporary: true,
      })
    }

    if (!response.ok) {
      if (response.status === 401) {
        throw new FigmaApiError(401, 'figma_render_download_unauthorized', 'Figma 렌더 이미지 다운로드 권한이 없습니다.')
      }
      if (response.status === 403) {
        throw new FigmaApiError(403, 'figma_render_download_forbidden', 'Figma 렌더 이미지 다운로드가 거부되었습니다.')
      }

      throw new FigmaApiError(502, 'figma_render_download_failed', 'Figma 렌더 이미지를 다운로드하지 못했습니다.', {
        temporary: true,
      })
    }

    const mimeType = normalizeMimeType(response.headers?.get?.('Content-Type'))
    if (!mimeType.startsWith('image/')) {
      throw new FigmaApiError(502, 'figma_render_invalid_content_type', '렌더 이미지 응답 형식이 올바르지 않습니다.', {
        temporary: true,
      })
    }

    const contentLength = Number(response.headers?.get?.('Content-Length'))
    if (Number.isFinite(contentLength) && contentLength > maxBytes) {
      throw new FigmaApiError(502, 'figma_render_too_large', '렌더 이미지 크기가 허용 범위를 초과했습니다.', {
        temporary: true,
      })
    }

    let buffer
    try {
      buffer = Buffer.from(await response.arrayBuffer())
    } catch {
      throw new FigmaApiError(502, 'figma_render_download_invalid', '렌더 이미지 데이터를 읽지 못했습니다.', {
        temporary: true,
      })
    }

    if (buffer.length <= 0) {
      throw new FigmaApiError(502, 'figma_render_empty', '빈 렌더 이미지는 저장할 수 없습니다.', {
        temporary: true,
      })
    }

    if (buffer.length > maxBytes) {
      throw new FigmaApiError(502, 'figma_render_too_large', '렌더 이미지 크기가 허용 범위를 초과했습니다.', {
        temporary: true,
      })
    }

    const pngSize = mimeType === 'image/png' ? readPngDimensions(buffer) : { width: null, height: null }

    return {
      buffer,
      mimeType,
      width: pngSize.width,
      height: pngSize.height,
      sizeBytes: buffer.length,
    }
  }

  function logCacheEvent(kind, source, details = {}) {
    const label = source ? `${kind} ${source}` : kind
    const agePart = Number.isFinite(details.ageMs) ? ` ageMs=${details.ageMs}` : ''
    logger.log(`[Figma Render Cache] ${label} fileKey=${maskFigmaFileKey(details.fileKey)} nodeId=${details.nodeId} format=${details.format} scale=${details.scale}${agePart}`)
  }

  function logApiEvent(kind, details = {}) {
    const sizePart = Number.isFinite(details.sizeBytes) ? ` sizeBytes=${details.sizeBytes}` : ''
    const retryAfterPart = Number.isFinite(details.retryAfterSeconds) ? ` retryAfterSeconds=${details.retryAfterSeconds}` : ''
    logger.log(`[Figma Render API] ${kind} fileKey=${maskFigmaFileKey(details.fileKey)} nodeId=${details.nodeId} format=${details.format} scale=${details.scale}${sizePart}${retryAfterPart}`)
  }
}

export function createFigmaRenderResult({ fileKey, nodeId, nodeName = '이름 없음', entry }) {
  return {
    source: 'figma',
    fileKeyMasked: maskFigmaFileKey(fileKey),
    nodeId,
    nodeName: typeof nodeName === 'string' && nodeName.trim() ? nodeName.trim() : '이름 없음',
    format: entry.data.format,
    scale: entry.data.scale,
    mimeType: entry.data.mimeType,
    width: entry.data.width,
    height: entry.data.height,
    sizeBytes: entry.data.sizeBytes,
    renderId: entry.data.renderId,
    imageUrl: `/api/figma/render/${encodeURIComponent(entry.data.renderId)}`,
    localImagePath: entry.data.localImagePath,
    cache: entry.cache,
  }
}

export function readPngDimensions(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 24) {
    return { width: null, height: null }
  }

  const isPng = buffer[0] === 0x89
    && buffer[1] === 0x50
    && buffer[2] === 0x4e
    && buffer[3] === 0x47
    && buffer[4] === 0x0d
    && buffer[5] === 0x0a
    && buffer[6] === 0x1a
    && buffer[7] === 0x0a

  if (!isPng) {
    return { width: null, height: null }
  }

  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  }
}

function shouldUseStaleFallback(error) {
  if (!(error instanceof FigmaApiError)) return false
  if (error.status === 401 || error.status === 403) return false
  return error.status === 429 || error.status >= 500 || error.temporary === true
}

async function createFigmaApiErrorFromResponse(response) {
  const status = Number(response.status)
  const headers = {
    retryAfter: readHeaderNumber(response.headers, 'Retry-After'),
    planTier: readHeaderString(response.headers, 'X-Figma-Plan-Tier'),
    rateLimitType: readHeaderString(response.headers, 'X-Figma-Rate-Limit-Type'),
    upgradeLink: readHeaderString(response.headers, 'X-Figma-Upgrade-Link'),
  }

  if (status === 400) {
    return new FigmaApiError(400, 'figma_api_bad_request', 'Figma URL 또는 node ID 형식이 올바르지 않습니다.')
  }
  if (status === 401) {
    return new FigmaApiError(401, 'figma_token_invalid', 'Figma 토큰이 유효하지 않습니다.')
  }
  if (status === 403) {
    return new FigmaApiError(403, 'figma_forbidden', '해당 토큰 계정에 이 Figma 파일 접근 권한이 없습니다.')
  }
  if (status === 404) {
    return new FigmaApiError(404, 'figma_not_found', '파일 또는 node를 찾을 수 없습니다.')
  }
  if (status === 429) {
    return new FigmaRateLimitError({
      retryAfterSeconds: headers.retryAfter ?? 0,
      headers,
    })
  }
  if (status >= 500) {
    return new FigmaApiError(502, 'figma_api_error', 'Figma API 요청 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.', {
      temporary: true,
    })
  }

  return new FigmaApiError(502, 'figma_api_error', 'Figma API 요청 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.')
}

function normalizeMimeType(value) {
  return String(value || '').split(';')[0].trim().toLowerCase()
}

function normalizeFormat(value) {
  const normalized = String(value || 'png').trim().toLowerCase()
  if (normalized === 'jpeg') return 'jpg'
  return normalized === 'jpg' ? 'jpg' : 'png'
}

function normalizeScale(value) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric <= 0) return 2
  return Math.round(numeric * 100) / 100
}

function normalizeMaxBytes(value) {
  const numeric = Number(value)
  return Number.isFinite(numeric) && numeric > 0 ? Math.round(numeric) : DEFAULT_MAX_BYTES
}

function readHeaderNumber(headers, name) {
  const value = headers?.get?.(name)
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

function readHeaderString(headers, name) {
  const value = headers?.get?.(name)
  return typeof value === 'string' && value.trim() ? value.trim() : null
}
