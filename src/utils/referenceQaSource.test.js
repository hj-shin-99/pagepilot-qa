import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

function readSource(filePath) {
  return fs.readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n')
}

test('Reference modal contains compact trigger, file UI, sheet selection, and review wiring', () => {
  const source = readSource('src/components/QaStartScreen.jsx')
  const modalSource = readSource('src/components/ReferenceQaModal.jsx')

  assert.equal(source.includes('ReferenceQaModal'), true)
  assert.equal(modalSource.includes('Reference URL QA 선택 사항'), true)
  assert.equal(modalSource.includes('Reference URL QA 적용 중'), true)
  assert.equal(modalSource.includes('Reference URL QA 설정 보존됨'), true)
  assert.equal(modalSource.includes('필수 검사 옵션이 해제되어 이번 실행에서는 Reference URL QA가 적용되지 않습니다.'), false)
  assert.equal(modalSource.includes('IA / 기능정의서 / Sitemap Excel 또는 저장한 Reference 설정을 선택할 수 있습니다.'), true)
  assert.equal(modalSource.includes('id="reference-file-input"'), true)
  assert.equal(modalSource.includes('accept=".xlsx,.pagepilot-reference.json,.json,application/json,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"'), true)
  assert.equal(modalSource.includes('선택된 파일 없음'), true)
  assert.equal(modalSource.includes('찾아보기'), true)
  assert.equal(modalSource.includes('reference-file-name-display'), true)
  assert.equal(modalSource.includes('reference-hidden-file-input'), true)
  assert.equal(modalSource.includes('지원하는 .xlsx 또는 Reference 설정 JSON 파일을 선택해 주세요.'), true)
  assert.equal(modalSource.includes('workbook 분석'), false)
  assert.equal(modalSource.includes('분석 중...'), true)
  assert.equal(modalSource.includes('분석하기'), true)
  assert.equal(modalSource.includes('referenceState.selectedFile ? ('), true)
  assert.equal(modalSource.includes('reference-file-action-row'), true)
  assert.equal(modalSource.includes('설정 ' + '불러오기'), false)
  assert.equal(modalSource.includes('reference-preset-' + 'import-button'), false)
  assert.equal(modalSource.includes('importReferencePresetFromText'), true)
  assert.equal(modalSource.includes('sheet 선택'), true)
  assert.equal(modalSource.includes('선택한 시트 분석하기'), true)
  assert.equal(modalSource.includes('selectedCount > 0 ? ('), true)
  assert.equal(modalSource.includes('실제 분석에 사용할 sheet를 직접 선택하세요.'), true)
  assert.equal(modalSource.includes('선택 sheet normalization'), false)
  assert.equal(modalSource.includes('normalization 중...'), false)
  assert.equal(modalSource.includes('선택되지 않은 sheet row는 normalization 요청에 포함되지 않습니다.'), false)
  assert.equal(modalSource.includes('ReferenceReviewPanel'), true)
  assert.equal(modalSource.includes('onReferenceApply(null)'), true)
})

