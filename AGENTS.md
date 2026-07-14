# WMCH — 에이전트 작업 규칙

**작업 시작 전 `HANDOFF.md`를 반드시 읽을 것.** 프로젝트 전체 컨텍스트(목표, 현재 상태, 배포 절차, 함정)가 거기 있다.

핵심 규칙 요약:

- 실제 사이트 코드는 `site/`(Astro 5). `design-concepts/`는 디자인 목업 원본 — 참고용, 수정 금지
- 교회 정보(예배 시간·주소·전화)는 전부 placeholder — `site/src/data/church.ts`에서만 관리. 임의로 실제 값처럼 지어내지 말 것
- 디자인 변경 시 HANDOFF.md §4 원칙(랜딩 문법 유지, 말씀 중심, AI 티 금지) 준수
- GitHub 푸시: `gh auth switch --user ark1st` → push → 반드시 `Min-Kang-3B`로 복귀. 커밋 identity(repo-local ark1st noreply) 변경 금지
- 배포는 현재 수동(gh-pages 브랜치) — 절차와 `.nojekyll` 함정은 HANDOFF.md §5
- 빌드 검증: `cd site && npx astro build`
