export function createVisualPayloadHandler(dependencies) {
  return async function visualPayloadHandler(req, res) {
    const figmaUrl = typeof req.body?.figmaUrl === 'string' ? req.body.figmaUrl.trim() : ''
    const webUrl = typeof req.body?.webUrl === 'string' ? req.body.webUrl.trim() : ''
    const debug = req.body?.debug === true

    if (!dependencies.isHttpUrl(webUrl)) {
      res.status(400).json({ message: 'http:// 또는 https://로 시작하는 Web URL만 사용할 수 있습니다.' })
      return
    }

    try {
      const payload = await buildVisualPayloadResponse({ figmaUrl, webUrl, debug }, dependencies)
      res.json(payload)
    } catch (error) {
      const mappedError = dependencies.mapFigmaLoaderError(error, 'visual-payload')
      res.status(mappedError.status).json(mappedError.body)
    }
  }
}

export async function buildVisualPayloadResponse(input, dependencies) {
  const now = dependencies.now || Date.now
  const debug = input?.debug === true
  const totalStartedAt = now()
  const timings = {
    figmaNodeLoadMs: 0,
    figmaRenderLoadMs: 0,
    webScanMs: 0,
    textCompareMs: 0,
    payloadBuildMs: 0,
    totalMs: 0,
  }
  const instrumentation = { playwrightRunCount: 0 }

  const { fileKey, nodeId } = dependencies.parseFigmaUrl(input.figmaUrl)
  const figmaToken = dependencies.getFigmaToken()
  if (!figmaToken) {
    throw dependencies.createHttpError(400, 'FIGMA_TOKEN이 설정되지 않았습니다.')
  }

  const figmaNodeStartedAt = now()
  const figmaResult = await dependencies.inspectFigmaNode({
    fileKey,
    nodeId,
    token: figmaToken,
    includeTextNodes: true,
    includeStructure: true,
    includeFlatNodes: true,
  })
  timings.figmaNodeLoadMs = now() - figmaNodeStartedAt

  const figmaRenderStartedAt = now()
  const figmaRender = await dependencies.getFigmaRenderedImage({
    fileKey,
    nodeId,
    token: figmaToken,
    nodeName: figmaResult.nodeName,
    format: 'png',
    scale: 2,
  })
  timings.figmaRenderLoadMs = now() - figmaRenderStartedAt

  const webScanStartedAt = now()
  const scanResult = await dependencies.scanUrl(input.webUrl, {
    includeVisualPayloadData: true,
    includeMobile: false,
    instrumentation,
  })
  const webAnalysis = dependencies.createWebVisualAnalysis(scanResult)
  timings.webScanMs = now() - webScanStartedAt

  const textCompareStartedAt = now()
  const matchResult = dependencies.matchTextNodes(
    figmaResult.textNodes || [],
    webAnalysis.textNodes || [],
    { includeAllPairs: false },
  )
  const differences = dependencies.createTextDifferenceCandidates(matchResult.matchedPairs)
  const textCompareResponse = dependencies.createTextCompareResponse({
    figmaTextNodes: figmaResult.textNodes || [],
    webTextElements: webAnalysis.textNodes || [],
    matchResult,
    differences,
    includeAllPairs: false,
    cache: figmaResult.cache,
  })
  const textComparison = {
    summary: textCompareResponse.summary,
    differences: textCompareResponse.differences,
    figmaOnlyPreview: textCompareResponse.figmaOnlyPreview,
    webOnlyPreview: textCompareResponse.webOnlyPreview,
  }
  timings.textCompareMs = now() - textCompareStartedAt

  const meta = {
    createdAt: new Date(totalStartedAt).toISOString(),
    webUrl: input.webUrl,
    figmaNodeId: nodeId,
    playwrightRunCount: webAnalysis.meta?.playwrightRunCount || instrumentation.playwrightRunCount || 0,
    figmaCacheSource: figmaResult.cache?.source || 'unknown',
    figmaRenderCacheSource: figmaRender.cache?.source || 'unknown',
    webScreenshotCreated: webAnalysis.screenshot?.created === true,
    openAiCalled: false,
    payloadVersion: '1.0',
  }

  const payloadStartedAt = now()
  const payload = dependencies.createVisualQaPayload({
    figmaAnalysis: {
      render: figmaRender,
      structure: figmaResult.figmaStructure,
      flatNodes: figmaResult.figmaFlatNodes || [],
      textNodes: figmaResult.textNodes || [],
      structureSummary: figmaResult.structureSummary || {},
    },
    webAnalysis,
    textComparison,
  })
  timings.payloadBuildMs = now() - payloadStartedAt
  timings.totalMs = now() - totalStartedAt

  const response = {
    meta,
    ...payload,
  }

  if (debug) {
    response.debug = createDebugPayload({
      figmaResult,
      figmaRender,
      webAnalysis,
      textComparison,
      timings,
    })
  }

  return response
}

function createDebugPayload({ figmaResult, figmaRender, webAnalysis, textComparison, timings }) {
  return {
    counts: {
      figmaTextNodes: Array.isArray(figmaResult.textNodes) ? figmaResult.textNodes.length : 0,
      webTextNodes: Array.isArray(webAnalysis.textNodes) ? webAnalysis.textNodes.length : 0,
      designElements: Array.isArray(webAnalysis.designElements) ? webAnalysis.designElements.length : 0,
      ctaCandidates: Array.isArray(webAnalysis.ctaCandidates) ? webAnalysis.ctaCandidates.length : 0,
      imageCandidates: Array.isArray(webAnalysis.imageCandidates) ? webAnalysis.imageCandidates.length : 0,
      videoCandidates: Array.isArray(webAnalysis.videoCandidates) ? webAnalysis.videoCandidates.length : 0,
      sectionCandidates: Array.isArray(webAnalysis.sectionCandidates) ? webAnalysis.sectionCandidates.length : 0,
      differences: Array.isArray(textComparison.differences) ? textComparison.differences.length : 0,
    },
    preview: {
      figmaOnly: Array.isArray(textComparison.figmaOnlyPreview) ? textComparison.figmaOnlyPreview.slice(0, 10) : [],
      webOnly: Array.isArray(textComparison.webOnlyPreview) ? textComparison.webOnlyPreview.slice(0, 10) : [],
      ctaCandidates: Array.isArray(webAnalysis.ctaCandidates) ? webAnalysis.ctaCandidates.slice(0, 5) : [],
      imageCandidates: Array.isArray(webAnalysis.imageCandidates) ? webAnalysis.imageCandidates.slice(0, 5) : [],
      videoCandidates: Array.isArray(webAnalysis.videoCandidates) ? webAnalysis.videoCandidates.slice(0, 5) : [],
      sectionCandidates: Array.isArray(webAnalysis.sectionCandidates) ? webAnalysis.sectionCandidates.slice(0, 5) : [],
    },
    cache: {
      figmaNode: figmaResult.cache || null,
      figmaRender: figmaRender.cache || null,
    },
    timing: timings,
  }
}
