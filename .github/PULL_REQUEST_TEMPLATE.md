<!--
PR 제목은 Conventional Commits 형식이어야 합니다 — `PR title` 체크가 검사합니다(POLICY 2.1.3).
type: feat fix docs test perf refactor ci build chore style revert — 규칙 정본: kpubdata POLICY 2.1.3
이슈 번호는 제목이 아니라 본문에 적습니다 (Closes #123). squash 병합이 PR 번호를 붙입니다.
예) feat: add build preview panel
-->

## 요약
<!-- 이 PR이 무엇을, 왜 바꾸는지 1~3문장으로 설명하세요. -->

## 변경 내용
<!-- 주요 변경 사항을 항목으로 나열하세요. -->
-

## 관련 이슈
<!-- 예) Closes #123, Refs #456 -->

## 검증
<!-- 어떻게 검증했는지 구체적으로 적으세요. -->
- [ ] `npm run lint` 통과
- [ ] `npm run build` 통과
- [ ] 테스트 통과 (`npm test`)
- [ ] UI 변경 시 스크린샷 첨부 (해당 시)

## 체크리스트
- [ ] 기능 브랜치에서 작업했으며 `main`에 직접 push하지 않았다
- [ ] 커밋 메시지를 영어로 작성했다
- [ ] Studio는 제어 인터페이스이며, Builder가 소유한 로직(검증/미리보기/Manifest/게시)을 중복 구현하지 않았다
- [ ] 관련 화면 설계서/문서를 함께 갱신했다 (해당 시)
- [ ] 사용자 노출 기능 변경 시 문서를 분류해 갱신했다: 제품 계약→PRD, 향후 의도→ROADMAP, 릴리스 변경→CHANGELOG (해당 시)
