import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import ExcelJS from 'exceljs'
import { extractReferenceWorkbook } from './referenceWorkbookExtractor.js'

test('extracts multiple sheet names and compact rows', async () => {
  const buffer = await createWorkbookBuffer((workbook) => {
    const first = workbook.addWorksheet('First Sheet')
    first.addRow(['Section', 'Label'])
    first.addRow(['Hero', 'Primary CTA'])

    const second = workbook.addWorksheet('Second Sheet')
    second.addRow(['Page', 'Action'])
    second.addRow(['Detail', 'Download'])
  })

  const result = await extractReferenceWorkbook(buffer)

  assert.equal(result.sheetCount, 2)
  assert.equal(result.workbookSheetCount, 2)
  assert.deepEqual(result.sheets.map((sheet) => sheet.sheetName), ['First Sheet', 'Second Sheet'])
  assert.equal(result.sheets[0].rowCount, 2)
  assert.deepEqual(result.sheets[0].rows[1], { rowNumber: 2, cells: { A: 'Hero', B: 'Primary CTA' } })
})

test('removes empty rows and empty cells', async () => {
  const buffer = await createWorkbookBuffer((workbook) => {
    const sheet = workbook.addWorksheet('Sparse')
    sheet.getCell('A1').value = 'Header'
    sheet.getCell('C3').value = 'Only value'
    sheet.getCell('B4').value = '   '
  })

  const result = await extractReferenceWorkbook(buffer)

  assert.equal(result.sheets[0].rowCount, 2)
  assert.deepEqual(result.sheets[0].usedRange, { startRow: 1, endRow: 3 })
  assert.deepEqual(result.sheets[0].rows, [
    { rowNumber: 1, cells: { A: 'Header' } },
    { rowNumber: 3, cells: { C: 'Only value' } },
  ])
})

test('normalizes string number date boolean and formula result values', async () => {
  const date = new Date('2026-08-21T12:34:56.000Z')
  const buffer = await createWorkbookBuffer((workbook) => {
    const sheet = workbook.addWorksheet('Types')
    sheet.getCell('A1').value = 'Text'
    sheet.getCell('B1').value = 123.45
    sheet.getCell('C1').value = date
    sheet.getCell('D1').value = true
    sheet.getCell('E1').value = { formula: 'B1*2', result: 246.9 }
  })

  const result = await extractReferenceWorkbook(buffer)

  assert.deepEqual(result.sheets[0].rows[0].cells, {
    A: 'Text',
    B: 123.45,
    C: date.toISOString(),
    D: true,
    E: 246.9,
  })
})

test('preserves hyperlink text and target', async () => {
  const buffer = await createWorkbookBuffer((workbook) => {
    const sheet = workbook.addWorksheet('Links')
    sheet.getCell('A1').value = { text: 'Open page', hyperlink: 'https://example.com/page' }
  })

  const result = await extractReferenceWorkbook(buffer)

  assert.deepEqual(result.sheets[0].rows[0].cells.A, {
    text: 'Open page',
    hyperlink: 'https://example.com/page',
  })
})

test('adds generic sheet summaries with navigation candidate counts', async () => {
  const buffer = await createWorkbookBuffer((workbook) => {
    const first = workbook.addWorksheet('Navigation A')
    first.addRow(['Label', 'Target URL'])
    first.addRow(['Home', '/home'])

    const second = workbook.addWorksheet('Navigation B')
    second.addRow(['Label', 'Target URL'])
    second.addRow(['Help', '/help'])
    second.addRow(['External', { text: 'Open', hyperlink: 'https://example.test' }])

    const third = workbook.addWorksheet('Tasks')
    third.addRow(['Task', 'Owner'])
    third.addRow(['Write copy', 'Content'])
  })

  const result = await extractReferenceWorkbook(buffer)

  assert.deepEqual(result.sheetSummaries.map((sheet) => sheet.sheetName), ['Navigation A', 'Navigation B', 'Tasks'])
  assert.equal(result.sheetSummaries[0].navigationCandidateRowCount, 1)
  assert.equal(result.sheetSummaries[1].navigationCandidateRowCount, 2)
  assert.equal(result.sheetSummaries[2].navigationCandidateRowCount, 0)
  assert.equal(result.sheetSummaries[2].urlLikeTargetCount, 0)
})

test('truncates excessive cell text within configured limit', async () => {
  const buffer = await createWorkbookBuffer((workbook) => {
    const sheet = workbook.addWorksheet('Long Text')
    sheet.getCell('A1').value = 'abcdefghijklmnopqrstuvwxyz'
  })

  const result = await extractReferenceWorkbook(buffer, { limits: { maxCellTextLength: 10 } })

  assert.equal(result.sheets[0].rows[0].cells.A, 'abcdefg...')
  assert.equal(result.sheets[0].rows[0].cells.A.length, 10)
})

test('keeps extraction generic with no customer or fixed sheet/column terms', () => {
  const source = [
    fs.readFileSync(new URL('./referenceWorkbookExtractor.js', import.meta.url), 'utf8'),
    fs.readFileSync(new URL('./referenceFileUploadRoute.js', import.meta.url), 'utf8'),
  ].join('\n')

  assert.equal(/BMW|BMWFS|TOBE-IA|URL=F|F열/.test(source), false)
})

async function createWorkbookBuffer(fillWorkbook) {
  const workbook = new ExcelJS.Workbook()
  fillWorkbook(workbook)
  return Buffer.from(await workbook.xlsx.writeBuffer())
}
