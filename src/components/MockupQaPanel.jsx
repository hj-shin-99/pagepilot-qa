import { useMemo, useState } from 'react'

const metricLabels = [
  { key: 'total', label: '전체 이슈 수' },
  { key: 'text', label: '텍스트 이슈 수' },
  { key: 'style', label: '스타일 이슈 수' },
  { key: 'layout', label: '위치/크기 확인 필요 수' },
  { key: 'cta', label: 'CTA 확인 필요 수' },
]

const statusLabels = {
  ok: '정상',
  error: '차이 있음',
  warn: '확인 필요',
}

function MockupQaPanel({ designImages, designQa, figmaElements, result, webElements }) {
  const actionableIssues = useMemo(
    () => designQa.issues.filter((issue) => issue.status !== 'ok'),
    [designQa.issues],
  )
  const visibleIssues = actionableIssues.length > 0 ? actionableIssues : designQa.issues
  const [selectedImageId, setSelectedImageId] = useState(designImages[0]?.id || '')
  const [selectedIssueId, setSelectedIssueId] = useState(visibleIssues[0]?.id || '')
  const firstImageId = designImages[0]?.id || ''
  const firstIssueId = visibleIssues[0]?.id || ''
  const activeImageId = designImages.some((image) => image.id === selectedImageId) ? selectedImageId : firstImageId
  const activeIssueId = visibleIssues.some((issue) => issue.id === selectedIssueId) ? selectedIssueId : firstIssueId
  const selectedImage = designImages.find((image) => image.id === activeImageId) || designImages[0]
  const selectedIssue = visibleIssues.find((issue) => issue.id === activeIssueId) || visibleIssues[0]

  const handleIssueSelect = (issue) => {
    setSelectedIssueId(issue.id)
    document.getElementById('mockup-compare-viewer')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <section className="section-stack" aria-label="시안 비교 QA 결과">
      <section className="metrics-grid mockup-metrics" aria-label="시안 비교 QA 이슈 요약">
        {metricLabels.map((metric) => (
          <article className="metric-card" key={metric.key}>
            <p className="metric-label">{metric.label}</p>
            <p className="metric-value">{designQa.summaryCounts[metric.key]}</p>
          </article>
        ))}
      </section>

      <article className="detail-card mockup-viewer-card" id="mockup-compare-viewer">
        <div className="section-title-row">
          <h3>웹 화면 vs Figma 시안</h3>
          <span>Figma {figmaElements.length}개 · Web {webElements.length}개</span>
        </div>

        <div className="mockup-comparison-grid">
          <ComparisonPane
            anchorLabel="web"
            imageAlt="Playwright full-page web screenshot"
            imageSrc={result.webScreenshot?.dataUrl}
            issue={selectedIssue}
            label="Web Screenshot"
            note={formatScreenshotMeta(result.webScreenshot)}
            placeholder={result.webScreenshot ? '히스토리는 웹 screenshot 원본을 저장하지 않아 메타데이터만 표시됩니다.' : 'URL 검사를 실행하면 Playwright full-page screenshot이 표시됩니다.'}
          />
          <ComparisonPane
            anchorLabel="figma"
            imageAlt={selectedImage ? `${selectedImage.name} preview` : 'Figma design mockup'}
            imageSrc={selectedImage?.previewUrl}
            issue={selectedIssue}
            label="Figma 시안 이미지"
            note={selectedImage ? formatImageMeta(selectedImage) : '업로드 대기'}
            placeholder={selectedImage ? '히스토리는 원본 이미지를 저장하지 않아 메타데이터만 표시됩니다.' : '좌측 패널에서 Figma 시안 이미지를 업로드해 주세요.'}
          />
        </div>

        <div className="image-selector" aria-label="Figma 시안 이미지 선택">
          {designImages.length > 0 ? designImages.map((image) => (
            <button
              aria-pressed={activeImageId === image.id}
              className={activeImageId === image.id ? 'is-active' : ''}
              key={image.id}
              type="button"
              onClick={() => setSelectedImageId(image.id)}
            >
              <span>{image.name}</span>
              <small>{formatImageMeta(image)}</small>
            </button>
          )) : <p className="panel-note relaxed-note">업로드된 Figma 시안 이미지가 없습니다.</p>}
        </div>
      </article>

      <article className="detail-card">
        <div className="section-title-row">
          <h3>그룹 이슈 목록</h3>
          <span>y, x 좌표 순 정렬 · pixel diff 미실행</span>
        </div>
        <ul className="mockup-issue-list">
          {visibleIssues.length > 0 ? visibleIssues.map((issue) => (
            <li className={`mockup-issue-card ${issue.status} ${selectedIssue?.id === issue.id ? 'is-selected' : ''}`} key={issue.id}>
              <button type="button" onClick={() => handleIssueSelect(issue)}>
                <span className="mockup-issue-meta">
                  <span className={`status-chip status-${issue.status}`}>{statusLabels[issue.status]}</span>
                  <span>{issue.region}</span>
                  <span>x {formatNumber(issue.anchor.x)} · y {formatNumber(issue.anchor.y)}</span>
                </span>
                <strong>{issue.label}</strong>
                <span className="mockup-issue-text">{issue.text}</span>
                <span className="mockup-issue-detail">{issue.detail}</span>
                {issue.differences.length > 0 ? (
                  <span className="mockup-difference-list">
                    {issue.differences.map((difference) => (
                      <span key={`${issue.id}-${difference.type}-${difference.label}`}>
                        {difference.label}: {difference.detail}
                      </span>
                    ))}
                  </span>
                ) : null}
              </button>
            </li>
          )) : <li className="empty-row">비교 가능한 이슈가 없습니다. Figma JSON과 URL 검사를 함께 실행해 주세요.</li>}
        </ul>
      </article>

      <article className="detail-card">
        <div className="section-title-row">
          <h3>비교 기준</h3>
          <span>텍스트/스타일/레이아웃 그룹 판정</span>
        </div>
        <p className="panel-note relaxed-note">
          텍스트는 줄바꿈, 특수 공백, 반복 공백, zero-width 문자, 일부 문장부호 차이, 영문 대소문자를 정규화해 매칭합니다. 이미지 영역은 선택/앵커 구조만 준비되어 있으며 pixelmatch/resemblejs 수준의 픽셀 diff는 실행하지 않습니다.
        </p>
      </article>
    </section>
  )
}

