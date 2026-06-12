function InputPanel({
  url,
  figmaJson,
  inputError,
  figmaError,
  isScanning,
  designImages,
  onUrlChange,
  onFigmaTextChange,
  onFigmaFileSelect,
  onDesignImagesSelect,
  onStartScan,
}) {
  const handleSubmit = (event) => {
    event.preventDefault()
    onStartScan()
  }

  return (
    <aside className="control-panel">
      <div className="brand-mark">
        <span className="brand-dot" aria-hidden="true" />
        PagePilot QA
      </div>

      <h1>PagePilot QA v2</h1>
      <p className="lead-text">
        URL, Figma JSON, 디자인 이미지를 한 화면에서 준비하고 로컬 Playwright 결과와 비교합니다.
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

      <section className="panel-section" aria-label="Figma JSON 입력">
        <div className="section-title-row compact-title-row">
          <h3>Figma JSON</h3>
          <span>붙여넣기 또는 .json</span>
        </div>
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

      <section className="panel-section" aria-label="Visual QA 디자인 이미지 입력">
        <div className="section-title-row compact-title-row">
          <h3>Visual QA 이미지</h3>
          <span>{designImages.length}개</span>
        </div>
        <label className="file-drop-label" htmlFor="design-image-files">
          이미지 여러 장 선택
          <input id="design-image-files" type="file" accept="image/*" multiple onChange={onDesignImagesSelect} />
        </label>
        {designImages.length > 0 ? (
          <div className="image-preview-grid">
            {designImages.map((image) => (
              <figure className="image-preview-card" key={image.id}>
                {image.previewUrl ? (
                  <img src={image.previewUrl} alt={`${image.name} preview`} />
                ) : (
                  <div className="image-preview-placeholder">미리보기 없음</div>
                )}
                <figcaption>{image.name}</figcaption>
              </figure>
            ))}
          </div>
        ) : null}
      </section>
    </aside>
  )
}

export default InputPanel
