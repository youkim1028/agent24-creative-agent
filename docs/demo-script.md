# 2분 데모 대본

## 0:00–0:18 · 문제

“X에는 지금 반응이 있지만, 게시물 모음은 발표 자료가 아닙니다. 검색과 논지 작성이 한 모델에
섞이면 최신성, 출처, 판단 근거도 설명하기 어렵습니다.”

## 0:18–0:35 · 해결책

“DeckForge X는 Grok에게 X 검색만 맡기고 GPT 역할 팀이 논지를 설계합니다. 코드는 근거 누락을
검사하고, 검증된 동일 덱만 PPTX로 만듭니다. 오른쪽 화면은 도구 이벤트 원본입니다.”

## 0:35–1:25 · 실행

1. 실제 키가 설정된 두 공급자 배지를 확인한다. `MOCK`이면 제출 영상 녹화를 중단한다.
2. “한국 AI 영상 크리에이터의 최근 반응과 다음 기능 우선순위” 예시를 실행한다.
3. 세컨드 화면에서 아래 순서를 짚는다. 이름은 현재 기본값인 `AGENT_ARCHITECTURE=team` 기준이다.
   - `agent_call` / `agent_result` · **research_planner** — 주제 레인과 디자인 비판 레인을 나눈다.
   - `youtube_search`, `hacker_news_search`, `x_research`, xAI `x_search` output item — 검색 요청·응답과 GCS hit/miss.
   - `community_research_result` — 중복 제거된 게시물과 출처 카탈로그 전체.
   - **evidence_analyst → narrative_architect → art_director → deck_composer** 순 인수인계.
   - **independent_critic** — 필요하면 같은 **deck_composer**의 `stage=repair` → 같은
     **independent_critic**의 `stage=recheck`까지. 고유 Agent는 항상 6개다.
   - `agent_call` payload를 한 번 열어 `request.instructions`와 `request.input`이 실제로 모델에
     보낸 값 그대로임을 보여준다.
4. 결과 화면의 출처와 PPTX 다운로드를 보여준다.

`AGENT_ARCHITECTURE=single`로 발표할 경우 3번은 `research_x` → `review_outline` →
`validate_deck` → `evaluate_deck` → `render_deck`으로 바꿔 읽는다. 두 목록을 섞지 않는다.

## 1:25–1:48 · 즉석 변화

“이번에는 특정 계정만, 최근 7일만 보고 3장으로 만들어줘”라고 조건을 바꾼다. 검색 필터,
슬라이드 상한, 근거가 함께 바뀌는 모습을 보여준다. 수치 근거가 없으면 숫자를 제거하는 것도 설명한다.

## 1:48–2:00 · 마무리

“Grok은 지금의 신호를 찾고, GPT 팀은 논지를 만들고, 코드는 검증을 강제합니다. 그래서 예상 밖 입력에도
각 단계의 책임과 실패 지점을 실시간으로 설명할 수 있습니다.”

## 리허설에서 먼저 재야 하는 것

대본의 50초·23초 구간은 아직 실측값이 아니다. 실제 키로 팀 파이프라인을 최소 한 번 완주해
아래를 기록한 뒤에야 이 타이밍을 확정할 수 있다.

- 첫 런 총 소요 시간(모델 6회 또는 수리 포함 8회)과 두 번째 런 소요 시간.
- `AGENT_MAX_TOTAL_TOKENS=500000` 안에서 끝나는지, 어느 역할에서 예산이 가장 많이 줄어드는지.
- `narrative_architect`와 `deck_composer`가 각각 32,000 토큰 상한에서 잘리지 않는지. 잘리면
  `incomplete` 사유와 함께 런이 멈추므로 해당 `AGENT_*_MAX_OUTPUT_TOKENS`를 조정한다.
- 라이브 데모에서 지연을 줄이려면 `.env`에 `OPENAI_CRITICAL_SERVICE_TIER=priority`를 설정한다
  (기본은 auto, 계정 eligibility 필요).

측정 결과 두 번째 런이 구간에 안 들어가면, 즉석 변화를 새 런 대신 이미 끝난 런의 근거·필터
차이를 설명하는 방식으로 바꾼다.

## 예상 질문

- **왜 세컨드 화면 payload가 이렇게 긴가요?** 요약본이 아니라 Responses API에 넘긴 요청 객체와
  모델 출력 원본을 그대로 싣기 때문이다. 같은 객체를 SDK 호출과 이벤트에 함께 쓰므로 화면과
  실제 요청이 어긋날 수 없다.
- **Grok도 OpenAI SDK로 부르던데 규칙 충족인가요?** GPT 역할 호출이 OpenAI Responses API를
  직접 사용한다. Grok은 xAI 엔드포인트를 같은 클라이언트 형태로 호출할 뿐이며, 규칙 충족 근거는
  GPT 호출 쪽이다.
- **근거가 하나도 안 나오면요?** 렌더를 거부한다. 본문 슬라이드에 커뮤니티 출처가 하나도 없으면
  평가가 error로 막고, 카탈로그에 없는 URL을 인용해도 코드가 막는다. 실패 사유는 화면과 트레이스에
  그대로 남는다.

녹화 전 서버를 재시작해 메모리 trace를 비우고 개인 알림과 계정 정보를 숨긴다. 실제 모드 배지·PPTX
열림·원본 이벤트 가독성을 확인한다.
1분 55초 안팎으로 편집하고 일부공개 링크를 다른 Google 계정에서 다시 연다.
