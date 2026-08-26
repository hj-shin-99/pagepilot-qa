import OpenAI from 'openai'
import { createReferenceNavigationMessages } from './prompts/referenceNavigationPrompt.js'
import { createCandidateKey, createCoverageSummary, createReferenceCandidateManifest } from './referenceCandidateManifest.js'
import { getReferenceQaModel } from './referenceModelConfig.js'

export const REFERENCE_NAVIGATION_SCHEMA_VERSION = 'navigation-intent-reference-v1'

export const REFERENCE_NAVIGATION_LIMITS = Object.freeze({
  maxSheets: 20,
  maxInputRows: 2000,
  maxSourceRows: 2000,
  maxCellsPerRow: 40,
  maxCellTextLength: 300,
  maxEvidenceTextLength: 800,
  maxPromptChars: 30000,
  maxPromptCharsPerChunk: 12000,
  maxCandidatesPerChunk: 20,
  minCandidatesPerChunk: 4,
  maxChunkSplitDepth: 3,
  maxApiCalls: 24,
  maxOutputItems: 200,
})

const DEFAULT_TIMEOUT_MS = 60000
const MAX_COMPLETION_TOKENS = 6000
const VALID_ROLE_HINTS = new Set(['link', 'button', 'menu-item', 'tab', 'unknown'])
const VALID_ACTION_HINTS = new Set(['navigation', 'download', 'modal', 'unknown'])
const VALID_MATCH_MODES = new Set(['exact-url', 'path-and-query', 'pattern'])
const VALID_URL_SOURCES = new Set(['explicit-absolute-url', 'explicit-relative-path', 'hyperlink-cell', 'descriptive-text-url-like', 'explicit-document-cell', 'primary-navigation-column'])
const VALID_LABEL_SOURCES = new Set(['document-cell', 'document-depth', 'inferred-from-row'])
const EXPECTED_URL_CLASSIFICATIONS = new Set(['primary-navigation', 'additional-navigation', 'navigation-state-variant'])
const STRONG_NAVIGATION_URL_SOURCES = new Set(['hyperlink-cell', 'explicit-absolute-url', 'explicit-relative-path', 'explicit-document-cell', 'primary-navigation-column'])
const API_CONTEXT_PATTERN = /\b(api|endpoint|request|response|method|payload|parameter|schema|json|http status|status code)\b|\b(GET|POST|PUT|PATCH|DELETE)\b/i
const DESCRIPTIVE_CONTEXT_PATTERN = /\b(api|endpoint|request|response|method|payload|parameter|schema|json|database|internal|backend|batch|note|notes|description|desc|remark|memo|comment|example|sample|template|documentation|doc)\b|비고|설명|참고|문서|내부|적재|저장|처리|파라미터|템플릿|예시/i
const STATE_VARIANT_CONTEXT_PATTERN = /\b(tab|filter|category|type|sort|search|searchoption|view|mode|section|step|state|option)\b|탭|필터|검색|카테고리|분류|정렬|상태/i

export function createReferenceNavigationService(options = {}) {
  const apiKey = typeof options.apiKey === 'string' ? options.apiKey.trim() : ''
  const model = typeof options.model === 'string' && options.model.trim() ? options.model.trim() : getReferenceQaModel(options.env || process.env)
  const timeout = Number.isFinite(Number(options.timeoutMs)) && Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : DEFAULT_TIMEOUT_MS
  const client = options.client || (apiKey ? new OpenAI({ apiKey, timeout }) : null)
  const now = typeof options.now === 'function' ? options.now : () => new Date().toISOString()
  const limits = { ...REFERENCE_NAVIGATION_LIMITS, ...(options.limits || {}) }

  return {
    async normalize(reference) {
      const compactInput = createReferenceNavigationInput(reference, { limits })
      const warnings = [...compactInput.warnings]

      if (compactInput.rows.length === 0) {
        return createReferenceNavigationResult({ reference, compactInput, model, now, items: [], warnings: [...warnings, 'no_candidate_rows'], openAiCalled: false, chunking: createEmptyChunkingMeta(compactInput.chunks.length, limits) })
      }

      if (!client) throw createReferenceNavigationError('missing_api_key', 'OPENAI_API_KEY가 설정되지 않았습니다.', 400)

      const chunkResult = await normalizeReferenceChunks({ compactInput, client, model, limits })
      warnings.push(...chunkResult.warnings)
      const mappedItems = assignReferenceIds(sortItemsByManifestOrder(chunkResult.items, compactInput.manifest))
      const items = annotateFinalDuplicateTargets(appendUnmappedCandidateItems(mappedItems, compactInput.manifest))

      return createReferenceNavigationResult({ reference, compactInput, model, now, items, warnings, openAiCalled: chunkResult.chunking.apiCallCount > 0, chunking: chunkResult.chunking, failedChunks: chunkResult.failedChunks })
    },
  }
}