function ComparisonPane({ anchorLabel, imageAlt, imageSrc, issue, label, note, placeholder }) {
  return (
    <section className="comparison-pane" aria-label={label}>
      <div className="comparison-pane-head">
        <strong>{label}</strong>
        <span>{note}</span>
      </div>
      {issue ? (
        <p className="comparison-selected-context">
          선택 이슈: {issue.region} · x {formatNumber(issue.anchor.x)} · y {formatNumber(issue.anchor.y)}
        </p>
      ) : null}
      <div className="comparison-image-frame" data-anchor-scope={anchorLabel}>
        {imageSrc ? <img src={imageSrc} alt={imageAlt} /> : <div className="comparison-placeholder">{placeholder}</div>}
      </div>
    </section>
  )
}

function formatImageMeta(image) {
  if (!image) return ''
  if (!image.size) return 'metadata only'
  return `${Math.round(image.size / 1024)} KB`
}

function formatScreenshotMeta(webScreenshot) {
  if (!webScreenshot) return '캡처 대기'
  if (webScreenshot.error) return webScreenshot.error

  const width = Math.round(Number(webScreenshot.width) || 0)
  const height = Math.round(Number(webScreenshot.height) || 0)
  return `${width} × ${height}px · ${webScreenshot.fullPage ? 'full-page capture' : 'viewport capture'}`
}

function formatNumber(value) {
  return Math.round(Number(value) || 0)
}

export default MockupQaPanel
