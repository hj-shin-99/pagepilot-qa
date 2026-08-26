export const REFERENCE_CANDIDATE_SCHEMA_VERSION = 'reference-candidate-manifest-v1'

const URL_LIKE_PATTERN = /https?:\/\/[^\s<>()"']+|\/[A-Za-z0-9._~:/?#[\]@!$&'*+;=%{}-]+/g
const GENERIC_NAVIGATION_TERMS = /\b(url|uri|href|link|target|destination|path|route|page|menu|navigation|navigate|nav|cta|button|action|click|open|landing|redirect|address)\b|링크|주소|경로|메뉴|이동|화면|페이지|버튼/i
const API_CONTEXT_PATTERN = /\b(api|endpoint|request|response|method|payload|parameter|schema|json|http status|status code)\b|\b(GET|POST|PUT|PATCH|DELETE)\b/i

export function createReferenceWorkbookSheetSummaries(sheets = []) {
  const summaries = sheets.map((sheet) => {
    const headerColumns = inferPrimaryNavigationColumns(sheet)
    const candidates = createSheetCandidates(sheet, headerColumns)
    const nonEmptyRowCount = Number.isFinite(Number(sheet?.rowCount)) ? Number(sheet.rowCount) : Array.isArray(sheet?.rows) ? sheet.rows.length : 0
    const urlLikeTargetCount = countUniqueUrls(candidates.flatMap((candidate) => candidate.detectedUrls))
    const navigationCandidateRowCount = candidates.filter((candidate) => candidate.detectedUrls.some((url) => url.provenance !== 'descriptive-text-url-like')).length
    const density = nonEmptyRowCount > 0 ? navigationCandidateRowCount / nonEmptyRowCount : 0
    const structuredRowConsistency = calculateStructuredRowConsistency(sheet)

    return {
      sheetName: normalizeText(sheet?.sheetName, 160),
      nonEmptyRowCount,
      navigationCandidateRowCount,
      urlLikeTargetCount,
      headerCandidatesSummary: summarizeHeaderCandidates(sheet?.headerCandidates),
      primaryNavigationColumnCandidates: [...headerColumns],
      recommendationScore: roundScore((density * 0.55) + (Math.min(urlLikeTargetCount, 120) / 120 * 0.3) + (structuredRowConsistency * 0.15)),
    }
  })

  const rankedScores = [...new Set(summaries.map((summary) => summary.recommendationScore).filter((score) => score > 0))].sort((left, right) => right - left)
  return summaries.map((summary) => ({
    ...summary,
    recommendationRank: rankedScores.indexOf(summary.recommendationScore) + 1 || 0,
  }))
}

export function createReferenceCandidateManifest(reference, options = {}) {
  const maxCandidates = Number.isFinite(Number(options.maxCandidates)) && Number(options.maxCandidates) > 0 ? Number(options.maxCandidates) : 2000
  const sourceSheets = Array.isArray(reference?.sheets) ? reference.sheets : []
  const candidates = []

  for (const sheet of sourceSheets) {
    const sheetName = normalizeText(sheet?.sheetName, 160)
    if (!sheetName) continue

    const headerColumns = inferPrimaryNavigationColumns(sheet)
    for (const candidate of createSheetCandidates({ ...sheet, sheetName }, headerColumns)) {
      if (candidates.length >= maxCandidates) break
      candidates.push(candidate)
    }
  }

  const withIds = candidates.map((candidate, index) => ({
    candidateId: `cand-${String(index + 1).padStart(4, '0')}`,
    ...candidate,
  }))

  return {
    schemaVersion: REFERENCE_CANDIDATE_SCHEMA_VERSION,
    selectedSheetNames: sourceSheets.map((sheet) => normalizeText(sheet?.sheetName, 160)).filter(Boolean),
    totalCandidateRows: withIds.length,
    totalGroundedUrls: countCandidateUrls(withIds),
    candidates: withIds,
    truncated: candidates.length >= maxCandidates,
  }
}

export function createCoverageSummary(manifest, mappedItems = [], reviewItems = mappedItems) {
  const candidates = Array.isArray(manifest?.candidates) ? manifest.candidates : []
  const candidateKeys = new Set(candidates.map((candidate) => createCandidateKey(candidate.sheetName, candidate.rowNumber)))
  const mappedRowKeys = new Set()
  const urlEvidenceCoverage = createUrlEvidenceCoverage(candidates, reviewItems)

  for (const item of mappedItems) {
    const key = createCandidateKey(item?.source?.sheetName, item?.source?.rowNumber)
    if (!candidateKeys.has(key)) continue
    mappedRowKeys.add(key)
  }

  const totalCandidateRows = candidates.length
  const totalGroundedUrls = countCandidateUrls(candidates)
  const mappedCandidateRows = mappedRowKeys.size
  const unmappedCandidateRows = Math.max(0, totalCandidateRows - mappedCandidateRows)
  const mappedGroundedUrls = countExpectedClassifiedUrls(mappedItems)
  const unmappedGroundedUrls = Math.max(0, totalGroundedUrls - mappedGroundedUrls)
  const rowCoverage = {
    totalCandidateRows,
    mappedCandidateRows,
    unmappedCandidateRows,
    ratio: totalCandidateRows > 0 ? roundScore(mappedCandidateRows / totalCandidateRows) : 0,
  }

  return {
    totalCandidateRows,
    totalGroundedUrls,
    mappedCandidateRows,
    mappedGroundedUrls,
    unmappedCandidateRows,
    unmappedGroundedUrls,
    coverageRatio: rowCoverage.ratio,
    coverageRatioMeaning: 'rowCoverage.ratio',
    rowCoverage,
    urlEvidenceCoverage,
  }
}

function countExpectedClassifiedUrls(items) {
  return items.reduce((count, item) => count + (Array.isArray(item?.urlEvidence)
    ? item.urlEvidence.filter((url) => ['primary-navigation', 'additional-navigation', 'navigation-state-variant'].includes(url.classification)).length
    : Array.isArray(item?.expected?.urls) ? item.expected.urls.length : 0), 0)
}

function createUrlEvidenceCoverage(candidates, items) {
  const totalGroundedUrls = countCandidateUrls(candidates)
  const evidence = items.flatMap((item) => Array.isArray(item?.urlEvidence) ? item.urlEvidence : [])
  const counts = {
    totalGroundedUrls,
    classifiedGroundedUrls: evidence.length,
    expectedGroundedUrls: evidence.filter((url) => ['primary-navigation', 'additional-navigation', 'navigation-state-variant'].includes(url.classification)).length,
    primaryNavigationUrls: evidence.filter((url) => url.classification === 'primary-navigation').length,
    additionalNavigationUrls: evidence.filter((url) => url.classification === 'additional-navigation').length,
    navigationStateVariantUrls: evidence.filter((url) => url.classification === 'navigation-state-variant').length,
    parameterTemplateUrls: evidence.filter((url) => url.classification === 'parameter-template').length,
    descriptiveOnlyUrls: evidence.filter((url) => url.classification === 'descriptive-only').length,
    duplicateEvidenceUrls: evidence.filter((url) => url.classification === 'duplicate-evidence').length,
    reviewNeededUrls: evidence.filter((url) => url.classification === 'review-needed').length,
    unclassifiedGroundedUrls: Math.max(0, totalGroundedUrls - evidence.length),
  }

  return {
    ...counts,
    classificationRatio: totalGroundedUrls > 0 ? roundScore(counts.classifiedGroundedUrls / totalGroundedUrls) : 0,
  }
}

export function createCandidateKey(sheetName, rowNumber) {
  return `${normalizeText(sheetName, 160)}\u0000${Number(rowNumber)}`
}

function createSheetCandidates(sheet, headerColumns) {
  const sheetName = normalizeText(sheet?.sheetName, 160)
  const rows = Array.isArray(sheet?.rows) ? sheet.rows : []
  const candidates = []

  for (const row of rows) {
    const rowNumber = Number(row?.rowNumber)
    if (!Number.isInteger(rowNumber) || rowNumber <= 0) continue

    const cells = normalizeCells(row.cells)
    const detectedUrls = extractRowUrls(cells, headerColumns)
    if (detectedUrls.length === 0) continue

    const highConfidenceUrls = detectedUrls.filter((url) => url.provenance !== 'descriptive-text-url-like')
    const evidenceText = createEvidenceText(cells, 800)
    if (isHeaderLikeRow(cells, sheet.headerCandidates) && highConfidenceUrls.length === 0) continue

    const contextText = createContextText(cells, detectedUrls)
    const sourceColumns = [...new Set(detectedUrls.map((url) => url.sourceColumn).filter(Boolean))]

    candidates.push({
      sheetName,
      rowNumber,
      labelCandidate: contextText || highConfidenceUrls[0]?.raw || detectedUrls[0]?.raw || '',
      detectedUrls,
      evidenceText,
      sourceColumns,
      candidateConfidence: highConfidenceUrls.length > 0 ? 'high' : 'review',
    })
  }

  return candidates
}

function inferPrimaryNavigationColumns(sheet) {
  const columns = new Set()
  const headerRows = Array.isArray(sheet?.headerCandidates) ? sheet.headerCandidates : []

  for (const headerRow of headerRows) {
    const cells = normalizeCells(headerRow?.cells)
    for (const [column, value] of Object.entries(cells)) {
      const text = getCellTextParts(value).map((part) => part.text).join(' ')
      if (GENERIC_NAVIGATION_TERMS.test(text)) columns.add(column)
    }
  }

  return columns
}

function extractRowUrls(cells, primaryNavigationColumns) {
  const urls = []
  const rowText = createEvidenceText(cells, 1000)

  for (const [column, value] of Object.entries(cells)) {
    for (const part of getCellTextParts(value)) {
      for (const raw of extractUrlLikeTexts(part.text)) {
        const provenance = getUrlProvenance({ raw, text: part.text, index: raw.index, kind: part.kind, hasNavigationContext: primaryNavigationColumns.has(column) })
        if (!provenance) continue

        urls.push({
          raw: raw.text,
          sourceColumn: column,
          sourceText: part.text,
          sourceIndex: raw.index,
          provenance,
          confidence: provenance === 'descriptive-text-url-like' || API_CONTEXT_PATTERN.test(rowText) ? 'review' : 'high',
        })
      }
    }
  }

  return dedupeDetectedUrls(urls)
}

function extractUrlLikeTexts(text) {
  return [...String(text || '').matchAll(URL_LIKE_PATTERN)]
    .map((match) => ({ text: trimUrlToken(match[0]), index: match.index || 0 }))
    .filter((match) => match.text)
}

function trimUrlToken(value) {
  let text = String(value || '').trim().replace(/[.,;]+$/g, '')
  while (/[\])}]$/.test(text) && !hasBalancedClosingToken(text)) text = text.slice(0, -1).trim()
  return text
}

