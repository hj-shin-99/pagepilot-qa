import { useEffect, useRef, useState } from 'react'
import './App.css'
import { createResultSummary } from './utils/report'
import { deleteHistoryItem, loadHistoryItems, saveHistoryItem } from './utils/history'
import { buildAiReviewPayloadFromSession, sanitizeAiReviewResponse } from './utils/aiReview'
import { confirmWebUrlInput, createDebouncedWebUrlConfirmScheduler, createPublicWebUrlState, createWebUrlInputState, isValidHttpUrl } from './utils/scanSession'
import { countIssueCards, createCompactVisualResult, createVisualIssueCards, createVisualSummary } from './utils/visualQa'
import { createTechQaViewModel } from './utils/techQa'
import { createDefaultTechScanOptions, normalizeStoredTechScanOptions, normalizeTechScanOptions } from '../shared/techScanOptions.js'
import { getScanStageFromQaProgressEvent, getScanningResultReadyTransitionMs, SCAN_RESULT_READY_TRANSITION_MS } from './utils/scanningStages'
import { requestQaRunStream } from './utils/qaRunStream'
import EmptyState from './components/EmptyState'
import HistoryPanel from './components/HistoryPanel'
import QaStartScreen from './components/QaStartScreen'
import TechQaPanel from './components/TechQaPanel'
import VisualQaPanel from './components/VisualQaPanel'
import WorkspaceTabs from './components/WorkspaceTabs'

