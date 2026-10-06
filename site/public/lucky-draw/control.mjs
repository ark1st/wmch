import { candidates, MODES, pad } from './core.mjs';
import { KEY, read, dispatch, subscribe, onStagePing, resetDamaged } from './store.mjs';
import { unlockAudio, stopAudio, playDraw } from './audio.mjs';
const $ = id => document.getElementById(id);
const text = (id, value) => { if ($(id).textContent !== value) $(id).textContent = value; };
const root = document.body.dataset.root;
let state, lastRevision = -1, stageLastSeen = 0, working = false, damaged = false, dialogAction = null, dialogSnapshot = null, stageWindow;
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
  $('winner-count').textContent = winners.flatMap(r => r.numbers).filter(n => n >= state.rangeStart && n <= state.rangeEnd).length;
  const confirmedNumbers = new Set(winners.flatMap(r => r.numbers));
  $('excluded-count').textContent = state.excluded.filter(n => !confirmedNumbers.has(n)).length;
  $('history-count').textContent = `${winners.length}회`;
  $('sound').checked = state.sound;
  $('mode-description').textContent = modeDescriptions[state.mode];
  for (const view of ['idle','all','end']) $(`show-${view}`).setAttribute('aria-pressed', String(!state.pending && state.view === view));
  document.querySelectorAll('[data-mode]').forEach(el => { el.setAttribute('aria-pressed', String(el.dataset.mode === state.mode)); el.disabled = !!state.pending || working; });
  $('settings-fields').disabled = !!state.pending || working;
  for (const id of ['show-idle','show-all','show-end']) $(id).disabled = !!state.pending || working;
  if (lastRevision !== state.revision) {
    if (document.activeElement !== $('excluded')) $('excluded').value = state.excluded.join(', ');
    if (document.activeElement !== $('batch')) $('batch').value = state.batch;
    if (document.activeElement !== $('range-start')) $('range-start').value = state.rangeStart;
    if (document.activeElement !== $('range-end')) $('range-end').value = state.rangeEnd;
    renderHistory(); lastRevision = state.revision;
  }
  progress();
}
function progress() {
  const connected = Date.now() - stageLastSeen < 6500;
  $('stage-status').textContent = connected ? '무대 창 연결됨' : '이 화면에서 바로 추첨할 수 있습니다';
  $('stage-status').classList.toggle('ready', connected);
  if (!state || damaged) return;
  const pending = state.pending, busy = pending && Date.now() < pending.startedAt + pending.duration;
  const rounds = state.history.filter(r => r.status === 'confirmed').length;
  const remaining = candidates(state).length;
  $('draw').hidden = !!pending;
  $('draw').disabled = working || !!pending || !remaining;
  $('resolve-actions').hidden = !pending;
  $('confirm').disabled = working || !pending || busy;
  $('reroll').disabled = working || !pending || busy;
  $('reset').disabled = working || !!busy;
  $('round-label').textContent = `${rounds + 1}회 추첨`;
  if (busy) {
    text('draw-description', '번호를 공개하고 있습니다.');
    $('draw-hint').textContent = '번호 공개가 끝나면 결과를 확정해 주세요.';
  } else if (pending) {
    text('draw-description', pending.numbers.map(pad).join('   '));
    $('draw-hint').textContent = '당첨 확정 후 다음 추첨에서 자동으로 제외됩니다.';
  } else {
    text('draw-description', remaining ? `이번 추첨은 ${Math.min(remaining, state.batch)}명입니다.` : '모든 행운권의 추첨이 끝났습니다.');
    $('draw-hint').textContent = remaining < state.batch && remaining ? `남은 후보 ${remaining}명만 추첨합니다.` : '당첨 확정한 번호는 다음 추첨에서 제외됩니다.';
    $('draw').firstChild.textContent = !remaining ? '추첨 완료 ' : rounds ? '다음 추첨 ' : '추첨 시작 ';
  }
}
function renderHistory() {
  if (!state.history.length) {
    $('history').innerHTML = '<div class="empty-history"><p>아직 추첨 기록이 없습니다.</p><small>당첨을 확정하면 이곳에 기록됩니다.</small></div>'; return;
  }
  const roundLabels = new Map(); let number = 0;
  for (const r of state.history) if (r.status === 'confirmed') roundLabels.set(r.id, ++number);
  const rows = [...state.history].reverse().map(r => {
    const row = document.createElement('div'); row.className = `history-round ${r.status}`;
    const meta = document.createElement('div'), title = document.createElement('span'), time = document.createElement('time');
    title.className = 'round-name'; title.textContent = r.status === 'confirmed' ? `${roundLabels.get(r.id)}회` : '재추첨';
    time.dateTime = new Date(r.resolvedAt).toISOString(); time.textContent = new Date(r.resolvedAt).toLocaleTimeString('ko-KR', { hour12:false });
    meta.append(title, time);
    const numbers = document.createElement('div'); numbers.className = 'history-numbers'; numbers.textContent = r.numbers.map(pad).join(' ');
    row.append(meta, numbers);
    if (r.status === 'confirmed') {
      const button = document.createElement('button'); button.className = 'text-button'; button.textContent = '무대에 보기'; button.disabled = !!state.pending;
      button.addEventListener('click', () => act({ type:'view', view:'result', id:r.id })); row.append(button);
    } else { const label = document.createElement('span'); label.className = 'text-button'; label.textContent = '미확정'; row.append(label); }
    return row;
  });
  $('history').replaceChildren(...rows);
}
async function act(action) {
  if (working || damaged) return;
  working = true; notify(''); render();
  try {
    if (state.sound && ['draw','reroll'].includes(action.type)) {
      try { await unlockAudio(); } catch { notify('효과음을 재생할 수 없습니다. 추첨은 계속 진행합니다.'); }
    }
    state = await dispatch({ ...action, pendingId: action.pendingId ?? (action.type === 'confirm' ? state.pending?.id : undefined), reduced: reduced.matches });
    if (['draw','reroll'].includes(action.type) && state.sound) playDraw(state.pending);
    if (!state.sound) stopAudio();
    if (action.type === 'settings') notify('추첨 설정을 적용했습니다.');
  } catch (error) { notify(error.message); }
  finally { working = false; load(); }
}
function ask(type) {
  if (working || $('action-dialog').open) return;
  if (type === 'reroll' && (!state?.pending || Date.now() < state.pending.startedAt + state.pending.duration)) return;
  dialogAction = type;
  dialogSnapshot = { pendingId:state?.pending?.id, revision:state?.revision };
  $('dialog-title').textContent = type === 'reset' ? '모든 추첨 기록을 초기화할까요?' : '이번 결과를 다시 추첨할까요?';
  $('dialog-message').textContent = type === 'reset' ? '당첨 기록과 제외 번호가 삭제됩니다. 필요한 기록은 먼저 내려받아 주세요.' : '현재 번호는 당첨 확정되지 않으며 다시 후보에 포함됩니다. 이번 결과는 재추첨 기록으로 남습니다.';
  $('reset-label').hidden = type !== 'reset'; $('reset-word').value = '';
  $('dialog-accept').disabled = type === 'reset';
  $('dialog-accept').textContent = type === 'reset' ? '전체 초기화' : '다시 추첨';
  $('action-dialog').returnValue = ''; $('action-dialog').showModal();
}
$('action-dialog').addEventListener('close', async () => {
  if ($('action-dialog').returnValue !== 'accept') return;
  if (dialogAction === 'reset') {
    if ($('reset-word').value !== '초기화') return;
    if (damaged) {
      try { await resetDamaged(); location.reload(); } catch (error) { notify(error.message); }
    } else { stopAudio(); await act({type:'reset', revision:dialogSnapshot.revision}); }
  } else await act({ type:'reroll', pendingId:dialogSnapshot.pendingId });
});
$('reset-word').addEventListener('input', () => $('dialog-accept').disabled = $('reset-word').value !== '초기화');
$('draw').addEventListener('click', () => act({ type:'draw' }));
$('confirm').addEventListener('click', () => act({ type:'confirm' }));
$('reroll').addEventListener('click', () => ask('reroll'));
$('reset').addEventListener('click', () => ask('reset'));
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
for (const view of ['idle','all','end']) $(`show-${view}`).addEventListener('click', () => act({ type:'view', view }));
document.querySelectorAll('[data-mode]').forEach(el => el.addEventListener('click', () => act({ type:'mode', mode:el.dataset.mode })));
$('settings').addEventListener('submit', e => { e.preventDefault(); act({type:'settings', batch:$('batch').value, excluded:$('excluded').value, rangeStart:$('range-start').value, rangeEnd:$('range-end').value}); });
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
    const lines = [['회차','상태','번호1','번호2','번호3','번호4','번호5','연출','추첨 시각','확정 시각']];
    let round = 0;
    for (const r of state.history) lines.push([r.status === 'confirmed' ? ++round : '', r.status === 'confirmed' ? '확정' : '재추첨', ...Array.from({length:5}, (_,i) => r.numbers[i] ? pad(r.numbers[i]) : ''), r.mode, new Date(r.startedAt).toISOString(), new Date(r.resolvedAt).toISOString()]);
    if (state.pending) lines.push([round + 1,'확정 대기',...Array.from({length:5},(_,i) => state.pending.numbers[i] ? pad(state.pending.numbers[i]) : ''),state.pending.mode,new Date(state.pending.startedAt).toISOString(),'']);
    lines.push([],['현재 번호 구간',state.rangeStart,state.rangeEnd],['사전 제외',...state.excluded.map(pad)]);
    content = '\uFEFF' + lines.map(row => row.map(v => `"${String(v).replaceAll('"','""')}"`).join(',')).join('\r\n'); extension = 'csv';
  }
  const url = URL.createObjectURL(new Blob([content], {type:extension === 'csv' ? 'text/csv;charset=utf-8' : 'application/json'}));
  const a = document.createElement('a'); a.href = url; a.download = `세계선교교회-추첨기록-${new Date().toLocaleDateString('sv-SE')}.${extension}`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
$('export').addEventListener('click', () => { try { download(); } catch (e) { notify(`기록을 내려받을 수 없습니다. ${e.message}`); } });
document.addEventListener('keydown', e => {
  if (e.repeat || e.altKey || e.ctrlKey || e.metaKey || e.target.closest('input,textarea,select,button,[contenteditable=true]') || document.querySelector('dialog[open]')) return;
  const key = e.key.toLowerCase();
  if ([' ','enter','r','f',...MODES.map((_,i) => String(i+1))].includes(key)) e.preventDefault();
  if (key === ' ' && !$('draw').disabled && !state.pending) act({type:'draw'});
  if (key === 'enter' && !$('confirm').disabled) act({type:'confirm'});
  if (key === 'r' && !$('reroll').disabled) ask('reroll');
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
