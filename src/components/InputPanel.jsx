function InputPanel({
  url,
  figmaJson,
  inputError,
  figmaError,
  isCollapsed,
  isScanning,
  designImages,
  onUrlChange,
  onFigmaTextChange,
  onFigmaFileSelect,
  onDesignImagesSelect,
  onDesignImageDelete,
  onToggleCollapsed,
  onStartScan,
}) {
  const handleSubmit = (event) => {
    event.preventDefault()
    onStartScan()
  }

  return (
    <aside className={`control-panel ${isCollapsed ? 'is-collapsed' : ''}`}>
      <button className="sidebar-toggle-button" type="button" onClick={onToggleCollapsed}>
        {isCollapsed ? '열기' : '접기'}
      </button>
      {isCollapsed ? null : (
        <>
      <div className="brand-mark">
        <span className="brand-dot" aria-hidden="true" />
        PagePilot QA
      </div>

      <h1>PagePilot QA</h1>
      <p className="lead-text">
        URL과 Figma 시안 이미지로 Tech QA와 AI 디자인 QA 체크리스트를 생성합니다.
      </p>

      <form className="scan-form" onSubmit={handleSubmit}>
        <label className="field-label" htmlFor="target-url">
          테스트 URL
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
        <button className="primary-button" type="submit" disabled={isScanning}>
          {isScanning ? '검사 중...' : '검사 시작'}
        </button>
      </form>

      <section className="panel-section" aria-label="Figma 시안 이미지 입력">
        <div className="section-title-row compact-title-row">
          <h3>Figma 시안</h3>
          <span>{designImages[0]?.name || '미선택'}</span>
        </div>
        <label className="file-drop-label" htmlFor="design-image-files">
          시안 선택
          <input id="design-image-files" type="file" accept="image/*" onChange={onDesignImagesSelect} />
        </label>
        {designImages.length > 0 ? (
          <div className="single-design-preview">
            <figure className="image-preview-card">
              {designImages[0].previewUrl ? (
                <img src={designImages[0].previewUrl} alt={`${designImages[0].name} preview`} />
              ) : (
                <div className="image-preview-placeholder">미리보기 없음</div>
              )}
              <figcaption>{designImages[0].name}</figcaption>
            </figure>
            <button className="secondary-button design-delete-button" type="button" onClick={onDesignImageDelete}>
              시안 삭제
            </button>
          </div>
        ) : null}
      </section>

      <section className="panel-section advanced-options" aria-label="Figma JSON 입력">
        <div className="section-title-row compact-title-row">
          <h3>Figma JSON</h3>
          <span>선택 사항</span>
        </div>
          <p className="panel-note">선택 사항입니다. JSON을 함께 입력하면 비교 정확도를 보완합니다.</p>
          <textarea
            className="figma-textarea"
            value={figmaJson}
            placeholder='{"document":{"children":[...]}}'
            rows="7"
            onChange={(event) => onFigmaTextChange(event.target.value)}
          />
          <label className="file-drop-label" htmlFor="figma-json-file">
            JSON 파일 선택
            <input id="figma-json-file" type="file" accept="application/json,.json" onChange={onFigmaFileSelect} />
          </label>
          {figmaError ? <p className="input-error">{figmaError}</p> : null}
      </section>
        </>
      )}
    </aside>
  )
}

export default InputPanel