test('ReferenceReviewPanel contains Preview Confirm Edit Exclude and Reference apply UI source', () => {
  const source = readSource('src/components/ReferenceReviewPanel.jsx')

  assert.equal(source.includes('Reference Map Preview'), true)
  assert.equal(source.includes('Confirm'), true)
  assert.equal(source.includes('aria-pressed={status === \'confirmed\'}'), true)
  assert.equal(source.includes('reference-confirm-button'), true)
  assert.equal(source.includes('is-selected'), true)
  assert.equal(source.includes('Edit'), true)
  assert.equal(source.includes('Exclude'), true)
  assert.equal(source.includes('reference-exclude-button'), true)
  assert.equal(source.includes('전체 확정'), true)
  assert.equal(source.includes('bulkConfirmCount > 0 ?'), true)
  assert.equal(source.includes('설정 저장'), true)
  assert.equal(source.includes('검토 작업'), true)
  assert.equal(source.includes('confirmAllReferenceItems'), true)
  assert.equal(source.includes('createReferencePreviewTitle'), true)
  assert.equal(source.includes('scrollReferenceApplyCtaIntoView'), true)
  assert.equal(source.includes('Edit 저장'), true)
  assert.equal(source.includes('Reference 적용'), true)
  assert.equal(source.includes('Expected URL'), true)
  assert.equal(source.includes('Confidence'), true)
  assert.equal(source.includes('Source'), true)
  assert.equal(source.includes('Hierarchy'), true)
  assert.equal(source.includes('<h4>{createReferencePreviewTitle(item)}</h4>'), true)
  assert.equal(source.includes('formatReviewHierarchy(item.pageContext?.depthPath)'), true)
  assert.equal(source.includes('Evidence'), true)
  assert.equal(source.includes('formatPreviewSummary'), true)
  assert.equal(source.includes('AI 미매핑 / 검토 필요'), true)
  assert.equal(source.includes('reference-review-diagnostics'), true)
  assert.equal(source.includes('createReferenceTelemetryRows'), true)
  assert.equal(source.includes('reference-telemetry-row'), true)
  assert.equal(source.includes('이번 분석 AI Calls'), false)
  assert.equal(source.includes('<div><dt>Row Coverage</dt><dd>{rowCoverage.mappedCandidateRows'), true)
  assert.equal(source.includes('<div><dt>URL Evidence</dt><dd>{urlEvidenceCoverage.classifiedGroundedUrls'), true)
  assert.equal(source.includes('Expected URL ${expectedCount}개'), true)
  assert.equal(source.includes('일부 후보는 AI 해석에 실패하여 검토 필요 상태로 남았습니다.'), false)
  assert.equal(source.includes('<div><dt>chunk</dt><dd>{chunking.successfulChunkCount'), true)
})

test('Reference settings save stays enabled for pending review and is grouped with final apply action', () => {
  const source = readSource('src/components/ReferenceReviewPanel.jsx')
  const cssSource = readSource('src/App.css')
  const toolbarBlock = source.slice(source.indexOf('className="reference-review-toolbar"'), source.indexOf('</div>', source.indexOf('className="reference-review-toolbar"')))
  const finalActionsBlock = source.slice(source.indexOf('className="reference-final-actions"'), source.indexOf('</div>', source.indexOf('className="reference-final-actions"')))

  assert.equal(toolbarBlock.includes('전체 확정'), true)
  assert.equal(toolbarBlock.includes('bulkConfirmCount > 0 ?'), true)
  assert.equal(toolbarBlock.includes('설정 저장'), false)
  assert.equal(finalActionsBlock.includes('설정 저장'), true)
  assert.equal(finalActionsBlock.includes('Reference 적용'), true)
  assert.equal(finalActionsBlock.indexOf('설정 저장') < finalActionsBlock.indexOf('Reference 적용'), true)
  assert.equal(finalActionsBlock.includes("typeof onExport !== 'function'"), true)
  assert.equal(finalActionsBlock.includes('summary.pending'), false)
  assert.equal(finalActionsBlock.includes('bulkConfirmCount'), false)
  assert.equal(finalActionsBlock.includes('className="primary-button reference-apply-button"'), true)
  assert.equal(source.includes('onClick={onExport}'), true)
  assert.equal(source.includes('onClick={applyReference}'), true)
  assert.equal(cssSource.includes('.reference-final-actions'), true)
  assert.equal(cssSource.includes('flex-wrap: wrap'), true)
})

test('Reference diagnostics expose AI cache and current-request token labels safely', () => {
  const panelSource = readSource('src/components/ReferenceReviewPanel.jsx')
  const reviewSource = readSource('src/utils/referenceReview.js')
  const cssSource = readSource('src/App.css')

  assert.equal(panelSource.includes('<summary>진단 정보</summary>'), true)
  assert.equal(panelSource.includes('telemetryRows.map'), true)
  assert.equal(reviewSource.includes('AI 분석'), true)
  assert.equal(reviewSource.includes('저장된 Reference 사용'), true)
  assert.equal(reviewSource.includes('캐시 사용'), true)
  assert.equal(reviewSource.includes('실패 / fallback'), true)
  assert.equal(reviewSource.includes('이번 분석 AI Calls'), true)
  assert.equal(reviewSource.includes('이번 분석 Input Tokens'), true)
  assert.equal(reviewSource.includes('이번 분석 Output Tokens'), true)
  assert.equal(reviewSource.includes('이번 분석 Total Tokens'), true)
  assert.equal(reviewSource.includes('원본 분석 모델:'), true)
  assert.equal(reviewSource.includes('확인 불가'), true)
  assert.equal(cssSource.includes('grid-template-columns: minmax(118px, 0.44fr) minmax(0, 1fr);'), true)
  assert.equal(/rawPrompt|rawResponse|apiKey/.test(panelSource), false)
})

