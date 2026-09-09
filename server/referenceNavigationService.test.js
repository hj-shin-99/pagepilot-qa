import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createReferenceNavigationService } from './referenceNavigationService.js'
import { createReferenceNormalizationCache } from './referenceNormalizationCache.js'
import { getReferenceQaModel } from './referenceModelConfig.js'

test('valid compact facts become a valid reference map', async () => {
  const service = createServiceWithItems([
    aiItem({ label: 'Pricing', raw: '/pricing' }),
  ])

  const result = await service.normalize(createAiRequiredReference({ cells: { A: 'Pricing', B: '/pricing', C: 'alternate may be /pricing-legacy' } }))

  assert.equal(result.referenceMap.schemaVersion, 'navigation-intent-reference-v1')
  assert.equal(result.referenceMap.sourceDocument.fileName, 'reference.xlsx')
  assert.equal(result.referenceMap.sourceDocument.analyzedAt, '2026-08-21T00:00:00.000Z')
  assert.equal(result.referenceMap.items.length, 1)
  assert.equal(result.referenceMap.items[0].referenceId, 'ref-001')
  assert.equal(result.meta.openAiCalled, true)
  assert.equal(result.meta.outputItemCount, 1)
})

test('reference normalization cache hit avoids OpenAI and exposes safe usage telemetry', async () => {
  let calls = 0
  const cache = createReferenceNormalizationCache()
  const client = {
    chat: {
      completions: {
        async create() {
          calls += 1
          return {
            choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ items: [aiItem({ label: 'Pricing', raw: '/pricing' })] }) } }],
            usage: { prompt_tokens: 120, completion_tokens: 40, total_tokens: 160 },
          }
        },
      },
    },
  }
  const reference = createAiRequiredReference({ cells: { A: 'Pricing', B: '/pricing', C: 'alternate may be /pricing-legacy' } })
  const warmService = createReferenceNavigationService({ apiKey: 'test-key', client, now: fixedNow, normalizationCache: cache })
  const cachedService = createReferenceNavigationService({ apiKey: '', now: fixedNow, normalizationCache: cache })

  const first = await warmService.normalize(reference)
  const second = await cachedService.normalize(reference)

  assert.equal(calls, 1)
  assert.equal(first.meta.openAiCalled, true)
  assert.equal(first.meta.cache.status, 'miss')
  assert.equal(first.meta.cache.hit, false)
  assert.equal(first.meta.cache.read, true)
  assert.equal(first.meta.cache.written, true)
  assert.deepEqual(first.meta.usage, { promptTokens: 120, completionTokens: 40, totalTokens: 160, completionCount: 1 })
  assert.equal(second.meta.openAiCalled, false)
  assert.equal(second.meta.cache.status, 'hit')
  assert.equal(second.meta.cache.hit, true)
  assert.equal(second.meta.cache.read, true)
  assert.equal(second.meta.cache.written, false)
  assert.deepEqual(second.meta.usage, { promptTokens: 0, completionTokens: 0, totalTokens: 0, completionCount: 0 })
  assert.equal(second.meta.chunking.apiCallCount, 0)
  assert.equal(second.referenceMap.items[0].expected.urls[0].raw, '/pricing')
  assert.equal(JSON.stringify(second.meta.cache).includes('/pricing'), false)
})

test('Phase 2-B A deterministic-safe single explicit URL skips OpenAI without API key', async () => {
  const service = createReferenceNavigationService({ apiKey: '', now: fixedNow, normalizationCache: false })

  const result = await service.normalize(createReference({ cells: { A: 'Pricing', B: '/pricing' } }))

  assert.equal(result.meta.openAiCalled, false)
  assert.equal(result.meta.chunking.apiCallCount, 0)
  assert.equal(result.meta.deterministicSafeCandidateCount, 1)
  assert.equal(result.meta.aiRequiredCandidateCount, 0)
  assert.equal(result.referenceMap.items[0].expected.urls[0].raw, '/pricing')
  assert.equal(result.referenceMap.items[0].provenance.inferenceUsed, false)
})

test('Reference hierarchy is inferred from generic numbered depth headers without fixed column positions', async () => {
  const service = createReferenceNavigationService({ apiKey: '', now: fixedNow, normalizationCache: false })
  const reference = createReference({
    sheets: [createSheet({
      sheetName: 'Generic Navigation',
      headerCandidates: [{ rowNumber: 1, cells: { A: '3 Depth', B: 'Target URL', C: '1 Depth', D: '5 Depth', E: 'Label' } }],
      rows: [{ rowNumber: 2, cells: { A: 'Calculator', B: { text: 'Open calculator', hyperlink: '/tools/calc' }, C: 'Products', D: 'Eligibility', E: 'CTA' } }],
    })],
  })

  const result = await service.normalize(reference)

  assert.equal(result.meta.openAiCalled, false)
  assert.deepEqual(result.referenceMap.items[0].pageContext.depthPath, ['Products', '', 'Calculator', '', 'Eligibility'])
  assert.equal(result.referenceMap.items[0].expected.urls[0].raw, '/tools/calc')
})

test('Reference hierarchy supports two-depth documents and does not treat Page or URL-like values as depth', async () => {
  const client = createPromptRecordingClient(() => ({ items: [{ ...aiItem({ rowNumber: 3, raw: '/details' }), pageContext: { depthPath: [], sectionHint: '', pageUrlHint: '' } }] }))
  const service = createReferenceNavigationService({ apiKey: 'test-key', client, now: fixedNow, normalizationCache: false })
  const reference = createReference({
    sheets: [createSheet({
      sheetName: 'Mixed',
      headerCandidates: [{ rowNumber: 1, cells: { A: 'Depth 1', B: 'Page', C: 'Depth 2', D: 'Target URL' } }],
      rows: [
        { rowNumber: 2, cells: { A: 'Shop', B: 'Overview', C: 'Offers', D: '/offers' } },
        { rowNumber: 3, cells: { A: '/not/a/hierarchy', B: 'Details', C: '', D: '/details' } },
      ],
    })],
  })

  const result = await service.normalize(reference)

  assert.deepEqual(client.requests.map((request) => request.candidateIds), [['cand-0002']])
  assert.deepEqual(result.referenceMap.items.map((item) => item.pageContext.depthPath), [['Shop', 'Offers'], []])
  assert.equal(result.referenceMap.items[0].expected.urls[0].raw, '/offers')
})

test('Phase 2-B B all deterministic-safe rows keep usage and submitted count at zero', async () => {
  const service = createReferenceNavigationService({ apiKey: '', now: fixedNow, normalizationCache: false })
  const reference = createReference({
    rows: [
      { rowNumber: 2, cells: { A: 'One', B: '/one' } },
      { rowNumber: 3, cells: { A: 'Two', B: { text: 'Two', hyperlink: '/two' } } },
    ],
  })

  const result = await service.normalize(reference)

  assert.equal(result.meta.openAiCalled, false)
  assert.deepEqual(result.meta.usage, { promptTokens: 0, completionTokens: 0, totalTokens: 0, completionCount: 0 })
  assert.equal(result.meta.deterministicSafeCandidateCount, 2)
  assert.equal(result.meta.aiSubmittedCandidateCount, 0)
  assert.deepEqual(result.referenceMap.items.map((item) => item.expected.urls[0].raw), ['/one', '/two'])
})