function App() {
  const [url, setUrl] = useState('')
  const [figmaUrl, setFigmaUrl] = useState('')
  const [visualResult, setVisualResult] = useState(null)
  const [techResult, setTechResult] = useState(null)
  const [visualScanState, setVisualScanState] = useState('idle')
  const [techScanState, setTechScanState] = useState('idle')
  const [activeTab, setActiveTab] = useState('overview')
  const [inputError, setInputError] = useState('')
  const [hasWebUrlBlurred, setHasWebUrlBlurred] = useState(false)
  const [isWebUrlConfirmed, setIsWebUrlConfirmed] = useState(false)
  const [figmaError, setFigmaError] = useState('')
  const [visualScanError, setVisualScanError] = useState('')
  const [techScanError, setTechScanError] = useState('')
  const [aiReview, setAiReview] = useState(null)
  const [aiReviewState, setAiReviewState] = useState('idle')
  const [scanStage, setScanStage] = useState('idle')
  const [scanProgressEvent, setScanProgressEvent] = useState(null)
  const [historyItems, setHistoryItems] = useState(() => loadHistoryItems())
  const [selectedHistoryId, setSelectedHistoryId] = useState('')
  const [techScanOptions, setTechScanOptions] = useState(() => createDefaultTechScanOptions())
  const minimumScanningTimerRef = useRef(null)

  const isScanning = visualScanState === 'loading' || techScanState === 'loading' || aiReviewState === 'loading'
  const webUrlState = createWebUrlInputState(url, { isConfirmed: isWebUrlConfirmed })
  const isWebUrlReady = webUrlState.isConfirmed
  const canStartWithWebUrl = webUrlState.isSyntacticallyValid
  const isVisualTabEnabled = Boolean(visualResult) || visualScanState === 'loading' || visualScanState === 'success' || visualScanState === 'error'
  const isTechTabEnabled = Boolean(techResult) || techScanState === 'loading' || techScanState === 'success' || techScanState === 'error'
  const isIdleStartView = !isScanning && activeTab === 'overview' && !visualResult && !techResult && visualScanState === 'idle' && techScanState === 'idle'
  const isEmptyResultView = activeTab !== 'history' && ((activeTab === 'tech' && !techResult) || (activeTab === 'visual' && !visualResult) || activeTab === 'overview')

  useEffect(() => {
    if (isScanning || isWebUrlConfirmed || !url.trim()) return undefined

    const scheduler = createDebouncedWebUrlConfirmScheduler({
      setTimeoutFn: window.setTimeout,
      clearTimeoutFn: window.clearTimeout,
      onConfirm: (nextState) => {
        if (!nextState.isConfirmed) {
          setIsWebUrlConfirmed(false)
          return
        }
        setInputError('')
        setIsWebUrlConfirmed(true)
        setUrl((currentUrl) => currentUrl.trim() === nextState.rawValue.trim() ? nextState.inputValue : currentUrl)
      },
    })
    scheduler.schedule(url)
    return scheduler.cancel
  }, [isScanning, isWebUrlConfirmed, url])

  useEffect(() => () => {
    if (minimumScanningTimerRef.current !== null) window.clearTimeout(minimumScanningTimerRef.current)
  }, [])

  const handleTabChange = (tabId) => {
    if (tabId === 'visual' && !isVisualTabEnabled) return
    if (tabId === 'tech' && !isTechTabEnabled) return
    setActiveTab(tabId)
  }

  const handleStartScan = async () => {
    const startWebUrlState = createPublicWebUrlState(url)
    const webUrl = startWebUrlState.normalizedUrl
    const frameUrl = figmaUrl.trim()

    if (startWebUrlState.isValid) {
      setIsWebUrlConfirmed(true)
      if (webUrl !== url.trim()) setUrl(webUrl)
    } else {
      setIsWebUrlConfirmed(false)
    }

    setVisualScanError('')
    setTechScanError('')
    setInputError('')
    setFigmaError('')
    setVisualResult(null)
    setTechResult(null)
    setAiReview(null)
    setAiReviewState('idle')
    setScanStage('idle')
    setScanProgressEvent(null)
    setSelectedHistoryId('')

    if (!startWebUrlState.isValid || !isValidHttpUrl(webUrl)) {
      setInputError('http:// 또는 https://로 시작하는 Web URL을 입력해 주세요.')
      setHasWebUrlBlurred(true)
      setTechScanState('idle')
      setVisualScanState('idle')
      setScanStage('idle')
      setActiveTab('overview')
      return
    }

    setTechScanState('loading')
    setVisualScanState(frameUrl ? 'loading' : 'skipped')
    setScanStage(frameUrl ? 'qa-run' : 'tech-run')
    setActiveTab(frameUrl ? 'visual' : 'tech')

    let session
    try {
      session = await requestQaRun(webUrl, frameUrl, techScanOptions, (progressEvent) => {
        setScanProgressEvent(progressEvent)
        setScanStage(getScanStageFromQaProgressEvent(progressEvent, { combined: Boolean(frameUrl) }))
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : '통합 검사 요청에 실패했습니다.'
      session = {
        webUrl,
        figmaUrl: frameUrl,
        shouldSaveCombined: Boolean(frameUrl),
        tech: { status: 'error', result: null, error: message },
        visual: frameUrl ? { status: 'error', result: null, error: message } : { status: 'skipped', result: null, error: null },
      }
    }

    setActiveTab(frameUrl ? 'visual' : 'tech')
    if (session.shouldSaveCombined && session.tech.status === 'error' && session.visual.status === 'error') {
      const commonError = `Visual QA와 Tech QA 모두 실패했습니다. Visual: ${session.visual.error} / Tech: ${session.tech.error}`
      session.visual.error = commonError
      session.tech.error = commonError
    }
    if (frameUrl && session.tech.status === 'success' && session.visual.status === 'success') {
      setScanStage('ai-review')
      setAiReviewState('loading')
      try {
        const review = await requestAiReviewFromPayload(buildAiReviewPayloadFromSession(session))
        session.aiReview = review
        setAiReview(review)
        setAiReviewState(review.meta.fallbackUsed ? 'fallback' : 'success')
      } catch (error) {
        const review = createLocalAiReviewFallback(error)
        session.aiReview = review
        setAiReview(review)
        setAiReviewState('fallback')
      }
    }

    setScanStage('finalizing')
    await waitForResultReadyTransition({
      durationMs: getScanningResultReadyTransitionMs({ isTech: !frameUrl, combined: Boolean(frameUrl) }),
      setTimeoutFn: window.setTimeout,
      clearTimeoutFn: window.clearTimeout,
      timerRef: minimumScanningTimerRef,
    })
    applyTechSessionState(session.tech, setTechResult, setTechScanState, setTechScanError)
    applyVisualSessionState(session.visual, setVisualResult, setVisualScanState, setVisualScanError)

    if (session.shouldSaveCombined) {
      setHistoryItems(saveHistoryItem(createCombinedHistoryItem(session)))
    } else if (session.tech.status === 'success') {
      setHistoryItems(saveHistoryItem(createTechHistoryItem(session.tech.result)))
    }
    setScanStage('idle')
  }

  const handleRestoreHistory = (item) => {
    setSelectedHistoryId(item.id)
    setUrl(item.url)
    setFigmaUrl(item.figmaUrl || '')
    setInputError('')
    setFigmaError('')
    setVisualScanError('')
    setTechScanError('')
    setAiReview(null)
    setAiReviewState('idle')
    setScanStage('idle')
    setScanProgressEvent(null)

    if (item.type === 'combined') {
      setVisualResult(item.visual?.compactResult || null)
      setTechResult(item.tech?.compactResult || null)
      setTechScanOptions(resolveHistoryScanOptions(item.tech?.compactResult || item.tech))
      setVisualScanState(item.visual?.status || 'skipped')
      setTechScanState(item.tech?.status || 'idle')
      setVisualScanError(item.visual?.error || '')
      setTechScanError(item.tech?.error || '')
      setAiReview(item.aiReview || null)
      setAiReviewState(item.aiReview ? item.aiReview.meta?.fallbackUsed ? 'fallback' : 'success' : 'idle')
      setActiveTab('visual')
      return
    }

    if (!item.result) {
      setVisualResult(null)
      setTechResult(null)
      setVisualScanState('idle')
      setTechScanState('idle')
      setActiveTab('history')
      return
    }

    if (item.type === 'tech' || item.result?.targetUrl) {
      setVisualResult(null)
      setTechResult(item.result)
      setTechScanOptions(resolveHistoryScanOptions(item.result))
      setVisualScanState('skipped')
      setTechScanState('success')
      setActiveTab('tech')
      return
    }

    setVisualResult(item.result)
    setTechResult(null)
    setVisualScanState('success')
    setTechScanState('idle')
    setActiveTab('visual')
  }

  const clearResultState = () => {
    setVisualResult(null)
    setTechResult(null)
    setInputError('')
    setFigmaError('')
    setVisualScanState('idle')
    setTechScanState('idle')
    setVisualScanError('')
    setTechScanError('')
    setAiReview(null)
    setAiReviewState('idle')
    setScanStage('idle')
    setScanProgressEvent(null)
  }

  const resetToNewScan = () => {
    if (isScanning) return
    clearResultState()
    setUrl('')
    setFigmaUrl('')
    setIsWebUrlConfirmed(false)
    setHasWebUrlBlurred(false)
    setSelectedHistoryId('')
    setActiveTab('overview')
  }

  const handleUrlBlur = () => {
    confirmWebUrl()
  }

  const handleUrlConfirm = () => {
    confirmWebUrl()
  }

  const confirmWebUrl = () => {
    setHasWebUrlBlurred(true)
    const nextState = confirmWebUrlInput(url)
    setIsWebUrlConfirmed(nextState.isConfirmed)
    if (nextState.isConfirmed) {
      if (nextState.inputValue !== url.trim()) setUrl(nextState.inputValue)
      setInputError('')
    }
    return nextState
  }

  const handleDeleteHistory = (id) => {
    const nextItems = deleteHistoryItem(id)
    setHistoryItems(nextItems)
    if (selectedHistoryId === id) {
      clearResultState()
      setSelectedHistoryId('')
      setActiveTab('history')
    }
  }

  const workspaceContent = activeTab === 'history'
    ? (
      <HistoryPanel
        historyItems={historyItems}
        isScanning={isScanning}
        onDeleteHistory={handleDeleteHistory}
        onNewScan={resetToNewScan}
        onRestoreHistory={handleRestoreHistory}
      />
    ) : activeTab === 'tech'
      ? (techResult
        ? <TechQaPanel result={techResult} />
        : <EmptyState scanState={techScanState} scanError={techScanError} mode="tech" combined={visualScanState === 'loading'} scanStage={scanStage} scanProgressEvent={scanProgressEvent} />)
      : activeTab === 'visual' && visualResult
        ? (
          <VisualQaPanel
            result={visualResult}
            aiReview={aiReview}
            aiReviewState={aiReviewState}
            pageTitle={techResult?.pageTitle}
          />
        ) : activeTab === 'visual'
          ? <EmptyState scanState={visualScanState} scanError={visualScanError} mode="visual" combined={techScanState === 'loading'} scanStage={scanStage} scanProgressEvent={scanProgressEvent} />
          : <EmptyState scanState="idle" scanError="" mode="overview" combined={false} scanStage={scanStage} scanProgressEvent={scanProgressEvent} />

  const scanningContent = activeTab === 'tech' || visualScanState !== 'loading'
    ? <EmptyState scanState={techScanState} scanError={techScanError} mode="tech" combined={visualScanState === 'loading'} scanStage={scanStage} scanProgressEvent={scanProgressEvent} />
    : <EmptyState scanState={visualScanState} scanError={visualScanError} mode="visual" combined={techScanState === 'loading'} scanStage={scanStage} scanProgressEvent={scanProgressEvent} />

  if (isIdleStartView) {
    return (
      <QaStartScreen
        figmaError={figmaError}
        figmaUrl={figmaUrl}
        inputError={inputError || (hasWebUrlBlurred && url.trim() && !isWebUrlReady ? '공개 Web URL 형식을 확인해 주세요.' : '')}
        canStartScan={canStartWithWebUrl}
        isScanning={isScanning}
        isWebUrlReady={isWebUrlReady}
        techScanOptions={techScanOptions}
        url={url}
        onFigmaUrlChange={(value) => {
          setFigmaUrl(value)
          if (figmaError) setFigmaError('')
        }}
        onOpenHistory={() => setActiveTab('history')}
        onStartScan={handleStartScan}
        onTechScanOptionsChange={setTechScanOptions}
        onUrlBlur={handleUrlBlur}
        onUrlConfirm={handleUrlConfirm}
        onUrlChange={(value) => {
          setUrl(value)
          setIsWebUrlConfirmed(false)
          setHasWebUrlBlurred(false)
          if (!value.trim()) {
            setFigmaUrl('')
            setFigmaError('')
            setInputError('')
            return
          }
          if (inputError) setInputError('')
        }}
      />
    )
  }

  if (isScanning) {
    return (
      <main className="scanning-screen" aria-live="polite">
        {scanningContent}
      </main>
    )
  }

  return (
    <div className="result-shell">
      <header className="result-topbar">
        <WorkspaceTabs
          activeTab={activeTab}
          disabledTabs={{ visual: !isVisualTabEnabled, tech: !isTechTabEnabled }}
          onTabChange={handleTabChange}
        />
      </header>

      <main className="result-content" aria-live="polite">
        <div className={`workspace-content ${isEmptyResultView ? 'is-empty' : ''}`}>
          {workspaceContent}
        </div>
      </main>
    </div>
  )
}

async function requestAiReviewFromPayload(payload) {
  const response = await fetch('/api/ai-review/from-payload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ payload }),
  })
  const data = await readJsonResponse(response)
  if (!response.ok) throw new Error(data?.message || `AI Review 요청에 실패했습니다. (${response.status})`)
  return sanitizeAiReviewResponse(data)
}

function createLocalAiReviewFallback(error) {
  const message = error instanceof Error ? error.message : 'AI Review 요청에 실패했습니다.'
  return sanitizeAiReviewResponse({
    success: true,
    meta: { openAiCalled: false, fallbackUsed: true },
    review: {
      releaseDecision: 'caution',
      summary: 'AI 종합 검토를 완료하지 못해 규칙 기반 결과를 우선 표시합니다. Visual QA와 Tech QA 결과는 정상적으로 유지됩니다.',
      mustFix: [],
      verify: [{ category: 'tech', title: 'AI Review 재시도 필요', description: message, evidence: [], severity: 'warning' }],
      developerNotes: [{ category: 'tech', title: 'AI Review fallback', description: message, evidence: [], severity: 'check' }],
      visualDifferences: [],
      clientReplyDraft: '자동 QA 결과는 확인되었으나 AI 종합 검토는 일시적으로 완료하지 못했습니다. 규칙 기반 결과를 기준으로 우선 확인하겠습니다.',
    },
    error: { code: 'ai_review_request_failed', message },
  })
}

async function readJsonResponse(response) {
  try {
    return await response.json()
  } catch {
    return null
  }
}

function waitForResultReadyTransition({
  durationMs = SCAN_RESULT_READY_TRANSITION_MS,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
  timerRef = null,
} = {}) {
  return new Promise((resolve) => {
    if (timerRef && timerRef.current !== null) clearTimeoutFn(timerRef.current)
    const timerId = setTimeoutFn(() => {
      if (timerRef && timerRef.current === timerId) timerRef.current = null
      resolve()
    }, durationMs)
    if (timerRef) timerRef.current = timerId
  })
}

async function requestQaRun(webUrl, figmaUrl, scanOptions, onProgress) {
  try {
    return await requestQaRunStream({ webUrl, figmaUrl, scanOptions, onProgress })
  } catch (error) {
    if (!error?.fallbackToJson) throw error
  }

  const response = await fetch('/api/qa/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ webUrl, figmaUrl, scanOptions }),
  })
  const payload = await readJsonResponse(response)
  if (!response.ok) throw new Error(payload?.message || `통합 검사 요청에 실패했습니다. (${response.status})`)
  return {
    ...payload,
    webUrl,
    figmaUrl,
    shouldSaveCombined: Boolean(figmaUrl),
  }
}

