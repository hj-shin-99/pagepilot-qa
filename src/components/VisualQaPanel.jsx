function VisualQaPanel({ designImages, result }) {
  return (
    <section className="section-stack" aria-label="Visual QA 준비">
      <article className="detail-card visual-prep-card">
        <div className="section-title-row">
          <h3>업로드된 디자인 이미지</h3>
          <span>{designImages.length}개</span>
        </div>
        {designImages.length > 0 ? (
          <div className="image-preview-grid workspace-preview-grid">
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
        ) : (
          <p className="empty-row">좌측 패널에서 디자인 이미지를 여러 장 업로드하면 이곳에 준비 목록이 표시됩니다.</p>
        )}
      </article>

      <article className="detail-card visual-prep-card">
        <div className="section-title-row">
          <h3>웹 스크린샷 비교 준비</h3>
          <span>준비 상태</span>
        </div>
        <ul className="evidence-list">
          <li className="evidence-row">
            <span className="evidence-label">대상 URL</span>
            <span className="evidence-value">{result?.targetUrl || 'URL 검사 후 준비됩니다.'}</span>
          </li>
          <li className="evidence-row">
            <span className="evidence-label">디자인 이미지</span>
            <span className="evidence-value">{designImages.length > 0 ? `${designImages.length}개 업로드됨` : '업로드 대기'}</span>
          </li>
          <li className="evidence-row">
            <span className="evidence-label">비교 방식</span>
            <span className="evidence-value">현재 버전은 비교 준비 상태만 제공합니다. pixelmatch/resemblejs 기반 이미지 diff는 아직 실행하지 않습니다.</span>
          </li>
        </ul>
      </article>
    </section>
  )
}

export default VisualQaPanel
