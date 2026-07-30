export const SCAN_RESULT_READY_TRANSITION_MS = 450
export const SCAN_STAGE_VISIBLE_ROW_COUNT = 3
export const SCAN_STAGE_TRANSITION_MS = 720

const COMBINED_SCAN_STAGES = [
  'Web 페이지와 시안 정보를 수집하고 있습니다.',
  '레이아웃과 콘텐츠를 비교하고 있습니다.',
  '선택한 Tech QA 항목을 점검하고 있습니다.',
  'AI가 차이점을 분석하고 있습니다.',
  '검사 결과를 준비하고 있습니다.',
]

const TECH_SCAN_STAGES = [
  'Web 페이지 정보를 수집하고 있습니다.',
  '페이지 구조를 확인하고 있습니다.',
  '선택한 Tech QA 항목을 점검하고 있습니다.',
  '검사 결과를 준비하고 있습니다.',
]

const VISUAL_SCAN_STAGES = [
  '시안 화면을 준비하고 있습니다.',
  'Web 화면을 수집하고 있습니다.',
  '비교 기준 데이터를 생성하고 있습니다.',
]

export function getScanningStages({ isTech, combined }) {
  if (combined) return COMBINED_SCAN_STAGES
  return isTech ? TECH_SCAN_STAGES : VISUAL_SCAN_STAGES
}

export function getActiveScanningStageIndex({ isTech, combined, scanStage }) {
  if (combined) {
    if (scanStage === 'ai-review') return 3
    if (scanStage === 'finalizing') return 4
    if (scanStage === 'visual-compare') return 1
    if (scanStage === 'tech-audit') return 2
    return 0
  }

  if (scanStage === 'finalizing') return isTech ? 3 : 2
  if (scanStage === 'page-structure') return isTech ? 1 : 0
  if (scanStage === 'tech-audit') return isTech ? 2 : 0
  return 0
}

export function getStageRollOffset(activeStageIndex) {
  return Math.max(activeStageIndex, 0)
}

export function getNextDisplayedScanningStageIndex({ displayedActiveStageIndex, actualActiveStageIndex }) {
  if (displayedActiveStageIndex < actualActiveStageIndex) return displayedActiveStageIndex + 1
  if (displayedActiveStageIndex > actualActiveStageIndex) return actualActiveStageIndex
  return displayedActiveStageIndex
}

export function getStageClassName(index, activeStageIndex) {
  if (index === activeStageIndex) return 'is-current'
  if (index < activeStageIndex) return 'is-before'
  return 'is-after'
}

export function getScanningProgressValue({ activeStageIndex, stagesLength, scanStage }) {
  if (stagesLength <= 0) return 0
  if (scanStage === 'finalizing') return 100

  const lastNonFinalStageIndex = Math.max(stagesLength - 2, 0)
  const normalizedStagePosition = lastNonFinalStageIndex === 0
    ? 0
    : Math.min(Math.max(activeStageIndex, 0), lastNonFinalStageIndex) / lastNonFinalStageIndex

  return Math.min(Math.round(10 + normalizedStagePosition * 84), 94)
}

export function getScanningProgressValueFromEvent(progressEvent) {
  const completedUnits = Number(progressEvent?.completedUnits)
  const totalUnits = Number(progressEvent?.totalUnits)
  if (!Number.isFinite(completedUnits) || !Number.isFinite(totalUnits) || totalUnits <= 0) return null
  return Math.min(Math.max(Math.round((completedUnits / totalUnits) * 94), 0), 94)
}

export function getScanStageFromQaProgressEvent(progressEvent, { combined } = {}) {
  switch (progressEvent?.stage) {
    case 'page_structure':
      return combined ? 'qa-run' : 'page-structure'
    case 'tech_audit':
      return 'tech-audit'
    case 'visual_compare':
      return 'visual-compare'
    case 'result_prepare':
      return 'finalizing'
    case 'web_collect':
    case 'visual_collect':
    default:
      return combined ? 'qa-run' : 'tech-run'
  }
}

export function getScanningResultReadyTransitionMs({ isTech, combined }) {
  const finalStageIndex = Math.max(getScanningStages({ isTech, combined }).length - 1, 0)
  return finalStageIndex * SCAN_STAGE_TRANSITION_MS + SCAN_RESULT_READY_TRANSITION_MS
}