test('Phase 2-B C mixed input submits only AI-required candidates', async () => {
  const client = createPromptRecordingClient(() => ({ items: [aiItem({ rowNumber: 3, raw: '/search' })] }))
  const service = createReferenceNavigationService({ apiKey: 'test-key', client, now: fixedNow, normalizationCache: false })
  const reference = createReference({
    rows: [
      { rowNumber: 2, cells: { A: 'Pricing', B: '/pricing' } },
      { rowNumber: 3, cells: { A: 'Search', B: '/search', C: 'alternate may be /search-old' } },
    ],
  })

  const result = await service.normalize(reference)

  assert.deepEqual(client.requests.map((request) => request.candidateIds), [['cand-0002']])
  assert.equal(result.meta.deterministicSafeCandidateCount, 1)
  assert.equal(result.meta.aiRequiredCandidateCount, 1)
  assert.equal(result.meta.aiSubmittedCandidateCount, 1)
  assert.equal(result.meta.openAiCalled, true)
})

test('Phase 2-B D mixed deterministic and AI items preserve manifest order', async () => {
  const client = createPromptRecordingClient(() => ({ items: [aiItem({ rowNumber: 3, raw: '/middle' })] }))
  const service = createReferenceNavigationService({ apiKey: 'test-key', client, now: fixedNow, normalizationCache: false })
  const reference = createReference({
    rows: [
      { rowNumber: 2, cells: { A: 'First', B: '/first' } },
      { rowNumber: 3, cells: { A: 'Middle', B: '/middle', C: 'alternate may be /middle-old' } },
      { rowNumber: 4, cells: { A: 'Last', B: '/last' } },
    ],
  })

  const result = await service.normalize(reference)

  assert.deepEqual(result.referenceMap.items.map((item) => item.candidateId), ['cand-0001', 'cand-0002', 'cand-0003'])
  assert.deepEqual(result.referenceMap.items.map((item) => item.referenceId), ['ref-001', 'ref-002', 'ref-003'])
})

test('Phase 2-B E same-cell URL list is deterministic-safe when classifier resolves it', async () => {
  const service = createReferenceNavigationService({ apiKey: '', now: fixedNow, normalizationCache: false })

  const result = await service.normalize(createReference({ cells: { A: 'Targets', B: '/a, /b' } }))

  assert.equal(result.meta.openAiCalled, false)
  assert.equal(result.meta.deterministicSafeCandidateCount, 1)
  assert.deepEqual(result.referenceMap.items[0].expected.urls.map((url) => url.raw), ['/a', '/b'])
  assert.deepEqual(result.referenceMap.items[0].urlEvidence.map((url) => url.classification), ['primary-navigation', 'additional-navigation'])
})

test('Phase 2-B F separate-column multi-URL row remains AI-required', async () => {
  const client = createPromptRecordingClient(() => ({ items: [aiItem({ raw: '/cars' })] }))
  const service = createReferenceNavigationService({ apiKey: 'test-key', client, now: fixedNow, normalizationCache: false })

  const result = await service.normalize(createReference({ cells: { A: 'Catalog', B: '/cars', C: '/vans' } }))

  assert.deepEqual(client.requests.map((request) => request.candidateIds), [['cand-0001']])
  assert.equal(result.meta.deterministicSafeCandidateCount, 0)
  assert.equal(result.meta.aiRequiredCandidateCount, 1)
})

test('Phase 2-B G descriptive API prose is not deterministic-safe', async () => {
  const client = createPromptRecordingClient(() => ({ items: [] }))
  const service = createReferenceNavigationService({ apiKey: 'test-key', client, now: fixedNow, normalizationCache: false })

  const result = await service.normalize(createReference({ cells: { A: 'System', B: 'API writes /internal/result after processing' } }))

  assert.equal(result.meta.deterministicSafeCandidateCount, 0)
  assert.equal(result.meta.aiRequiredCandidateCount, 1)
  assert.equal(result.referenceMap.items[0].urlEvidence[0].classification, 'descriptive-only')
})

test('Phase 2-B H incomplete query template requires AI instead of deterministic mapping', async () => {
  const service = createReferenceNavigationService({ apiKey: '', now: fixedNow, normalizationCache: false })

  await assert.rejects(() => service.normalize(createReference({ cells: { A: 'Details', B: '/details?idx=' } })), { code: 'missing_api_key' })
})

test('Phase 2-B I deterministic cache miss keeps current request token usage zero', async () => {
  const cache = createReferenceNormalizationCache()
  const service = createReferenceNavigationService({ apiKey: '', now: fixedNow, normalizationCache: cache })

  const result = await service.normalize(createReference({ cells: { A: 'Pricing', B: '/pricing' } }))

  assert.equal(result.meta.cache.status, 'miss')
  assert.equal(result.meta.cache.read, true)
  assert.equal(result.meta.openAiCalled, false)
  assert.deepEqual(result.meta.usage, { promptTokens: 0, completionTokens: 0, totalTokens: 0, completionCount: 0 })
})

test('Phase 2-B J mixed cache hit avoids OpenAI and preserves triage counts', async () => {
  let calls = 0
  const cache = createReferenceNormalizationCache()
  const client = createPromptRecordingClient(() => {
    calls += 1
    return { items: [aiItem({ rowNumber: 3, raw: '/search' })] }
  })
  const reference = createReference({
    rows: [
      { rowNumber: 2, cells: { A: 'Pricing', B: '/pricing' } },
      { rowNumber: 3, cells: { A: 'Search', B: '/search', C: 'alternate may be /search-old' } },
    ],
  })

  await createReferenceNavigationService({ apiKey: 'test-key', client, now: fixedNow, normalizationCache: cache }).normalize(reference)
  const cached = await createReferenceNavigationService({ apiKey: '', now: fixedNow, normalizationCache: cache }).normalize(reference)

  assert.equal(calls, 1)
  assert.equal(cached.meta.cache.status, 'hit')
  assert.equal(cached.meta.openAiCalled, false)
  assert.equal(cached.meta.chunking.apiCallCount, 0)
  assert.equal(cached.meta.deterministicSafeCandidateCount, 1)
  assert.equal(cached.meta.aiRequiredCandidateCount, 1)
  assert.equal(cached.meta.aiSubmittedCandidateCount, 0)
  assert.deepEqual(cached.meta.usage, { promptTokens: 0, completionTokens: 0, totalTokens: 0, completionCount: 0 })
})

