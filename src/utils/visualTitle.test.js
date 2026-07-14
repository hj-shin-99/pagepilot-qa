import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createVisualQaTitle } from './visualTitle.js'

test('pageTitle creates dynamic Visual QA title', () => {
  assert.equal(createVisualQaTitle({ pageTitle: 'BMW 파이낸셜 서비스' }), 'BMW 파이낸셜 서비스 Visual QA 결과')
})

test('pageTitle is not duplicated when it already includes Visual QA result suffix', () => {
  assert.equal(createVisualQaTitle({ pageTitle: '브랜드 홈 Visual QA 결과' }), '브랜드 홈 Visual QA 결과')
})

test('missing pageTitle falls back to safe hostname or generic title', () => {
  assert.equal(createVisualQaTitle({ pageTitle: '페이지 제목 없음', result: { meta: { webUrl: 'https://www.example-site.co.kr/page' } } }), 'Example Site Visual QA 결과')
  assert.equal(createVisualQaTitle({ result: {} }), 'Visual QA 결과')
})

test('history compact visual result can restore title from existing fields', () => {
  const compactResult = { web: { page: { title: '저장된 랜딩' } }, meta: { webUrl: 'https://example.com' } }
  assert.equal(createVisualQaTitle({ result: compactResult }), '저장된 랜딩 Visual QA 결과')
})

test('production source does not hardcode BMWFS title copy', () => {
  const files = ['src/components/VisualQaPanel.jsx', 'src/utils/visualTitle.js', 'src/App.jsx']
  const source = files.map((file) => fs.readFileSync(file, 'utf8')).join('\n')
  assert.equal(source.includes('BMW 파이낸셜 서비스'), false)
  assert.equal(source.includes('bmwfs'), false)
})
