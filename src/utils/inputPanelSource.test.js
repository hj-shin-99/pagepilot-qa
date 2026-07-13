import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

test('input panel exposes one scan start button only', () => {
  const source = fs.readFileSync('src/components/InputPanel.jsx', 'utf8')
  assert.equal((source.match(/type="submit"/g) || []).length, 1)
  assert.equal(source.includes('onStartVisualScan'), false)
  assert.equal(source.includes('onStartTechScan'), false)
  assert.equal(source.includes('Visual QA\n'), false)
  assert.equal(source.includes('Tech QA\n'), false)
})

test('app default scan flow calls integrated qa endpoint only', () => {
  const source = fs.readFileSync('src/App.jsx', 'utf8')
  assert.equal(source.includes("fetch('/api/qa/run'"), true)
  assert.equal(source.includes("fetch('/api/scan'"), false)
  assert.equal(source.includes("fetch('/api/visual/payload'"), false)
})
