# TRD — My Tasks 기술 설계

| 항목 | 내용 |
|---|---|
| 문서 종류 | 기술 요구사항·설계 문서 (Technical Requirements Document) |
| 대상 | 이 앱을 유지보수·확장하는 개발자 |
| 최종 갱신 | 2026-11-11 |
| 관련 문서 | [PRD.md](PRD.md) · [TASK.md](TASK.md) · [../CLAUDE.md](../CLAUDE.md) |

---

## 1. 기술 스택과 원칙

| 항목 | 결정 | 이유 |
|---|---|---|
| 언어 | HTML · CSS · JavaScript(ES2022, 바닐라) | 빌드·설치 없이 파일을 열면 바로 실행 |
| 프레임워크·라이브러리 | 없음 | 의존성 0, 오프라인 동작 |
| 저장소 | `localStorage` | 서버 없이 브라우저에 영구 저장 |
| 빌드·패키지 매니저 | 없음 | — |
| 지원 브라우저 | 최신 Chrome·Edge·Safari·Firefox | `<dialog>`, Pointer Events, `?.`·`??=`·`Array#at`, CSS `content-visibility` 사용. `<dialog>`가 없으면 `confirm`으로 대체 |

원칙
- **단일 진실 공급원**: 화면은 상태(`todos` 등)에서 계산한다. DOM을 상태로 쓰지 않는다. 예외는 인라인 편집기뿐이다.
- **사용자 텍스트는 텍스트 노드로만** 넣는다. `innerHTML`은 고정 아이콘 마크업에만 쓴다.
- **저장 실패에도 앱이 멈추지 않는다.** 모든 저장소 접근은 예외를 잡는 래퍼를 거친다.

---

## 2. 파일 구성

```
todolist/
├─ index.html      정적 마크업 (요소 id는 script.js가 참조)
├─ style.css       색 토큰 · 컴포넌트 · 반응형 레이아웃
├─ script.js       전체 로직 (15개 번호 섹션)
├─ CLAUDE.md       작업 지침 (구현상 주의점)
└─ docs/           PRD · TRD · TASK
```

`script.js` 섹션: 1. 상수 → 2. DOM 참조 → 3. 유틸리티 → 4. 저장소 → 5. 상태 → 6. 상태 변경 → 7. 렌더링 → 8. 드래그 정렬 → 9. 인라인 수정 → 10. 토스트·알림·다이얼로그 → 11. 내보내기·가져오기 → 12. 최근 삭제 → 13. 격언·응원·테마 → 14. 이벤트 연결 → 15. 초기화

`index.html`의 `<head>` 안 인라인 스크립트는 CSS보다 먼저 `<html data-theme>`를 정한다. 첫 화면에서 테마가 깜빡이지 않게 하기 위해서다.

---

## 3. 데이터 모델

### 3.1 할 일
```ts
type Todo = {
  id: string;          // crypto.randomUUID() (없으면 시간+난수). /^[A-Za-z0-9_-]{1,64}$/
  text: string;        // NFC 정규화, 제어 문자 제거, 최대 200자
  completed: boolean;
  createdAt: string;   // ISO 8601
  category: 'work' | 'personal' | 'study';
};
```
- `todos` 배열의 순서가 곧 "직접 정렬" 순서다.
- 카테고리 기능 이전 데이터(category 없음)는 불러올 때 `personal`로 보정한다.

### 3.2 최근 삭제 항목
```ts
type TrashEntry = { todo: Todo; index: number; deletedAt: string; batchId: string };
```
- 최신이 앞에 온다. 7일·50개까지 보관한다.
- 50개 제한을 적용할 때 가장 최근 삭제 묶음(`batchId`)은 쪼개지 않는다.

### 3.3 localStorage 키 (호환성을 위해 이름 변경 금지)

| 키 | 값 |
|---|---|
| `todos` | `Todo[]` JSON |
| `todosTrash` | `TrashEntry[]` JSON |
| `todoFilter` | `all` · `work` · `personal` · `study` |
| `todoSort` | `status` · `created` · `category` · `manual` |
| `todoTheme` | `dark` · `light` (없으면 OS 설정 따름) |
| `todos_corrupt_<timestamp>` | 파싱에 실패한 원본 문자열 백업 |

