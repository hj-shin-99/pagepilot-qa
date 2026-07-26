import { TECH_SCAN_OPTION_DEFINITIONS, TECH_SCAN_OPTION_KEYS, areAllTechScanOptionsSelected } from '../../shared/techScanOptions.js'

function InputPanel({
  url,
  figmaUrl,
  inputError,
  figmaError,
  isCollapsed,
  isScanning,
  techScanOptions,
  onUrlChange,
  onFigmaUrlChange,
  onStartScan,
  onTechScanOptionsChange,
  onToggleCollapsed,
}) {
  const allSelected = areAllTechScanOptionsSelected(techScanOptions)

  const handleSubmit = (event) => {
    event.preventDefault()
    onStartScan()
  }

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

  return (
    <aside className={`control-panel ${isCollapsed ? 'is-collapsed' : ''}`}>
      <div className="sidebar-topbar">
        {isCollapsed ? null : (
          <div className="brand-mark">
            <span className="brand-version">v0.3</span>
          </div>
        )}
        <button
          className="sidebar-toggle-button"
          type="button"
          onClick={onToggleCollapsed}
          aria-label={isCollapsed ? '사이드바 열기' : '사이드바 접기'}
          title={isCollapsed ? '사이드바 열기' : '사이드바 접기'}
        >
          <span className="sidebar-toggle-icon" aria-hidden="true" />
        </button>
      </div>
      {isCollapsed ? null : (
        <div className="sidebar-content">
          <div className="sidebar-intro">
            <h1>PagePilot QA</h1>
            <p className="sidebar-description">
              <strong>AI 기반 Web QA 플랫폼</strong>
              <span>Web 페이지의 기술 품질을 점검하고, Figma 시안과 실제 화면의 콘텐츠·디자인 차이를 AI로 함께 검수합니다.</span>
            </p>
          </div>

          <form className="scan-form sidebar-input-section" onSubmit={handleSubmit}>
            <label className="field-label" htmlFor="target-url">
              Web URL
            </label>
            <input
              id="target-url"
              className={`url-input scan-input ${url ? 'has-value' : ''}`}
              type="url"
              value={url}
              placeholder="https://staging.example.com/page"
              disabled={isScanning}
              onChange={(event) => onUrlChange(event.target.value)}
            />
            {inputError ? <p className="input-error">{inputError}</p> : null}

            <label className="field-label" htmlFor="figma-frame-url">
              Figma URL <span className="field-label-note">Visual QA용</span>
            </label>
            <input
              id="figma-frame-url"
              className={`url-input scan-input ${figmaUrl ? 'has-value' : ''}`}
              type="url"
              value={figmaUrl}
              placeholder="https://www.figma.com/design/...?...node-id=..."
              disabled={isScanning}
              onChange={(event) => onFigmaUrlChange(event.target.value)}
            />
            {figmaError ? <p className="input-error">{figmaError}</p> : null}

            <details className="tech-scan-options" aria-label="Tech QA 옵션">
              <summary onClick={isScanning ? (event) => event.preventDefault() : undefined}>
                <span>Tech QA 옵션</span>
              </summary>
              <div className="tech-scan-options-body">
                <label className="tech-scan-option-row" htmlFor="tech-scan-option-all">
                  <input
                    id="tech-scan-option-all"
                    type="checkbox"
                    checked={allSelected}
                    disabled={isScanning}
                    onChange={(event) => handleToggleAll(event.target.checked)}
                  />
                  <span>전체 선택</span>
                </label>
                {TECH_SCAN_OPTION_DEFINITIONS.map((option) => (
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
                ))}
              </div>
            </details>

            <button className="primary-button" type="submit" disabled={isScanning}>
              {isScanning ? '검사 중...' : '검사 시작'}
            </button>
          </form>
        </div>
      )}
    </aside>
  )
}

export default InputPanel