test('Phase 2-B K deterministic-safe rows never use AI invented replacements', async () => {
  const client = createThrowingClient(new Error('should not call OpenAI'))
  const service = createReferenceNavigationService({ apiKey: 'test-key', client, now: fixedNow, normalizationCache: false })

  const result = await service.normalize(createReference({ cells: { A: 'Canonical', B: '/canonical' } }))

  assert.equal(result.meta.openAiCalled, false)
  assert.equal(result.referenceMap.items[0].expected.urls[0].raw, '/canonical')
})

test('Phase 2-B L documented dynamic path template can be deterministic-safe', async () => {
  const service = createReferenceNavigationService({ apiKey: '', now: fixedNow, normalizationCache: false })

  const result = await service.normalize(createReference({ cells: { A: 'Product detail template', B: '/products/{productId}' } }))

  assert.equal(result.meta.openAiCalled, false)
  assert.equal(result.referenceMap.items[0].expected.urls[0].raw, '/products/{productId}')
  assert.equal(result.referenceMap.items[0].expected.urls[0].matchMode, 'pattern')
  assert.deepEqual(result.referenceMap.items[0].expected.urls[0].dynamicParameters, ['productId'])
})

test('Phase 2-B M repeated same-cell duplicate URL is conservative AI-required', async () => {
  const service = createReferenceNavigationService({ apiKey: '', now: fixedNow, normalizationCache: false })

  await assert.rejects(() => service.normalize(createReference({ cells: { A: 'Duplicate', B: '/a /a' } })), { code: 'missing_api_key' })
})

test('Phase 2-B N deterministic telemetry is additive and does not expose triage internals', async () => {
  const service = createReferenceNavigationService({ apiKey: '', now: fixedNow, normalizationCache: false })

  const result = await service.normalize(createReference({ cells: { A: 'Pricing', B: '/pricing' } }))

  assert.equal(Object.hasOwn(result.meta, 'deterministicSafeCandidateCount'), true)
  assert.equal(Object.hasOwn(result.meta, 'aiRequiredCandidateCount'), true)
  assert.equal(Object.hasOwn(result.meta, 'aiSubmittedCandidateCount'), true)
  assert.equal(Object.hasOwn(result.meta, 'deterministicTriage'), false)
})

test('Phase 2-B O AI failure preserves deterministic-safe rows and unmapped AI rows', async () => {
  const service = createReferenceNavigationService({
    apiKey: 'test-key',
    client: createThrowingClient(new Error('synthetic provider failure')),
    now: fixedNow,
    normalizationCache: false,
  })
  const reference = createReference({
    rows: [
      { rowNumber: 2, cells: { A: 'Stable', B: '/stable' } },
      { rowNumber: 3, cells: { A: 'Review', B: '/review', C: 'alternate may be /review-old' } },
    ],
  })

  const result = await service.normalize(reference)

  assert.equal(result.referenceMap.items[0].candidateId, 'cand-0001')
  assert.equal(result.referenceMap.items[0].isUnmappedCandidate, undefined)
  assert.equal(result.referenceMap.items[0].expected.urls[0].raw, '/stable')
  assert.equal(result.referenceMap.items[1].candidateId, 'cand-0002')
  assert.equal(result.referenceMap.items[1].isUnmappedCandidate, true)
  assert.equal(result.meta.coverage.mappedCandidateRows, 1)
  assert.equal(result.meta.coverage.unmappedCandidateRows, 1)
})

test('preserves explicit absolute URL evidence', async () => {
  const raw = 'https://www.example.test/products?type=lease#hero'
  const service = createServiceWithItems([aiItem({ raw })])

  const result = await service.normalize(createReference({ cells: { A: 'Products', B: raw } }))
  const url = result.referenceMap.items[0].expected.urls[0]

  assert.equal(url.raw, raw)
  assert.equal(url.normalizedPath, '/products')
  assert.deepEqual(url.query, { type: 'lease' })
  assert.equal(url.hash, 'hero')
  assert.equal(url.provenance.urlSource, 'explicit-absolute-url')
})

test('preserves relative URL evidence', async () => {
  const service = createServiceWithItems([aiItem({ raw: '/support/contact' })])

  const result = await service.normalize(createReference({ cells: { A: 'Contact', B: '/support/contact' } }))

  assert.equal(result.referenceMap.items[0].expected.urls[0].raw, '/support/contact')
  assert.equal(result.referenceMap.items[0].expected.urls[0].normalizedPath, '/support/contact')
})

test('preserves hyperlink cell URL evidence', async () => {
  const raw = 'https://www.example.test/help'
  const service = createServiceWithItems([aiItem({ raw })])

  const result = await service.normalize(createReference({ cells: { A: 'Help', B: { text: 'Open help', hyperlink: raw } } }))
  const url = result.referenceMap.items[0].expected.urls[0]

  assert.equal(url.raw, raw)
  assert.equal(url.provenance.urlSource, 'hyperlink-cell')
  assert.equal(url.provenance.sourceColumn, 'B')
})

test('preserves query and hash for relative URL evidence', async () => {
  const raw = '/search?q=plan&sort=latest#results'
  const service = createServiceWithItems([aiItem({ raw })])

  const result = await service.normalize(createReference({ cells: { A: 'Search', B: raw } }))
  const url = result.referenceMap.items[0].expected.urls[0]

  assert.equal(url.raw, raw)
  assert.deepEqual(url.query, { q: 'plan', sort: 'latest' })
  assert.equal(url.hash, 'results')
})

test('allows multiple expected URLs when each URL is grounded in the row', async () => {
  const service = createServiceWithItems([
    aiItem({ urls: ['/catalog/cars', '/catalog/vans'] }),
  ])

  const result = await service.normalize(createReference({ cells: { A: 'Catalog', B: '/catalog/cars', C: '/catalog/vans' } }))

  assert.deepEqual(result.referenceMap.items[0].expected.urls.map((url) => url.raw), ['/catalog/cars', '/catalog/vans'])
})

test('classifies one explicit path as primary navigation evidence', async () => {
  const service = createServiceWithItems([aiItem({ raw: '/primary' })])

  const result = await service.normalize(createReference({ cells: { A: 'Primary', B: '/primary' } }))
  const item = result.referenceMap.items[0]

  assert.equal(item.urlEvidence.length, 1)
  assert.equal(item.urlEvidence[0].classification, 'primary-navigation')
  assert.equal(item.urlEvidence[0].reasonCode, 'explicit-primary-url')
  assert.equal(item.urlEvidence[0].evidenceKind, 'explicit-relative-path')
  assert.equal(item.expected.urls[0].classification, 'primary-navigation')
})

test('adds distinct explicit grounded paths to expected URLs even when AI returns one', async () => {
  const service = createServiceWithItems([aiItem({ raw: '/products/cars' })])

  const result = await service.normalize(createReference({ cells: { A: 'Products', B: '/products/cars', C: '/products/vans' } }))
  const item = result.referenceMap.items[0]

  assert.deepEqual(item.expected.urls.map((url) => url.raw), ['/products/cars', '/products/vans'])
  assert.deepEqual(item.urlEvidence.map((url) => url.classification), ['primary-navigation', 'additional-navigation'])
  assert.equal(item.urlEvidence[1].reasonCode, 'explicit-distinct-url')
})