### 3.4 내보내기 파일 형식
```json
{ "format": "my-tasks", "version": 1, "exportedAt": "…", "count": 12, "todos": [ … ] }
```
- 가져오기는 이 형식과 `Todo[]` 배열을 모두 받는다.
- `format`이 다르면 거부한다.

---

## 4. 상수 (`script.js` §1)

| 이름 | 값 | 용도 |
|---|---|---|
| `LIMITS.textLength` | 200 | 할 일 최대 글자 수 (`maxlength`와 동일) |
| `LIMITS.todos` | 1000 | 최대 할 일 개수 |
| `LIMITS.importBytes` | 5 MB | 가져오기 파일 최대 크기 |
| `LIMITS.trashItems` / `trashDays` | 50 / 7 | 최근 삭제 보관 |
| `TIMING.saveDebounce` | 300 ms | 저장 디바운스 |
| `TIMING.searchDebounce` | 200 ms | 검색 디바운스 |
| `TIMING.hintDebounce` | 150 ms | 중복 경고·자동 분류 디바운스 |
| `TIMING.leaveAnimation` | 300 ms | 삭제 페이드아웃 후 실제 삭제 |
| `TIMING.toast` / `toastWithAction` | 2.5 s / 6 s | 토스트 표시 시간 |
| `TIMING.dragThreshold` | 4 px | 클릭과 드래그 구분 |

---

## 5. 상태와 데이터 흐름

```
사용자 동작 → 상태 변경 함수 → saveTodos() (디바운스) → render()
```

| 상태 | 저장 | 설명 |
|---|---|---|
| `todos` | O | 할 일 목록 |
| `trash` | O | 최근 삭제 |
| `currentFilter` / `currentSort` | O | 필터·정렬 |
| `searchQuery` | X | 새로고침하면 초기화 (의도) |
| `pendingAnimation` | X | 다음 렌더에서 한 항목에 재생할 애니메이션 |
| `autoCategory` | X | 자동 분류 상태 `{ touched, applied, baseline }` |
| `elementCache` | X | id → `{ el, signature }` |

- **저장**: `saveTodos()`는 300ms 디바운스로 묶인다. `flushSave()`는 `pagehide`, `visibilitychange(hidden)`, 내보내기 직전에 즉시 저장한다.
- **탭 간 동기화**: `storage` 이벤트로 다른 탭의 변경을 반영한다. 이 탭에 아직 저장하지 않은 변경이 있으면 이 탭이 우선한다.
- **검증**: `sanitizeTodo()` / `sanitizeTodos()` 한 경로로 localStorage 불러오기, 가져오기, 휴지통 항목을 모두 검증한다.

---

## 6. 렌더링

### 6.1 키 기반 재조정
`render()`는 상태 전체로부터 화면을 다시 계산한다. 다만 `<li>`는 id별로 캐시해 재사용한다.
1. `getVisibleTodos()`: 카테고리 필터 → 검색(부분 문자열, 대소문자 무시) → `sortTodos()`(안정 정렬; 동점은 배열 순서).
2. `getTodoElement()`: 서명(텍스트 + 카테고리 + 검색어)이 같으면 캐시된 `<li>`를 쓰고, 다르면 새로 만든다. 완료 상태는 `syncCompletedState()`가 제자리에서 바꾼다.
3. `reconcileList()`: 필요 없는 노드는 제거하고, 순서가 틀린 노드만 `insertBefore`로 옮긴다.

효과: DOM 변경이 최소화되고, 포커스와 열린 편집기가 렌더 후에도 유지된다.
**표시 내용을 바꾸는 필드를 추가하면 서명에 넣거나 캐시를 지워야 한다.**

### 6.2 포커스 관리
렌더 전에 `captureFocus()`가 포커스 위치(항목 id + 컨트롤 종류 + 인덱스)를 기억한다. 렌더 후 포커스를 잃었으면 `restoreFocus()`가 다음 순서로 되돌린다.
1. 같은 항목의 같은 컨트롤
2. 같은 자리의 이웃 항목
3. 입력창

