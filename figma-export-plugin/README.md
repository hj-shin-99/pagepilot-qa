# PagePilot QA Figma Export Plugin

Figma에서 선택한 프레임/섹션의 디자인 데이터를 외부 서비스로 전송하지 않고 로컬 JSON으로 내보내는 PagePilot QA `시안 비교 QA`용 플러그인입니다.

## 보안 원칙

- 플러그인 코드는 네트워크 요청을 하지 않습니다.
- OpenAI API, Claude API, Gemini API 등 외부 AI API를 호출하지 않습니다.
- Figma API 토큰을 사용하지 않습니다.
- 외부 DB나 서버에 데이터를 저장하지 않습니다.
- 추출한 JSON은 사용자의 로컬 클립보드 또는 로컬 다운로드 파일로만 처리됩니다.

## 설치 방법: Import plugin from manifest

1. Figma 데스크톱 앱을 엽니다.
2. 상단 메뉴에서 `Plugins` → `Development` → `Import plugin from manifest...`를 선택합니다.
3. 이 저장소의 `figma-export-plugin/manifest.json` 파일을 선택합니다.
4. Development 플러그인 목록에 `PagePilot QA Design Export`가 추가되면 설치가 완료됩니다.

## 사용 방법

1. Figma 파일에서 PagePilot QA로 비교할 프레임, 섹션, 컴포넌트, 인스턴스, 그룹을 선택합니다.
2. `Plugins` → `Development` → `PagePilot QA Design Export`를 실행합니다.
3. 플러그인 UI에서 `Export JSON`을 누릅니다.
4. 결과를 바로 붙여 넣으려면 `Copy JSON`을 누릅니다.
5. 파일로 보관하려면 `Download JSON`을 누릅니다.
6. PagePilot QA의 `시안 비교 QA` 영역에 JSON을 붙여 넣거나 업로드한 뒤 URL 검사를 실행합니다.

## 추출 데이터

- TEXT 노드: `text`, `normalizedText`, `fontFamily`, `fontStyle`, `fontSize`, `fontWeight`, `lineHeight`, `letterSpacing`, `color`, `opacity`, `x`, `y`, `width`, `height`, `layerPath`, `positionRatio`
- CTA 후보: 노드 이름 또는 텍스트에 `button`, `btn`, `cta`, `link`, `더보기`, `자세히`, `신청`, `구매`, `상담` 등이 포함된 항목과, 채움이 있는 버튼형 프레임/그룹/인스턴스 안의 텍스트 항목
- 이미지/아이콘 후보: 이미지 fill, 벡터/도형 기반 그래픽, 이름에 이미지/아이콘 관련 키워드가 포함된 항목
- 섹션 후보: 선택 루트 바로 아래의 Frame, Group, Instance, Component, Section 계열 노드를 `sections`로 묶고, 각 섹션 안의 `texts`, `ctas`, `images`를 함께 제공합니다.
- `textNodes`, `ctaCandidates`, `imageCandidates`, `sections` 및 각 섹션 내부 배열은 모두 위에서 아래, 왼쪽에서 오른쪽 순서로 정렬됩니다.
- 빈 텍스트, 너무 작은 텍스트, 짧은 장식용 기호 텍스트는 비교 후보에서 보수적으로 제외됩니다.

## JSON 구조

내보낸 JSON은 PagePilot QA `시안 비교 QA`가 바로 읽을 수 있도록 기존 `document.children` 트리와 `textNodes`, `ctaCandidates`, `imageCandidates` 구조를 유지하면서 섹션 비교용 필드를 추가합니다. `schema` 값은 기존과 동일한 `pagepilot-qa.design-export.v1`입니다.

```json
{
  "schema": "pagepilot-qa.design-export.v1",
  "source": {
    "tool": "figma-plugin",
    "localOnly": true,
    "network": "disabled"
  },
  "document": {
    "type": "PAGE",
    "children": []
  },
  "textNodes": [],
  "ctaCandidates": [],
  "imageCandidates": [],
  "sections": []
}
```

## 추가 JSON 필드

- `normalizedText`: 공백을 정리하고 소문자화한 비교용 텍스트입니다. TEXT 노드와 CTA 후보에 포함됩니다.
- `layerPath`: 선택한 루트부터 해당 노드까지의 Figma 레이어 이름 배열입니다.
- `positionRatio`: 선택한 루트의 bounds를 기준으로 한 `xRatio`, `yRatio`, `widthRatio`, `heightRatio`입니다.
- `sections`: 선택 루트의 직계 섹션 후보 배열입니다. 각 항목은 `name`, `x`, `y`, `width`, `height`, `order`, `texts`, `ctas`, `images`를 포함합니다.

`textNodes`, `ctaCandidates`, `imageCandidates`는 기획 검토용 부가 정보이며, 기존 Design QA 비교 호환성을 위해 계속 제공됩니다. 새 `sections` 배열은 PagePilot QA `시안 비교 QA`에서 섹션 단위 비교와 위치 기반 매칭을 더 안정적으로 수행하기 위한 부가 정보입니다.