test('same-cell parenthesized URL list creates primary and additional expected URLs without AI mapping', async () => {
  const service = createServiceWithItems([])

  const result = await service.normalize(createReference({ cells: { A: 'Target', B: '/a (/b)' } }))
  const item = result.referenceMap.items[0]

  assert.equal(item.isUnmappedCandidate, undefined)
  assert.equal(result.meta.openAiCalled, false)
  assert.deepEqual(item.expected.urls.map((url) => url.raw), ['/a', '/b'])
  assert.deepEqual(item.urlEvidence.map((url) => url.classification), ['primary-navigation', 'additional-navigation'])
  assert.equal(item.expected.urls.every((url) => item.urlEvidence.some((evidence) => evidence.raw === url.raw)), true)
})

test('same-cell comma URL list creates primary and additional expected URLs', async () => {
  const service = createServiceWithItems([])

  const result = await service.normalize(createReference({ cells: { A: 'Target', B: '/a, /b' } }))
  const item = result.referenceMap.items[0]

  assert.deepEqual(item.expected.urls.map((url) => url.raw), ['/a', '/b'])
  assert.deepEqual(item.urlEvidence.map((url) => url.classification), ['primary-navigation', 'additional-navigation'])
})

test('same-cell newline URL list creates primary and additional expected URLs', async () => {
  const service = createServiceWithItems([])

  const result = await service.normalize(createReference({ cells: { A: 'Target', B: '/a\n/b' } }))
  const item = result.referenceMap.items[0]

  assert.deepEqual(item.expected.urls.map((url) => url.raw), ['/a', '/b'])
  assert.deepEqual(item.urlEvidence.map((url) => url.classification), ['primary-navigation', 'additional-navigation'])
})

test('API prose URL remains descriptive-only and outside expected URLs', async () => {
  const service = createServiceWithItems([])

  const result = await service.normalize(createReference({ cells: { A: 'System', B: 'API writes /internal/result after processing' } }))
  const item = result.referenceMap.items[0]

  assert.deepEqual(item.expected.urls, [])
  assert.deepEqual(item.urlEvidence.map((url) => url.classification), ['descriptive-only'])
})

test('same-cell URL list excludes incomplete query parameter template', async () => {
  const service = createServiceWithItems([])

  const result = await service.normalize(createReference({ cells: { A: 'Target', B: '/a (/a?idx=)' } }))
  const item = result.referenceMap.items[0]

  assert.deepEqual(item.expected.urls.map((url) => url.raw), ['/a'])
  assert.deepEqual(item.urlEvidence.map((url) => url.classification), ['primary-navigation', 'parameter-template'])
})

test('same-cell URL list allows distinct explicit valid query target as additional navigation', async () => {
  const service = createServiceWithItems([])

  const result = await service.normalize(createReference({ cells: { A: 'Target', B: '/a (/b?x=1)' } }))
  const item = result.referenceMap.items[0]

  assert.deepEqual(item.expected.urls.map((url) => url.raw), ['/a', '/b?x=1'])
  assert.deepEqual(item.urlEvidence.map((url) => url.classification), ['primary-navigation', 'additional-navigation'])
})

test('same raw repeated in the same cell is duplicate evidence', async () => {
  const service = createServiceWithItems([])

  const result = await service.normalize(createReference({ cells: { A: 'Target', B: '/a /a' } }))
  const item = result.referenceMap.items[0]

  assert.deepEqual(item.expected.urls.map((url) => url.raw), ['/a'])
  assert.deepEqual(item.urlEvidence.map((url) => url.classification), ['primary-navigation', 'duplicate-evidence'])
})

test('same target text and hyperlink becomes duplicate evidence, not another expected URL', async () => {
  const raw = 'https://example.test/help'
  const service = createServiceWithItems([aiItem({ raw })])

  const result = await service.normalize(createReference({ cells: { A: 'Help', B: { text: raw, hyperlink: raw } } }))
  const item = result.referenceMap.items[0]

  assert.deepEqual(item.expected.urls.map((url) => url.raw), [raw])
  assert.deepEqual(item.urlEvidence.map((url) => url.classification), ['primary-navigation', 'duplicate-evidence'])
  assert.equal(result.meta.coverage.urlEvidenceCoverage.duplicateEvidenceUrls, 1)
})

test('incomplete query parameter templates are classified and excluded from expected URLs', async () => {
  const service = createServiceWithItems([aiItem({ raw: '/details' })])

  const result = await service.normalize(createReference({ cells: { A: 'Details', B: '/details', C: '/details?idx=' } }))
  const item = result.referenceMap.items[0]

  assert.deepEqual(item.expected.urls.map((url) => url.raw), ['/details'])
  assert.deepEqual(item.urlEvidence.map((url) => url.classification), ['primary-navigation', 'parameter-template'])
  assert.equal(item.urlEvidence[1].reasonCode, 'incomplete-parameter-template')
})

test('complete query state with generic tab context is preserved as navigation state variant', async () => {
  const service = createServiceWithItems([aiItem({ raw: '/guide' })])

  const result = await service.normalize(createReference({ cells: { A: 'Guide tab', B: '/guide', C: '/guide?tab=1' } }))
  const item = result.referenceMap.items[0]

  assert.deepEqual(item.expected.urls.map((url) => url.raw), ['/guide', '/guide?tab=1'])
  assert.deepEqual(item.urlEvidence.map((url) => url.classification), ['primary-navigation', 'navigation-state-variant'])
  assert.equal(item.expected.urls[1].classificationReasonCode, 'explicit-query-state')
})

test('separate labeled candidates with different query states remain distinct primary targets', async () => {
  const service = createServiceWithItems([
    aiItem({ rowNumber: 2, raw: '/guide?tab=1' }),
    aiItem({ rowNumber: 3, raw: '/guide?tab=2' }),
  ])
  const reference = createReference({
    rows: [
      { rowNumber: 2, cells: { A: 'First tab', B: '/guide?tab=1' } },
      { rowNumber: 3, cells: { A: 'Second tab', B: '/guide?tab=2' } },
    ],
  })

  const result = await service.normalize(reference)

  assert.deepEqual(result.referenceMap.items.map((item) => item.expected.urls[0].raw), ['/guide?tab=1', '/guide?tab=2'])
  assert.deepEqual(result.referenceMap.items.map((item) => item.urlEvidence[0].classification), ['primary-navigation', 'primary-navigation'])
  assert.deepEqual(result.referenceMap.items.map((item) => item.duplicateCandidate), [false, false])
})