export function createReferenceNavigationInput(reference, options = {}) {
  const limits = { ...REFERENCE_NAVIGATION_LIMITS, ...(options.limits || {}) }
  validateReferenceFacts(reference, limits)

  const sourceDocument = {
    fileName: normalizeText(reference.fileName, 240),
    mimeType: normalizeText(reference.mimeType, 160),
    size: safeNumber(reference.size),
    sheetCount: safeNumber(reference.sheetCount),
    totalRowCount: safeNumber(reference.totalRowCount),
  }
  const warnings = []
  const manifest = createReferenceCandidateManifest(reference, { maxCandidates: limits.maxSourceRows })
  const rowCandidates = manifest.candidates.map((candidate) => ({ ...candidate, priority: createCandidatePriority(candidate) }))
  const rowIndex = new Map()
  const candidateIndex = new Map()
  let sourceRowCount = 0

  for (const sheet of reference.sheets.slice(0, limits.maxSheets)) {
    const sheetName = normalizeText(sheet?.sheetName, 160)
    if (!sheetName) continue

    for (const row of Array.isArray(sheet.rows) ? sheet.rows : []) {
      const rowNumber = Number(row?.rowNumber)
      if (!Number.isInteger(rowNumber) || rowNumber <= 0) continue

      sourceRowCount += 1
      const cells = normalizeCells(row.cells, limits)
      const evidenceText = createEvidenceText(cells, limits.maxEvidenceTextLength)
      if (!evidenceText) continue

      const key = createRowKey(sheetName, rowNumber)
      const manifestCandidate = manifest.candidates.find((candidate) => candidate.sheetName === sheetName && candidate.rowNumber === rowNumber)
      const indexedRow = {
        sheetName,
        rowNumber,
        cells,
        evidenceText,
        detectedUrls: manifestCandidate?.detectedUrls || [],
        candidateId: manifestCandidate?.candidateId || '',
        labelCandidate: manifestCandidate?.labelCandidate || '',
        duplicateCandidate: manifestCandidate?.duplicateCandidate === true,
      }
      rowIndex.set(key, indexedRow)
      if (indexedRow.candidateId) candidateIndex.set(indexedRow.candidateId, indexedRow)
    }
  }

  if (sourceRowCount > limits.maxSourceRows) throw createReferenceNavigationError('reference_too_large', 'Reference compact facts row count is too large.', 400)

  const selectedRows = rowCandidates.slice(0, limits.maxInputRows)
  if (rowCandidates.length > selectedRows.length) warnings.push('candidate_rows_truncated')

  const selectedRowKeys = new Set(selectedRows.map((candidate) => createRowKey(candidate.sheetName, candidate.rowNumber)))
  const rowsForAi = [...rowIndex.values()].filter((row) => selectedRowKeys.has(createRowKey(row.sheetName, row.rowNumber)))
  const chunks = createReferenceChunks({ reference, sourceDocument, rows: rowsForAi, limits })
  const aiInput = chunks[0]?.aiInput || createChunkAiInput({ reference, sourceDocument, rows: [], chunkId: 'chunk-001', limits })

  return { reference, sourceDocument, aiInput, rowIndex, candidateIndex, rows: selectedRows, manifest, chunks, warnings }
}

function validateReferenceFacts(reference, limits) {
  if (!reference || typeof reference !== 'object' || Array.isArray(reference)) {
    throw createReferenceNavigationError('invalid_reference_input', 'reference 객체가 필요합니다.', 400)
  }
  if (!Array.isArray(reference.sheets)) throw createReferenceNavigationError('invalid_reference_input', 'reference.sheets 배열이 필요합니다.', 400)
  if (reference.sheets.length > limits.maxSheets * 2) throw createReferenceNavigationError('reference_too_large', 'Reference sheet count is too large.', 400)
  if (containsUnsafeRawPayload(reference)) throw createReferenceNavigationError('invalid_reference_input', 'Reference compact facts에 raw binary/base64 payload가 포함되어 있습니다.', 400)
}

function normalizeCells(cells, limits) {
  if (!cells || typeof cells !== 'object' || Array.isArray(cells)) return {}
  const normalized = {}

  for (const [column, value] of Object.entries(cells).slice(0, limits.maxCellsPerRow)) {
    const columnName = normalizeText(column, 8)
    if (!/^[A-Z]{1,3}$/.test(columnName)) continue
    const normalizedValue = normalizeCellValue(value, limits.maxCellTextLength)
    if (isEmptyValue(normalizedValue)) continue
    normalized[columnName] = normalizedValue
  }

  return normalized
}

function normalizeCellValue(value, maxLength) {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return normalizeText(value, maxLength)
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value)
  if (typeof value === 'boolean') return value
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? '' : value.toISOString()
  if (typeof value === 'object' && !Array.isArray(value)) {
    const text = normalizeText(value.text, maxLength)
    const hyperlink = normalizeText(value.hyperlink, maxLength)
    if (text || hyperlink) return { ...(text ? { text } : {}), ...(hyperlink ? { hyperlink } : {}) }
  }
  return normalizeText(String(value), maxLength)
}

function buildAiInputSheets(sourceSheets, selectedRows, limits) {
  const rowsBySheet = new Map()
  for (const row of selectedRows) {
    rowsBySheet.set(row.sheetName, [...(rowsBySheet.get(row.sheetName) || []), row])
  }

  return sourceSheets.slice(0, limits.maxSheets).map((sheet) => {
    const sheetName = normalizeText(sheet?.sheetName, 160)
    const rows = rowsBySheet.get(sheetName) || []
    return {
      sheetName,
      headerCandidates: normalizeHeaderCandidates(sheet?.headerCandidates, limits),
      rows: rows.map(({ rowNumber, cells, evidenceText, detectedUrls, candidateId, labelCandidate, duplicateCandidate }) => ({ rowNumber, candidateId, cells, labelCandidate, evidenceText, detectedUrls, duplicateCandidate })),
    }
  }).filter((sheet) => sheet.sheetName && sheet.rows.length > 0)
}

function createReferenceChunks({ reference, sourceDocument, rows, limits }) {
  const chunks = []
  let currentRows = []

  for (const row of rows) {
    const nextRows = [...currentRows, row]
    const nextInput = createChunkAiInput({ reference, sourceDocument, rows: nextRows, chunkId: createChunkId(chunks.length + 1), limits })
    const isTooMany = nextRows.length > limits.maxCandidatesPerChunk
    const isTooLarge = currentRows.length > 0 && JSON.stringify(nextInput).length > limits.maxPromptCharsPerChunk

    if (isTooMany || isTooLarge) {
      chunks.push(createChunk({ reference, sourceDocument, rows: currentRows, chunkNumber: chunks.length + 1, limits }))
      currentRows = [row]
      continue
    }

    currentRows = nextRows
  }

  if (currentRows.length > 0) chunks.push(createChunk({ reference, sourceDocument, rows: currentRows, chunkNumber: chunks.length + 1, limits }))
  return chunks
}

function createChunk({ reference, sourceDocument, rows, chunkNumber, limits }) {
  const chunkId = createChunkId(chunkNumber)
  return {
    chunkId,
    candidateIds: rows.map((row) => row.candidateId).filter(Boolean),
    candidateCount: rows.length,
    rows,
    aiInput: createChunkAiInput({ reference, sourceDocument, rows, chunkId, limits }),
  }
}

function createChunkAiInput({ reference, sourceDocument, rows, chunkId, limits }) {
  return {
    schemaVersion: REFERENCE_NAVIGATION_SCHEMA_VERSION,
    chunkId,
    sourceDocument,
    limits: {
      maxInputRows: limits.maxInputRows,
      maxCellTextLength: limits.maxCellTextLength,
      maxOutputItems: limits.maxOutputItems,
    },
    sheets: buildAiInputSheets(reference.sheets, rows, limits),
  }
}

