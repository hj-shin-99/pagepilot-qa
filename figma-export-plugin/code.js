/* global figma, __html__ */
/* PagePilot Export v0.1.1 / build 2026-07-08-parsefix */

var CTA_KEYWORDS = [
  'button',
  'btn',
  'cta',
  'link',
  'action',
  'submit',
  'apply',
  'contact',
  'download',
  'buy',
  'purchase',
  'reserve',
  'booking',
  'learn more',
  'read more',
  'view more',
  '더보기',
  '자세히',
  '자세히 보기',
  '신청',
  '신청하기',
  '구매',
  '구매하기',
  '상담',
  '상담하기',
  '다운로드',
  '예약',
  '예약하기',
  '문의',
  '문의하기',
  '가입',
  '가입하기',
  '시작',
  '시작하기',
  '확인',
  '바로가기',
  '알아보기',
]

var CTA_TEXT_PATTERNS = [
  /\b(button|btn|cta|link|submit|apply|contact|download|buy|purchase|reserve|booking)\b/i,
  /\b(learn|read|view|see|get|start|try|join|sign\s*up)\s+(more|now|today|free|in|up)\b/i,
  /(신청|구매|상담|예약|문의|가입|시작|확인|다운로드|바로가기|알아보기)\s*하기/,
  /자세히\s*보기|더\s*보기/,
]

var IMAGE_KEYWORDS = [
  'image',
  'img',
  'photo',
  'picture',
  'thumbnail',
  'visual',
  'kv',
  'banner',
  'background',
  '이미지',
  '사진',
  '배너',
]

var DECORATIVE_LAYER_PATTERNS = /vector|path|shape|rectangle|line|divider|blende|blend|icon\s*frame|icon|arrow|chevron|logo/i
var BLOCKED_QA_IMAGE_PATTERNS = /blende|blend|vector|icon\s*frame|icon|logo|mask|overlay|path|shape|line|divider|chevron|arrow/i
var TECHNICAL_LAYER_NAME_PATTERNS = /^(con|bg|img|image\s*\d+|group\s*\d+|frame\s*\d+|content|wrapper|inner-wrapper|btn|button|banner|default\/blend\/left-center)$/i
var SECTION_NAME_PATTERNS = /main|visual|hero|kv|con|content|section|footer|banner|smart|program|benefit|card|disclaimer|notice|guide|메인|비주얼|상단|본문|콘텐츠|푸터|배너|혜택|카드|유의|안내/i
var NOTE_TEXT_PATTERNS = /※|disclaimer|footer|유의|고지|약관|저작권|copyright|주의|안내사항|면책/i
var NAV_TEXT_PATTERNS = /gnb|nav|menu|navigation|header|메뉴|네비|내비|탭/i
var BUTTON_LAYER_PATTERNS = /button|btn|cta|link-button|basic-button|primary|secondary|버튼/i
var REAL_BUTTON_TEXT_PATTERNS = /^(프로모션\s*바로가기|구매상담\s*바로가기|바로가기|더\s*알아보기|상담\s*신청|자세히\s*보기|더\s*보기|신청하기|구매하기|문의하기|learn\s*more|read\s*more|view\s*more|contact\s*us|apply\s*now)$/i
var PAGEPILOT_EXPORT_VERSION = 'v0.1.1'
var PAGEPILOT_EXPORT_BUILD = '2026-07-08-parsefix'
var PAGEPILOT_EXPORT_LABEL = 'PagePilot Export ' + PAGEPILOT_EXPORT_VERSION + ' / build ' + PAGEPILOT_EXPORT_BUILD

var IMAGE_LIKE_TYPES = [
  'FRAME',
  'GROUP',
  'INSTANCE',
  'RECTANGLE',
]

var SECTION_LIKE_TYPES = [
  'COMPONENT',
  'COMPONENT_SET',
  'FRAME',
  'GROUP',
  'INSTANCE',
  'SECTION',
]

figma.showUI(__html__, { width: 520, height: 640, themeColors: true })

figma.ui.onmessage = function (message) {
  if (!message || message.type !== 'export-json') {
    return
  }

  var exportResult = createPagePilotExport()
  console.log(PAGEPILOT_EXPORT_LABEL, 'jsonValid:', Boolean(exportResult.jsonValid))
  figma.ui.postMessage({ type: 'export-result', payload: exportResult })

  if (exportResult.ok) {
    figma.notify(PAGEPILOT_EXPORT_LABEL + ': ' + exportResult.data.summary.textCount + ' text nodes')
  } else {
    figma.notify(exportResult.error, { error: true })
  }
}

function createPagePilotExport() {
  var selection = filterExportableRoots(figma.currentPage.selection)

  if (selection.length === 0) {
    return {
      ok: false,
      error: '프레임, 섹션, 컴포넌트, 인스턴스, 그룹 중 하나를 선택한 뒤 Export JSON을 눌러주세요.',
    }
  }

  var context = {
    textNodes: [],
    ctaCandidates: [],
    imageCandidates: [],
    sections: [],
  }

  var selectedNodes = []
  for (var selectionIndex = 0; selectionIndex < selection.length; selectionIndex += 1) {
    var selectedRoot = selection[selectionIndex]
    var rootBox = getAbsoluteBoundingBox(selectedRoot)
    var selectedNode = serializeNode(selectedRoot, context, {
      rootBox: rootBox,
      path: [],
      depth: 0,
      section: null,
      buttonContainer: null,
      hidden: false,
    })
    if (selectedNode) {
      selectedNodes.push(selectedNode)
    }
  }

  sortExportCollections(context)
  var qaModel = createQaModel(selection, context)

  var exportData = {
    schema: 'pagepilot-qa.design-export.v1',
    exportVersion: PAGEPILOT_EXPORT_VERSION,
    exportBuild: PAGEPILOT_EXPORT_BUILD,
    exportLabel: PAGEPILOT_EXPORT_LABEL,
    source: {
      tool: 'figma-plugin',
      plugin: 'PagePilot QA Design Export',
      pluginVersion: PAGEPILOT_EXPORT_VERSION,
      pluginBuild: PAGEPILOT_EXPORT_BUILD,
      pluginLabel: PAGEPILOT_EXPORT_LABEL,
      localOnly: true,
      network: 'disabled',
      exportedAt: new Date().toISOString(),
      page: {
        id: figma.currentPage.id,
        name: figma.currentPage.name,
      },
      selectionCount: selection.length,
    },
    summary: {
      selectedRootCount: selection.length,
      textCount: context.textNodes.length,
      ctaCandidateCount: context.ctaCandidates.length,
      imageCandidateCount: context.imageCandidates.length,
      sectionCount: context.sections.length,
    },
    document: {
      id: figma.currentPage.id,
      name: figma.currentPage.name,
      type: 'PAGE',
      children: selectedNodes,
    },
    textNodes: context.textNodes,
    ctaCandidates: context.ctaCandidates,
    imageCandidates: context.imageCandidates,
    sections: context.sections,
    texts: context.textNodes,
    ctas: context.ctaCandidates,
    images: context.imageCandidates,
    qaModel: qaModel,
  }

  try {
    var jsonText = JSON.stringify(exportData, null, 2)
    JSON.parse(jsonText)

    return {
      ok: true,
      data: exportData,
      json: jsonText,
      jsonValid: true,
      exportVersion: PAGEPILOT_EXPORT_VERSION,
      exportBuild: PAGEPILOT_EXPORT_BUILD,
      exportLabel: PAGEPILOT_EXPORT_LABEL,
    }
  } catch (error) {
    return {
      ok: false,
      error: 'JSON 생성 또는 유효성 검증에 실패했습니다: ' + (error && error.message ? error.message : 'Unknown error'),
    }
  }
}