test('note text and API description URLs stay classified outside expected URLs', async () => {
  const service = createServiceWithItems([aiItem({ raw: '/account' })])

  const result = await service.normalize(createReference({ cells: { A: 'Account', B: '/account', C: 'Note: related page /account/archive', D: 'POST /api/account returns JSON' } }))
  const item = result.referenceMap.items[0]

  assert.deepEqual(item.expected.urls.map((url) => url.raw), ['/account'])
  assert.deepEqual(item.urlEvidence.map((url) => url.classification), ['primary-navigation', 'descriptive-only', 'descriptive-only'])
  assert.equal(result.meta.coverage.urlEvidenceCoverage.descriptiveOnlyUrls, 2)
})

test('ambiguous descriptive second URL is visible as review-needed and excluded from expected URLs', async () => {
  const service = createServiceWithItems([aiItem({ raw: '/start' })])

  const result = await service.normalize(createReference({ cells: { A: 'Start', B: '/start', C: 'alternate may be /fallback' } }))
  const item = result.referenceMap.items[0]

  assert.deepEqual(item.expected.urls.map((url) => url.raw), ['/start'])
  assert.equal(item.urlEvidence.find((url) => url.raw === '/fallback').classification, 'review-needed')
  assert.equal(result.meta.coverage.urlEvidenceCoverage.reviewNeededUrls, 1)
})

test('absolute external and relative internal links preserve query hash identity metadata', async () => {
  const raw = 'https://external.example/path?type=lease#hero'
  const service = createServiceWithItems([aiItem({ raw })])

  const result = await service.normalize(createReference({ cells: { A: 'External', B: raw } }))
  const url = result.referenceMap.items[0].expected.urls[0]

  assert.equal(url.raw, raw)
  assert.equal(url.normalizedIdentity, 'https://external.example/path?type=lease#hero')
  assert.deepEqual(url.query, { type: 'lease' })
  assert.equal(url.hash, 'hero')
})

test('drops AI-concatenated URL and rebuilds expected URLs from exact grounded tokens', async () => {
  const service = createServiceWithItems([aiItem({ raw: '/a/a?type=b' })])

  const result = await service.normalize(createReference({ cells: { A: 'Targets', B: '/a', C: '/a?type=b' } }))
  const item = result.referenceMap.items[0]

  assert.equal(item.isUnmappedCandidate, true)
  assert.equal(result.meta.warnings.includes('dropped_url_without_input_evidence'), true)
  assert.equal(result.meta.warnings.includes('dropped_item_without_traceable_url'), true)
  assert.deepEqual(item.urlEvidence.map((url) => url.raw), ['/a', '/a?type=b'])
  assert.equal(item.expected.urls.some((url) => url.raw === '/a/a?type=b'), false)
})

test('same row multiple URLs preserve candidate row provenance and per-url provenance', async () => {
  const service = createServiceWithItems([aiItem({ sheetName: 'Navigation', rowNumber: 4, raw: '/first' })])

  const result = await service.normalize(createReference({
    sheetName: 'Navigation',
    rowNumber: 4,
    cells: { A: 'Targets', B: '/first', C: '/second' },
  }))
  const item = result.referenceMap.items[0]

  assert.equal(item.candidateId, 'cand-0001')
  assert.equal(item.source.sheetName, 'Navigation')
  assert.equal(item.source.rowNumber, 4)
  assert.deepEqual(item.expected.urls.map((url) => url.raw), ['/first', '/second'])
  assert.deepEqual(item.expected.urls.map((url) => url.provenance.sourceColumn), ['B', 'C'])
})

test('keeps dynamic template URL candidates only when the template is documented', async () => {
  const raw = '/products/{productId}'
  const service = createServiceWithItems([aiItem({ raw, matchMode: 'pattern' })])

  const result = await service.normalize(createReference({ cells: { A: 'Product detail template', B: raw } }))
  const url = result.referenceMap.items[0].expected.urls[0]

  assert.equal(url.raw, raw)
  assert.equal(url.matchMode, 'pattern')
  assert.deepEqual(url.dynamicParameters, ['productId'])
})

test('preserves source sheet row provenance and server-side row columns', async () => {
  const service = createServiceWithItems([
    aiItem({ sheetName: 'Navigation', rowNumber: 4, raw: '/checkout', evidenceText: 'Checkout link' }),
  ])
  const reference = createAiRequiredReference({ sheetName: 'Navigation', rowNumber: 4, cells: { A: 'Checkout', C: '/checkout', D: 'alternate may be /cart' } })

  const result = await service.normalize(reference)
  const source = result.referenceMap.items[0].source

  assert.equal(source.sheetName, 'Navigation')
  assert.equal(source.rowNumber, 4)
  assert.deepEqual(source.columns, { A: 'Checkout', C: '/checkout', D: 'alternate may be /cart' })
  assert.equal(source.evidenceText, 'Checkout link')
})

test('normalizes confidence into the 0 to 1 range', async () => {
  const service = createServiceWithItems([
    aiItem({ raw: '/high', confidence: 1.7 }),
    aiItem({ rowNumber: 3, raw: '/low', confidence: -0.5 }),
  ])
  const reference = createReference({
    rows: [
      { rowNumber: 2, cells: { A: 'High', B: '/high', C: 'alternate may be /high-old' } },
      { rowNumber: 3, cells: { A: 'Low', B: '/low', C: 'alternate may be /low-old' } },
    ],
  })

  const result = await service.normalize(reference)

  assert.equal(result.referenceMap.items[0].confidence, 1)
  assert.equal(result.referenceMap.items[1].confidence, 0)
})

test('forces userDecision to pending even when AI returns another status', async () => {
  const item = aiItem({ raw: '/pending' })
  item.userDecision = { status: 'confirmed', edited: true, excludedReason: 'AI tried to decide' }
  const service = createServiceWithItems([item])

  const result = await service.normalize(createReference({ cells: { A: 'Pending', B: '/pending' } }))

  assert.deepEqual(result.referenceMap.items[0].userDecision, { status: 'pending', edited: false, excludedReason: '' })
})

test('drops AI-created URLs that are not present in input facts', async () => {
  const service = createServiceWithItems([aiItem({ raw: '/invented' })])

  const result = await service.normalize(createAiRequiredReference({ cells: { A: 'Real target', B: '/real', C: 'alternate may be /real-old' } }))

  assert.equal(result.referenceMap.items.length, 1)
  assert.equal(result.referenceMap.items[0].isUnmappedCandidate, true)
  assert.equal(result.referenceMap.items[0].expected.urls[0].raw, '/real')
  assert.equal(result.meta.warnings.includes('dropped_url_without_input_evidence'), true)
  assert.equal(result.meta.warnings.includes('dropped_item_without_traceable_url'), true)
  assert.equal(result.meta.coverage.mappedCandidateRows, 0)
  assert.equal(result.meta.coverage.unmappedCandidateRows, 1)
})

test('drops AI items that reference a missing sheet or row', async () => {
  const service = createServiceWithItems([aiItem({ sheetName: 'Missing', rowNumber: 99, raw: '/real' })])

  const result = await service.normalize(createAiRequiredReference({ cells: { A: 'Real', B: '/real', C: 'alternate may be /real-old' } }))

  assert.equal(result.referenceMap.items.length, 1)
  assert.equal(result.referenceMap.items[0].isUnmappedCandidate, true)
  assert.equal(result.meta.warnings.includes('dropped_item_invalid_source'), true)
})

