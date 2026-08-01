# DeckForge X

실시간 X 대화, YouTube 공개 댓글, Hacker News 토론을 3~5장의 의사결정용 PPTX로 바꾸는 Creative 트랙 에이전트입니다.
Grok은 X 검색만 담당하고, YouTube Data API와 HN Search API는 공개 대화를 수집하며, GPT는 논지와 슬라이드를 설계합니다. 결정론적 코드는
근거 누락·텍스트 과밀·슬라이드 순서를 검사하며, 같은 실행에서 검증된 덱만 렌더링합니다.

## 빠른 시작

Node.js 20 이상이 필요합니다. API 키가 없어도 모든 화면과 도구 순서를 모의 실행할 수 있습니다.

```powershell
npm install
Copy-Item .env.example .env
npm run dev
```

- 메인 화면: <http://localhost:3000>
- 가공하지 않은 도구 이벤트: <http://localhost:3000/trace.html>

키가 없으면 화면에 `MOCK`이 표시되고 모의 X·YouTube·Hacker News 검색과 6-Agent 인수인계가 재현됩니다. 이 덱을
실제 근거처럼 발표하면 안 됩니다. 실데모 전 `.env`에 아래 값을 넣으세요.

```dotenv
OPENAI_API_KEY=...
OPENAI_MODEL=gpt-5.6-sol
OPENAI_FAST_MODEL=gpt-5.6-luna
OPENAI_CRITICAL_MODEL=gpt-5.6-sol
OPENAI_REASONING_EFFORT=low
OPENAI_CRITICAL_REASONING_EFFORT=high
OPENAI_STANDARD_REASONING_EFFORT=medium
# 라이브 데모처럼 지연이 중요할 때만 priority로 올립니다(계정 eligibility·별도 과금 필요).
OPENAI_CRITICAL_SERVICE_TIER=auto
XAI_API_KEY=...
GROK_MODEL=grok-4.5
YOUTUBE_ENABLED=true
YOUTUBE_API_KEY=...
HACKER_NEWS_ENABLED=true
PEXELS_API_KEY=...
UNSPLASH_ACCESS_KEY=...
```

이미지 검색은 슬라이드당 후보 3개, 덱당 선택 이미지 8개, 덱당 검색 호출 12회가 기본이며,
모든 슬라이드에 이미지를 쓰는 구성도 상한에 막히지 않습니다. 비용 방어는 공급자별 일일 쿼터가 담당합니다.
Pexels와 Unsplash는 각각 로컬 일일 호출 카운터를 가지며 설정 예산의 80%에서 자동 중지합니다.
HTTP 429 응답은 같은 실행에서 재시도하지 않고 장기 backoff로 전환합니다. 검색 결과 중 최종 선택된
후보만 다운로드합니다. 사용자 업로드 원본은 로컬에 머물며 OpenAI 입력에는 파일명·보드 라벨·크기만
전달됩니다. 선택된 업로드는 해시가 고정된 렌더 자산으로 복사되고 실행 종료 후 업로드 원본과 미선택
파일은 자동 삭제됩니다. 공식 이미지 URL은 `OFFICIAL_IMAGES_ENABLED=true`와
`OFFICIAL_IMAGE_ALLOWED_HOSTS=brand.example.com,...`을 함께 설정해야 합니다. Dribbble은 현재
일반 검색 API가 아니라 사용자가 붙여 넣은 공개 디자인 레퍼런스 링크로만 사용하며 덱에 복사하지 않습니다.

시각자료는 사진으로 한정되지 않습니다. Art Director가 슬라이드마다 `none`, `photo`,
`screenshot`, `chart`, `diagram` 중 하나를 고릅니다. 사진은 제한된 공급자 검색을 거치고,
스크린샷은 사용자 업로드나 허용된 공식 URL만 사용합니다. 차트는 사용자 브리프에 실제로 존재하는
숫자형 `stats`만 네이티브 PowerPoint 차트로 렌더하며, 구조도는 검증된 불릿을 편집 가능한
PowerPoint 도형과 연결선으로 렌더합니다. 숫자나 노드가 부족하면 장식물을 만들지 않고 렌더를 차단합니다.

추론 토큰은 역할별 출력 상한을 함께 소모합니다. 그래서 팀 역할 상한은
`AGENT_*_MAX_OUTPUT_TOKENS`로 각각 조정하며, 기본값은 12,000~32,000입니다.
전체 GPT 예산은 `AGENT_MAX_TOTAL_TOKENS=500000`입니다. 이 값들은 예약량이 아니라
상한이므로 실제 사용량만 과금되며, 상한에서 잘리면 불완전한 JSON을 파싱하지 않고 멈춥니다.

팀 모드에서는 planner/evidence를 `OPENAI_FAST_MODEL`, narrative/art/composer/critic을
`OPENAI_CRITICAL_MODEL`로 실행합니다. Reasoning effort는 역할 성격에 따라 나뉩니다:
서사 판단이 핵심인 narrative architect만 `OPENAI_CRITICAL_REASONING_EFFORT`(기본 high)를 쓰고,
출력이 강하게 제약된 art director·deck composer·independent critic은
`OPENAI_STANDARD_REASONING_EFFORT`(기본 medium)를 씁니다. Critical 역할의 service tier는 기본
`auto`이며, 라이브 데모처럼 지연이 중요할 때 `OPENAI_CRITICAL_SERVICE_TIER=priority`로 올립니다. 수리가 필요하면
새 에이전트를 추가하지 않고 Deck Composer가 `repair`, Independent Critic이 `recheck` 단계로 다시 호출됩니다.
수리 후에도 품질 게이트를 통과하지 못하면 PPTX는 저장하지 않되, 검토용 덱 사양과 차단 사유를 응답으로 반환합니다.