function hasBalancedClosingToken(text) {
  const last = text.at(-1)
  if (last === ')') return (text.match(/\(/g) || []).length >= (text.match(/\)/g) || []).length
  if (last === ']') return (text.match(/\[/g) || []).length >= (text.match(/\]/g) || []).length
  if (last === '}') return (text.match(/\{/g) || []).length >= (text.match(/}/g) || []).length
  return true
}

function dedupeDetectedUrls(urls) {
  const seen = new Set()
  return urls.filter((url) => {
    const key = `${url.raw}\u0000${url.sourceColumn}\u0000${url.provenance}\u0000${url.sourceIndex ?? ''}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function normalizeCells(cells) {
  if (!cells || typeof cells !== 'object' || Array.isArray(cells)) return {}
  const normalized = {}

  for (const [column, value] of Object.entries(cells)) {
    const columnName = normalizeText(column, 8)
    if (!/^[A-Z]{1,3}$/.test(columnName)) continue
    const normalizedValue = normalizeCellValue(value)
    if (!isEmptyValue(normalizedValue)) normalized[columnName] = normalizedValue
  }

  return normalized
}

function normalizeCellValue(value) {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return normalizeText(value, 500)
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value)
  if (typeof value === 'boolean') return value
  if (typeof value === 'object' && !Array.isArray(value)) {
    const text = normalizeText(value.text, 500)
    const hyperlink = normalizeText(value.hyperlink, 500)
    if (text || hyperlink) return { ...(text ? { text } : {}), ...(hyperlink ? { hyperlink } : {}) }
  }
  return normalizeText(String(value), 500)
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

function createContextText(cells, detectedUrls) {
  const urlColumns = new Set(detectedUrls.map((url) => url.sourceColumn))
  const parts = []

  for (const [column, value] of Object.entries(cells)) {
    if (urlColumns.has(column)) continue
    const text = getCellTextParts(value).map((part) => part.text).join(' ')
    if (text && !extractUrlLikeTexts(text).length) parts.push(text)
  }

  return normalizeText(parts.slice(0, 3).join(' / '), 240)
}

function getUrlProvenance({ raw, text, index, kind, hasNavigationContext }) {
  if (kind === 'hyperlink') return 'hyperlink-cell'
  if (isAbsoluteUrl(raw.text)) return 'explicit-absolute-url'
  if (isSlashSeparatedLabelToken(text, index, raw.text)) return null
  if (isStandalonePathCell(text, raw.text) || hasNavigationContext) return 'explicit-relative-path'
  return 'descriptive-text-url-like'
}

function isAbsoluteUrl(raw) {
  return /^https?:\/\//i.test(raw)
}

function isStandalonePathCell(text, raw) {
  return normalizeText(text, 1000) === raw
}

function isSlashSeparatedLabelToken(text, index, raw) {
  if (index <= 0 || isAbsoluteUrl(raw)) return false
  const previous = text[index - 1] || ''
  if (!/[A-Za-z0-9가-힣]/.test(previous)) return false
  if (/[/?#.:{}%]/.test(raw.slice(1))) return false
  const segment = raw.slice(1)
  if (!segment || segment.length > 16) return false
  const next = text[index + raw.length] || ''
  if (next && /[A-Za-z0-9가-힣]/.test(next)) return false
  return /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(segment)
}

function isHeaderLikeRow(cells, headerCandidates) {
  const rowSignature = createCellSignature(cells)
  if (!rowSignature) return false

  return (Array.isArray(headerCandidates) ? headerCandidates : []).some((row) => createCellSignature(normalizeCells(row?.cells)) === rowSignature)
}

function createCellSignature(cells) {
  const entries = Object.entries(cells || {}).map(([column, value]) => `${column}:${getCellTextParts(value).map((part) => part.text.toLowerCase()).join(' ')}`)
  return entries.length ? entries.join('|') : ''
}

function summarizeHeaderCandidates(headerCandidates) {
  if (!Array.isArray(headerCandidates)) return []
  return headerCandidates.slice(0, 5).map((row) => {
    const cells = normalizeCells(row?.cells)
    return {
      rowNumber: Number.isInteger(Number(row?.rowNumber)) ? Number(row.rowNumber) : 0,
      labels: Object.entries(cells).slice(0, 8).map(([column, value]) => `${column}:${getCellTextParts(value).map((part) => part.text).join(' ')}`).filter(Boolean),
    }
  }).filter((row) => row.rowNumber > 0 && row.labels.length > 0)
}

function calculateStructuredRowConsistency(sheet) {
  const rows = Array.isArray(sheet?.rows) ? sheet.rows : []
  if (rows.length === 0) return 0
  const counts = rows.map((row) => Object.keys(normalizeCells(row?.cells)).length).filter((count) => count > 0)
  if (counts.length === 0) return 0
  const average = counts.reduce((sum, count) => sum + count, 0) / counts.length
  const closeRows = counts.filter((count) => Math.abs(count - average) <= Math.max(1, average * 0.35)).length
  return closeRows / counts.length
}

function countUniqueUrls(urls) {
  return new Set(urls.map((url) => normalizeText(url.raw, 500)).filter(Boolean)).size
}

function countCandidateUrls(candidates) {
  return candidates.reduce((count, candidate) => count + (Array.isArray(candidate.detectedUrls) ? candidate.detectedUrls.length : 0), 0)
}

function roundScore(value) {
  return Math.round(Math.max(0, Math.min(1, Number(value) || 0)) * 100) / 100
}

function isEmptyValue(value) {
  if (value === null || value === undefined) return true
  if (typeof value === 'string') return value.trim() === ''
  if (typeof value === 'object') return isEmptyValue(value.text) && isEmptyValue(value.hyperlink)
  return false
}

function normalizeText(value, maxLength) {
  const text = typeof value === 'string' ? value : value === null || value === undefined ? '' : String(value)
  return text.replace(/\s+/g, ' ').trim().slice(0, maxLength)
}