test('Reference review moved out of the main inline start screen into modal body scroll', () => {
  const startSource = readSource('src/components/QaStartScreen.jsx')
  const modalSource = readSource('src/components/ReferenceQaModal.jsx')
  const cssSource = readSource('src/App.css')

  assert.equal(startSource.includes('reference-upload-card'), false)
  assert.equal(startSource.includes('ReferenceReviewPanel'), false)
  assert.equal(modalSource.includes('createPortal'), true)
  assert.equal(modalSource.includes('reference-qa-body'), true)
  assert.equal(cssSource.includes('.reference-qa-body'), true)
  assert.equal(cssSource.includes('overflow-y: auto'), true)
})

test('Reference disabled UI stays in existing row without card chrome', () => {
  const modalSource = readSource('src/components/ReferenceQaModal.jsx')
  const cssSource = readSource('src/App.css')
  const disabledBlock = cssSource.slice(cssSource.indexOf('.reference-qa-modal.is-disabled'), cssSource.indexOf('.reference-qa-modal.is-disabled .tech-scan-options-status-check'))

  assert.equal(modalSource.includes('tech-scan-options-secondary-row reference-qa-trigger-row'), true)
  assert.equal(modalSource.includes('reference-qa-disabled-reason'), true)
  assert.equal(cssSource.includes('text-align: center'), true)
  assert.equal(disabledBlock.includes('border:'), false)
  assert.equal(disabledBlock.includes('background:'), false)
  assert.equal(disabledBlock.includes('padding:'), false)
})

test('confirmedReferenceMap is sent only as optional compact navigation Reference', () => {
  const appSource = readSource('src/App.jsx')
  const streamSource = readSource('src/utils/qaRunStream.js')

  assert.equal(appSource.includes('setConfirmedReferenceMap'), true)
  assert.equal(appSource.includes('handleReferenceApply'), true)
  assert.equal(appSource.includes('handleTechScanOptionsChange'), true)
  assert.equal(appSource.includes('setIsReferenceRunEnabled(false)'), true)
  assert.equal(appSource.includes('setConfirmedReferenceMap(null)'), true)
  assert.equal(appSource.includes('isReferenceQaDependencySatisfied(scanOptions) ? createCompactNavigationReferenceMap(confirmedReferenceMap) : null'), true)
  assert.equal(appSource.includes('isReferenceRunEnabled ? confirmedReferenceMap : null'), true)
  assert.equal(appSource.includes('const body = navigationReference'), true)
  assert.equal(appSource.includes('body: JSON.stringify(body)'), true)
  assert.equal(streamSource.includes('const shouldIncludeNavigationReference = navigationReference && isReferenceQaDependencySatisfied(scanOptions)'), true)
  assert.equal(streamSource.includes('const body = shouldIncludeNavigationReference'), true)
  assert.equal(streamSource.includes('body: JSON.stringify(body)'), true)
})

