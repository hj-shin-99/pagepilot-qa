import ExcelJS from 'exceljs'
import { createReferenceWorkbookSheetSummaries } from './referenceCandidateManifest.js'

export const REFERENCE_WORKBOOK_LIMITS = Object.freeze({
  maxSheets: 20,
  maxRowsPerSheet: 500,
  maxTotalRows: 2000,
  maxCellsPerRow: 80,
  maxCellTextLength: 500,
  maxHeaderCandidateRows: 5,
})

export async function extractReferenceWorkbook(buffer, options = {}) {
  const limits = { ...REFERENCE_WORKBOOK_LIMITS, ...(options.limits || {}) }
  const workbook = new ExcelJS.Workbook()

  await workbook.xlsx.load(buffer)

  const worksheets = workbook.worksheets.slice(0, limits.maxSheets)
  let totalRows = 0
  const sheets = worksheets.map((worksheet) => extractSheetFacts(worksheet, limits, () => totalRows, (count) => {
    totalRows += count
  }))
  const sheetSummaries = createReferenceWorkbookSheetSummaries(sheets)

  return {
    sheetCount: sheets.length,
    workbookSheetCount: workbook.worksheets.length,
    sheetsTruncated: workbook.worksheets.length > sheets.length,
    totalRowCount: totalRows,
    limits,
    sheetSummaries,
    sheets,
  }
}

function extractSheetFacts(worksheet, limits, getTotalRows, addTotalRows) {
  const rows = []
  let startRow = null
  let endRow = null
  let rowsTruncated = false

  worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rows.length >= limits.maxRowsPerSheet || getTotalRows() >= limits.maxTotalRows) {
      rowsTruncated = true
      return
    }

    const { cells, cellsTruncated } = extractRowCells(row, limits)
    if (Object.keys(cells).length === 0) return

    startRow = startRow === null ? rowNumber : startRow
    endRow = rowNumber
    rows.push({ rowNumber, cells, ...(cellsTruncated ? { cellsTruncated: true } : {}) })
    addTotalRows(1)
  })

  return {
    sheetName: worksheet.name,
    rowCount: rows.length,
    usedRange: startRow === null ? null : { startRow, endRow },
    headerCandidates: rows.slice(0, limits.maxHeaderCandidateRows).map((row) => ({
      rowNumber: row.rowNumber,
      cells: row.cells,
    })),
    rows,
    rowsTruncated,
  }
}

function extractRowCells(row, limits) {
  const cells = {}
  let nonEmptyCellCount = 0
  let cellsTruncated = false

  row.eachCell({ includeEmpty: false }, (cell) => {
    if (isMergedDuplicate(cell)) return

    const value = normalizeCellValue(cell.value, cell, limits)
    if (isEmptyValue(value)) return


    nonEmptyCellCount += 1
    if (nonEmptyCellCount > limits.maxCellsPerRow) {
      cellsTruncated = true
      return
    }

    cells[columnNumberToName(cell.col)] = value
  })

  return { cells, cellsTruncated }
}

function normalizeCellValue(value, cell, limits) {
  const normalized = normalizeExcelValue(value, limits)
  const hyperlink = getCellHyperlink(value, cell, limits)

  if (!hyperlink) return normalized

  const text = valueToText(normalized, limits)
  return isEmptyValue(text) ? { hyperlink } : { text, hyperlink }
}

function normalizeExcelValue(value, limits) {
  if (value === null || value === undefined) return null
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString()

  if (typeof value === 'string') return truncateText(value.trim(), limits.maxCellTextLength)
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value)
  if (typeof value === 'boolean') return value
  if (Buffer.isBuffer(value)) return '[binary]'

  if (typeof value === 'object') {
    if ('formula' in value) return normalizeExcelValue(value.result ?? value.text ?? null, limits)
    if (Array.isArray(value.richText)) return truncateText(value.richText.map((part) => part.text || '').join('').trim(), limits.maxCellTextLength)
    if ('text' in value) return truncateText(String(value.text ?? '').trim(), limits.maxCellTextLength)
    if ('error' in value) return truncateText(String(value.error || '').trim(), limits.maxCellTextLength)
  }

  return truncateText(String(value).trim(), limits.maxCellTextLength)
}

function getCellHyperlink(value, cell, limits) {
  const hyperlink = typeof value === 'object' && value !== null && typeof value.hyperlink === 'string'
    ? value.hyperlink
    : cell?.hyperlink

  return typeof hyperlink === 'string' && hyperlink.trim()
    ? truncateText(hyperlink.trim(), limits.maxCellTextLength)
    : ''
}

function valueToText(value, limits) {
  if (value === null || value === undefined) return ''
  if (typeof value === 'object') return truncateText(String(value.text ?? '').trim(), limits.maxCellTextLength)
  return truncateText(String(value).trim(), limits.maxCellTextLength)
}

function isEmptyValue(value) {
  if (value === null || value === undefined) return true
  if (typeof value === 'string') return value.trim() === ''
  if (typeof value === 'object') return isEmptyValue(value.text) && isEmptyValue(value.hyperlink)
  return false
}

function isMergedDuplicate(cell) {
  return Boolean(cell?.isMerged && cell.master && cell.address !== cell.master.address)
}

function truncateText(value, maxLength) {
  if (value.length <= maxLength) return value
  if (maxLength <= 3) return value.slice(0, maxLength)
  return `${value.slice(0, maxLength - 3)}...`
}

function columnNumberToName(columnNumber) {
  let current = columnNumber
  let name = ''

  while (current > 0) {
    const remainder = (current - 1) % 26
    name = String.fromCharCode(65 + remainder) + name
    current = Math.floor((current - 1) / 26)
  }

  return name
}
