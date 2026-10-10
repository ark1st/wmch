export const MODES = ['ticket', 'number', 'ball', 'grid', 'drum'];
export const DURATION = 3000;
export const MAX_TICKET = 9999;
// Shared by the stage and audio. Old saved rounds keep their original timing.
export function drawTiming(duration, reduceMotion = false) {
  if (duration === 1400 || reduceMotion) return { revealStart:200, stagger:160, artExit:0, cardsEnter:0, cardStagger:0, gridExit:0, mixUntil:0 };
  if (duration === 6800) return { revealStart:4200, stagger:350, artExit:2900, cardsEnter:3100, cardStagger:90, gridExit:5800, mixUntil:2700 };
  return { revealStart:1500, stagger:180, artExit:950, cardsEnter:1100, cardStagger:45, gridExit:2250, mixUntil:900 };
}
export const pad = (n) => String(n).padStart(3, '0');
export const defaultPrograms = () => [
  {id:'page-1',title:'목사님, 사모님, 선교사님',batch:5,hosts:3,planned:15},
  {id:'page-2',title:'장로회장, 총회장, 총무국',batch:5,hosts:4,planned:20},
  {id:'page-3',title:'뚜뚜빠빠',batch:3,hosts:3,planned:9},
  {id:'page-4',title:'부교역자',batch:3,hosts:5,planned:15},
  {id:'page-5',title:'귀빈, 대청부회장',batch:3,hosts:2,planned:6},
  {id:'other',title:'기타 사회자',batch:5,hosts:0,planned:10},
];
export const initialState = () => ({ version: 2, revision: 0, mode: 'ticket', batch: 5, rangeStart:1, rangeEnd:200, prizeTotal:75, programs:defaultPrograms(), programId:'page-1', excluded: [], sound: false, pending: null, history: [], view: 'idle', shownId: null });
export const validWinners = round => round.status === 'confirmed' ? round.numbers.filter(n => !(round.invalid ?? []).includes(n)) : [];
export const winnerNumbers = (state, programId) => state.history.filter(r => programId === undefined || r.programId === programId).flatMap(validWinners);
export const invalidNumbers = state => state.history.flatMap(r => r.invalid ?? []);
export const prizesRemaining = state => Math.max(0, state.prizeTotal - winnerNumbers(state).length);
export const nextCount = state => Math.min(state.batch, candidates(state).length, prizesRemaining(state));
export const currentProgram = state => state.programs.find(p => p.id === state.programId);
const validRange = (start, end) => Number.isInteger(start) && Number.isInteger(end) && start >= 1 && end <= MAX_TICKET && start <= end;

// Rejection sampling avoids the bias introduced by a simple uint32 % bound.
export function randomBelow(bound, cryptoSource = globalThis.crypto) {
  if (!Number.isInteger(bound) || bound < 1 || bound > 0x100000000) throw new Error('잘못된 추첨 범위입니다.');
  const limit = Math.floor(0x100000000 / bound) * bound;
  const buffer = new Uint32Array(1);
  do { cryptoSource.getRandomValues(buffer); } while (buffer[0] >= limit);
  return buffer[0] % bound;
}

