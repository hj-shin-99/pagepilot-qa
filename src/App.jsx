import { useMemo, useState } from 'react'
import './App.css'
import { buildReportText, createResultSummary, getStatusCounts } from './utils/report'
import AuditHeader from './components/AuditHeader'
import CheckList from './components/CheckList'
import DetailPanel from './components/DetailPanel'
import EmptyState from './components/EmptyState'
import InputPanel from './components/InputPanel'
import SummaryCards from './components/SummaryCards'

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
  const [result, setResult] = useState(null)
  const [scanState, setScanState] = useState('idle')
  const [inputError, setInputError] = useState('')
  const [copyStatus, setCopyStatus] = useState('')
  const [scanError, setScanError] = useState('')

  const summary = useMemo(() => (result ? createResultSummary(result) : ''), [result])
  const statusCounts = useMemo(() => (result ? getStatusCounts(result.checks) : null), [result])
  const isScanning = scanState === 'scanning'

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
    } catch (error) {
      setScanError(error instanceof Error ? error.message : '검사 중 오류가 발생했습니다.')
      setScanState('failed')
    }
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

  return (
    <main className="app-shell">
      <InputPanel
        url={url}
        inputError={inputError}
        isScanning={isScanning}
        onUrlChange={setUrl}
        onStartScan={handleStartScan}
      />

      <section className="workspace" aria-live="polite">
        {result ? (
          <>
            <AuditHeader
              copyStatus={copyStatus}
              result={result}
              summary={summary}
              onCopyReport={handleCopyReport}
            />
            <SummaryCards counts={statusCounts} result={result} />
            <CheckList checks={result.checks} />
            <DetailPanel result={result} />
          </>
        ) : (
          <EmptyState scanState={scanState} scanError={scanError} />
        )}
      </section>
    </main>
  )
}

export default App
