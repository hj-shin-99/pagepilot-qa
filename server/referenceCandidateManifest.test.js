import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createReferenceCandidateManifest, createReferenceWorkbookSheetSummaries } from './referenceCandidateManifest.js'

test('multi-sheet summaries keep navigation sheets separate and irrelevant sheet empty', () => {
  const sheets = createMultiSheetFacts()
  const summaries = createReferenceWorkbookSheetSummaries(sheets)

  assert.equal(summaries.length, 3)
  assert.equal(summaries[0].navigationCandidateRowCount, 2)
  assert.equal(summaries[1].navigationCandidateRowCount, 2)
  assert.equal(summaries[2].navigationCandidateRowCount, 0)
  assert.equal(summaries[2].urlLikeTargetCount, 0)
  assert.equal(summaries[0].sheetName, 'Current Navigation')
  assert.equal(summaries[1].sheetName, 'Proposed Navigation')
})

test('selected sheet only candidate manifest excludes unselected rows', () => {
  const reference = { sheets: [createMultiSheetFacts()[0]] }
  const manifest = createReferenceCandidateManifest(reference)

  assert.equal(manifest.totalCandidateRows, 2)
  assert.deepEqual(manifest.selectedSheetNames, ['Current Navigation'])
  assert.equal(manifest.candidates.every((candidate) => candidate.sheetName === 'Current Navigation'), true)
  assert.deepEqual(manifest.candidates.map((candidate) => candidate.rowNumber), [2, 3])
})

test('descriptive API-like token is review provenance, not high confidence primary navigation', () => {
  const manifest = createReferenceCandidateManifest({
    sheets: [{
      sheetName: 'Functional Notes',
      rowCount: 2,
      headerCandidates: [{ rowNumber: 1, cells: { A: 'Description', B: 'Notes' } }],
      rows: [
        { rowNumber: 1, cells: { A: 'Description', B: 'Notes' } },
        { rowNumber: 2, cells: { A: 'Call API endpoint', B: 'POST /api/payment/quote returns JSON' } },
      ],
    }],
  })

  assert.equal(manifest.totalCandidateRows, 1)
  assert.equal(manifest.candidates[0].candidateConfidence, 'review')
  assert.equal(manifest.candidates[0].detectedUrls[0].provenance, 'descriptive-text-url-like')
  assert.equal(manifest.candidates[0].detectedUrls[0].confidence, 'review')
})

test('common slash-separated labels are not promoted to URL candidates', () => {
  for (const value of ['Admin/DB', 'FE/BE', 'PC/MO', 'A/B Test', 'App/Web', 'Client/Server']) {
    const manifest = createReferenceCandidateManifest({ sheets: [createSheet({ rows: [{ rowNumber: 2, cells: { A: 'Scope', B: value } }] })] })
    assert.equal(manifest.totalCandidateRows, 0, value)
  }
})

test('standalone relative paths and absolute URLs are preserved as explicit evidence', () => {
  const manifest = createReferenceCandidateManifest({
    sheets: [createSheet({
      rows: [
        { rowNumber: 2, cells: { A: 'Short path', B: '/foo' } },
        { rowNumber: 3, cells: { A: 'Nested path', B: '/foo/bar' } },
        { rowNumber: 4, cells: { A: 'Query path', B: '/foo?x=1' } },
        { rowNumber: 5, cells: { A: 'Absolute', B: 'https://example.com/foo' } },
      ],
    })],
  })

  assert.deepEqual(manifest.candidates.map((candidate) => candidate.detectedUrls[0].raw), ['/foo', '/foo/bar', '/foo?x=1', 'https://example.com/foo'])
  assert.deepEqual(manifest.candidates.map((candidate) => candidate.detectedUrls[0].provenance), ['explicit-relative-path', 'explicit-relative-path', 'explicit-relative-path', 'explicit-absolute-url'])
})

test('multiple URL-like tokens in a row stay independent and are never concatenated', () => {
  const manifest = createReferenceCandidateManifest({
    sheets: [createSheet({
      rows: [
        { rowNumber: 2, cells: { A: 'Separate cells', B: '/news/list', C: '/news/list?type=notice' } },
      ],
    })],
  })

  assert.deepEqual(manifest.candidates[0].detectedUrls.map((url) => url.raw), ['/news/list', '/news/list?type=notice'])
  assert.equal(manifest.candidates[0].detectedUrls.some((url) => url.raw === '/news/list/news/list?type=notice'), false)
})

test('same cell URL tokenization handles parentheses labels commas and line breaks', () => {
  const rows = [
    { rowNumber: 2, cells: { A: 'Parentheses', B: '/purchase/counseling (/purchase/recounseling)' } },
    { rowNumber: 3, cells: { A: 'Labels', B: 'Primary: /a Secondary: /b' } },
    { rowNumber: 4, cells: { A: 'Comma', B: '/c, /d' } },
    { rowNumber: 5, cells: { A: 'Line break', B: '/e\n/f' } },
  ]
  const manifest = createReferenceCandidateManifest({ sheets: [createSheet({ rows })] })

  assert.deepEqual(manifest.candidates[0].detectedUrls.map((url) => url.raw), ['/purchase/counseling', '/purchase/recounseling'])
  assert.deepEqual(manifest.candidates[1].detectedUrls.map((url) => url.raw), ['/a', '/b'])
  assert.deepEqual(manifest.candidates[2].detectedUrls.map((url) => url.raw), ['/c', '/d'])
  assert.deepEqual(manifest.candidates[3].detectedUrls.map((url) => url.raw), ['/e', '/f'])
})

