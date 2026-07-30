import test from 'node:test'
import assert from 'node:assert/strict'
import {
  getActiveScanningStageIndex,
  getNextDisplayedScanningStageIndex,
  getScanningResultReadyTransitionMs,
  getScanningProgressValue,
  getScanningStages,
  getStageClassName,
  getStageRollOffset,
  SCAN_RESULT_READY_TRANSITION_MS,
  SCAN_STAGE_VISIBLE_ROW_COUNT,
  SCAN_STAGE_TRANSITION_MS,
} from './scanningStages.js'

test('builds detailed tech stages instead of one macro status', () => {
  assert.deepEqual(getScanningStages({ isTech: true, combined: false }), [
    'Web 페이지 정보를 수집하고 있습니다.',
    '페이지 구조를 확인하고 있습니다.',
    '선택한 Tech QA 항목을 점검하고 있습니다.',
    '검사 결과를 준비하고 있습니다.',
  ])
})

test('builds detailed combined stages with actual ai-review and finalizing slots', () => {
  assert.deepEqual(getScanningStages({ isTech: false, combined: true }), [
    'Web 페이지와 시안 정보를 수집하고 있습니다.',
    '레이아웃과 콘텐츠를 비교하고 있습니다.',
    '선택한 Tech QA 항목을 점검하고 있습니다.',
    'AI가 차이점을 분석하고 있습니다.',
    '검사 결과를 준비하고 있습니다.',
  ])
})

test('maps active stage index only from frontend scanStage signals', () => {
  assert.equal(getActiveScanningStageIndex({ isTech: true, combined: false, scanStage: 'tech-run' }), 0)
  assert.equal(getActiveScanningStageIndex({ isTech: true, combined: false, scanStage: 'finalizing' }), 3)
  assert.equal(getActiveScanningStageIndex({ isTech: false, combined: true, scanStage: 'qa-run' }), 0)
  assert.equal(getActiveScanningStageIndex({ isTech: false, combined: true, scanStage: 'ai-review' }), 3)
  assert.equal(getActiveScanningStageIndex({ isTech: false, combined: true, scanStage: 'finalizing' }), 4)
})

test('keeps a three-row rolling viewport centered around the active stage when possible', () => {
  assert.equal(SCAN_STAGE_VISIBLE_ROW_COUNT, 3)
  assert.equal(getStageRollOffset(0), 0)
  assert.equal(getStageRollOffset(1), 1)
  assert.equal(getStageRollOffset(3), 3)
})

test('moves displayed active stage one step toward the actual target without jumping ahead', () => {
  assert.equal(getNextDisplayedScanningStageIndex({ displayedActiveStageIndex: 0, actualActiveStageIndex: 3 }), 1)
  assert.equal(getNextDisplayedScanningStageIndex({ displayedActiveStageIndex: 1, actualActiveStageIndex: 3 }), 2)
  assert.equal(getNextDisplayedScanningStageIndex({ displayedActiveStageIndex: 3, actualActiveStageIndex: 3 }), 3)
  assert.equal(getNextDisplayedScanningStageIndex({ displayedActiveStageIndex: 3, actualActiveStageIndex: 1 }), 1)
})

test('marks the current row distinctly without fake advancing state', () => {
  assert.equal(getStageClassName(1, 2), 'is-before')
  assert.equal(getStageClassName(2, 2), 'is-current')
  assert.equal(getStageClassName(3, 2), 'is-after')
})

test('calculates determinate progress from active stage and caps below finalizing', () => {
  assert.equal(getScanningProgressValue({ activeStageIndex: 0, stagesLength: 5, scanStage: 'qa-run' }), 10)
  assert.equal(getScanningProgressValue({ activeStageIndex: 2, stagesLength: 5, scanStage: 'qa-run' }), 66)
  assert.equal(getScanningProgressValue({ activeStageIndex: 3, stagesLength: 5, scanStage: 'ai-review' }), 94)
  assert.equal(getScanningProgressValue({ activeStageIndex: 4, stagesLength: 5, scanStage: 'qa-run' }), 94)
  assert.equal(getScanningProgressValue({ activeStageIndex: 4, stagesLength: 5, scanStage: 'finalizing' }), 100)
})

test('keeps fast result handoff long enough for one-step displayed catch-up plus final hold', () => {
  assert.equal(SCAN_STAGE_TRANSITION_MS, 720)
  assert.equal(getScanningResultReadyTransitionMs({ isTech: true, combined: false }), 3 * SCAN_STAGE_TRANSITION_MS + SCAN_RESULT_READY_TRANSITION_MS)
  assert.equal(getScanningResultReadyTransitionMs({ isTech: false, combined: true }), 4 * SCAN_STAGE_TRANSITION_MS + SCAN_RESULT_READY_TRANSITION_MS)
})

test('keeps result transition inside the requested short handoff window', () => {
  assert.equal(SCAN_RESULT_READY_TRANSITION_MS >= 350, true)
  assert.equal(SCAN_RESULT_READY_TRANSITION_MS <= 600, true)
})
