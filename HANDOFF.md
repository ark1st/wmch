# WMCH 리뉴얼 — 핸드오프 문서

> 안양세계선교교회(wmch.or.kr) 홈페이지 전면 리뉴얼 프로젝트.
> 이 문서는 다른 AI 에이전트/개발자가 작업을 이어받기 위한 전체 컨텍스트다.
> 마지막 갱신: 2026-07-14

## 1. 프로젝트 목표

1. **XE(XpressEngine) 탈피** — 현 사이트는 2017년산 XE 테마, 2022년 이후 방치 상태
2. **LLM/자동 업데이트 친화** — 콘텐츠 = Markdown 파일. 파일 추가 → git push → 자동 배포가 최종 목표
3. **디자인 현대화 (최우선 요구)** — 시안 4종 검토 끝에 "풀페이지 랜딩" 방향 확정

## 2. 현재 상태 (완료된 것)

- ✅ 디자인 확정: **시안 D — 랜딩** (`design-concepts/concept-d-landing.html`이 원본 목업)
- ✅ Astro 5 사이트 구축 (`site/`) — 빌드 통과, 페이지 2개(`/`, `/sermons`)
- ✅ **GitHub Pages 라이브: https://ark1st.github.io/wmch/**
- ✅ 샘플 이미지 4장: Codex(gpt-image-2)로 생성 (`assets/*.png` 원본, `site/src/assets/img/*.jpg` 웹용)
- ✅ 실제 교회 정보 반영: 2026-07-12 주보 기준 예배·교회학교 시간, 주소, 전화, 담임목사, 창립일 (§6)
- ⬜ GitHub Actions 자동 배포 (토큰 권한 문제로 보류 — §5)
- ⬜ 유튜브 → 설교 자동 수집 파이프라인
- ⬜ XE DB 콘텐츠 마이그레이션 (사용자가 DB 백업 예정 — 크롤링 금지 지시 있음)
- ⬜ wmch.or.kr 도메인 연결

## 3. 저장소 구조

```
wmch/
├── HANDOFF.md          ← 이 문서
├── design-concepts/    ← 디자인 시안 5종 (HTML 단일 파일 목업)
│   ├── concept-a-dawn.html       (다크+골드 미니멀 — 탈락)
│   ├── concept-b-courtyard.html  (밝은 커뮤니티 — 탈락)
│   ├── concept-c-atlas.html      (벤토 인포그래픽 — 탈락)
│   ├── concept-d-landing.html    ★ 채택안. 사이트의 원본 디자인
│   └── concept-e-jubo.html       (주보 신문 콘셉트 — 보류. 온라인 주보 서브페이지로 재활용 가치)
├── assets/             ← AI 생성 이미지 원본 PNG (git 포함)
└── site/               ← Astro 5 프로젝트 (실제 사이트)
    ├── astro.config.mjs        (site: ark1st.github.io, base: /wmch)
    ├── src/data/church.ts      ★ 교회 정보 단일 소스 (2026-07-12 주보 확인)
    ├── src/content.config.ts   (sermons/notices 컬렉션 스키마)
    ├── src/content/sermons/    ★ 설교 = md 파일 1개. 실제 설교 5편 수록
    ├── src/content/notices/    (공지 컬렉션 — 아직 미노출)
    ├── src/layouts/Base.astro  (공통 레이아웃 + 내비)
    ├── src/styles/global.css   (디자인 전체 — 시안 D에서 이식)
    ├── src/assets/img/         (웹용 이미지 — Vite가 해시·base 처리)
    └── src/pages/
        ├── index.astro         (풀페이지 스냅 랜딩, 7패널)
        └── sermons/index.astro (말씀 아카이브)
```

- `.github/workflows/deploy.yml`이 로컬에 **untracked로 존재** (§5 참조)

## 4. 디자인 원칙 (사용자가 명시적으로 확정)

- **랜딩 페이지 문법 유지**: 풀스크린 포토 히어로 + 단어별 키네틱 타이포 + 풀페이지 스냅 스크롤(`scroll-snap-stop: always`, 한 번에 한 패널). 881px/640px 미만에서는 일반 스크롤 폴백
- **말씀 중심 동선**: 히어로 CTA·내비 CTA 모두 "이번 주 말씀". 최신 설교가 자동으로 대표 카드가 됨. "방문 계획(Plan Your Visit)" 축은 사용자가 명시적으로 거부함
- **AI 티 금지** (사용자가 매우 민감 — 두 번 지적받음):
  - 금지: 카운트업 스탯, 마퀴 티커, eyebrow+제목+설명 삼단 남발, 가짜 폼, 감성 마케팅 카피("자리를 비워두었습니다" 류), 미국 교회 사이트 직역
  - 지향: 담백하고 구체적인 문장("어느 예배든 그냥 오시면 됩니다"), 실제 데이터(실제 설교 제목·성경 구절), 괘선 테이블
- 폰트: 시스템 스택(Apple SD Gothic Neo 계열). 외부 폰트 CDN 미사용
- 비전 문장(5개 비전을 한 문장으로)은 패널 진입 시 단어 순차 점등 — index.astro 하단 스크립트
- 모든 모션은 `prefers-reduced-motion` 대응 필수

## 5. 배포 (중요한 함정 있음)

