import { candidates, MODES, pad, currentProgram, winnerNumbers, invalidNumbers, validWinners, prizesRemaining, nextCount } from './core.mjs';
import { KEY, read, dispatch, subscribe, onStagePing, resetDamaged } from './store.mjs';
import { unlockAudio, stopAudio, playDraw } from './audio.mjs';
const $ = id => document.getElementById(id);
const text = (id, value) => { if ($(id).textContent !== value) $(id).textContent = value; };
const root = document.body.dataset.root;
let state, lastRevision = -1, stageLastSeen = 0, working = false, damaged = false, dialogSnapshot = null, stageWindow;
let programSignature = '', reviewId = null;
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const modeDescriptions = {ticket:'티켓을 섞은 뒤 한 장씩 펼칩니다',number:'돌아가는 숫자가 차례로 멈춥니다',ball:'번호가 적힌 공을 하나씩 뽑습니다',grid:'번호판에서 당첨 번호를 찾습니다',drum:'드럼을 돌려 행운권을 꺼냅니다'};
function notify(message) { $('notice').textContent = message; $('notice').hidden = !message; }
function load() {
  try { state = read(); damaged = false; render(); }
  catch (error) {
    damaged = true; notify(`추첨을 잠시 멈췄습니다. ${error.message} ‘기록 내려받기’로 원본 기록을 보관할 수 있습니다.`);
    document.querySelectorAll('button,input,textarea,select').forEach(el => { if (!['export','reset','help','help-mobile','dialog-accept','reset-word'].includes(el.id) && !el.closest('dialog')) el.disabled = true; });
  }
}
function render() {
  const pool = candidates(state), winners = state.history.filter(r => r.status === 'confirmed');
  $('remaining').textContent = pool.length;
  $('range-total').textContent = state.rangeEnd - state.rangeStart + 1;
  $('winner-count').textContent = winnerNumbers(state).filter(n => n >= state.rangeStart && n <= state.rangeEnd).length;
  const confirmedNumbers = new Set(winners.flatMap(r => r.numbers));
  $('excluded-count').textContent = state.excluded.filter(n => !confirmedNumbers.has(n)).length;
  $('history-count').textContent = `${winners.length}회`;
  $('sound').checked = state.sound;
  $('mode-description').textContent = modeDescriptions[state.mode];
  for (const view of ['idle','page','all','end']) $(`show-${view}`).setAttribute('aria-pressed', String(!state.pending && state.view === view));
  document.querySelectorAll('[data-mode]').forEach(el => { el.setAttribute('aria-pressed', String(el.dataset.mode === state.mode)); el.disabled = !!state.pending || working; });
  $('settings-fields').disabled = !!state.pending || working;
  $('program-fields').disabled = !!state.pending || working;
  for (const id of ['show-idle','show-page','show-all','show-end']) $(id).disabled = !!state.pending || working;
  if (lastRevision !== state.revision) {
    if (document.activeElement !== $('excluded')) $('excluded').value = state.excluded.join(', ');
    if (document.activeElement !== $('batch')) $('batch').value = state.batch;
    if (document.activeElement !== $('range-start')) $('range-start').value = state.rangeStart;
    if (document.activeElement !== $('range-end')) $('range-end').value = state.rangeEnd;
    if (document.activeElement !== $('prize-total-input')) $('prize-total-input').value = state.prizeTotal;
    renderPrograms(); renderHistory(); lastRevision = state.revision;
  }
  document.querySelectorAll('[data-program]').forEach(button => button.disabled = !!state.pending || working);
  progress();
}
function el(tag, className, value) {
  const node = document.createElement(tag); node.className = className;
  if (value !== undefined) node.textContent = value;
  return node;
}
function renderPrograms() {
  const program = currentProgram(state), valid = winnerNumbers(state), invalid = invalidNumbers(state);
  if (!$('program-nav').children.length) $('program-nav').replaceChildren(...state.programs.map((p,i) => {
    const button = el('button','program-tab'); button.type = 'button'; button.dataset.program = p.id;
    button.setAttribute('aria-pressed',String(p.id === state.programId));
    button.append(el('span','',i === 5 ? '기타' : `${i+1}페이지`),el('strong','',p.title));
    button.addEventListener('click',()=>act({type:'program',id:p.id})); return button;
  }));
  state.programs.forEach((p,i) => {
    const button = $('program-nav').children[i];
    button.querySelector('strong').textContent = p.title;
    button.setAttribute('aria-pressed',String(p.id === state.programId));
  });
  $('program-position').textContent = program.id === 'other' ? '기타' : `${state.programs.indexOf(program)+1}페이지`;
  $('program-title').textContent = program.title;
  $('program-plan').textContent = `${program.batch}개씩${program.hosts ? ` · 진행자 ${program.hosts}인` : ''} · 예정 ${program.planned}개`;
  for (const [id,value] of Object.entries({'prize-total':state.prizeTotal,'valid-total':valid.length,'invalid-total':invalid.length,'prize-remaining':prizesRemaining(state)})) $(id).textContent = value;
  const pageNumbers = winnerNumbers(state,state.programId);
  $('page-tally').textContent = `유효 ${pageNumbers.length}명 · 예정 ${program.planned}개`;
  $('page-numbers').replaceChildren(...(pageNumbers.length ? pageNumbers.map(n=>el('span','',pad(n))) : [el('p','form-hint','이 페이지에서 확정한 유효 당첨 번호가 표시됩니다.')]));
  $('invalid-count').textContent = `${invalid.length}개`;
  $('invalid-list').replaceChildren(...(invalid.length ? invalid.map(n=>el('span','invalid-number',pad(n))) : [el('p','form-hint','무효표가 없습니다.')]));
  const signature = JSON.stringify(state.programs);
  if (programSignature === signature) { updatePlanTotal(); return; }
  programSignature = signature;
  $('program-editor').replaceChildren(...state.programs.map((p,i) => {
    const row = el('div','program-edit-row'); row.dataset.id = p.id;
    row.append(el('span','program-edit-index',i === 5 ? '기타' : `${i+1}페이지`));
    for (const [key,label,type,min,max] of [['title','진행자','text'],['batch','한 번에','number',1,5],['hosts','진행자 수','number',0,99],['planned','예정 상품','number',0,9999]]) {
      const field = el('label','',label), input = document.createElement('input'); input.type = type; input.value = p[key]; input.dataset.field = key;
      input.setAttribute('aria-label',`${i === 5 ? '기타' : `${i+1}페이지`} ${label}`); input.required = true;
      if (type === 'number') {input.min = min; input.max = max; input.step = 1;} else input.maxLength = 80;
      field.append(input); row.append(field);
    }
    return row;
  }));
  updatePlanTotal();
}
function updatePlanTotal() {
  const total = [...$('program-editor').querySelectorAll('[data-field="planned"]')].reduce((sum,input)=>sum+Number(input.value || 0),0);
  $('plan-total').textContent = `진행표 예정 합계 ${total}개 · 전체 상품 ${state.prizeTotal}개${total !== state.prizeTotal ? ' (수량이 다릅니다. 추첨 설정에서 전체 상품 수를 확인해 주세요.)' : ''}`;
}
function renderReview(busy) {
  const round = state.pending;
  $('pending-review').hidden = !round || busy;
  if (!round) {reviewId = null; return;}
  if (reviewId !== round.id) {
    reviewId = round.id;
    $('pending-numbers').replaceChildren(...round.numbers.map(n => {
      const button = el('button','number-choice'); button.dataset.number = n; button.type = 'button';
      button.append(el('strong','',pad(n)),el('span','','유효'));
      button.addEventListener('click',()=>act({type:'mark-invalid',number:n,invalid:!state.pending.invalid.includes(n),pendingId:round.id})); return button;
    }));
  }
  for (const button of $('pending-numbers').children) {
    const invalid = round.invalid.includes(Number(button.dataset.number));
    button.setAttribute('aria-pressed',String(invalid)); button.setAttribute('aria-label',`${pad(button.dataset.number)} 무효표`);
    button.querySelector('span').textContent = invalid ? '무효' : '유효'; button.disabled = busy || working;
  }
  const valid = round.numbers.length - round.invalid.length;
  $('pending-summary').textContent = `유효 ${valid}명 · 무효 ${round.invalid.length}명 · 확정 후 남은 상품 ${prizesRemaining(state)-valid}개`;
}
function progress() {
  const connected = Date.now() - stageLastSeen < 6500;
  $('stage-status').textContent = connected ? '무대 창 연결됨' : '이 화면에서 바로 추첨할 수 있습니다';
  $('stage-status').classList.toggle('ready', connected);
  if (!state || damaged) return;
  const pending = state.pending, busy = pending && Date.now() < pending.startedAt + pending.duration;
  const rounds = state.history.filter(r => r.status === 'confirmed').length;
  const remaining = candidates(state).length;
  const count = nextCount(state), prizes = prizesRemaining(state);
  $('draw').hidden = !!pending;
  $('draw').disabled = working || !!pending || !count;
  $('resolve-actions').hidden = !pending;
  $('confirm').disabled = working || !pending || busy;
  $('reset').disabled = working || !!busy;
  $('round-label').textContent = `${rounds + 1}회 추첨`;
  renderReview(busy);
  if (busy) {
    text('draw-description', '번호를 공개하고 있습니다.');
    $('draw-hint').textContent = '번호 공개가 끝나면 결과를 확정해 주세요.';
  } else if (pending) {
    text('draw-description', pending.numbers.map(pad).join('   '));
    $('draw-hint').textContent = '아래에서 무효표를 표시한 뒤 결과를 확정해 주세요.';
  } else {
    text('draw-description', !prizes ? '모든 상품의 당첨자가 확정되었습니다.' : count ? `이번 추첨은 ${count}명입니다.` : '추첨 가능한 번호가 모두 소진되었습니다.');
    $('draw-hint').textContent = count && prizes < state.batch ? `남은 상품 ${prizes}개에 맞춰 ${count}명만 추첨합니다.` : count && remaining < state.batch ? `남은 번호가 ${remaining}개여서 ${count}명만 추첨합니다.` : '무효표를 따로 보충하지 않습니다. 나온 번호는 다시 나오지 않습니다.';
    $('draw').firstChild.textContent = !count ? '추첨 완료 ' : rounds ? '다음 추첨 ' : '추첨 시작 ';
  }
}
function renderHistory() {
  const focusRound = document.activeElement?.dataset.roundId, focusNumber = document.activeElement?.dataset.number;
  if (!state.history.length) {
    $('history').innerHTML = '<div class="empty-history"><p>아직 추첨 기록이 없습니다.</p><small>당첨을 확정하면 이곳에 기록됩니다.</small></div>'; return;
  }
  const roundLabels = new Map(); let number = 0;
  for (const r of state.history) if (r.status === 'confirmed') roundLabels.set(r.id, ++number);
  const rows = [...state.history].reverse().map(r => {
    const row = document.createElement('div'); row.className = `history-round ${r.status}`;
    const meta = document.createElement('div'), title = document.createElement('span'), time = document.createElement('time');
    title.className = 'round-name'; title.textContent = r.status === 'confirmed' ? `${roundLabels.get(r.id)}회 · ${r.programTitle}` : '이전 재추첨 기록';
    time.dateTime = new Date(r.resolvedAt).toISOString(); time.textContent = new Date(r.resolvedAt).toLocaleTimeString('ko-KR', { hour12:false });
    meta.append(title, time);
    const numbers = el('div','history-numbers');
    for (const n of r.numbers) {
      const invalid = r.invalid.includes(n), button = el('button',`history-number${invalid ? ' invalid-number' : ''}`,`${pad(n)}${invalid ? ' 무효' : ''}`);
      button.dataset.roundId = r.id; button.dataset.number = n;
      button.setAttribute('aria-label',`${roundLabels.get(r.id) ?? '이전'}회 ${pad(n)} 무효표`); button.setAttribute('aria-pressed',String(invalid));
      button.disabled = !!state.pending || working || r.status !== 'confirmed';
      button.addEventListener('click',()=>act({type:'amend-invalid',id:r.id,number:n,invalid:!invalid,revision:state.revision})); numbers.append(button);
    }
    numbers.append(el('small','history-valid-count',r.status === 'confirmed' ? `유효 ${validWinners(r).length} · 무효 ${r.invalid.length}` : '상품 미지급'));
    row.append(meta, numbers);
    if (r.status === 'confirmed') {
      const button = document.createElement('button'); button.className = 'text-button'; button.textContent = '무대에 보기'; button.disabled = !!state.pending;
      button.addEventListener('click', () => act({ type:'view', view:'result', id:r.id })); row.append(button);
    } else { const label = document.createElement('span'); label.className = 'text-button'; label.textContent = '미확정'; row.append(label); }
    return row;
  });
  $('history').replaceChildren(...rows);
  if (focusRound) [...$('history').querySelectorAll('button[data-round-id]')].find(button=>button.dataset.roundId === focusRound && button.dataset.number === focusNumber)?.focus({preventScroll:true});
}
async function act(action) {
  if (working || damaged) return;
  working = true; notify(''); render();
  try {
    if (state.sound && action.type === 'draw') {
      try { await unlockAudio(); } catch { notify('효과음을 재생할 수 없습니다. 추첨은 계속 진행합니다.'); }
    }
    state = await dispatch({ ...action, pendingId: action.pendingId ?? (action.type === 'confirm' || action.type === 'mark-invalid' ? state.pending?.id : undefined), reduced: reduced.matches });
    if (action.type === 'draw' && state.sound) playDraw(state.pending);
    if (!state.sound) stopAudio();
    if (action.type === 'settings') notify('추첨 설정을 적용했습니다.');
    if (action.type === 'program-settings') notify('진행표를 저장했습니다.');
    if (action.type === 'amend-invalid') notify('무효표 표시와 남은 상품 수를 수정했습니다.');
  } catch (error) { notify(error.message); }
  finally { working = false; load(); }
}
function askReset() {
  if (working || $('action-dialog').open) return;
  dialogSnapshot = { pendingId:state?.pending?.id, revision:state?.revision };
  $('dialog-title').textContent = '모든 추첨 기록을 초기화할까요?';
  $('dialog-message').textContent = '유효·무효 기록이 모두 삭제되어 번호가 다시 후보에 포함됩니다. 진행표와 상품 수·번호 구간·사전 제외 설정은 유지합니다. 필요한 기록은 먼저 내려받아 주세요.';
  $('reset-label').hidden = false; $('reset-word').value = '';
  $('dialog-accept').disabled = true;
  $('dialog-accept').textContent = '전체 초기화';
  $('action-dialog').returnValue = ''; $('action-dialog').showModal();
}
$('action-dialog').addEventListener('close', async () => {
  if ($('action-dialog').returnValue !== 'accept') return;
  if ($('reset-word').value !== '초기화') return;
    if (damaged) {
      try { await resetDamaged(); location.reload(); } catch (error) { notify(error.message); }
    } else { stopAudio(); await act({type:'reset', revision:dialogSnapshot.revision}); }
});
$('reset-word').addEventListener('input', () => $('dialog-accept').disabled = $('reset-word').value !== '초기화');
$('draw').addEventListener('click', () => act({ type:'draw' }));
$('confirm').addEventListener('click', () => act({ type:'confirm' }));
$('reset').addEventListener('click', askReset);
$('help').addEventListener('click', () => $('help-dialog').showModal());
$('help-mobile').addEventListener('click', () => $('help-dialog').showModal());
function renderAppearance() {
  const dark = document.documentElement.dataset.theme === 'dark';
  $('appearance').textContent = dark ? '밝은 화면' : '어두운 화면';
  $('appearance').setAttribute('aria-label', dark ? '밝은 화면으로 전환' : '어두운 화면으로 전환');
}
$('appearance').addEventListener('click', () => {
  const theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = theme;
  try { localStorage.setItem('wmch-draw-appearance', theme); } catch { /* Appearance remains usable without persistence. */ }
  renderAppearance();
});
renderAppearance();
document.querySelectorAll('.control-nav a[href^="#"]').forEach(link => link.addEventListener('click', () => { document.querySelector(link.hash).open = true; }));
for (const view of ['idle','page','all','end']) $(`show-${view}`).addEventListener('click', () => act({ type:'view', view }));
document.querySelectorAll('[data-mode]').forEach(el => el.addEventListener('click', () => act({ type:'mode', mode:el.dataset.mode })));
$('settings').addEventListener('submit', e => { e.preventDefault(); act({type:'settings', prizeTotal:$('prize-total-input').value, batch:$('batch').value, excluded:$('excluded').value, rangeStart:$('range-start').value, rangeEnd:$('range-end').value}); });
$('program-editor').addEventListener('input', e => {
  if (['batch','hosts'].includes(e.target.dataset.field)) {
    const row = e.target.closest('.program-edit-row'), hosts = Number(row.querySelector('[data-field="hosts"]').value);
    if (hosts > 0) row.querySelector('[data-field="planned"]').value = hosts * Number(row.querySelector('[data-field="batch"]').value);
  }
  updatePlanTotal();
});
$('program-settings').addEventListener('submit', e => {
  e.preventDefault();
  const programs = [...$('program-editor').children].map(row => ({id:row.dataset.id,...Object.fromEntries([...row.querySelectorAll('input')].map(input=>[input.dataset.field,input.type === 'number' ? Number(input.value) : input.value.trim()]))}));
  act({type:'program-settings',programs,revision:state.revision});
});
$('sound').addEventListener('change', async () => {
  const value = $('sound').checked;
  if (value) try { await unlockAudio(); } catch { notify('이 브라우저에서는 효과음을 켤 수 없습니다.'); $('sound').checked = false; return; }
  act({ type:'sound', value });
});
$('open-stage').addEventListener('click', () => {
  stageWindow = window.open(`${root}stage/`, 'wmch-lucky-draw-stage', 'popup,width=1280,height=720');
  if (!stageWindow) notify('팝업이 차단되었습니다. 이 사이트의 팝업을 허용한 뒤 다시 열어 주세요.');
  else notify('열린 무대 창을 프로젝터로 옮긴 뒤 F 또는 더블클릭으로 전체화면을 켜 주세요.');
});
function download() {
  const raw = localStorage.getItem(KEY) ?? JSON.stringify(state);
  let content = raw, extension = 'json';
  if (!damaged) {
    const lines = [['회차','상태','진행 페이지','번호1','번호2','번호3','번호4','번호5','유효 번호','무효 번호','유효 인원','연출','추첨 시각','확정 시각']];
    let round = 0;
    for (const r of state.history) lines.push([r.status === 'confirmed' ? ++round : '', r.status === 'confirmed' ? '확정' : '이전 재추첨',r.programTitle,...Array.from({length:5}, (_,i) => r.numbers[i] ? pad(r.numbers[i]) : ''),validWinners(r).map(pad).join(' '),r.invalid.map(pad).join(' '),validWinners(r).length,r.mode,new Date(r.startedAt).toISOString(),new Date(r.resolvedAt).toISOString()]);
    if (state.pending) {const r=state.pending; lines.push([round+1,'확정 대기',r.programTitle,...Array.from({length:5},(_,i)=>r.numbers[i]?pad(r.numbers[i]):''),r.numbers.filter(n=>!r.invalid.includes(n)).map(pad).join(' '),r.invalid.map(pad).join(' '),'',r.mode,new Date(r.startedAt).toISOString(),'']);}
    lines.push([],['전체 상품',state.prizeTotal],['유효 당첨',winnerNumbers(state).length],['남은 상품',prizesRemaining(state)],['현재 번호 구간',state.rangeStart,state.rangeEnd],['사전 제외',...state.excluded.map(pad)]);
    content = '\uFEFF' + lines.map(row => row.map(v => {let value=String(v); if (/^[=+@\-\t\r]/.test(value)) value="'"+value; return `"${value.replaceAll('"','""')}"`;}).join(',')).join('\r\n'); extension = 'csv';
  }
  const url = URL.createObjectURL(new Blob([content], {type:extension === 'csv' ? 'text/csv;charset=utf-8' : 'application/json'}));
  const a = document.createElement('a'); a.href = url; a.download = `세계선교교회-추첨기록-${new Date().toLocaleDateString('sv-SE')}.${extension}`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
$('export').addEventListener('click', () => { try { download(); } catch (e) { notify(`기록을 내려받을 수 없습니다. ${e.message}`); } });
document.addEventListener('keydown', e => {
  if (e.repeat || e.altKey || e.ctrlKey || e.metaKey || e.target.closest('input,textarea,select,button,a,summary,[contenteditable=true]') || document.querySelector('dialog[open]')) return;
  const key = e.key.toLowerCase();
  if ([' ','enter','f',...MODES.map((_,i) => String(i+1))].includes(key)) e.preventDefault();
  if (key === ' ' && !$('draw').disabled && !state.pending) act({type:'draw'});
  if (key === 'enter' && !$('confirm').disabled) act({type:'confirm'});
  if (/^[1-5]$/.test(key) && !state.pending) act({type:'mode',mode:MODES[Number(key)-1]});
  if (key === 'f') {
    (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(() => notify('전체화면을 켤 수 없습니다. 브라우저의 F11을 사용해 주세요.'));
  }
});
async function setupOffline() {
  if (document.body.dataset.dev === 'true') { $('offline-status').textContent = '개발 미리보기'; return; }
  if (!('serviceWorker' in navigator)) { $('offline-status').textContent = '오프라인 저장 불가'; return; }
  try {
    let registration = await navigator.serviceWorker.getRegistration(root);
    if (!registration?.active) registration = await navigator.serviceWorker.register(`${root}sw.js`, {scope:root});
    else registration.update().catch(() => {});
    await Promise.race([navigator.serviceWorker.ready, new Promise((_, reject) => setTimeout(() => reject(new Error('준비 시간 초과')), 15000))]);
    const worker = registration.active;
    if (!worker) throw new Error('준비 중');
    const status = await new Promise((resolve, reject) => {
      const channel = new MessageChannel(); const timeout = setTimeout(() => reject(new Error('시간 초과')), 12000);
      channel.port1.onmessage = e => { clearTimeout(timeout); resolve(e.data); };
      worker.postMessage({type:'VERIFY_CACHE'}, [channel.port2]);
    });
    if (!status.ready) throw new Error('파일 저장 미완료');
    $('offline-status').textContent = '오프라인 준비 완료'; $('offline-status').classList.add('ready');
  } catch { $('offline-status').textContent = '오프라인 준비 미완료 · 연결 후 새로고침'; }
}
onStagePing(time => { stageLastSeen = time; progress(); });
subscribe(load); load(); setInterval(progress, 250); setupOffline();
