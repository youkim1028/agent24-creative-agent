# Prompt Design

실제 지시는 `src/agent/prompt.ts`에서 심사위원이 바로 확인할 수 있다.

팀 모드에서는 역할별 프롬프트가 분리되어 있다.

- `src/team/prompts.ts`: Research Planner, Evidence Analyst, Narrative Architect,
  Art Director, Deck Composer, Independent Critic, Deck Repairer 프롬프트.
- `src/agent/prompt.ts`: 단일 에이전트 fallback 오케스트레이터.
- `src/providers/xai-prompt.ts`: Grok 검색 작업자는 지정 국가와 언어에서 실제 X 게시물만 제한된 수로 추출한다.

- 역할 분리: GPT는 판단·글쓰기, Grok은 `research_x` 안의 X 검색만 담당한다.
- Grok 경계: 전체 요약, 감성 점수, 사실 검증, 추천, 디자인 판단을 금지한다.
- 지역 경계: `<research_markets>`의 국가와 검색 언어를 그대로 전달하고 임의 국가를 추가하지 않는다.
- 도구 순서: 검색 → 논지 검토 → 전체 DeckSpec → 검증 → 렌더링을 명시한다.
- 근거 경계: 검색 결과에 없던 URL·핸들·인용·날짜·참여 수치를 만들지 않는다.
- 사실 경계: X 게시물은 “사람들이 무엇을 말하는가”에만 근거가 된다.
- 복구: 치명 오류는 보고된 부분만 고쳐 최대 두 번 재검증한다.
- 종료: 렌더 성공 뒤 링크와 중요한 한계 하나만 말하고 멈춘다.
- 모의 모드: 모든 자료에 리허설임을 표시하고 실제 증거처럼 표현하지 않는다.

코드도 프롬프트를 신뢰하지 않는다. Zod 스키마가 인자를 제한하고, 검증기가 수치 근거·슬라이드
순서·밀도를 검사하며, 실행 컨텍스트가 마지막으로 통과한 DeckSpec의 동일성을 확인한다.