function filterExportableRoots(nodes) {
  var results = []
  if (!Array.isArray(nodes)) {
    return results
  }

  for (var nodeIndex = 0; nodeIndex < nodes.length; nodeIndex += 1) {
    if (isExportableRoot(nodes[nodeIndex])) {
      results.push(nodes[nodeIndex])
    }
  }

  return results
}

function isExportableRoot(node) {
  return Boolean(node && 'children' in node && isNodeExportVisible(node) && hasUsableAbsoluteBoundingBox(node))
}

function serializeNode(node, context, traversal) {
  if (!isNodeExportableInTraversal(node, traversal)) {
    return null
  }

  var currentPath = traversal.path.slice(0)
  currentPath.push(node.name || '')
  var currentTraversal = {
    rootBox: traversal.rootBox,
    path: currentPath,
    depth: traversal.depth,
    section: traversal.section,
    buttonContainer: traversal.buttonContainer,
    hidden: traversal.hidden,
  }
  var baseNode = createBaseNode(node, currentTraversal)
  var currentSection = currentTraversal.section

  if (isSectionCandidate(node, currentTraversal) || isSelectedSectionRoot(node, currentTraversal)) {
    currentSection = createSection(node, baseNode)
    context.sections.push(currentSection)
    currentTraversal.section = currentSection
  }

  if (node.type === 'TEXT') {
    var textNode = createTextNode(node, baseNode)
    var shouldExportText = isExportableTextNode(textNode)

    if (shouldExportText) {
      context.textNodes.push(textNode)
      addToSection(currentSection, 'texts', textNode)
    }

    if (shouldExportText && (isCtaCandidate(node, textNode.text) || currentTraversal.buttonContainer)) {
      var textMatchesCta = isCtaCandidate(node, textNode.text)
      var ctaKind = textMatchesCta ? 'TEXT_CTA' : 'BUTTON_TEXT_CTA'
      var ctaCandidate = createCandidate(ctaKind, node, textNode.text, currentTraversal)
      if (currentTraversal.buttonContainer) {
        addUniqueMatch(ctaCandidate.matchedBy, 'button-container')
      }
      context.ctaCandidates.push(ctaCandidate)
      addToSection(currentSection, 'ctas', ctaCandidate)
    }

    return textNode
  }

  if (isCtaCandidate(node, '')) {
    var nodeCtaCandidate = createCandidate('NODE_CTA', node, '', currentTraversal)
    context.ctaCandidates.push(nodeCtaCandidate)
    addToSection(currentSection, 'ctas', nodeCtaCandidate)
  }

  if (isImageCandidate(node)) {
    var imageCandidate = createImageCandidate(node, currentTraversal)
    context.imageCandidates.push(imageCandidate)
    addToSection(currentSection, 'images', imageCandidate)
  }

  if (isButtonLikeContainer(node)) {
    currentTraversal.buttonContainer = node
  }

  if ('children' in node && Array.isArray(node.children)) {
    baseNode.children = []
    for (var childIndex = 0; childIndex < node.children.length; childIndex += 1) {
      var childNode = serializeNode(node.children[childIndex], context, {
        rootBox: currentTraversal.rootBox,
        path: currentPath,
        depth: currentTraversal.depth + 1,
        section: currentSection,
        buttonContainer: currentTraversal.buttonContainer,
        hidden: currentTraversal.hidden,
      })
      if (childNode) {
        baseNode.children.push(childNode)
      }
    }
  }

  return baseNode
}

function createBaseNode(node, traversal) {
  var box = getAbsoluteBoundingBox(node)

  return {
    id: node.id,
    name: node.name || '',
    type: node.type,
    visible: traversal.hidden ? false : node.visible !== false,
    opacity: roundNumber(readNumber(node.opacity, 1)),
    x: box.x,
    y: box.y,
    width: box.width,
    height: box.height,
    absoluteBoundingBox: box,
    layerPath: traversal.path.slice(0),
    positionRatio: createPositionRatio(box, traversal.rootBox),
  }
}

function createTextNode(node, baseNode) {
  var textStyle = createTextStyle(node)
  var fills = serializeFills(node.fills)
  var textNode = copyBaseNode(baseNode)

  textNode.tag = 'TEXT'
  textNode.text = node.characters || ''
  textNode.characters = node.characters || ''
  textNode.normalizedText = normalizeText(textNode.text)
  textNode.compareText = createCompareText(textNode.text)
  textNode.fontFamily = textStyle.fontFamily
  textNode.fontStyle = textStyle.fontStyle
  textNode.fontSize = textStyle.fontSize
  textNode.fontWeight = textStyle.fontWeight
  textNode.lineHeight = textStyle.lineHeight
  textNode.letterSpacing = textStyle.letterSpacing
  textNode.color = getPaintColor(node.fills)
  textNode.fills = fills
  textNode.style = {
    fontFamily: textStyle.fontFamily,
    fontStyle: textStyle.fontStyle,
    fontSize: textStyle.fontSize,
    fontWeight: textStyle.fontWeight,
    lineHeightPx: textStyle.lineHeightPx,
    lineHeightPercentFontSize: textStyle.lineHeightPercentFontSize,
    lineHeightPercent: textStyle.lineHeightPercent,
    letterSpacing: textStyle.letterSpacing,
  }

  return textNode
}

function copyBaseNode(baseNode) {
  var copiedNode = {}
  for (var key in baseNode) {
    if (Object.prototype.hasOwnProperty.call(baseNode, key)) {
      copiedNode[key] = baseNode[key]
    }
  }

  return copiedNode
}

function createTextStyle(node) {
  var fontName = readFontName(node.fontName)
  var lineHeight = readLineHeight(node.lineHeight)
  var letterSpacing = readLetterSpacing(node.letterSpacing)

  return {
    fontFamily: fontName.family,
    fontStyle: fontName.style,
    fontSize: readMixedNumber(node.fontSize),
    fontWeight: inferFontWeight(fontName.style),
    lineHeight: lineHeight.display,
    lineHeightPx: lineHeight.px,
    lineHeightPercentFontSize: lineHeight.percentFontSize,
    lineHeightPercent: lineHeight.percent,
    letterSpacing: letterSpacing,
  }
}

