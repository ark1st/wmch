export const MODES = ['ticket', 'number', 'ball', 'grid', 'drum'];
export const DURATION = 6800;
export const pad = (n) => String(n).padStart(3, '0');
export const initialState = () => ({ version: 1, revision: 0, mode: 'ticket', batch: 5, excluded: [], sound: false, pending: null, history: [], view: 'idle', shownId: null });

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
  const removed = new Set([...state.excluded, ...state.history.filter(r => r.status === 'confirmed').flatMap(r => r.numbers)]);
  return Array.from({ length: 200 }, (_, i) => i + 1).filter(n => !removed.has(n));
}

export function parseExcluded(text) {
  if (!text.trim()) return [];
  const numbers = new Set();
  for (const part of text.trim().split(/[,\s]+/)) {
    const match = /^(\d{1,3})(?:-(\d{1,3}))?$/.exec(part);
    if (!match) throw new Error(`제외 번호를 확인해 주세요: ${part}`);
    const from = Number(match[1]), to = Number(match[2] ?? match[1]);
    if (from < 1 || to > 200 || to < from) throw new Error('제외 번호는 1–200 사이의 번호 또는 오름차순 범위여야 합니다.');
    for (let n = from; n <= to; n++) numbers.add(n);
  }
  return [...numbers].sort((a, b) => a - b);
}

const validNumbers = ns => Array.isArray(ns) && ns.every(n => Number.isInteger(n) && n >= 1 && n <= 200) && new Set(ns).size === ns.length;
export function validateState(s) {
  const fail = () => { throw new Error('저장된 추첨 기록을 읽을 수 없습니다. 기록을 백업한 뒤 초기화해 주세요.'); };
  if (!s || s.version !== 1 || !Number.isSafeInteger(s.revision) || s.revision < 0 || !MODES.includes(s.mode) || !Number.isInteger(s.batch) || s.batch < 1 || s.batch > 5 || !validNumbers(s.excluded) || typeof s.sound !== 'boolean' || !Array.isArray(s.history) || !['idle','result','all','end'].includes(s.view)) fail();
  const ids = new Set(), winners = new Set();
  const checkRound = r => {
    if (!r || typeof r.id !== 'string' || ids.has(r.id) || !validNumbers(r.numbers) || r.numbers.length < 1 || r.numbers.length > 5 || !MODES.includes(r.mode) || !Number.isFinite(r.startedAt) || r.startedAt < 0 || ![1400, DURATION].includes(r.duration)) fail();
    ids.add(r.id);
  };
  for (const r of s.history) {
    checkRound(r);
    if (!['confirmed', 'discarded'].includes(r.status) || !Number.isFinite(r.resolvedAt)) fail();
    if (r.status === 'confirmed') for (const n of r.numbers) { if (winners.has(n)) fail(); winners.add(n); }
  }
  if (s.pending) {
    checkRound(s.pending);
    if (!s.pending.numbers.every(n => candidates(s).includes(n))) fail();
  }
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
    s.pending = { id: cryptoSource.randomUUID(), numbers: sample(pool, Math.min(s.batch, pool.length), cryptoSource), mode: s.mode, startedAt: now, duration: action.reduced ? 1400 : DURATION };
    s.view = 'result'; s.shownId = null;
  };
  switch (action.type) {
    case 'draw': draw(); break;
    case 'confirm': s.shownId = resolve('confirmed').id; break;
    case 'reroll': resolve('discarded'); draw(); break;
    case 'settings':
      idle();
      s.excluded = parseExcluded(action.excluded);
      s.batch = Number(action.batch);
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
      return { ...initialState(), revision: s.revision + 1 };
    default: throw new Error('알 수 없는 작업입니다.');
  }
  s.revision++;
  return validateState(s);
}
