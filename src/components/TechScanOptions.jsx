import { useState } from 'react'
import { TECH_SCAN_OPTION_DEFINITIONS, TECH_SCAN_OPTION_KEYS, areAllTechScanOptionsSelected } from '../../shared/techScanOptions.js'

const TECH_SCAN_OPTION_GROUPS = Object.freeze([
  { title: '페이지 및 이동', optionKeys: Object.freeze(['url', 'click', 'landing']) },
  { title: '기능 및 인터랙션', optionKeys: Object.freeze(['form', 'hover', 'modal']) },
  { title: '화면 및 리소스', optionKeys: Object.freeze(['scroll', 'responsive', 'download']) },
  { title: '콘텐츠 및 데이터', optionKeys: Object.freeze(['cookie', 'image']) },
  { title: '품질 및 검색', optionKeys: Object.freeze(['performance', 'seo', 'markup']) },
])

const TECH_SCAN_OPTION_DEFINITIONS_BY_KEY = Object.freeze(TECH_SCAN_OPTION_DEFINITIONS.reduce((map, option) => {
  map[option.key] = option
  return map
}, {}))

function TechScanOptions({ isScanning, techScanOptions, onTechScanOptionsChange }) {
  const [isTechOptionsOpen, setIsTechOptionsOpen] = useState(false)
  const [openOptionGroups, setOpenOptionGroups] = useState(() => TECH_SCAN_OPTION_GROUPS.reduce((groups, group) => {
    groups[group.title] = false
    return groups
  }, {}))
  const allSelected = areAllTechScanOptionsSelected(techScanOptions)

  const handleToggleAll = (checked) => {
    onTechScanOptionsChange(TECH_SCAN_OPTION_KEYS.reduce((nextOptions, key) => {
      nextOptions[key] = checked
      return nextOptions
    }, {}))
  }

  const handleToggleOption = (key, checked) => {
    onTechScanOptionsChange({
      ...techScanOptions,
      [key]: checked,
    })
  }

  const handleToggleGroup = (optionKeys, checked) => {
    onTechScanOptionsChange({
      ...techScanOptions,
      ...optionKeys.reduce((nextOptions, key) => {
        nextOptions[key] = checked
        return nextOptions
      }, {}),
    })
  }

  const handleTechOptionsSummaryClick = (event) => {
    event.preventDefault()
    if (isScanning) return
    setIsTechOptionsOpen((value) => !value)
  }

  const handleOptionGroupSummaryClick = (event, groupTitle) => {
    event.preventDefault()
    if (isScanning) return
    setOpenOptionGroups((groups) => ({
      ...groups,
      [groupTitle]: !groups[groupTitle],
    }))
  }

  const handleGroupCheckboxClick = (event) => {
    event.stopPropagation()
  }

  const handleGroupCheckboxKeyDown = (event) => {
    event.stopPropagation()
  }

  return (
    <details className="tech-scan-options" aria-label="Tech QA 옵션" open={isTechOptionsOpen}>
      <summary onClick={handleTechOptionsSummaryClick}>
        <span className="tech-scan-options-summary-copy">
          <strong>Tech QA 옵션</strong>
        </span>
      </summary>
      <div className="tech-scan-options-body">
        <label className="tech-scan-option-row is-disabled" htmlFor="tech-scan-option-basic">
          <input
            id="tech-scan-option-basic"
            type="checkbox"
            checked
            disabled
            readOnly
          />
          <span>주요 검사</span>
        </label>
        <div className="tech-scan-options-divider" aria-hidden="true" />
        <div className="tech-scan-option-groups">
          {TECH_SCAN_OPTION_GROUPS.map((group) => {
            const isGroupChecked = group.optionKeys.some((key) => techScanOptions[key] === true)
            return (
              <details className="tech-scan-option-group" key={group.title} open={Boolean(openOptionGroups[group.title])}>
                <summary className="tech-scan-option-group-summary" onClick={(event) => handleOptionGroupSummaryClick(event, group.title)}>
                  <input
                    id={`tech-scan-option-group-${group.title}`}
                    className="tech-scan-group-checkbox"
                    type="checkbox"
                    checked={isGroupChecked}
                    disabled={isScanning}
                    aria-label={`${group.title} 선택`}
                    onClick={handleGroupCheckboxClick}
                    onKeyDown={handleGroupCheckboxKeyDown}
                    onChange={(event) => handleToggleGroup(group.optionKeys, event.target.checked)}
                  />
                  <span className="tech-scan-option-group-title">{group.title}</span>
                  <span className="tech-scan-option-group-chevron" aria-hidden="true" />
                </summary>
                <div className="tech-scan-option-group-body">
                  {group.optionKeys.map((optionKey) => {
                    const option = TECH_SCAN_OPTION_DEFINITIONS_BY_KEY[optionKey]
                    if (!option) return null
                    return (
                      <label className="tech-scan-option-row" htmlFor={`tech-scan-option-${option.key}`} key={option.key}>
                        <input
                          id={`tech-scan-option-${option.key}`}
                          type="checkbox"
                          checked={techScanOptions[option.key] === true}
                          disabled={isScanning}
                          onChange={(event) => handleToggleOption(option.key, event.target.checked)}
                        />
                        <span>{option.label}</span>
                      </label>
                    )
                  })}
                </div>
              </details>
            )
          })}
        </div>
        <div className="tech-scan-options-divider" aria-hidden="true" />
        <label className="tech-scan-option-row tech-scan-option-toggle-row" htmlFor="tech-scan-option-all">
          <span>모두 선택</span>
          <input
            id="tech-scan-option-all"
            type="checkbox"
            checked={allSelected}
            disabled={isScanning}
            onChange={(event) => handleToggleAll(event.target.checked)}
          />
        </label>
      </div>
    </details>
  )
}

export default TechScanOptions