검색 메모리를 쓰려면 GCS API 키를 넣는 대신 Google Cloud Storage 버킷과 프로젝트 ID를
설정하고, 로컬에서는 `gcloud auth application-default login`으로 인증합니다.
`.env`의 `GCS_MEMORY_ENABLED=true`, `GCS_BUCKET`, `GCS_PROJECT_ID`를 채우면 됩니다.
X·YouTube·Hacker News 결과는 `v5/{platform}/{lane}/{identity-hash}.json`으로 분리됩니다. 캐시 키는
플래너가 매 런 새로 쓰는 검색어가 아니라 브리프 기반 시드의 해시라서, 같은 브리프를 반복 실행하면
캐시가 실제로 재사용됩니다. 원본 브리프나 검색어는
오브젝트 이름과 레코드에 저장하지 않습니다. 만료 레코드는 재사용되지 않지만 자동 삭제되지는 않으므로
비공개 버킷 IAM과 짧은 GCS lifecycle 삭제 규칙을 함께 설정하세요.

키는 각 공급자 콘솔에서 발급하며 GitHub 계정·GitHub Billing과 별개입니다. API 사용은 공급자별
결제/크레딧이 필요할 수 있습니다. `.env`는 Git에서 제외되어 있으므로 키를 코드, 화면, 영상,
이벤트 payload에 붙여 넣지 마세요.

## 파이프라인

1. Research Planner가 주제 불만과 AI PPT·디자인 비판을 별도 검색 레인으로 만듭니다.
2. X·YouTube·Hacker News 검색 도구가 GCS 캐시 또는 실검색에서 제한된 공통 `CommunityPost` 레코드를 만듭니다. YouTube는 시장별 `regionCode`로 발견하지만 댓글 국가는 추정하지 않으며, 국가별 직접 신호는 X를 우선합니다.
3. Evidence Analyst → Narrative Architect → Art Director가 근거·서사·시각자료 의도를 strict JSON으로 인수인계합니다.
4. 범용 시각자료 도구가 사진·스크린샷은 업로드·허용된 공식 URL·Pexels·Unsplash에서 해결하고, 차트·구조도는 네이티브 PowerPoint 생성 계획으로 보존합니다.
5. Deck Composer가 DeckSpec을 조립하면 코드가 같은 실행에서 받은 이미지 ID·경로·SHA-256을 고정 주입하고, 검증된 stats·bullets만 차트·구조도로 렌더합니다.
6. 여섯 번째 역할인 Independent Critic과 코드 검증기가 실패 영역만 지적하고 한 번의 국소 수정을 허용합니다.
7. 이미지 해시와 차트·구조도 입력 계약까지 다시 확인한 동일 DeckSpec만 다운로드 가능한 PPTX/JSON으로 저장합니다.

`AGENT_ARCHITECTURE=single`은 기존 tool-loop를 fallback으로 유지합니다.

`/trace.html`에는 각 역할에 실제로 보낸 Responses API 요청 객체와 모델 출력 원본, Grok X Search
output item, YouTube 영상·댓글 및 Hacker News 검색 요청과 정규화 결과, 범용 시각자료 계획과 이미지 검색·다운로드 계약, 수집된 커뮤니티 게시물이 가공 없이 표시됩니다. 결과 이벤트는
스키마 파싱 전에 방출하므로 계약 위반도 화면에 남습니다. 키, 인증 헤더, 쿠키는 이벤트 객체에
넣지 않습니다. trace는 최근 250건만 메모리에 유지하며 디스크 로그로 저장하지 않습니다.

## 명령어

| 명령 | 용도 |
|---|---|
| `npm run dev` | 개발 서버 |
| `npm run typecheck` | TypeScript 검사 |
| `npm test` | 도구·검증기 테스트 |
| `npm run build` | 프로덕션 빌드 |
| `npm run qa:render` | 외부 API 없이 지원 레이아웃 샘플 검증·렌더 |
| `npm start` | 빌드 결과 실행 |
| `npm run preflight` | 파일·Git 시간·비밀값·키 준비 상태 점검 |

## 설계 자료

- [파이프라인 구조](docs/architecture.md)
- [6-Agent 역할과 인수인계](docs/team-architecture.md)
- [Agentic Engineering 파이프라인·반려·지식 그래프 실험 가이드](docs/agentic-engineering-experiment-guide.md)
- [검색 메모리와 토큰 정책](docs/research-memory-and-tokens.md)
- [프롬프트 설계](docs/prompt-design.md)
- [Claude 참고 프로젝트 이관 기록](docs/reference-migration.md)
- [2분 데모 대본](docs/demo-script.md)
- [즉석 태스크 테스트](docs/test-cases.md)
- [제출 체크리스트](docs/submission-checklist.md)

모델과 API 선택은 공식 문서를 기준으로 했습니다: [OpenAI 최신 모델과 Responses API](https://developers.openai.com/api/docs/guides/latest-model),
[xAI X Search](https://docs.x.ai/developers/tools/x-search), [Grok 4.5](https://docs.x.ai/developers/grok-4-5),
[Pexels API](https://www.pexels.com/api/documentation/), [Unsplash API](https://unsplash.com/documentation),
[YouTube Data API v3](https://developers.google.com/youtube/v3/docs), [HN Search API](https://hn.algolia.com/api), [Dribbble API v2](https://developer.dribbble.com/v2/).
