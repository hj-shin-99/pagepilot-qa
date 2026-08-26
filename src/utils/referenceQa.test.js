import test from 'node:test'
import assert from 'node:assert/strict'
import { analyzeReferenceFile, filterReferenceSheets, normalizeReference } from './referenceQa.js'

test('analyzeReferenceFile uploads using referenceFile field', async () => {
  const appended = []
  const OriginalFormData = globalThis.FormData
  globalThis.FormData = class TestFormData {
    append(name, value) {
      appended.push({ name, value })
    }
  }

  const file = { name: 'reference.xlsx' }
  const reference = { fileName: 'reference.xlsx', sheets: [] }
  const requests = []

  try {
    const result = await analyzeReferenceFile(file, {
      fetchFn: async (url, options) => {
        requests.push({ url, options })
        return createJsonResponse({ ok: true, reference })
      },
    })

    assert.deepEqual(result, reference)
    assert.equal(requests[0].url, '/api/reference/analyze')
    assert.equal(requests[0].options.method, 'POST')
    assert.equal(requests[0].options.headers, undefined)
    assert.deepEqual(appended, [{ name: 'referenceFile', value: file }])
  } finally {
    globalThis.FormData = OriginalFormData
  }
})

test('normalizeReference posts compact reference JSON to normalize endpoint', async () => {
  const reference = { fileName: 'reference.xlsx', sheets: [] }
  const referenceMap = { schemaVersion: 'navigation-intent-reference-v1', sourceDocument: {}, items: [] }
  const requests = []

  const result = await normalizeReference(reference, {
    fetchFn: async (url, options) => {
      requests.push({ url, options })
      return createJsonResponse({ ok: true, referenceMap, meta: { model: 'test-model' } })
    },
  })

  assert.deepEqual(result, { referenceMap, meta: { model: 'test-model' } })
  assert.equal(requests[0].url, '/api/reference/normalize')
  assert.equal(requests[0].options.method, 'POST')
  assert.deepEqual(requests[0].options.headers, { 'Content-Type': 'application/json' })
  assert.deepEqual(JSON.parse(requests[0].options.body), { reference })
})

test('normalizeReference sends only selected sheets when sheet names are provided', async () => {
  const reference = {
    fileName: 'reference.xlsx',
    sheetCount: 3,
    totalRowCount: 5,
    sheetSummaries: [
      { sheetName: 'Current Navigation' },
      { sheetName: 'Proposed Navigation' },
      { sheetName: 'Work Breakdown' },
    ],
    sheets: [
      { sheetName: 'Current Navigation', rowCount: 2, rows: [{ rowNumber: 2, cells: { A: '/current' } }] },
      { sheetName: 'Proposed Navigation', rowCount: 2, rows: [{ rowNumber: 2, cells: { A: '/proposed' } }] },
      { sheetName: 'Work Breakdown', rowCount: 1, rows: [{ rowNumber: 2, cells: { A: 'Task' } }] },
    ],
  }
  const referenceMap = { schemaVersion: 'navigation-intent-reference-v1', sourceDocument: {}, items: [] }
  const requests = []

  await normalizeReference(reference, {
    selectedSheetNames: ['Proposed Navigation'],
    fetchFn: async (url, options) => {
      requests.push({ url, options })
      return createJsonResponse({ ok: true, referenceMap, meta: {} })
    },
  })

  const body = JSON.parse(requests[0].options.body)
  assert.deepEqual(body.reference.sheets.map((sheet) => sheet.sheetName), ['Proposed Navigation'])
  assert.deepEqual(body.reference.sheetSummaries.map((sheet) => sheet.sheetName), ['Proposed Navigation'])
  assert.equal(body.reference.totalRowCount, 2)
})

test('filterReferenceSheets leaves workbook facts otherwise intact while dropping unselected sheets', () => {
  const filtered = filterReferenceSheets({
    fileName: 'reference.xlsx',
    workbookSheetCount: 2,
    sheets: [
      { sheetName: 'First', rowCount: 1, rows: [] },
      { sheetName: 'Second', rowCount: 3, rows: [] },
    ],
  }, ['Second'])

  assert.equal(filtered.fileName, 'reference.xlsx')
  assert.equal(filtered.workbookSheetCount, 2)
  assert.equal(filtered.sheetCount, 1)
  assert.equal(filtered.totalRowCount, 3)
  assert.deepEqual(filtered.sheets.map((sheet) => sheet.sheetName), ['Second'])
})

test('Reference API failure returns safe code and message without damaging unrelated app state', async () => {
  await assert.rejects(
    () => analyzeReferenceFile({ name: 'bad.xlsx' }, {
      fetchFn: async () => createJsonResponse({ ok: false, code: 'reference_parse_failed', message: 'Reference Excel 파일을 읽지 못했습니다.' }, { ok: false, status: 422 }),
    }),
    { code: 'reference_parse_failed', message: 'Reference Excel 파일을 읽지 못했습니다.' },
  )

  await assert.rejects(
    () => normalizeReference({ sheets: [] }, {
      fetchFn: async () => createJsonResponse({ ok: false, code: 'missing_api_key', message: 'OPENAI_API_KEY가 설정되지 않았습니다.' }, { ok: false, status: 400 }),
    }),
    { code: 'missing_api_key', message: 'OPENAI_API_KEY가 설정되지 않았습니다.' },
  )
})

function createJsonResponse(payload, options = {}) {
  return {
    ok: options.ok ?? true,
    status: options.status || 200,
    async json() {
      return payload
    },
  }
}