test('Reference URL QA dependency disables modal UI without clearing confirmed data', () => {
  const appSource = readSource('src/App.jsx')
  const startSource = readSource('src/components/QaStartScreen.jsx')
  const modalSource = readSource('src/components/ReferenceQaModal.jsx')

  assert.equal(startSource.includes('isReferenceQaDependencySatisfied(techScanOptions)'), true)
  assert.equal(startSource.includes('URL·Click·Landing 검사를 모두 선택하면 Reference URL QA를 사용할 수 있습니다.'), true)
  assert.equal(startSource.includes('!isWebUrlReady || isScanning || !isReferenceQaDependencyEnabled'), true)
  assert.equal(modalSource.includes('aria-describedby={disabledHelperText ? \'reference-qa-disabled-reason\' : undefined}'), true)
  assert.equal(modalSource.includes('if (isDisabled) return'), true)
  assert.equal(modalSource.includes('const disabledHelperText = disabledReason'), true)
  const optionChangeBlock = appSource.slice(appSource.indexOf('const handleTechScanOptionsChange'), appSource.indexOf('if (!isHistoryHydrated)'))
  assert.equal(optionChangeBlock.includes('setIsReferenceRunEnabled(false)'), true)
  assert.equal(optionChangeBlock.includes('setConfirmedReferenceMap(null)'), false)
})

test('Reference source does not hardcode customer domain path header or column rules', () => {
  const source = [
    readSource('src/components/QaStartScreen.jsx'),
    readSource('src/components/ReferenceQaModal.jsx'),
    readSource('src/components/ReferenceReviewPanel.jsx'),
    readSource('src/utils/referenceQa.js'),
    readSource('src/utils/referenceReview.js'),
  ].join('\n')

  assert.equal(/BMW|BMWFS|TOBE-IA|URL=F|F열|column F|column O|\/kr\/promotion|\/kr\/news\/list|\/kr\/legal\/credit-collection|\/kr\/purchase\/counseling|specific customer/i.test(source), false)
})

test('Reference user-facing source keeps Korean strings as UTF-8 without mojibake markers', () => {
  const source = [
    readSource('src/components/QaStartScreen.jsx'),
    readSource('src/components/ReferenceQaModal.jsx'),
    readSource('src/components/ReferenceReviewPanel.jsx'),
    readSource('src/utils/referenceQa.js'),
    readSource('src/utils/referenceReview.js'),
    readSource('server/referenceNavigationService.js'),
    readSource('server/referenceNormalizeRoute.js'),
    readSource('server/referenceFileUploadRoute.js'),
  ].join('\n')

  assert.equal(/Reference \?곸슜|遺꾩꽍|誘멸|寃\?\?|\?좏깮|\?쒖쇅|\?섏젙|�/.test(source), false)
  assert.equal(source.includes('Reference 적용'), true)
  assert.equal(source.includes('workbook 분석'), false)
  assert.equal(source.includes('분석 중...'), true)
  assert.equal(source.includes('미검토'), true)
  assert.equal(source.includes('선택'), true)
  assert.equal(source.includes('제외'), true)
  assert.equal(source.includes('수정'), true)
  assert.equal(source.includes('검토 필요'), true)
})

test('Reference modal keeps sheet draft changes separate from current Preview state', () => {
  const source = readSource('src/components/ReferenceQaModal.jsx')

  const sheetToggleBlock = source.slice(source.indexOf('const handleSheetToggle'), source.indexOf('const handleItemsChange'))
  const normalizeBlock = source.slice(source.indexOf('const handleNormalize'), source.indexOf('const handleSheetToggle'))

  assert.equal(sheetToggleBlock.includes('updateReferenceSheetDraftSelection'), true)
  assert.equal(sheetToggleBlock.includes('referenceMap: null'), false)
  assert.equal(sheetToggleBlock.includes('reviewItems: []'), false)
  assert.equal(sheetToggleBlock.includes('confirmedReferenceMap: null'), false)
  assert.equal(sheetToggleBlock.includes('onReferenceApply(null)'), false)
  assert.equal(normalizeBlock.includes('createReferenceNormalizeSuccessState'), true)
  assert.equal(normalizeBlock.includes('createReferenceNormalizeFailureState'), true)
})

