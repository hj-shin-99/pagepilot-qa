import test from 'node:test'
import assert from 'node:assert/strict'
import { createReferenceNormalizationCache, createReferenceNormalizationCacheKey } from './referenceNormalizationCache.js'

test('reference normalization cache key is deterministic for equivalent compact input', () => {
  const left = createReferenceNormalizationCacheKey({
    model: 'gpt-test',
    maxCompletionTokens: 6000,
    compactInput: {
      chunks: [{
        chunkId: 'chunk-001',
        candidateIds: ['cand-0001'],
        aiInput: { schemaVersion: 'v1', sheets: [{ rows: [{ cells: { B: '/target', A: 'Target' }, rowNumber: 2 }] }] },
      }],
    },
  })
  const right = createReferenceNormalizationCacheKey({
    maxCompletionTokens: 6000,
    model: 'gpt-test',
    compactInput: {
      chunks: [{
        candidateIds: ['cand-0001'],
        aiInput: { sheets: [{ rows: [{ rowNumber: 2, cells: { A: 'Target', B: '/target' } }] }], schemaVersion: 'v1' },
        chunkId: 'chunk-001',
      }],
    },
  })

  assert.equal(left, right)
  assert.match(left, /^reference-normalization-cache-v1:[a-f0-9]{64}$/)
})

test('reference normalization cache key changes with model and content', () => {
  const base = {
    compactInput: {
      chunks: [{ chunkId: 'chunk-001', candidateIds: ['cand-0001'], aiInput: { sheets: [{ rows: [{ rowNumber: 2, cells: { A: 'Target', B: '/target' } }] }] } }],
    },
    maxCompletionTokens: 6000,
  }

  assert.notEqual(
    createReferenceNormalizationCacheKey({ ...base, model: 'model-a' }),
    createReferenceNormalizationCacheKey({ ...base, model: 'model-b' }),
  )
  assert.notEqual(
    createReferenceNormalizationCacheKey({ ...base, model: 'model-a' }),
    createReferenceNormalizationCacheKey({ ...base, model: 'model-a', compactInput: { chunks: [{ chunkId: 'chunk-001', candidateIds: ['cand-0001'], aiInput: { sheets: [{ rows: [{ rowNumber: 2, cells: { A: 'Target', B: '/other' } }] }] } }] } }),
  )
})

test('reference normalization memory cache clones values and evicts least recent entries', async () => {
  const cache = createReferenceNormalizationCache({ maxEntries: 1 })
  const value = { items: [{ candidateId: 'cand-0001', expected: { urls: [{ raw: '/target' }] } }], warnings: [], failedChunks: [] }

  await cache.set('first', value)
  value.items[0].expected.urls[0].raw = '/mutated'

  const cached = await cache.get('first')
  cached.items[0].expected.urls[0].raw = '/changed-after-read'

  assert.equal((await cache.get('first')).items[0].expected.urls[0].raw, '/target')

  await cache.set('second', { items: [], warnings: [], failedChunks: [] })
  assert.equal(await cache.get('first'), null)
  assert.deepEqual(await cache.get('second'), { items: [], warnings: [], failedChunks: [] })
})
