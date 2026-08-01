# Claude 참고 프로젝트 이관 기록

`C:\Users\youns\Desktop\참고자료`의 Claude 기반 DeckForge에서 유효한 설계 원칙을 추려
현재 TypeScript 프로젝트 규약으로 다시 구현했다. 기존 프로젝트를 그대로 복사하거나 커밋
히스토리를 가져오지 않았다.

## 유지한 개념

- 서사 설계 → 검증 → 렌더의 단계 분리
- 구조화된 DeckSpec과 결정론적 검증
- 짧은 덱에서 한 장당 하나의 주장
- 모델 오류를 렌더 전에 막는 게이트
- 출처와 발표자 노트를 산출물에 함께 보존

## 교체한 부분

| 참고 구현 | 현재 구현 |
|---|---|
| Anthropic/Claude 클라이언트 | OpenAI Responses API와 `OPENAI_MODEL` |
| 일반 자료 소화 단계 | Grok `x_search` 전용 어댑터 |
| Python 패키지/CLI | Node.js·TypeScript·웹 UI |
| python-pptx 렌더러 | `pptxgenjs` 기반 PPTX 렌더러 |
| 내부 로그 중심 | 심사용 `/trace.html` 원본 이벤트 화면 |

Grok은 최신 X 접근이라는 단일 이유로만 존재한다. 최종 판단과 문장은 GPT가 담당하고, 검증은
코드가 담당한다. 이 분리는 공급자를 늘리기 위한 구성이 아니라 최신성·추론·안전 게이트의 책임을
각각 설명할 수 있게 하기 위한 구성이다.