function applyTechSessionState(tech, setResult, setState, setError) {
  setResult(tech.result)
  setState(tech.status)
  setError(tech.error || '')
}

function applyVisualSessionState(visual, setResult, setState, setError) {
  setResult(visual.result)
  setState(visual.status)
  setError(visual.error || '')
}

function createTechHistoryItem(result) {
  const techView = createTechQaViewModel(result)
  const techCounts = techView.issueCounts
  const totalIssueCount = techCounts.errorElementCount + techCounts.warningElementCount

  return {
    type: 'tech',
    id: `tech-${result.scannedAt}-${result.targetUrl}`,
    url: result.targetUrl,
    scannedAt: result.scannedAt,
    summary: createResultSummary(result),
    totalIssueCount,
    counts: {
      total: totalIssueCount,
      high: techCounts.errorElementCount,
      text: 0,
      style: 0,
      layout: 0,
      cta: 0,
      footer: 0,
      techError: techCounts.errorElementCount,
      techWarn: techCounts.warningElementCount,
    },
    topIssueSummaries: createTechTopIssueSummaries(result),
    result: createCompactTechResult(result),
  }
}

function createCombinedHistoryItem(session) {
  const createdAt = new Date().toISOString()
  const visualResult = session.visual.result
  const techResult = session.tech.result
  const visualSummary = visualResult ? createVisualSummary(visualResult) : session.visual.error
  const techSummary = techResult ? createResultSummary(techResult) : session.tech.error
  const visualCards = visualResult ? createVisualIssueCards(visualResult) : []
  const visualCounts = countIssueCards(visualCards)
  const techCounts = techResult ? createTechQaViewModel(techResult).issueCounts : { errorElementCount: 0, warningElementCount: 0 }
  const totalIssueCount = visualCounts.critical + visualCounts.warning + techCounts.errorElementCount + techCounts.warningElementCount

  return {
    type: 'combined',
    id: `combined-${createdAt}-${session.webUrl}`,
    url: session.webUrl,
    webUrl: session.webUrl,
    figmaUrl: session.figmaUrl,
    scannedAt: createdAt,
    createdAt,
    summary: createCombinedSummary(session, visualSummary, techSummary),
    totalIssueCount,
    counts: {
      total: totalIssueCount,
      high: visualCounts.critical + techCounts.errorElementCount,
      text: Number(visualResult?.comparison?.differenceCount || 0),
      style: Number(visualResult?.aiHints?.evidenceSummary?.content?.figmaImageCount || 0) + Number(visualResult?.aiHints?.evidenceSummary?.content?.webImageCount || 0),
      layout: Number(visualResult?.aiHints?.evidenceSummary?.sections?.totalCount || 0),
      cta: Number(visualResult?.aiHints?.evidenceSummary?.interactions?.primaryActionCount || 0) + Number(visualResult?.aiHints?.evidenceSummary?.interactions?.secondaryActionCount || 0),
      footer: 0,
      techError: techCounts.errorElementCount,
      techWarn: techCounts.warningElementCount,
    },
    topIssueSummaries: createCombinedTopIssueSummaries(visualCards, techResult, session),
    aiReview: sanitizeHistoryAiReview(session.aiReview),
    visual: {
      status: session.visual.status,
      summary: visualSummary,
      compactResult: visualResult ? createCompactVisualResult(visualResult) : null,
      error: session.visual.error || '',
    },
    tech: {
      status: session.tech.status,
      summary: techSummary,
      compactResult: techResult ? createCompactTechResult(techResult) : null,
      scanOptions: techResult ? normalizeTechScanOptions(techResult.scanOptions) : normalizeTechScanOptions(),
      error: session.tech.error || '',
    },
  }
}