test('Reference modal hides sheet selection only while Preview exists', () => {
  const source = readSource('src/components/ReferenceQaModal.jsx')
  const fileChangeBlock = source.slice(source.indexOf('const handleFileChange'), source.indexOf('const importPresetFile'))
  const analyzeBlock = source.slice(source.indexOf('const handleAnalyze'), source.indexOf('const handleNormalize'))
  const normalizeBlock = source.slice(source.indexOf('const handleNormalize'), source.indexOf('const handleSheetToggle'))
  const importBlock = source.slice(source.indexOf('const importPresetFile'), source.indexOf('const handleBrowseClick'))

  assert.equal(source.includes('shouldShowReferenceSheetSelection(referenceState) ? ('), true)
  assert.equal(source.includes('shouldShowReferenceSheetSelection'), true)
  assert.equal(fileChangeBlock.includes('createReferenceFileSelectionState(file)'), true)
  assert.equal(analyzeBlock.includes('referenceMap: null'), true)
  assert.equal(analyzeBlock.includes('reviewItems: []'), true)
  assert.equal(normalizeBlock.includes('createReferenceNormalizeSuccessState'), true)
  assert.equal(normalizeBlock.includes('createReferenceNormalizeFailureState'), true)
  assert.equal(importBlock.includes('setReferenceState({ ...next, presetFileName: file.name })'), true)
  assert.equal(importBlock.includes('analyzedReference'), false)
  assert.equal(importBlock.includes('normalizeReference('), false)
})

test('Reference preset import through unified picker restores Preview without calling workbook normalization', () => {
  const source = readSource('src/components/ReferenceQaModal.jsx')
  const importBlock = source.slice(source.indexOf('const importPresetFile'), source.indexOf('const handleBrowseClick'))
  const fileChangeBlock = source.slice(source.indexOf('const handleFileChange'), source.indexOf('const importPresetFile'))

  assert.equal(importBlock.includes('importReferencePresetFromText'), true)
  assert.equal(importBlock.includes('normalizeReference('), false)
  assert.equal(importBlock.includes('analyzeReferenceFile('), false)
  assert.equal(importBlock.includes('setSelectedSheetNames(next.normalizedSheetNames)'), true)
  assert.equal(importBlock.includes('onReferenceApply(null)'), true)
  assert.equal(fileChangeBlock.includes('isSupportedReferenceExcel(file)'), true)
  assert.equal(fileChangeBlock.includes('isSupportedPresetFile(file)'), true)
})

test('Reference preset source is reusable and not bound to current QA URL', () => {
  const source = readSource('src/utils/referenceReview.js')
  const presetBlock = source.slice(source.indexOf('export function createReferencePreset'), source.indexOf('export function createReferencePresetFilename'))

  assert.equal(presetBlock.includes('webUrl'), false)
  assert.equal(presetBlock.includes('targetUrl'), false)
  assert.equal(presetBlock.includes('currentUrl'), false)
  assert.equal(presetBlock.includes('sourceDocument'), true)
  assert.equal(presetBlock.includes('normalizedSheetNames'), true)
})

test('ReferenceReviewPanel renders multi expected URLs through row layout', () => {
  const panelSource = readSource('src/components/ReferenceReviewPanel.jsx')
  const cssSource = readSource('src/App.css')

  assert.equal(panelSource.includes('renderExpectedUrls(item.referenceId, urlRows)'), true)
  assert.equal(panelSource.includes('urlRows.length === 1'), true)
  assert.equal(panelSource.includes('reference-url-list'), true)
  assert.equal(panelSource.includes('reference-url-text-separator'), true)
  assert.equal(cssSource.includes('.reference-url-list'), true)
  assert.equal(cssSource.includes('.reference-url-chip-row'), true)
  assert.equal(cssSource.includes('display: grid'), true)
  assert.equal(panelSource.includes("join('')"), false)
})

test('ReferenceReviewPanel explains all chunks failed fallback before bulk confirm', () => {
  const source = readSource('src/components/ReferenceReviewPanel.jsx')

  assert.equal(source.includes('AI 분석을 사용하지 못했습니다'), true)
  assert.equal(source.includes('문서의 URL 근거를 기준으로 미리보기를 구성했습니다. 적용 전 항목을 확인해 주세요.'), true)
  assert.equal(source.includes('정규화 경고:'), false)
  assert.equal(source.includes('formatFailedChunkDiagnostics'), true)
  assert.equal(source.includes('providerCode'), true)
  assert.equal(source.includes('rawPrompt'), false)
  assert.equal(source.includes('rawResponse'), false)
  assert.equal(source.includes('window.confirm'), true)
  assert.equal(source.includes('AI 미매핑 항목까지 모두 컨펌합니다.'), true)
  assert.equal(source.includes('전체 확정'), true)
})

