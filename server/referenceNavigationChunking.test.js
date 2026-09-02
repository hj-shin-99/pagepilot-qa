import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createReferenceNavigationService } from './referenceNavigationService.js'

test('small manifest is normalized in one chunk with candidateId roundtrip', async () => {
  const client = createEchoClient()
  const service = createService(client, { maxCandidatesPerChunk: 10 })

  const result = await service.normalize(createReferenceWithRows(3))

  assert.equal(result.meta.chunking.chunkCount, 1)
  assert.equal(result.meta.chunking.successfulChunkCount, 1)
  assert.equal(result.meta.chunking.apiCallCount, 1)
  assert.deepEqual(result.referenceMap.items.filter((item) => !item.isUnmappedCandidate).map((item) => item.candidateId), ['cand-0001', 'cand-0002', 'cand-0003'])
})

test('large manifest is split into multiple deterministic chunks preserving boundaries', async () => {
  const client = createEchoClient()
  const service = createService(client, { maxCandidatesPerChunk: 3 })

  const result = await service.normalize(createReferenceWithRows(8))

  assert.equal(result.meta.chunking.chunkCount, 3)
  assert.deepEqual(client.requests.map((request) => request.candidateIds), [
    ['cand-0001', 'cand-0002', 'cand-0003'],
    ['cand-0004', 'cand-0005', 'cand-0006'],
    ['cand-0007', 'cand-0008'],
  ])
})

test('chunk merge restores manifest order when chunk responses are reversed', async () => {
  const client = createEchoClient({ reverseItems: true })
  const service = createService(client, { maxCandidatesPerChunk: 2 })

  const result = await service.normalize(createReferenceWithRows(5))

  assert.deepEqual(result.referenceMap.items.filter((item) => !item.isUnmappedCandidate).map((item) => item.candidateId), ['cand-0001', 'cand-0002', 'cand-0003', 'cand-0004', 'cand-0005'])
  assert.deepEqual(result.referenceMap.items.map((item) => item.referenceId), ['ref-001', 'ref-002', 'ref-003', 'ref-004', 'ref-005'])
})

test('invented candidateId is dropped and the real candidate remains unmapped', async () => {
  const client = createStaticClient(() => ({ items: [aiItem({ candidateId: 'invented-candidate', rowNumber: 2, raw: '/page-1' })] }))
  const service = createService(client)

  const result = await service.normalize(createReferenceWithRows(1))

  assert.equal(result.meta.outputItemCount, 0)
  assert.equal(result.referenceMap.items[0].isUnmappedCandidate, true)
  assert.equal(result.meta.warnings.includes('dropped_item_invalid_candidate_id'), true)
})

test('non-grounded URL is dropped by post-validation', async () => {
  const client = createStaticClient(() => ({ items: [aiItem({ candidateId: 'cand-0001', rowNumber: 2, raw: '/invented' })] }))
  const service = createService(client)

  const result = await service.normalize(createReferenceWithRows(1))

  assert.equal(result.meta.outputItemCount, 0)
  assert.equal(result.referenceMap.items[0].isUnmappedCandidate, true)
  assert.equal(result.referenceMap.items[0].expected.urls[0].raw, '/page-1')
  assert.equal(result.meta.warnings.includes('dropped_url_without_input_evidence'), true)
})

test('all chunks success merge mapped items without merging duplicate rows', async () => {
  const client = createEchoClient()
  const service = createService(client, { maxCandidatesPerChunk: 2 })

  const result = await service.normalize(createReferenceWithRows(6, { duplicateRaw: '/shared' }))

  assert.equal(result.meta.outputItemCount, 6)
  assert.equal(result.meta.coverage.mappedCandidateRows, 6)
  assert.equal(result.meta.coverage.unmappedCandidateRows, 0)
  assert.deepEqual(result.referenceMap.items.map((item) => `${item.source.sheetName}:${item.source.rowNumber}`), ['Navigation:2', 'Navigation:3', 'Navigation:4', 'Navigation:5', 'Navigation:6', 'Navigation:7'])
})