test('malformed AI JSON fails safely', async () => {
  const service = createServiceWithRaw('not json')

  const result = await service.normalize(createAiRequiredReference({ cells: { A: 'Target', B: '/target', C: 'alternate may be /target-old' } }))

  assert.equal(result.meta.outputItemCount, 0)
  assert.equal(result.meta.failedChunks[0].code, 'invalid_ai_json')
  assert.equal(result.referenceMap.items[0].isUnmappedCandidate, true)
})

test('empty AI message content fails safely with diagnostics', async () => {
  const service = createServiceWithCompletion({
    choices: [{ finish_reason: 'stop', message: { content: '' } }],
    usage: { prompt_tokens: 120, completion_tokens: 0, total_tokens: 120 },
  })

  const result = await service.normalize(createAiRequiredReference({ cells: { A: 'Target', B: '/target', C: 'alternate may be /target-old' } }))

  assert.equal(result.meta.failedChunks[0].code, 'empty_ai_response')
  assert.deepEqual(result.meta.failedChunks[0].diagnostics, {
    category: 'empty_response',
    fallbackUsed: true,
    model: 'gpt-5.6-terra',
    stage: 'response_parse',
    chunkIndex: 1,
    chunkCount: 1,
    finishReason: 'stop',
    contentLength: 0,
    contentType: 'string',
    promptTokens: 120,
    completionTokens: 0,
    totalTokens: 120,
    retryable: false,
  })
  assert.equal(result.referenceMap.items[0].isUnmappedCandidate, true)
})

test('finish_reason length with empty content returns precise safe error', async () => {
  const service = createServiceWithCompletion({
    choices: [{ finish_reason: 'length', message: { content: '' } }],
    usage: { prompt_tokens: 3000, completion_tokens: 6000, total_tokens: 9000 },
  })

  const result = await service.normalize(createAiRequiredReference({ cells: { A: 'Target', B: '/target', C: 'alternate may be /target-old' } }))

  assert.equal(result.meta.failedChunks[0].code, 'reference_chunk_length_limit')
  assert.equal(result.meta.failedChunks[0].diagnostics.category, 'truncated_response')
  assert.equal(result.meta.failedChunks[0].diagnostics.finishReason, 'length')
  assert.equal(result.meta.failedChunks[0].diagnostics.contentLength, 0)
  assert.equal(result.meta.failedChunks[0].diagnostics.completionTokens, 6000)
  assert.equal(result.referenceMap.items[0].isUnmappedCandidate, true)
})

test('array-shaped AI message content is parsed when it contains JSON text', async () => {
  const service = createServiceWithCompletion({
    choices: [{
      finish_reason: 'stop',
      message: { content: [{ type: 'text', text: JSON.stringify({ items: [aiItem({ raw: '/target' })] }) }] },
    }],
    usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
  })

  const result = await service.normalize(createAiRequiredReference({ cells: { A: 'Target', B: '/target', C: 'alternate may be /target-old' } }))

  assert.equal(result.referenceMap.items.length, 1)
  assert.equal(result.referenceMap.items[0].expected.urls[0].raw, '/target')
})

test('schema-invalid AI JSON fails safely', async () => {
  const service = createServiceWithRaw(JSON.stringify({ items: [{ source: { sheetName: 'Sheet1', rowNumber: 2 } }] }))

  const result = await service.normalize(createAiRequiredReference({ cells: { A: 'Target', B: '/target', C: 'alternate may be /target-old' } }))

  assert.equal(result.meta.outputItemCount, 0)
  assert.equal(result.meta.failedChunks[0].code, 'invalid_ai_schema')
  assert.equal(result.referenceMap.items[0].isUnmappedCandidate, true)
})

test('missing OPENAI_API_KEY fails safely when OpenAI would be needed', async () => {
  const service = createReferenceNavigationService({ apiKey: '', now: fixedNow })

  await assert.rejects(async () => {
    try {
      await service.normalize(createAiRequiredReference({ cells: { A: 'Target', B: '/target', C: 'alternate may be /target-old' } }))
    } catch (error) {
      assert.equal(error.code, 'missing_api_key')
      assert.equal(error.status, 400)
      assert.equal(error.diagnostics.category, 'missing_api_key')
      assert.equal(error.diagnostics.stage, 'configuration')
      assert.equal(error.diagnostics.retryable, false)
      throw error
    }
  })
})

test('OpenAI timeout or request error fails safely', async () => {
  const timeoutError = new Error('request timeout')
  timeoutError.name = 'TimeoutError'
  const service = createReferenceNavigationService({ apiKey: 'test-key', client: createThrowingClient(timeoutError), now: fixedNow })

  const result = await service.normalize(createAiRequiredReference({ cells: { A: 'Target', B: '/target', C: 'alternate may be /target-old' } }))

  assert.equal(result.meta.outputItemCount, 0)
  assert.equal(result.meta.failedChunks[0].code, 'openai_reference_timeout')
  assert.equal(result.meta.failedChunks[0].diagnostics.category, 'timeout')
  assert.equal(result.meta.failedChunks[0].diagnostics.stage, 'openai_request')
  assert.equal(result.meta.failedChunks[0].diagnostics.retryable, true)
  assert.equal(result.referenceMap.items[0].isUnmappedCandidate, true)
})

test('OpenAI failure classification exposes only safe diagnostics and keeps fallback', async () => {
  const authError = new Error('Incorrect API key provided')
  authError.status = 401
  authError.code = 'invalid_api_key'
  const rateLimitError = new Error('Rate limit reached for this request')
  rateLimitError.status = 429
  rateLimitError.code = 'rate_limit_exceeded'
  const quotaError = new Error('You exceeded your current quota, please check your plan and billing details')
  quotaError.status = 429
  quotaError.code = 'insufficient_quota'
  const modelError = new Error('The model does not exist or you do not have access to it')
  modelError.status = 404
  modelError.code = 'model_not_found'
  const networkError = new Error('fetch failed ECONNRESET')
  const unknownError = new Error('unexpected provider failure')
  const cases = [
    { error: authError, expected: { category: 'auth_failed', httpStatus: 401, providerCode: 'invalid_api_key', retryable: false } },
    { error: rateLimitError, expected: { category: 'rate_limited', httpStatus: 429, providerCode: 'rate_limit_exceeded', retryable: true } },
    { error: quotaError, expected: { category: 'quota_exhausted', httpStatus: 429, providerCode: 'insufficient_quota', retryable: false } },
    { error: modelError, expected: { category: 'model_unavailable', httpStatus: 404, providerCode: 'model_not_found', retryable: false } },
    { error: networkError, expected: { category: 'network_error', retryable: true } },
    { error: unknownError, expected: { category: 'unknown_openai_failure', retryable: false } },
  ]

  for (const { error, expected } of cases) {
    const result = await createReferenceNavigationService({ apiKey: 'test-key', client: createThrowingClient(error), now: fixedNow }).normalize(createAiRequiredReference({ cells: { A: 'Target', B: '/target', C: 'alternate may be /target-old' } }))
    const diagnostics = result.meta.failedChunks[0].diagnostics

    assert.equal(result.meta.failedChunks[0].code, 'openai_reference_failed')
    assert.equal(diagnostics.category, expected.category)
    assert.equal(diagnostics.stage, 'openai_request')
    assert.equal(diagnostics.fallbackUsed, true)
    assert.equal(diagnostics.model, 'gpt-5.6-terra')
    assert.equal(diagnostics.chunkIndex, 1)
    assert.equal(diagnostics.chunkCount, 1)
    assert.equal(diagnostics.retryable, expected.retryable)
    if (expected.httpStatus) assert.equal(diagnostics.httpStatus, expected.httpStatus)
    if (expected.providerCode) assert.equal(diagnostics.providerCode, expected.providerCode)
    assert.equal(result.meta.failedChunks[0].message.includes(error.message), false)
    assert.equal(result.meta.warnings.includes('all_reference_chunks_failed'), true)
    assert.equal(result.referenceMap.items[0].isUnmappedCandidate, true)
  }
})