### 6.3 애니메이션
- **FLIP**: 렌더 전후 위치를 한 번에 읽고 한 번에 써서 리플로우를 1회로 줄인다. 화면 밖 항목은 애니메이션하지 않는다.
- **일회성 클래스**: `todo-enter`, `todo-toggled`, `todo-saved`는 `pendingAnimation`으로 붙이고, `animationend`에서 뗀다.
- **삭제**: `.leaving` 페이드아웃 300ms 후 실제로 삭제한다.
- **동작 줄이기**: `prefers-reduced-motion`이면 지속 시간을 0에 가깝게 줄인다. 애니메이션을 끄지 않으므로 종료 이벤트는 여전히 발생한다.
- **테마 전환**: `<html>`에 `.theme-transition`을 400ms 동안 붙여 색상만 전환한다.

### 6.4 대시보드
`renderStats()`는 할 일을 한 번 순회해 진행률, 카테고리별 수치, 오늘 개수, 배지, 응원 메시지, 메뉴 개수, 하단 버튼 상태를 갱신한다. 대시보드는 정적 마크업이고 값만 바꾼다(다시 만들면 진행률 바 전환이 끊긴다). 1분마다 상대 시간, 오늘 개수, 격언을 갱신한다.

### 6.5 성능 측정 (중앙값, 레이아웃 포함)

| 항목 수 | 첫 렌더 | 완료 토글 | 검색 | 정렬 변경 |
|---|---|---|---|---|
| 100 | 5.6 ms | 2.2 ms | 0.4 ms | 1.8 ms |
| 500 | 25.9 ms | 5.7 ms | 1.9 ms | 5.4 ms |
| 1000 | 60.2 ms | 14.7 ms | 2.3 ms | 14.5 ms |

`.todo-item { content-visibility: auto }`로 화면 밖 항목의 렌더링을 건너뛴다.

---

## 7. 주요 기능 설계

### 7.1 드래그 정렬 (§8)
- HTML5 DnD는 터치에서 동작하지 않으므로 **Pointer Events**로 구현한다. 손잡이에 `touch-action: none`을 준다.
- 끌고 있는 `<li>`는 DOM에서 옮기지 않고(포인터 캡처·포커스 유지), 이웃 노드를 옮기며 짧은 FLIP으로 미끄러뜨린다.
- 놓으면 `commitMove(id, { targetId, position })`가 "보이는 이웃" 기준으로 배열을 바꾼다. 필터·검색 중에도 의도한 위치가 된다.
- 정렬 모드별 동작:
  - `created`: 현재 순서를 배열에 굳히고 `manual`로 전환한다.
  - `status`·`category`: 그룹을 넘어가면 원래 그룹으로 돌아가고 안내한다.
- 화면 가장자리에서 rAF로 자동 스크롤한다(`window.scrollBy`). **목록에 별도 스크롤 컨테이너를 만들면 안 된다.**
- 드래그 중 `render()`는 보류(`renderAfterDrag`)하고, 끝난 뒤 실행한다.

### 7.2 인라인 수정 (§9)
- 편집 상태는 DOM에만 있다. `.todo-content`를 입력창과 복제한 카테고리 선택으로 바꾸고, `<li>`에 `.editing`을 붙인다.
- Enter 저장, Esc 취소, 편집 영역 밖으로 포커스가 나가면(`focusout` + `relatedTarget`) 저장한다.
- 한글 조합 중 Enter(`isComposing`)는 무시한다.
- 끝낼 때 해당 캐시를 지워 새로 그린다.

### 7.3 다이얼로그 (§10)
- `showDialog({ title, message, body, buttons })`는 누른 버튼의 `value`(취소는 `null`)를 Promise로 돌려준다. 네이티브 `<dialog>`가 포커스 가두기와 Esc 처리를 맡는다.
- 결과는 `settleDialog`로 즉시 전달한다. 출처는 form `submit`(`e.submitter.value`), `cancel`(Esc), 배경 클릭이다.
- **비동기 `close` 이벤트에 의존하면 안 된다.** 이전 다이얼로그의 늦은 `close`가 새 다이얼로그를 취소시키는 경쟁 상태가 실제로 있었다. 그래서 `close`는 `dialog.open`이 false일 때만 처리한다.

### 7.4 삭제·복구 (§12)
`removeWithAnimation()` → `removeTodos()`가 휴지통 항목을 만든다. 복구 경로는 세 가지이고, 모두 `restoreEntries()`가 원래 인덱스 오름차순으로 다시 끼워 넣는다.
- 토스트의 "실행 취소": 그 묶음 전체
- Ctrl+Z: 가장 최근 묶음
- 최근 삭제 목록: 항목 하나