function createCandidate(kind, node, text, traversal) {
  var box = getAbsoluteBoundingBox(node)
  var candidateText = text || ''

  return {
    kind: kind,
    id: node.id,
    name: node.name || '',
    type: node.type,
    text: candidateText,
    normalizedText: normalizeText(candidateText || node.name || ''),
    compareText: createCompareText(candidateText || node.name || ''),
    matchedBy: getMatchedKeywords((node.name || '') + ' ' + candidateText, CTA_KEYWORDS),
    x: box.x,
    y: box.y,
    width: box.width,
    height: box.height,
    layerPath: traversal.path.slice(0),
    positionRatio: createPositionRatio(box, traversal.rootBox),
  }
}

function createImageCandidate(node, traversal) {
  var box = getAbsoluteBoundingBox(node)

  return {
    kind: hasImageFill(node) ? 'IMAGE_FILL' : 'ICON_OR_GRAPHIC',
    id: node.id,
    name: node.name || '',
    type: node.type,
    matchedBy: getMatchedKeywords(node.name || '', IMAGE_KEYWORDS),
    fills: serializeFills(node.fills),
    x: box.x,
    y: box.y,
    width: box.width,
    height: box.height,
    layerPath: traversal.path.slice(0),
    positionRatio: createPositionRatio(box, traversal.rootBox),
  }
}

function createSection(node, baseNode) {
  return {
    id: node.id,
    name: node.name || '',
    type: node.type,
    x: baseNode.x,
    y: baseNode.y,
    width: baseNode.width,
    height: baseNode.height,
    order: 0,
    layerPath: baseNode.layerPath.slice(0),
    positionRatio: copyPositionRatio(baseNode.positionRatio),
    texts: [],
    ctas: [],
    images: [],
  }
}

function createPositionRatio(box, rootBox) {
  var rootWidth = readNumber(rootBox.width, 0)
  var rootHeight = readNumber(rootBox.height, 0)
  var xRatio = 0
  var yRatio = 0
  var widthRatio = 0
  var heightRatio = 0

  if (rootWidth > 0) {
    xRatio = (box.x - rootBox.x) / rootWidth
    widthRatio = box.width / rootWidth
  }

  if (rootHeight > 0) {
    yRatio = (box.y - rootBox.y) / rootHeight
    heightRatio = box.height / rootHeight
  }

  return {
    xRatio: roundRatio(xRatio),
    yRatio: roundRatio(yRatio),
    widthRatio: roundRatio(widthRatio),
    heightRatio: roundRatio(heightRatio),
  }
}

function copyPositionRatio(positionRatio) {
  return {
    xRatio: positionRatio.xRatio,
    yRatio: positionRatio.yRatio,
    widthRatio: positionRatio.widthRatio,
    heightRatio: positionRatio.heightRatio,
  }
}

function addToSection(section, key, item) {
  if (!section || !Array.isArray(section[key])) {
    return
  }

  section[key].push(item)
}

function sortExportCollections(context) {
  sortByPosition(context.textNodes)
  sortByPosition(context.ctaCandidates)
  sortByPosition(context.imageCandidates)
  sortByPosition(context.sections)

  for (var sectionIndex = 0; sectionIndex < context.sections.length; sectionIndex += 1) {
    var section = context.sections[sectionIndex]
    section.order = sectionIndex + 1
    sortByPosition(section.texts)
    sortByPosition(section.ctas)
    sortByPosition(section.images)
  }
}

function createQaModel(selection, context) {
  var pageBox = getSelectionBox(selection)
  var qaSections = createQaSections(context.sections, pageBox)
  var qaTexts = []
  var qaButtons = []
  var qaImages = []

  for (var textIndex = 0; textIndex < context.textNodes.length; textIndex += 1) {
    var qaText = createQaText(context.textNodes[textIndex], qaSections)
    if (qaText) {
      qaTexts.push(qaText)
    }
  }

  for (var ctaIndex = 0; ctaIndex < context.ctaCandidates.length; ctaIndex += 1) {
    var qaButton = createQaButton(context.ctaCandidates[ctaIndex], qaSections)
    if (qaButton) {
      qaButtons.push(qaButton)
    }
  }

  for (var imageIndex = 0; imageIndex < context.imageCandidates.length; imageIndex += 1) {
    var qaImage = createQaImage(context.imageCandidates[imageIndex], qaSections, pageBox)
    if (qaImage) {
      qaImages.push(qaImage)
    }
  }

  dedupeQaTexts(qaTexts)
  dedupeQaButtons(qaButtons)
  qaImages = refineQaImages(qaImages, pageBox)
  sortByPosition(qaTexts)
  sortByPosition(qaButtons)
  sortByPosition(qaImages)
  assignQaDisplayOrder(qaTexts, qaButtons, qaImages)

  for (var sectionIndex = 0; sectionIndex < qaSections.length; sectionIndex += 1) {
    var section = qaSections[sectionIndex]
    section.texts = filterItemsInSection(qaTexts, section)
    section.buttons = filterItemsInSection(qaButtons, section)
    section.keyImages = filterItemsInSection(qaImages, section)
  }

  return {
    page: {
      name: selection.length === 1 ? selection[0].name || figma.currentPage.name : figma.currentPage.name,
      width: pageBox.width,
      height: pageBox.height,
    },
    sections: qaSections,
    texts: qaTexts,
    buttons: qaButtons,
    keyImages: qaImages,
  }
}

function getSelectionBox(selection) {
  if (!selection || selection.length === 0) {
    return { x: 0, y: 0, width: 1920, height: 1 }
  }

  var minX = Infinity
  var minY = Infinity
  var maxX = -Infinity
  var maxY = -Infinity

  for (var index = 0; index < selection.length; index += 1) {
    var box = getAbsoluteBoundingBox(selection[index])
    minX = Math.min(minX, box.x)
    minY = Math.min(minY, box.y)
    maxX = Math.max(maxX, box.x + box.width)
    maxY = Math.max(maxY, box.y + box.height)
  }

  return {
    x: roundNumber(minX === Infinity ? 0 : minX),
    y: roundNumber(minY === Infinity ? 0 : minY),
    width: roundNumber(Math.max(1, maxX - minX)),
    height: roundNumber(Math.max(1, maxY - minY)),
  }
}

function createQaSections(sections, pageBox) {
  var candidates = []

  for (var index = 0; index < sections.length; index += 1) {
    var section = sections[index]
    if (!isUsefulQaSection(section, pageBox)) {
      continue
    }

    candidates.push({
      id: section.id,
      label: getQaSectionLabel(section, pageBox, candidates.length + 1),
      qaLabel: getQaSectionLabel(section, pageBox, candidates.length + 1),
      sourceName: section.name || '',
      order: 0,
      x: section.x,
      y: section.y,
      width: section.width,
      height: section.height,
      layerPath: Array.isArray(section.layerPath) ? section.layerPath.slice(0) : [],
      positionRatio: createPositionRatio(section, pageBox),
      texts: [],
      buttons: [],
      keyImages: [],
    })
  }

  sortByPosition(candidates)
  dedupeQaSections(candidates)

  for (var orderIndex = 0; orderIndex < candidates.length; orderIndex += 1) {
    candidates[orderIndex].order = orderIndex + 1
    candidates[orderIndex].label = getQaSectionLabel(candidates[orderIndex], pageBox, orderIndex + 1)
    candidates[orderIndex].qaLabel = candidates[orderIndex].label
  }

  return candidates
}