test('failed chunk metadata never exposes prompt api key or raw AI response', async () => {
  const rawResponse = 'RAW_AI_RESPONSE_WITH_SECRET_KEY sk-test prompt body not json'
  const result = await createServiceWithRaw(rawResponse).normalize(createAiRequiredReference({ cells: { A: 'Target', B: '/target', C: 'alternate may be /target-old' } }))
  const serializedMeta = JSON.stringify(result.meta)

  assert.equal(result.meta.failedChunks[0].code, 'invalid_ai_json')
  assert.equal(serializedMeta.includes(rawResponse), false)
  assert.equal(/sk-test|prompt body/i.test(serializedMeta), false)
  assert.equal(result.referenceMap.items[0].isUnmappedCandidate, true)
})

test('post-validation with zero surviving items returns 200-style empty map result', async () => {
  const service = createServiceWithItems([aiItem({ raw: '/invented' })])

  const result = await service.normalize(createAiRequiredReference({ cells: { A: 'Real', B: '/real', C: 'alternate may be /real-old' } }))

  assert.equal(result.referenceMap.items.length, 1)
  assert.equal(result.referenceMap.items[0].isUnmappedCandidate, true)
  assert.equal(result.meta.outputItemCount, 0)
  assert.equal(result.meta.reviewItemCount, 1)
  assert.equal(result.meta.warnings.includes('dropped_item_without_traceable_url'), true)
  assert.equal(result.meta.failedChunks[0].diagnostics.category, 'post_validation_empty')
  assert.equal(result.meta.failedChunks[0].diagnostics.stage, 'post_validation')
})

test('schema invalid and malformed JSON include precise safe failure categories', async () => {
  const malformed = await createServiceWithRaw('not json').normalize(createAiRequiredReference({ cells: { A: 'Target', B: '/target', C: 'alternate may be /target-old' } }))
  const invalidSchema = await createServiceWithRaw(JSON.stringify({ items: [{ source: { sheetName: 'Sheet1', rowNumber: 2 } }] })).normalize(createAiRequiredReference({ cells: { A: 'Target', B: '/target', C: 'alternate may be /target-old' } }))

  assert.equal(malformed.meta.failedChunks[0].diagnostics.category, 'invalid_json')
  assert.equal(malformed.meta.failedChunks[0].diagnostics.stage, 'json_parse')
  assert.equal(invalidSchema.meta.failedChunks[0].diagnostics.category, 'schema_validation')
  assert.equal(invalidSchema.meta.failedChunks[0].diagnostics.stage, 'schema_validation')
})

test('unexpected implementation errors are classified as internal without raw object exposure', async () => {
  const client = {
    chat: {
      completions: {
        async create() {
          return Object.defineProperty({}, 'choices', { get() { throw new Error('internal synthetic failure with prompt secret') } })
        },
      },
    },
  }
  const service = createReferenceNavigationService({ apiKey: 'test-key', client, now: fixedNow })

  const result = await service.normalize(createAiRequiredReference({ cells: { A: 'Target', B: '/target', C: 'alternate may be /target-old' } }))

  assert.equal(result.meta.failedChunks[0].code, 'reference_chunk_internal_error')
  assert.equal(result.meta.failedChunks[0].diagnostics.category, 'internal_error')
  assert.equal(JSON.stringify(result.meta).includes('stack'), false)
  assert.equal(JSON.stringify(result.meta).includes('prompt secret'), false)
})

test('explicit URL row omitted by AI is preserved as unmapped with correct coverage', async () => {
  const service = createServiceWithItems([aiItem({ raw: '/mapped' })])
  const reference = createReference({
    rows: [
      { rowNumber: 2, cells: { A: 'Mapped', B: '/mapped', C: 'alternate may be /mapped-old' } },
      { rowNumber: 3, cells: { A: 'Omitted', B: '/omitted', C: 'alternate may be /omitted-old' } },
    ],
  })

  const result = await service.normalize(reference)

  assert.equal(result.referenceMap.items.length, 2)
  assert.equal(result.referenceMap.items[0].isUnmappedCandidate, undefined)
  assert.equal(result.referenceMap.items[1].isUnmappedCandidate, true)
  assert.equal(result.referenceMap.items[1].expected.urls[0].raw, '/omitted')
  assert.equal(result.meta.coverage.totalCandidateRows, 2)
  assert.equal(result.meta.coverage.totalGroundedUrls, 4)
  assert.equal(result.meta.coverage.mappedCandidateRows, 1)
  assert.equal(result.meta.coverage.mappedGroundedUrls, 1)
  assert.equal(result.meta.coverage.unmappedCandidateRows, 1)
  assert.equal(result.meta.coverage.unmappedGroundedUrls, 3)
  assert.equal(result.meta.coverage.coverageRatio, 0.5)
  assert.deepEqual(result.meta.coverage.rowCoverage, {
    totalCandidateRows: 2,
    mappedCandidateRows: 1,
    unmappedCandidateRows: 1,
    ratio: 0.5,
  })
  assert.equal(result.meta.coverage.urlEvidenceCoverage.totalGroundedUrls, 4)
  assert.equal(result.meta.coverage.urlEvidenceCoverage.classifiedGroundedUrls, 4)
  assert.equal(result.meta.coverage.urlEvidenceCoverage.expectedGroundedUrls, 2)
})

