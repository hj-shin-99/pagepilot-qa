import { formatScanTime } from '../utils/report'
import { getDeviceProfile, normalizeDeviceIds } from '../../shared/deviceProfiles.js'

function HistoryPanel({ historyItems, isScanning = false, selectedHistoryId = '', onClearHistory, onDeleteHistory, onNewScan, onRestoreHistory }) {
  const handleDelete = (event, item) => {
    event.stopPropagation()
    onDeleteHistory(item.id)
  }

  const handleClearHistory = () => {
    if (!historyItems.length) return
    if (typeof window !== 'undefined' && !window.confirm('저장된 검사 기록을 모두 삭제할까요?')) return
    onClearHistory()
  }

  return (
    <section className="detail-card history-panel-card" aria-label="검사 히스토리">
      <div className="history-toolbar">
        <div>
          <h3>검사 기록</h3>
          <p>최근 검사 기록을 최대 5개까지 저장합니다. 초과한 기록은 오래된 순서대로 자동 삭제됩니다.</p>
        </div>
        <div className="history-toolbar-actions">
          {historyItems.length > 0 ? <button className="history-clear-button" type="button" disabled={isScanning} onClick={handleClearHistory}>모두 삭제</button> : null}
          <button className="secondary-button history-new-scan-button" type="button" disabled={isScanning} onClick={onNewScan}>새 검사</button>
        </div>
      </div>
      <ul className="history-list compact-history-list">
        {historyItems.length > 0 ? historyItems.map((item) => (
          <li className={`history-row compact-history-row ${item.id === selectedHistoryId ? 'is-selected' : ''}`} key={item.id}>
            <button className="history-restore-button" type="button" onClick={() => onRestoreHistory(item)}>
              <span className="history-item-title">{formatHistoryType(item.type)}</span>
              <span className="history-url">{item.url}</span>
              <span className="history-summary-list" aria-label="히스토리 기본 정보">
                <span>검사 일시 {formatScanTime(item.scannedAt)}</span>
                <span>검사 환경 {formatHistoryDevices(item)}</span>
                {item.totalDurationMs ? <span>총 검사 시간 {formatDuration(item.totalDurationMs)}</span> : null}
              </span>
            </button>
            <div className="history-actions">
              <button className="history-delete-button" type="button" aria-label="검사 기록 삭제" title="삭제" onClick={(event) => handleDelete(event, item)}>삭제</button>
            </div>
          </li>
        )) : <li className="empty-row">저장된 검사 기록이 없습니다.<br />검사를 실행하면 결과가 이곳에 저장됩니다.</li>}
      </ul>
    </section>
  )
}

function formatHistoryType(type) {
  if (type === 'combined') return 'Visual + Tech QA'
  if (type === 'visual') return 'Visual QA'
  return 'Tech QA'
}

function formatHistoryDevices(item = {}) {
  return normalizeDeviceIds(item.devices).map((deviceId) => getDeviceProfile(deviceId).label).join(' · ')
}

function formatDuration(value) {
  const ms = Number(value)
  if (!Number.isFinite(ms) || ms <= 0) return '-'
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}초` : `${Math.round(ms)}ms`
}

export default HistoryPanel
