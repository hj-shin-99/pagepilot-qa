import { formatScanTime } from '../utils/report'

function AuditHeader({ result, summary }) {
  return (
    <header className="audit-header">
      <div className="audit-header-top">
        <div>
          <p className="eyebrow">Playwright QA Report · {formatScanTime(result.scannedAt)}</p>
          <h2>{result.pageTitle || '페이지 타이틀 없음'}</h2>
          <p className="target-url">{result.targetUrl}</p>
        </div>
      </div>
      <div className="summary-box">{summary}</div>
    </header>
  )
}

export default AuditHeader
