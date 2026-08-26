import { createReferenceNavigationService } from './referenceNavigationService.js'

export function createReferenceNormalizeRoute(options = {}) {
  const service = options.service || createReferenceNavigationService(options.serviceOptions || {})

  return async function referenceNormalizeRoute(req, res) {
    const reference = req.body?.reference
    if (!reference || typeof reference !== 'object' || Array.isArray(reference)) {
      res.status(400).json({ ok: false, code: 'invalid_reference_input', message: 'reference 객체가 필요합니다.' })
      return
    }

    try {
      const result = await service.normalize(reference)
      res.json({ ok: true, ...result })
    } catch (error) {
      const mappedError = mapReferenceNormalizeError(error)
      res.status(mappedError.status).json(mappedError.body)
    }
  }
}

function mapReferenceNormalizeError(error) {
  const status = Number.isInteger(error?.status) ? error.status : 502
  const code = typeof error?.code === 'string' ? error.code : 'reference_normalize_failed'
  const message = error instanceof Error && error.message ? error.message : 'Reference normalization에 실패했습니다.'

  return {
    status,
    body: { ok: false, code, message, ...(isSafeDiagnostics(error?.diagnostics) ? { diagnostics: error.diagnostics } : {}) },
  }
}

function isSafeDiagnostics(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  return Object.keys(value).every((key) => ['model', 'finishReason', 'contentLength', 'contentType', 'promptTokens', 'completionTokens', 'totalTokens'].includes(key))
}