test('duplicate URL across selected sheets preserves separate provenance', async () => {
  const service = createServiceWithItems([
    aiItem({ sheetName: 'Current', rowNumber: 2, raw: '/shared' }),
    aiItem({ sheetName: 'Proposed', rowNumber: 2, raw: '/shared' }),
  ])
  const reference = createReference({
    sheets: [
      createSheet({ sheetName: 'Current', rows: [{ rowNumber: 2, cells: { A: 'Shared current', B: '/shared' } }] }),
      createSheet({ sheetName: 'Proposed', rows: [{ rowNumber: 2, cells: { A: 'Shared proposed', B: '/shared' } }] }),
    ],
  })

  const result = await service.normalize(reference)

  assert.deepEqual(result.referenceMap.items.map((item) => `${item.source.sheetName}:${item.source.rowNumber}`), ['Current:2', 'Proposed:2'])
  assert.equal(result.referenceMap.items.every((item) => item.duplicateCandidate === true), true)
  assert.equal(result.meta.coverage.totalCandidateRows, 2)
})

test('same row repeated URL evidence does not set final duplicate badge', async () => {
  const service = createServiceWithItems([aiItem({ urls: ['/shared'] })])

  const result = await service.normalize(createReference({ cells: { A: 'Shared', B: '/shared', C: '/shared' } }))

  assert.equal(result.referenceMap.items.length, 1)
  assert.equal(result.referenceMap.items[0].duplicateCandidate, false)
})

test('different rows with same final URL set duplicate badge while different queries stay distinct', async () => {
  const service = createServiceWithItems([
    aiItem({ rowNumber: 2, raw: '/page?tab=1' }),
    aiItem({ rowNumber: 3, raw: '/page?tab=1' }),
    aiItem({ rowNumber: 4, raw: '/page?tab=2' }),
  ])
  const reference = createReference({
    rows: [
      { rowNumber: 2, cells: { A: 'First', B: '/page?tab=1' } },
      { rowNumber: 3, cells: { A: 'Second', B: '/page?tab=1' } },
      { rowNumber: 4, cells: { A: 'Third', B: '/page?tab=2' } },
    ],
  })

  const result = await service.normalize(reference)

  assert.deepEqual(result.referenceMap.items.map((item) => item.duplicateCandidate), [true, true, false])
})

test('model resolver prefers REFERENCE_QA_MODEL then AI_QA_MODEL then default', () => {
  assert.equal(getReferenceQaModel({ REFERENCE_QA_MODEL: 'reference-model', AI_QA_MODEL: 'visual-model' }), 'reference-model')
  assert.equal(getReferenceQaModel({ REFERENCE_QA_MODEL: '', AI_QA_MODEL: 'visual-model' }), 'visual-model')
  assert.equal(getReferenceQaModel({}), 'gpt-5.6-terra')
})

test('reference normalization stays independent from qa run flow and visual AI sources', () => {
  const sources = [
    './referenceNavigationService.js',
    './referenceNormalizeRoute.js',
    './referenceModelConfig.js',
    './prompts/referenceNavigationPrompt.js',
  ].map((file) => fs.readFileSync(new URL(file, import.meta.url), 'utf8')).join('\n')

  assert.equal(/qaRunRoute|qaRunStream|createQaRunHandler|createQaRunStreamHandler|aiReviewService|aiReviewPrompt|visualVisionPrompt/.test(sources), false)
})

test('reference normalization production source has no customer domain path or header hardcoding', () => {
  const sources = [
    './referenceNavigationService.js',
    './referenceNormalizeRoute.js',
    './referenceModelConfig.js',
    './prompts/referenceNavigationPrompt.js',
  ].map((file) => fs.readFileSync(new URL(file, import.meta.url), 'utf8')).join('\n')

  assert.equal(/BMW|BMWFS|TOBE-IA|URL=F|F열|column F|column O|\/kr\/promotion|\/kr\/news\/list|\/kr\/legal\/credit-collection|\/kr\/purchase\/counseling|specific customer URL/i.test(sources), false)
})

function createServiceWithItems(items) {
  return createServiceWithRaw(JSON.stringify({ items }))
}

function createServiceWithRaw(raw) {
  return createReferenceNavigationService({ apiKey: 'test-key', client: createMockClient(raw), now: fixedNow })
}

function createServiceWithCompletion(completion) {
  return createReferenceNavigationService({ apiKey: 'test-key', client: createMockClientFromCompletion(completion), now: fixedNow })
}

function createMockClient(raw) {
  return createMockClientFromCompletion({ choices: [{ finish_reason: 'stop', message: { content: raw } }] })
}

function createMockClientFromCompletion(completion) {
  return {
    chat: {
      completions: {
        async create(request) {
          assert.equal(request.response_format.type, 'json_object')
          assert.equal(request.messages.length, 2)
          assert.equal(request.max_completion_tokens, 6000)
          return completion
        },
      },
    },
  }
}

function createPromptRecordingClient(handler) {
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
          return { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(result) } }] }
        },
      },
    },
  }
}

function parsePromptPayload(request) {
  return JSON.parse(request.messages[1].content.split('\n').at(-1))
}

function createThrowingClient(error) {
  return {
    chat: {
      completions: {
        async create() {
          throw error
        },
      },
    },
  }
}

function aiItem(options = {}) {
  const sheetName = options.sheetName || 'Sheet1'
  const rowNumber = options.rowNumber || 2
  const urls = options.urls || [options.raw || '/target']
  return {
    source: { sheetName, rowNumber, evidenceText: options.evidenceText || 'A: Label | B: target' },
    pageContext: { depthPath: ['Main'], sectionHint: 'Header', pageUrlHint: '' },
    element: { label: options.label || 'Target', aliases: [], roleHint: 'link', actionHint: 'navigation' },
    expected: {
      type: 'url',
      urls: urls.map((raw) => ({
        raw,
        matchMode: options.matchMode || 'path-and-query',
        allowSameOrigin: true,
        allowRedirect: false,
        allowTrailingSlashVariant: true,
        dynamicParameters: [],
      })),
      urlPatterns: [],
      notes: '',
    },
    provenance: { urlSource: 'explicit-document-cell', labelSource: 'document-cell', inferenceUsed: false, aiRationale: 'Documented row values.' },
    confidence: options.confidence ?? 0.9,
  }
}

function createReference(options = {}) {
  const sheetName = options.sheetName || 'Sheet1'
  const rows = options.rows || [{ rowNumber: options.rowNumber || 2, cells: options.cells || { A: 'Target', B: '/target' } }]
  const sheets = options.sheets || [createSheet({ sheetName, rows })]
  return {
    fileName: 'reference.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    size: 1024,
    sheetCount: sheets.length,
    workbookSheetCount: sheets.length,
    totalRowCount: sheets.reduce((count, sheet) => count + sheet.rowCount, 0),
    sheets,
  }
}

function createAiRequiredReference(options = {}) {
  return createReference(options)
}

function createSheet({ sheetName, rows, headerCandidates }) {
  return {
    sheetName,
    rowCount: rows.length,
    usedRange: { startRow: rows[0].rowNumber, endRow: rows.at(-1).rowNumber },
    headerCandidates: headerCandidates || [{ rowNumber: 1, cells: { A: 'Label', B: 'Target URL' } }],
    rows,
    rowsTruncated: false,
  }
}

function fixedNow() {
  return '2026-08-21T00:00:00.000Z'
}
