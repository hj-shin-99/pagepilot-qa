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
  assert.equal(modalSource.includes('IA / 기능정의서 / Sitemap Excel (.xlsx)'), true)
  assert.equal(modalSource.includes('id="reference-file-input"'), true)
  assert.equal(modalSource.includes('accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"'), true)
  assert.equal(modalSource.includes('workbook 분석'), false)
  assert.equal(modalSource.includes('분석 중...'), true)
  assert.equal(modalSource.includes("'분석'"), true)
  assert.equal(modalSource.includes('reference-file-action-row'), true)
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
  assert.equal(source.includes('Edit'), true)
  assert.equal(source.includes('Exclude'), true)
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

test('confirmedReferenceMap stays out of qa run payloads and qaRunStream remains reference-free', () => {
  const appSource = readSource('src/App.jsx')
  const streamSource = readSource('src/utils/qaRunStream.js')

  assert.equal(appSource.includes('setConfirmedReferenceMap'), true)
  assert.equal(appSource.includes('onReferenceApply={setConfirmedReferenceMap}'), true)
  assert.equal(appSource.includes('body: JSON.stringify({ webUrl, figmaUrl, scanOptions, devices: normalizeDeviceIds(devices) })'), true)
  assert.equal(appSource.includes('referenceMap, webUrl, figmaUrl'), false)
  assert.equal(appSource.includes('confirmedReferenceMap, webUrl'), false)
  assert.equal(streamSource.includes('reference'), false)
  assert.equal(streamSource.includes('confirmedReferenceMap'), false)
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

test('ReferenceReviewPanel renders multi expected URLs through row layout', () => {
  const panelSource = readSource('src/components/ReferenceReviewPanel.jsx')
  const cssSource = readSource('src/App.css')

  assert.equal(panelSource.includes('renderExpectedUrls(item.referenceId, urlRows)'), true)
  assert.equal(panelSource.includes('urlRows.length === 1'), true)
  assert.equal(panelSource.includes('reference-url-list'), true)
  assert.equal(cssSource.includes('.reference-url-list'), true)
  assert.equal(cssSource.includes('display: grid'), true)
  assert.equal(panelSource.includes("join('')"), false)
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
