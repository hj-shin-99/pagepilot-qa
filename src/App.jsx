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