test('one chunk failure keeps partial success and failed chunk candidates unmapped', async () => {
  const client = createEchoClient({ failChunkIds: new Set(['chunk-002']) })
  const service = createService(client, { maxCandidatesPerChunk: 2 })

  const result = await service.normalize(createReferenceWithRows(5))

  assert.equal(result.meta.chunking.chunkCount, 3)
  assert.equal(result.meta.chunking.successfulChunkCount, 2)
  assert.equal(result.meta.chunking.failedChunkCount, 1)
  assert.deepEqual(result.meta.failedChunks[0].candidateIds, ['cand-0003', 'cand-0004'])
  assert.equal(result.meta.coverage.mappedCandidateRows, 3)
  assert.equal(result.meta.coverage.unmappedCandidateRows, 2)
  assert.deepEqual(result.referenceMap.items.filter((item) => item.isUnmappedCandidate).map((item) => item.candidateId), ['cand-0003', 'cand-0004'])
})

test('finish_reason length splits the chunk and merges successful split retry results', async () => {
  const client = createEchoClient({ lengthOnceForChunkIds: new Set(['chunk-001']) })
  const service = createService(client, { maxCandidatesPerChunk: 8, minCandidatesPerChunk: 2, maxChunkSplitDepth: 2, maxApiCalls: 6 })

  const result = await service.normalize(createReferenceWithRows(6))

  assert.equal(result.meta.chunking.chunkCount, 1)
  assert.equal(result.meta.chunking.successfulChunkCount, 1)
  assert.equal(result.meta.chunking.failedChunkCount, 0)
  assert.equal(result.meta.chunking.splitRetryCount, 1)
  assert.equal(result.meta.chunking.apiCallCount, 3)
  assert.equal(result.meta.coverage.mappedCandidateRows, 6)
  assert.deepEqual(client.requests.map((request) => request.chunkId), ['chunk-001', 'chunk-001-a', 'chunk-001-b'])
})

test('length split obeys max API call guard and preserves candidates as unmapped', async () => {
  const client = createEchoClient({ lengthOnceForChunkIds: new Set(['chunk-001']) })
  const service = createService(client, { maxCandidatesPerChunk: 8, minCandidatesPerChunk: 2, maxChunkSplitDepth: 2, maxApiCalls: 1 })

  const result = await service.normalize(createReferenceWithRows(6))

  assert.equal(result.meta.chunking.apiCallCount, 1)
  assert.equal(result.meta.chunking.failedChunkCount, 1)
  assert.equal(result.meta.coverage.mappedCandidateRows, 0)
  assert.equal(result.meta.coverage.unmappedCandidateRows, 6)
  assert.equal(result.meta.failedChunks[0].code, 'reference_chunk_length_limit')
})

test('all chunks fail returns safe zero-mapped review state instead of throwing', async () => {
  const client = createEchoClient({ failAll: true })
  const service = createService(client, { maxCandidatesPerChunk: 2 })

  const result = await service.normalize(createReferenceWithRows(4))

  assert.equal(result.meta.outputItemCount, 0)
  assert.equal(result.meta.chunking.successfulChunkCount, 0)
  assert.equal(result.meta.chunking.failedChunkCount, 2)
  assert.equal(result.meta.warnings.includes('all_reference_chunks_failed'), true)
  assert.equal(result.meta.failedChunks.every((chunk) => chunk.diagnostics.category === 'unknown_openai_error'), true)
  assert.equal(result.referenceMap.items.every((item) => item.isUnmappedCandidate === true), true)
})

test('duplicate URL across different sheets remains distinct after chunking', async () => {
  const client = createEchoClient()
  const service = createService(client, { maxCandidatesPerChunk: 1 })
  const result = await service.normalize({
    fileName: 'reference.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    size: 1024,
    sheetCount: 2,
    workbookSheetCount: 2,
    totalRowCount: 2,
    sheets: [
      createSheet({ sheetName: 'Navigation A', rows: [{ rowNumber: 2, cells: { A: 'Shared A', B: '/shared' } }] }),
      createSheet({ sheetName: 'Navigation B', rows: [{ rowNumber: 2, cells: { A: 'Shared B', B: '/shared' } }] }),
    ],
  })

  assert.deepEqual(result.referenceMap.items.map((item) => `${item.source.sheetName}:${item.source.rowNumber}:${item.expected.urls[0].raw}`), ['Navigation A:2:/shared', 'Navigation B:2:/shared'])
  assert.equal(result.referenceMap.items.every((item) => item.duplicateCandidate === true), true)
})

test('chunk processing is sequential and does not use unlimited concurrency', async () => {
  let activeCalls = 0
  let maxActiveCalls = 0
  const client = createEchoClient({
    async beforeResponse() {
      activeCalls += 1
      maxActiveCalls = Math.max(maxActiveCalls, activeCalls)
      await new Promise((resolve) => setTimeout(resolve, 5))
      activeCalls -= 1
    },
  })
  const service = createService(client, { maxCandidatesPerChunk: 1 })

  await service.normalize(createReferenceWithRows(4))

  assert.equal(maxActiveCalls <= 2, true)
})