export function sample(pool, count, cryptoSource = globalThis.crypto) {
  if (!Number.isInteger(count) || count < 1 || count > pool.length || new Set(pool).size !== pool.length) throw new Error('추첨할 후보가 부족합니다.');
  const shuffled = [...pool];
  for (let i = 0; i < count; i++) {
    const j = i + randomBelow(shuffled.length - i, cryptoSource);
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled.slice(0, count);
}

export function candidates(state) {
  // Every revealed number stays out of the pool, including invalid and legacy discarded draws.
  const removed = new Set([...state.excluded, ...state.history.flatMap(r => r.numbers)]);
  const start = state.rangeStart ?? 1, end = state.rangeEnd ?? 200;
  return Array.from({ length:end - start + 1 }, (_, i) => i + start).filter(n => !removed.has(n));
}

export function parseExcluded(text, rangeStart = 1, rangeEnd = 200) {
  if (!validRange(rangeStart,rangeEnd)) throw new Error('행운권 구간은 1부터 9999 사이의 시작 번호와 끝 번호를 오름차순으로 입력해 주세요.');
  if (!text.trim()) return [];
  const numbers = new Set();
  for (const part of text.trim().split(/[,\s]+/)) {
    const match = /^(\d{1,4})(?:-(\d{1,4}))?$/.exec(part);
    if (!match) throw new Error(`제외 번호를 확인해 주세요: ${part}`);
    const from = Number(match[1]), to = Number(match[2] ?? match[1]);
    if (from < rangeStart || to > rangeEnd || to < from) throw new Error(`제외 번호는 ${rangeStart}–${rangeEnd} 사이의 번호 또는 오름차순 범위여야 합니다.`);
    for (let n = from; n <= to; n++) numbers.add(n);
  }
  return [...numbers].sort((a, b) => a - b);
}

const validNumbers = ns => Array.isArray(ns) && ns.every(n => Number.isInteger(n) && n >= 1 && n <= MAX_TICKET) && new Set(ns).size === ns.length;
export function validateState(s) {
  const fail = () => { throw new Error('저장된 추첨 기록을 읽을 수 없습니다. 기록을 백업한 뒤 초기화해 주세요.'); };
  // Default only records from before configurable ranges; partial/corrupt ranges still fail.
  if (s?.version === 1) {
    if (!('rangeStart' in s) && !('rangeEnd' in s)) s = {...s,rangeStart:1,rangeEnd:200};
    const migrateRound = r => r && ({...r,invalid:[],programId:null,programTitle:'기존 추첨'});
    s = {...s,version:2,programs:defaultPrograms(),programId:'page-1',prizeTotal:Math.max(75,(s.history ?? []).filter(r => r.status === 'confirmed').reduce((sum,r)=>sum+(r.numbers?.length ?? 0),0)+(s.pending?.numbers?.length ?? 0)),history:Array.isArray(s.history)?s.history.map(migrateRound):s.history,pending:migrateRound(s.pending)};
    s.programs[0].batch = s.batch;
  }
  if (!s || s.version !== 2 || !Number.isSafeInteger(s.revision) || s.revision < 0 || !MODES.includes(s.mode) || !Number.isInteger(s.batch) || s.batch < 1 || s.batch > 5 || !validNumbers(s.excluded) || typeof s.sound !== 'boolean' || !Array.isArray(s.history) || !['idle','result','all','page','end'].includes(s.view)) fail();
  if (!validRange(s.rangeStart,s.rangeEnd) || s.excluded.some(n => n < s.rangeStart || n > s.rangeEnd)) fail();
  if (!Array.isArray(s.programs) || s.programs.length !== 6 || s.programs.some((p,i) => !p || p.id !== defaultPrograms()[i].id || typeof p.title !== 'string' || !p.title.trim() || p.title.length > 80 || !Number.isInteger(p.batch) || p.batch < 1 || p.batch > 5 || !Number.isInteger(p.hosts) || p.hosts < 0 || p.hosts > 99 || !Number.isInteger(p.planned) || p.planned < 0 || p.planned > MAX_TICKET)) fail();
  if (!currentProgram(s) || currentProgram(s).batch !== s.batch || !Number.isInteger(s.prizeTotal) || s.prizeTotal < 1 || s.prizeTotal > MAX_TICKET) fail();
  const ids = new Set(), winners = new Set(), revealed = new Set();
  const checkRound = r => {
    if (!r || typeof r.id !== 'string' || ids.has(r.id) || !validNumbers(r.numbers) || r.numbers.length < 1 || r.numbers.length > 5 || !MODES.includes(r.mode) || !Number.isFinite(r.startedAt) || r.startedAt < 0 || ![1400, 6800, DURATION].includes(r.duration)) fail();
    const start = r.rangeStart ?? 1, end = r.rangeEnd ?? 200;
    if (('rangeStart' in r) !== ('rangeEnd' in r) || !validRange(start,end) || r.numbers.some(n => n < start || n > end)) fail();
    if (!validNumbers(r.invalid) || r.invalid.some(n => !r.numbers.includes(n)) || (r.programId !== null && !s.programs.some(p => p.id === r.programId)) || typeof r.programTitle !== 'string' || r.programTitle.length > 80) fail();
    if (r.noRepeat !== undefined && r.noRepeat !== true) fail();
    ids.add(r.id);
  };
  for (const r of s.history) {
    checkRound(r);
    if (!['confirmed', 'discarded'].includes(r.status) || !Number.isFinite(r.resolvedAt)) fail();
    if (r.noRepeat && r.numbers.some(n => revealed.has(n))) fail();
    r.numbers.forEach(n => revealed.add(n));
    if (r.status === 'confirmed') for (const n of r.numbers) { if (winners.has(n)) fail(); winners.add(n); }
  }
  if (s.pending) {
    checkRound(s.pending);
    // Preserve an old, already revealed pending result even if the old app rerolled it before.
    const blocked = new Set([...s.excluded,...s.history.filter(r => s.pending.noRepeat || r.status === 'confirmed').flatMap(r => r.numbers)]);
    if (s.pending.numbers.some(n => n < s.rangeStart || n > s.rangeEnd || blocked.has(n))) fail();
  }
  if (winnerNumbers(s).length > s.prizeTotal || (s.pending && s.pending.numbers.length > prizesRemaining(s))) fail();
  if (s.shownId !== null && !s.history.some(r => r.id === s.shownId && r.status === 'confirmed')) fail();
  if (s.view === 'result' && !s.pending && !s.shownId) fail();
  return s;
}

export function transition(state, action, now = Date.now(), cryptoSource = globalThis.crypto) {
  const s = structuredClone(validateState(state));
  if (action.pendingId && action.pendingId !== s.pending?.id) throw new Error('다른 운영 창에서 결과가 변경되었습니다. 현재 번호를 다시 확인해 주세요.');
  const busy = s.pending && now < s.pending.startedAt + s.pending.duration;
  const idle = () => { if (s.pending) throw new Error('현재 추첨 결과를 먼저 확정해 주세요.'); };
  const resolve = status => {
    if (!s.pending || busy) throw new Error('번호 공개가 끝난 후에 처리할 수 있습니다.');
    const r = { ...s.pending, status, resolvedAt: now };
    s.history.push(r); s.pending = null; return r;
  };
  const draw = () => {
    idle();
    const pool = candidates(s);
    if (!pool.length) throw new Error('추첨 가능한 번호가 모두 소진되었습니다.');
    if (!prizesRemaining(s)) throw new Error('모든 상품의 당첨자가 확정되었습니다.');
    s.pending = { id: cryptoSource.randomUUID(), numbers: sample(pool, nextCount(s), cryptoSource), invalid:[], programId:s.programId, programTitle:currentProgram(s).title, noRepeat:true, mode: s.mode, rangeStart:s.rangeStart, rangeEnd:s.rangeEnd, startedAt: now, duration: action.reduced ? 1400 : DURATION };
    s.view = 'result'; s.shownId = null;
  };
  switch (action.type) {
    case 'draw': draw(); break;
    case 'confirm': s.shownId = resolve('confirmed').id; break;
    case 'mark-invalid': {
      if (!s.pending || busy) throw new Error('번호 공개가 끝난 후에 처리할 수 있습니다.');
      if (!s.pending.numbers.includes(action.number) || typeof action.invalid !== 'boolean') throw new Error('현재 추첨 번호를 확인해 주세요.');
      s.pending.invalid = s.pending.invalid.filter(n => n !== action.number);
      if (action.invalid) s.pending.invalid.push(action.number);
      break;
    }
    case 'amend-invalid': {
      idle();
      if (action.revision !== s.revision) throw new Error('기록이 변경되었습니다. 현재 기록을 다시 확인해 주세요.');
      const round = s.history.find(r => r.id === action.id && r.status === 'confirmed');
      if (!round?.numbers.includes(action.number) || typeof action.invalid !== 'boolean') throw new Error('수정할 추첨 번호를 확인해 주세요.');
      round.invalid = round.invalid.filter(n => n !== action.number);
      if (action.invalid) round.invalid.push(action.number);
      if (winnerNumbers(s).length > s.prizeTotal) throw new Error('전체 상품 수보다 유효 당첨자가 많아집니다. 상품 수를 먼저 수정해 주세요.');
      break;
    }
    case 'program':
      idle();
      if (!s.programs.some(p => p.id === action.id)) throw new Error('진행 페이지를 확인해 주세요.');
      s.programId = action.id; s.batch = currentProgram(s).batch; s.view = 'idle'; s.shownId = null;
      break;
    case 'program-settings':
      idle();
      if (action.revision !== s.revision) throw new Error('설정이 변경되었습니다. 페이지를 다시 확인해 주세요.');
      s.programs = structuredClone(action.programs);
      s.batch = currentProgram(s)?.batch;
      break;
    case 'settings':
      idle();
      s.rangeStart = Number(action.rangeStart ?? s.rangeStart);
      s.rangeEnd = Number(action.rangeEnd ?? s.rangeEnd);
      if (!validRange(s.rangeStart,s.rangeEnd)) throw new Error('행운권 구간은 1부터 9999 사이의 시작 번호와 끝 번호를 오름차순으로 입력해 주세요.');
      s.excluded = parseExcluded(action.excluded,s.rangeStart,s.rangeEnd);
      s.batch = Number(action.batch);
      currentProgram(s).batch = s.batch;
      s.prizeTotal = Number(action.prizeTotal ?? s.prizeTotal);
      if (!Number.isInteger(s.prizeTotal) || s.prizeTotal < Math.max(1,winnerNumbers(s).length) || s.prizeTotal > MAX_TICKET) throw new Error('전체 상품 수는 유효 당첨자 수 이상, 1–9999 사이로 입력해 주세요.');
      break;
    case 'mode': idle(); s.mode = action.mode; break;
    case 'sound': s.sound = Boolean(action.value); break;
    case 'view':
      idle(); s.view = action.view; s.shownId = action.id ?? s.shownId;
      if (s.view === 'result' && !s.shownId) throw new Error('표시할 확정 기록이 없습니다.');
      break;
    case 'reset':
      if (busy) throw new Error('번호 공개 중에는 초기화할 수 없습니다.');
      if (action.revision !== undefined && action.revision !== s.revision) throw new Error('확인 창이 열린 동안 기록이 변경되었습니다. 현재 기록을 확인한 뒤 다시 초기화해 주세요.');
      return { ...initialState(), programs:s.programs, programId:s.programId, batch:s.batch, prizeTotal:s.prizeTotal, rangeStart:s.rangeStart, rangeEnd:s.rangeEnd, excluded:s.excluded, mode:s.mode, sound:s.sound, revision:s.revision + 1 };
    default: throw new Error('알 수 없는 작업입니다.');
  }
  s.revision++;
  return validateState(s);
}
