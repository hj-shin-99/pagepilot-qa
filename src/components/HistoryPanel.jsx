import { formatScanTime } from '../utils/report'
import StatusChip from './StatusChip'

function HistoryPanel({ historyItems, onRestoreHistory }) {
  return (
    <section className="detail-card" aria-label="검사 히스토리">
      <div className="section-title-row">
        <h3>최근 검사 히스토리</h3>
        <span>{historyItems.length}개 저장</span>
      </div>
      <ul className="history-list">
        {historyItems.length > 0 ? historyItems.map((item) => (
          <li className="history-row" key={item.id}>
            <button type="button" onClick={() => onRestoreHistory(item)}>
              <span className="history-url">{item.url}</span>
              <span className="history-meta">{formatScanTime(item.scannedAt)} · 정상 {item.counts.normal} · 오류 {item.counts.error} · 확인 {item.counts.warn}</span>
              <span className="history-meta">시안 이미지: {formatDesignImageNames(item.inputs?.designImages)}</span>
              <span className="history-summary">{item.issueSummary}</span>
            </button>
            <div className="history-statuses" aria-label="히스토리 상태 요약">
              <StatusChip status={item.counts.error > 0 ? 'error' : item.counts.warn > 0 ? 'warn' : 'ok'} />
            </div>
          </li>
        )) : <li className="empty-row">아직 저장된 검사가 없습니다. URL 검사를 완료하면 최근 결과가 로컬에 저장됩니다.</li>}
      </ul>
    </section>
  )
}

function formatDesignImageNames(designImages = []) {
  if (designImages.length === 0) return '없음'
  return designImages.map((image) => image.name).filter(Boolean).join(', ')
}

export default HistoryPanel
