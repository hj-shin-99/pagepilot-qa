import { useMemo, useState } from 'react'
import './App.css'
import { buildReportText, createResultSummary, getStatusCounts } from './utils/report'
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

const AI_IMAGE_DATA_URL_MAX_LENGTH = 50_000_000
const AI_TEXT_HINT_LIMIT = 100
const AI_TEXT_HINT_MAX_LENGTH = 160
const AI_MOCKUP_QA_TIMEOUT_MS = 180000

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
  const [figmaCtaHints, setFigmaCtaHints] = useState([])
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
      setActiveTab('mockup')

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
      setHistoryItems(saveHistoryItem(createHistoryItem(payload, designImages)))
      await maybeRunAiQa({ scanResult: payload, force: false })
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
    setFigmaCtaHints([])
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
    await maybeRunAiQa({ scanResult: result, force: true })
  }

  const maybeRunAiQa = async ({ scanResult, force }) => {
    if (!scanResult) {
      setAiQa({ state: 'failed', result: null, error: '먼저 URL 검사를 실행한 뒤 AI QA를 사용할 수 있습니다.', rawText: '' })
      return
    }

    const resultKey = getAiResultKey(scanResult)
    if (!force && aiQa.resultKey === resultKey && aiQa.state !== 'idle') return

    setAiQa({ state: 'running', result: null, error: '', rawText: '', resultKey })

    const controller = new AbortController()
    const timeoutId = window.setTimeout(() => controller.abort(), AI_MOCKUP_QA_TIMEOUT_MS)

    try {
      const response = await fetch('/api/ai-mockup-qa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(createAiMockupQaRequestPayload({ result: scanResult, figmaElements, figmaCtaHints, webElements: scanResult.designElements || [], designImages })),
        signal: controller.signal,
      })
      console.log('[Mockup AI QA Front] response received')

      let payload
      try {
        payload = await response.json()
      } catch {
        if (!response.ok) {
          throw new AiQaRequestError('http_error', `AI QA HTTP 오류가 발생했습니다. (${response.status})`)
        }
        throw new AiQaRequestError('json_parse_error', 'AI QA 응답 JSON을 해석하지 못했습니다. 서버 응답 형식을 확인해주세요.')
      }
      console.log('[Mockup AI QA Front] parsed result', payload?.result || payload)

      if (!response.ok) {
        throw new AiQaRequestError('http_error', payload?.message || `AI QA HTTP 오류가 발생했습니다. (${response.status})`)
      }

      if (payload.parseError) {
        setAiQa({ state: 'failed', result: null, error: payload.message || 'AI 응답을 해석하지 못했습니다. 원문 응답을 확인해주세요.', rawText: payload.rawText || '', resultKey })
        return
      }

      const aiResult = normalizeAiMockupQaFrontendResult(payload.result)
      aiResult.model = payload.model || payload.result?.model || ''
      setAiQa({ state: 'complete', result: aiResult, error: '', rawText: '', resultKey })
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
      setFigmaCtaHints([])
      setFigmaError('')
      return
    }

    try {
      const texts = extractFigmaTextHints(value)
      const ctaHints = extractFigmaCtaHints(value)
      setFigmaElements(texts)
      setFigmaCtaHints(ctaHints)
      setFigmaError('')
    } catch {
      setFigmaElements([])
      setFigmaCtaHints([])
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
                figmaHintCount={figmaElements.length}
                result={result}
                webHintCount={(result.designElements || []).length}
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

function createHistoryItem(result, designImages) {
  const techCounts = getStatusCounts(result.checks)
  const techIssueCount = techCounts.error + techCounts.warn
  const counts = {
    total: techIssueCount,
    high: techCounts.error,
    text: 0,
    style: 0,
    layout: 0,
    cta: 0,
    footer: 0,
    techError: techCounts.error,
    techWarn: techCounts.warn,
  }

  return {
    id: `${result.scannedAt}-${result.targetUrl}`,
    url: result.targetUrl,
    scannedAt: result.scannedAt,
    totalIssueCount: counts.total,
    counts,
    topIssueSummaries: createTopIssueSummaries(result),
    designImageFilenames: designImages.map((image) => image.name).filter(Boolean),
  }
}

function createTopIssueSummaries(result) {
  const techSummaries = result.checks
    .filter((check) => check.status !== 'ok')
    .map((check) => `Tech QA: ${check.title}`)
  const summaries = techSummaries.slice(0, 3)

  return summaries.length > 0 ? summaries : ['Tech QA 주요 항목 정상']
}

function createAiMockupQaRequestPayload({ result, figmaElements, figmaCtaHints, webElements, designImages }) {
  return {
    pageTitle: result.pageTitle || '',
    url: result.targetUrl || '',
    webScreenshotDataUrl: createAiImageDataUrl(result.webScreenshot?.dataUrl || ''),
    figmaImageDataUrl: createAiImageDataUrl(designImages[0]?.previewUrl || ''),
    figmaTexts: createAiTextHints(figmaElements),
    webTexts: createAiTextHints(webElements),
    figmaCtaHints: Array.isArray(figmaCtaHints) ? figmaCtaHints : [],
    webCtaHints: Array.isArray(result.webCtaHints) ? result.webCtaHints : [],
  }
}

function cleanAiText(value) {
  const text = String(value || '').replace(/\s+/g, ' ').trim()
  return text.length > AI_TEXT_HINT_MAX_LENGTH ? `${text.slice(0, AI_TEXT_HINT_MAX_LENGTH)}...` : text
}

function createAiTextHints(elements) {
  const seen = new Set()
  const hints = []

  elements.forEach((element) => {
    const text = cleanAiText(typeof element === 'string' ? element : element?.text || element?.label || element?.name || '')
    if (!text || seen.has(text)) return
    seen.add(text)
    hints.push(text)
  })

  return hints.slice(0, AI_TEXT_HINT_LIMIT)
}

function createAiImageDataUrl(dataUrl) {
  return typeof dataUrl === 'string' && dataUrl.length <= AI_IMAGE_DATA_URL_MAX_LENGTH ? dataUrl : ''
}

function extractFigmaTextHints(value) {
  const parsed = JSON.parse(value)
  const hints = []
  const seen = new Set()

  function addText(text) {
    const cleaned = cleanAiText(text)
    if (!cleaned || seen.has(cleaned) || hints.length >= AI_TEXT_HINT_LIMIT) return
    seen.add(cleaned)
    hints.push(cleaned)
  }

  function visit(node, parentHidden = false) {
    if (!node || typeof node !== 'object' || hints.length >= AI_TEXT_HINT_LIMIT) return

    if (Array.isArray(node)) {
      node.forEach((child) => visit(child, parentHidden))
      return
    }

    const hidden = parentHidden || isHiddenFigmaJsonNode(node)
    if (hidden) return

    if (node.type === 'TEXT' && hasUsableFigmaJsonBox(node)) {
      if (typeof node.characters === 'string') addText(node.characters)
      if (typeof node.text === 'string') addText(node.text)
      if (typeof node.name === 'string') addText(node.name)
    }

    if (Array.isArray(node.children)) node.children.forEach((child) => visit(child, hidden))
    if (node.document) visit(node.document, hidden)
    if (node.nodes) visit(node.nodes, hidden)
  }

  visit(parsed)
  return hints
}

function extractFigmaCtaHints(value) {
  const parsed = JSON.parse(value)
  const candidates = []
  const visibleBounds = []
  const seen = new Set()

  function visit(node, context = { hidden: false, layerPath: [] }) {
    if (!node || typeof node !== 'object') return

    if (Array.isArray(node)) {
      node.forEach((child) => visit(child, context))
      return
    }

    const hidden = context.hidden || isHiddenFigmaJsonNode(node)
    if (hidden) return

    const name = cleanAiText(node.name || node.title || '')
    const layerPath = [...context.layerPath, name || node.type || 'Layer'].filter(Boolean)
    const box = getFigmaJsonBox(node)
    if (box) visibleBounds.push(box)

    const text = cleanAiText(typeof node.characters === 'string' ? node.characters : node.text || node.label || '')
    const pathText = layerPath.join(' / ')
    if (text && box && isFigmaCtaCandidate(text, pathText)) {
      const key = `${normalizeCtaCompareText(text)}:${pathText}`
      if (!seen.has(key)) {
        seen.add(key)
        candidates.push({ text, layerPath: pathText, y: box.y })
      }
    }

    if (Array.isArray(node.children)) node.children.forEach((child) => visit(child, { hidden, layerPath }))
    if (node.document) visit(node.document, { hidden, layerPath })
    if (node.nodes) visit(node.nodes, { hidden, layerPath })
  }

  visit(parsed)
  const pageHeight = Math.max(...visibleBounds.map((box) => box.y + box.height), 1)
  return candidates.slice(0, 40).map((candidate) => {
    const yRatio = Math.max(0, Math.min(1, candidate.y / pageHeight))
    return {
      text: candidate.text,
      area: getAreaFromYRatio(yRatio),
      layerPath: candidate.layerPath,
      yRatio: Math.round(yRatio * 1000) / 1000,
    }
  })
}

function getFigmaJsonBox(node) {
  const box = node.absoluteBoundingBox || node.absoluteRenderBounds || node.bounds || null
  if (!box || Number(box.width) <= 0 || Number(box.height) <= 0) return null
  return {
    y: Number(box.y) || 0,
    height: Number(box.height) || 0,
  }
}

function isFigmaCtaCandidate(text, layerPath) {
  return /button|btn|cta|basic-button|link-button/i.test(layerPath)
    || /바로가기|신청|상담|예약|프로모션|자세히|구매/i.test(text)
}

function normalizeCtaCompareText(value) {
  return String(value || '').toLowerCase().replace(/[\s\u00a0.,:;!?'"“”‘’()[\]{}<>_/\\-]/g, '')
}

function getAreaFromYRatio(value) {
  if (value < 0.33) return 'top'
  if (value < 0.66) return 'middle'
  return 'bottom'
}

function isHiddenFigmaJsonNode(node) {
  if (node.visible === false) return true
  if (Number(node.opacity) === 0) return true
  return false
}

function hasUsableFigmaJsonBox(node) {
  const box = node.absoluteBoundingBox || node.absoluteRenderBounds || null
  if (!box) return false
  return Number(box.width) > 0 && Number(box.height) > 0
}

function getAiResultKey(result) {
  return `${result?.targetUrl || ''}:${result?.scannedAt || ''}`
}

function normalizeAiMockupQaFrontendResult(result) {
  if (!result || typeof result !== 'object') {
    throw new AiQaRequestError('normalize_error', 'AI QA 결과 형식이 올바르지 않습니다.')
  }

  const issues = Array.isArray(result.issues) ? result.issues : []
  const summary = result.summary && typeof result.summary === 'object' ? result.summary : {}

  return { ...result, summary, issues }
}

class AiQaRequestError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'AiQaRequestError'
    this.code = code
  }
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