function sanitizeHistoryAiReview(aiReview) {
  if (!aiReview || typeof aiReview !== 'object') return null
  const safe = sanitizeAiReviewResponse(aiReview)
  return {
    meta: {
      openAiCalled: safe.meta.openAiCalled,
      visionUsed: safe.meta.visionUsed,
      imageInputCount: safe.meta.imageInputCount,
      rawVisionCount: safe.meta.rawVisionCount,
      figmaImagePrepared: safe.meta.figmaImagePrepared,
      webImagePrepared: safe.meta.webImagePrepared,
      model: safe.meta.model,
      aiReviewDurationMs: safe.meta.aiReviewDurationMs,
      visionFailureReason: safe.meta.visionFailureReason,
      fallbackUsed: safe.meta.fallbackUsed,
    },
    review: safe.review,
  }
}

function createCombinedSummary(session, visualSummary, techSummary) {
  return `Visual QA ${formatSessionStatus(session.visual.status)} / Tech QA ${formatSessionStatus(session.tech.status)} · ${visualSummary || 'Visual 결과 없음'} · ${techSummary || 'Tech 결과 없음'}`
}

function createCombinedTopIssueSummaries(visualCards, techResult, session) {
  const summaries = []
  visualCards.slice(0, 2).forEach((card) => summaries.push(`Visual QA: ${card.title}`))
  if (techResult) summaries.push(...createTechTopIssueSummaries(techResult).slice(0, 2))
  if (!techResult && session.tech.error) summaries.push(`Tech QA 실패: ${session.tech.error}`)
  if (!session.visual.result && session.visual.error) summaries.push(`Visual QA 실패: ${session.visual.error}`)
  return summaries.slice(0, 3)
}