function isUsefulQaSection(section, pageBox) {
  if (!section || section.width <= 0 || section.height < 180) {
    return false
  }

  var name = section.sourceName || section.name || ''
  if (isTechnicalLayerName(name) && !hasSemanticSectionName(name)) {
    return false
  }

  var widthRatio = pageBox.width > 0 ? section.width / pageBox.width : 0
  return (section.height >= 250 && widthRatio >= 0.5) || hasSemanticSectionName(name) || SECTION_NAME_PATTERNS.test(name)
}

function getQaSectionLabel(section, pageBox) {
  var searchableName = String((section.sourceName || section.name || '') + ' ' + getLayerPathText(section.layerPath)).toLowerCase()
  var yRatio = pageBox.height > 0 ? (section.y - pageBox.y) / pageBox.height : 0

  if (/footer|disclaimer|유의|고지|약관|푸터|풋터/i.test(searchableName) || yRatio >= 0.9) return '푸터/디스클레이머'
  if (/하단\s*배너|bottom\s*banner/.test(searchableName)) return '하단 배너 영역'
  if (/구비|서류|document|03[_\s-]*서류/.test(searchableName)) return '구비서류 영역'
  if (/종류|type|program\s*type|프로그램\s*종류|02[_\s-]*프로그램/.test(searchableName)) return '상품 종류 영역'
  if (/개요|overview|smart|program|프로그램|01[_\s-]*bmw/.test(searchableName)) return '상품 개요 영역'
  if (/main|visual|hero|kv|메인|비주얼|상단/.test(searchableName) || yRatio <= 0.16) return 'Hero/KV 영역'
  if (/banner|notice|guide|안내/.test(searchableName) || yRatio >= 0.78) return '하단 배너 영역'
  if (yRatio < 0.42) return '상품 개요 영역'
  if (yRatio < 0.64) return '상품 종류 영역'
  if (yRatio < 0.78) return '구비서류 영역'
  return '하단 배너 영역'
}

function createQaText(textNode, qaSections) {
  if (!isUsefulQaText(textNode)) {
    return null
  }

  var section = findQaSectionForItem(textNode, qaSections)
  var importance = getTextImportance(textNode, section)
  var sectionLabel = section ? section.label : getLooseSectionLabel(textNode.positionRatio)
  var isNavigation = importance === 'nav' || NAV_TEXT_PATTERNS.test(getLayerPathText(textNode.layerPath))
  var isFooterDisclaimer = sectionLabel === '푸터/디스클레이머' || NOTE_TEXT_PATTERNS.test(textNode.text + ' ' + getLayerPathText(textNode.layerPath))
  var referenceOnly = isNavigation || isFooterDisclaimer || importance === 'note'

  return {
    id: textNode.id,
    text: textNode.text,
    characters: textNode.characters,
    normalizedText: normalizeText(textNode.text),
    compareText: createCompareText(textNode.text),
    qaGroupId: createQaGroupId(textNode, section, importance),
    displayOrder: 0,
    referenceOnly: referenceOnly,
    isNavigation: isNavigation,
    isFooterDisclaimer: isFooterDisclaimer,
    isLongText: isLongQaText(textNode.text),
    isPrimaryQaTarget: isPrimaryQaTarget(textNode, importance, sectionLabel, referenceOnly),
    importance: importance,
    sectionLabel: sectionLabel,
    sectionId: section ? section.id : '',
    tag: 'TEXT',
    fontSize: textNode.fontSize,
    fontWeight: textNode.fontWeight,
    x: textNode.x,
    y: textNode.y,
    width: textNode.width,
    height: textNode.height,
    layerPath: textNode.layerPath,
    positionRatio: copyPositionRatio(textNode.positionRatio),
  }
}

function isUsefulQaText(textNode) {
  if (!textNode || textNode.visible === false || readNumber(textNode.opacity, 1) <= 0) return false
  if (!textNode.text || normalizeText(textNode.text).length < 2) return false
  if (readNumber(textNode.fontSize, 0) < 7) return false
  if (isDecorativeLayerPath(textNode.layerPath)) return false
  return true
}

function getTextImportance(textNode, section) {
  var text = textNode.text || ''
  var pathText = getLayerPathText(textNode.layerPath)
  var fontSize = readNumber(textNode.fontSize, 0)

  if (NOTE_TEXT_PATTERNS.test(text + ' ' + pathText)) return 'note'
  if (NAV_TEXT_PATTERNS.test(pathText)) return 'nav'
  if (isRealButtonText(text) && BUTTON_LAYER_PATTERNS.test(pathText)) return 'button'
  if (fontSize >= 28) return 'title'
  if (section && textNode.y <= section.y + Math.max(180, section.height * 0.22) && fontSize >= 20) return 'title'
  return 'body'
}

function createQaGroupId(item, section, kind) {
  var sectionLabel = section ? section.label : getLooseSectionLabel(item.positionRatio)
  var layerText = getLayerPathText(item.layerPath) + ' ' + (item.name || '') + ' ' + (item.text || '')
  var yRatio = item.positionRatio && typeof item.positionRatio.yRatio === 'number' ? item.positionRatio.yRatio : 0
  var isButton = kind === 'button' || kind === 'primary' || kind === 'secondary'

  if (sectionLabel === '푸터/디스클레이머' || /footer|disclaimer|유의|고지|약관|푸터|풋터/i.test(layerText)) return 'footer-disclaimer'
  if (kind === 'heroImage') return 'hero-visual'

  if (sectionLabel === 'Hero/KV 영역') {
    if (/visual|image|img|kv|hero|메인|비주얼|이미지/i.test(layerText) && kind !== 'title' && kind !== 'body') return 'hero-visual'
    if (kind === 'title') return 'hero-title'
    return 'hero-body'
  }

  if (sectionLabel === '상품 종류 영역' && (kind === 'title' || /BMW\s*스마트\s*상품\s*종류|상품\s*종류|프로그램\s*종류/i.test(item.text || ''))) return 'product-type-section-title'
  if (sectionLabel === '상품 종류 영역' || /card|카드|type|종류/i.test(layerText)) {
    return 'product-type-card-' + getQaCardIndex(item, section)
  }

  if (sectionLabel === '구비서류 영역' || /table|document|서류|구비|표/i.test(layerText)) return 'document-table'
  if (sectionLabel === '하단 배너 영역' || isButton || yRatio >= 0.78) return 'bottom-cta'
  if (sectionLabel === '상품 개요 영역' && kind === 'title') return 'product-overview-title'
  if (sectionLabel === '상품 개요 영역') return 'product-overview-body'
  return getLooseQaGroupId(item, sectionLabel)
}

