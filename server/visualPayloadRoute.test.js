import test from 'node:test'
import assert from 'node:assert/strict'
import { buildVisualPayloadResponse, createVisualPayloadHandler } from './visualPayloadRoute.js'
import { buildVisualQaPayloadArtifacts } from './visualQaPayload.js'
import { createWebVisualAnalysis } from './webVisualAnalysis.js'

const SAMPLE_SCREENSHOT = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF9sAAAAASUVORK5CYII='

function createDependencies() {
  const calls = { scanUrl: 0, scanArgs: null, webAnalysisInput: null }
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
              path: '.cache/visual/screenshots/test.png',
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
      matchTextNodes(figmaNodes, webNodes) {
        return {
          matchedPairs: [{
            figmaNode: figmaNodes[0],
            webElement: webNodes[0],
            matchConfidence: 'high',
            matchScore: 95,
            rawTextEqual: true,
            normalizedTextEqual: true,
          }],
          figmaOnly: Array.from({ length: 12 }, (_, index) => ({ characters: `Figma Only ${index}` })),
          webOnly: Array.from({ length: 11 }, (_, index) => ({ text: `Web Only ${index}` })),
          allPairs: [],
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
  assert.equal(result.web.screenshot.path, '.cache/visual/screenshots/test.png')
  assert.equal(result.web.textCount, 1)
  assert.equal(result.meta.playwrightRunCount, 1)
  assert.equal(result.meta.openAiCalled, false)
  assert.equal('debug' in result, false)

  const serialized = JSON.stringify(result)
  assert.equal(serialized.includes('matchedPairs'), false)
  assert.equal(serialized.includes('<html'), false)
  assert.equal(serialized.includes('figmaStructure'), false)
})

test('buildVisualPayloadResponse exposes limited debug previews only when debug true', async () => {
  const { dependencies } = createDependencies()
  const result = await buildVisualPayloadResponse({ figmaUrl: 'https://www.figma.com/file/abc/test?node-id=123-456', webUrl: 'https://example.com/page', debug: true }, dependencies)

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
  assert.equal(Array.isArray(result.debug.entitySectionTrace.figmaHeroActions), true)
  assert.equal(Array.isArray(result.debug.webVideoTrace), true)
  assert.equal(result.debug.payloadQuality.heroMediaGroupCreated, true)
  assert.equal(typeof result.debug.payloadQuality.parentCtaRemovedCount, 'number')
  assert.equal(typeof result.debug.payloadQuality.heroPrimaryMediaCount, 'number')
  assert.equal(typeof result.debug.payloadQuality.canonicalCountConsistencyPassed, 'boolean')
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