test('absolute URL tokenization preserves query and hash', () => {
  const raw = 'https://example.test/list?type=a#section'
  const manifest = createReferenceCandidateManifest({ sheets: [createSheet({ rows: [{ rowNumber: 2, cells: { A: 'External', B: raw } }] })] })

  assert.equal(manifest.candidates[0].detectedUrls[0].raw, raw)
})

test('hyperlink cells are preserved even when visible text is header-like', () => {
  const manifest = createReferenceCandidateManifest({
    sheets: [{
      sheetName: 'Links',
      rowCount: 1,
      headerCandidates: [{ rowNumber: 1, cells: { A: 'Label', B: { text: 'Target URL', hyperlink: 'https://example.test/header' } } }],
      rows: [{ rowNumber: 1, cells: { A: 'Label', B: { text: 'Target URL', hyperlink: 'https://example.test/header' } } }],
    }],
  })

  assert.equal(manifest.totalCandidateRows, 1)
  assert.equal(manifest.candidates[0].detectedUrls[0].provenance, 'hyperlink-cell')
})

test('descriptive text path token remains review provenance when it is not slash-label text', () => {
  const manifest = createReferenceCandidateManifest({
    sheets: [{
      sheetName: 'Notes',
      rowCount: 1,
      headerCandidates: [{ rowNumber: 1, cells: { A: 'Label', B: 'Description' } }],
      rows: [{ rowNumber: 2, cells: { A: 'Note', B: 'Open /foo when the CTA is clicked' } }],
    }],
  })

  assert.equal(manifest.totalCandidateRows, 1)
  assert.equal(manifest.candidates[0].candidateConfidence, 'review')
  assert.equal(manifest.candidates[0].detectedUrls[0].raw, '/foo')
  assert.equal(manifest.candidates[0].detectedUrls[0].provenance, 'descriptive-text-url-like')
})

test('header-like weak slash text is excluded', () => {
  const manifest = createReferenceCandidateManifest({
    sheets: [{
      sheetName: 'Notes',
      rowCount: 1,
      headerCandidates: [{ rowNumber: 1, cells: { A: 'Owner', B: 'FE/BE' } }],
      rows: [{ rowNumber: 1, cells: { A: 'Owner', B: 'FE/BE' } }],
    }],
  })

  assert.equal(manifest.totalCandidateRows, 0)
})

test('duplicate URL across selected sheets preserves separate candidates without manifest badge', () => {
  const manifest = createReferenceCandidateManifest({ sheets: createMultiSheetFacts().slice(0, 2) })
  const duplicateCandidates = manifest.candidates.filter((candidate) => candidate.detectedUrls.some((url) => url.raw === '/shared'))

  assert.equal(duplicateCandidates.length, 2)
  assert.deepEqual(duplicateCandidates.map((candidate) => candidate.sheetName), ['Current Navigation', 'Proposed Navigation'])
  assert.equal(duplicateCandidates.every((candidate) => candidate.duplicateCandidate !== true), true)
})

test('candidate manifest production source has no customer workbook hardcoding', () => {
  const source = fs.readFileSync(new URL('./referenceCandidateManifest.js', import.meta.url), 'utf8')

  assert.equal(/BMW|BMWFS|TOBE-IA|URL=F|F열|column F|column O|\/kr\/news\/list|\/kr\/legal\/credit-collection|\/kr\/purchase\/counseling|specific customer/i.test(source), false)
})

function createMultiSheetFacts() {
  return [
    {
      sheetName: 'Current Navigation',
      rowCount: 3,
      headerCandidates: [{ rowNumber: 1, cells: { A: 'Depth', B: 'Label', C: 'Target URL' } }],
      rows: [
        { rowNumber: 1, cells: { A: 'Depth', B: 'Label', C: 'Target URL' } },
        { rowNumber: 2, cells: { A: '1', B: 'Home', C: '/home' } },
        { rowNumber: 3, cells: { A: '1', B: 'Shared', C: '/shared' } },
      ],
    },
    {
      sheetName: 'Proposed Navigation',
      rowCount: 3,
      headerCandidates: [{ rowNumber: 1, cells: { A: 'Depth', B: 'Label', C: 'Target URL' } }],
      rows: [
        { rowNumber: 1, cells: { A: 'Depth', B: 'Label', C: 'Target URL' } },
        { rowNumber: 2, cells: { A: '1', B: 'Shared', C: '/shared' } },
        { rowNumber: 3, cells: { A: '1', B: 'Calculator', C: '/calculator?type=lease' } },
      ],
    },
    {
      sheetName: 'Work Breakdown',
      rowCount: 2,
      headerCandidates: [{ rowNumber: 1, cells: { A: 'Task', B: 'Owner' } }],
      rows: [
        { rowNumber: 1, cells: { A: 'Task', B: 'Owner' } },
        { rowNumber: 2, cells: { A: 'Design review', B: 'QA' } },
      ],
    },
  ]
}

function createSheet({ sheetName = 'Navigation', rows }) {
  return {
    sheetName,
    rowCount: rows.length,
    headerCandidates: [{ rowNumber: 1, cells: { A: 'Label', B: 'Target URL' } }],
    rows,
  }
}