function getQaCardIndex(item, section) {
  if (!section || !section.width) return 1
  var centerX = item.x + (item.width || 0) / 2
  var ratio = (centerX - section.x) / section.width
  return Math.max(1, Math.min(3, Math.ceil(ratio * 3)))
}

function getLooseQaGroupId(item, sectionLabel) {
  var yRatio = item.positionRatio && typeof item.positionRatio.yRatio === 'number' ? item.positionRatio.yRatio : 0
  var xRatio = item.positionRatio && typeof item.positionRatio.xRatio === 'number' ? item.positionRatio.xRatio : 0
  return slugText(sectionLabel || 'section') + '-' + Math.round(yRatio * 20) + '-' + Math.round(xRatio * 6)
}

function createQaButton(candidate, qaSections) {
  if (!candidate || isDecorativeLayerPath(candidate.layerPath)) return null
  var text = trimText(candidate.text || '')
  if (!text || normalizeText(text).length < 2) return null
  if (!isRealQaButtonCandidate(candidate, text)) return null

  var section = findQaSectionForItem(candidate, qaSections)
  var sectionLabel = section ? section.label : getLooseSectionLabel(candidate.positionRatio)
  var isNavigation = NAV_TEXT_PATTERNS.test(getLayerPathText(candidate.layerPath))
  var isFooterDisclaimer = sectionLabel === '푸터/디스클레이머' || NOTE_TEXT_PATTERNS.test(text + ' ' + getLayerPathText(candidate.layerPath))
  var importance = isNavigation ? 'nav' : isPrimaryButtonText(text) ? 'primary' : 'secondary'
  return {
    id: candidate.id,
    label: text,
    text: text,
    normalizedText: normalizeText(text),
    compareText: createCompareText(text),
    qaGroupId: createQaGroupId(candidate, section, 'button'),
    displayOrder: 0,
    referenceOnly: isNavigation || isFooterDisclaimer,
    isNavigation: isNavigation,
    isFooterDisclaimer: isFooterDisclaimer,
    isLongText: false,
    isPrimaryQaTarget: !isNavigation && !isFooterDisclaimer,
    sectionLabel: sectionLabel,
    sectionId: section ? section.id : '',
    importance: importance,
    tag: 'button',
    x: candidate.x,
    y: candidate.y,
    width: candidate.width,
    height: candidate.height,
    layerPath: candidate.layerPath,
    positionRatio: copyPositionRatio(candidate.positionRatio),
  }
}

function isPrimaryButtonText(text) {
  return /(신청|상담|구매|견적|예약|문의|바로가기|확인|다음|apply|buy|contact|reserve|quote|submit)/i.test(text || '')
}

function createQaImage(imageNode, qaSections, pageBox) {
  if (!imageNode || imageNode.visible === false || isDecorativeImageNode(imageNode)) return null

  var kind = getQaImageKind(imageNode, pageBox)
  if (kind === 'iconOrGraphic') return null

  var section = findQaSectionForItem(imageNode, qaSections)
  var displayName = getQaImageDisplayName(kind)
  var sectionLabel = section ? section.label : getLooseSectionLabel(imageNode.positionRatio)
  var isFooterDisclaimer = sectionLabel === '푸터/디스클레이머'
  return {
    id: imageNode.id,
    name: displayName,
    text: displayName,
    sourceName: imageNode.name || '',
    normalizedText: normalizeText(displayName),
    compareText: createCompareText(displayName),
    qaGroupId: createQaGroupId(imageNode, section, kind),
    displayOrder: 0,
    referenceOnly: isFooterDisclaimer,
    isNavigation: false,
    isFooterDisclaimer: isFooterDisclaimer,
    isLongText: false,
    isPrimaryQaTarget: !isFooterDisclaimer,
    kind: kind,
    sectionLabel: sectionLabel,
    sectionId: section ? section.id : '',
    x: imageNode.x,
    y: imageNode.y,
    width: imageNode.width,
    height: imageNode.height,
    layerPath: imageNode.layerPath,
    positionRatio: copyPositionRatio(imageNode.positionRatio),
  }
}

function isDecorativeImageNode(imageNode) {
  if (imageNode.width < 120 || imageNode.height < 80) return true
  if (imageNode.type === 'VECTOR' || imageNode.type === 'LINE' || imageNode.type === 'BOOLEAN_OPERATION') return true
  var layerText = getLayerPathText(imageNode.layerPath) + ' ' + (imageNode.name || '')
  if (BLOCKED_QA_IMAGE_PATTERNS.test(layerText)) return true
  if (!hasImageFill(imageNode) && isRawLayerLikeName(imageNode.name || '')) return true
  return isDecorativeLayerPath(imageNode.layerPath) && !hasImageFill(imageNode)
}

function getQaImageKind(imageNode, pageBox) {
  var name = String((imageNode.name || '') + ' ' + getLayerPathText(imageNode.layerPath)).toLowerCase()
  var areaRatio = pageBox.width * pageBox.height > 0 ? (imageNode.width * imageNode.height) / (pageBox.width * pageBox.height) : 0
  var yRatio = imageNode.positionRatio && typeof imageNode.positionRatio.yRatio === 'number' ? imageNode.positionRatio.yRatio : 0

  if ((/hero|kv|visual|main|메인|비주얼/.test(name) || (yRatio <= 0.2 && areaRatio >= 0.08)) && hasImageFill(imageNode)) return 'heroImage'
  if (/하단\s*배너|bottom\s*banner|banner|배너/.test(name)) return 'bannerImage'
  if (hasImageFill(imageNode) || /image|img|photo|thumbnail|card|사진|이미지|썸네일|카드/.test(name)) return 'contentImage'
  return 'iconOrGraphic'
}

function findQaSectionForItem(item, sections) {
  var matchedSection = null
  var matchedArea = Infinity
  var itemCenterY = item.y + (item.height || 0) / 2
  var itemCenterX = item.x + (item.width || 0) / 2

  for (var index = 0; index < sections.length; index += 1) {
    var section = sections[index]
    var insideY = itemCenterY >= section.y && itemCenterY <= section.y + section.height
    var insideX = itemCenterX >= section.x && itemCenterX <= section.x + section.width
    if (insideY && insideX) {
      var area = section.width * section.height
      if (area < matchedArea) {
        matchedSection = section
        matchedArea = area
      }
    }
  }

  return matchedSection
}

function filterItemsInSection(items, section) {
  var results = []
  for (var index = 0; index < items.length; index += 1) {
    if (items[index].sectionId === section.id) {
      results.push(items[index])
    }
  }
  return results
}

