import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { buildVisualPayloadFromScanResult, buildVisualPayloadResponse, createVisualPayloadHandler } from './visualPayloadRoute.js'
import { buildVisualQaPayloadArtifacts } from './visualQaPayload.js'
import { createWebVisualAnalysis } from './webVisualAnalysis.js'

const SAMPLE_SCREENSHOT = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF9sAAAAASUVORK5CYII='

function createDependencies() {
  const calls = { scanUrl: 0, scanArgs: null, webAnalysisInput: null, matchOptions: null, writeVisualTextDebugArtifact: 0, artifactPayload: null }
  const scanResult = {
    targetUrl: 'https://example.com/page',
    pageTitle: 'Example',
    webScreenshot: {
      dataUrl: SAMPLE_SCREENSHOT,
      width: 1920,
      height: 2800,
      viewport: { width: 1920, height: 1080 },
      capturedAt: '2026-07-12T10:00:00.000Z',
    },
    webCtaHints: [{ text: 'Apply', href: '/apply', selector: 'button.apply', area: 'top', visible: true, y: 120 }],
    images: [{ alt: 'Hero', selector: 'img.hero', section: 'top', loaded: true, naturalWidth: 1200, naturalHeight: 800 }],
    designElements: [{ text: 'Hero title' }],
    visualPayloadData: {
      page: { viewportWidth: 1920, viewportHeight: 1080, scrollWidth: 1920, scrollHeight: 2800 },
      textNodes: [{ text: 'Hero title', rawText: 'Hero title', tagName: 'h1', selector: 'h1', yRatio: 0.05, role: 'heading', sectionHint: 'hero' }],
      videoCandidates: [{ tagName: 'video', selector: 'video.hero', section: 'top', autoplay: true, controls: true }],
      playwrightRunCount: 1,
    },
  }

  return {
    calls,
    dependencies: {
      now: (() => {
        let current = 1000
        return () => {
          current += 5
          return current
        }
      })(),
      isHttpUrl(value) {
        return /^https?:\/\//.test(String(value || ''))
      },
      parseFigmaUrl() {
        return { fileKey: 'file-key', nodeId: '123:456' }
      },
      getFigmaToken() {
        return 'secret-token'
      },
      createHttpError(status, message) {
        const error = new Error(message)
        error.status = status
        return error
      },
      async inspectFigmaNode() {
        return {
          nodeName: 'Hero Frame',
          textNodes: [{ characters: 'Hero title', layerPath: 'Hero / Title', yRatio: 0.05, fontSize: 40, fontWeight: 700, parentFrameName: 'Hero' }],
          figmaFlatNodes: [{ name: 'Hero Image', layerPath: 'Hero / Image', yRatio: 0.1, effectivelyVisible: true, hasImageFill: true, hasVideoLikeContent: false, isInteractiveCandidate: false }],
          structureSummary: { totalNodeCount: 10 },
          figmaStructure: { id: 'root' },
          cache: { source: 'disk' },
        }
      },
      async getFigmaRenderedImage() {
        return {
          imageUrl: '/api/figma/render/render-1',
          localImagePath: '.cache/figma/renders/render-1.png',
          renderId: 'render-1',
          cache: { source: 'memory' },
        }
      },
      async scanUrl(url, options) {
        calls.scanUrl += 1
        calls.scanArgs = { url, options }
        return scanResult
      },
      createWebVisualAnalysis(result) {
        calls.webAnalysisInput = result
        return createWebVisualAnalysis(result, {
          saveScreenshot() {
            return {
              path: '.cache/visual/screenshots/7ab5b706fd88d75e7418254e.png',
              width: 1920,
              height: 2800,
              mimeType: 'image/png',
              created: true,
              sizeBytes: 123,
              capturedAt: '2026-07-12T10:00:00.000Z',
              error: '',
            }
          },
        })
      },
      matchTextNodes(figmaNodes, webNodes, options) {
        calls.matchOptions = options
        return {
          matchedPairs: [{
            figmaNode: figmaNodes[0],
            webElement: webNodes[0],
            matchConfidence: 'high',
            matchScore: 95,
            rawTextEqual: true,
            normalizedTextEqual: true,
            diagnostics: options?.includeDiagnostics ? { normalizedSimilarity: 1, threshold: { minimumMatchScore: 45 }, gate: 'eligible' } : undefined,
          }],
          figmaOnly: Array.from({ length: 12 }, (_, index) => ({ characters: `Figma Only ${index}` })),
          webOnly: Array.from({ length: 11 }, (_, index) => ({ text: `Web Only ${index}` })),
          allPairs: options?.includeAllPairs ? [{
            figmaNode: { nodeId: 'f-2', characters: 'Missing hero copy', layerPath: 'Hero / Copy', yRatio: 0.12 },
            webElement: { id: 'w-2', selector: '.hero-copy', rawText: 'Rendered hero copy', yRatio: 0.13, role: 'body' },
            matchConfidence: 'low',
            matchScore: 35,
            matchReasons: ['세로 위치가 가깝습니다.'],
            rejectReasons: [],
            rawTextEqual: false,
            normalizedTextEqual: false,
            diagnostics: options?.includeDiagnostics ? { normalizedSimilarity: 0.2, threshold: { minimumMatchScore: 45 }, gate: 'below-threshold' } : undefined,
          }] : [],
        }
      },
      createTextDifferenceCandidates() {
        return Array.from({ length: 25 }, (_, index) => ({ figmaText: `Figma ${index}`, webText: `Web ${index}`, matchConfidence: 'high', evidence: ['same region'] }))
      },
      createTextCompareResponse() {
        return {
          summary: { matchedCount: 1, differenceCount: 25, figmaOnlyCount: 12, webOnlyCount: 11 },
          differences: Array.from({ length: 25 }, (_, index) => ({ figmaText: `Figma ${index}`, webText: `Web ${index}`, matchConfidence: 'high', evidence: ['same region'] })),
          figmaOnlyPreview: Array.from({ length: 12 }, (_, index) => ({ text: `Figma Only ${index}` })),
          webOnlyPreview: Array.from({ length: 11 }, (_, index) => ({ text: `Web Only ${index}` })),
        }
      },
      buildVisualQaPayloadArtifacts,
      async validateImageAsset(relativePath) {
        if (relativePath.includes('figma')) return { exists: true, readable: true, mimeType: 'image/png' }
        return { exists: true, readable: true, mimeType: 'image/png' }
      },
      async writeVisualTextDebugArtifact(payload) {
        calls.writeVisualTextDebugArtifact += 1
        calls.artifactPayload = payload
        return { path: 'debug/visual-text-runtime-latest.json', sizeBytes: 1234, overwritten: true }
      },
      mapFigmaLoaderError(error) {
        return { status: error.status || 500, body: { message: error.message } }
      },
    },
  }
}

