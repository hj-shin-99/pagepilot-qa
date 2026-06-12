import { statusLabels } from '../utils/report'

function StatusChip({ status }) {
  return <span className={`status-chip status-${status}`}>{statusLabels[status]}</span>
}

export default StatusChip
