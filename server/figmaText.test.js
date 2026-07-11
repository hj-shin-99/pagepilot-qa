import test from 'node:test'
import assert from 'node:assert/strict'
import { createFigmaTextPreview, extractVisibleFigmaTextNodes } from './figmaText.js'

function createRootFrameFixture() {
  return {
    id: '1:1',
    name: 'Root Frame',
    type: 'FRAME',
    visible: true,
    absoluteBoundingBox: {
      x: 100,
      y: 200,
      width: 400,
      height: 800,
    },
    children: [
      {
        id: '1:2',
        name: 'Header',
        type: 'FRAME',
        visible: true,
        children: [
          {
            id: '1:3',
            name: 'Title',
            type: 'TEXT',
            visible: true,
            characters: 'Hello world',
            absoluteBoundingBox: {
              x: 120,
              y: 260,
              width: 100,
              height: 40,
            },
            style: {
              fontSize: 32,
              fontWeight: 700,
              textAlignHorizontal: 'CENTER',
              textAlignVertical: 'TOP',
              lineHeightPx: 40,
              letterSpacing: 0,
              letterSpacingUnit: 'PIXELS',
            },
            fills: [{ type: 'SOLID', visible: true, opacity: 1, color: { r: 1, g: 1, b: 1, a: 1 } }],
          },
          {
            id: '1:4',
            name: 'Blank',
            type: 'TEXT',
            visible: true,
            characters: '   ',
            absoluteBoundingBox: {
              x: 120,
              y: 320,
              width: 100,
              height: 20,
            },
          },
          {
            id: '1:5',
            name: 'Mixed Style',
            type: 'TEXT',
            visible: true,
            characters: 'Style fallback',
            absoluteBoundingBox: {
              x: 130,
              y: 360,
              width: 120,
              height: 24,
            },
            style: {
              fontSize: 'mixed',
              fontWeight: 'mixed',
              textAlignHorizontal: 'mixed',
              textAlignVertical: 'mixed',
              lineHeightPx: 'mixed',
              letterSpacing: 'mixed',
            },
          },
        ],
      },
      {
        id: '1:6',
        name: 'Hidden Group',
        type: 'GROUP',
        visible: false,
        children: [
          {
            id: '1:7',
            name: 'Hidden Child',
            type: 'TEXT',
            visible: true,
            characters: 'Should not appear',
            absoluteBoundingBox: {
              x: 150,
              y: 420,
              width: 110,
              height: 20,
            },
          },
        ],
      },
      {
        id: '1:8',
        name: 'Hidden Text',
        type: 'TEXT',
        visible: false,
        characters: 'Also hidden',
        absoluteBoundingBox: {
          x: 140,
          y: 460,
          width: 110,
          height: 20,
        },
      },
      {
        id: '1:9',
        name: 'Instance Wrap',
        type: 'INSTANCE',
        visible: true,
        children: [
          {
            id: '1:10',
            name: 'CTA Label',
            type: 'TEXT',
            visible: true,
            characters: 'Apply now',
            absoluteBoundingBox: {
              x: 150,
              y: 500,
              width: 90,
              height: 20,
            },
          },
        ],
      },
    ],
  }
}

test('extractVisibleFigmaTextNodes filters hidden and blank text nodes', () => {
  const result = extractVisibleFigmaTextNodes(createRootFrameFixture())

  assert.equal(result.visibleTextCount, 3)
  assert.equal(result.totalDescendantCount, 9)
  assert.deepEqual(result.textNodes.map((node) => node.id), ['1:3', '1:5', '1:10'])
})

test('extractVisibleFigmaTextNodes builds layerPath and parent frame info', () => {
  const result = extractVisibleFigmaTextNodes(createRootFrameFixture())
  const titleNode = result.textNodes[0]
  const ctaNode = result.textNodes[2]

  assert.equal(titleNode.layerPath, 'Root Frame / Header / Title')
  assert.equal(titleNode.parentFrameId, '1:2')
  assert.equal(titleNode.parentFrameName, 'Header')
  assert.equal(titleNode.parentType, 'FRAME')

  assert.equal(ctaNode.layerPath, 'Root Frame / Instance Wrap / CTA Label')
  assert.equal(ctaNode.parentFrameName, 'Instance Wrap')
  assert.equal(ctaNode.parentType, 'INSTANCE')
})

test('extractVisibleFigmaTextNodes computes relative coordinates and ratios from root frame', () => {
  const result = extractVisibleFigmaTextNodes(createRootFrameFixture())
  const titleNode = result.textNodes[0]

  assert.deepEqual(titleNode.relativeBoundingBox, {
    x: 20,
    y: 60,
    width: 100,
    height: 40,
  })
  assert.equal(titleNode.xRatio, 0.05)
  assert.equal(titleNode.yRatio, 0.075)
  assert.equal(titleNode.widthRatio, 0.25)
  assert.equal(titleNode.heightRatio, 0.05)
})

test('extractVisibleFigmaTextNodes handles mixed or missing style fields safely', () => {
  const result = extractVisibleFigmaTextNodes(createRootFrameFixture())
  const mixedNode = result.textNodes[1]

  assert.equal(mixedNode.fontSize, null)
  assert.equal(mixedNode.fontWeight, null)
  assert.equal(mixedNode.textAlignHorizontal, null)
  assert.equal(mixedNode.textAlignVertical, null)
  assert.equal(mixedNode.lineHeight, null)
  assert.equal(mixedNode.letterSpacing, null)
  assert.deepEqual(mixedNode.fills, [])
})

test('createFigmaTextPreview returns the first five structured text nodes only', () => {
  const result = extractVisibleFigmaTextNodes(createRootFrameFixture())
  const preview = createFigmaTextPreview(result.textNodes, 2)

  assert.equal(preview.length, 2)
  assert.deepEqual(preview.map((node) => node.id), ['1:3', '1:5'])
})
