import { formatScanTime } from '../utils/report'

function AuditHeader({ result, summary, copyStatus, onCopyReport }) {
  return (
    <header className="audit-header">
      <div className="audit-header-top">
        <div>
          <p className="eyebrow">Playwright QA Report · {formatScanTime(result.scannedAt)}</p>
          <h2>{result.pageTitle || '페이지 타이틀 없음'}</h2>
          <p className="target-url">{result.targetUrl}</p>
        </div>
        <button className="secondary-button" type="button" onClick={onCopyReport}>
          결과 복사
        </button>
      </div>
      <div className="summary-box">{summary}</div>
      {copyStatus ? <p className="copy-status">{copyStatus}</p> : null}
    </header>
  )
}

export default AuditHeader
