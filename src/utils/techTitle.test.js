import test from 'node:test'
import assert from 'node:assert/strict'
import { createTechQaTitle } from './techTitle.js'

test('Tech QA title appends generic suffix to simple page title', () => {
  assert.equal(createTechQaTitle('BMW 파이낸셜 서비스'), 'BMW 파이낸셜 서비스 Tech QA 결과')
})

test('Tech QA title appends generic suffix to title with separator', () => {
  assert.equal(createTechQaTitle('BMW 스마트 상품 | BMW 파이낸셜 서비스'), 'BMW 스마트 상품 | BMW 파이낸셜 서비스 Tech QA 결과')
})

test('Tech QA title does not duplicate existing suffix', () => {
  assert.equal(createTechQaTitle('샘플 페이지 Tech QA 결과'), '샘플 페이지 Tech QA 결과')
})
