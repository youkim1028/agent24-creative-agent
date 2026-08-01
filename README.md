# DeckForge X

실시간 X 대화를 3~5장의 의사결정용 PPTX로 바꾸는 Creative 트랙 에이전트입니다.
Grok은 X 검색만 담당하고, GPT는 논지와 슬라이드를 설계합니다. 결정론적 코드는
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

키가 없으면 화면에 `MOCK`이 표시되고 모의 X 출처가 들어간 리허설 덱이 생성됩니다. 이 덱을
실제 근거처럼 발표하면 안 됩니다. 실데모 전 `.env`에 아래 값을 넣으세요.

```dotenv
OPENAI_API_KEY=...
OPENAI_MODEL=gpt-5.6-sol
OPENAI_REASONING_EFFORT=medium
XAI_API_KEY=...
GROK_MODEL=grok-4.5
```

키는 각 공급자 콘솔에서 발급하며 GitHub 계정·GitHub Billing과 별개입니다. API 사용은 공급자별
결제/크레딧이 필요할 수 있습니다. `.env`는 Git에서 제외되어 있으므로 키를 코드, 화면, 영상,
이벤트 payload에 붙여 넣지 마세요.

## 파이프라인

1. `research_x` — Grok의 서버측 X Search가 현재 게시물과 URL을 수집합니다.
2. `review_outline` — GPT가 만든 논지가 목차형 문구가 아닌지 검사합니다.
3. `validate_deck` — 코드가 3~5장 구조, 근거, 밀도, 고유 ID를 검사합니다.
4. `render_deck` — 바로 앞에서 통과한 동일 DeckSpec만 PPTX/JSON으로 저장합니다.

`/trace.html`에는 GPT `function_call`/`function_call_output`과 xAI 검색 이벤트 payload가
그대로 표시됩니다. 키, 인증 헤더, 쿠키는 애초에 이벤트 객체에 넣지 않습니다.

## 명령어

| 명령 | 용도 |
|---|---|
| `npm run dev` | 개발 서버 |
| `npm run typecheck` | TypeScript 검사 |
| `npm test` | 도구·검증기 테스트 |
| `npm run build` | 프로덕션 빌드 |
| `npm start` | 빌드 결과 실행 |
| `npm run preflight` | 파일·Git 시간·비밀값·키 준비 상태 점검 |

## 설계 자료

- [파이프라인 구조](docs/architecture.md)
- [프롬프트 설계](docs/prompt-design.md)
- [Claude 참고 프로젝트 이관 기록](docs/reference-migration.md)
- [2분 데모 대본](docs/demo-script.md)
- [즉석 태스크 테스트](docs/test-cases.md)
- [제출 체크리스트](docs/submission-checklist.md)

모델과 API 선택은 공식 문서를 기준으로 했습니다: [OpenAI 최신 모델과 Responses API](https://developers.openai.com/api/docs/guides/latest-model),
[xAI X Search](https://docs.x.ai/developers/tools/x-search), [Grok 4.5](https://docs.x.ai/developers/grok-4-5).

