import { useMemo, useState } from 'react'
import './App.css'
import { buildReportText, createResultSummary, getStatusCounts } from './utils/report'
import { compareDesignElements, parseFigmaJsonInput } from './utils/designQa'
import { loadHistoryItems, saveHistoryItem } from './utils/history'
import AuditHeader from './components/AuditHeader'
import CheckList from './components/CheckList'
import DetailPanel from './components/DetailPanel'
import EmptyState from './components/EmptyState'
import HistoryPanel from './components/HistoryPanel'
import InputPanel from './components/InputPanel'
import MockupQaPanel from './components/MockupQaPanel'
import SummaryCards from './components/SummaryCards'
import WorkspaceTabs from './components/WorkspaceTabs'

const AI_IMAGE_DATA_URL_MAX_LENGTH = 9_000_000

function isValidHttpUrl(value) {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

function App() {
  const [url, setUrl] = useState('')
  const [figmaJson, setFigmaJson] = useState('')
  const [figmaElements, setFigmaElements] = useState([])
  const [designImages, setDesignImages] = useState([])
  const [result, setResult] = useState(null)
  const [scanState, setScanState] = useState('idle')
  const [activeTab, setActiveTab] = useState('tech')
  const [inputError, setInputError] = useState('')
  const [figmaError, setFigmaError] = useState('')
  const [copyStatus, setCopyStatus] = useState('')
  const [scanError, setScanError] = useState('')
  const [historyItems, setHistoryItems] = useState(() => loadHistoryItems())
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false)
  const [aiQa, setAiQa] = useState({ state: 'idle', result: null, error: '', rawText: '' })

  const summary = useMemo(() => (result ? createResultSummary(result) : ''), [result])
  const statusCounts = useMemo(() => (result ? getStatusCounts(result.checks) : null), [result])
  const webElements = useMemo(() => result?.designElements || [], [result])
  const designQa = useMemo(() => compareDesignElements(figmaElements, webElements), [figmaElements, webElements])
  const isScanning = scanState === 'scanning'

  const handleFigmaTextChange = (value) => {
    setFigmaJson(value)
    updateFigmaElements(value)
  }

  const handleFigmaFileSelect = async (event) => {
    const file = event.target.files?.[0]
    if (!file) return

    try {
      const text = await readFileAsText(file)
      setFigmaJson(text)
      updateFigmaElements(text)
    } catch {
      setFigmaError('Figma JSON 파일을 읽지 못했습니다.')
    }
  }

  const handleDesignImagesSelect = async (event) => {
    const file = event.target.files?.[0]
    if (!file) return

    const image = {
      id: `${file.name}-${file.size}-${file.lastModified}`,
      name: file.name,
      size: file.size,
      previewUrl: await readFileAsDataUrl(file),
    }
    setDesignImages([image])
    event.target.value = ''
  }

  const handleDesignImageDelete = () => {
    setDesignImages([])
  }

  const handleStartScan = async () => {
    setCopyStatus('')
    setScanError('')
    setAiQa({ state: 'idle', result: null, error: '', rawText: '' })

    if (!isValidHttpUrl(url)) {
      setInputError('http:// 또는 https://로 시작하는 테스트 URL을 입력해 주세요.')
      setResult(null)
      setScanState('idle')
      return
    }

    setInputError('')
    setResult(null)
    setScanState('scanning')
    setActiveTab('tech')

    try {
      const response = await fetch('/api/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      })

      const payload = await response.json()

      if (!response.ok) {
        throw new Error(payload.message || '검사 요청에 실패했습니다.')
      }

      setResult(payload)
      setScanState('complete')
      setActiveTab('mockup')
      setHistoryItems(saveHistoryItem(createHistoryItem(payload, figmaElements, designImages)))
      const nextDesignQa = compareDesignElements(figmaElements, payload.designElements || [])
      await maybeRunAiQa({ scanResult: payload, nextDesignQa, force: false })
    } catch (error) {
      setScanError(error instanceof Error ? error.message : '검사 중 오류가 발생했습니다.')
      setScanState('failed')
    }
  }

  const handleRestoreHistory = (item) => {
    setUrl(item.url)
    if (!item.result) {
      setActiveTab('history')
      return
    }

    setResult(item.result)
    setFigmaJson('')
    setFigmaElements([])
    setDesignImages([])
    setScanState('complete')
    setInputError('')
    setFigmaError('')
    setScanError('')
    setCopyStatus('')
    setAiQa({ state: 'idle', result: null, error: '', rawText: '' })
    setActiveTab('mockup')
  }

  const handleCopyReport = async () => {
    if (!result) return

    const reportText = buildReportText(result, summary)

    try {
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(reportText)
      } else {
        const textarea = document.createElement('textarea')
        textarea.value = reportText
        textarea.setAttribute('readonly', '')
        textarea.style.position = 'fixed'
        textarea.style.opacity = '0'
        document.body.appendChild(textarea)
        textarea.select()
        document.execCommand('copy')
        document.body.removeChild(textarea)
      }
      setCopyStatus('리포트가 클립보드에 복사되었습니다.')
    } catch {
      setCopyStatus('복사에 실패했습니다. 브라우저 권한을 확인해 주세요.')
    }
  }

  const handleRunAiQa = async () => {
    await maybeRunAiQa({ scanResult: result, nextDesignQa: designQa, force: true })
  }

  const maybeRunAiQa = async ({ scanResult, nextDesignQa, force }) => {
    if (!scanResult) {
      setAiQa({ state: 'failed', result: null, error: '먼저 URL 검사를 실행한 뒤 AI QA를 사용할 수 있습니다.', rawText: '' })
      return
    }

    const resultKey = getAiResultKey(scanResult)
    if (!force && aiQa.resultKey === resultKey && aiQa.state !== 'idle') return
    if (!window.confirm('OpenAI API 크레딧이 소모됩니다. 진행할까요?')) {
      setAiQa({ state: 'skipped', result: null, error: 'AI 검수를 실행하지 않았습니다.', rawText: '', resultKey })
      return
    }

    setAiQa({ state: 'running', result: null, error: '', rawText: '', resultKey })

    const controller = new AbortController()
    const timeoutId = window.setTimeout(() => controller.abort(), 70000)

    try {
      const response = await fetch('/api/ai-qa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(createAiQaRequestPayload({ result: scanResult, figmaElements, webElements: scanResult.designElements || [], designImages, designQa: nextDesignQa })),
        signal: controller.signal,
      })
      const payload = await response.json().catch(() => ({}))

      if (!response.ok) {
        throw new Error(payload.message || 'AI QA 실행 중 오류가 발생했습니다.')
      }

      if (payload.parseError) {
        setAiQa({ state: 'failed', result: null, error: payload.message || 'AI 응답을 해석하지 못했습니다. 원문 응답을 확인해주세요.', rawText: payload.rawText || '', resultKey })
        return
      }

      setAiQa({ state: 'complete', result: payload.result, error: '', rawText: '', resultKey })
    } catch (error) {
      const message = error?.name === 'AbortError'
        ? 'AI QA 요청 시간이 초과되었습니다. 잠시 후 다시 시도해주세요.'
        : error instanceof Error ? error.message : '네트워크 오류로 AI QA를 실행하지 못했습니다.'
      setAiQa({ state: 'failed', result: null, error: message, rawText: '', resultKey })
    } finally {
      window.clearTimeout(timeoutId)
    }
  }

  function updateFigmaElements(value) {
    if (!value.trim()) {
      setFigmaElements([])
      setFigmaError('')
      return
    }

    try {
      const elements = parseFigmaJsonInput(value)
      setFigmaElements(elements)
      setFigmaError('')
    } catch {
      setFigmaElements([])
      setFigmaError('JSON 형식을 확인해 주세요. Figma REST 응답 또는 document 노드를 지원합니다.')
    }
  }

  return (
    <main className={`app-shell ${isSidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
      <InputPanel
        designImages={designImages}
        figmaError={figmaError}
        figmaJson={figmaJson}
        inputError={inputError}
        isCollapsed={isSidebarCollapsed}
        isScanning={isScanning}
        url={url}
        onDesignImagesSelect={handleDesignImagesSelect}
        onDesignImageDelete={handleDesignImageDelete}
        onFigmaFileSelect={handleFigmaFileSelect}
        onFigmaTextChange={handleFigmaTextChange}
        onToggleCollapsed={() => setIsSidebarCollapsed((value) => !value)}
        onStartScan={handleStartScan}
        onUrlChange={setUrl}
      />

      <section className="workspace" aria-live="polite">
        <WorkspaceTabs activeTab={activeTab} onTabChange={setActiveTab} />

        {activeTab === 'history' ? (
          <HistoryPanel historyItems={historyItems} onRestoreHistory={handleRestoreHistory} />
        ) : result ? (
          <>
            <AuditHeader
              copyStatus={copyStatus}
              result={result}
              summary={summary}
              onCopyReport={handleCopyReport}
            />
            {activeTab === 'tech' ? (
              <>
                <SummaryCards counts={statusCounts} result={result} />
                <CheckList checks={result.checks} />
                <DetailPanel result={result} />
              </>
            ) : null}
            {activeTab === 'mockup' ? (
              <MockupQaPanel
                aiQa={aiQa}
                designImages={designImages}
                designQa={designQa}
                figmaElements={figmaElements}
                result={result}
                webElements={webElements}
                onRunAiQa={handleRunAiQa}
              />
            ) : null}
          </>
        ) : (
          <EmptyState scanState={scanState} scanError={scanError} />
        )}
      </section>
    </main>
  )
}

function createHistoryItem(result, figmaElements, designImages) {
  const techCounts = getStatusCounts(result.checks)
  const designQa = compareDesignElements(figmaElements, result.designElements || [])
  const techIssueCount = techCounts.error + techCounts.warn
  const counts = {
    total: techIssueCount + designQa.summaryCounts.total,
    high: techCounts.error + designQa.summaryCounts.high,
    text: designQa.summaryCounts.text,
    style: designQa.summaryCounts.style,
    layout: designQa.summaryCounts.layout,
    cta: designQa.summaryCounts.cta,
    footer: designQa.summaryCounts.footer,
    techError: techCounts.error,
    techWarn: techCounts.warn,
  }

  return {
    id: `${result.scannedAt}-${result.targetUrl}`,
    url: result.targetUrl,
    scannedAt: result.scannedAt,
    totalIssueCount: counts.total,
    counts,
    topIssueSummaries: createTopIssueSummaries(result, designQa),
    designImageFilenames: designImages.map((image) => image.name).filter(Boolean),
  }
}

function createTopIssueSummaries(result, designQa) {
  const designSummaries = designQa.topIssues.map((issue) => `${issue.sectionName}: ${issue.label}`)
  const techSummaries = result.checks
    .filter((check) => check.status !== 'ok')
    .map((check) => `Tech QA: ${check.title}`)
  const summaries = [...designSummaries, ...techSummaries].slice(0, 3)

  return summaries.length > 0 ? summaries : ['Tech QA와 시안 비교 QA 주요 항목 정상']
}

function createAiQaRequestPayload({ result, figmaElements, webElements, designImages, designQa }) {
  return {
    pageTitle: result.pageTitle || '',
    url: result.targetUrl || '',
    figma: {
      texts: createAiElementSummary(figmaElements.filter((element) => !isAiButtonElement(element) && !isAiReferenceElement(element)), 60),
      buttons: createAiElementSummary(figmaElements.filter(isAiButtonElement), 30),
      image: createAiImagePayload({
        name: designImages[0]?.name || 'Figma 시안 이미지',
        dataUrl: designImages[0]?.previewUrl || '',
      }),
    },
    web: {
      texts: createAiElementSummary(webElements.filter((element) => !isAiButtonElement(element) && !isAiReferenceElement(element)), 60),
      buttons: createAiElementSummary(webElements.filter(isAiButtonElement), 30),
      links: createAiLinkSummary(result),
      screenshot: createAiImagePayload({
        name: 'Web 1920 캡처',
        width: result.webScreenshot?.width,
        height: result.webScreenshot?.height,
        dataUrl: result.webScreenshot?.dataUrl || '',
      }),
    },
    localIssues: createAiIssueSummary(designQa),
  }
}

function createAiElementSummary(elements, limit) {
  return elements.slice(0, limit).map((element) => ({
    text: cleanAiText(element.text || element.label || element.name || ''),
    compareText: cleanAiText(element.compareText || element.normalizedText || ''),
    sectionLabel: cleanAiText(element.sectionLabel || element.sectionName || element.region || ''),
    qaGroupId: cleanAiText(element.qaGroupId || ''),
    href: cleanAiText(element.href || ''),
    positionRatio: getAiPositionRatio(element.positionRatio),
  })).filter((element) => element.text || element.compareText)
}

function createAiLinkSummary(result) {
  const links = [
    ...(Array.isArray(result.links) ? result.links : []),
    ...(Array.isArray(result.missingHrefLinks) ? result.missingHrefLinks : []),
  ]

  return links.slice(0, 40).map((link) => ({
    label: cleanAiText(link.label || link.text || ''),
    href: cleanAiText(link.href || ''),
    url: cleanAiText(link.url || ''),
    status: cleanAiText(link.status || link.statusText || ''),
  })).filter((link) => link.label || link.href || link.url)
}

function createAiIssueSummary(designQa = {}) {
  const issues = [
    ...(Array.isArray(designQa.primaryIssues) ? designQa.primaryIssues : []),
    ...(Array.isArray(designQa.referenceIssues) ? designQa.referenceIssues.slice(0, 5) : []),
  ]

  return issues.slice(0, 20).map((issue) => ({
    type: cleanAiText(issue.label || issue.issueType || ''),
    area: cleanAiText(issue.sectionName || issue.region || ''),
    title: cleanAiText(issue.itemTitle || issue.text || ''),
    figma: cleanAiText(issue.figma?.text || ''),
    web: cleanAiText(issue.web?.text || ''),
    qaGroupId: cleanAiText(issue.qaGroupId || ''),
  }))
}

function createAiImagePayload(image) {
  const dataUrl = typeof image.dataUrl === 'string' && image.dataUrl.length <= AI_IMAGE_DATA_URL_MAX_LENGTH ? image.dataUrl : ''
  return {
    name: image.name || '',
    width: image.width || null,
    height: image.height || null,
    dataUrl,
  }
}

function isAiButtonElement(element) {
  const tag = String(element?.tag || '').toLowerCase()
  const text = `${element?.text || ''} ${element?.layerPath || ''}`
  return tag === 'button'
    || tag === 'a'
    || element?.qaImportance === 'button'
    || /button|btn|cta|link|버튼|자세히|더 보기|더보기|바로가기|신청|구매|상담|예약|문의/i.test(text)
}

function isAiReferenceElement(element) {
  return Boolean(element?.isReferenceOnly || element?.isNavigation || element?.isFooterDisclaimer)
}

function getAiPositionRatio(value) {
  if (value && typeof value === 'object') return Number.isFinite(Number(value.yRatio)) ? Number(value.yRatio) : null
  return Number.isFinite(Number(value)) ? Number(value) : null
}

function cleanAiText(value) {
  const text = String(value || '').replace(/\s+/g, ' ').trim()
  return text.length > 240 ? `${text.slice(0, 240)}...` : text
}

function getAiResultKey(result) {
  return `${result?.targetUrl || ''}:${result?.scannedAt || ''}`
}

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(reader.error)
    reader.readAsText(file)
  })
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

export default App
