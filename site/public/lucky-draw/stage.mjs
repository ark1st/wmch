import { candidates, pad, drawTiming, currentProgram, winnerNumbers, nextCount } from './core.mjs';
import { read, subscribe, pingStage } from './store.mjs';
const $ = id => document.getElementById(id);
const preview = new URLSearchParams(location.search).has('preview');
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
let state, signature = '', cards = [], cells = [], pool = [], lastStep = -1, frame = 0, summaryStart = Date.now(), settledRound = null;
let gridPage = -1, gridEligible = new Set();
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
  const nextSignature = [view, round?.id, state.pending ? 'pending' : 'saved', state.revision].join(':');
  $('stage').classList.toggle('wide-numbers', state.rangeEnd > 999 || (round?.numbers.some(n => n > 999) ?? false) || state.history.some(r => r.numbers.some(n => n > 999)));
  $('intro-count').textContent = nextCount(state) ? `${nextCount(state)}명을 추첨합니다` : '추첨을 마쳤습니다';
  const title = currentProgram(state).title;
  if ($('intro-program').dataset.title !== title) {
    $('intro-program').dataset.title = title;
    const names = title.split(/[,·]/).map(name=>name.trim()).filter(Boolean);
    $('intro-program').replaceChildren(...(names.length > 1 && names.length <= 3 ? names : [title]).map(name=>element('span','',name)));
    $('intro-program').classList.toggle('long-title',title.length > 24);
  }
  if (nextSignature === signature) return;
  signature = nextSignature;
  settledRound = null;
  $('stage').dataset.view = view;
  const target = { idle: 'intro', result: 'draw-scene', all: 'all-scene', page:'all-scene', end: 'end-scene' }[view];
  sections.forEach(id => $(id).hidden = id !== target);
  $('stage').classList.toggle('is-reduced', reduced.matches || round?.duration === 1400);
  if (view === 'all' || view === 'page') { summaryStart = Date.now(); lastStep = -1; renderAll(); }
  if (view !== 'result' || !round) return;
  $('draw-scene').className = `draw-scene mode-${round.mode}`;
  $('draw-scene').style.setProperty('--phase',`${-Math.max(0,Date.now()-round.startedAt)}ms`);
  const confirmed = state.history.filter(r => r.status === 'confirmed');
  const index = state.pending ? confirmed.length + 1 : confirmed.findIndex(r => r.id === round.id) + 1;
  $('scene-round').textContent = `${index}회 추첨 · ${round.numbers.length}명`;
  $('winner-row').replaceChildren();
  cards = round.numbers.map((_, i) => {
    const card = element('div', 'winner-card sealed');
    card.style.setProperty('--slot',i);
    card.style.setProperty('--fan',`${(i-(round.numbers.length-1)/2)*4}deg`);
    const angle = -Math.PI/2 + i*2*Math.PI/round.numbers.length;
    card.style.setProperty('--orbit-x',`${Math.cos(angle)*29}vw`);
    card.style.setProperty('--orbit-y',`${Math.sin(angle)*20}vh`);
    card.append(element('small', '', '당첨 번호'), element('strong', '', '?'), element('span', 'ticket-bottom', '행운권'), element('span','invalid-label','무효'));
    if (round.mode === 'envelope') card.append(element('span','envelope-insert'),element('span','envelope-front'),element('span','envelope-flap'));
    card.setAttribute('aria-label', `${i + 1}번째 번호 공개 대기`);
    $('winner-row').append(card); return card;
  });
  pool = candidates(state); lastStep = -1;
  createArt(round.mode);
  tick();
}
function createArt(mode) {
  const art = $('draw-art'); art.replaceChildren(); art.classList.remove('vanish'); cells = []; gridPage = -1;
  if (mode === 'ticket') {
    for (let i = 0; i < 7; i++) {
      const ticket = element('div', 'shuffle-ticket', pad(pool[(i * 29) % pool.length] ?? 1));
      ticket.style.setProperty('--i', i); art.append(ticket);
    }
  } else if (mode === 'ball') {
    const vessel = element('div', 'ball-vessel');
    for (let i = 0; i < 16; i++) {
      const ball = element('span', 'little-ball', pad(pool[i * 11 % pool.length] ?? 1));
      ball.style.setProperty('--i', i); ball.style.setProperty('--x', `${7 + i * 17 % 70}%`); ball.style.setProperty('--y', `${8 + i * 23 % 52}%`); vessel.append(ball);
    }
    art.append(vessel);
  } else if (mode === 'grid') {
    const grid = element('div', 'number-grid'); gridEligible = new Set(pool);
    const count = Math.min(200,state.rangeEnd - state.rangeStart + 1);
    grid.style.setProperty('--columns',Math.min(20,Math.max(5,Math.ceil(Math.sqrt(count * 2)))));
    for (let n = 0; n < count; n++) {
      const cell = element('span', 'grid-number');
      grid.append(cell); cells.push(cell);
    }
    art.append(grid); setGridPage(0);
  } else if (mode === 'drum') {
    const wheel = element('div','raffle-wheel');
    for (let i=0;i<12;i++) {
      const ticket = element('span','wheel-stub'); ticket.style.setProperty('--angle',`${i*30}deg`); wheel.append(ticket);
    }
    art.append(wheel,element('span','wheel-hub','행운권'),element('span','wheel-pointer'));
  } else if (mode === 'spotlight') {
    for (let i=0;i<3;i++) {
      const beam = element('span','spotlight-beam'); beam.style.setProperty('--i',i); art.append(beam);
    }
  } else if (mode === 'orbit') {
    const orbit = element('div','number-orbit');
    for (let i=0;i<10;i++) {
      const node = element('span','orbit-node',pad(pool[(i*17)%pool.length] ?? 1));
      node.style.setProperty('--angle',`${i*36}deg`); orbit.append(node);
    }
    orbit.append(element('span','orbit-center','행운권')); art.append(orbit);
  } else if (mode === 'curtain') {
    art.append(element('span','theatre-curtain left'),element('span','theatre-curtain right'),element('span','theatre-valance'));
  }
}
function setGridPage(page) {
  if (page === gridPage) return;
  gridPage = page;
  const start = state.rangeStart + page * 200, end = Math.min(state.rangeEnd,start + 199);
  cells.forEach((cell,i) => {
    const n = start + i;
    cell.hidden = n > end;
    cell.textContent = pad(n); cell.dataset.number = n;
    cell.className = `grid-number${gridEligible.has(n) ? '' : ' ineligible'}`;
  });
}
function showNumber(card, number, mode) {
  const strong = card.querySelector('strong'), value = pad(number);
  if (mode !== 'flip') { strong.textContent = value; return; }
  if (strong.children.length !== value.length) strong.replaceChildren(...[...value].map((digit,i)=>{
    const span=element('span','flip-digit',digit); span.style.setProperty('--digit',i); return span;
  }));
  [...strong.children].forEach((span,i)=>span.textContent=value[i]);
}
function tick() {
  if (!state) return;
  if (!state.pending && ['all','page'].includes(state.view)) { renderAll(); return; }
  if (!state.pending && state.view !== 'result') return;
  const r = currentRound(); if (!r) return;
  const elapsed = state.pending ? Math.max(0, Date.now() - r.startedAt) : r.duration;
  const short = r.duration === 1400 || reduced.matches;
  const finished = elapsed >= r.duration;
  if (finished && settledRound === r.id) return;
  if (finished) settledRound = r.id;
  const timing = drawTiming(r.duration, short);
  const { revealStart, stagger } = timing;
  const revealCount = Math.min(r.numbers.length, Math.max(0, Math.floor((elapsed - revealStart) / stagger) + 1));
  $('draw-scene').classList.toggle('is-finished', finished);
  $('draw-scene').classList.toggle('curtain-open',short || elapsed >= timing.cardsEnter);
  $('scene-title').textContent = finished ? (r.invalid.length === r.numbers.length ? '추첨 결과' : '축하합니다') : '추첨 중입니다';
  $('scene-caption').textContent = finished ? `유효 ${r.numbers.length-r.invalid.length}명${r.invalid.length ? ` · 무효 ${r.invalid.length}명` : ''}${state.pending ? ' · 번호를 확인해 주세요.' : ' · 당첨 확정'}` : '잠시 후 번호가 공개됩니다';
  $('draw-art').classList.toggle('vanish', short || (!['drum','curtain'].includes(r.mode) && elapsed >= (r.mode === 'grid' ? timing.gridExit : r.mode === 'spotlight' ? r.duration : timing.artExit)));
  cards.forEach((card, i) => {
    const revealed = finished || i < revealCount;
    const visible = r.mode === 'grid' && !short ? elapsed >= timing.gridExit : (r.mode === 'ball' || r.mode === 'drum') && !short ? revealed : short || ['number','flip','envelope','curtain'].includes(r.mode) || elapsed >= timing.cardsEnter + i * timing.cardStagger;
    card.classList.toggle('ready', visible);
    const invalid = r.invalid.includes(r.numbers[i]);
    card.classList.toggle('is-invalid', revealed && invalid);
    card.querySelector('small').textContent = invalid && revealed ? '무효 번호' : '당첨 번호';
    card.querySelector('.ticket-bottom').textContent = invalid && revealed ? '무효' : '행운권';
    if (revealed && card.classList.contains('sealed')) {
      card.classList.remove('sealed'); card.classList.add('reveal');
      showNumber(card,r.numbers[i],r.mode);
      card.setAttribute('aria-label', `${invalid ? '무효' : '당첨'} 번호 ${pad(r.numbers[i])}`);
    }
  });
  const step = Math.floor(elapsed / (elapsed < revealStart ? 60 : 110));
  if (step === lastStep || short || finished) return;
  lastStep = step;
  // Decorative sequence only. Winner selection happens exclusively in core.mjs.
  if (r.mode === 'number' || r.mode === 'flip') cards.forEach((card, i) => {
    if (card.classList.contains('sealed')) showNumber(card,pool[(step * 37 + i * 53) % pool.length] ?? 1,r.mode);
  });
  if (r.mode === 'grid') {
    const pages = Math.ceil((state.rangeEnd - state.rangeStart + 1) / 200);
    const page = revealCount ? Math.floor((r.numbers[revealCount - 1] - state.rangeStart) / 200) : Math.floor(elapsed / 240) % pages;
    setGridPage(page);
    cells.forEach(c => c.classList.remove('active', 'selected'));
    const eligibleCells = cells.filter(c => !c.hidden && gridEligible.has(Number(c.dataset.number)));
    for (let i = 0; i < 5; i++) eligibleCells[(step * 37 + i * 53) % eligibleCells.length]?.classList.add('active');
    cells.filter(c => r.numbers.slice(0,revealCount).includes(Number(c.dataset.number))).forEach(c => c.classList.add('selected'));
  }
}
function renderAll() {
  const numbers = winnerNumbers(state,state.view === 'page' ? state.programId : undefined);
  $('all-title').textContent = state.view === 'page' ? '당첨 번호' : '전체 당첨 번호';
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