test('buildVisualPayloadResponse uses one scanUrl call and reuses one scanResult for screenshot and text', async () => {
  const { calls, dependencies } = createDependencies()
  const result = await buildVisualPayloadResponse({ figmaUrl: 'https://www.figma.com/file/abc/test?node-id=123-456', webUrl: 'https://example.com/page', debug: false }, dependencies)

  assert.equal(calls.scanUrl, 1)
  assert.equal(calls.scanArgs.url, 'https://example.com/page')
  assert.equal(calls.scanArgs.options.includeVisualPayloadData, true)
  assert.equal(calls.scanArgs.options.includeMobile, false)
  assert.equal(calls.webAnalysisInput.visualPayloadData.textNodes[0].text, 'Hero title')
  assert.equal(result.figma.displayImageUrl, '/api/figma/render/render-1')
  assert.equal(result.web.screenshot.path, '.cache/visual/screenshots/7ab5b706fd88d75e7418254e.png')
  assert.equal(result.web.displayImageUrl, '/api/visual/screenshot/7ab5b706fd88d75e7418254e.png')
  assert.equal(result.web.textCount, 1)
  assert.equal(result.meta.playwrightRunCount, 1)
  assert.equal(result.meta.openAiCalled, false)
  assert.equal('debug' in result, false)
  assert.deepEqual(calls.matchOptions, { includeAllPairs: false })
  assert.equal(calls.writeVisualTextDebugArtifact, 0)

  const serialized = JSON.stringify(result)
  assert.equal(serialized.includes('matchedPairs'), false)
  assert.equal(serialized.includes('visualTextDiagnostics'), false)
  assert.equal(serialized.includes('<html'), false)
  assert.equal(serialized.includes('figmaStructure'), false)
})

