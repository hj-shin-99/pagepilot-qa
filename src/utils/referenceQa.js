export async function analyzeReferenceFile(file, options = {}) {
  if (!file) throw createReferenceApiError('reference_file_missing', 'Reference Excel 파일을 선택해 주세요.')

  const fetchFn = options.fetchFn || fetch
  const formData = new FormData()
  formData.append('referenceFile', file)

  let response
  try {
    response = await fetchFn('/api/reference/analyze', {
      method: 'POST',
      body: formData,
    })
  } catch (error) {
    throw createReferenceApiError('reference_analyze_failed', error instanceof Error ? error.message : 'Reference 파일 분석 요청에 실패했습니다.')
  }

  const payload = await readReferenceJson(response)
  if (!response.ok || payload?.ok === false) {
    throw createReferenceApiError(payload?.code || 'reference_analyze_failed', payload?.message || `Reference 파일 분석에 실패했습니다. (${response.status})`)
  }
  if (!payload?.reference) throw createReferenceApiError('reference_analyze_invalid_response', 'Reference 분석 응답이 올바르지 않습니다.')

  return payload.reference
}

export async function normalizeReference(reference, options = {}) {
  if (!reference || typeof reference !== 'object') throw createReferenceApiError('invalid_reference_input', 'Reference 분석 결과가 필요합니다.')

  const fetchFn = options.fetchFn || fetch
  const selectedReference = Array.isArray(options.selectedSheetNames) ? filterReferenceSheets(reference, options.selectedSheetNames) : reference
  let response
  try {
    response = await fetchFn('/api/reference/normalize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reference: selectedReference }),
    })
  } catch (error) {
    throw createReferenceApiError('reference_normalize_failed', error instanceof Error ? error.message : 'Reference 정규화 요청에 실패했습니다.')
  }

  const payload = await readReferenceJson(response)
  if (!response.ok || payload?.ok === false) {
    throw createReferenceApiError(payload?.code || 'reference_normalize_failed', payload?.message || `Reference 정규화에 실패했습니다. (${response.status})`)
  }
  if (!payload?.referenceMap) throw createReferenceApiError('reference_normalize_invalid_response', 'Reference Map 응답이 올바르지 않습니다.')

  return { referenceMap: payload.referenceMap, meta: payload.meta || {} }
}

export function filterReferenceSheets(reference, selectedSheetNames = []) {
  const selected = new Set(selectedSheetNames.map((sheetName) => String(sheetName || '').trim()).filter(Boolean))
  const sheets = Array.isArray(reference?.sheets) ? reference.sheets.filter((sheet) => selected.has(String(sheet?.sheetName || '').trim())) : []
  const sheetSummaries = Array.isArray(reference?.sheetSummaries) ? reference.sheetSummaries.filter((sheet) => selected.has(String(sheet?.sheetName || '').trim())) : []

  return {
    ...reference,
    sheetCount: sheets.length,
    totalRowCount: sheets.reduce((count, sheet) => count + (Number(sheet?.rowCount) || 0), 0),
    sheetSummaries,
    sheets,
  }
}

async function readReferenceJson(response) {
  try {
    return await response.json()
  } catch {
    return null
  }
}

function createReferenceApiError(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}
