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

const MAX_HISTORY_IMAGES = 50
const MAX_HISTORY_CONSOLE_MESSAGES = 50
const MAX_HISTORY_MISSING_HREFS = 50
const MAX_HISTORY_FIGMA_ELEMENTS = 120
const MAX_HISTORY_DESIGN_ELEMENTS = 120

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
    const files = Array.from(event.target.files || [])
    if (files.length === 0) return

    const images = await Promise.all(files.map(async (file) => ({
      id: `${file.name}-${file.size}-${file.lastModified}`,
      name: file.name,
      size: file.size,
      previewUrl: await readFileAsDataUrl(file),
    })))
    setDesignImages(images)
  }

  const handleStartScan = async () => {
    setCopyStatus('')
    setScanError('')

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
    } catch (error) {
      setScanError(error instanceof Error ? error.message : '검사 중 오류가 발생했습니다.')
      setScanState('failed')
    }
  }

  const handleRestoreHistory = (item) => {
    setUrl(item.url)
    setResult(item.result)
    setFigmaJson(item.inputs?.figmaJson || '')
    setFigmaElements(item.inputs?.figmaElements || [])
    setDesignImages(item.inputs?.designImages || [])
    setScanState('complete')
    setInputError('')
    setFigmaError('')
    setScanError('')
    setCopyStatus('')
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
    <main className="app-shell">
      <InputPanel
        designImages={designImages}
        figmaError={figmaError}
        figmaJson={figmaJson}
        inputError={inputError}
        isScanning={isScanning}
        url={url}
        onDesignImagesSelect={handleDesignImagesSelect}
        onFigmaFileSelect={handleFigmaFileSelect}
        onFigmaTextChange={handleFigmaTextChange}
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
                designImages={designImages}
                designQa={designQa}
                figmaElements={figmaElements}
                result={result}
                webElements={webElements}
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
  const counts = {
    normal: techCounts.ok + designQa.counts.ok,
    error: techCounts.error + designQa.counts.error,
    warn: techCounts.warn + designQa.counts.warn,
  }

  return {
    id: `${result.scannedAt}-${result.targetUrl}`,
    url: result.targetUrl,
    scannedAt: result.scannedAt,
    counts,
    issueSummary: createIssueSummary(result, designQa),
    result: createHistoryResult(result),
    inputs: {
      figmaJson: '',
      figmaElements: figmaElements.slice(0, MAX_HISTORY_FIGMA_ELEMENTS),
      designImages: designImages.map(createHistoryImageMetadata),
    },
  }
}

function createHistoryResult(result) {
  return {
    ...result,
    missingHrefLinks: result.missingHrefLinks.slice(0, MAX_HISTORY_MISSING_HREFS),
    images: result.images.slice(0, MAX_HISTORY_IMAGES),
    consoleMessages: result.consoleMessages.slice(0, MAX_HISTORY_CONSOLE_MESSAGES),
    designElements: (result.designElements || []).slice(0, MAX_HISTORY_DESIGN_ELEMENTS),
    webScreenshot: createHistoryScreenshotMetadata(result.webScreenshot),
  }
}

function createHistoryScreenshotMetadata(webScreenshot) {
  if (!webScreenshot || typeof webScreenshot !== 'object') return null

  return {
    mediaType: webScreenshot.mediaType || 'image/png',
    width: webScreenshot.width || 0,
    height: webScreenshot.height || 0,
    viewport: webScreenshot.viewport || null,
    fullPage: Boolean(webScreenshot.fullPage),
    capturedAt: webScreenshot.capturedAt || '',
    error: webScreenshot.error || '',
  }
}

function createHistoryImageMetadata(image) {
  return {
    id: image.id,
    name: image.name,
    size: image.size,
  }
}

function createIssueSummary(result, designQa) {
  const techIssue = result.checks.find((check) => check.status !== 'ok')
  const designIssue = designQa.issues.find((issue) => issue.status !== 'ok')

  if (techIssue && designIssue) return `${techIssue.title} · ${designIssue.label}`
  if (techIssue) return techIssue.title
  if (designIssue) return designIssue.label
  return 'Tech QA와 시안 비교 QA 주요 항목 정상'
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