test('Reference apply success closes modal while failure keeps it open', () => {
  const source = readSource('src/components/ReferenceQaModal.jsx')
  const applyBlock = source.slice(source.indexOf('const handleApply'), source.indexOf('const handlePresetExport'))

  assert.equal(applyBlock.includes('await onReferenceApply(confirmedReferenceMap)'), true)
  assert.equal(applyBlock.includes('closeModal()'), true)
  assert.equal(applyBlock.includes('catch (error)'), true)
  assert.equal(applyBlock.includes('Reference 적용에 실패했습니다.'), true)
})

test('Reference URL QA table moves reason to details and keeps URL cells compact', () => {
  const panelSource = readSource('src/components/TechQaPanel.jsx')
  const techSource = readSource('src/utils/techQa.js')
  const cssSource = readSource('src/App.css')

  assert.equal(techSource.includes('actualUrls: dedupeStrings'), true)
  assert.equal(panelSource.includes('title="Reference URL QA"'), true)
  assert.equal(panelSource.includes('Reference 문서에 정의된 이동 URL과 실제 웹에서 확인된 링크·클릭·랜딩 URL을 비교합니다.'), true)
  assert.equal(panelSource.includes('navigation-intent-status-help'), false)
  assert.equal(panelSource.includes('정상: Reference와 실제 이동 URL이 일치'), false)
  assert.equal(panelSource.includes('formatNavigationDepthColumn'), true)
  assert.equal(panelSource.includes('const depthColumnCount = 4'), true)
  assert.equal(panelSource.includes('`${index + 1} Depth`'), true)
  assert.equal(panelSource.includes('1차 메뉴'), false)
  assert.equal(panelSource.includes('2차 메뉴'), false)
  assert.equal(panelSource.includes('페이지/항목'), false)
  assert.equal(panelSource.includes('원본 행'), true)
  assert.equal(panelSource.includes('NavigationIntentDetails'), true)
  assert.equal(panelSource.includes('getSectionVisibility(rows, { maxVisible: 5, preserveOrder: true })'), true)
  assert.equal(panelSource.includes('CollapsedNavigationIntentRows'), true)
  assert.equal(panelSource.includes('판정 이유 / 근거'), true)
  assert.equal(panelSource.includes('navigation-intent-reason'), false)
  assert.equal(panelSource.includes('navigation-intent-url-cell'), true)
  assert.equal(panelSource.includes('hierarchySegments'), true)
  assert.equal(techSource.includes('sourceRowDisplay: formatNavigationIntentSourceRow(item)'), true)
  assert.equal(techSource.includes('legacyText.match'), true)
  assert.equal(cssSource.includes('.navigation-intent-depth-cell'), true)
  assert.equal(cssSource.includes('text-overflow: ellipsis'), true)
  assert.equal(cssSource.includes('white-space: nowrap'), true)
})

test('Reference API failure handling is isolated from existing URL Figma and Tech option handlers', () => {
  const source = readSource('src/components/ReferenceQaModal.jsx')
  const fileChangeBlock = source.slice(source.indexOf('const handleFileChange'), source.indexOf('const handleAnalyze'))
  const analyzeBlock = source.slice(source.indexOf('const handleAnalyze'), source.indexOf('const handleNormalize'))

  assert.equal(fileChangeBlock.includes('onUrlChange'), false)
  assert.equal(fileChangeBlock.includes('onFigmaUrlChange'), false)
  assert.equal(fileChangeBlock.includes('onTechScanOptionsChange'), false)
  assert.equal(analyzeBlock.includes('onUrlChange'), false)
  assert.equal(analyzeBlock.includes('onFigmaUrlChange'), false)
  assert.equal(analyzeBlock.includes('onTechScanOptionsChange'), false)
  assert.equal(readSource('src/components/QaStartScreen.jsx').includes('onStartScan()'), true)
})