test('buildVisualPayloadResponse exposes limited debug previews only when debug true', async () => {
  const { calls, dependencies } = createDependencies()
  const result = await buildVisualPayloadResponse({ figmaUrl: 'https://www.figma.com/file/abc/test?node-id=123-456', webUrl: 'https://example.com/page', debug: true }, dependencies)

  assert.deepEqual(calls.matchOptions, { includeAllPairs: true, includeDiagnostics: true })
  assert.equal(calls.writeVisualTextDebugArtifact, 0)
  assert.equal(Array.isArray(result.debug.preview.figmaOnly), true)
  assert.equal(Array.isArray(result.debug.preview.webOnly), true)
  assert.equal(result.debug.preview.figmaOnly.length, 10)
  assert.equal(result.debug.preview.webOnly.length, 10)
  assert.deepEqual(Object.keys(result.debug.timing).sort(), ['figmaNodeLoadMs', 'figmaRenderLoadMs', 'payloadBuildMs', 'textCompareMs', 'totalMs', 'webScanMs'])
  Object.values(result.debug.timing).forEach((value) => assert.equal(typeof value, 'number'))
  assert.equal(result.debug.imageValidation.figmaExists, true)
  assert.equal(result.debug.imageValidation.webReadable, true)
  assert.equal(typeof result.debug.sectionTrace.webHero.sectionId, 'string')
  assert.equal(typeof result.debug.sectionTrace.unassignedEntityCount, 'number')
  assert.equal(Array.isArray(result.debug.heroCandidateTrace.figma), true)
  assert.equal(Array.isArray(result.debug.heroCandidateTrace.web), true)
  assert.equal(typeof result.debug.figmaActionInputTrace.heroDescendantNodeCount, 'number')
  assert.equal(typeof result.debug.webVideoPipelineTrace.webAnalysisCount, 'number')
  assert.equal(Array.isArray(result.debug.entitySectionTrace.figmaHeroActions), true)
  assert.equal(Array.isArray(result.debug.webVideoTrace), true)
  assert.equal(typeof result.debug.heroActionResolution.stage1RawCandidates, 'number')
  assert.equal(typeof result.debug.heroMediaResolution.stage1Candidates, 'number')
  assert.equal(Array.isArray(result.debug.canonicalMergeTrace.actionPairs), true)
  assert.equal(result.debug.payloadQuality.heroMediaGroupCreated, true)
  assert.equal(typeof result.debug.payloadQuality.parentCtaRemovedCount, 'number')
  assert.equal(typeof result.debug.payloadQuality.heroPrimaryMediaCount, 'number')
  assert.equal(typeof result.debug.payloadQuality.canonicalCountConsistencyPassed, 'boolean')
  assert.equal(result.debug.visualTextDiagnostics.schemaVersion, 'visual-text-diagnostics-v1')
  assert.equal(result.debug.visualTextDiagnostics.safety.openAiCalled, false)
  assert.equal(result.debug.visualTextDiagnostics.summary.allPairCount, 1)
  assert.equal(result.debug.visualTextDiagnostics.matching.pairCandidates[0].selectionStatus, 'below-threshold')
  assert.equal(result.debug.visualTextDiagnostics.textDifferenceCandidates.rejectedUnmatchedPairCandidates[0].rejectionGate, 'score-below-45')
  assert.equal(result.debug.visualTextDiagnostics.finalFlow.displayAndCoreInputs.aiReviewVisualDifferencesIncluded, false)
})

