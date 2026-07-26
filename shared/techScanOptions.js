export const TECH_SCAN_OPTION_DEFINITIONS = Object.freeze([
  { key: 'url', label: 'URL 검사', checkIds: ['links', 'missing-href', 'bad-links', 'interaction-count'] },
  { key: 'click', label: '클릭 동작 검사', checkIds: ['click-actions'] },
  { key: 'landing', label: '랜딩 페이지 검사', checkIds: ['landing-pages'] },
  { key: 'form', label: 'Form QA', checkIds: ['form-interaction'] },
  { key: 'hover', label: 'Hover / Dropdown QA', checkIds: ['hover-interaction'] },
  { key: 'modal', label: 'Modal QA', checkIds: ['modal-interaction'] },
  { key: 'scroll', label: 'Scroll QA', checkIds: ['scroll-interaction'] },
  { key: 'responsive', label: 'Responsive QA', checkIds: ['responsive-layout'] },
  { key: 'download', label: 'Download QA', checkIds: ['download-resource'] },
  { key: 'cookie', label: 'Cookie QA', checkIds: ['cookie-security'] },
  { key: 'image', label: 'Image QA', checkIds: ['image-rendering'] },
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
  scroll: true,
  responsive: true,
  download: true,
  cookie: true,
  image: true,
  markup: true,
})

const LEGACY_TECH_SCAN_OPTION_KEYS = Object.freeze(['url', 'click', 'landing', 'form', 'hover', 'modal', 'markup'])
const NEW_TECH_SCAN_OPTION_KEYS = Object.freeze(TECH_SCAN_OPTION_KEYS.filter((key) => !LEGACY_TECH_SCAN_OPTION_KEYS.includes(key)))
const OPTION_RESULT_FIELDS = Object.freeze({
  click: ['clickActions', 'clickActionAudit'],
  landing: ['landingPages', 'landingAudit'],
  form: ['formInteractions', 'formAudit'],
  hover: ['hoverInteractions', 'hoverAudit'],
  modal: ['modalInteractions', 'modalAudit'],
  scroll: ['scrollInteractions', 'scrollAudit'],
  responsive: ['responsiveLayouts', 'responsiveAudit'],
  download: ['downloadResources', 'downloadAudit'],
  cookie: ['cookieItems', 'cookieAudit'],
  image: ['imageItems', 'imageAudit'],
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

export function normalizeStoredTechScanOptions(value, result = {}) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : null
  if (!source) {
    return TECH_SCAN_OPTION_KEYS.reduce((normalized, key) => {
      normalized[key] = LEGACY_TECH_SCAN_OPTION_KEYS.includes(key) ? true : hasStoredResultForOption(result, key)
      return normalized
    }, {})
  }

  return TECH_SCAN_OPTION_KEYS.reduce((normalized, key) => {
    if (typeof source[key] === 'boolean') {
      normalized[key] = source[key]
      return normalized
    }
    if (!Object.prototype.hasOwnProperty.call(source, key) && NEW_TECH_SCAN_OPTION_KEYS.includes(key)) {
      normalized[key] = false
      return normalized
    }
    normalized[key] = true
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

function hasStoredResultForOption(result = {}, optionKey = '') {
  const definition = TECH_SCAN_OPTION_DEFINITIONS.find((item) => item.key === optionKey)
  if (!definition) return false
  const checks = Array.isArray(result.checks) ? result.checks : []
  if (definition.checkIds.some((checkId) => checks.some((check) => check.id === checkId))) return true

  return (OPTION_RESULT_FIELDS[optionKey] || []).some((field) => {
    const value = result[field]
    if (Array.isArray(value)) return value.length > 0
    return Boolean(value && typeof value === 'object' && Object.keys(value).length > 0)
  })
}
