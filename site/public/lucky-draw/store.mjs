import { initialState, validateState, transition } from './core.mjs';
export const KEY = 'wmch-lucky-draw-47-v1';
const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(KEY) : null;
export function read() {
  const raw = localStorage.getItem(KEY);
  return raw ? validateState(JSON.parse(raw)) : initialState();
}
export function subscribe(listener) {
  const receive = () => listener();
  channel?.addEventListener('message', receive);
  addEventListener('storage', e => { if (e.key === KEY || e.key === null) receive(); });
}
export async function dispatch(action) {
  if (!navigator.locks) throw new Error('Chrome에서 HTTPS 또는 localhost 주소로 열어 주세요.');
  return navigator.locks.request(KEY, () => {
    const next = transition(read(), action);
    // Persist before notifying the stage. A storage failure never starts a draw.
    localStorage.setItem(KEY, JSON.stringify(next));
    channel?.postMessage({ revision: next.revision });
    return next;
  });
}
export async function resetDamaged() {
  return navigator.locks.request(KEY, () => {
    localStorage.setItem(KEY, JSON.stringify(initialState()));
    channel?.postMessage({ reset: true });
  });
}
export function pingStage() { channel?.postMessage({ stageAlive: Date.now() }); }
export function onStagePing(listener) { channel?.addEventListener('message', e => { if (e.data.stageAlive) listener(e.data.stageAlive); }); }
