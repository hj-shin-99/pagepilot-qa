import { formatScanTime } from '../utils/report'
import StatusChip from './StatusChip'

function HistoryPanel({ historyItems, onRestoreHistory }) {
  return (
    <section className="detail-card" aria-label="검사 히스토리">
      <div className="section-title-row">
        <h3>최근 검사 히스토리</h3>
        <span>{historyItems.length}개 저장 · 이미지 원본 미저장</span>
      </div>
      <ul className="history-list compact-history-list">
        {historyItems.length > 0 ? historyItems.map((item) => (
          <li className="history-row compact-history-row" key={item.id}>
            <button type="button" onClick={() => onRestoreHistory(item)}>
              <span className="history-url">{item.url}</span>
              <span className="history-meta">
                {formatScanTime(item.scannedAt)} · 전체 {item.totalIssueCount} · High {item.counts.high} · 텍스트 {item.counts.text} · 스타일 {item.counts.style} · 위치 {item.counts.layout} · CTA {item.counts.cta}
              </span>
              <span className="history-meta">시안 이미지 파일명: {formatDesignImageNames(item.designImageFilenames)}</span>
              <span className="history-summary-list">
                {item.topIssueSummaries.map((summary, index) => <span key={`${item.id}-${index}-${summary}`}>{summary}</span>)}
              </span>
            </button>
            <div className="history-statuses" aria-label="히스토리 상태 요약">
              <StatusChip status={item.counts.high > 0 ? 'error' : item.counts.total > 0 ? 'warn' : 'ok'} />
            </div>
          </li>
        )) : <li className="empty-row">아직 저장된 검사가 없습니다. URL 검사를 완료하면 최근 요약 결과만 로컬에 저장됩니다.</li>}
      </ul>
    </section>
  )
}

function formatDesignImageNames(filenames = []) {
  if (filenames.length === 0) return '없음'
  return filenames.join(', ')
}

export default HistoryPanel
