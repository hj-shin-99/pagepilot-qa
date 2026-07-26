export const TECH_SCAN_OPTION_DEFINITIONS = Object.freeze([
  { key: 'url', label: 'URL 검사', checkIds: ['links', 'missing-href', 'bad-links', 'interaction-count'] },
  { key: 'click', label: '클릭 동작 검사', checkIds: ['click-actions'] },
  { key: 'landing', label: '랜딩 페이지 검사', checkIds: ['landing-pages'] },
  { key: 'form', label: 'Form QA', checkIds: ['form-interaction'] },
  { key: 'hover', label: 'Hover / Dropdown QA', checkIds: ['hover-interaction'] },
  { key: 'modal', label: 'Modal QA', checkIds: ['modal-interaction'] },
  { key: 'markup', label: '마크업 및 접근성 검사', checkIds: ['meta', 'image-alt', 'forms', 'external-links', 'duplicate-ids', 'headings', 'unlabeled-clickables'] },
])

export const TECH_SCAN_OPTION_KEYS = Object.freeze(TECH_SCAN_OPTION_DEFINITIONS.map((definition) => definition.key))

export const DEFAULT_TECH_SCAN_OPTIONS = Object.freeze({
  url: true,
  click: true,
  landing: true,
  form: true,
  hover: true,
  modal: true,
  markup: true,
})

const CHECK_ID_TO_OPTION_KEY = Object.freeze(TECH_SCAN_OPTION_DEFINITIONS.reduce((map, definition) => {
  definition.checkIds.forEach((checkId) => {
    map[checkId] = definition.key
  })
  return map
}, {}))

export function createDefaultTechScanOptions() {
  return { ...DEFAULT_TECH_SCAN_OPTIONS }
}

export function normalizeTechScanOptions(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : null
  return TECH_SCAN_OPTION_KEYS.reduce((normalized, key) => {
    normalized[key] = typeof source?.[key] === 'boolean' ? source[key] : true
    return normalized
  }, {})
}

export function areAllTechScanOptionsSelected(value) {
  const normalized = normalizeTechScanOptions(value)
  return TECH_SCAN_OPTION_KEYS.every((key) => normalized[key] === true)
}

export function getTechScanOptionKeyForCheck(checkId = '') {
  return CHECK_ID_TO_OPTION_KEY[String(checkId || '')] || ''
}

export function isTechCheckEnabled(checkId = '', value) {
  const optionKey = getTechScanOptionKeyForCheck(checkId)
  if (!optionKey) return true
  return normalizeTechScanOptions(value)[optionKey] === true
}
