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
  assert.equal(modalSource.includes('Reference QA 선택 사항'), true)
  assert.equal(modalSource.includes('Reference QA 적용 중'), true)
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
  assert.equal(modalSource.includes('선택 sheet normalization'), true)
  assert.equal(modalSource.includes('Reference 분석 중 · 여러 후보를 chunk 단위로 처리합니다.'), true)
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
  assert.equal(source.includes('전체 컨펌'), true)
  assert.equal(source.includes('설정 저장'), true)
  assert.equal(source.includes('confirmAllReferenceItems'), true)
  assert.equal(source.includes('Edit 저장'), true)
  assert.equal(source.includes('Reference 적용'), true)
  assert.equal(source.includes('Expected URL'), true)
  assert.equal(source.includes('Confidence'), true)
  assert.equal(source.includes('Source'), true)
  assert.equal(source.includes('Evidence'), true)
  assert.equal(source.includes('미검토 항목은 적용 대상에서 제외됩니다'), true)
  assert.equal(source.includes('AI 미매핑 / 검토 필요'), true)
  assert.equal(source.includes('Row Coverage와 URL Evidence는 별도 지표입니다.'), true)
  assert.equal(source.includes('Row Coverage {rowCoverage.mappedCandidateRows'), true)
  assert.equal(source.includes('URL Evidence {urlEvidenceCoverage.classifiedGroundedUrls'), true)
  assert.equal(source.includes('Expected URL {urlEvidenceCoverage.expectedGroundedUrls'), true)
  assert.equal(source.includes('일부 후보는 AI 해석에 실패하여 검토 필요 상태로 남았습니다.'), true)
  assert.equal(source.includes('chunk {chunking.successfulChunkCount'), true)
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

test('confirmedReferenceMap is sent only as optional compact navigation Reference', () => {
  const appSource = readSource('src/App.jsx')
  const streamSource = readSource('src/utils/qaRunStream.js')

  assert.equal(appSource.includes('setConfirmedReferenceMap'), true)
  assert.equal(appSource.includes('onReferenceApply={setConfirmedReferenceMap}'), true)
  assert.equal(appSource.includes('createCompactNavigationReferenceMap(confirmedReferenceMap)'), true)
  assert.equal(appSource.includes('const body = navigationReference'), true)
  assert.equal(appSource.includes('body: JSON.stringify(body)'), true)
  assert.equal(streamSource.includes('const body = navigationReference'), true)
  assert.equal(streamSource.includes('body: JSON.stringify(body)'), true)
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

  assert.equal(source.includes('AI 해석에 실패하여 문서에서 직접 추출한 URL 후보로 Preview를 구성했습니다. 적용 전 검토를 권장합니다.'), true)
  assert.equal(source.includes('Row Coverage는 AI가 원문 row를 매핑한 비율'), true)
  assert.equal(source.includes('window.confirm'), true)
  assert.equal(source.includes('AI 미매핑 항목까지 모두 컨펌합니다.'), true)
  assert.equal(source.includes('전체 컨펌'), true)
})

test('Reference apply success closes modal while failure keeps it open', () => {
  const source = readSource('src/components/ReferenceQaModal.jsx')
  const applyBlock = source.slice(source.indexOf('const handleApply'), source.indexOf('const handlePresetExport'))

  assert.equal(applyBlock.includes('await onReferenceApply(confirmedReferenceMap)'), true)
  assert.equal(applyBlock.includes('closeModal()'), true)
  assert.equal(applyBlock.includes('catch (error)'), true)
  assert.equal(applyBlock.includes('Reference 적용에 실패했습니다.'), true)
})

test('Navigation Intent table keeps reason and URL cells compact with deduped actual URLs', () => {
  const panelSource = readSource('src/components/TechQaPanel.jsx')
  const techSource = readSource('src/utils/techQa.js')
  const cssSource = readSource('src/App.css')

  assert.equal(techSource.includes('actualUrls: dedupeStrings'), true)
  assert.equal(panelSource.includes('navigation-intent-reason'), true)
  assert.equal(panelSource.includes('navigation-intent-url-cell'), true)
  assert.equal(panelSource.includes('title={row.reason || row.rawStatus}'), true)
  assert.equal(cssSource.includes('.navigation-intent-reason'), true)
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