function formatSessionStatus(status) {
  if (status === 'success') return '성공'
  if (status === 'error') return '실패'
  if (status === 'skipped') return '미실행'
  return '대기'
}

function createTechTopIssueSummaries(result) {
  const summaries = createTechQaViewModel(result).priorityItems
    .map((item) => `Tech QA: ${item.title}`)
    .slice(0, 3)

  return summaries.length > 0 ? summaries : ['Tech QA 주요 항목 정상']
}

function createCompactTechResult(result) {
  return {
    targetUrl: result.targetUrl,
    scannedAt: result.scannedAt,
    durationMs: result.durationMs,
    pageTitle: result.pageTitle,
    httpStatus: result.httpStatus,
    accessible: result.accessible,
    navigationError: result.navigationError,
    checks: result.checks || [],
    links: Array.isArray(result.links) ? result.links : [],
    uncheckedLinkCount: result.uncheckedLinkCount || 0,
    missingHrefLinks: Array.isArray(result.missingHrefLinks) ? result.missingHrefLinks : [],
    images: Array.isArray(result.images) ? result.images : [],
    consoleMessages: Array.isArray(result.consoleMessages) ? result.consoleMessages : [],
    consoleAudit: result.consoleAudit || {},
    counts: result.counts || {},
    mobile: result.mobile || { viewport: { width: 0, height: 0 }, statusCode: null, note: '' },
    linkAudit: result.linkAudit || {},
    scanOptions: normalizeTechScanOptions(result.scanOptions),
    clickActions: Array.isArray(result.clickActions) ? result.clickActions : [],
    clickActionAudit: result.clickActionAudit || {},
    scrollInteractions: Array.isArray(result.scrollInteractions) ? result.scrollInteractions : [],
    scrollAudit: result.scrollAudit || {},
    responsiveLayouts: Array.isArray(result.responsiveLayouts) ? result.responsiveLayouts : [],
    responsiveAudit: result.responsiveAudit || {},
    downloadResources: Array.isArray(result.downloadResources) ? result.downloadResources : [],
    downloadAudit: result.downloadAudit || {},
    uiControlWithoutUrlCount: result.uiControlWithoutUrlCount || 0,
    ...(Array.isArray(result.cookieItems) || result.cookieAudit ? {
      cookieItems: Array.isArray(result.cookieItems) ? result.cookieItems : [],
      cookieAudit: result.cookieAudit || {},
    } : {}),
    ...(Array.isArray(result.imageItems) || result.imageAudit ? {
      imageItems: Array.isArray(result.imageItems) ? result.imageItems : [],
      imageAudit: result.imageAudit || {},
    } : {}),
    ...(Array.isArray(result.performanceItems) || result.performanceAudit ? {
      performanceItems: Array.isArray(result.performanceItems) ? result.performanceItems : [],
      performanceAudit: result.performanceAudit || {},
    } : {}),
    ...(Array.isArray(result.seoItems) || result.seoAudit ? {
      seoItems: Array.isArray(result.seoItems) ? result.seoItems : [],
      seoAudit: result.seoAudit || {},
    } : {}),
  }
}

function resolveHistoryScanOptions(result) {
  return normalizeStoredTechScanOptions(result?.scanOptions, result)
}

export default App
