import { createFigmaCache, maskFigmaFileKey } from './figmaCache.js'

const FIGMA_API_BASE_URL = 'https://api.figma.com/v1'

export function createFigmaApiClient(options = {}) {
  const fetchImpl = options.fetchImpl || fetch
  const logger = options.logger || console
  const cache = options.cache || createFigmaCache({ ttlMs: options.ttlMs, cacheDir: options.cacheDir })
  const inFlightRequests = new Map()

  return {
    cache,
    getFigmaNodeData,
    clearCache,
    clearAllCache,
  }

  async function getFigmaNodeData({ fileKey, nodeId, token, forceRefresh = false }) {
    const cacheKey = cache.createCacheKey({ fileKey, nodeId })
    const now = Date.now()

    if (!forceRefresh) {
      const freshEntry = cache.getFresh({ fileKey, nodeId, now })
      if (freshEntry) {
        logCacheEvent('HIT', freshEntry.cache.source, { fileKey, nodeId, ageMs: freshEntry.cache.ageMs })
        return {
          fileKey,
          nodeId,
          targetNode: freshEntry.data.targetNode,
          cache: freshEntry.cache,
        }
      }
    }

    const staleEntry = cache.getStale({ fileKey, nodeId, now })
    if (inFlightRequests.has(cacheKey)) {
      return inFlightRequests.get(cacheKey)
    }

    logCacheEvent('MISS', null, { fileKey, nodeId })

    const promise = requestAndCacheFigmaNode({ fileKey, nodeId, token, staleEntry })
      .finally(() => {
        inFlightRequests.delete(cacheKey)
      })

    inFlightRequests.set(cacheKey, promise)
    return promise
  }

  function clearCache({ fileKey, nodeId }) {
    return cache.clear({ fileKey, nodeId })
  }

  function clearAllCache() {
    return cache.clearAll()
  }

  async function requestAndCacheFigmaNode({ fileKey, nodeId, token, staleEntry }) {
    logApiEvent('Request started', { fileKey, nodeId })

    try {
      const targetNode = await fetchFigmaNodeFromApi({ fileKey, nodeId, token })
      const cached = cache.set({ fileKey, nodeId, data: { targetNode }, now: Date.now() })
      logApiEvent('Request success', { fileKey, nodeId })

      return {
        fileKey,
        nodeId,
        targetNode,
        cache: cached.cache,
      }
    } catch (error) {
      if (error instanceof FigmaRateLimitError) {
        logApiEvent('Rate limited', {
          fileKey,
          nodeId,
          retryAfterSeconds: error.retryAfterSeconds,
        })
      }

      if (shouldUseStaleFallback(error) && staleEntry) {
        logCacheEvent('STALE fallback', staleEntry.cache.source, {
          fileKey,
          nodeId,
          ageMs: staleEntry.cache.ageMs,
        })
        return {
          fileKey,
          nodeId,
          targetNode: staleEntry.data.targetNode,
          cache: {
            ...staleEntry.cache,
            hit: true,
            stale: true,
          },
        }
      }

      if (error instanceof FigmaRateLimitError) {
        error.cacheAvailable = Boolean(staleEntry)
      }

      throw error
    }
  }

  async function fetchFigmaNodeFromApi({ fileKey, nodeId, token }) {
    const requestUrl = `${FIGMA_API_BASE_URL}/files/${encodeURIComponent(fileKey)}/nodes?ids=${encodeURIComponent(nodeId)}`

    let response
    try {
      response = await fetchImpl(requestUrl, {
        headers: {
          'X-Figma-Token': token,
        },
      })
    } catch {
      throw new FigmaApiError(502, 'figma_network_error', 'Figma API 네트워크 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.', {
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
      throw new FigmaApiError(502, 'figma_response_invalid', 'Figma API 응답을 처리하지 못했습니다.', {
        temporary: true,
      })
    }

    const targetNode = payload?.nodes?.[nodeId]?.document
    if (!targetNode || typeof targetNode !== 'object') {
      throw new FigmaApiError(404, 'figma_node_not_found', '파일 또는 node를 찾을 수 없습니다.')
    }

    return targetNode
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

  function logCacheEvent(kind, source, details = {}) {
    const label = source ? `${kind} ${source}` : kind
    const agePart = Number.isFinite(details.ageMs) ? ` ageMs=${details.ageMs}` : ''
    logger.log(`[Figma Cache] ${label} fileKey=${maskFigmaFileKey(details.fileKey)} nodeId=${details.nodeId}${agePart}`)
  }

  function logApiEvent(kind, details = {}) {
    const retryAfterPart = Number.isFinite(details.retryAfterSeconds) ? ` retryAfterSeconds=${details.retryAfterSeconds}` : ''
    logger.log(`[Figma API] ${kind} fileKey=${maskFigmaFileKey(details.fileKey)} nodeId=${details.nodeId}${retryAfterPart}`)
  }
}

export class FigmaApiError extends Error {
  constructor(status, code, message, options = {}) {
    super(message)
    this.name = 'FigmaApiError'
    this.status = status
    this.code = code
    this.temporary = options.temporary === true
  }
}

export class FigmaRateLimitError extends FigmaApiError {
  constructor(options = {}) {
    const retryAfterSeconds = Number.isFinite(Number(options.retryAfterSeconds)) ? Number(options.retryAfterSeconds) : 0
    const message = retryAfterSeconds > 0
      ? `Figma API 호출 제한에 도달했습니다. 약 ${retryAfterSeconds}초 후 다시 시도해주세요.`
      : 'Figma API 호출 제한에 도달했습니다.'

    super(429, 'figma_rate_limited', message, { temporary: true })
    this.name = 'FigmaRateLimitError'
    this.retryAfterSeconds = retryAfterSeconds
    this.planTier = options.headers?.planTier || null
    this.rateLimitType = options.headers?.rateLimitType || null
    this.upgradeLink = options.headers?.upgradeLink || null
    this.cacheAvailable = false
  }
}

function shouldUseStaleFallback(error) {
  if (!(error instanceof FigmaApiError)) return false
  if (error.status === 401 || error.status === 403) return false
  return error.status === 429 || error.status >= 500 || error.temporary === true
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
