# 제출 체크리스트

## 코드 동결 전

- [ ] `OPENAI_API_KEY`, `XAI_API_KEY`는 로컬 `.env`에만 있음
- [ ] 메인 `/`와 원본 이벤트 `/trace.html`을 별도 화면에서 확인
- [ ] 세컨드 화면의 도구 이름이 지금 설정된 `AGENT_ARCHITECTURE`와 일치하고 대본과 같음
- [ ] `agent_call` payload를 열어 `request.instructions`·`request.input`이 실제 요청과 동일함을 확인
- [ ] 녹화 직전 서버를 재시작해 재생 버퍼(최근 250건)에 이전 런이 섞이지 않게 함
- [ ] trace가 디스크에 저장되지 않고 서버 메모리 최근 250건으로만 유지되는지 확인
- [ ] GCS 사용 시 X·YouTube·Hacker News의 `platform/lane` cache hit/miss를 trace에서 확인
- [ ] GCS 버킷 비공개 IAM·최소 권한·짧은 lifecycle 삭제 규칙을 운영자가 확인
- [ ] 실제 키로 팀 파이프라인을 1회 이상 완주하고 소요 시간·토큰 사용량을 기록
- [ ] 모의 모드와 실제 모드 배지가 정확함
- [ ] 즉석 태스크 5개 이상 통과(통과한 항목 번호와 실패·근접 실패를 함께 기록)
- [ ] `npm run typecheck`, `npm test`, `npm run build`, `npm run preflight` 실행
- [ ] 모든 인정 대상 커밋이 2026-08-01 14:00 KST 이후임
- [ ] GitHub 저장소에서 `.env`, 로그, 생성 산출물이 추적되지 않음

## 제출물

- [ ] 2분 영상은 YouTube 일부공개이며 다른 계정에서 재생됨
- [ ] 영상에 API 키·알림·개인 계정 정보가 보이지 않음
- [ ] PDF는 최대 5장이고 글자·출처가 읽힘
- [ ] GitHub 링크와 커밋 히스토리를 팀장이 확인함
- [ ] 팀원 전원이 DAKER용 Google 계정을 준비함
- [ ] 인코딩·업로드를 고려해 07:00 전에 산출물 확정

## 결선

- [ ] 2분 슬라이드 + 3분 라이브 데모 + 2분 즉석 태스크 리허설
- [ ] `tool_call`/`tool_result` 원본 이벤트를 세컨드 화면에 실시간 표시
- [ ] 충전기·디스플레이 어댑터·핫스팟 준비
- [ ] 운영자, 발표자, trace/실패 감시 역할 분담
- [ ] 공급자 장애 시 말할 한계와 복구 절차 준비