test('buildVisualPayloadResponse writes visual text artifact only with explicit debug save flag', async () => {
  const { calls, dependencies } = createDependencies()
  const result = await buildVisualPayloadResponse({ figmaUrl: 'https://www.figma.com/file/abc/test?node-id=123-456', webUrl: 'https://example.com/page', debug: true, saveVisualTextDebugArtifact: true }, dependencies)

  assert.equal(calls.writeVisualTextDebugArtifact, 1)
  assert.equal(calls.artifactPayload.schemaVersion, 'visual-text-diagnostics-v1')
  assert.deepEqual(result.debug.visualTextDiagnostics.artifact, { path: 'debug/visual-text-runtime-latest.json', sizeBytes: 1234, overwritten: true })
  assert.equal(JSON.stringify(calls.artifactPayload).includes('secret-token'), false)
})

test('visual text runtime debug artifact is ignored by git', () => {
  const gitignore = fs.readFileSync('.gitignore', 'utf8')
  assert.equal(gitignore.includes('debug/visual-text-runtime-latest.json'), true)
})

test('visual payload handler saves diagnostics only for explicit visual text diagnostic mode', async () => {
  const { calls, dependencies } = createDependencies()
  const handler = createVisualPayloadHandler(dependencies)
  const response = createMockResponse()

  await handler({ body: { figmaUrl: 'https://www.figma.com/file/abc/test?node-id=123-456', webUrl: 'https://example.com/page', debug: true, diagnosticMode: 'visual-text' } }, response)

  assert.equal(response.statusCode, 200)
  assert.equal(calls.scanUrl, 1)
  assert.equal(calls.writeVisualTextDebugArtifact, 1)
  assert.equal(response.body.debug.visualTextDiagnostics.artifact.path, 'debug/visual-text-runtime-latest.json')
})

test('createVisualPayloadHandler returns 400 for invalid URL without calling scanUrl', async () => {
  const { calls, dependencies } = createDependencies()
  const handler = createVisualPayloadHandler(dependencies)
  const response = createMockResponse()

  await handler({ body: { figmaUrl: 'https://www.figma.com/file/abc/test?node-id=123-456', webUrl: 'notaurl' } }, response)

  assert.equal(calls.scanUrl, 0)
  assert.equal(response.statusCode, 400)
  assert.equal(response.body.message.includes('http://'), true)
})

test('buildVisualPayloadFromScanResult reuses provided figma preparation without refetching', async () => {
  const { calls, dependencies } = createDependencies()
  const progress = []
  let inspectCount = 0
  let renderCount = 0
  dependencies.inspectFigmaNode = async () => {
    inspectCount += 1
    throw new Error('should not inspect')
  }
  dependencies.getFigmaRenderedImage = async () => {
    renderCount += 1
    throw new Error('should not render')
  }

  const result = await buildVisualPayloadFromScanResult({
    figmaUrl: 'https://www.figma.com/file/abc/test?node-id=123-456',
    webUrl: 'https://example.com/page',
    scanResult: dependencies.scanResult || await dependencies.scanUrl('https://example.com/page', { includeVisualPayloadData: true }),
    figmaPreparationPromise: Promise.resolve({
      fileKey: 'file-key',
      nodeId: '123:456',
      figmaResult: {
        nodeName: 'Prepared Frame',
        textNodes: [{ characters: 'Hero title', layerPath: 'Hero / Title', yRatio: 0.05, fontSize: 40, fontWeight: 700, parentFrameName: 'Hero' }],
        figmaFlatNodes: [],
        structureSummary: {},
        figmaStructure: { id: 'prepared' },
        cache: { source: 'memory' },
      },
      figmaRender: { imageUrl: '/api/figma/render/prepared', localImagePath: '.cache/figma/renders/prepared.png', renderId: 'prepared', cache: { source: 'memory' } },
      timings: { figmaNodeLoadMs: 11, figmaRenderLoadMs: 12 },
    }),
    onProgress: (unit) => progress.push(unit),
  }, dependencies)

  assert.equal(inspectCount, 0)
  assert.equal(renderCount, 0)
  assert.equal(calls.webAnalysisInput.targetUrl, 'https://example.com/page')
  assert.equal(result.figma.displayImageUrl, '/api/figma/render/prepared')
  assert.deepEqual(progress, ['visual_compare', 'visual_payload'])
})

function createMockResponse() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code
      return this
    },
    json(payload) {
      this.body = payload
      return this
    },
  }
}
