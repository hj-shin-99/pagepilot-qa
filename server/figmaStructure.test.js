import test from 'node:test'
import assert from 'node:assert/strict'
import { extractVisibleFigmaTextNodes } from './figmaText.js'
import { extractFigmaStructure } from './figmaStructure.js'

function createStructureFixture() {
  return {
    id: 'root:1',
    name: 'Root Frame',
    type: 'FRAME',
    visible: true,
    opacity: 1,
    absoluteBoundingBox: {
      x: 100,
      y: 200,
      width: 400,
      height: 300,
    },
    fills: [{ type: 'SOLID', visible: true, opacity: 1, color: { r: 1, g: 1, b: 1, a: 1 } }],
    children: [
      {
        id: 'group:1',
        name: 'Hero Group',
        type: 'GROUP',
        visible: true,
        absoluteBoundingBox: {
          x: 120,
          y: 240,
          width: 200,
          height: 80,
        },
        children: [
          {
            id: 'text:1',
            name: 'Hero Title',
            type: 'TEXT',
            visible: true,
            characters: 'Hello world',
            absoluteBoundingBox: {
              x: 130,
              y: 250,
              width: 160,
              height: 32,
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
          },
          {
            id: 'rect:1',
            name: 'Hero Image',
            type: 'RECTANGLE',
            visible: true,
            absoluteBoundingBox: {
              x: 300,
              y: 240,
              width: 100,
              height: 80,
            },
            fills: [
              { type: 'IMAGE', visible: true, opacity: 1, imageRef: 'abcd1234efgh', scaleMode: 'FILL' },
              { type: 'GRADIENT_LINEAR', visible: true, opacity: 1, gradientStops: [{ position: 0, color: { r: 1, g: 0, b: 0, a: 1 } }] },
            ],
          },
        ],
      },
      {
        id: 'frame:hidden',
        name: 'Hidden Frame',
        type: 'FRAME',
        visible: false,
        absoluteBoundingBox: {
          x: 120,
          y: 330,
          width: 180,
          height: 40,
        },
        children: [
          {
            id: 'text:hidden',
            name: 'Hidden Child',
            type: 'TEXT',
            visible: true,
            characters: 'Should hide',
            absoluteBoundingBox: {
              x: 130,
              y: 340,
              width: 120,
              height: 20,
            },
          },
        ],
      },
      {
        id: 'text:self-hidden',
        name: 'Self Hidden Text',
        type: 'TEXT',
        visible: false,
        characters: 'Hidden',
        absoluteBoundingBox: {
          x: 350,
          y: 350,
          width: 50,
          height: 18,
        },
      },
      {
        id: 'instance:1',
        name: 'Primary Button',
        type: 'INSTANCE',
        visible: true,
        reactions: [{ action: { type: 'NODE' } }],
        prototypeInteractions: [{ type: 'ON_CLICK' }],
        transitionNodeID: 'target:1',
        componentPropertyReferences: { text: 'label' },
        componentProperties: { label: { type: 'TEXT', value: 'Apply now' } },
        componentId: 'component:primary',
        mainComponent: { id: 'component:main' },
        overrides: [{ id: 'override:1' }],
        absoluteBoundingBox: {
          x: 130,
          y: 390,
          width: 120,
          height: 36,
        },
        children: [
          {
            id: 'text:button',
            name: 'Button Label',
            type: 'TEXT',
            visible: true,
            characters: 'Apply now',
            absoluteBoundingBox: {
              x: 145,
              y: 398,
              width: 90,
              height: 18,
            },
          },
        ],
      },
      {
        id: 'unknown:1',
        name: 'Mystery',
        type: 'MAGIC_SHAPE',
        visible: true,
      },
      {
        id: 'vector:outside',
        name: 'Outside Vector',
        type: 'VECTOR',
        visible: true,
        absoluteBoundingBox: {
          x: 50,
          y: 210,
          width: 20,
          height: 20,
        },
        strokes: [{ type: 'SOLID', visible: true, opacity: 1, color: { r: 0, g: 0, b: 0, a: 1 } }],
      },
    ],
  }
}

function countTreeNodes(node) {
  if (!node) return 0
  return 1 + (Array.isArray(node.children) ? node.children.reduce((sum, child) => sum + countTreeNodes(child), 0) : 0)
}

test('FRAME > GROUP > TEXT hierarchy is preserved in figmaStructure', () => {
  const result = extractFigmaStructure(createStructureFixture())

  assert.equal(result.figmaStructure.type, 'FRAME')
  assert.equal(result.figmaStructure.children[0].type, 'GROUP')
  assert.equal(result.figmaStructure.children[0].children[0].type, 'TEXT')
})

test('flatNodes count matches total tree node count', () => {
  const result = extractFigmaStructure(createStructureFixture())
  assert.equal(result.figmaFlatNodes.length, countTreeNodes(result.figmaStructure))
})

test('parentId, childIds, depth, and siblingIndex are populated', () => {
  const result = extractFigmaStructure(createStructureFixture())
  const groupNode = result.figmaFlatNodes.find((node) => node.id === 'group:1')
  const textNode = result.figmaFlatNodes.find((node) => node.id === 'text:1')

  assert.equal(groupNode.parentId, 'root:1')
  assert.deepEqual(groupNode.childIds, ['text:1', 'rect:1'])
  assert.equal(groupNode.depth, 1)
  assert.equal(textNode.siblingIndex, 0)
  assert.equal(textNode.depth, 2)
})

test('relative coordinates and ratios are computed from root bounds', () => {
  const result = extractFigmaStructure(createStructureFixture())
  const textNode = result.figmaFlatNodes.find((node) => node.id === 'text:1')

  assert.deepEqual(textNode.relativeBoundingBox, {
    x: 30,
    y: 50,
    width: 160,
    height: 32,
  })
  assert.equal(textNode.xRatio, 0.075)
  assert.equal(textNode.yRatio, 0.166667)
  assert.equal(textNode.widthRatio, 0.4)
  assert.equal(textNode.heightRatio, 0.106667)
})

test('visible nodes remain effectively visible', () => {
  const result = extractFigmaStructure(createStructureFixture())
  const textNode = result.figmaFlatNodes.find((node) => node.id === 'text:1')
  assert.equal(textNode.effectivelyVisible, true)
})

test('self hidden state is recorded', () => {
  const result = extractFigmaStructure(createStructureFixture())
  const hiddenText = result.figmaFlatNodes.find((node) => node.id === 'text:self-hidden')

  assert.equal(hiddenText.selfHidden, true)
  assert.equal(hiddenText.effectivelyVisible, false)
})

test('hidden parent descendants record ancestorHidden and effectivelyVisible false', () => {
  const result = extractFigmaStructure(createStructureFixture())
  const hiddenChild = result.figmaFlatNodes.find((node) => node.id === 'text:hidden')

  assert.equal(hiddenChild.selfHidden, false)
  assert.equal(hiddenChild.ancestorHidden, true)
  assert.equal(hiddenChild.effectivelyVisible, false)
})

test('IMAGE fill nodes expose hasImageFill and imageRefs', () => {
  const result = extractFigmaStructure(createStructureFixture())
  const imageNode = result.figmaFlatNodes.find((node) => node.id === 'rect:1')

  assert.equal(imageNode.hasImageFill, true)
  assert.equal(imageNode.imageFillCount, 1)
  assert.deepEqual(imageNode.imageRefs, ['abcd1234efgh'])
  assert.deepEqual(imageNode.imageScaleModes, ['FILL'])
})

test('SOLID and GRADIENT fills are normalized safely', () => {
  const result = extractFigmaStructure(createStructureFixture())
  const rootNode = result.figmaFlatNodes.find((node) => node.id === 'root:1')
  const imageNode = result.figmaFlatNodes.find((node) => node.id === 'rect:1')

  assert.equal(rootNode.hasSolidFill, true)
  assert.equal(imageNode.hasGradientFill, true)
  assert.equal(Array.isArray(imageNode.fills), true)
})

test('FRAME and GROUP nodes with children are marked as containers', () => {
  const result = extractFigmaStructure(createStructureFixture())
  const rootNode = result.figmaFlatNodes.find((node) => node.id === 'root:1')
  const groupNode = result.figmaFlatNodes.find((node) => node.id === 'group:1')

  assert.equal(rootNode.isContainer, true)
  assert.equal(groupNode.isContainer, true)
})

test('visible leaf TEXT and RECTANGLE nodes are marked as visible leaves', () => {
  const result = extractFigmaStructure(createStructureFixture())
  const textNode = result.figmaFlatNodes.find((node) => node.id === 'text:1')
  const rectNode = result.figmaFlatNodes.find((node) => node.id === 'rect:1')

  assert.equal(textNode.isVisibleLeaf, true)
  assert.equal(rectNode.isVisibleLeaf, true)
})

test('nodes without bounding boxes do not throw and keep null boxes', () => {
  const result = extractFigmaStructure(createStructureFixture())
  const unknownNode = result.figmaFlatNodes.find((node) => node.id === 'unknown:1')

  assert.equal(unknownNode.absoluteBoundingBox.x, null)
  assert.equal(unknownNode.relativeBoundingBox.y, null)
})

test('unsupported node types are kept as generic scene nodes', () => {
  const result = extractFigmaStructure(createStructureFixture())
  const unknownNode = result.figmaFlatNodes.find((node) => node.id === 'unknown:1')

  assert.equal(unknownNode.type, 'MAGIC_SHAPE')
})

test('visible text count parity is maintained with figmaText extractor', () => {
  const fixture = createStructureFixture()
  const structure = extractFigmaStructure(fixture)
  const visibleTextResult = extractVisibleFigmaTextNodes(fixture)
  const structureVisibleTextCount = structure.figmaFlatNodes.filter((node) => node.type === 'TEXT' && node.effectivelyVisible && typeof node.characters === 'string' && node.characters.trim()).length

  assert.equal(structureVisibleTextCount, visibleTextResult.visibleTextCount)
})

test('interaction summary fields are preserved on flat nodes', () => {
  const result = extractFigmaStructure(createStructureFixture())
  const instanceNode = result.figmaFlatNodes.find((node) => node.id === 'instance:1')

  assert.equal(instanceNode.isInteractiveCandidate, true)
  assert.equal(instanceNode.prototypeInteractionCount, 1)
  assert.equal(instanceNode.reactionCount, 1)
  assert.equal(instanceNode.hasPrototypeInteractions, true)
  assert.equal(instanceNode.hasReactions, true)
  assert.equal(instanceNode.hasTransitionTarget, true)
  assert.equal(instanceNode.transitionNodeId, 'target:1')
  assert.equal(instanceNode.hasComponentPropertyReferences, true)
  assert.equal(instanceNode.componentPropertyReferenceCount, 1)
  assert.equal(instanceNode.hasComponentProperties, true)
  assert.equal(instanceNode.componentPropertyCount, 1)
  assert.equal(instanceNode.componentId, 'component:primary')
  assert.equal(instanceNode.mainComponentId, 'component:main')
  assert.equal(instanceNode.hasOverrides, true)
  assert.equal(instanceNode.overrideCount, 1)
  assert.equal(instanceNode.interactionSummary.prototypeInteractionCount, 1)
})
