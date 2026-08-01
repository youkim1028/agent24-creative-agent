# Prompt Design

팀 역할 지시는 `src/team/prompts.ts`, 단일 fallback 지시는 `src/agent/prompt.ts`에서
심사위원이 바로 확인할 수 있다.

팀 모드에서는 역할별 프롬프트가 분리되어 있다.

- `src/team/prompts.ts`: Research Planner, Evidence Analyst, Narrative Architect,
  Art Director, Deck Composer, Independent Critic의 정확히 6개 역할 프롬프트와
  Deck Composer 재호출용 repair 지시.
- `src/agent/prompt.ts`: 단일 에이전트 fallback 오케스트레이터.
- `src/providers/xai-prompt.ts`: Grok 검색 작업자는 지정 국가와 언어에서 실제 X 게시물만 제한된 수로 추출한다.

- 역할 분리: GPT는 판단·글쓰기, Grok은 `research_x` 안의 X 검색만 담당한다.
- Grok 경계: 전체 요약, 감성 점수, 사실 검증, 추천, 디자인 판단을 금지한다.
- 지역 경계: `<research_markets>`의 국가와 검색 언어를 그대로 전달하고 임의 국가를 추가하지 않는다.
- 도구 순서: 계획 → X/YouTube/Hacker News 검색 → 근거 → 서사 → 아트 디렉션 → DeckSpec → 비평·검증 → 렌더링을 명시한다.
- 근거 경계: 검색 결과에 없던 URL·핸들·인용·날짜·참여 수치를 만들지 않는다.
- 사실 경계: X 게시물은 “사람들이 무엇을 말하는가”에만 근거가 된다.
- 복구: 치명 오류는 보고된 부분만 고쳐 최대 두 번 재검증한다.
- 아트 인수인계: NarrativeSpec의 모든 slide ID에 한 개씩 지시하고, Composer가 해당
  `visualDirective`를 정확히 복사하도록 한다.
- 시각자료 경계: Art Director는 `none/photo/screenshot/chart/diagram` 중 하나만 고른다.
  차트는 사용자 제공 숫자, 구조도는 NarrativeSpec의 관계만 사용하며 장식용 시각자료를 금지한다.
- 종료: 렌더 성공 뒤 링크와 중요한 한계 하나만 말하고 멈춘다.
- 모의 모드: 모든 자료에 리허설임을 표시하고 실제 증거처럼 표현하지 않는다.

- 빈 입력: 한 레인에 쓸 게시물이 없으면 Evidence Analyst는 그 레인을 비우고 한계로 기록하며,
  Narrative Architect는 근거가 없는 beat를 버리거나 열린 질문으로 남긴다. 사전지식으로 채우지 않는다.

## 프롬프트가 아니라 코드가 강제하는 것

Zod 스키마가 인자와 역할 출력을 제한하고, 검증기가 차트 숫자·구조도 노드·이미지 해시·슬라이드 순서·밀도를 검사하며,
실행 컨텍스트가 마지막으로 통과한 DeckSpec의 동일성을 확인한다. 팀 모드에서는 Composer 수리 1회와
Critic 재검토 1회가 코드로 고정되고, 카탈로그에 없는 인용과 역할 간 순서·근거·디렉티브 drift는 코드가 차단한다.

반대로 프롬프트에만 의존하는 지시도 구분해서 말한다. 단일 fallback의 “재검증 두 번까지”는 코드
카운터가 아니라 모델의 순응에 기대며, 상한은 `MAX_TOOL_ROUNDS` 8회뿐이다.
