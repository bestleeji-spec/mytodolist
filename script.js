'use strict';

/* =============================================================================
 * My Tasks — 할 일 관리 앱 (바닐라 JS, 빌드 과정 없음)
 *
 * [데이터 흐름]
 *   사용자 동작 → 상태 변경 함수(addTodo, toggleTodo, …) → saveTodos() → render()
 *
 *   - `todos` 배열이 유일한 진실 공급원(source of truth)이다. 배열 순서 = "직접 정렬" 순서.
 *   - saveTodos()는 디바운스되어 연속 변경을 한 번의 localStorage 쓰기로 묶는다.
 *     페이지를 떠나거나 숨길 때는 flushSave()로 즉시 기록한다.
 *   - render()는 상태로부터 화면을 다시 계산하지만, 항목 DOM은 id별로 캐시해서
 *     내용이 바뀐 항목만 새로 만들고 순서가 바뀐 노드만 옮긴다(키 기반 재조정).
 *     그래서 수백 개 항목에서도 가볍고, 포커스·편집 중 상태가 유지된다.
 *
 * [파일 구성]
 *   1. 상수            2. DOM 참조        3. 유틸리티
 *   4. 저장소           5. 상태            6. 상태 변경
 *   7. 렌더링           8. 드래그 정렬      9. 인라인 수정
 *  10. 토스트·알림·다이얼로그             11. 내보내기·가져오기
 *  12. 최근 삭제(휴지통)                  13. 격언·응원·테마
 *  14. 이벤트 연결     15. 초기화
 * ========================================================================== */

/* =============================================================================
 * 1. 상수
 * ========================================================================== */

/** localStorage 키. 기존 사용자 데이터 호환을 위해 이름을 바꾸지 말 것 */
const STORAGE_KEYS = Object.freeze({
  todos: 'todos',
  filter: 'todoFilter',
  sort: 'todoSort',
  theme: 'todoTheme',
  trash: 'todosTrash',
});

const CATEGORIES = Object.freeze({ work: '업무', personal: '개인', study: '공부' });
/** 카테고리순 정렬에서 쓰는 순서 */
const CATEGORY_ORDER = Object.freeze({ work: 0, personal: 1, study: 2 });
const DEFAULT_CATEGORY = 'personal';

const FILTERS = ['all', ...Object.keys(CATEGORIES)];
const FILTER_LABELS = Object.freeze({ all: '전체', ...CATEGORIES });

const SORT_LABELS = Object.freeze({
  status: '완료 상태순',
  created: '생성일순',
  category: '카테고리순',
  manual: '직접 정렬',
});
/** 기존 동작(완료 항목은 아래로)을 유지하기 위해 기본값은 완료 상태순 */
const DEFAULT_SORT = 'status';

const LIMITS = Object.freeze({
  textLength: 200,              // 할 일 한 개의 최대 글자 수 (input maxlength와 같음)
  todos: 1000,                  // 최대 할 일 개수 (localStorage 용량 보호)
  importBytes: 5 * 1024 * 1024, // 가져오기 파일 최대 크기
  trashItems: 50,               // 최근 삭제 보관 개수
  trashDays: 7,                 // 최근 삭제 보관 기간
});

const TIMING = Object.freeze({
  saveDebounce: 300,    // 저장 디바운스 (ms)
  searchDebounce: 200,  // 검색 디바운스
  hintDebounce: 150,    // 중복 경고 디바운스
  leaveAnimation: 300,  // 삭제 페이드아웃 길이 (CSS todo-fade-out보다 약간 길게)
  toast: 2500,          // 일반 토스트 표시 시간
  toastWithAction: 6000,// "실행 취소" 버튼이 있는 토스트 표시 시간
  dragThreshold: 4,     // 이만큼(px) 움직여야 드래그로 인식 (클릭과 구분)
});

/**
 * 키워드 기반 자동 카테고리 분류 규칙.
 * - 한글 키워드는 부분 문자열로 찾는다 ("회의" → "팀 회의록 정리"도 일치).
 *   너무 짧아 오분류가 잦은 한 글자 키워드는 넣지 말 것.
 * - 영문 키워드는 단어 단위로만 찾는다 ("pr"이 "project"에 걸리지 않도록).
 * 키워드를 추가·수정하려면 이 목록만 고치면 된다.
 */
const CATEGORY_KEYWORDS = Object.freeze({
  work: [
    '회의', '미팅', '보고서', '보고', '업무', '출근', '퇴근', '야근', '프로젝트', '기획', '제안서',
    '발표', '메일', '결재', '클라이언트', '고객', '거래처', '마감', '팀장', '부장', '출장', '계약',
    '견적', '매출', '회사', '코드 리뷰', '배포', '면접',
    'meeting', 'report', 'deadline', 'project', 'client', 'email', 'deploy',
  ],
  personal: [
    '장보기', '장 보기', '마트', '운동', '헬스', '요가', '산책', '병원', '약국', '치과', '청소',
    '빨래', '설거지', '요리', '택배', '은행', '가족', '엄마', '아빠', '친구', '생일', '약속', '데이트',
    '여행', '쇼핑', '미용실', '세탁', '분리수거', '고양이', '강아지', '집안일',
    // 여가·취미
    '주말', '영화', '관람', '공연', '전시', '콘서트', '뮤지컬', '연극', '드라마', '취미', '외식',
    '맛집', '카페', '휴가', '캠핑', '등산', '낚시', '게임',
    'gym', 'workout', 'shopping', 'grocery', 'laundry', 'movie', 'concert', 'weekend',
  ],
  study: [
    '공부', '숙제', '과제', '시험', '복습', '예습', '강의', '수업', '인강', '학원', '독서', '영어',
    '단어', '수학', '문제 풀', '알고리즘', '코딩 테스트', '자격증', '토익', '토플', '논문', '스터디',
    '외우기', '암기',
    'study', 'exam', 'homework', 'lecture', 'course', 'toeic',
  ],
});

/** 저장·가져오기 시 허용하는 id 형식 (DOM id 속성과 CSS 선택자에 안전한 문자만) */
const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

const EXPORT_FORMAT = 'my-tasks';
const EXPORT_VERSION = 1;

/** 고정 아이콘 마크업 (사용자 입력이 아니므로 innerHTML로 넣어도 안전) */
const ICONS = Object.freeze({
  grip: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg>',
  pencil: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L18.5 9.5a2.1 2.1 0 0 0-3-3L5 17v3z"/><path d="m13.5 8.5 2 2"/></svg>',
});

/** 오늘의 격언 목록 */
const QUOTES = Object.freeze([
  { text: '천 리 길도 한 걸음부터.', author: '속담' },
  { text: '시작이 반이다.', author: '속담' },
  { text: '구슬이 서 말이라도 꿰어야 보배.', author: '속담' },
  { text: '티끌 모아 태산.', author: '속담' },
  { text: '실패는 성공의 어머니다.', author: '속담' },
  { text: '늦었다고 생각할 때가 가장 빠를 때다.', author: '격언' },
  { text: '오늘 걷지 않으면 내일은 뛰어야 한다.', author: '격언' },
  { text: '오늘 할 수 있는 일을 내일로 미루지 마라.', author: '벤저민 프랭클린' },
  { text: '잃어버린 시간은 결코 다시 찾을 수 없다.', author: '벤저민 프랭클린' },
  { text: '말을 잘하는 것보다 실천을 잘하는 것이 낫다.', author: '벤저민 프랭클린' },
  { text: '아는 것이 힘이다.', author: '프랜시스 베이컨' },
  { text: '우리가 반복적으로 하는 행동이 곧 우리 자신이다. 그러므로 탁월함은 행동이 아니라 습관이다.', author: '윌 듀런트' },
  { text: '성공은 매일 반복한 작은 노력들의 합이다.', author: '로버트 콜리어' },
  { text: '위대한 일을 하는 유일한 방법은 자신이 하는 일을 사랑하는 것이다.', author: '스티브 잡스' },
  { text: '앞서 나가는 비결은 일단 시작하는 것이다.', author: '마크 트웨인' },
  { text: '할 수 있다고 믿든 할 수 없다고 믿든, 당신이 옳다.', author: '헨리 포드' },
]);

/* =============================================================================
 * 2. DOM 참조 (모두 index.html에 정적으로 존재)
 * ========================================================================== */

const byId = (id) => document.getElementById(id);

const els = {
  root: document.documentElement,
  // 입력
  form: byId('todo-form'),
  input: byId('todo-input'),
  categorySelect: byId('category-select'),
  duplicateHint: byId('duplicate-hint'),
  categoryHint: byId('category-hint'),
  // 목록·도구
  list: byId('todo-list'),
  emptyMessage: byId('empty-message'),
  filterBar: byId('filter-bar'),
  searchInput: byId('search-input'),
  sortSelect: byId('sort-select'),
  // 대시보드
  overallText: byId('overall-text'),
  overallProgress: byId('overall-progress'),
  todayCount: byId('today-count'),
  cheerMessage: byId('cheer-message'),
  statsCats: [...document.querySelectorAll('.stats-cat')],
  remainingBadge: byId('remaining-badge'),
  remainingCount: byId('remaining-count'),
  // 카테고리 메뉴의 개수, 목록 제목
  filterCounts: [...document.querySelectorAll('[data-count]')],
  viewTitle: byId('view-title'),
  viewCount: byId('view-count'),
  // 하단 버튼
  clearCompletedBtn: byId('clear-completed'),
  trashBtn: byId('trash-btn'),
  trashCount: byId('trash-count'),
  exportBtn: byId('export-btn'),
  importBtn: byId('import-btn'),
  importFile: byId('import-file'),
  // 기타
  themeToggle: byId('theme-toggle'),
  quote: byId('quote'),
  quoteText: byId('quote-text'),
  quoteAuthor: byId('quote-author'),
  quoteRefresh: byId('quote-refresh'),
  toast: byId('toast'),
  toastMessage: byId('toast-message'),
  toastAction: byId('toast-action'),
  announcer: byId('sr-announcer'),
  dialog: byId('app-dialog'),
  dialogTitle: byId('dialog-title'),
  dialogMessage: byId('dialog-message'),
  dialogBody: byId('dialog-body'),
  dialogActions: byId('dialog-actions'),
};
els.searchBox = els.searchInput.closest('.search-box');

/* =============================================================================
 * 3. 유틸리티
 * ========================================================================== */

/**
 * 마지막 호출 후 wait(ms) 동안 추가 호출이 없을 때 fn을 실행한다.
 * flush(): 대기 중인 호출을 즉시 실행 / cancel(): 버림 / pending(): 대기 여부
 */
function debounce(fn, wait) {
  let timer = null;
  let lastArgs = [];
  const run = () => {
    timer = null;
    const args = lastArgs;
    lastArgs = [];
    fn(...args);
  };
  const debounced = (...args) => {
    lastArgs = args;
    clearTimeout(timer);
    timer = setTimeout(run, wait);
  };
  debounced.flush = () => {
    if (timer !== null) {
      clearTimeout(timer);
      run();
    }
  };
  debounced.cancel = () => {
    clearTimeout(timer);
    timer = null;
    lastArgs = [];
  };
  debounced.pending = () => timer !== null;
  return debounced;
}

