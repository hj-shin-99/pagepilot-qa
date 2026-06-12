# PagePilot QA Figma Export Plugin

Figma에서 선택한 프레임/섹션의 디자인 데이터를 외부 서비스로 전송하지 않고 로컬 JSON으로 내보내는 PagePilot QA용 플러그인입니다.

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
6. PagePilot QA의 Design QA 영역에 JSON을 붙여 넣거나 업로드한 뒤 URL 검사를 실행합니다.

## 추출 데이터

- TEXT 노드: `text`, `fontFamily`, `fontStyle`, `fontSize`, `fontWeight`, `lineHeight`, `letterSpacing`, `color`, `opacity`, `x`, `y`, `width`, `height`
- CTA 후보: 노드 이름 또는 텍스트에 `button`, `btn`, `cta`, `link`, `더보기`, `자세히`, `신청`, `구매`, `상담` 등이 포함된 항목
- 이미지/아이콘 후보: 이미지 fill, 벡터/도형 기반 그래픽, 이름에 이미지/아이콘 관련 키워드가 포함된 항목

## JSON 구조

내보낸 JSON은 PagePilot QA Design QA가 바로 읽을 수 있도록 `document.children` 트리에 Figma REST 응답과 유사한 TEXT 노드 구조를 포함합니다.

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
  "imageCandidates": []
}
```

`textNodes`, `ctaCandidates`, `imageCandidates`는 기획 검토용 부가 정보이며, Design QA 비교는 `document.children` 아래의 TEXT 노드를 기준으로 동작합니다.