function createChunkId(chunkNumber) {
  return `chunk-${String(chunkNumber).padStart(3, '0')}`
}

function normalizeHeaderCandidates(value, limits) {
  if (!Array.isArray(value)) return []
  return value.slice(0, 5).map((row) => ({
    rowNumber: Number.isInteger(Number(row?.rowNumber)) ? Number(row.rowNumber) : 0,
    cells: normalizeCells(row?.cells, limits),
  })).filter((row) => row.rowNumber > 0 && Object.keys(row.cells).length > 0)
}

function normalizeReferenceItems(items, compactInput, allowedCandidateIds, limits) {
  const warnings = []
  const normalizedItems = []

  for (const item of items.slice(0, limits.maxOutputItems)) {
    const source = item.source || {}
    const candidateId = normalizeText(source?.candidateId || item.candidateId, 80)
    const sheetName = normalizeText(source.sheetName, 160)
    const rowNumber = Number(source.rowNumber)
    let indexedRow

    if (candidateId) {
      if (!allowedCandidateIds.has(candidateId)) {
        warnings.push('dropped_item_invalid_candidate_id')
        continue
      }
      indexedRow = compactInput.candidateIndex.get(candidateId)
      if (!indexedRow) {
        warnings.push('dropped_item_invalid_candidate_id')
        continue
      }
      if (indexedRow.sheetName !== sheetName || indexedRow.rowNumber !== rowNumber) {
        warnings.push('dropped_item_source_mismatch')
        continue
      }
    } else {
      warnings.push('missing_candidate_id')
      indexedRow = compactInput.rowIndex.get(createRowKey(sheetName, rowNumber))
      if (!indexedRow || !allowedCandidateIds.has(indexedRow.candidateId)) {
        warnings.push('dropped_item_invalid_source')
        continue
      }
    }

    if (!indexedRow) {
      warnings.push('dropped_item_invalid_source')
      continue
    }

    const aiExpectedUrls = normalizeExpectedUrls(item.expected.urls, indexedRow, warnings)
    if (aiExpectedUrls.length === 0) {
      warnings.push('dropped_item_without_traceable_url')
      continue
    }
    const urlEvidence = classifyGroundedUrlEvidence(indexedRow, aiExpectedUrls)
    const expectedUrls = createExpectedUrlsFromClassifications(urlEvidence, aiExpectedUrls)

    const referenceNumber = normalizedItems.length + 1
    normalizedItems.push({
      referenceId: `ref-${String(referenceNumber).padStart(3, '0')}`,
      candidateId: indexedRow.candidateId,
      duplicateCandidate: indexedRow.duplicateCandidate === true,
      source: {
        sheetName: indexedRow.sheetName,
        rowNumber: indexedRow.rowNumber,
        columns: indexedRow.cells,
        evidenceText: createConnectedEvidenceText(item.source.evidenceText, indexedRow.evidenceText),
      },
      pageContext: normalizePageContext(item.pageContext),
      element: normalizeElement(item.element),
      expected: {
        type: 'url',
        urls: expectedUrls,
        urlPatterns: normalizeStringArray(item.expected.urlPatterns, 20, 240),
        notes: normalizeText(item.expected.notes, 500),
      },
      urlEvidence,
      provenance: normalizeProvenance(item.provenance, expectedUrls),
      confidence: normalizeConfidence(item.confidence),
      userDecision: { status: 'pending', edited: false, excludedReason: '' },
    })
  }

  if (items.length > limits.maxOutputItems) warnings.push('output_items_truncated')
  return { items: normalizedItems, warnings }
}

function normalizeExpectedUrls(urls, indexedRow, warnings) {
  const normalized = []
  const seen = new Set()

  for (const url of urls) {
    const raw = normalizeText(url.raw, 500)
    if (!raw || seen.has(raw)) continue
    const provenance = findUrlProvenance(raw, indexedRow)
    if (!provenance) {
      warnings.push('dropped_url_without_input_evidence')
      continue
    }

    seen.add(raw)
    normalized.push({
      raw,
      ...parseUrlParts(raw),
      matchMode: VALID_MATCH_MODES.has(url.matchMode) ? url.matchMode : getDefaultMatchMode(raw),
      allowSameOrigin: url.allowSameOrigin !== false,
      allowRedirect: url.allowRedirect === true,
      allowTrailingSlashVariant: url.allowTrailingSlashVariant !== false,
      dynamicParameters: normalizeDynamicParameters(url.dynamicParameters, raw),
      provenance: { urlSource: provenance.urlSource, sourceColumn: provenance.column },
    })
  }

  return normalized
}

function classifyGroundedUrlEvidence(indexedRow, aiExpectedUrls = []) {
  const detectedUrls = Array.isArray(indexedRow?.detectedUrls) ? indexedRow.detectedUrls : []
  const aiIdentities = new Set(aiExpectedUrls.map((url) => createTargetIdentity(url)).filter(Boolean))
  const rowText = normalizeText(indexedRow?.evidenceText, 1600)
  const entries = detectedUrls.map((url, index) => {
    const raw = normalizeText(url?.raw, 500)
    const parts = parseUrlParts(raw)
    const sourceText = getColumnText(indexedRow?.cells, url?.sourceColumn || url?.column) || normalizeText(url?.sourceText, 1000)
    return {
      raw,
      ...parts,
      normalizedIdentity: createTargetIdentity({ raw, ...parts }),
      normalizedPathIdentity: createPathIdentity({ raw, ...parts }),
      sourceColumn: normalizeText(url?.sourceColumn || url?.column, 8),
      evidenceKind: normalizeText(url?.provenance || url?.source || 'explicit-document-cell', 80),
      sourceText,
      sourceIndex: Number.isFinite(Number(url?.sourceIndex)) ? Number(url.sourceIndex) : index,
      originalIndex: index,
    }
  }).filter((url) => url.raw && url.normalizedIdentity)

  for (const entry of entries) {
    entry.urlListLikeCell = isUrlListLikeCell(entry, entries)
  }

  const firstIdentityIndexes = new Map()
  for (const [index, entry] of entries.entries()) {
    if (!firstIdentityIndexes.has(entry.normalizedIdentity)) firstIdentityIndexes.set(entry.normalizedIdentity, index)
  }

  const primaryIndex = findPrimaryEvidenceIndex(entries, firstIdentityIndexes, aiIdentities, rowText)
  const primary = primaryIndex >= 0 ? entries[primaryIndex] : null

  return entries.map((entry, index) => {
    if (firstIdentityIndexes.get(entry.normalizedIdentity) !== index) return createClassifiedUrl(entry, 'duplicate-evidence', 'duplicate-same-target', 0.99)
    if (isParameterTemplateUrl(entry.raw)) return createClassifiedUrl(entry, 'parameter-template', 'incomplete-parameter-template', 0.96)
    if (isDescriptiveOnlyEvidence(entry, rowText)) return createClassifiedUrl(entry, 'descriptive-only', 'descriptive-context-only', 0.88)
    if (primary && index === primaryIndex) return createClassifiedUrl(entry, 'primary-navigation', 'explicit-primary-url', 0.95)
    if (primary && isNavigationListEvidence(entry) && entry.normalizedPathIdentity !== primary.normalizedPathIdentity) return createClassifiedUrl(entry, 'additional-navigation', 'explicit-distinct-url', 0.9)
    if (primary && entry.normalizedIdentity !== primary.normalizedIdentity && entry.normalizedPathIdentity === primary.normalizedPathIdentity && isNavigationStateVariant(entry, rowText)) return createClassifiedUrl(entry, 'navigation-state-variant', 'explicit-query-state', 0.86)
    if (!primary && aiIdentities.has(entry.normalizedIdentity) && !isDescriptiveOnlyEvidence(entry, rowText)) return createClassifiedUrl(entry, 'primary-navigation', 'explicit-primary-url', 0.78)
    return createClassifiedUrl(entry, 'review-needed', 'ambiguous-multi-url', 0.45)
  })
}