/** 고유 id. randomUUID가 없는 환경(구형 브라우저 등)에서는 시간+난수로 대체 */
function generateId() {
  try {
    if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  } catch {
    /* 보안 컨텍스트가 아니면 예외가 날 수 있음 → 아래 대체 방식 사용 */
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

/** 알 수 없는 카테고리(이전 버전 데이터, 잘못된 가져오기 파일)는 기본값으로 */
function normalizeCategory(category) {
  // `in` 대신 hasOwn을 써야 'toString' 같은 프로토타입 키를 걸러낼 수 있다
  return typeof category === 'string' && hasOwn(CATEGORIES, category) ? category : DEFAULT_CATEGORY;
}

/**
 * 사용자 입력/가져온 텍스트 정리:
 * 유니코드 정규화(NFC: macOS에서 붙여넣은 한글 자모 분리 방지) → 제어 문자 제거 → 공백 정리 → 길이 제한
 */
function cleanText(value) {
  return String(value)
    .normalize('NFC')
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .trim()
    .slice(0, LIMITS.textLength)
    .trim();
}

/** 중복 비교용 키: 공백 차이와 대소문자를 무시 */
function compareKey(text) {
  return text.normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * 키워드 규칙을 미리 매처로 변환해 둔다 (분류할 때마다 정규식을 만들지 않도록).
 * @type {{ category: string, keyword: string, test: (lowerText: string) => boolean }[]}
 */
const KEYWORD_MATCHERS = Object.entries(CATEGORY_KEYWORDS).flatMap(([category, keywords]) =>
  keywords.map((keyword) => {
    const lower = keyword.toLowerCase();
    if (/^[a-z0-9 ]+$/.test(lower)) {
      // 영문: 단어 경계로만 일치 (한글 바로 옆에 붙은 경우도 단어로 인정)
      const re = new RegExp(`(^|[^a-z0-9])${lower.replace(/ /g, '\\s+')}($|[^a-z0-9])`);
      return { category, keyword, test: (text) => re.test(text) };
    }
    return { category, keyword, test: (text) => text.includes(lower) };
  }));

/**
 * 할 일 텍스트를 키워드로 분류한다.
 * 점수 = 일치한 키워드 개수, 같으면 가장 긴 키워드가 더 긴 쪽(더 구체적인 근거)이 이긴다.
 * 그래도 같으면 판단하기 어려우므로 null.
 * @returns {{ category: string, keywords: string[] } | null}
 */
function classifyText(text) {
  const lower = String(text).normalize('NFC').toLowerCase();
  if (!lower.trim()) return null;

  const hits = {};
  for (const m of KEYWORD_MATCHERS) {
    if (m.test(lower)) (hits[m.category] ??= []).push(m.keyword);
  }

  const ranked = Object.entries(hits)
    .map(([category, keywords]) => ({
      category,
      keywords,
      count: keywords.length,
      longest: Math.max(...keywords.map((k) => k.length)),
    }))
    .sort((a, b) => b.count - a.count || b.longest - a.longest);

  if (ranked.length === 0) return null;
  const [best, second] = ranked;
  if (second && second.count === best.count && second.longest === best.longest) return null; // 동점
  return { category: best.category, keywords: best.keywords };
}

/** 토스트 등에 쓰는 짧은 미리보기 */
function preview(text, max = 20) {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

const pad2 = (n) => String(n).padStart(2, '0');

/** "2시간 전" 형식. 미래 시각(기기 시계 오차)은 "방금 전"으로 처리 */
function formatRelativeTime(isoString) {
  const diffSec = Math.floor((Date.now() - new Date(isoString).getTime()) / 1000);
  if (Number.isNaN(diffSec)) return '';
  if (diffSec < 60) return '방금 전';
  const min = Math.floor(diffSec / 60);
  if (min < 60) return `${min}분 전`;
  const hour = Math.floor(min / 60);
  if (hour < 24) return `${hour}시간 전`;
  const day = Math.floor(hour / 24);
  if (day < 30) return `${day}일 전`;
  const month = Math.floor(day / 30);
  if (month < 12) return `${month}개월 전`;
  return `${Math.floor(month / 12)}년 전`;
}

/** 오늘 0시~내일 0시 범위(로컬 시간). 서머타임이 있어도 정확하도록 Date 생성자로 계산 */
function todayRange() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime();
  return { start, end };
}

/** 날짜 문자열 키 (격언 선택, 파일 이름에 사용) */
function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function fileStamp() {
  const d = new Date();
  return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}-${pad2(d.getHours())}${pad2(d.getMinutes())}`;
}

function percent(done, total) {
  return total === 0 ? 0 : Math.round((done / total) * 100);
}

function prefersReducedMotion() {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? false;
}

/** 키보드 단축키가 글자 입력을 방해하지 않도록, 텍스트 입력 중인지 판별 */
function isTextField(el) {
  if (!(el instanceof Element)) return false;
  if (el.isContentEditable) return true;
  if (el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') return true;
  if (el.tagName !== 'INPUT') return false;
  return !['checkbox', 'radio', 'button', 'submit', 'reset', 'file', 'range', 'color'].includes(el.type);
}

/** 같은 CSS 애니메이션을 다시 재생하기 위해 클래스를 뗐다가 강제 리플로우 후 다시 붙인다 */
function restartAnimationClass(el, className) {
  el.classList.remove(className);
  void el.offsetWidth;
  el.classList.add(className);
}

/* =============================================================================
 * 4. 저장소 (localStorage)
 *
 * 사생활 보호 모드·저장소 차단·용량 초과 등으로 localStorage가 실패해도
 * 앱이 멈추지 않도록 모든 접근을 이 객체를 통해 한다.
 * ========================================================================== */

const storage = (() => {
  let available = true;
  try {
    const probe = '__my_tasks_probe__';
    localStorage.setItem(probe, probe);
    localStorage.removeItem(probe);
  } catch {
    available = false;
  }

  return {
    available,
    get(key) {
      if (!available) return null;
      try {
        return localStorage.getItem(key);
      } catch {
        return null;
      }
    },
    /** @returns {boolean} 저장 성공 여부 */
    set(key, value) {
      if (!available) return false;
      try {
        localStorage.setItem(key, value);
        return true;
      } catch (err) {
        console.error(`[storage] "${key}" 저장 실패:`, err);
        notifyStorageError(err);
        return false;
      }
    },
  };
})();

let lastStorageErrorAt = 0;

/** 저장 실패 알림 (연속 실패 시 10초에 한 번만) */
function notifyStorageError(err) {
  const now = Date.now();
  if (now - lastStorageErrorAt < 10_000) return;
  lastStorageErrorAt = now;
  const isQuota = err?.name === 'QuotaExceededError' || err?.code === 22 || err?.code === 1014;
  showToast(
    isQuota
      ? '저장 공간이 부족해 변경 내용을 저장하지 못했습니다. 내보내기로 백업한 뒤 항목을 정리해 주세요.'
      : '변경 내용을 저장하지 못했습니다. 내보내기로 백업해 두세요.',
    { variant: 'error', duration: 8000 },
  );
}

/**
 * 할 일 하나를 검증·정리한다. 쓸 수 없는 값이면 null.
 * localStorage에서 불러올 때와 파일에서 가져올 때 같은 규칙을 쓴다.
 * @param {unknown} raw
 * @param {Set<string>} takenIds 이미 쓰인 id (중복이면 새 id 발급)
 * @param {{ classifyMissing?: boolean }} [options] 카테고리가 없거나 잘못됐으면 키워드로 분류 (가져오기용)
 */
function sanitizeTodo(raw, takenIds, { classifyMissing = false } = {}) {
  if (!raw || typeof raw !== 'object') return null;
  if (typeof raw.text !== 'string' && typeof raw.text !== 'number') return null;

  const text = cleanText(raw.text);
  if (!text) return null;

  // createdAt: 문자열/숫자로 된 올바른 날짜만 인정 (null은 1970년이 되므로 제외)
  let createdAt = new Date().toISOString();
  if (typeof raw.createdAt === 'string' || typeof raw.createdAt === 'number') {
    const date = new Date(raw.createdAt);
    if (!Number.isNaN(date.getTime())) createdAt = date.toISOString();
  }

  const id = typeof raw.id === 'string' && ID_PATTERN.test(raw.id) && !takenIds.has(raw.id)
    ? raw.id
    : generateId();

  const hasValidCategory = typeof raw.category === 'string' && hasOwn(CATEGORIES, raw.category);
  const autoCategory = !hasValidCategory && classifyMissing ? classifyText(text)?.category : null;

  return {
    id,
    text,
    completed: raw.completed === true || raw.completed === 'true',
    createdAt,
    category: autoCategory ?? normalizeCategory(raw.category),
    ...(autoCategory ? { [AUTO_CLASSIFIED]: true } : {}),
  };
}

/** sanitizeTodo가 자동 분류한 항목에 붙이는 표시 (Symbol이라 JSON 저장에는 포함되지 않음) */
const AUTO_CLASSIFIED = Symbol('autoClassified');

/**
 * 배열 전체 검증.
 * @returns {{ valid: object[], skipped: number, autoClassified: number }}
 */
function sanitizeTodos(rawList, takenIds = new Set(), options = {}) {
  const seen = new Set(takenIds);
  const valid = [];
  let skipped = 0;
  let autoClassified = 0;
  for (const raw of rawList) {
    const todo = sanitizeTodo(raw, seen, options);
    if (todo) {
      seen.add(todo.id);
      if (todo[AUTO_CLASSIFIED]) {
        autoClassified += 1;
        delete todo[AUTO_CLASSIFIED];
      }
      valid.push(todo);
    } else {
      skipped += 1;
    }
  }
  return { valid, skipped, autoClassified };
}

/**
 * 저장된 할 일을 불러온다.
 * JSON이 깨져 있으면 원본을 별도 키에 보관하고 빈 목록으로 시작한다(데이터 유실 방지).
 * @param {string[]} [notices] 사용자에게 알릴 메시지를 모을 배열
 */
function loadTodos(notices = []) {
  const raw = storage.get(STORAGE_KEYS.todos);
  if (raw === null) return [];
  try {
    const data = JSON.parse(raw);
    if (!Array.isArray(data)) throw new TypeError('저장된 값이 배열이 아님');
    const { valid, skipped } = sanitizeTodos(data);
    if (skipped > 0) notices.push(`손상된 항목 ${skipped}개를 건너뛰었습니다.`);
    return valid.slice(0, LIMITS.todos);
  } catch (err) {
    console.error('[storage] 할 일 데이터 파싱 실패:', err);
    storage.set(`todos_corrupt_${Date.now()}`, raw);
    notices.push('저장된 데이터를 읽지 못해 빈 목록으로 시작합니다. 원본은 브라우저에 따로 보관했습니다.');
    return [];
  }
}

/** 최근 삭제 목록 불러오기 (보관 기간이 지난 항목은 버림) */
function loadTrash() {
  try {
    const data = JSON.parse(storage.get(STORAGE_KEYS.trash) ?? '[]');
    if (!Array.isArray(data)) return [];
    const cutoff = Date.now() - LIMITS.trashDays * 24 * 60 * 60 * 1000;
    const ids = new Set();
    return data
      .map((entry) => {
        const todo = sanitizeTodo(entry?.todo, ids);
        const deletedAt = Date.parse(entry?.deletedAt);
        if (!todo || Number.isNaN(deletedAt) || deletedAt < cutoff) return null;
        ids.add(todo.id);
        return {
          todo,
          index: Number.isInteger(entry.index) && entry.index >= 0 ? entry.index : Number.MAX_SAFE_INTEGER,
          deletedAt: new Date(deletedAt).toISOString(),
          batchId: typeof entry.batchId === 'string' ? entry.batchId : generateId(),
        };
      })
      .filter(Boolean)
      .slice(0, LIMITS.trashItems);
  } catch {
    return [];
  }
}

/** 허용된 값 중 하나만 받아들이는 설정 불러오기 (필터, 정렬) */
function loadChoice(key, allowed, fallback) {
  const value = storage.get(key);
  return allowed.includes(value) ? value : fallback;
}

/* =============================================================================
 * 5. 상태
 * ========================================================================== */

/** 초기화 때 사용자에게 보여 줄 데이터 복구 안내 */
const startupNotices = [];

/** @type {{ id: string, text: string, completed: boolean, createdAt: string, category: 'work'|'personal'|'study' }[]} */
let todos = loadTodos(startupNotices);

/** @type {{ todo: object, index: number, deletedAt: string, batchId: string }[]} 최신 삭제가 앞쪽 */
let trash = loadTrash();

let currentFilter = loadChoice(STORAGE_KEYS.filter, FILTERS, 'all');
let currentSort = loadChoice(STORAGE_KEYS.sort, Object.keys(SORT_LABELS), DEFAULT_SORT);
let searchQuery = ''; // 의도적으로 저장하지 않음 (새로고침하면 초기화)

/** 다음 render()에서 한 항목에만 재생할 애니메이션 (todo-enter / todo-toggled / todo-saved) */
let pendingAnimation = null;

/** 첫 렌더에서는 배지 애니메이션을 생략하기 위한 플래그 */
let statsRendered = false;

/** id → { el, signature }. 내용(signature)이 같으면 기존 <li>를 재사용한다 */
const elementCache = new Map();

/** 진행 중인 드래그 정보 (8장 참고) */
let drag = null;
/** 드래그 중 다른 탭에서 데이터가 바뀌면 드래그가 끝난 뒤 다시 그린다 */
let renderAfterDrag = false;

/* 저장 (디바운스) ---------------------------------------------------------- */

const persistTodos = debounce(() => {
  storage.set(STORAGE_KEYS.todos, JSON.stringify(todos));
}, TIMING.saveDebounce);

function saveTodos() {
  persistTodos();
}

/** 대기 중인 저장을 즉시 실행 (페이지 이탈, 내보내기 직전 등) */
function flushSave() {
  persistTodos.flush();
}

function saveTrash() {
  storage.set(STORAGE_KEYS.trash, JSON.stringify(trash));
  updateTrashButton();
}

/* =============================================================================
 * 6. 상태 변경
 * ========================================================================== */

const findTodo = (id) => todos.find((t) => t.id === id);

/** 같은 내용(공백·대소문자 무시)의 다른 할 일 찾기 */
function findDuplicate(text, excludeId = null) {
  const key = compareKey(text);
  return todos.find((t) => t.id !== excludeId && compareKey(t.text) === key) ?? null;
}

/** @returns {object|null} 추가된 할 일 */
function addTodo(text, category) {
  const cleaned = cleanText(text);
  if (!cleaned) return null;
  if (todos.length >= LIMITS.todos) {
    showToast(`할 일은 최대 ${LIMITS.todos}개까지 저장할 수 있습니다. 완료된 항목을 정리해 주세요.`, { variant: 'error' });
    return null;
  }

  const todo = {
    id: generateId(),
    text: cleaned,
    completed: false,
    createdAt: new Date().toISOString(),
    category: normalizeCategory(category),
  };
  todos.push(todo);
  saveTodos();
  pendingAnimation = { id: todo.id, className: 'todo-enter' };
  render();

  // 필터·검색 때문에 새 항목이 화면에 안 보이면 알려 준다
  if (!els.list.querySelector(`[data-id="${CSS.escape(todo.id)}"]`)) {
    showToast(`${CATEGORIES[todo.category]} 카테고리에 추가했습니다 (현재 목록에는 보이지 않음)`);
  } else {
    announce(`"${preview(cleaned)}" 추가했습니다.`);
  }
  return todo;
}

function updateTodo(id, text, category) {
  const todo = findTodo(id);
  if (!todo) {
    render();
    return;
  }
  const cleaned = cleanText(text);
  const nextCategory = normalizeCategory(category);

  if (!cleaned) {
    // 빈 내용으로 저장하면 수정을 취소한 것으로 처리
    render();
    announce('내용이 비어 있어 수정을 취소했습니다.');
    return;
  }
  if (cleaned === todo.text && nextCategory === todo.category) {
    render();
    return;
  }

  todo.text = cleaned;
  todo.category = nextCategory;
  saveTodos();
  pendingAnimation = { id, className: 'todo-saved' };
  render();

  if (findDuplicate(cleaned, id)) {
    showToast('같은 내용의 할 일이 이미 있어요', { variant: 'warning' });
  } else {
    announce('수정했습니다.');
  }
}

function toggleTodo(id) {
  const todo = findTodo(id);
  if (!todo) {
    render(); // 체크박스 표시를 실제 상태로 되돌림
    return;
  }
  todo.completed = !todo.completed;
  saveTodos();
  pendingAnimation = { id, className: 'todo-toggled' };
  render();

  if (todo.completed && todos.every((t) => t.completed)) {
    showToast('🎉 모든 할 일을 완료했어요! 정말 수고했어요', { variant: 'success' });
  }
}

/**
 * 할 일을 삭제하고 최근 삭제 목록(휴지통)에 넣는다.
 * @param {Set<string>} ids
 * @returns {{ removed: object[] } | null} 삭제된 휴지통 항목 (실행 취소용)
 */
function removeTodos(ids) {
  const batchId = generateId();
  const deletedAt = new Date().toISOString();
  const removed = [];
  todos.forEach((todo, index) => {
    if (ids.has(todo.id)) removed.push({ todo, index, deletedAt, batchId });
  });
  if (removed.length === 0) return null;

  todos = todos.filter((t) => !ids.has(t.id));
  trash = [...removed, ...trash];
  trimTrash();
  saveTrash();
  saveTodos();
  render();
  return { removed };
}

/**
 * 휴지통 항목을 원래 위치(인덱스) 근처로 되돌린다.
 * 인덱스 오름차순으로 끼워 넣으면 여러 개를 복구해도 원래 순서가 유지된다.
 * @returns {number} 실제로 복구된 개수
 */
function restoreEntries(entries) {
  const sorted = [...entries].sort((a, b) => a.index - b.index);
  const handled = new Set();
  let restored = 0;
  let firstRestoredId = null;
  let hitLimit = false;

  for (const entry of sorted) {
    if (findTodo(entry.todo.id)) {
      handled.add(entry); // 이미 목록에 있음 (다른 탭에서 복구 등) → 휴지통에서만 제거
      continue;
    }
    if (todos.length >= LIMITS.todos) {
      hitLimit = true; // 한도 초과분은 휴지통에 남겨 둠
      break;
    }
    todos.splice(Math.min(entry.index, todos.length), 0, entry.todo);
    handled.add(entry);
    restored += 1;
    firstRestoredId ??= entry.todo.id;
  }

  trash = trash.filter((e) => !handled.has(e));
  saveTrash();
  saveTodos();
  if (firstRestoredId) pendingAnimation = { id: firstRestoredId, className: 'todo-enter' };
  render();

  if (hitLimit) {
    showToast(`할 일이 ${LIMITS.todos}개로 가득 차서 일부를 복구하지 못했습니다. 남은 항목은 "최근 삭제"에 있습니다.`, { variant: 'error' });
  }
  return restored;
}

/** 보관 개수 제한. 단, 가장 최근 삭제 묶음은 쪼개지 않는다(통째로 복구할 수 있도록) */
function trimTrash() {
  if (trash.length <= LIMITS.trashItems) return;
  const newestBatch = trash[0]?.batchId;
  trash = trash.filter((entry, i) => i < LIMITS.trashItems || entry.batchId === newestBatch);
}

/**
 * 배열 안에서 항목을 다른 항목의 앞/뒤로 옮긴다.
 * 필터·검색으로 일부만 보이더라도 "보이는 이웃" 기준으로 옮기면 의도한 위치가 된다.
 */
function moveTodo(id, targetId, position) {
  const from = todos.findIndex((t) => t.id === id);
  if (from === -1 || id === targetId) return false;
  const [item] = todos.splice(from, 1);
  let to = todos.findIndex((t) => t.id === targetId);
  if (to === -1) {
    todos.splice(from, 0, item); // 대상이 사라졌으면 원위치
    return false;
  }
  if (position === 'after') to += 1;
  todos.splice(to, 0, item);
  return true;
}

function setFilter(filter) {
  if (!FILTERS.includes(filter)) return;
  currentFilter = filter;
  storage.set(STORAGE_KEYS.filter, filter);
  syncCategorySelect();
  render();
}

function setSort(sort, { silent = false } = {}) {
  if (!hasOwn(SORT_LABELS, sort)) return;
  currentSort = sort;
  storage.set(STORAGE_KEYS.sort, sort);
  els.sortSelect.value = sort;
  render();
  if (!silent) announce(`${SORT_LABELS[sort]}으로 정렬했습니다.`);
}

/* 키워드 자동 분류 (새 할 일 입력) ----------------------------------------
 * - 입력이 키워드와 일치하면 카테고리 선택 상자를 그 카테고리로 바꾸고 근거를 보여 준다.
 * - 키워드가 사라지면 자동 분류 전 값(baseline)으로 되돌린다.
 * - 사용자가 직접 카테고리를 고르면(touched) 그 할 일을 추가할 때까지 덮어쓰지 않고,
 *   키워드가 다른 카테고리를 가리키면 제안만 표시한다.
 * - 할 일을 추가하면 상태를 초기화한다. */

const autoCategory = {
  touched: false, // 이번 입력에서 사용자가 카테고리를 직접 골랐는지
  applied: null,  // 자동 분류로 설정한 카테고리 (없으면 null)
  baseline: null, // 자동 분류 전 선택값
};

/** 특정 카테고리 필터를 보고 있으면 새 할 일의 기본 카테고리도 그에 맞춤 */
function syncCategorySelect() {
  if (currentFilter === 'all') return;
  if (autoCategory.applied !== null) {
    autoCategory.baseline = currentFilter; // 자동 분류가 풀리면 필터 카테고리로 돌아가도록
  } else if (!autoCategory.touched) {
    els.categorySelect.value = currentFilter;
  }
}

/** 받침에 따라 "로"/"으로" (ㄹ 받침은 "로") */
function withRo(word) {
  const code = word.charCodeAt(word.length - 1) - 0xac00;
  if (code < 0 || code > 11171) return `${word}(으)로`;
  const jong = code % 28;
  return `${word}${jong === 0 || jong === 8 ? '로' : '으로'}`;
}

/** 입력창 아래 분류 안내. 내용이 같으면 다시 쓰지 않아 스크린 리더가 반복해서 읽지 않게 한다 */
function setCategoryHint(kind, result) {
  const el = els.categoryHint;
  const key = kind ? `${kind}:${result.category}:${result.keywords.join(',')}` : '';
  if (el.dataset.key === key) return;
  el.dataset.key = key;
  if (!kind) {
    el.replaceChildren();
    return;
  }
  const keywords = result.keywords.slice(0, 2).map((k) => `"${k}"`).join(', ');
  const strong = document.createElement('strong');
  strong.textContent = kind === 'auto' ? withRo(CATEGORIES[result.category]) : CATEGORIES[result.category];
  el.replaceChildren(
    kind === 'auto' ? `🏷 ${keywords} → ` : `💡 ${keywords}: `,
    strong,
    kind === 'auto' ? ' 자동 분류했어요' : ' 카테고리일 수도 있어요',
  );
}

/** 현재 입력으로 카테고리를 분류해 선택 상자와 안내에 반영 */
function applyAutoCategory() {
  const select = els.categorySelect;
  const text = cleanText(els.input.value);
  const result = text ? classifyText(text) : null;

  if (autoCategory.touched) {
    const differs = result && result.category !== select.value;
    setCategoryHint(differs ? 'suggest' : null, result);
    return;
  }

  if (result) {
    if (autoCategory.applied === null) autoCategory.baseline = select.value;
    if (select.value !== result.category) {
      select.value = result.category;
      restartAnimationClass(select, 'auto-applied');
    }
    autoCategory.applied = result.category;
    setCategoryHint('auto', result);
  } else {
    if (autoCategory.applied !== null) {
      select.value = autoCategory.baseline ?? select.value;
      autoCategory.applied = null;
      autoCategory.baseline = null;
    }
    setCategoryHint(null);
  }
}

/** 할 일을 추가한 뒤 다음 입력을 위해 초기화 */
function resetAutoCategory() {
  if (autoCategory.applied !== null && autoCategory.baseline) els.categorySelect.value = autoCategory.baseline;
  autoCategory.touched = false;
  autoCategory.applied = null;
  autoCategory.baseline = null;
  setCategoryHint(null);
  syncCategorySelect();
}

/* =============================================================================
 * 7. 렌더링
 * ========================================================================== */

/**
 * 정렬. 배열 순서(직접 정렬 순서)를 동점 처리 기준으로 쓰기 위해 안정 정렬(Array#sort)에 의존한다.
 * - status: 미완료 → 완료 (그룹 안은 직접 정렬 순서)
 * - category: 업무 → 개인 → 공부 (그룹 안은 직접 정렬 순서)
 * - created: 최신 생성 순
 * - manual: 배열 순서 그대로
 */
function sortTodos(list, mode) {
  const sorted = [...list];
  switch (mode) {
    case 'status':
      return sorted.sort((a, b) => Number(a.completed) - Number(b.completed));
    case 'category':
      return sorted.sort((a, b) => CATEGORY_ORDER[a.category] - CATEGORY_ORDER[b.category]);
    case 'created':
      return sorted.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    default:
      return sorted;
  }
}

/** 현재 필터·검색·정렬을 적용한, 화면에 보일 할 일 목록 */
function getVisibleTodos() {
  const query = searchQuery.toLowerCase();
  const filtered = todos.filter((todo) =>
    (currentFilter === 'all' || todo.category === currentFilter)
    && (!query || todo.text.toLowerCase().includes(query)));
  return sortTodos(filtered, currentSort);
}

/** 검색어 부분을 <mark>로 감싼다. 사용자 텍스트는 텍스트 노드로만 넣어 XSS를 막는다 */
function fillHighlightedText(el, text) {
  if (!searchQuery) {
    el.textContent = text;
    return;
  }
  const lower = text.toLowerCase();
  const query = searchQuery.toLowerCase();
  let pos = 0;
  let idx = lower.indexOf(query);
  while (idx !== -1) {
    if (idx > pos) el.append(text.slice(pos, idx));
    const mark = document.createElement('mark');
    mark.textContent = text.slice(idx, idx + query.length);
    el.append(mark);
    pos = idx + query.length;
    idx = lower.indexOf(query, pos);
  }
  if (pos < text.length) el.append(text.slice(pos));
}

/** 할 일 하나의 <li>를 만든다 (완료 상태는 syncCompletedState에서 반영) */
function createTodoElement(todo) {
  const li = document.createElement('li');
  li.className = 'todo-item';
  li.dataset.id = todo.id;

  // 스크린 리더: 체크박스 이름 = 할 일 텍스트, 설명 = 카테고리·생성 시간
  const textId = `todo-text-${todo.id}`;
  const metaId = `todo-meta-${todo.id}`;

  const handle = document.createElement('button');
  handle.type = 'button';
  handle.className = 'drag-handle';
  handle.innerHTML = ICONS.grip;
  handle.title = '끌어서 순서 바꾸기';
  handle.setAttribute('aria-label', `"${todo.text}" 순서 바꾸기`);
  handle.setAttribute('aria-describedby', 'list-help');

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.className = 'todo-checkbox';
  checkbox.setAttribute('aria-labelledby', textId);
  checkbox.setAttribute('aria-describedby', metaId);

  const content = document.createElement('div');
  content.className = 'todo-content';

  const span = document.createElement('span');
  span.className = 'todo-text';
  span.id = textId;
  fillHighlightedText(span, todo.text);

  const meta = document.createElement('div');
  meta.className = 'todo-meta';
  meta.id = metaId;

  const tag = document.createElement('span');
  tag.className = `category-tag category-${todo.category}`;
  tag.textContent = CATEGORIES[todo.category];

  const time = document.createElement('time');
  time.className = 'todo-time';
  time.dateTime = todo.createdAt;
  time.title = new Date(todo.createdAt).toLocaleString('ko-KR');
  time.textContent = formatRelativeTime(todo.createdAt);

  meta.append(tag, time);
  content.append(span, meta);

  const actions = document.createElement('div');
  actions.className = 'todo-actions';

  const editBtn = document.createElement('button');
  editBtn.type = 'button';
  editBtn.className = 'icon-btn edit-btn';
  editBtn.innerHTML = ICONS.pencil;
  editBtn.title = '수정';
  editBtn.setAttribute('aria-label', `"${todo.text}" 수정`);

  const deleteBtn = document.createElement('button');
  deleteBtn.type = 'button';
  deleteBtn.className = 'icon-btn delete-btn';
  deleteBtn.textContent = '×';
  deleteBtn.title = '삭제';
  deleteBtn.setAttribute('aria-label', `"${todo.text}" 삭제`);

  actions.append(editBtn, deleteBtn);
  li.append(handle, checkbox, content, actions);
  return li;
}

/** 완료 상태는 DOM을 다시 만들지 않고 제자리에서 갱신 (체크박스 포커스 유지) */
function syncCompletedState(el, todo) {
  el.classList.toggle('completed', todo.completed);
  const checkbox = el.querySelector('.todo-checkbox');
  if (checkbox && checkbox.checked !== todo.completed) checkbox.checked = todo.completed;
}

/** 캐시된 <li>를 재사용하거나, 표시 내용이 바뀌었으면 새로 만든다 */
function getTodoElement(todo) {
  // 텍스트·카테고리·검색 하이라이트가 같으면 같은 DOM을 써도 된다
  const signature = `${todo.text}\u0000${todo.category}\u0000${searchQuery}`;
  const cached = elementCache.get(todo.id);
  let el;
  if (cached && cached.signature === signature) {
    el = cached.el;
  } else {
    el = createTodoElement(todo);
    elementCache.set(todo.id, { el, signature });
  }
  syncCompletedState(el, todo);
  return el;
}

/**
 * 키 기반 재조정: 필요 없는 노드는 제거하고, 원하는 순서와 다른 노드만 옮긴다.
 * 순서가 이미 맞는 노드는 건드리지 않으므로 DOM 변경이 최소화된다.
 */
function reconcileList(visible) {
  const desired = visible.map(getTodoElement);
  const keep = new Set(desired);
  for (const child of [...els.list.children]) {
    if (!keep.has(child)) child.remove();
  }
  let cursor = els.list.firstElementChild;
  for (const el of desired) {
    if (el === cursor) {
      cursor = cursor.nextElementSibling;
    } else {
      els.list.insertBefore(el, cursor);
    }
  }
}

/** 삭제된 할 일의 캐시 정리 (메모리 누수 방지) */
function pruneElementCache() {
  if (elementCache.size <= todos.length) return;
  const alive = new Set(todos.map((t) => t.id));
  for (const id of elementCache.keys()) {
    if (!alive.has(id)) elementCache.delete(id);
  }
}

/* 포커스 관리 --------------------------------------------------------------
 * 재조정 중 포커스된 노드가 옮겨지거나 제거되면 포커스가 <body>로 빠진다.
 * 렌더 전 포커스 위치(어느 항목의 어느 컨트롤)를 기억했다가, 잃어버렸으면 되돌린다.
 * 항목이 사라졌으면(삭제) 같은 자리의 이웃 항목으로, 목록이 비면 입력창으로 보낸다. */

const FOCUS_TARGETS = ['.edit-input', '.edit-select', '.todo-checkbox', '.edit-btn', '.delete-btn', '.drag-handle'];

function captureFocus() {
  const active = document.activeElement;
  const li = active?.closest?.('.todo-item');
  if (!li || li.parentElement !== els.list) return null;
  return {
    element: active,
    id: li.dataset.id,
    selector: FOCUS_TARGETS.find((sel) => active.matches(sel)) ?? '.todo-checkbox',
    index: [...els.list.children].indexOf(li),
  };
}

function restoreFocus(state) {
  if (!state) return;
  const active = document.activeElement;
  // 포커스가 여전히 살아 있거나, 사용자가 다른 곳(다이얼로그 등)으로 옮겼으면 건드리지 않음
  if (active && active !== document.body && active.isConnected) return;

  const focusIn = (li) => {
    if (!li) return false;
    // 편집기에서 포커스를 잃었으면(편집 종료) 그 항목의 수정 버튼으로
    const fallback = state.selector.startsWith('.edit-') ? '.edit-btn' : '.todo-checkbox';
    const target = li.querySelector(state.selector) ?? li.querySelector(fallback);
    if (!target) return false;
    target.focus({ preventScroll: true }); // 완료 항목이 아래로 이동해도 화면이 튀지 않도록
    return document.activeElement === target;
  };

  const same = els.list.querySelector(`.todo-item[data-id="${CSS.escape(state.id)}"]`);
  if (focusIn(same)) return;

  const items = els.list.children;
  const neighbor = items[Math.min(state.index, items.length - 1)];
  if (focusIn(neighbor)) return;

  els.input.focus({ preventScroll: true });
}

/* FLIP 애니메이션 ----------------------------------------------------------
 * First: 렌더 전 위치 기록 → Last: 렌더 후 위치 → Invert: 차이만큼 되돌려 놓고 → Play: 0으로 전환.
 * 레이아웃 읽기를 한꺼번에 하고 쓰기를 한꺼번에 해서 강제 리플로우를 한 번으로 줄인다.
 * 화면 밖 항목은 애니메이션하지 않는다(긴 목록 성능). */

function measureTops() {
  const tops = new Map();
  for (const el of els.list.children) {
    tops.set(el.dataset.id, el.getBoundingClientRect().top);
  }
  return tops;
}

function playFlip(prevTops) {
  const viewTop = -200;
  const viewBottom = window.innerHeight + 200;
  const moves = [];

  for (const el of els.list.children) {
    const prev = prevTops.get(el.dataset.id);
    if (prev === undefined) continue;
    const now = el.getBoundingClientRect().top;
    const dy = prev - now;
    const visible = (prev > viewTop && prev < viewBottom) || (now > viewTop && now < viewBottom);
    if (Math.abs(dy) >= 1 && visible) moves.push([el, dy]);
  }
  if (moves.length === 0) return;

  for (const [el, dy] of moves) {
    el.style.transition = 'none';
    el.style.transform = `translateY(${dy}px)`;
  }
  void els.list.offsetHeight; // 시작 위치 확정 (리플로우 1회)
  for (const [el] of moves) {
    el.style.transition = 'transform 0.35s ease';
    el.style.transform = '';
  }
}

/* 렌더 --------------------------------------------------------------------- */

function render() {
  if (drag) {
    // 드래그 중에는 DOM을 건드리지 않고, 끝난 뒤 다시 그린다
    renderAfterDrag = true;
    return;
  }

  const focusState = captureFocus();
  const prevTops = measureTops();

  const visible = getVisibleTodos();
  reconcileList(visible);

  if (pendingAnimation) {
    const el = elementCache.get(pendingAnimation.id)?.el;
    if (el?.isConnected) restartAnimationClass(el, pendingAnimation.className);
    pendingAnimation = null;
  }

  playFlip(prevTops);
  updateEmptyState(visible.length);
  updateViewHeading(visible);
  updateFilterButtons();
  renderStats();
  restoreFocus(focusState);
  pruneElementCache();
}

function getEmptyMessage() {
  if (todos.length === 0) return '할 일이 없습니다. 추가해보세요!';
  if (searchQuery) return `"${searchQuery}"에 해당하는 할 일이 없습니다.`;
  if (currentFilter !== 'all') return `${CATEGORIES[currentFilter]} 카테고리에 할 일이 없습니다. 추가해보세요!`;
  return '할 일이 없습니다. 추가해보세요!';
}

function updateEmptyState(visibleCount) {
  els.emptyMessage.textContent = getEmptyMessage(); // 검색어도 textContent로만 넣음
  els.emptyMessage.classList.toggle('hidden', visibleCount > 0);
}

/** 목록 제목과 개수 (#view-title / #view-count) */
function updateViewHeading(visible) {
  if (els.viewTitle) {
    els.viewTitle.textContent = currentFilter === 'all' ? '전체 할 일' : `${CATEGORIES[currentFilter]} 할 일`;
  }
  if (els.viewCount) {
    const remaining = visible.filter((t) => !t.completed).length;
    els.viewCount.textContent = searchQuery
      ? `"${searchQuery}" 검색 결과 ${visible.length}개`
      : `${visible.length}개 중 ${remaining}개 남음`;
  }
}

function updateFilterButtons() {
  for (const btn of els.filterBar.querySelectorAll('.filter-btn')) {
    const active = btn.dataset.filter === currentFilter;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', String(active));
  }
}

function setProgress(progressEl, value, valueText) {
  progressEl.querySelector('.progress-fill').style.width = `${value}%`;
  progressEl.setAttribute('aria-valuenow', String(value));
  if (valueText) progressEl.setAttribute('aria-valuetext', valueText);
}

/** 대시보드·배지·하단 버튼. 필터·검색과 무관하게 전체 할 일 기준이며, 한 번의 순회로 집계한다 */
function renderStats() {
  const { start, end } = todayRange();
  const byCategory = Object.fromEntries(Object.keys(CATEGORIES).map((c) => [c, { total: 0, done: 0 }]));
  let done = 0;
  let today = 0;

  for (const todo of todos) {
    const cat = byCategory[todo.category];
    cat.total += 1;
    if (todo.completed) {
      done += 1;
      cat.done += 1;
    }
    const created = Date.parse(todo.createdAt);
    if (created >= start && created < end) today += 1;
  }

  const total = todos.length;
  const pct = percent(done, total);
  els.overallText.textContent = `${done}/${total} 완료 (${pct}%)`;
  setProgress(els.overallProgress, pct, `${total}개 중 ${done}개 완료, ${pct}%`);

  for (const el of els.statsCats) {
    const cat = byCategory[el.dataset.category];
    el.querySelector('.stats-cat-count').textContent = `${cat.done}/${cat.total}`;
    setProgress(el.querySelector('.progress'), percent(cat.done, cat.total), `${cat.total}개 중 ${cat.done}개 완료`);
  }

  els.todayCount.textContent = String(today);
  renderCheer(total, done);

  // 카테고리 메뉴의 항목 수
  for (const el of els.filterCounts) {
    const key = el.dataset.count;
    el.textContent = String(key === 'all' ? total : byCategory[key]?.total ?? 0);
  }

  // 남은 할 일 배지: 숫자가 바뀔 때만 튀어 오르는 애니메이션
  const remaining = String(total - done);
  if (els.remainingCount.textContent !== remaining) {
    els.remainingCount.textContent = remaining;
    if (statsRendered) restartAnimationClass(els.remainingBadge, 'bump');
  }
  els.remainingBadge.classList.toggle('empty', total > 0 && done === total);

  els.clearCompletedBtn.disabled = done === 0;
  els.clearCompletedBtn.textContent = done > 0 ? `완료된 항목 모두 삭제 (${done})` : '완료된 항목 모두 삭제';
  els.exportBtn.disabled = total === 0;

  statsRendered = true;
}

/** 1분마다 상대 시간만 갱신 (목록을 다시 그리지 않음) */
function refreshTimes() {
  for (const el of els.list.querySelectorAll('.todo-time')) {
    el.textContent = formatRelativeTime(el.dateTime);
  }
}

/* =============================================================================
 * 8. 드래그 정렬
 *
 * HTML5 드래그 앤 드롭은 터치에서 동작하지 않으므로 Pointer Events로 직접 구현한다.
 * - 손잡이(.drag-handle)를 누르고 움직이면 항목이 포인터를 따라온다.
 * - 끌고 있는 항목은 DOM에서 옮기지 않고(포인터 캡처·포커스 유지), 이웃 항목을 옮긴다.
 * - 놓으면 DOM 순서를 todos 배열에 반영한다. Esc 또는 포인터 취소 시 원래대로.
 * - 키보드: 손잡이에 포커스를 두고 ↑/↓.
 *
 * 정렬 방식별 동작:
 * - 직접 정렬: 자유롭게 이동
 * - 완료 상태순·카테고리순: 그룹 안에서만 의미가 있음(그룹을 넘으면 되돌아가며 안내)
 * - 생성일순: 순서가 날짜로 고정이므로, 옮기면 현재 순서 그대로 "직접 정렬"로 전환
 * ========================================================================== */

function onDragPointerDown(e) {
  const handle = e.target.closest('.drag-handle');
  if (!handle || drag) return;
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  const item = handle.closest('.todo-item');
  if (!item || item.classList.contains('editing') || item.classList.contains('leaving')) return;

  e.preventDefault(); // 텍스트 선택, 터치 스크롤 방지
  handle.focus({ preventScroll: true });
  try {
    handle.setPointerCapture(e.pointerId);
  } catch {
    /* 일부 환경에서 실패해도 window 리스너로 계속 추적 가능 */
  }

  drag = {
    item,
    handle,
    pointerId: e.pointerId,
    startClientY: e.clientY,
    startScrollY: window.scrollY,
    startOffsetTop: item.offsetTop,
    startIndex: [...els.list.children].indexOf(item),
    clientY: e.clientY,
    active: false, // 임계값을 넘겨 실제 드래그가 시작됐는지
    rafId: 0,
  };
  window.addEventListener('pointermove', onDragPointerMove);
  window.addEventListener('pointerup', onDragPointerUp);
  window.addEventListener('pointercancel', onDragPointerCancel);
}

function onDragPointerMove(e) {
  if (!drag || e.pointerId !== drag.pointerId) return;
  drag.clientY = e.clientY;
  if (!drag.active) {
    if (Math.abs(e.clientY - drag.startClientY) < TIMING.dragThreshold) return;
    drag.active = true;
    drag.item.classList.add('dragging');
    els.list.classList.add('is-dragging');
    drag.item.style.transition = 'none';
    drag.rafId = requestAnimationFrame(autoScrollLoop);
  }
  e.preventDefault();
  updateDragPosition();
}

function onDragPointerUp(e) {
  if (!drag || e.pointerId !== drag.pointerId) return;
  endDrag(true);
}

function onDragPointerCancel(e) {
  if (!drag || e.pointerId !== drag.pointerId) return;
  endDrag(false);
}

/** 포인터 위치에 맞춰 항목을 옮기고, 중심이 이웃의 중간을 넘으면 자리를 바꾼다 */
function updateDragPosition() {
  const { item } = drag;
  // 스크롤까지 고려한 포인터 이동량
  const pointerDelta = (drag.clientY + window.scrollY) - (drag.startClientY + drag.startScrollY);
  // 항목의 "보이는" 중심 (offsetTop은 transform 영향을 받지 않음)
  const center = drag.startOffsetTop + pointerDelta + item.offsetHeight / 2;

  let prev = item.previousElementSibling;
  while (prev && center < prev.offsetTop + prev.offsetHeight / 2) {
    shiftSibling(prev, () => els.list.insertBefore(prev, item.nextElementSibling));
    prev = item.previousElementSibling;
  }
  let next = item.nextElementSibling;
  while (next && center > next.offsetTop + next.offsetHeight / 2) {
    shiftSibling(next, () => els.list.insertBefore(next, item));
    next = item.nextElementSibling;
  }

  // DOM 위치가 바뀌었을 수 있으므로 현재 레이아웃 위치 기준으로 transform 재계산
  item.style.transform = `translateY(${pointerDelta - (item.offsetTop - drag.startOffsetTop)}px)`;
}

/** 이웃 항목을 옮기면서 이전 자리에서 미끄러지듯 이동시키는 작은 FLIP */
function shiftSibling(sibling, moveFn) {
  const before = sibling.offsetTop;
  moveFn();
  const dy = before - sibling.offsetTop;
  sibling.style.transition = 'none';
  sibling.style.transform = `translateY(${dy}px)`;
  void sibling.offsetHeight;
  sibling.style.transition = 'transform 0.2s ease';
  sibling.style.transform = '';
}

/** 포인터가 화면 위/아래 가장자리 근처에 있으면 자동 스크롤 */
function autoScrollLoop() {
  if (!drag?.active) return;
  const edge = 64;
  const y = drag.clientY;
  let dy = 0;
  if (y < edge) dy = -Math.ceil((edge - y) / 4);
  else if (y > window.innerHeight - edge) dy = Math.ceil((y - (window.innerHeight - edge)) / 4);
  if (dy !== 0) {
    window.scrollBy(0, dy);
    updateDragPosition();
  }
  drag.rafId = requestAnimationFrame(autoScrollLoop);
}

/** @param {boolean} commit true면 새 순서를 저장, false면 원래대로 */
function endDrag(commit) {
  if (!drag) return;
  const d = drag;
  drag = null;
  cancelAnimationFrame(d.rafId);
  window.removeEventListener('pointermove', onDragPointerMove);
  window.removeEventListener('pointerup', onDragPointerUp);
  window.removeEventListener('pointercancel', onDragPointerCancel);
  try {
    d.handle.releasePointerCapture(d.pointerId);
  } catch {
    /* 이미 해제됨 */
  }

  const { item } = d;
  const visualTop = item.getBoundingClientRect().top; // 놓는 순간의 위치 (부드러운 착지용)
  item.classList.remove('dragging');
  els.list.classList.remove('is-dragging');
  item.style.transform = '';
  item.style.transition = '';

  if (!d.active) {
    if (renderAfterDrag) {
      renderAfterDrag = false;
      render();
    }
    return; // 클릭만 했음
  }

  const newIndex = [...els.list.children].indexOf(item);
  if (commit && newIndex !== d.startIndex) {
    const next = item.nextElementSibling;
    const prev = item.previousElementSibling;
    const target = next
      ? { targetId: next.dataset.id, position: 'before' }
      : { targetId: prev.dataset.id, position: 'after' };
    renderAfterDrag = false;
    commitMove(item.dataset.id, target);
  } else {
    renderAfterDrag = false;
    render(); // 원래 순서로 되돌림
    if (!commit) announce('순서 변경을 취소했습니다.');
  }

  // 놓은 위치에서 최종 자리로 부드럽게 착지
  const dy = visualTop - item.getBoundingClientRect().top;
  if (item.isConnected && Math.abs(dy) > 1) {
    item.style.transition = 'none';
    item.style.transform = `translateY(${dy}px)`;
    void item.offsetHeight;
    item.style.transition = 'transform 0.2s ease';
    item.style.transform = '';
  }
  if (item.isConnected) d.handle.focus({ preventScroll: true });
}

/**
 * 드래그/키보드 이동 결과를 상태에 반영한다.
 * @param {string} id 옮긴 할 일
 * @param {{ targetId: string, position: 'before'|'after' }} target 기준 이웃
 */
function commitMove(id, { targetId, position }) {
  const todo = findTodo(id);
  if (!todo) return;

  // 생성일순은 순서가 날짜로 고정 → 현재 보이는 순서를 배열에 굳히고 직접 정렬로 전환
  if (currentSort === 'created') {
    todos = sortTodos(todos, 'created');
    currentSort = 'manual';
    storage.set(STORAGE_KEYS.sort, 'manual');
    els.sortSelect.value = 'manual';
    showToast('순서를 직접 바꿔서 "직접 정렬"로 전환했습니다');
  }

  if (!moveTodo(id, targetId, position)) {
    render();
    return;
  }
  saveTodos();
  render();

  // 그룹 정렬(완료 상태순·카테고리순)에서 그룹을 넘어가면 정렬 때문에 제자리로 돌아간다
  const el = els.list.querySelector(`[data-id="${CSS.escape(id)}"]`);
  const landedNextTo = position === 'before'
    ? el?.nextElementSibling?.dataset.id
    : el?.previousElementSibling?.dataset.id;
  if (el && landedNextTo !== targetId) {
    showToast(`${SORT_LABELS[currentSort]}에서는 같은 그룹 안에서만 옮길 수 있어요. 자유롭게 옮기려면 "직접 정렬"을 선택하세요.`, { variant: 'warning', duration: 5000 });
    return;
  }
  const position1 = [...els.list.children].indexOf(el) + 1;
  announce(`"${preview(todo.text)}" ${position1}번째로 옮겼습니다. 전체 ${els.list.children.length}개.`);
}

/** 손잡이에서 ↑/↓ 키로 한 칸 이동 */
function moveByKeyboard(item, direction) {
  const sibling = direction < 0 ? item.previousElementSibling : item.nextElementSibling;
  if (!sibling) {
    announce(direction < 0 ? '맨 위입니다.' : '맨 아래입니다.');
    return;
  }
  commitMove(item.dataset.id, {
    targetId: sibling.dataset.id,
    position: direction < 0 ? 'before' : 'after',
  });
}

/* =============================================================================
 * 9. 인라인 수정
 *
 * 편집 상태는 DOM에만 있다. 수정 버튼을 누르면 내용 영역을 입력창+카테고리 선택으로 바꾼다.
 * 렌더가 일어나도 캐시된 <li>가 재사용되므로 편집기가 유지되고,
 * 편집을 끝낼 때 캐시를 무효화해서 새 내용으로 다시 그린다.
 * ========================================================================== */

function startEdit(item) {
  if (!item || item.classList.contains('editing') || item.classList.contains('leaving')) return;
  const todo = findTodo(item.dataset.id);
  if (!todo) return;

  item.classList.add('editing');

  const editor = document.createElement('div');
  editor.className = 'todo-editor';

  const textInput = document.createElement('input');
  textInput.type = 'text';
  textInput.className = 'edit-input';
  textInput.value = todo.text;
  textInput.maxLength = LIMITS.textLength;
  textInput.setAttribute('aria-label', '할 일 수정 (Enter 저장, Esc 취소)');

  const select = els.categorySelect.cloneNode(true);
  select.removeAttribute('id');
  select.className = 'edit-select';
  select.setAttribute('aria-label', '카테고리 수정');
  select.value = todo.category;

  editor.append(textInput, select);
  item.querySelector('.todo-content').replaceChildren(editor);
  textInput.focus();
  textInput.select();

  let finished = false;
  const finish = (save) => {
    if (finished) return;
    finished = true;
    elementCache.delete(todo.id); // 편집기 DOM을 버리고 새로 그리도록
    if (save) updateTodo(todo.id, textInput.value, select.value);
    else render();
  };

  editor.addEventListener('keydown', (e) => {
    if (e.isComposing) return; // 한글 조합 중 Enter는 무시 (조합이 끝난 뒤 Enter가 다시 들어옴)
    if (e.key === 'Enter') {
      e.preventDefault();
      finish(true);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation(); // 검색어 지우기 같은 다른 Esc 동작으로 번지지 않도록
      finish(false);
    }
  });
  // 입력창 ↔ 선택 상자 사이 이동은 편집 유지, 편집 영역 밖으로 나가면 저장
  editor.addEventListener('focusout', (e) => {
    if (!editor.contains(e.relatedTarget)) finish(true);
  });
}

/** 열려 있는 편집기가 있으면 저장하고 닫는다 (포커스를 빼면 focusout에서 저장됨) */
function commitOpenEditor() {
  if (document.activeElement?.closest?.('.todo-editor')) document.activeElement.blur();
}

/* =============================================================================
 * 10. 토스트 · 스크린 리더 알림 · 다이얼로그
 * ========================================================================== */

let toastTimer = null;
let toastDuration = TIMING.toast;

/**
 * 화면 하단 알림. 새 알림은 이전 알림을 대체한다.
 * @param {string} message
 * @param {{ action?: { label: string, onClick: () => void }, variant?: 'error'|'warning'|'success', duration?: number }} [options]
 */
function showToast(message, { action = null, variant = '', duration } = {}) {
  els.toastMessage.textContent = message;
  els.toast.dataset.variant = variant;
  els.toastAction.hidden = !action;
  els.toastAction.onclick = null;
  if (action) {
    els.toastAction.textContent = action.label;
    els.toastAction.onclick = () => {
      hideToast();
      try {
        action.onClick();
      } catch (err) {
        reportError(err);
      }
    };
  }
  els.toast.classList.add('show');
  toastDuration = duration ?? (action ? TIMING.toastWithAction : TIMING.toast);
  scheduleToastHide();
}

function scheduleToastHide(delay = toastDuration) {
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, delay);
}

function hideToast() {
  clearTimeout(toastTimer);
  els.toast.classList.remove('show');
  // 숨겨진 토스트 안에 포커스가 남지 않도록
  if (els.toast.contains(document.activeElement)) els.input.focus({ preventScroll: true });
}

/** 화면에는 표시하지 않고 스크린 리더에만 읽어 준다 */
function announce(message) {
  els.announcer.textContent = '';
  // 같은 문장을 연달아 알려도 읽히도록 비웠다가 잠시 뒤 채운다
  setTimeout(() => {
    els.announcer.textContent = message;
  }, 50);
}

/**
 * 공용 모달 다이얼로그. 버튼을 누르면 그 value로, Esc/바깥 클릭이면 null로 resolve.
 * 네이티브 <dialog>가 포커스 가두기, Esc 닫기, 배경 비활성화를 처리한다.
 * @param {{ title: string, message?: string, body?: Node, buttons: { label: string, value: string, variant?: string, autofocus?: boolean }[] }} options
 * @returns {Promise<string|null>}
 */
function showDialog({ title, message = '', body = null, buttons }) {
  const { dialog } = els;

  // <dialog> 미지원 브라우저: 기본 confirm으로 대체 (주 버튼 = 확인)
  if (typeof dialog.showModal !== 'function') {
    const primary = buttons.find((b) => b.variant === 'primary' || b.variant === 'danger');
    return Promise.resolve(window.confirm(`${title}\n\n${message}`) ? primary?.value ?? null : null);
  }

  settleDialog?.(null); // 이미 열린 다이얼로그가 있으면 취소로 끝낸다
  if (dialog.open) dialog.close('');
  const returnFocusTo = document.activeElement;

  els.dialogTitle.textContent = title;
  els.dialogMessage.textContent = message;
  els.dialogBody.replaceChildren(...(body ? [body] : []));
  els.dialogActions.replaceChildren(...buttons.map((b) => {
    const btn = document.createElement('button');
    btn.type = 'submit'; // <form method="dialog">: 누르면 value가 returnValue가 됨
    btn.value = b.value;
    btn.textContent = b.label;
    btn.className = `dialog-btn ${b.variant ?? ''}`.trim();
    if (b.autofocus) btn.autofocus = true;
    return btn;
  }));

  dialog.returnValue = '';
  dialog.showModal();
  (dialog.querySelector('[autofocus]') ?? els.dialogActions.lastElementChild)?.focus();

  return new Promise((resolve) => {
    settleDialog = (value) => {
      settleDialog = null;
      if (dialog.open) dialog.close(value ?? '');
      // 닫힌 뒤 원래 위치로 포커스 복귀 (브라우저가 하지 않는 경우 대비)
      if (returnFocusTo?.isConnected && (document.activeElement === document.body || !document.activeElement)) {
        returnFocusTo.focus({ preventScroll: true });
      }
      resolve(value || null);
    };
  });
}

/**
 * 열려 있는 다이얼로그를 끝내는 함수 (showDialog가 설정).
 * 비동기로 오는 close 이벤트를 기다리지 않고, 버튼 클릭(submit)·Esc(cancel)·배경 클릭
 * 시점에 바로 결과를 돌려준다.
 * @type {((value: string|null) => void) | null}
 */
let settleDialog = null;

els.dialog.querySelector('form').addEventListener('submit', (e) => {
  e.preventDefault();
  settleDialog?.(e.submitter?.value ?? null);
});
els.dialog.addEventListener('cancel', (e) => {
  e.preventDefault(); // Esc: 직접 닫아서 결과(null)를 확실히 전달
  settleDialog?.(null);
});
// 다른 경로로 닫혀도(예: 브라우저가 강제로 닫음) 대기 중인 Promise가 남지 않도록.
// close 이벤트는 비동기로 도착하므로, 그사이 새 다이얼로그가 열렸다면(open) 이전 닫힘의 이벤트이므로 무시한다.
els.dialog.addEventListener('close', () => {
  if (!els.dialog.open) settleDialog?.(els.dialog.returnValue || null);
});

/** 예상하지 못한 오류: 콘솔에 남기고 사용자에게 알림 (알림 자체가 실패해도 무시) */
function reportError(err) {
  console.error(err);
  try {
    showToast('예상치 못한 오류가 발생했습니다. 계속되면 내보내기로 백업한 뒤 새로고침해 주세요.', { variant: 'error', duration: 6000 });
  } catch {
    /* 무시 */
  }
}

/* =============================================================================
 * 11. 내보내기 · 가져오기
 * ========================================================================== */

/** 사용자에게 보여 줄 메시지를 담은 가져오기 오류 */
class ImportError extends Error {}

/** 객체를 JSON 파일로 내려받기 */
function downloadJSON(data, filename) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * 현재 할 일을 JSON 파일로 내보낸다.
 * @param {{ backup?: boolean }} [options] backup이면 가져오기 전 자동 백업용 파일 이름 사용
 * @returns {boolean} 성공 여부
 */
function exportTodos({ backup = false } = {}) {
  if (todos.length === 0) {
    if (!backup) showToast('내보낼 할 일이 없습니다');
    return backup; // 백업할 데이터가 없으면 백업은 "성공"으로 간주
  }
  flushSave();
  const payload = {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    count: todos.length,
    todos,
  };
  try {
    downloadJSON(payload, `my-tasks${backup ? '-backup' : ''}-${fileStamp()}.json`);
  } catch (err) {
    console.error('[export] 파일 생성 실패:', err);
    showToast('파일을 만들지 못했습니다. 다른 브라우저에서 다시 시도해 주세요.', { variant: 'error' });
    return false;
  }
  if (!backup) showToast(`할 일 ${todos.length}개를 파일로 내보냈습니다`, { variant: 'success' });
  return true;
}

/**
 * 파일을 읽고 검증한다. 문제가 있으면 ImportError를 던진다.
 * 지원 형식: 내보내기 파일({ todos: [...] }) 또는 할 일 배열([...])
 */
async function readImportFile(file) {
  if (!file) throw new ImportError('파일이 선택되지 않았습니다.');
  if (file.size === 0) throw new ImportError('빈 파일입니다.');
  if (file.size > LIMITS.importBytes) throw new ImportError('파일이 너무 큽니다 (최대 5MB).');
  const looksJson = /\.json$/i.test(file.name) || /json/i.test(file.type);
  if (!looksJson) throw new ImportError('JSON(.json) 파일만 가져올 수 있습니다.');

  let text;
  try {
    text = await file.text();
  } catch {
    throw new ImportError('파일을 읽지 못했습니다.');
  }

  let data;
  try {
    data = JSON.parse(text.replace(/^﻿/, '')); // 메모장 등이 붙이는 BOM 제거
  } catch {
    throw new ImportError('JSON 형식이 올바르지 않습니다.');
  }

  if (data && !Array.isArray(data) && data.format && data.format !== EXPORT_FORMAT) {
    throw new ImportError('My Tasks에서 내보낸 파일이 아닙니다.');
  }
  const rawList = Array.isArray(data) ? data : Array.isArray(data?.todos) ? data.todos : null;
  if (!rawList) throw new ImportError('파일에서 할 일 목록을 찾지 못했습니다.');
  if (rawList.length === 0) throw new ImportError('파일에 할 일이 없습니다.');

  // 카테고리가 없는 파일(다른 앱에서 만든 목록 등)은 키워드로 자동 분류
  const { valid, skipped, autoClassified } = sanitizeTodos(rawList, new Set(), { classifyMissing: true });
  if (valid.length === 0) throw new ImportError(`가져올 수 있는 할 일이 없습니다 (형식 오류 ${skipped}개).`);

  const truncated = Math.max(0, valid.length - LIMITS.todos);
  return { valid: valid.slice(0, LIMITS.todos), skipped, truncated, autoClassified };
}

/** 가져오기 방법(바꾸기/합치기)과 백업 여부를 고르는 다이얼로그 본문 */
function buildImportOptions() {
  const wrap = document.createElement('div');
  wrap.className = 'import-options';

  const fieldset = document.createElement('fieldset');
  const legend = document.createElement('legend');
  legend.textContent = `현재 할 일 ${todos.length}개는`;
  fieldset.append(legend);

  const radio = (value, label, checked) => {
    const lbl = document.createElement('label');
    lbl.className = 'choice';
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = 'import-mode';
    input.value = value;
    input.checked = checked;
    lbl.append(input, label);
    return lbl;
  };
  fieldset.append(
    radio('replace', '모두 지우고 가져온 항목으로 바꾸기', true),
    radio('merge', '현재 목록에 합치기 (같은 항목은 건너뜀)', false),
  );

  const backupLabel = document.createElement('label');
  backupLabel.className = 'choice';
  const backup = document.createElement('input');
  backup.type = 'checkbox';
  backup.name = 'import-backup';
  backup.checked = true;
  backupLabel.append(backup, '가져오기 전에 현재 데이터를 백업 파일로 내려받기 (권장)');

  wrap.append(fieldset, backupLabel);
  return wrap;
}

/** 파일 선택 → 검증 → 확인(백업) → 적용 */
async function importFromFile(file) {
  try {
    const { valid, skipped, truncated, autoClassified } = await readImportFile(file);

    const notes = [];
    if (autoClassified) notes.push(`카테고리가 없는 ${autoClassified}개는 키워드로 자동 분류했습니다.`);
    if (skipped) notes.push(`형식이 잘못된 ${skipped}개는 건너뜁니다.`);
    if (truncated) notes.push(`최대 ${LIMITS.todos}개까지만 가져옵니다 (${truncated}개 제외).`);
    const message = [`파일에서 할 일 ${valid.length}개를 찾았습니다.`, ...notes].join('\n');

    const hasCurrent = todos.length > 0;
    const options = hasCurrent ? buildImportOptions() : null;
    const choice = await showDialog({
      title: '데이터 가져오기',
      message,
      body: options,
      buttons: [
        { label: '취소', value: 'cancel' },
        { label: '가져오기', value: 'import', variant: 'primary', autofocus: true },
      ],
    });
    if (choice !== 'import') {
      showToast('가져오기를 취소했습니다');
      return;
    }

    const mode = options?.querySelector('input[name="import-mode"]:checked')?.value ?? 'replace';
    const wantsBackup = options?.querySelector('input[name="import-backup"]')?.checked ?? false;
    if (hasCurrent && wantsBackup && !exportTodos({ backup: true })) {
      showToast('백업 파일을 만들지 못해 가져오기를 중단했습니다.', { variant: 'error' });
      return;
    }

    applyImport(valid, mode);
  } catch (err) {
    if (err instanceof ImportError) {
      showToast(`가져오기 실패: ${err.message}`, { variant: 'error', duration: 5000 });
    } else {
      reportError(err);
    }
  } finally {
    els.importFile.value = ''; // 같은 파일을 다시 선택해도 change 이벤트가 나도록
  }
}

/** 가져온 할 일을 적용하고, 실행 취소할 수 있게 이전 상태를 보관한다 */
function applyImport(imported, mode) {
  const snapshot = todos.map((t) => ({ ...t }));
  let added = 0;
  let duplicates = 0;

  if (mode === 'merge') {
    const byId = new Map(todos.map((t) => [t.id, t]));
    const contentKeys = new Set(todos.map((t) => `${compareKey(t.text)}\u0000${t.category}`));
    for (const item of imported) {
      if (todos.length >= LIMITS.todos) break;
      const key = `${compareKey(item.text)}\u0000${item.category}`;
      const sameId = byId.get(item.id);
      if (contentKeys.has(key) || (sameId && compareKey(sameId.text) === compareKey(item.text))) {
        duplicates += 1; // 같은 할 일이 이미 있음
        continue;
      }
      const todo = sameId ? { ...item, id: generateId() } : item; // id만 겹치고 내용이 다르면 새 id
      todos.push(todo);
      byId.set(todo.id, todo);
      contentKeys.add(key);
      added += 1;
    }
  } else {
    todos = imported;
    added = imported.length;
  }

  elementCache.clear();
  saveTodos();
  flushSave();
  render();

  const summary = mode === 'merge'
    ? `${added}개를 합쳤습니다${duplicates ? ` (중복 ${duplicates}개 건너뜀)` : ''}`
    : `할 일 ${added}개를 가져왔습니다`;
  showToast(summary, {
    variant: 'success',
    action: {
      label: '실행 취소',
      onClick: () => {
        todos = snapshot;
        elementCache.clear();
        saveTodos();
        render();
        showToast('가져오기 전 상태로 되돌렸습니다');
      },
    },
  });
}

/* =============================================================================
 * 12. 최근 삭제 (휴지통)
 * ========================================================================== */

/** 페이드아웃 후 삭제하고, "실행 취소" 토스트를 띄운다 */
function removeWithAnimation(ids, describe) {
  const leaving = [...els.list.children].filter((el) => ids.has(el.dataset.id));
  if (leaving.some((el) => el.classList.contains('leaving'))) return; // 연타 방지
  leaving.forEach((el) => el.classList.add('leaving'));

  const run = () => {
    const result = removeTodos(ids);
    if (!result) return;
    showToast(describe(result.removed), {
      action: {
        label: '실행 취소',
        onClick: () => {
          const n = restoreEntries(result.removed);
          announce(`${n}개를 복구했습니다.`);
        },
      },
    });
  };

  if (leaving.length > 0 && !prefersReducedMotion()) setTimeout(run, TIMING.leaveAnimation);
  else run();
}

function deleteTodo(id) {
  removeWithAnimation(new Set([id]), (removed) => `"${preview(removed[0].todo.text)}" 삭제했습니다`);
}

async function clearCompleted() {
  const completed = todos.filter((t) => t.completed);
  if (completed.length === 0) return;
  const choice = await showDialog({
    title: '완료된 항목 삭제',
    message: `완료된 항목 ${completed.length}개를 모두 삭제할까요?\n현재 필터와 관계없이 모든 카테고리에서 삭제됩니다. 삭제한 항목은 "최근 삭제"에서 복구할 수 있습니다.`,
    buttons: [
      { label: '취소', value: 'cancel', autofocus: true },
      { label: `${completed.length}개 삭제`, value: 'confirm', variant: 'danger' },
    ],
  });
  if (choice !== 'confirm') return;
  // 다이얼로그가 떠 있는 동안 다른 탭에서 바뀌었을 수 있으므로 다시 계산
  const ids = new Set(todos.filter((t) => t.completed).map((t) => t.id));
  if (ids.size === 0) return;
  removeWithAnimation(ids, (removed) => `완료된 항목 ${removed.length}개를 삭제했습니다`);
}

/** Ctrl+Z: 가장 최근에 삭제한 묶음을 복구 */
function undoLastDelete() {
  const latest = trash[0];
  if (!latest) {
    showToast('복구할 삭제 항목이 없습니다');
    return;
  }
  const batch = trash.filter((e) => e.batchId === latest.batchId);
  const n = restoreEntries(batch);
  showToast(n > 0 ? `${n}개를 복구했습니다` : '이미 목록에 있는 항목입니다', { variant: n > 0 ? 'success' : '' });
}

function updateTrashButton() {
  els.trashCount.textContent = trash.length > 0 ? String(trash.length) : '';
  els.trashBtn.setAttribute('aria-label', `최근 삭제 ${trash.length}개`);
}

/** 최근 삭제 목록 다이얼로그 */
async function openTrashDialog() {
  const body = document.createElement('div');

  const renderTrashList = () => {
    if (trash.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'trash-empty';
      empty.textContent = '최근 삭제한 항목이 없습니다.';
      body.replaceChildren(empty);
      return;
    }
    const ul = document.createElement('ul');
    ul.className = 'trash-list';
    ul.setAttribute('aria-label', '최근 삭제한 항목');
    trash.forEach((entry, i) => {
      const li = document.createElement('li');
      li.className = 'trash-item';
      const info = document.createElement('div');
      info.className = 'trash-info';
      const text = document.createElement('div');
      text.className = 'trash-text';
      text.textContent = entry.todo.text;
      const meta = document.createElement('div');
      meta.className = 'trash-meta';
      meta.textContent = `${CATEGORIES[entry.todo.category]} · ${entry.todo.completed ? '완료' : '미완료'} · ${formatRelativeTime(entry.deletedAt)} 삭제`;
      info.append(text, meta);
      const btn = document.createElement('button');
      btn.type = 'button'; // 다이얼로그를 닫지 않음
      btn.className = 'restore-btn';
      btn.dataset.index = String(i);
      btn.textContent = '복구';
      btn.setAttribute('aria-label', `"${entry.todo.text}" 복구`);
      li.append(info, btn);
      ul.append(li);
    });
    body.replaceChildren(ul);
  };

  body.addEventListener('click', (e) => {
    const btn = e.target.closest('.restore-btn');
    if (!btn) return;
    const index = Number(btn.dataset.index);
    const entry = trash[index];
    if (!entry) return;
    const n = restoreEntries([entry]);
    announce(n > 0 ? `"${preview(entry.todo.text)}" 복구했습니다.` : '이미 목록에 있는 항목입니다.');
    renderTrashList();
    // 포커스를 같은 위치의 다음 복구 버튼(없으면 닫기 버튼)으로
    const buttons = body.querySelectorAll('.restore-btn');
    (buttons[Math.min(index, buttons.length - 1)] ?? els.dialogActions.lastElementChild)?.focus();
  });

  renderTrashList();
  const choice = await showDialog({
    title: '최근 삭제한 항목',
    message: `최근 ${LIMITS.trashDays}일 동안 삭제한 항목을 최대 ${LIMITS.trashItems}개까지 보관합니다.`,
    body,
    buttons: [
      { label: '모두 영구 삭제', value: 'empty', variant: 'danger-outline start' },
      { label: '닫기', value: 'close', variant: 'primary', autofocus: true },
    ],
  });

  if (choice === 'empty' && trash.length > 0) {
    const confirm = await showDialog({
      title: '영구 삭제',
      message: `최근 삭제한 항목 ${trash.length}개를 영구 삭제할까요? 되돌릴 수 없습니다.`,
      buttons: [
        { label: '취소', value: 'cancel', autofocus: true },
        { label: '영구 삭제', value: 'confirm', variant: 'danger' },
      ],
    });
    if (confirm === 'confirm') {
      trash = [];
      saveTrash();
      showToast('최근 삭제 목록을 비웠습니다');
    }
  }
}

/* =============================================================================
 * 13. 격언 · 응원 메시지 · 테마
 * ========================================================================== */

let quoteIndex = -1;
let quoteDay = '';

function showQuote(index) {
  const quote = QUOTES[index];
  if (!quote) return;
  quoteIndex = index;
  els.quoteText.textContent = quote.text;
  els.quoteAuthor.textContent = `— ${quote.author}`;
}

/** 날짜 문자열을 해시해서 하루 동안은 같은 격언이 나오게 한다 */
function quoteOfTheDay() {
  let hash = 0;
  for (const ch of todayKey()) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return hash % QUOTES.length;
}

function showRandomQuote() {
  if (QUOTES.length < 2) return;
  let next;
  do {
    next = Math.floor(Math.random() * QUOTES.length);
  } while (next === quoteIndex);
  showQuote(next);
  restartAnimationClass(els.quoteRefresh, 'spin');
}

/** 자정이 지나면 그날의 격언으로 바꾼다 */
function refreshQuoteForNewDay() {
  const key = todayKey();
  if (key === quoteDay) return;
  quoteDay = key;
  showQuote(quoteOfTheDay());
}

/** 완료율 구간별 응원 메시지 */
function getCheer(total, done) {
  if (total === 0) return { level: 'empty', text: '첫 할 일을 추가하고 시작해 볼까요? ✨' };
  if (done === total) return { level: 'done', text: '모든 할 일을 끝냈어요! 오늘 정말 수고했어요 🎉' };
  if (done === 0) return { level: 'start', text: '시작이 반이에요. 가장 쉬운 것부터 하나 끝내 볼까요?' };
  const pct = (done / total) * 100;
  if (pct < 25) return { level: 'low', text: '좋은 출발이에요! 이 흐름을 이어가요 🌱' };
  if (pct < 50) return { level: 'mid', text: '차근차근 잘하고 있어요 👍' };
  if (pct < 75) return { level: 'high', text: '절반을 넘었어요! 조금만 더 힘내요 💪' };
  return { level: 'almost', text: `거의 다 왔어요! ${total - done}개만 남았어요 🔥` };
}

function renderCheer(total, done) {
  const { level, text } = getCheer(total, done);
  if (els.cheerMessage.dataset.level === level && els.cheerMessage.textContent === text) return;
  const changedLevel = els.cheerMessage.dataset.level !== level;
  els.cheerMessage.dataset.level = level;
  els.cheerMessage.textContent = text;
  if (changedLevel && statsRendered) restartAnimationClass(els.cheerMessage, 'pop');
}

function getTheme() {
  return els.root.dataset.theme === 'dark' ? 'dark' : 'light';
}

let themeTransitionTimer = null;

function applyTheme(theme, { animate = false } = {}) {
  if (animate) {
    // 전환 동안에만 모든 요소에 색상 트랜지션을 건다
    els.root.classList.add('theme-transition');
    clearTimeout(themeTransitionTimer);
    themeTransitionTimer = setTimeout(() => els.root.classList.remove('theme-transition'), 400);
  }
  els.root.dataset.theme = theme;
  els.themeToggle.setAttribute('aria-checked', String(theme === 'dark'));
}

function toggleTheme() {
  const next = getTheme() === 'dark' ? 'light' : 'dark';
  applyTheme(next, { animate: true });
  storage.set(STORAGE_KEYS.theme, next);
  showToast(next === 'dark' ? '다크 모드로 전환했습니다' : '라이트 모드로 전환했습니다');
}

/* =============================================================================
 * 14. 이벤트 연결
 * ========================================================================== */

/* 추가 폼 ------------------------------------------------------------------ */

let awaitingDuplicateChoice = false; // 중복 확인 다이얼로그가 떠 있는 동안 추가 제출 무시

els.form.addEventListener('submit', (e) => {
  e.preventDefault();
  if (awaitingDuplicateChoice) return;
  handleAddSubmit().catch(reportError);
});

async function handleAddSubmit() {
  // 디바운스를 기다리지 않고 바로 분류해서, 빠르게 입력하고 Enter를 눌러도 분류가 반영되게 한다
  updateFormHints.cancel();
  refreshFormHints();

  const text = cleanText(els.input.value);
  if (!text) {
    restartAnimationClass(els.input, 'shake');
    showToast('할 일 내용을 입력해주세요', { variant: 'error' });
    els.input.focus();
    return;
  }

  const dup = findDuplicate(text);
  if (dup) {
    let choice;
    awaitingDuplicateChoice = true;
    try {
      choice = await showDialog({
        title: '이미 있는 할 일이에요',
        message: `"${dup.text}"\n(${CATEGORIES[dup.category]} · ${dup.completed ? '완료' : '미완료'})\n\n그래도 추가할까요?`,
        buttons: [
          { label: '취소', value: 'cancel', autofocus: true },
          { label: '그래도 추가', value: 'add', variant: 'primary' },
        ],
      });
    } finally {
      awaitingDuplicateChoice = false;
    }
    if (choice !== 'add') {
      els.input.focus();
      els.input.select();
      return;
    }
  }

  if (addTodo(text, els.categorySelect.value)) {
    els.input.value = '';
    updateFormHints.cancel();
    els.duplicateHint.textContent = '';
    resetAutoCategory();
  }
  els.input.focus();
}

els.input.addEventListener('animationend', () => els.input.classList.remove('shake'));

/** 입력하는 동안 중복 여부를 미리 알려 준다 */
function refreshDuplicateHint() {
  const text = cleanText(els.input.value);
  const dup = text ? findDuplicate(text) : null;
  els.duplicateHint.textContent = dup
    ? `⚠ 같은 할 일이 이미 있습니다 (${CATEGORIES[dup.category]} · ${dup.completed ? '완료' : '미완료'})`
    : '';
}

function refreshFormHints() {
  refreshDuplicateHint();
  applyAutoCategory();
}

/** 입력이 잠깐 멈추면 중복 경고와 자동 분류를 갱신 */
const updateFormHints = debounce(refreshFormHints, TIMING.hintDebounce);

els.input.addEventListener('input', updateFormHints);

// 사용자가 카테고리를 직접 고르면 이번 할 일에서는 자동 분류가 덮어쓰지 않는다
els.categorySelect.addEventListener('change', () => {
  autoCategory.touched = true;
  autoCategory.applied = null;
  autoCategory.baseline = null;
  applyAutoCategory(); // 고른 값과 키워드가 가리키는 카테고리가 다르면 제안만 표시
});
els.categorySelect.addEventListener('animationend', () => els.categorySelect.classList.remove('auto-applied'));

/* 목록: 이벤트 위임 ------------------------------------------------------- */

els.list.addEventListener('click', (e) => {
  const item = e.target.closest('.todo-item');
  if (!item || item.classList.contains('leaving')) return;
  const { id } = item.dataset;

  if (e.target.classList.contains('todo-checkbox')) {
    toggleTodo(id);
  } else if (e.target.closest('.edit-btn')) {
    startEdit(item);
  } else if (e.target.closest('.delete-btn')) {
    deleteTodo(id);
  }
});

/* 목록 키보드 조작 ----------------------------------------------------------
 * 항목 안의 컨트롤(체크박스·수정·삭제 버튼)에 포커스가 있을 때:
 *   ↑/↓        이전/다음 항목의 같은 컨트롤로 이동
 *   Home/End   첫/마지막 항목으로 이동
 *   Enter      (체크박스에서) 수정 시작 — 버튼에서는 버튼 기본 동작
 *   Delete     항목 삭제 (Mac의 Backspace 포함)
 *   Space      (체크박스에서) 완료 토글 — 브라우저 기본 동작
 * 드래그 손잡이에서는 ↑/↓가 순서 변경이다. 편집기 안에서는 아무것도 가로채지 않는다. */

const ITEM_CONTROLS = ['.todo-checkbox', '.edit-btn', '.delete-btn', '.drag-handle'];

/** 항목 안에서 같은 종류의 컨트롤에 포커스 (없으면 체크박스) */
function focusItemControl(item, preferredSelector) {
  const target = item.querySelector(preferredSelector) ?? item.querySelector('.todo-checkbox');
  target?.focus();
  target?.closest('.todo-item')?.scrollIntoView({ block: 'nearest' });
}

els.list.addEventListener('keydown', (e) => {
  const item = e.target.closest('.todo-item');
  if (!item || e.target.closest('.todo-editor')) return;
  if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;

  const isArrow = e.key === 'ArrowUp' || e.key === 'ArrowDown';
  if (e.target.classList.contains('drag-handle') && isArrow) {
    e.preventDefault();
    moveByKeyboard(item, e.key === 'ArrowUp' ? -1 : 1);
    return;
  }

  const selector = ITEM_CONTROLS.find((sel) => e.target.matches(sel)) ?? '.todo-checkbox';

  if (isArrow) {
    e.preventDefault();
    const sibling = e.key === 'ArrowUp' ? item.previousElementSibling : item.nextElementSibling;
    if (sibling) focusItemControl(sibling, selector);
    else announce(e.key === 'ArrowUp' ? '목록의 처음입니다.' : '목록의 끝입니다.');
  } else if (e.key === 'Home' || e.key === 'End') {
    e.preventDefault();
    const edge = e.key === 'Home' ? els.list.firstElementChild : els.list.lastElementChild;
    if (edge) focusItemControl(edge, selector);
  } else if (e.key === 'Enter' && e.target.classList.contains('todo-checkbox')) {
    e.preventDefault();
    startEdit(item);
  } else if ((e.key === 'Delete' || e.key === 'Backspace') && !item.classList.contains('leaving')) {
    e.preventDefault();
    deleteTodo(item.dataset.id); // 삭제 후 포커스는 restoreFocus가 이웃 항목으로 옮긴다
  }
});

els.list.addEventListener('pointerdown', onDragPointerDown);

// 한 번만 재생하는 애니메이션 클래스는 끝나면 떼어 둔다 (재사용되는 <li>에서 다시 재생할 수 있도록)
const ONE_SHOT_ANIMATIONS = { 'todo-fade-in': 'todo-enter', 'todo-slide': 'todo-toggled', 'todo-saved': 'todo-saved' };
els.list.addEventListener('animationend', (e) => {
  const className = ONE_SHOT_ANIMATIONS[e.animationName];
  if (className) e.target.closest('.todo-item')?.classList.remove(className);
});

// FLIP이 끝나면 인라인 transition을 지워 CSS 호버 트랜지션이 다시 적용되게 한다
els.list.addEventListener('transitionend', (e) => {
  if (e.propertyName === 'transform' && e.target.classList.contains('todo-item') && !e.target.classList.contains('dragging')) {
    e.target.style.transition = '';
  }
});

/* 필터 · 검색 · 정렬 ------------------------------------------------------ */

els.filterBar.addEventListener('click', (e) => {
  const btn = e.target.closest('.filter-btn');
  if (!btn) return;
  setFilter(btn.dataset.filter);
  announce(`${FILTER_LABELS[currentFilter]} 필터: 할 일 ${els.list.children.length}개`);
});

/** 검색은 입력이 멈춘 뒤 한 번만 렌더 (긴 목록에서 타이핑 지연 방지) */
const applySearch = debounce(() => {
  const next = els.searchInput.value.trim();
  if (next === searchQuery) return;
  searchQuery = next;
  els.searchBox.classList.toggle('active', searchQuery !== '');
  render();
  if (searchQuery) announce(`검색 결과 ${els.list.children.length}개`);
}, TIMING.searchDebounce);

els.searchInput.addEventListener('input', applySearch);

els.searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && els.searchInput.value) {
    e.preventDefault();
    els.searchInput.value = '';
    applySearch();
    applySearch.flush(); // 지울 때는 기다리지 않고 바로 반영
  } else if (e.key === 'Enter') {
    applySearch.flush();
  } else if (e.key === 'ArrowDown' && els.list.firstElementChild) {
    // 검색창에서 ↓: 결과 목록의 첫 항목으로
    e.preventDefault();
    applySearch.flush();
    focusItemControl(els.list.firstElementChild, '.todo-checkbox');
  }
});

els.sortSelect.addEventListener('change', () => setSort(els.sortSelect.value));

/* 하단 버튼 · 기타 -------------------------------------------------------- */

els.clearCompletedBtn.addEventListener('click', () => clearCompleted().catch(reportError));
els.trashBtn.addEventListener('click', () => openTrashDialog().catch(reportError));
els.exportBtn.addEventListener('click', () => exportTodos());
els.importBtn.addEventListener('click', () => els.importFile.click());
els.importFile.addEventListener('change', () => {
  const file = els.importFile.files?.[0];
  if (file) importFromFile(file);
});
els.themeToggle.addEventListener('click', toggleTheme);
els.quoteRefresh.addEventListener('click', showRandomQuote);

// 다이얼로그 바깥(배경)을 누르면 취소로 닫기
els.dialog.addEventListener('click', (e) => {
  if (e.target === els.dialog) settleDialog?.(null);
});

// 토스트: 마우스를 올리거나 포커스가 있으면 사라지지 않음
els.toast.addEventListener('mouseenter', () => clearTimeout(toastTimer));
els.toast.addEventListener('mouseleave', () => scheduleToastHide(2000));
els.toast.addEventListener('focusin', () => clearTimeout(toastTimer));
els.toast.addEventListener('focusout', () => scheduleToastHide(2000));

/* 키보드 단축키 ------------------------------------------------------------
 * e.code를 써서 한글 입력 상태에서도 동작한다 (e.key는 'ㅜ' 등이 됨). */

document.addEventListener('keydown', (e) => {
  if (drag && e.key === 'Escape') {
    e.preventDefault();
    endDrag(false);
    return;
  }
  if (els.dialog.open) return; // 다이얼로그가 열려 있으면 앱 단축키를 막는다

  const typing = isTextField(e.target);

  if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
    if (e.code === 'KeyN') {
      e.preventDefault();
      els.input.focus();
      els.input.select();
    } else if (e.code === 'KeyD') {
      e.preventDefault();
      toggleTheme();
    } else if (/^Digit[1-4]$/.test(e.code)) {
      e.preventDefault();
      const filter = FILTERS[Number(e.code.slice(-1)) - 1];
      commitOpenEditor();
      setFilter(filter);
      showToast(`필터: ${FILTER_LABELS[filter]}`);
    }
    return;
  }

  // Ctrl+Z / Cmd+Z: 입력창 밖에서만 (입력창에서는 브라우저의 글자 실행 취소를 유지)
  if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.code === 'KeyZ' && !typing) {
    e.preventDefault();
    undoLastDelete();
    return;
  }

  // "/" : 검색창으로
  if (e.key === '/' && !typing && !e.ctrlKey && !e.metaKey && !e.altKey) {
    e.preventDefault();
    els.searchInput.focus();
    els.searchInput.select();
  }
});

/* 저장 · 동기화 ------------------------------------------------------------ */

// 디바운스 대기 중인 저장을 페이지를 떠나거나 숨길 때 즉시 기록 (데이터 유실 방지)
window.addEventListener('pagehide', flushSave);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') flushSave();
});

// 다른 탭에서 바뀐 내용 반영
window.addEventListener('storage', (e) => {
  if (e.storageArea !== localStorage) return;
  switch (e.key) {
    case STORAGE_KEYS.todos:
      // 이 탭에 아직 저장 안 된 변경이 있으면 곧 덮어쓰므로 이 탭의 내용을 우선한다
      if (persistTodos.pending()) return;
      todos = loadTodos();
      render();
      break;
    case STORAGE_KEYS.trash:
      trash = loadTrash();
      updateTrashButton();
      break;
    case STORAGE_KEYS.theme:
      if (e.newValue === 'dark' || e.newValue === 'light') applyTheme(e.newValue, { animate: true });
      break;
    case null: // 다른 탭에서 localStorage.clear()
      todos = [];
      trash = [];
      updateTrashButton();
      render();
      break;
    default:
      break;
  }
});

// 테마를 직접 고른 적이 없으면 운영체제 설정 변경을 따라간다
window.matchMedia?.('(prefers-color-scheme: dark)')?.addEventListener?.('change', (e) => {
  if (!storage.get(STORAGE_KEYS.theme)) applyTheme(e.matches ? 'dark' : 'light', { animate: true });
});

// 처리되지 않은 오류도 사용자에게 알린다
window.addEventListener('error', (e) => reportError(e.error ?? e.message));
window.addEventListener('unhandledrejection', (e) => reportError(e.reason));

/* =============================================================================
 * 15. 초기화
 * ========================================================================== */

function init() {
  applyTheme(getTheme()); // <head> 스크립트가 정한 테마에 맞춰 스위치 상태 동기화
  els.sortSelect.value = currentSort;
  syncCategorySelect();
  refreshQuoteForNewDay();
  els.quote.setAttribute('aria-live', 'polite'); // 첫 표시 이후의 변경만 읽히도록 나중에 설정
  updateTrashButton();
  render();

  // 1분마다: 상대 시간, "오늘 추가" 개수(자정 경과), 오늘의 격언 갱신
  setInterval(() => {
    refreshTimes();
    renderStats();
    refreshQuoteForNewDay();
  }, 60 * 1000);

  if (!storage.available) {
    showToast('브라우저 저장소를 사용할 수 없어 새로고침하면 데이터가 사라집니다. 내보내기로 백업하세요.', { variant: 'error', duration: 10000 });
  } else if (startupNotices.length > 0) {
    showToast(startupNotices.join(' '), { variant: 'error', duration: 8000 });
  }
}

init();
