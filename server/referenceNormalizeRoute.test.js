import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import fs from 'node:fs'
import express from 'express'
import { createReferenceNormalizeRoute } from './referenceNormalizeRoute.js'

test('POST /api/reference/normalize returns normalized reference map from service', async () => {
  const expected = {
    referenceMap: { schemaVersion: 'navigation-intent-reference-v1', sourceDocument: { fileName: 'reference.xlsx', mimeType: 'xlsx', analyzedAt: '2026-08-21T00:00:00.000Z' }, items: [] },
    meta: { model: 'test-model', openAiCalled: true, inputItemCount: 1, outputItemCount: 0, warnings: [] },
  }
  const response = await postNormalize({ reference: { sheets: [] } }, { service: { async normalize() { return expected } } })

  assert.equal(response.status, 200)
  assert.deepEqual(response.body, { ok: true, ...expected })
})

test('POST /api/reference/normalize rejects invalid body with 400', async () => {
  const response = await postNormalize({ reference: null }, { service: { async normalize() { throw new Error('must not call service') } } })

  assert.equal(response.status, 400)
  assert.equal(response.body.ok, false)
  assert.equal(response.body.code, 'invalid_reference_input')
})

test('POST /api/reference/normalize maps service failures without raw prompt exposure', async () => {
  const error = new Error('OPENAI_API_KEY가 설정되지 않았습니다.')
  error.code = 'missing_api_key'
  error.status = 400
  const response = await postNormalize({ reference: { sheets: [] } }, { service: { async normalize() { throw error } } })

  assert.equal(response.status, 400)
  assert.deepEqual(response.body, { ok: false, code: 'missing_api_key', message: 'OPENAI_API_KEY가 설정되지 않았습니다.' })
  assert.equal(JSON.stringify(response.body).includes('prompt'), false)
})

test('POST /api/reference/normalize exposes only safe diagnostics for empty OpenAI content', async () => {
  const error = new Error('AI 응답 생성이 완료되지 않았습니다. (finish_reason: length)')
  error.code = 'empty_ai_response'
  error.status = 502
  error.diagnostics = {
    model: 'test-model',
    finishReason: 'length',
    contentLength: 0,
    contentType: 'string',
    promptTokens: 100,
    completionTokens: 6000,
    totalTokens: 6100,
  }
  const response = await postNormalize({ reference: { sheets: [] } }, { service: { async normalize() { throw error } } })

  assert.equal(response.status, 502)
  assert.equal(response.body.ok, false)
  assert.equal(response.body.code, 'empty_ai_response')
  assert.deepEqual(response.body.diagnostics, error.diagnostics)
  assert.equal(JSON.stringify(response.body).includes('promptText'), false)
  assert.equal(JSON.stringify(response.body).includes('messages'), false)
  assert.equal(JSON.stringify(response.body).includes('OPENAI_API_KEY'), false)
})

test('POST /api/reference/normalize exposes safe OpenAI failure category diagnostics only', async () => {
  const error = new Error('OpenAI service unavailable')
  error.code = 'openai_reference_failed'
  error.status = 502
  error.diagnostics = { category: 'server_error', status: 503, errorCode: 'server_error' }
  error.rawPrompt = 'do not expose prompt'
  error.apiKey = 'sk-do-not-expose'
  error.rawResponse = 'do not expose response'
  const response = await postNormalize({ reference: { sheets: [] } }, { service: { async normalize() { throw error } } })

  assert.equal(response.status, 502)
  assert.equal(response.body.code, 'openai_reference_failed')
  assert.deepEqual(response.body.diagnostics, { category: 'server_error', status: 503, errorCode: 'server_error' })
  assert.equal(/rawPrompt|apiKey|rawResponse|sk-do-not-expose|do not expose/i.test(JSON.stringify(response.body)), false)
})

test('index keeps existing QA run endpoints while adding reference normalize route', () => {
  const source = fsReadIndex()

  assert.equal(source.includes("app.post('/api/reference/normalize', referenceNormalizeHandler)"), true)
  assert.equal(source.includes("app.post('/api/qa/run', qaRunHandler)"), true)
  assert.equal(source.includes("app.post('/api/qa/run-stream', qaRunStreamHandler)"), true)
})

async function postNormalize(body, routeOptions) {
  return withReferenceNormalizeServer(async (url) => {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    return { status: response.status, body: await response.json() }
  }, routeOptions)
}

async function withReferenceNormalizeServer(callback, routeOptions = {}) {
  const app = express()
  app.use(express.json({ limit: '1mb' }))
  app.post('/api/reference/normalize', createReferenceNormalizeRoute(routeOptions))
  const server = http.createServer(app)

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  const url = `http://127.0.0.1:${address.port}/api/reference/normalize`

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

function fsReadIndex() {
  return fs.readFileSync(new URL('./index.js', import.meta.url), 'utf8')
}