function findPrimaryEvidenceIndex(entries, firstIdentityIndexes, aiIdentities, rowText) {
  const usableEntries = entries
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry, index }) => firstIdentityIndexes.get(entry.normalizedIdentity) === index)
    .filter(({ entry }) => !isParameterTemplateUrl(entry.raw) && !isDescriptiveOnlyEvidence(entry, rowText))

  const aiStrong = usableEntries.find(({ entry }) => aiIdentities.has(entry.normalizedIdentity) && isStrongNavigationEvidence(entry))
  if (aiStrong) return aiStrong.index

  const strong = usableEntries.find(({ entry }) => isStrongNavigationEvidence(entry))
  if (strong) return strong.index

  const urlListEntry = usableEntries.find(({ entry }) => entry.urlListLikeCell === true)
  if (urlListEntry) return urlListEntry.index

  const aiSelected = usableEntries.find(({ entry }) => aiIdentities.has(entry.normalizedIdentity))
  return aiSelected ? aiSelected.index : -1
}

function createExpectedUrlsFromClassifications(urlEvidence, aiExpectedUrls = []) {
  const aiByRaw = new Map(aiExpectedUrls.map((url) => [url.raw, url]))
  const seen = new Set()
  const expectedUrls = []

  for (const evidence of urlEvidence) {
    if (!EXPECTED_URL_CLASSIFICATIONS.has(evidence.classification) || seen.has(evidence.normalizedIdentity)) continue
    const aiUrl = aiByRaw.get(evidence.raw) || {}
    seen.add(evidence.normalizedIdentity)
    expectedUrls.push({
      raw: evidence.raw,
      normalizedPath: evidence.normalizedPath,
      query: evidence.query,
      hash: evidence.hash,
      matchMode: VALID_MATCH_MODES.has(aiUrl.matchMode) ? aiUrl.matchMode : getDefaultMatchMode(evidence.raw),
      allowSameOrigin: aiUrl.allowSameOrigin !== false,
      allowRedirect: aiUrl.allowRedirect === true,
      allowTrailingSlashVariant: aiUrl.allowTrailingSlashVariant !== false,
      dynamicParameters: normalizeDynamicParameters(aiUrl.dynamicParameters, evidence.raw),
      provenance: { urlSource: evidence.evidenceKind, sourceColumn: evidence.sourceColumn },
      classification: evidence.classification,
      classificationReasonCode: evidence.reasonCode,
      classificationConfidence: evidence.confidence,
      normalizedIdentity: evidence.normalizedIdentity,
    })
  }

  return expectedUrls
}

function createClassifiedUrl(entry, classification, reasonCode, confidence) {
  return {
    raw: entry.raw,
    normalizedIdentity: entry.normalizedIdentity,
    classification,
    sourceColumn: entry.sourceColumn,
    evidenceKind: entry.evidenceKind,
    reasonCode,
    confidence,
    normalizedPath: entry.normalizedPath,
    query: entry.query,
    hash: entry.hash,
  }
}

function isStrongNavigationEvidence(entry) {
  return STRONG_NAVIGATION_URL_SOURCES.has(entry.evidenceKind)
}

function isNavigationListEvidence(entry) {
  return isStrongNavigationEvidence(entry) || entry.urlListLikeCell === true
}

