import { formatScanTime } from '../utils/report'
import StatusChip from './StatusChip'

function HistoryPanel({ historyItems, isScanning = false, onDeleteHistory, onNewScan, onRestoreHistory }) {
  const handleDelete = (event, item) => {
    event.stopPropagation()
    if (typeof window !== 'undefined' && !window.confirm('이 검사 기록을 삭제할까요?')) return
    onDeleteHistory(item.id)
  }

  return (
    <section className="detail-card history-panel-card" aria-label="검사 히스토리">
      <div className="history-toolbar">
        <div>
          <h3>검사 기록</h3>
          <p>저장된 QA 결과를 다시 확인할 수 있습니다.</p>
        </div>
        <button className="secondary-button history-new-scan-button" type="button" disabled={isScanning} onClick={onNewScan}>새 검사</button>
      </div>
      <ul className="history-list compact-history-list">
        {historyItems.length > 0 ? historyItems.map((item) => (
          <li className="history-row compact-history-row" key={item.id}>
            <button className="history-restore-button" type="button" onClick={() => onRestoreHistory(item)}>
              <span className="history-item-title">{formatHistoryType(item.type)} 결과</span>
              <span className="history-url">{item.url}</span>
              <span className="history-meta">{formatScanTime(item.scannedAt)}</span>
              <span className="history-meta">전체 {item.totalIssueCount} · Critical/오류 {item.counts.high} · 문구 확인 {item.counts.text} · 디자인 확인 {item.counts.style + item.counts.layout} · 버튼 확인 {item.counts.cta}</span>
              {item.type === 'visual' || item.type === 'combined' ? <span className="history-meta">Figma Frame: {item.figmaUrl || '저장된 URL 없음'}</span> : null}
              {item.summary ? <span className="history-meta">{item.summary}</span> : null}
              <span className="history-summary-list">
                {item.topIssueSummaries.map((summary, index) => <span key={`${item.id}-${index}-${summary}`}>{summary}</span>)}
              </span>
            </button>
            <div className="history-statuses" aria-label="히스토리 상태 요약">
              <StatusChip status={item.counts.high > 0 ? 'error' : item.counts.total > 0 ? 'warn' : 'ok'} />
              <button className="history-delete-button" type="button" aria-label="검사 기록 삭제" title="삭제" onClick={(event) => handleDelete(event, item)}>삭제</button>
            </div>
          </li>
        )) : <li className="empty-row">아직 저장된 검사가 없습니다. Visual QA 또는 Tech QA를 완료하면 최근 결과가 로컬에 저장됩니다.</li>}
      </ul>
    </section>
  )
}

function formatHistoryType(type) {
  if (type === 'combined') return 'Visual + Tech QA'
  if (type === 'visual') return 'Visual QA'
  return 'Tech QA'
}

export default HistoryPanel
