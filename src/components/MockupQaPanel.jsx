import { useState } from 'react'

const summaryCards = [
  { key: 'textDifference', label: '문구 차이' },
  { key: 'figmaOnly', label: 'Figma에만 있음' },
  { key: 'webOnly', label: 'Web에만 있음' },
  { key: 'visualDifference', label: '비주얼 차이' },
]

const regionPositions = {
  top: 10,
  upper: 25,
  middle: 50,
  lower: 70,
  bottom: 88,
}

function MockupQaPanel({ aiQa, designImages, result, onRunAiQa }) {
  const [selectedIssueIndex, setSelectedIssueIndex] = useState(0)
  const issues = Array.isArray(aiQa?.result?.issues) ? aiQa.result.issues.slice(0, 10) : []
  const summary = aiQa?.result?.summary || {}
  const isRunning = aiQa?.state === 'running'
  const isComplete = aiQa?.state === 'complete'
  const hasFigmaImage = Boolean(designImages[0]?.previewUrl)
  const hasWebImage = Boolean(result?.webScreenshot?.dataUrl)
  const issueCount = Number(summary.total || issues.length)
  const activeIssueIndex = issues[selectedIssueIndex] ? selectedIssueIndex : 0
  const selectedIssue = issues[activeIssueIndex] || null
  const hasSelectedLocation = selectedIssue && (
    isValidBox(selectedIssue.figmaBox)
    || isValidBox(selectedIssue.webBox)
    || getRegionTop(selectedIssue.region) !== null
  )

  return (
    <section className="section-stack" aria-label="시안 비교 QA 결과">
      <article className="detail-card ai-qa-hero-card">
        <div className="section-title-row">
          <div>
            <p className="eyebrow">시안 비교 QA</p>
            <h3>AI 이미지 비교</h3>
            <p className="panel-note relaxed-note">검사 시작 후 AI가 웹 캡처와 시안을 직접 비교합니다.</p>
          </div>
          <button className="primary-button ai-run-button" type="button" disabled={isRunning} onClick={onRunAiQa}>
            {isRunning ? 'AI 비교 중...' : isComplete ? '다시 검사하기' : '검사 시작'}
          </button>
        </div>

        <div className="ai-summary-box">
          {isRunning ? (
            <>
              <strong>AI가 시안과 웹 캡처를 비교 중입니다.</strong>
              <span>웹 fullPage screenshot과 업로드한 Figma 시안 이미지를 OpenAI로 보내 비교합니다.</span>
            </>
          ) : isComplete ? (
            <>
              <strong>AI 비교 완료</strong>
              <span>{issueCount > 0 ? `확실한 차이 ${issueCount}건을 찾았습니다.` : '확인 필요한 차이를 찾지 못했습니다.'}</span>
            </>
          ) : (
            <>
              <strong>검사 대기</strong>
              <span>검사 시작 후 AI가 웹 캡처와 시안을 직접 비교합니다.</span>
            </>
          )}
        </div>

        <div className="ai-summary-pills" aria-label="전달 이미지 상태">
          <span>Web 이미지 {hasWebImage ? '있음' : '없음'}</span>
          <span>Figma 이미지 {hasFigmaImage ? '있음' : '없음'}</span>
        </div>

        {aiQa?.error ? <p className="ai-error-message">{aiQa.error}</p> : null}
      </article>

      {isComplete ? (
        <article className="detail-card ai-result-card">
          <div className="section-title-row">
            <div>
              <h3>요약</h3>
              <p className="panel-note relaxed-note">AI 응답의 분류별 이슈 수입니다.</p>
            </div>
            <span>전체 {issueCount}건</span>
          </div>
          <div className="mockup-ai-summary-grid">
            {summaryCards.map((card) => (
              <div className="mockup-ai-summary-card" key={card.key}>
                <span>{card.label}</span>
                <strong>{Number(summary[card.key] || 0)}</strong>
              </div>
            ))}
          </div>
        </article>
      ) : null}

      {isComplete ? (
        <article className="detail-card ai-result-card">
          <div className="section-title-row">
            <div>
              <h3>이미지 비교</h3>
              <p className="panel-note relaxed-note">선택한 이슈의 대략 위치를 양쪽 이미지에 표시합니다.</p>
            </div>
            <span>{hasSelectedLocation ? `${activeIssueIndex + 1}번 위치` : '위치 표시 없음'}</span>
          </div>
          <div className="mockup-comparison-grid mockup-ai-image-grid">
            <ImageComparisonPane
              imageAlt="Figma 시안 이미지"
              imageSrc={designImages[0]?.previewUrl}
              label="Figma 시안"
              placeholder="Figma 시안 이미지를 업로드해 주세요."
              selectedBox={selectedIssue?.figmaBox}
              selectedNumber={selectedIssue ? activeIssueIndex + 1 : null}
              selectedRegion={selectedIssue?.region}
            />
            <ImageComparisonPane
              imageAlt="Web 캡처 이미지"
              imageSrc={result?.webScreenshot?.dataUrl}
              label="Web 캡처"
              placeholder="URL 검사를 실행하면 웹 캡처가 표시됩니다."
              selectedBox={selectedIssue?.webBox}
              selectedNumber={selectedIssue ? activeIssueIndex + 1 : null}
              selectedRegion={selectedIssue?.region}
            />
          </div>
        </article>
      ) : null}

      {isComplete ? (
        <article className="detail-card ai-result-card">
          <div className="section-title-row">
            <div>
              <h3>최종 이슈</h3>
              <p className="panel-note relaxed-note">OpenAI가 이미지 비교로 판단한 확인 필요 항목만 표시합니다.</p>
            </div>
            <span>{issues.length}건</span>
          </div>
          {issues.length > 0 ? (
            <ul className="ai-issue-list">
              {issues.map((issue, index) => (
                <AiIssueCard
                  isSelected={index === activeIssueIndex}
                  issue={issue}
                  key={`${index}-${issue.title}-${issue.area}`}
                  number={index + 1}
                  onSelect={() => setSelectedIssueIndex(index)}
                />
              ))}
            </ul>
          ) : <p className="empty-row">확인 필요한 차이를 찾지 못했습니다.</p>}
        </article>
      ) : null}
    </section>
  )
}