test('chunking production source has no customer or site hardcoding and no QA run coupling', () => {
  const sources = [
    './referenceNavigationService.js',
    './prompts/referenceNavigationPrompt.js',
  ].map((file) => fs.readFileSync(new URL(file, import.meta.url), 'utf8')).join('\n')

  assert.equal(/BMW|BMWFS|TOBE-IA|URL=F|F열|specific customer|qaRunStream|createQaRunStreamHandler|visualVisionPrompt|history/i.test(sources), false)
})

function createService(client, limits = {}) {
  return createReferenceNavigationService({ apiKey: 'test-key', client, now: fixedNow, limits })
}

function createEchoClient(options = {}) {
  const seenLengthChunks = new Set()
  const client = createStaticClient(async (payload) => {
    if (typeof options.beforeResponse === 'function') await options.beforeResponse(payload)
    if (options.failAll || options.failChunkIds?.has(payload.chunkId)) throw new Error(`Chunk failed: ${payload.chunkId}`)
    if (options.lengthOnceForChunkIds?.has(payload.chunkId) && !seenLengthChunks.has(payload.chunkId)) {
      seenLengthChunks.add(payload.chunkId)
      return { choices: [{ finish_reason: 'length', message: { content: '' } }] }
    }

    const rows = payload.sheets.flatMap((sheet) => sheet.rows.map((row) => ({ ...row, sheetName: sheet.sheetName })))
    const orderedRows = options.reverseItems ? [...rows].reverse() : rows
    return { items: orderedRows.map((row) => aiItem({ candidateId: row.candidateId, sheetName: row.sheetName, rowNumber: row.rowNumber, raw: row.detectedUrls[0]?.raw || '/missing' })) }
  })
  return client
}

function createStaticClient(handler) {
  const requests = []
  return {
    requests,
    chat: {
      completions: {
        async create(request) {
          assert.equal(request.response_format.type, 'json_object')
          assert.equal(request.max_completion_tokens, 6000)
          const payload = parsePromptPayload(request)
          requests.push({ chunkId: payload.chunkId, candidateIds: payload.sheets.flatMap((sheet) => sheet.rows.map((row) => row.candidateId)) })
          const result = await handler(payload)
          if (result?.choices) return result
          return { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(result) } }] }
        },
      },
    },
  }
}

function parsePromptPayload(request) {
  return JSON.parse(request.messages[1].content.split('\n').at(-1))
}

function aiItem({ candidateId, sheetName = 'Navigation', rowNumber, raw }) {
  return {
    source: { candidateId, sheetName, rowNumber, evidenceText: `Label ${rowNumber} ${raw}` },
    pageContext: { depthPath: ['Main'], sectionHint: '', pageUrlHint: '' },
    element: { label: `Label ${rowNumber}`, aliases: [], roleHint: 'link', actionHint: 'navigation' },
    expected: {
      type: 'url',
      urls: [{ raw, matchMode: 'path-and-query', allowSameOrigin: true, allowRedirect: false, allowTrailingSlashVariant: true, dynamicParameters: [] }],
      urlPatterns: [],
      notes: '',
    },
    provenance: { urlSource: 'primary-navigation-column', labelSource: 'document-cell', inferenceUsed: false, aiRationale: 'Documented row values.' },
    confidence: 0.9,
  }
}

function createReferenceWithRows(count, options = {}) {
  const rows = Array.from({ length: count }, (_, index) => {
    const rowNumber = index + 2
    const raw = options.duplicateRaw || `/page-${index + 1}`
    return { rowNumber, cells: { A: `Label ${index + 1}`, B: raw } }
  })
  return {
    fileName: 'reference.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    size: 1024,
    sheetCount: 1,
    workbookSheetCount: 1,
    totalRowCount: rows.length,
    sheets: [createSheet({ sheetName: 'Navigation', rows })],
  }
}

function createSheet({ sheetName, rows }) {
  return {
    sheetName,
    rowCount: rows.length,
    usedRange: { startRow: rows[0].rowNumber, endRow: rows.at(-1).rowNumber },
    headerCandidates: [{ rowNumber: 1, cells: { A: 'Label', B: 'Target URL' } }],
    rows,
    rowsTruncated: false,
  }
}

function fixedNow() {
  return '2026-08-25T00:00:00.000Z'
}