### 7.5 가져오기 (§11)
`readImportFile()`이 검증하고, 문제가 있으면 사용자에게 보여 줄 메시지를 담은 `ImportError`를 던진다.
- 파일: 크기 5MB 이하, `.json`, 비어 있지 않음
- 내용: BOM 제거, JSON 파싱, `format` 확인, 목록 추출, 항목별 정리

`applyImport()`는 바꾸기 또는 합치기를 한다. 합칠 때는 같은 id + 같은 내용, 또는 같은 정규화 텍스트 + 같은 카테고리이면 건너뛴다. 실행 취소용 스냅샷을 보관한다.

### 7.6 키워드 자동 분류
- 규칙은 `CATEGORY_KEYWORDS`에 있고, 미리 `KEYWORD_MATCHERS`로 바꿔 둔다.
  - **한글**: 부분 문자열로 찾는다. 한 글자 키워드는 넣지 않는다.
  - **영문**: 단어 경계로만 찾는다(`pr`이 `project`에 걸리지 않도록).
- `classifyText(text)`가 분류한다.
  1. 일치한 키워드 수가 많은 카테고리가 이긴다.
  2. 같으면 가장 긴 일치 키워드가 더 긴 쪽이 이긴다.
  3. 그래도 같으면 `null`(분류하지 않음).
- 입력 폼에서는 `applyAutoCategory()`가 `autoCategory = { touched, applied, baseline }`로 동작을 관리한다.
  - 자동 선택하면 이전 값을 `baseline`에 저장하고, 키워드가 사라지면 되돌린다.
  - 사용자가 직접 고르면(`change`) `touched`가 되어 제안만 표시한다.
  - 추가하면 `resetAutoCategory()`로 초기화한다.
- Enter를 디바운스 전에 눌러도 반영되도록, 제출할 때 동기로 한 번 더 분류한다.
- 가져오기는 `sanitizeTodos(…, { classifyMissing: true })`로 분류한다. 일반 불러오기는 재분류하지 않는다.

### 7.7 키보드
- `document`에 `keydown` 리스너 하나를 둔다. `e.code`로 판별해 한글 입력 상태에서도 동작한다.
  - 다이얼로그가 열려 있으면 무시한다.
  - Ctrl+Z와 `/`는 텍스트 입력 중이 아닐 때만 동작한다.
- `#todo-list`에 `keydown` 리스너 하나를 둔다. 편집기 안과 수정키(Shift·Ctrl 등)가 눌린 경우는 무시한다.
  - 손잡이: ↑/↓로 순서를 바꾼다.
  - 그 밖의 컨트롤: ↑/↓는 이웃 항목의 같은 컨트롤로, Home/End는 처음·끝 항목으로 이동한다.
  - 체크박스에서 Enter는 수정, Delete·Backspace는 삭제다.
  - Space는 브라우저 기본 동작(체크박스 토글)에 맡긴다.

### 7.8 저장소 오류 처리 (§4)
- `storage` 객체가 시작할 때 사용 가능 여부를 검사한다.
- `set` 실패 시 `QuotaExceededError`를 구분해 알리고, 알림은 10초에 한 번만 띄운다.
- 파싱 실패 시 원본을 `todos_corrupt_<ts>`에 보관하고 빈 목록으로 시작한다.
- 전역 `error`·`unhandledrejection`도 토스트로 알린다.

---

## 8. 반응형 레이아웃 (`style.css`)

```
┌──────────┬────────────────────────┬────────────┐
│ .sidebar │ .main                  │ .insights  │  ≥1280px: 3단 (260 | 1fr | 340)
│ 메뉴·데이터 │ 제목·입력·검색·목록       │ 테마·격언·진행률 │  ≥1600px: 280 | 1fr | 380
└──────────┴────────────────────────┴────────────┘
```

| 조건 | 동작 |
|---|---|
| 900~1279px | 2단. `.insights`가 `.main` 위로 이동(격언·진행률 가로 배치) |
| 900~1099px | 사이드바 220px |
| ≤899px | 1단. `.sidebar`·`.insights`에 `display: contents`, 각 블록에 `order`, `.theme-row`는 절대 위치 |
| ≤480px | 터치 영역 44px 이상, 입력 폼 줄바꿈 |
| 너비 ≥900px 그리고 높이 ≤820px | 사이드바를 촘촘하게. 단축키 `<details>`는 `innerHeight ≥ 900`일 때만 펼친 상태로 시작 |
| `hover: none` | 항목 버튼을 항상 표시, 단축키 안내 숨김 |

