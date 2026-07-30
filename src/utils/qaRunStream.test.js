import test from 'node:test'
import assert from 'node:assert/strict'
import { appendNdjsonChunk, requestQaRunStream } from './qaRunStream.js'

test('appendNdjsonChunk parses complete lines and carries partial JSON forward', () => {
  const first = appendNdjsonChunk('', '{"type":"progress","completedUnits":1}\n{"type"')
  const second = appendNdjsonChunk(first.buffer, ':"result","result":{"ok":true}}\n')

  assert.deepEqual(first.events, [{ type: 'progress', completedUnits: 1 }])
  assert.equal(first.buffer, '{"type"')
  assert.deepEqual(second.events, [{ type: 'result', result: { ok: true } }])
  assert.equal(second.buffer, '')
})

test('requestQaRunStream reads progress events and returns final qa result', async () => {
  const progressEvents = []
  const response = createStreamResponse([
    '{"type":"progress","stage":"web_collect","completedUnits":0,"totalUnits":2,"message":"start"}\n{"type":"progress",',
    '"stage":"result_prepare","completedUnits":2,"totalUnits":2,"message":"done"}\n',
    '{"type":"result","result":{"tech":{"status":"success"},"visual":{"status":"skipped"}}}\n',
  ])

  const result = await requestQaRunStream({
    webUrl: 'https://example.com',
    figmaUrl: '',
    scanOptions: { url: false },
    onProgress: (event) => progressEvents.push(event),
    fetchFn: async () => response,
  })

  assert.deepEqual(progressEvents.map((event) => event.stage), ['web_collect', 'result_prepare'])
  assert.equal(result.tech.status, 'success')
  assert.equal(result.shouldSaveCombined, false)
  assert.equal(result.webUrl, 'https://example.com')
})

test('requestQaRunStream marks missing stream support as json-fallback eligible', async () => {
  await assert.rejects(
    requestQaRunStream({
      webUrl: 'https://example.com',
      figmaUrl: '',
      scanOptions: {},
      fetchFn: async () => ({ ok: true, body: null }),
    }),
    (error) => error.fallbackToJson === true,
  )
})

function createStreamResponse(chunks) {
  const encoder = new TextEncoder()
  return {
    ok: true,
    body: new ReadableStream({
      start(controller) {
        chunks.forEach((chunk) => controller.enqueue(encoder.encode(chunk)))
        controller.close()
      },
    }),
  }
}