function ImageComparisonPane({ imageAlt, imageSrc, label, placeholder, selectedBox, selectedNumber, selectedRegion }) {
  const regionTop = getRegionTop(selectedRegion)
  const hasBox = isValidBox(selectedBox)

  return (
    <section className="comparison-pane" aria-label={label}>
      <div className="comparison-pane-head">
        <strong>{label}</strong>
        <span>{hasBox ? '좌표 영역' : regionTop === null ? '선택 위치 없음' : `${selectedRegion} 영역`}</span>
      </div>
      <div className="comparison-image-frame mockup-ai-image-frame">
        {imageSrc ? (
          <div className="comparison-image-stage mockup-ai-image-stage">
            {hasBox ? (
              <span className="mockup-ai-box-highlight" style={getBoxStyle(selectedBox)}>
                <span>{selectedNumber}</span>
              </span>
            ) : regionTop !== null ? (
              <span className="mockup-ai-region-highlight" style={{ '--region-top': `${regionTop}%` }}>
                <span>{selectedNumber}</span>
              </span>
            ) : null}
            <img src={imageSrc} alt={imageAlt} />
          </div>
        ) : <div className="comparison-placeholder mockup-ai-image-placeholder">{placeholder}</div>}
      </div>
    </section>
  )
}

function AiIssueCard({ isSelected, issue, number, onSelect }) {
  const isTextDifference = issue.type === '문구 차이'

  return (
    <li
      aria-label={`${number}번 이슈 선택`}
      aria-pressed={isSelected}
      className={`ai-issue-row mockup-ai-issue-card ${isSelected ? 'is-selected' : ''}`}
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onSelect()
        }
      }}
    >
      <span className="ai-issue-number">{number}</span>
      <dl className="mockup-ai-issue-fields">
        <div>
          <dt>유형</dt>
          <dd>{issue.type || '확인 필요'}</dd>
        </div>
        <div>
          <dt>영역</dt>
          <dd>{issue.area || '위치 확인 필요'}</dd>
        </div>
        <div>
          <dt>Figma</dt>
          <dd>{renderDiffText(issue.figma, issue.web, isTextDifference)}</dd>
        </div>
        <div>
          <dt>Web</dt>
          <dd>{renderDiffText(issue.web, issue.figma, isTextDifference)}</dd>
        </div>
      </dl>
    </li>
  )
}