- `.main`의 내용은 `--content-max`(1040px)로 제한하고 `.app-shell > .main > *`로 가운데 정렬한다. 이 선택자는 `.todo-list { margin: 0 }`보다 우선하도록 일부러 구체적으로 썼다.
- 양옆 패널은 `position: sticky`이고, 목록은 창 스크롤을 따른다.
- 테마 스위치는 사이드바 제목 줄에 두지 않는다(두 자리 배지 + 스크롤바에서 배지를 가렸던 문제).
- **색**: 모든 색은 `:root` 토큰으로 정의하고 `:root[data-theme="dark"]`에서 덮어쓴다. 규칙 안에 색을 직접 쓰지 않는다. 카테고리 색은 두 테마에서 같다.

---

## 9. 접근성

| 항목 | 구현 |
|---|---|
| 이름·설명 | 체크박스 `aria-labelledby`(텍스트) + `aria-describedby`(카테고리·시간). 아이콘 버튼은 할 일 텍스트를 포함한 `aria-label` |
| 상태 | 필터 `aria-pressed`, 테마 `role="switch"`·`aria-checked`, 진행률 `role="progressbar"`·`aria-valuenow`·`aria-valuetext` |
| 안내 | 토스트 `role="status"`. 토스트가 없는 이벤트는 `announce()`(숨겨진 live region): 검색 결과 수, 순서 이동, 필터 변경 |
| 탐색 | 건너뛰기 링크, 목록 `aria-describedby="list-help"`(키보드 사용법), 포커스 복원, 모달 다이얼로그 |
| 동작 | `prefers-reduced-motion`, 키보드만으로 모든 기능 사용 가능 |

---

## 10. 테스트 전략

테스트 러너가 없다. 대신 **헤드리스 Edge**로 앱 복사본을 열고 테스트 스크립트를 주입해 PASS/FAIL을 수집한다.

```
msedge.exe --headless=new --disable-gpu --user-data-dir=<새 임시 폴더>
           --virtual-time-budget=30000 --dump-dom file:///<경로>/index.html
```

| 묶음 | 검사 수 | 범위 |
|---|---|---|
| 기능 회귀 | 90 | 추가·중복·정렬·드래그·검색·수정·삭제·복구·일괄 삭제·내보내기·가져오기·응원·성능·한도 |
| 자동 분류 | 50 | 분류기, 입력 중 자동 선택, 직접 선택 존중, 필터 연동, 가져오기 분류 |
| 키보드 탐색 | 17 | ↑/↓, Home/End, Enter, Delete, 손잡이 동작, 편집기 제외 |
| 손상 데이터 | 6 | 파싱 실패 복구, 잘못된 설정값 대체 |

모두 1400px(3단)와 820px(1단) 두 너비에서 통과했다.

주의점
- 가상 시간에서는 `performance.now()`가 멈춘다. 성능은 가상 시간 없이 동기 스크립트로 잰다.
- 가상 시간에서는 CSS 트랜지션이 끝나지 않는다. 색은 새로 불러온 페이지에서 확인한다.
- 다이얼로그 버튼을 누르기 전에 `#app-dialog`가 열렸는지 기다린다. `File.text()`가 고정 지연보다 느릴 수 있다.
- 스크립트로 부른 `.click()`은 포커스를 옮기지 않는다. `focusout`에 의존하는 테스트는 먼저 `.focus()`를 호출한다.
- 헤드리스 창은 약 500px보다 좁게 그려지지 않고, 실제 너비는 `--window-size`보다 약 30px 작다.
- 실행마다 새 user-data 폴더를 쓴다.

---

## 11. 알려진 제약

- 데이터가 브라우저별·기기별로 따로 저장된다(동기화 없음). 이동하려면 내보내기·가져오기를 써야 한다.
- localStorage 용량(대개 5MB)과 할 일 1000개 한도가 있다.
- 미확인: Alt+D 단축키 충돌, 480px 이하 실기기 화면, 스크린 리더 실제 읽기 → [TASK.md](TASK.md)
