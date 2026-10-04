import { candidates, pad } from './core.mjs';
import { read, subscribe, pingStage } from './store.mjs';
const $ = id => document.getElementById(id);
const preview = new URLSearchParams(location.search).has('preview');
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
let state, signature = '', cards = [], cells = [], pool = [], lastStep = -1, frame = 0, summaryStart = Date.now();
const sections = ['intro','draw-scene','all-scene','end-scene'];
function element(tag, className, text) {
  const el = document.createElement(tag); el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}
function load() {
  try { state = read(); $('stage-error').hidden = true; render(); }
  catch { $('stage-error').hidden = false; sections.forEach(id => $(id).hidden = true); }
}
function currentRound() { return state.pending ?? state.history.find(r => r.id === state.shownId); }
function render() {
  const round = currentRound();
  const view = state.pending ? 'result' : state.view;
  const nextSignature = [view, round?.id, state.pending ? 'pending' : 'saved', state.history.length, state.excluded.join(','), state.batch].join(':');
  $('stage-footer-right').textContent = `행운권 001–200 · ${state.batch}명 추첨`;
  $('intro-count').textContent = `매회 ${state.batch}명`;
  if (nextSignature === signature) return;
  signature = nextSignature;
  const target = { idle: 'intro', result: 'draw-scene', all: 'all-scene', end: 'end-scene' }[view];
  sections.forEach(id => $(id).hidden = id !== target);
  $('stage').classList.toggle('is-reduced', reduced.matches || round?.duration === 1400);
  if (view === 'all') { summaryStart = Date.now(); lastStep = -1; renderAll(); }
  if (view !== 'result' || !round) return;
  $('draw-scene').className = `draw-scene mode-${round.mode}`;
  const confirmed = state.history.filter(r => r.status === 'confirmed');
  const index = state.pending ? confirmed.length + 1 : confirmed.findIndex(r => r.id === round.id) + 1;
  $('scene-round').textContent = `${index}회 추첨 · ${round.numbers.length}명`;
  $('winner-row').replaceChildren();
  cards = round.numbers.map((_, i) => {
    const card = element('div', 'winner-card sealed');
    card.append(element('small', '', '행운권'), element('strong', '', '?'), element('span', 'ticket-bottom', '세계선교교회'));
    card.setAttribute('aria-label', `${i + 1}번째 번호 공개 대기`);
    $('winner-row').append(card); return card;
  });
  pool = candidates(state); lastStep = -1;
  createArt(round.mode);
  tick();
}
function createArt(mode) {
  const art = $('draw-art'); art.replaceChildren(); art.classList.remove('vanish'); cells = [];
  if (mode === 'ticket') {
    for (let i = 0; i < 7; i++) {
      const ticket = element('div', 'shuffle-ticket', pad(pool[(i * 29) % pool.length] ?? 1));
      ticket.style.setProperty('--i', i); art.append(ticket);
    }
  } else if (mode === 'ball') {
    const vessel = element('div', 'ball-vessel');
    for (let i = 0; i < 16; i++) {
      const ball = element('span', 'little-ball', pad(pool[i * 11 % pool.length] ?? 1));
      ball.style.setProperty('--i', i); vessel.append(ball);
    }
    art.append(vessel);
  } else if (mode === 'grid') {
    const grid = element('div', 'number-grid'); const eligible = new Set(pool);
    for (let n = 1; n <= 200; n++) {
      const cell = element('span', `grid-number${eligible.has(n) ? '' : ' ineligible'}`, pad(n));
      grid.append(cell); cells.push(cell);
    }
    art.append(grid);
  } else if (mode === 'drum') {
    const stand = element('div', 'drum-machine'), cage = element('div', 'drum-cage');
    for (let i = 0; i < 15; i++) {
      const ticket = element('span', 'drum-ticket', pad(pool[i * 13 % pool.length] ?? 1));
      ticket.style.setProperty('--i', i); ticket.style.top = `${18 + i % 3 * 20}%`; cage.append(ticket);
    }
    stand.append(cage); art.append(stand);
  }
}
function tick() {
  if (!state) return;
  if (!state.pending && state.view === 'all') { renderAll(); return; }
  if (!state.pending && state.view !== 'result') return;
  const r = currentRound(); if (!r) return;
  const elapsed = state.pending ? Math.max(0, Date.now() - r.startedAt) : r.duration;
  const short = r.duration === 1400 || reduced.matches;
  const finished = elapsed >= r.duration;
  const revealStart = short ? 200 : 4200, stagger = short ? 160 : 350;
  const revealCount = Math.min(r.numbers.length, Math.max(0, Math.floor((elapsed - revealStart) / stagger) + 1));
  $('scene-title').textContent = finished ? '당첨 번호' : '추첨 중입니다';
  $('scene-caption').textContent = finished ? '축하합니다. 번호를 확인해 주세요.' : '잠시 후 번호가 공개됩니다';
  $('draw-art').classList.toggle('vanish', short || elapsed >= (r.mode === 'grid' ? 5800 : 2900));
  cards.forEach((card, i) => {
    const revealed = finished || i < revealCount;
    const visible = r.mode === 'grid' && !short ? elapsed >= 5800 : (r.mode === 'ball' || r.mode === 'drum') && !short ? revealed : short || r.mode === 'number' || elapsed >= 3100 + i * 90;
    card.classList.toggle('ready', visible);
    if (revealed && card.classList.contains('sealed')) {
      card.classList.remove('sealed'); card.classList.add('reveal');
      card.querySelector('strong').textContent = pad(r.numbers[i]);
      card.setAttribute('aria-label', `당첨 번호 ${pad(r.numbers[i])}`);
    }
  });
  const step = Math.floor(elapsed / (elapsed < 3000 ? 75 : 150));
  if (step === lastStep || short || finished) return;
  lastStep = step;
  // Decorative sequence only. Winner selection happens exclusively in core.mjs.
  if (r.mode === 'number') cards.forEach((card, i) => {
    if (card.classList.contains('sealed')) card.querySelector('strong').textContent = pad(pool[(step * 37 + i * 53) % pool.length] ?? 1);
  });
  if (r.mode === 'grid') {
    cells.forEach(c => c.classList.remove('active', 'selected'));
    for (let i = 0; i < 5; i++) cells[(pool[(step * 37 + i * 53) % pool.length] ?? 1) - 1]?.classList.add('active');
    r.numbers.slice(0, revealCount).forEach(n => cells[n - 1].classList.add('selected'));
  }
}
function renderAll() {
  const numbers = state.history.filter(r => r.status === 'confirmed').flatMap(r => r.numbers);
  const pages = Math.max(1, Math.ceil(numbers.length / 40));
  const page = Math.floor((Date.now() - summaryStart) / 10000) % pages;
  if (lastStep === page) return;
  lastStep = page;
  $('all-numbers').replaceChildren(...numbers.slice(page * 40, (page + 1) * 40).map(n => element('span', '', pad(n))));
  $('all-page').textContent = numbers.length ? `총 ${numbers.length}명${pages > 1 ? ` · ${page + 1} / ${pages}` : ''}` : '아직 확정된 당첨 번호가 없습니다';
}
function animate() { tick(); frame = requestAnimationFrame(animate); }
async function fullscreen() {
  if (preview) return;
  try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); } catch { /* Browser may refuse without a user gesture. */ }
}
document.addEventListener('dblclick', fullscreen);
document.addEventListener('keydown', e => {
  if (e.key.toLowerCase() === 'f' && !e.ctrlKey && !e.metaKey) { e.preventDefault(); fullscreen(); }
  if (e.key === 'Escape' && !preview) window.opener?.focus();
});
subscribe(load); load(); animate();
reduced.addEventListener('change', () => { signature = ''; render(); });
if (!preview) { pingStage(); setInterval(pingStage, 2000); }
addEventListener('pagehide', () => cancelAnimationFrame(frame));
addEventListener('pageshow', e => { if (e.persisted) { load(); animate(); } });