### 현재: 수동 배포
```bash
cd site && npx astro build
cd dist && touch .nojekyll && git init -b gh-pages -q
git config user.name "ark1st" && git config user.email "48564934+ark1st@users.noreply.github.com"
git add -A && git commit -q -m "Deploy" && git push -f https://github.com/ark1st/wmch.git gh-pages
rm -rf .git
```
- `.nojekyll` 필수 (없으면 `_astro/` 디렉토리가 Jekyll에 의해 무시됨)

### GitHub 계정 주의 ★★
- 이 기기의 gh CLI에 계정 2개: **Min-Kang-3B(회사, 평소 활성)** / **ark1st(개인, 이 저장소 소유)**
- 푸시 절차: `gh auth switch --user ark1st` → push → **반드시 `gh auth switch --user Min-Kang-3B`로 복귀**
- 커밋 identity는 repo-local로 설정돼 있음 (ark1st noreply — 회사 이메일 공개 노출 방지). 건드리지 말 것

### Actions 자동 배포가 막혀 있는 이유
- ark1st 토큰에 `workflow` scope가 없어 워크플로 파일 푸시가 거부됨
- 해결: 사용자가 `gh auth refresh -s workflow --user ark1st` 실행(브라우저 인증) 후,
  로컬의 `.github/workflows/deploy.yml`(작성 완료 상태)을 커밋·푸시하면 push=자동배포 체제 완성
- 커스텀 도메인(wmch.or.kr) 연결 시: `astro.config.mjs`에서 `site`를 도메인으로 바꾸고 `base` 제거

## 6. 교회 정보 출처와 남은 교체 항목

`site/src/data/church.ts`에 모여 있음. 아래 정보는 사용자가 제공한 `0712주보.pdf`(2026-07-12)로 확인함:
- 예배: 주일 1부 08:30, 2부 11:00, 3부 14:30, 수요 19:30, 금요 20:30, 매일 새벽 05:00
- 교회학교: 태·영아·유치부 10:00, 유년·초등부 11:00, 중·고등부 11:00, 대학·청년부 13:20
- 주소: 경기도 안양시 동안구 관양로 93(관양동), 전화: 031-384-6494, 담임목사: 이창섭, 창립일: 1979-10-07
- 정기 모임: 237 월요전도학교, 매일 9시 기도회, 초등전도신학원

남은 교체·확인 항목:
- 히어로는 실제 본당 사진 `IMG_6037.jpg`를 구조 보존 방식으로 재구성한 `hero-sanctuary-v4.webp`로 교체함. 목사님은 강단에만 유지하고 상단 스크린은 빈 화면으로 정리했으며, 첼로를 제거하고 오른쪽 신디사이저를 단 없는 평면 바닥에 둠. 사이트의 딥그린·차콜 그림자와 따뜻한 우드 톤에 맞춰 조명·색감을 보정함. 상단에는 원본 로고를 고해상도·투명 배경으로 추출한 `church-logo-transparent.png`를 적용함
- 사역 카드 3장(찬양대·다음 세대·선교)은 기존 AI 생성물 유지 — 전경 사진과 저해상도 본당 사진은 이번 사이트에 사용하지 않음
- 지도 영역은 실제 주소의 카카오맵 검색 링크까지 연결됨. 지도 임베드는 미구현
- 유튜브 링크는 실제 채널(안양세계선교교회)로 연결돼 있음 (개별 영상 링크는 아직 채널 홈으로)

## 7. 다음 작업 우선순위

1. **Actions 자동 배포 활성화** (§5 — 사용자 토큰 갱신 후 deploy.yml 푸시)
2. **유튜브 자동 수집**: GitHub Actions 스케줄러가 채널 RSS/API 확인 → 새 영상을 `src/content/sermons/*.md`로 생성·커밋 → 자동 배포. 제목에서 성경 구절 파싱 필요(기존 제목 패턴: "[YYYY-MM-DD] 제목(책 장:절)")
3. **XE DB 마이그레이션**: 사용자가 mysqldump + files/attach 백업 제공 예정. `xe_documents` 테이블 → Markdown 변환 스크립트 작성. 게시판: 생명의말씀(~440글)·공지(~360글)·갤러리·선교
4. **서브페이지 확장**: 교회소개, 선교, 공지, 온라인 주보(concept-e 재활용 가능)
5. **도메인 전환**: 기존 서버(nginx, self-signed cert 문제 있음)에서 새 호스팅으로. 사용자가 도메인 관리 권한 보유

## 8. 원본 사이트 참고 정보

- `http://www.wmch.or.kr/xe/` — HTTPS는 self-signed라 사실상 http 전용. nginx WAF가 비브라우저 UA를 406 차단 (접근 시 브라우저 UA 필요)
- 실제 주간 콘텐츠는 사이트가 아니라 유튜브 채널에 올라감 (말씀/찬양)
- 교회 비전 5개(사이트 콘텐츠의 핵심): 복음/기도/전도/후대(RT)/세계선교 — 교단: 대한예수교장로회(개혁)

## 9. 사용자(운영자) 컨텍스트

- 웹 프레임워크·Git에 익숙하지 않음 — 설명은 비유 중심으로, git 명령을 직접 시키지 말고 에이전트가 처리
- 디자인 품질과 "AI 티 없음"에 대한 기준이 높음 — 변경 시 §4 원칙 준수
- 로그인/댓글/커뮤니티 기능은 영구 제외 결정. 관리자만 콘텐츠 관리하면 됨