function getRegionTop(region) {
  return Number.isFinite(regionPositions[region]) ? regionPositions[region] : null
}

function isValidBox(box) {
  return box
    && Number.isFinite(Number(box.x))
    && Number.isFinite(Number(box.y))
    && Number.isFinite(Number(box.width))
    && Number.isFinite(Number(box.height))
    && Number(box.width) > 0
    && Number(box.height) > 0
}

function getBoxStyle(box) {
  return {
    '--box-left': `${clampRatio(box.x) * 100}%`,
    '--box-top': `${clampRatio(box.y) * 100}%`,
    '--box-width': `${clampRatio(box.width) * 100}%`,
    '--box-height': `${clampRatio(box.height) * 100}%`,
  }
}

function clampRatio(value) {
  return Math.max(0, Math.min(1, Number(value) || 0))
}

function renderDiffText(text, otherText, shouldHighlight) {
  const value = String(text || '')
  if (!value) return '없음'
  if (!shouldHighlight || !otherText) return value

  const parts = getDiffParts(value, String(otherText || ''))
  return parts.map((part, index) => (
    part.different
      ? <mark className="diff-highlight" key={`${index}-${part.value}`}>{part.value}</mark>
      : <span key={`${index}-${part.value}`}>{part.value}</span>
  ))
}

function getDiffParts(text, otherText) {
  const textWordUnits = tokenizeWords(text)
  const otherWordUnits = tokenizeWords(otherText)
  const textWordCount = countComparableUnits(textWordUnits)
  const otherWordCount = countComparableUnits(otherWordUnits)
  const useWords = textWordCount > 1 || otherWordCount > 1
  const wordCommonIndexes = getCommonUnitIndexes(textWordUnits, otherWordUnits)
  const shouldFallbackToCharacters = useWords && wordCommonIndexes.size === 0
  const textUnits = useWords && !shouldFallbackToCharacters ? textWordUnits : tokenizeCharacters(text)
  const otherUnits = useWords && !shouldFallbackToCharacters ? otherWordUnits : tokenizeCharacters(otherText)
  const commonIndexes = useWords && !shouldFallbackToCharacters ? wordCommonIndexes : getCommonUnitIndexes(textUnits, otherUnits)

  return textUnits.map((unit, index) => ({
    value: unit.value,
    different: unit.comparable && !commonIndexes.has(index),
  }))
}

function tokenizeWords(text) {
  return (String(text || '').match(/\s+|[^\s]+/gu) || []).map((value) => ({
    value,
    comparable: !/^\s+$/u.test(value),
    compareValue: value.toLowerCase(),
  }))
}

function tokenizeCharacters(text) {
  return Array.from(String(text || '')).map((value) => ({
    value,
    comparable: !/^\s$/u.test(value),
    compareValue: value.toLowerCase(),
  }))
}

function countComparableUnits(units) {
  return units.filter((unit) => unit.comparable).length
}

function getCommonUnitIndexes(textUnits, otherUnits) {
  const textComparable = textUnits.map((unit, index) => ({ ...unit, index })).filter((unit) => unit.comparable)
  const otherComparable = otherUnits.filter((unit) => unit.comparable)
  const table = Array.from({ length: textComparable.length + 1 }, () => Array(otherComparable.length + 1).fill(0))

  for (let row = textComparable.length - 1; row >= 0; row -= 1) {
    for (let column = otherComparable.length - 1; column >= 0; column -= 1) {
      table[row][column] = textComparable[row].compareValue === otherComparable[column].compareValue
        ? table[row + 1][column + 1] + 1
        : Math.max(table[row + 1][column], table[row][column + 1])
    }
  }

  const commonIndexes = new Set()
  let row = 0
  let column = 0
  while (row < textComparable.length && column < otherComparable.length) {
    if (textComparable[row].compareValue === otherComparable[column].compareValue) {
      commonIndexes.add(textComparable[row].index)
      row += 1
      column += 1
    } else if (table[row + 1][column] >= table[row][column + 1]) {
      row += 1
    } else {
      column += 1
    }
  }

  return commonIndexes
}

export default MockupQaPanel
