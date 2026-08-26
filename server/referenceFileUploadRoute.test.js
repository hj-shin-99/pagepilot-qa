import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import express from 'express'
import ExcelJS from 'exceljs'
import { createReferenceFileUploadRoute } from './referenceFileUploadRoute.js'

const XLSX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

test('POST /api/reference/analyze accepts a valid xlsx upload', async () => {
  const buffer = await createWorkbookBuffer((workbook) => {
    const sheet = workbook.addWorksheet('Reference')
    sheet.addRow(['Header', 'Value'])
    sheet.addRow(['Navigation', 'Intent'])
  })

  const { status, body } = await postReferenceFile({ buffer, fileName: 'reference.xlsx', mimeType: XLSX_MIME_TYPE })

  assert.equal(status, 200)
  assert.equal(body.ok, true)
  assert.equal(body.reference.fileName, 'reference.xlsx')
  assert.equal(body.reference.mimeType, XLSX_MIME_TYPE)
  assert.equal(body.reference.size, buffer.length)
  assert.equal(body.reference.sheets[0].sheetName, 'Reference')
  assert.deepEqual(body.reference.sheets[0].rows[1].cells, { A: 'Navigation', B: 'Intent' })
})

test('POST /api/reference/analyze rejects unsupported extension and MIME type', async () => {
  const { status, body } = await postReferenceFile({
    buffer: Buffer.from('not excel'),
    fileName: 'reference.txt',
    mimeType: 'text/plain',
  })

  assert.equal(status, 400)
  assert.equal(body.ok, false)
  assert.equal(body.code, 'reference_file_type_not_allowed')
})

test('POST /api/reference/analyze returns 400 when file is missing', async () => {
  const { status, body } = await withReferenceServer(async (url) => {
    const response = await fetch(url, { method: 'POST', body: new FormData() })
    return { status: response.status, body: await response.json() }
  })

  assert.equal(status, 400)
  assert.equal(body.ok, false)
  assert.equal(body.code, 'reference_file_missing')
})

test('POST /api/reference/analyze rejects files over the configured size limit', async () => {
  const buffer = await createWorkbookBuffer((workbook) => {
    workbook.addWorksheet('Large').getCell('A1').value = 'value'
  })

  const { status, body } = await postReferenceFile({
    buffer,
    fileName: 'large.xlsx',
    mimeType: XLSX_MIME_TYPE,
    routeOptions: { limits: { maxFileBytes: 32 } },
  })

  assert.equal(status, 413)
  assert.equal(body.ok, false)
  assert.equal(body.code, 'reference_file_too_large')
})

test('POST /api/reference/analyze returns parse error for corrupted xlsx without crashing', async () => {
  const { status, body } = await postReferenceFile({
    buffer: Buffer.from('corrupted xlsx bytes'),
    fileName: 'corrupted.xlsx',
    mimeType: XLSX_MIME_TYPE,
  })

  assert.equal(status, 422)
  assert.equal(body.ok, false)
  assert.equal(body.code, 'reference_parse_failed')
})

async function postReferenceFile({ buffer, fileName, mimeType, routeOptions }) {
  return withReferenceServer(async (url) => {
    const formData = new FormData()
    formData.append('referenceFile', new Blob([buffer], { type: mimeType }), fileName)
    const response = await fetch(url, { method: 'POST', body: formData })
    return { status: response.status, body: await response.json() }
  }, routeOptions)
}

async function withReferenceServer(callback, routeOptions = {}) {
  const app = express()
  app.post('/api/reference/analyze', createReferenceFileUploadRoute(routeOptions))
  const server = http.createServer(app)

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  const url = `http://127.0.0.1:${address.port}/api/reference/analyze`

  try {
    return await callback(url)
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error)
        else resolve()
      })
    })
  }
}

async function createWorkbookBuffer(fillWorkbook) {
  const workbook = new ExcelJS.Workbook()
  fillWorkbook(workbook)
  return Buffer.from(await workbook.xlsx.writeBuffer())
}
