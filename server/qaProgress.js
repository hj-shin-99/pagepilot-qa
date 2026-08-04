import { normalizeTechScanOptions, TECH_SCAN_OPTION_KEYS } from '../shared/techScanOptions.js'
import { getDeviceProfile, normalizeDeviceIds } from '../shared/deviceProfiles.js'

export const QA_PROGRESS_STAGES = Object.freeze({
  WEB_COLLECT: 'web_collect',
  PAGE_STRUCTURE: 'page_structure',
  TECH_AUDIT: 'tech_audit',
  VISUAL_COLLECT: 'visual_collect',
  VISUAL_COMPARE: 'visual_compare',
  RESULT_PREPARE: 'result_prepare',
})

const BASE_PROGRESS_UNITS = Object.freeze([
  { key: 'web_collect', stage: QA_PROGRESS_STAGES.WEB_COLLECT, scope: 'web', message: 'Web 페이지 정보를 수집하고 있습니다.' },
  { key: 'page_structure', stage: QA_PROGRESS_STAGES.PAGE_STRUCTURE, scope: 'web', message: '페이지 구조를 확인하고 있습니다.' },
])

const VISUAL_PROGRESS_UNITS = Object.freeze([
  { key: 'visual_figma_node', stage: QA_PROGRESS_STAGES.VISUAL_COLLECT, scope: 'visual:figma-node', message: 'Figma 시안 구조를 수집하고 있습니다.' },
  { key: 'visual_figma_render', stage: QA_PROGRESS_STAGES.VISUAL_COLLECT, scope: 'visual:figma-render', message: 'Figma 시안 이미지를 준비하고 있습니다.' },
  { key: 'visual_compare', stage: QA_PROGRESS_STAGES.VISUAL_COMPARE, scope: 'visual:compare', message: '레이아웃과 콘텐츠를 비교하고 있습니다.' },
  { key: 'visual_payload', stage: QA_PROGRESS_STAGES.VISUAL_COMPARE, scope: 'visual:payload', message: '비교 기준 데이터를 생성하고 있습니다.' },
])

const FINAL_PROGRESS_UNIT = Object.freeze({
  key: 'result_prepare',
  stage: QA_PROGRESS_STAGES.RESULT_PREPARE,
  scope: 'result',
  message: '검사 결과를 준비하고 있습니다.',
})

const TECH_PROGRESS_OPTION_KEYS = Object.freeze([
  'markup',
  'click',
  'landing',
  'form',
  'hover',
  'modal',
  'scroll',
  'responsive',
  'download',
  'cookie',
  'image',
  'performance',
  'seo',
  'url',
])

export function createQaProgressPlan({ figmaUrl = '', scanOptions, devices } = {}) {
  const normalizedScanOptions = normalizeTechScanOptions(scanOptions)
  const normalizedDevices = normalizeDeviceIds(devices)
  const techUnitKeys = TECH_PROGRESS_OPTION_KEYS
    .filter((key) => TECH_SCAN_OPTION_KEYS.includes(key))
    .filter((key) => normalizedScanOptions[key] === true)
  const deviceUnits = normalizedDevices.flatMap((deviceId) => {
    const profile = getDeviceProfile(deviceId)
    return BASE_PROGRESS_UNITS.map((unit) => ({
      ...unit,
      key: `${deviceId}:${unit.key}`,
      deviceId,
      deviceLabel: profile.label,
      message: normalizedDevices.length > 1 ? `${profile.label} 환경의 ${unit.message}` : unit.message,
    })).concat(techUnitKeys.map((key) => ({
      key: `${deviceId}:tech_${key}`,
      stage: QA_PROGRESS_STAGES.TECH_AUDIT,
      scope: `tech:${key}`,
      deviceId,
      deviceLabel: profile.label,
      message: normalizedDevices.length > 1 ? `${profile.label} 환경의 선택한 Tech QA 항목을 점검하고 있습니다.` : '선택한 Tech QA 항목을 점검하고 있습니다.',
    })))
  })

  const units = [
    ...deviceUnits,
    ...(figmaUrl ? VISUAL_PROGRESS_UNITS : []),
    FINAL_PROGRESS_UNIT,
  ]

  return {
    units,
    totalUnits: units.length,
    unitKeys: units.map((unit) => unit.key),
  }
}

export function createQaProgressReporter({ figmaUrl = '', scanOptions, devices, onProgress } = {}) {
  const plan = createQaProgressPlan({ figmaUrl, scanOptions, devices })
  const unitsByKey = new Map(plan.units.map((unit) => [unit.key, unit]))
  const completedKeys = new Set()
  let started = false

  function emitStart() {
    if (started) return
    started = true
    const firstUnit = plan.units[0]
    if (!firstUnit) return
    emitQaProgress(onProgress, {
      type: 'progress',
      stage: firstUnit.stage,
      scope: firstUnit.scope,
      completedUnits: 0,
      totalUnits: plan.totalUnits,
      message: firstUnit.message,
      deviceId: firstUnit.deviceId,
      deviceLabel: firstUnit.deviceLabel,
    })
  }

  function complete(unitKey, overrides = {}) {
    const normalizedUnitKey = unitsByKey.has(unitKey) ? unitKey : `desktop:${unitKey}`
    const unit = unitsByKey.get(normalizedUnitKey)
    if (!unit || completedKeys.has(normalizedUnitKey)) return
    completedKeys.add(normalizedUnitKey)
    emitQaProgress(onProgress, {
      type: 'progress',
      stage: unit.stage,
      scope: unit.scope,
      completedUnits: completedKeys.size,
      totalUnits: plan.totalUnits,
      message: unit.message,
      ...overrides,
    })
  }

  return {
    plan,
    emitStart,
    complete,
  }
}

export function emitQaProgress(onProgress, event) {
  if (typeof onProgress !== 'function') return
  try {
    if (typeof event === 'string') {
      onProgress(event)
      return
    }
    onProgress(event)
  } catch {
    // Progress reporting must never alter scan results.
  }
}