function dedupeQaSections(sections) {
  for (var index = sections.length - 1; index >= 0; index -= 1) {
    var section = sections[index]
    var sourceName = section.sourceName || section.name || ''

    if (isTechnicalLayerName(sourceName) && !hasSemanticSectionName(sourceName)) {
      sections.splice(index, 1)
      continue
    }

    for (var compareIndex = 0; compareIndex < index; compareIndex += 1) {
      var other = sections[compareIndex]
      if (section.label === other.label && isSimilarBox(section, other, 12)) {
        sections.splice(index, 1)
        break
      }
      if (section.label === other.label && isContainedBox(section, other)) {
        sections.splice(index, 1)
        break
      }
      if (section.label === other.label && isContainedBox(other, section)) {
        sections.splice(compareIndex, 1)
        index -= 1
        break
      }
    }
  }
}

function dedupeQaTexts(texts) {
  var seen = {}
  for (var index = texts.length - 1; index >= 0; index -= 1) {
    var text = texts[index]
    var key = text.importance + ':' + text.sectionLabel + ':' + text.normalizedText
    if (seen[key]) {
      texts.splice(index, 1)
    } else {
      seen[key] = true
    }
  }
}

function dedupeQaButtons(buttons) {
  var seen = {}
  for (var index = buttons.length - 1; index >= 0; index -= 1) {
    var button = buttons[index]
    var key = button.sectionLabel + ':' + button.normalizedText
    if (seen[key]) {
      buttons.splice(index, 1)
    } else {
      seen[key] = true
    }
  }
}

function refineQaImages(images, pageBox) {
  var filteredImages = []
  for (var index = 0; index < images.length; index += 1) {
    var duplicateIndex = findDuplicateImageIndex(images[index], filteredImages)
    if (duplicateIndex === -1) {
      filteredImages.push(images[index])
    } else if (getImageCandidateScore(images[index], pageBox) > getImageCandidateScore(filteredImages[duplicateIndex], pageBox)) {
      filteredImages[duplicateIndex] = images[index]
    }
  }

  var heroIndex = findBestHeroImageIndex(filteredImages, pageBox)
  var refinedImages = []
  for (var imageIndex = 0; imageIndex < filteredImages.length; imageIndex += 1) {
    var image = filteredImages[imageIndex]
    if (image.kind === 'heroImage' && imageIndex !== heroIndex) {
      continue
    }
    refinedImages.push(image)
  }

  return refinedImages
}

function findDuplicateImageIndex(image, existingImages) {
  for (var index = 0; index < existingImages.length; index += 1) {
    var existing = existingImages[index]
    if (isSimilarBox(image, existing, 10) || getBoxOverlapRatio(image, existing) >= 0.88) {
      return index
    }
  }

  return -1
}

function getImageCandidateScore(image, pageBox) {
  var score = image.kind === 'heroImage' ? getHeroImageScore(image, pageBox) : 0
  var sourceName = image.sourceName || image.name || ''
  if (!isRawLayerLikeName(sourceName)) score += 2
  if (image.x >= pageBox.x && image.y >= pageBox.y && image.x + image.width <= pageBox.x + pageBox.width && image.y + image.height <= pageBox.y + pageBox.height) score += 2
  score += Math.min(3, (image.width * image.height) / Math.max(1, pageBox.width * pageBox.height) * 20)
  return score
}

function findBestHeroImageIndex(images, pageBox) {
  var bestIndex = -1
  var bestScore = -Infinity

  for (var index = 0; index < images.length; index += 1) {
    if (images[index].kind !== 'heroImage') continue
    var score = getHeroImageScore(images[index], pageBox)
    if (score > bestScore) {
      bestIndex = index
      bestScore = score
    }
  }

  return bestIndex
}

function getHeroImageScore(image, pageBox) {
  var score = 0
  var yRatio = image.positionRatio && typeof image.positionRatio.yRatio === 'number' ? image.positionRatio.yRatio : 1
  var widthRatio = pageBox.width > 0 ? image.width / pageBox.width : 0
  var sourceName = image.sourceName || image.name || ''

  score += Math.max(0, 1 - yRatio) * 10
  score += Math.min(1, widthRatio) * 4
  if (/hero|kv|visual|main|메인|비주얼/i.test(sourceName + ' ' + getLayerPathText(image.layerPath))) score += 4
  if (!isRawLayerLikeName(sourceName)) score += 1
  if (image.x >= pageBox.x && image.y >= pageBox.y && image.x + image.width <= pageBox.x + pageBox.width && image.y + image.height <= pageBox.y + pageBox.height) score += 2
  return score
}

function isSimilarBox(first, second, tolerance) {
  return Math.abs(first.x - second.x) <= tolerance
    && Math.abs(first.y - second.y) <= tolerance
    && Math.abs(first.width - second.width) <= tolerance
    && Math.abs(first.height - second.height) <= tolerance
}

function isContainedBox(inner, outer) {
  return inner.x >= outer.x
    && inner.y >= outer.y
    && inner.x + inner.width <= outer.x + outer.width
    && inner.y + inner.height <= outer.y + outer.height
}

function getBoxOverlapRatio(first, second) {
  var left = Math.max(first.x, second.x)
  var top = Math.max(first.y, second.y)
  var right = Math.min(first.x + first.width, second.x + second.width)
  var bottom = Math.min(first.y + first.height, second.y + second.height)
  var overlapArea = Math.max(0, right - left) * Math.max(0, bottom - top)
  var smallerArea = Math.min(first.width * first.height, second.width * second.height)
  if (smallerArea <= 0) return 0
  return overlapArea / smallerArea
}

function getLooseSectionLabel(positionRatio) {
  var yRatio = positionRatio && typeof positionRatio.yRatio === 'number' ? positionRatio.yRatio : 0
  if (yRatio < 0.16) return 'Hero/KV 영역'
  if (yRatio < 0.42) return '상품 개요 영역'
  if (yRatio < 0.64) return '상품 종류 영역'
  if (yRatio < 0.78) return '구비서류 영역'
  if (yRatio < 0.9) return '하단 배너 영역'
  return '푸터/디스클레이머'
}

function hasSemanticSectionName(name) {
  return /hero|kv|main[_\s-]*visual|footer|disclaimer|하단\s*배너|구비|서류|종류|프로그램|개요|smart|메인|비주얼|푸터|풋터|유의/i.test(name || '')
}

function isTechnicalLayerName(name) {
  return TECHNICAL_LAYER_NAME_PATTERNS.test(trimText(name || ''))
}

function isRawLayerLikeName(name) {
  return /^(image|img|graphic|icon|logo|vector|path|shape|rectangle|group|frame|blend|blende)([_\s-]?\d*)?$/i.test(trimText(name || ''))
}

function isRealQaButtonCandidate(candidate, text) {
  var layerText = getLayerPathText(candidate.layerPath)
  var searchable = text + ' ' + layerText + ' ' + (candidate.name || '')

  if (!isRealButtonText(text)) return false
  if (text.length > 32 || /\n|\r|•|·|※|\*/.test(text)) return false
  if (NAV_TEXT_PATTERNS.test(layerText)) return false
  if (/footer|푸터|disclaimer|디스클라이머|약관|저작권/i.test(searchable)) return false
  return BUTTON_LAYER_PATTERNS.test(layerText) || candidate.kind === 'BUTTON_TEXT_CTA'
}