function isParameterTemplateUrl(raw) {
  try {
    const parsed = raw.startsWith('http://') || raw.startsWith('https://') ? new URL(raw) : new URL(raw, 'https://reference.local')
    return [...parsed.searchParams.entries()].some(([key, value]) => key && value === '')
  } catch {
    const query = String(raw || '').split('#')[0].split('?')[1] || ''
    return query.split('&').some((part) => /^[^=&#?]+=$/.test(part))
  }
}

function isDescriptiveOnlyEvidence(entry, rowText) {
  if (entry.urlListLikeCell === true) return false
  const context = `${entry.sourceText} ${rowText}`
  if (/^descriptive-text-url-like$/.test(entry.evidenceKind) && DESCRIPTIVE_CONTEXT_PATTERN.test(context)) return true
  if (API_CONTEXT_PATTERN.test(context) && !isStandaloneUrlText(entry.sourceText, entry.raw)) return true
  return false
}

function isUrlListLikeCell(entry, entries) {
  const sourceText = normalizeText(entry.sourceText, 1000)
  if (!sourceText || API_CONTEXT_PATTERN.test(sourceText) || DESCRIPTIVE_CONTEXT_PATTERN.test(sourceText)) return false

  const sameCellEntries = entries.filter((candidate) => candidate.sourceText === entry.sourceText && candidate.sourceColumn === entry.sourceColumn)
  if (sameCellEntries.length < 2) return false

  let residue = sourceText
  for (const candidate of sameCellEntries) {
    residue = residue.split(candidate.raw).join(' ')
  }

  const structuralResidue = residue
    .replace(/[()[\]{},;:|]+/g, ' ')
    .replace(/\s+[\\/]+\s+/g, ' ')
    .replace(/[<>]+/g, ' ')
    .replace(/[-–—]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  if (!structuralResidue) return true

  const nonStructuralResidue = structuralResidue
    .replace(/\b(primary|secondary|main|sub|alternate|alternative|default|url|urls|link|links|target|targets|path|paths|page|pages|route|routes|navigation|nav|pc|mobile|desktop|app|web)\b/gi, ' ')
    .replace(/\s+/g, '')

  if (!nonStructuralResidue) return true
  if (/[.!?。！？]/.test(structuralResidue)) return false
  return structuralResidue.length <= 32
}

function isNavigationStateVariant(entry, rowText) {
  if (isParameterTemplateUrl(entry.raw)) return false
  if (!Object.keys(entry.query || {}).length && !entry.hash) return false
  const queryKeys = Object.keys(entry.query || {}).join(' ')
  return STATE_VARIANT_CONTEXT_PATTERN.test(`${queryKeys} ${entry.sourceText} ${rowText}`)
}

function createPathIdentity(url) {
  const raw = normalizeText(url?.raw, 800)
  if (!raw) return ''

  try {
    const isAbsolute = raw.startsWith('http://') || raw.startsWith('https://')
    const parsed = isAbsolute ? new URL(raw) : new URL(raw, 'https://reference.local')
    const origin = isAbsolute ? parsed.origin.toLowerCase() : ''
    const path = normalizeDuplicatePath(parsed.pathname || '/', url)
    return `${origin}${path}`
  } catch {
    return normalizeDuplicatePath(url?.normalizedPath || raw.split(/[?#]/)[0] || raw, url)
  }
}

function getColumnText(cells, column) {
  const value = cells?.[normalizeText(column, 8)]
  return getCellTextParts(value).map((part) => part.text).join(' ')
}

function isStandaloneUrlText(text, raw) {
  return normalizeText(text, 1000) === normalizeText(raw, 1000)
}

function findUrlProvenance(raw, indexedRow) {
  const detected = Array.isArray(indexedRow.detectedUrls) ? indexedRow.detectedUrls.find((url) => url.raw === raw) : null
  if (detected) return { urlSource: detected.provenance || detected.source || 'explicit-document-cell', column: detected.sourceColumn || detected.column || '' }

  for (const [column, value] of Object.entries(indexedRow.cells)) {
    const parts = getCellTextParts(value)
    for (const part of parts) {
      if (part.text === raw) {
        return { urlSource: part.kind === 'hyperlink' ? 'hyperlink-cell' : 'explicit-document-cell', column }
      }
    }
  }
  return null
}

function parseUrlParts(raw) {
  const fallback = { normalizedPath: raw.split(/[?#]/)[0] || raw, query: {}, hash: '' }
  try {
    const parsed = raw.startsWith('http://') || raw.startsWith('https://') ? new URL(raw) : new URL(raw, 'https://reference.local')
    return {
      normalizedPath: parsed.pathname || '/',
      query: Object.fromEntries(parsed.searchParams.entries()),
      hash: parsed.hash ? parsed.hash.slice(1) : '',
    }
  } catch {
    const hashSplit = raw.split('#')
    const querySplit = hashSplit[0].split('?')
    return {
      normalizedPath: querySplit[0] || fallback.normalizedPath,
      query: parseQueryString(querySplit[1] || ''),
      hash: hashSplit[1] || '',
    }
  }
}

function parseQueryString(queryText) {
  if (!queryText) return {}
  return Object.fromEntries(queryText.split('&').map((pair) => {
    const [key, value = ''] = pair.split('=')
    return [key, value]
  }).filter(([key]) => key))
}

function getDefaultMatchMode(raw) {
  return /[{[:*]/.test(raw) ? 'pattern' : 'path-and-query'
}

function normalizeDynamicParameters(value, raw) {
  const fromAi = normalizeStringArray(value, 20, 80)
  const fromRaw = [...raw.matchAll(/[{:[]([A-Za-z0-9_-]+)[}\]]?/g)].map((match) => match[1]).filter(Boolean)
  return [...new Set([...fromAi, ...fromRaw])]
}

function normalizePageContext(value = {}) {
  const input = value && typeof value === 'object' ? value : {}
  return {
    depthPath: normalizeStringArray(input.depthPath, 8, 160),
    sectionHint: normalizeText(input.sectionHint, 240),
    pageUrlHint: normalizeText(input.pageUrlHint, 500),
  }
}

function normalizeElement(value = {}) {
  const input = value && typeof value === 'object' ? value : {}
  return {
    label: normalizeText(input.label, 240),
    aliases: normalizeStringArray(input.aliases, 10, 160),
    roleHint: VALID_ROLE_HINTS.has(input.roleHint) ? input.roleHint : 'unknown',
    actionHint: VALID_ACTION_HINTS.has(input.actionHint) ? input.actionHint : 'unknown',
  }
}

function normalizeProvenance(value = {}, expectedUrls = []) {
  const input = value && typeof value === 'object' ? value : {}
  const firstUrlSource = expectedUrls[0]?.provenance?.urlSource || 'explicit-document-cell'
  return {
    urlSource: VALID_URL_SOURCES.has(input.urlSource) ? input.urlSource : firstUrlSource,
    labelSource: VALID_LABEL_SOURCES.has(input.labelSource) ? input.labelSource : 'inferred-from-row',
    inferenceUsed: input.inferenceUsed === true,
    aiRationale: normalizeText(input.aiRationale, 500),
  }
}

async function normalizeReferenceChunks({ compactInput, client, model, limits }) {
  const warnings = []
  const failedChunks = []
  const items = []
  const chunking = createEmptyChunkingMeta(compactInput.chunks.length, limits)

  for (const chunk of compactInput.chunks) {
    if (chunking.apiCallCount >= limits.maxApiCalls) {
      failedChunks.push(createFailedChunk(chunk, 'max_api_calls_exceeded', 'Reference normalization API call limit reached.'))
      warnings.push('reference_max_api_calls_reached')
      continue
    }

    const result = await normalizeReferenceChunk({ chunk, compactInput, client, model, limits, chunking, depth: 0 })
    items.push(...result.items)
    warnings.push(...result.warnings)
    failedChunks.push(...result.failedChunks)

    if (result.success) chunking.successfulChunkCount += 1
    else chunking.failedChunkCount += 1
  }

  chunking.failedChunkCount = failedChunks.length
  if (chunking.chunkCount > 0 && chunking.successfulChunkCount === 0) warnings.push('all_reference_chunks_failed')
  return { items, warnings, failedChunks, chunking }
}

async function normalizeReferenceChunk({ chunk, compactInput, client, model, limits, chunking, depth }) {
  if (chunking.apiCallCount >= limits.maxApiCalls) {
    return { items: [], warnings: ['reference_max_api_calls_reached'], failedChunks: [createFailedChunk(chunk, 'max_api_calls_exceeded', 'Reference normalization API call limit reached.')], success: false }
  }

  let completion
  chunking.apiCallCount += 1
  try {
    completion = await client.chat.completions.create({
      model,
      messages: createReferenceNavigationMessages(chunk.aiInput),
      response_format: { type: 'json_object' },
      max_completion_tokens: MAX_COMPLETION_TOKENS,
    })
  } catch (error) {
    const code = isTimeoutError(error) ? 'openai_reference_timeout' : 'openai_reference_failed'
    return { items: [], warnings: [code], failedChunks: [createFailedChunk(chunk, code, error instanceof Error ? error.message : 'Reference normalization OpenAI 호출에 실패했습니다.')], success: false }
  }

  const diagnostics = createCompletionDiagnostics(completion, model)
  if (diagnostics.finishReason === 'length') {
    return splitAndRetryLengthChunk({ chunk, compactInput, client, model, limits, chunking, depth, diagnostics })
  }

  try {
    const parsed = parseReferenceJson(extractCompletionContent(completion), diagnostics)
    validateReferenceAiSchema(parsed)
    const allowedCandidateIds = new Set(chunk.candidateIds)
    const { items, warnings } = normalizeReferenceItems(parsed.items, compactInput, allowedCandidateIds, limits)
    return { items, warnings, failedChunks: [], success: true }
  } catch (error) {
    const code = typeof error?.code === 'string' ? error.code : 'reference_chunk_parse_failed'
    return { items: [], warnings: [code], failedChunks: [createFailedChunk(chunk, code, error instanceof Error ? error.message : 'Reference chunk normalization failed.', error?.diagnostics)], success: false }
  }
}

async function splitAndRetryLengthChunk({ chunk, compactInput, client, model, limits, chunking, depth, diagnostics }) {
  const canSplit = chunk.rows.length > limits.minCandidatesPerChunk && depth < limits.maxChunkSplitDepth && chunking.apiCallCount < limits.maxApiCalls
  if (!canSplit) {
    return {
      items: [],
      warnings: ['reference_chunk_length_limit'],
      failedChunks: [createFailedChunk(chunk, 'reference_chunk_length_limit', 'AI 응답 생성이 완료되지 않았습니다. (finish_reason: length)', diagnostics)],
      success: false,
    }
  }

  chunking.splitRetryCount += 1
  const midpoint = Math.ceil(chunk.rows.length / 2)
  const childChunks = [
    createSplitChunk(chunk, chunk.rows.slice(0, midpoint), 'a', compactInput, limits),
    createSplitChunk(chunk, chunk.rows.slice(midpoint), 'b', compactInput, limits),
  ].filter((child) => child.rows.length > 0)
  const merged = { items: [], warnings: ['reference_chunk_length_split_retry'], failedChunks: [], success: false }

  for (const childChunk of childChunks) {
    const result = await normalizeReferenceChunk({ chunk: childChunk, compactInput, client, model, limits, chunking, depth: depth + 1 })
    merged.items.push(...result.items)
    merged.warnings.push(...result.warnings)
    merged.failedChunks.push(...result.failedChunks)
    merged.success = merged.success || result.success
  }

  return merged
}

function createSplitChunk(parentChunk, rows, suffix, compactInput, limits) {
  const chunkId = `${parentChunk.chunkId}-${suffix}`
  return {
    chunkId,
    candidateIds: rows.map((row) => row.candidateId).filter(Boolean),
    candidateCount: rows.length,
    rows,
    aiInput: createChunkAiInput({ reference: compactInput.reference, sourceDocument: compactInput.sourceDocument, rows, chunkId, limits }),
  }
}

function createFailedChunk(chunk, code, message, diagnostics = null) {
  return {
    chunkId: chunk.chunkId,
    candidateCount: chunk.candidateCount,
    candidateIds: chunk.candidateIds,
    code,
    message: normalizeText(message, 240),
    ...(isSafeChunkDiagnostics(diagnostics) ? { diagnostics } : {}),
  }
}

function createEmptyChunkingMeta(chunkCount, limits) {
  return {
    chunkCount,
    successfulChunkCount: 0,
    failedChunkCount: 0,
    apiCallCount: 0,
    splitRetryCount: 0,
    maxApiCalls: limits.maxApiCalls,
  }
}

function isSafeChunkDiagnostics(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  return Object.keys(value).every((key) => ['model', 'finishReason', 'contentLength', 'contentType', 'promptTokens', 'completionTokens', 'totalTokens'].includes(key))
}

function sortItemsByManifestOrder(items, manifest) {
  const order = new Map((manifest?.candidates || []).map((candidate, index) => [candidate.candidateId, index]))
  return [...items].sort((left, right) => {
    const leftOrder = order.get(left.candidateId) ?? Number.MAX_SAFE_INTEGER
    const rightOrder = order.get(right.candidateId) ?? Number.MAX_SAFE_INTEGER
    return leftOrder - rightOrder
  })
}

function annotateFinalDuplicateTargets(items) {
  const groups = new Map()
  for (const item of items) {
    const sourceKey = createCandidateKey(item.source?.sheetName, item.source?.rowNumber)
    for (const url of item.expected?.urls || []) {
      const targetKey = createTargetIdentity(url)
      if (!targetKey) continue
      const sourceKeys = groups.get(targetKey) || new Set()
      sourceKeys.add(sourceKey)
      groups.set(targetKey, sourceKeys)
    }
  }

  return items.map((item) => {
    const isDuplicate = (item.expected?.urls || []).some((url) => (groups.get(createTargetIdentity(url)) || new Set()).size > 1)
    return { ...item, duplicateCandidate: isDuplicate }
  })
}

function createTargetIdentity(url) {
  const raw = normalizeText(url?.raw, 800)
  if (!raw) return ''

  try {
    const isAbsolute = raw.startsWith('http://') || raw.startsWith('https://')
    const parsed = isAbsolute ? new URL(raw) : new URL(raw, 'https://reference.local')
    const origin = isAbsolute ? parsed.origin.toLowerCase() : ''
    const path = normalizeDuplicatePath(parsed.pathname || '/', url)
    const query = [...parsed.searchParams.entries()].sort(([leftKey, leftValue], [rightKey, rightValue]) => leftKey.localeCompare(rightKey) || leftValue.localeCompare(rightValue))
      .map(([key, value]) => `${key}=${value}`).join('&')
    const hash = parsed.hash ? parsed.hash.slice(1) : ''
    return `${origin}${path}?${query}#${hash}`
  } catch {
    const path = normalizeDuplicatePath(url?.normalizedPath || raw, url)
    const query = Object.entries(url?.query || {}).sort(([leftKey, leftValue], [rightKey, rightValue]) => leftKey.localeCompare(rightKey) || String(leftValue).localeCompare(String(rightValue)))
      .map(([key, value]) => `${key}=${value}`).join('&')
    return `${path}?${query}#${normalizeText(url?.hash, 240)}`
  }
}

function normalizeDuplicatePath(path, url) {
  const normalized = normalizeText(path, 800) || '/'
  if (url?.allowTrailingSlashVariant === false || normalized === '/') return normalized.toLowerCase()
  return normalized.replace(/\/+$/g, '').toLowerCase() || '/'
}

function assignReferenceIds(items) {
  return items.map((item, index) => ({ ...item, referenceId: `ref-${String(index + 1).padStart(3, '0')}` }))
}

function appendUnmappedCandidateItems(mappedItems, manifest) {
  const mappedKeys = new Set(mappedItems.map((item) => createCandidateKey(item.source?.sheetName, item.source?.rowNumber)))
  const candidates = Array.isArray(manifest?.candidates) ? manifest.candidates : []
  const unmappedItems = []

  for (const candidate of candidates) {
    if (mappedKeys.has(createCandidateKey(candidate.sheetName, candidate.rowNumber))) continue

    const referenceNumber = mappedItems.length + unmappedItems.length + 1
    const candidateRow = {
      cells: {},
      evidenceText: candidate.evidenceText || '',
      detectedUrls: candidate.detectedUrls || [],
    }
    const urlEvidence = classifyGroundedUrlEvidence(candidateRow, [])
    const expectedUrls = createExpectedUrlsFromClassifications(urlEvidence, [])

    unmappedItems.push({
      referenceId: `ref-${String(referenceNumber).padStart(3, '0')}`,
      candidateId: candidate.candidateId,
      isUnmappedCandidate: true,
      duplicateCandidate: false,
      source: {
        sheetName: candidate.sheetName,
        rowNumber: candidate.rowNumber,
        sourceColumns: candidate.sourceColumns || [],
        evidenceText: candidate.evidenceText || '',
      },
      pageContext: { depthPath: [], sectionHint: '', pageUrlHint: '' },
      element: { label: candidate.labelCandidate || 'AI 미매핑 / 검토 필요', aliases: [], roleHint: 'unknown', actionHint: 'navigation' },
      expected: { type: 'url', urls: expectedUrls, urlPatterns: [], notes: 'AI가 정규화하지 못한 문서 후보입니다. 확인 후 Confirm, Edit 또는 Exclude 하세요.' },
      urlEvidence,
      provenance: {
        urlSource: expectedUrls[0]?.provenance?.urlSource || 'explicit-document-cell',
        labelSource: 'inferred-from-row',
        inferenceUsed: true,
        aiRationale: 'Deterministic candidate manifest item not returned by AI normalization.',
      },
      confidence: 0,
      userDecision: { status: 'pending', edited: false, excludedReason: '' },
    })
  }

  return [...mappedItems, ...unmappedItems]
}

function normalizeConfidence(value) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return 0
  return Math.max(0, Math.min(1, Math.round(numeric * 100) / 100))
}

function createReferenceNavigationResult({ reference, compactInput, model, now, items, warnings, openAiCalled, chunking, failedChunks = [] }) {
  const mappedItems = items.filter((item) => item.isUnmappedCandidate !== true)
  const coverage = createCoverageSummary(compactInput.manifest, mappedItems, items)
  const referenceMap = {
    schemaVersion: REFERENCE_NAVIGATION_SCHEMA_VERSION,
    sourceDocument: {
      fileName: normalizeText(reference.fileName, 240),
      mimeType: normalizeText(reference.mimeType, 160),
      analyzedAt: now(),
    },
    items,
    unmappedCandidates: items.filter((item) => item.isUnmappedCandidate === true).map((item) => ({
      candidateId: item.candidateId,
      source: item.source,
      detectedUrls: item.expected?.urls || [],
    })),
  }

  return {
    referenceMap,
    meta: {
      model,
      openAiCalled,
      inputItemCount: compactInput.rows.length,
      outputItemCount: mappedItems.length,
      reviewItemCount: items.length,
      chunking: chunking || createEmptyChunkingMeta(0, REFERENCE_NAVIGATION_LIMITS),
      failedChunks,
      selectedSheetNames: compactInput.manifest?.selectedSheetNames || [],
      candidateManifest: {
        schemaVersion: compactInput.manifest?.schemaVersion,
        totalCandidateRows: compactInput.manifest?.totalCandidateRows || 0,
        totalGroundedUrls: compactInput.manifest?.totalGroundedUrls || 0,
        truncated: compactInput.manifest?.truncated === true,
      },
      coverage,
      warnings: [...new Set(warnings)],
    },
  }
}

function parseReferenceJson(rawText, diagnostics = {}) {
  const text = typeof rawText === 'string' ? rawText.trim() : ''
  if (!text) {
    const message = diagnostics.finishReason === 'length'
      ? 'AI 응답 생성이 완료되지 않았습니다. (finish_reason: length)'
      : 'Reference 분석 API 응답을 처리하지 못했습니다.'
    throw createReferenceNavigationError('empty_ai_response', message, 502, diagnostics)
  }
  try {
    return JSON.parse(text)
  } catch {
    const match = text.match(/\{[\s\S]*\}/)
    if (!match) throw createReferenceNavigationError('invalid_ai_json', 'Reference normalization 응답 JSON을 찾지 못했습니다.', 502, diagnostics)
    try {
      return JSON.parse(match[0])
    } catch {
      throw createReferenceNavigationError('invalid_ai_json', 'Reference normalization 응답 JSON을 파싱하지 못했습니다.', 502, diagnostics)
    }
  }
}

function extractCompletionContent(completion) {
  const content = completion?.choices?.[0]?.message?.content
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''

  return content.map((part) => {
    if (typeof part === 'string') return part
    if (typeof part?.text === 'string') return part.text
    if (typeof part?.content === 'string') return part.content
    if (typeof part?.input_text === 'string') return part.input_text
    return ''
  }).join('')
}

function createCompletionDiagnostics(completion, model) {
  const choice = completion?.choices?.[0] || {}
  const content = choice.message?.content
  const contentText = extractCompletionContent(completion)
  return {
    model,
    finishReason: normalizeText(choice.finish_reason, 80),
    contentLength: contentText.length,
    contentType: Array.isArray(content) ? 'array' : typeof content,
    promptTokens: safeNumber(completion?.usage?.prompt_tokens),
    completionTokens: safeNumber(completion?.usage?.completion_tokens),
    totalTokens: safeNumber(completion?.usage?.total_tokens),
  }
}

function validateReferenceAiSchema(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !Array.isArray(value.items)) {
    throw createReferenceNavigationError('invalid_ai_schema', 'Reference normalization 응답 스키마가 올바르지 않습니다.', 502)
  }

  for (const item of value.items) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw createReferenceNavigationError('invalid_ai_schema', 'Reference item 스키마가 올바르지 않습니다.', 502)
    if (!item.source || typeof item.source !== 'object') throw createReferenceNavigationError('invalid_ai_schema', 'Reference item source가 필요합니다.', 502)
    if (typeof item.source.sheetName !== 'string' || !Number.isInteger(Number(item.source.rowNumber))) throw createReferenceNavigationError('invalid_ai_schema', 'Reference item source provenance가 올바르지 않습니다.', 502)
    if (!item.element || typeof item.element !== 'object') throw createReferenceNavigationError('invalid_ai_schema', 'Reference item element가 필요합니다.', 502)
    if (!item.expected || typeof item.expected !== 'object' || !Array.isArray(item.expected.urls)) throw createReferenceNavigationError('invalid_ai_schema', 'Reference item expected.urls가 필요합니다.', 502)
    for (const url of item.expected.urls) {
      if (!url || typeof url !== 'object' || typeof url.raw !== 'string') throw createReferenceNavigationError('invalid_ai_schema', 'Reference item URL raw가 필요합니다.', 502)
    }
  }
}

function createCandidatePriority(candidate) {
  let priority = 0
  const detectedUrls = Array.isArray(candidate.detectedUrls) ? candidate.detectedUrls : []
  if (detectedUrls.some((url) => url.provenance === 'hyperlink-cell')) priority += 100
  if (detectedUrls.some((url) => url.provenance === 'explicit-absolute-url')) priority += 95
  if (detectedUrls.some((url) => url.provenance === 'explicit-relative-path' || url.provenance === 'primary-navigation-column')) priority += 90
  if (detectedUrls.length > 0) priority += 50
  if (candidate.candidateConfidence === 'review') priority -= 20
  return priority
}

function getCellTextParts(value) {
  if (value === null || value === undefined) return []
  if (typeof value === 'object' && !Array.isArray(value)) {
    return [
      normalizeText(value.text, 1000) ? { text: normalizeText(value.text, 1000), kind: 'text' } : null,
      normalizeText(value.hyperlink, 1000) ? { text: normalizeText(value.hyperlink, 1000), kind: 'hyperlink' } : null,
    ].filter(Boolean)
  }
  const text = normalizeText(value, 1000)
  return text ? [{ text, kind: 'text' }] : []
}

function createEvidenceText(cells, maxLength) {
  const parts = []
  for (const [column, value] of Object.entries(cells)) {
    const text = getCellTextParts(value).map((part) => part.text).join(' ')
    if (text) parts.push(`${column}: ${text}`)
  }
  return normalizeText(parts.join(' | '), maxLength)
}

function createConnectedEvidenceText(aiEvidenceText, rowEvidenceText) {
  const text = normalizeText(aiEvidenceText, 800)
  if (!text) return rowEvidenceText
  const rowText = rowEvidenceText.toLowerCase()
  const sharedTokens = text.toLowerCase().split(/\s+/).filter((token) => token.length >= 3 && rowText.includes(token))
  return sharedTokens.length > 0 ? text : rowEvidenceText
}

function normalizeStringArray(value, maxItems, maxLength) {
  if (!Array.isArray(value)) return []
  return [...new Set(value.map((item) => normalizeText(item, maxLength)).filter(Boolean))].slice(0, maxItems)
}

function normalizeText(value, maxLength) {
  const text = typeof value === 'string' ? value : value === null || value === undefined ? '' : String(value)
  return text.replace(/\s+/g, ' ').trim().slice(0, maxLength)
}

function safeNumber(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : 0
}

function isEmptyValue(value) {
  if (value === null || value === undefined) return true
  if (typeof value === 'string') return value.trim() === ''
  if (typeof value === 'object') return isEmptyValue(value.text) && isEmptyValue(value.hyperlink)
  return false
}

function createRowKey(sheetName, rowNumber) {
  return `${sheetName}\u0000${rowNumber}`
}

function containsUnsafeRawPayload(value, depth = 0) {
  if (depth > 8) return false
  if (typeof value === 'string') return /^data:[^,]+;base64,/i.test(value) || (value.length > 5000 && /^[A-Za-z0-9+/=\r\n]+$/.test(value))
  if (!value || typeof value !== 'object') return false
  if (Array.isArray(value)) return value.some((item) => containsUnsafeRawPayload(item, depth + 1))
  return Object.values(value).some((item) => containsUnsafeRawPayload(item, depth + 1))
}

function isTimeoutError(error) {
  const text = `${error?.name || ''} ${error?.code || ''} ${error?.message || ''}`.toLowerCase()
  return /timeout|timedout|abort/.test(text)
}

export function createReferenceNavigationError(code, message, status = 502, diagnostics = null) {
  const error = new Error(message)
  error.name = 'ReferenceNavigationError'
  error.code = code
  error.status = status
  if (diagnostics && typeof diagnostics === 'object') error.diagnostics = diagnostics
  return error
}
