function InputPanel({
  url,
  figmaUrl,
  inputError,
  figmaError,
  isCollapsed,
  isScanning,
  onUrlChange,
  onFigmaUrlChange,
  onStartScan,
  onToggleCollapsed,
}) {
  const handleSubmit = (event) => {
    event.preventDefault()
    onStartScan()
  }

  return (
    <aside className={`control-panel ${isCollapsed ? 'is-collapsed' : ''}`}>
      <div className="sidebar-topbar">
        {isCollapsed ? null : (
          <div className="brand-mark">
            <span className="brand-dot" aria-hidden="true" />
            PagePilot QA
          </div>
        )}
        <button className="sidebar-toggle-button" type="button" onClick={onToggleCollapsed}>
          {isCollapsed ? '열기' : '접기'}
        </button>
      </div>
      {isCollapsed ? null : (
        <div className="sidebar-content">
          <div className="sidebar-intro">
            <h1>PagePilot QA v0.3</h1>
            <p className="sidebar-description">Web 페이지의 기술 품질을 점검하고, Figma 시안과 실제 화면의 콘텐츠·디자인 차이를 AI로 함께 검수합니다.</p>
          </div>

          <form className="scan-form sidebar-input-section" onSubmit={handleSubmit}>
            <label className="field-label" htmlFor="target-url">
              Web URL
            </label>
            <input
              id="target-url"
              className="url-input"
              type="url"
              value={url}
              placeholder="https://staging.example.com/page"
              onChange={(event) => onUrlChange(event.target.value)}
            />
            {inputError ? <p className="input-error">{inputError}</p> : null}

            <label className="field-label" htmlFor="figma-frame-url">
              Figma URL <span className="field-label-note">Visual QA용</span>
            </label>
            <input
              id="figma-frame-url"
              className="url-input"
              type="url"
              value={figmaUrl}
              placeholder="https://www.figma.com/design/...?...node-id=..."
              onChange={(event) => onFigmaUrlChange(event.target.value)}
            />
            {figmaError ? <p className="input-error">{figmaError}</p> : null}

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