function isRealButtonText(text) {
  return REAL_BUTTON_TEXT_PATTERNS.test(trimText(text || ''))
}

function getQaImageDisplayName(kind) {
  if (kind === 'heroImage') return 'Hero 대표 이미지'
  if (kind === 'bannerImage') return '하단 배너 이미지'
  return '주요 콘텐츠 이미지'
}

function trimText(value) {
  return String(value || '').replace(/^\s+|\s+$/g, '')
}

function isDecorativeLayerPath(layerPath) {
  var pathText = getLayerPathText(layerPath)
  if (!pathText) return false
  return DECORATIVE_LAYER_PATTERNS.test(pathText) && !/(image|img|photo|visual|kv|banner|thumbnail|background|이미지|사진|배너)/i.test(pathText)
}

function getLayerPathText(layerPath) {
  return Array.isArray(layerPath) ? layerPath.join(' ') : String(layerPath || '')
}

function sortByPosition(items) {
  items.sort(function (left, right) {
    if (left.y !== right.y) return left.y - right.y
    if (left.x !== right.x) return left.x - right.x
    return String(left.id || '').localeCompare(String(right.id || ''))
  })
}

function assignQaDisplayOrder(texts, buttons, images) {
  var items = []
  Array.prototype.push.apply(items, texts)
  Array.prototype.push.apply(items, buttons)
  Array.prototype.push.apply(items, images)
  sortByPosition(items)

  for (var index = 0; index < items.length; index += 1) {
    items[index].displayOrder = index + 1
  }
}

function isLongQaText(text) {
  return normalizeText(text || '').length >= 80
}

function isPrimaryQaTarget(item, importance, sectionLabel, referenceOnly) {
  if (referenceOnly) return false
  if (importance === 'nav' || sectionLabel === '푸터/디스클레이머') return false
  if (isDecorativeLayerPath(item.layerPath)) return false
  if (importance === 'title' || importance === 'button' || importance === 'primary' || importance === 'secondary') return true
  return hasMeaningfulTextCharacter(normalizeText(item.text || ''))
}

function isSectionCandidate(node, traversal) {
  if (!isTypeInList(node.type, SECTION_LIKE_TYPES) || traversal.depth === 0) {
    return false
  }

  var box = getAbsoluteBoundingBox(node)
  var rootBox = traversal.rootBox || { width: 0, height: 0 }
  var name = node.name || ''
  var widthRatio = rootBox.width > 0 ? box.width / rootBox.width : 0
  var isLargeBlock = box.height >= 250 && widthRatio >= 0.5
  var isNamedBlock = box.height >= 180 && SECTION_NAME_PATTERNS.test(name)

  return isLargeBlock || isNamedBlock
}

function isSelectedSectionRoot(node, traversal) {
  return traversal.depth === 0 && node.type === 'SECTION'
}

function isButtonLikeContainer(node) {
  var box = getAbsoluteBoundingBox(node)
  if (!isContainerNode(node) || box.width < 24 || box.height < 12) {
    return false
  }

  if (box.width > 360 || box.height > 80 || box.width / box.height < 1.2) {
    return false
  }

  return hasVisibleFill(node)
}

function isContainerNode(node) {
  return node && (node.type === 'FRAME' || node.type === 'GROUP' || node.type === 'INSTANCE' || node.type === 'COMPONENT')
}

function hasVisibleFill(node) {
  if (!Array.isArray(node.fills)) {
    return false
  }

  for (var fillIndex = 0; fillIndex < node.fills.length; fillIndex += 1) {
    var paint = node.fills[fillIndex]
    if (paint && paint.visible !== false && paint.type !== 'IMAGE') {
      return true
    }
  }

  return false
}

function isExportableTextNode(textNode) {
  if (!textNode || textNode.normalizedText === '') {
    return false
  }

  if (textNode.width < 2 || textNode.height < 2) {
    return false
  }

  if (isDecorativeTextNode(textNode)) {
    return false
  }

  return true
}

function isDecorativeTextNode(textNode) {
  var normalizedText = textNode.normalizedText || ''
  var rawText = textNode.text || textNode.characters || ''
  var fontSize = readNumber(textNode.fontSize, 0)

  if (!hasMeaningfulTextCharacter(normalizedText)) {
    return normalizedText.length <= 3
  }

  if (isCtaCandidate(textNode, rawText)) {
    return false
  }

  if (normalizedText.length <= 1 && fontSize > 0 && fontSize <= 10) {
    return true
  }

  if (normalizedText.length <= 2 && fontSize > 0 && fontSize <= 8 && textNode.width <= 16 && textNode.height <= 16) {
    return true
  }

  return false
}

function hasMeaningfulTextCharacter(value) {
  return /[A-Za-z0-9가-힣]/.test(value)
}

