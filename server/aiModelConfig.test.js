import test from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_AI_QA_MODEL, getAiQaModel } from './aiModelConfig.js'

test('AI_QA_MODEL overrides the visual QA model when set', () => {
  assert.equal(getAiQaModel({ AI_QA_MODEL: '  custom-vision-model  ' }), 'custom-vision-model')
})

test('AI_QA_MODEL falls back to gpt-5.6-terra when unset or blank', () => {
  assert.equal(DEFAULT_AI_QA_MODEL, 'gpt-5.6-terra')
  assert.equal(getAiQaModel({}), 'gpt-5.6-terra')
  assert.equal(getAiQaModel({ AI_QA_MODEL: '   ' }), 'gpt-5.6-terra')
})
