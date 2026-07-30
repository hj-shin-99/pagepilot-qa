export const SCAN_RESULT_READY_TRANSITION_MS = 450
export const SCAN_STAGE_VISIBLE_ROW_COUNT = 3
export const SCAN_STAGE_TRANSITION_MS = 720

const COMBINED_SCAN_STAGES = [
  'Web 페이지와 검사 데이터를 수집하고 있습니다.',
  '시안 정보와 Web 데이터를 비교하고 있습니다.',
  '구조와 콘텐츠의 차이를 검증하고 있습니다.',
  'AI가 확인된 차이를 최종 검토하고 있습니다.',
  '최종 QA 결과를 정리하고 있습니다.',
]

const TECH_SCAN_STAGES = [
  'Web 페이지 정보를 수집하고 있습니다.',
  '페이지 구조와 주요 기능을 검사하고 있습니다.',
  '선택한 Tech QA 항목을 분석하고 있습니다.',
  '최종 QA 결과를 정리하고 있습니다.',
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
    return 0
  }

  if (scanStage === 'finalizing') return isTech ? 3 : 2
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

export function getScanningResultReadyTransitionMs({ isTech, combined }) {
  const finalStageIndex = Math.max(getScanningStages({ isTech, combined }).length - 1, 0)
  return finalStageIndex * SCAN_STAGE_TRANSITION_MS + SCAN_RESULT_READY_TRANSITION_MS
}