function normalizeText(value) {
  var text = String(value || '')
  if (text.normalize) {
    text = text.normalize('NFKC')
  }

  return text
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/[\u00A0\u1680\u180E\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]/g, ' ')
    .replace(/[.,，。ㆍ·:：;；!！?？"'“”‘’`´\-‐‑‒–—―_/\\()[\]{}<>《》]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^\s+|\s+$/g, '')
    .replace(/[A-Z]/g, function (letter) { return letter.toLowerCase() })
}

function createCompareText(value) {
  return normalizeText(value).replace(/\s+/g, '')
}

function slugText(value) {
  var text = normalizeText(value).replace(/[^a-z0-9가-힣]+/g, '-')
  return text.replace(/^-+|-+$/g, '') || 'section'
}

function addUniqueMatch(matches, match) {
  for (var matchIndex = 0; matchIndex < matches.length; matchIndex += 1) {
    if (matches[matchIndex] === match) {
      return
    }
  }

  matches.push(match)
}

function isCtaCandidate(node, text) {
  var searchableText = (node.name || '') + ' ' + (text || '')
  if (getMatchedKeywords(searchableText, CTA_KEYWORDS).length > 0) {
    return true
  }

  return matchesAnyPattern(searchableText, CTA_TEXT_PATTERNS)
}

function matchesAnyPattern(value, patterns) {
  var text = String(value || '')
  for (var patternIndex = 0; patternIndex < patterns.length; patternIndex += 1) {
    if (patterns[patternIndex].test(text)) {
      return true
    }
  }

  return false
}

function isImageCandidate(node) {
  var box = getAbsoluteBoundingBox(node)
  var name = node.name || ''

  if (!isNodeExportVisible(node) || box.width < 80 || box.height < 60 || DECORATIVE_LAYER_PATTERNS.test(name)) {
    return false
  }

  return hasImageFill(node) || (isImageLikeType(node.type) && getMatchedKeywords(name, IMAGE_KEYWORDS).length > 0)
}

function isImageLikeType(type) {
  return isTypeInList(type, IMAGE_LIKE_TYPES)
}

function isTypeInList(type, types) {
  for (var typeIndex = 0; typeIndex < types.length; typeIndex += 1) {
    if (types[typeIndex] === type) {
      return true
    }
  }

  return false
}

function hasImageFill(node) {
  if (node && node.kind === 'IMAGE_FILL') {
    return true
  }

  if (!Array.isArray(node.fills)) {
    return false
  }

  for (var fillIndex = 0; fillIndex < node.fills.length; fillIndex += 1) {
    var paint = node.fills[fillIndex]
    if (paint && paint.type === 'IMAGE' && paint.visible !== false) {
      return true
    }
  }

  return false
}

function getMatchedKeywords(value, keywords) {
  var normalized = normalizeText(value)
  var matches = []

  for (var keywordIndex = 0; keywordIndex < keywords.length; keywordIndex += 1) {
    var keyword = keywords[keywordIndex]
    if (normalized.indexOf(keyword.toLowerCase()) !== -1) {
      matches.push(keyword)
    }
  }

  return matches
}

function readFontName(fontName) {
  if (!fontName || fontName === figma.mixed) return { family: 'mixed', style: 'mixed' }
  return {
    family: fontName.family || '',
    style: fontName.style || '',
  }
}

function inferFontWeight(fontStyle) {
  var style = String(fontStyle || '').toLowerCase()
  if (style.indexOf('thin') !== -1) return 100
  if (style.indexOf('extra light') !== -1 || style.indexOf('extralight') !== -1 || style.indexOf('ultra light') !== -1) return 200
  if (style.indexOf('light') !== -1) return 300
  if (style.indexOf('medium') !== -1) return 500
  if (style.indexOf('semi bold') !== -1 || style.indexOf('semibold') !== -1 || style.indexOf('demi bold') !== -1) return 600
  if (style.indexOf('extra bold') !== -1 || style.indexOf('extrabold') !== -1 || style.indexOf('ultra bold') !== -1) return 800
  if (style.indexOf('black') !== -1 || style.indexOf('heavy') !== -1) return 900
  if (style.indexOf('bold') !== -1) return 700
  if (style.indexOf('regular') !== -1 || style.indexOf('normal') !== -1 || style.indexOf('book') !== -1) return 400
  return ''
}

function readLineHeight(lineHeight) {
  if (!lineHeight || lineHeight === figma.mixed) {
    return { display: 'mixed', px: '', percentFontSize: '', percent: '' }
  }

  if (lineHeight.unit === 'AUTO') {
    return { display: 'AUTO', px: '', percentFontSize: '', percent: '' }
  }

  var value = readNumber(lineHeight.value, '')
  if (lineHeight.unit === 'PIXELS') {
    return { display: value + 'px', px: value, percentFontSize: '', percent: '' }
  }

  if (lineHeight.unit === 'PERCENT') {
    return { display: value + '%', px: '', percentFontSize: value, percent: value }
  }

  return { display: value, px: '', percentFontSize: '', percent: '' }
}

function readLetterSpacing(letterSpacing) {
  if (!letterSpacing || letterSpacing === figma.mixed) return 'mixed'
  var value = readNumber(letterSpacing.value, '')
  if (value === '') return ''
  return letterSpacing.unit === 'PERCENT' ? value + '%' : value + 'px'
}

function serializeFills(fills) {
  if (!Array.isArray(fills)) return []

  var serializedFills = []

  for (var fillIndex = 0; fillIndex < fills.length; fillIndex += 1) {
    var paint = fills[fillIndex]
    if (!paint) {
      continue
    }

    var serialized = {
      type: paint.type,
      visible: paint.visible !== false,
      opacity: roundNumber(readNumber(paint.opacity, 1)),
    }

    if (paint.type === 'SOLID' && paint.color) {
      serialized.color = getRgbColor(paint.color, serialized.opacity)
    }

    if (paint.type === 'IMAGE') {
      serialized.scaleMode = paint.scaleMode || ''
      serialized.imageHash = paint.imageHash || ''
    }

    serializedFills.push(serialized)
  }

  return serializedFills
}

function getPaintColor(fills) {
  if (!Array.isArray(fills)) return ''

  for (var fillIndex = 0; fillIndex < fills.length; fillIndex += 1) {
    var solidFill = fills[fillIndex]
    if (solidFill && solidFill.type === 'SOLID' && solidFill.visible !== false && solidFill.color) {
      return getRgbColor(solidFill.color, readNumber(solidFill.opacity, 1))
    }
  }

  return ''
}

function getRgbColor(color, opacity) {
  var red = toRgbChannel(color.r)
  var green = toRgbChannel(color.g)
  var blue = toRgbChannel(color.b)
  var alphaSource = opacity !== null && opacity !== undefined ? opacity : color.a
  var alpha = readNumber(alphaSource, 1)

  if (alpha < 1) return 'rgba(' + red + ', ' + green + ', ' + blue + ', ' + roundNumber(alpha) + ')'
  return '#' + toHex(red) + toHex(green) + toHex(blue)
}

function getAbsoluteBoundingBox(node) {
  var box = node.absoluteBoundingBox || {}

  return {
    x: roundNumber(readNumber(box.x, 0)),
    y: roundNumber(readNumber(box.y, 0)),
    width: roundNumber(readNumber(box.width, 0)),
    height: roundNumber(readNumber(box.height, 0)),
  }
}

function isNodeExportableInTraversal(node, traversal) {
  if (!node || traversal.hidden || !isNodeExportVisible(node) || !hasUsableAbsoluteBoundingBox(node)) {
    return false
  }

  if (traversal.depth === 0) {
    return true
  }

  return overlapsRootBox(getAbsoluteBoundingBox(node), traversal.rootBox)
}

function isNodeExportVisible(node) {
  return Boolean(node && node.visible !== false && readNumber(node.opacity, 1) > 0)
}

function hasUsableAbsoluteBoundingBox(node) {
  if (!node || !node.absoluteBoundingBox) {
    return false
  }

  var box = getAbsoluteBoundingBox(node)
  return box.width > 0 && box.height > 0
}

function overlapsRootBox(box, rootBox) {
  if (!box || !rootBox || rootBox.width <= 0 || rootBox.height <= 0) {
    return false
  }

  return box.x < rootBox.x + rootBox.width
    && box.x + box.width > rootBox.x
    && box.y < rootBox.y + rootBox.height
    && box.y + box.height > rootBox.y
}

function readMixedNumber(value) {
  if (value === figma.mixed) return 'mixed'
  return readNumber(value, '')
}

function readNumber(value, fallback) {
  var number = Number(value)
  return typeof number === 'number' && isFinite(number) ? roundNumber(number) : fallback
}

function toRgbChannel(value) {
  return Math.round(Math.max(0, Math.min(1, Number(value) || 0)) * 255)
}

function toHex(value) {
  var hex = Math.max(0, Math.min(255, Number(value) || 0)).toString(16)
  return hex.length === 1 ? '0' + hex : hex
}

function roundNumber(value) {
  return Math.round(value * 100) / 100
}

function roundRatio(value) {
  return Math.round(value * 10000) / 10000
}
