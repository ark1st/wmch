import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { initialState, transition, validateState, candidates, parseExcluded, sample, randomBelow, MODES, DURATION, drawTiming } from '../public/lucky-draw/core.mjs';
const change = (state, action, time = 10000) => transition(state, action, time, webcrypto);

test('all 200 tickets can win once, with no duplicates across 40 rounds', () => {
  let state = initialState(); const drawn = [];
  for (let round = 0; round < 40; round++) {
    const time = 10000 + round * 10000;
    state = change(state, {type:'draw'}, time);
    assert.equal(state.pending.numbers.length, 5);
    drawn.push(...state.pending.numbers);
    state = change(state, {type:'confirm'}, time + DURATION);
  }
  assert.equal(new Set(drawn).size, 200);
  assert.equal(candidates(state).length, 0);
  assert.throws(() => change(state,{type:'draw'},500000), /소진/);
});

test('excluded tickets never appear; the last round uses remaining tickets', () => {
  let state = change(initialState(), {type:'settings', excluded:'1-193, 200', batch:5});
  state = change(state,{type:'draw'}, 10000);
  assert.equal(state.pending.numbers.length, 5);
  assert(state.pending.numbers.every(n => n >= 194 && n <= 199));
  state = change(state,{type:'confirm'}, 17000);
  state = change(state,{type:'draw'}, 20000);
  assert.equal(state.pending.numbers.length,1);
  state = change(state,{type:'confirm'}, 27000);
  assert.equal(candidates(state).length,0);
});

test('all modes use the same sampler and pending tickets stay eligible until confirmation', () => {
  for (const mode of MODES) {
    let state = change(initialState(), {type:'mode',mode});
    state = change(state,{type:'draw'});
    assert.equal(state.pending.mode,mode);
    assert.equal(candidates(state).length,200);
    assert.throws(() => change(state,{type:'draw'}), /먼저 확정/);
    assert.throws(() => change(state,{type:'settings',excluded:'10',batch:2}), /먼저 확정/);
    assert.throws(() => change(state,{type:'confirm'}), /공개가 끝난/);
    assert.throws(() => change(state,{type:'reset'}), /공개 중/);
  }
});

test('reroll preserves the discarded result and only excludes confirmed winners', () => {
  let state = change(initialState(),{type:'draw'},10000);
  const first = structuredClone(state.pending);
  state = change(state,{type:'reroll',pendingId:first.id},17000);
  assert.deepEqual(state.history[0].numbers,first.numbers);
  assert.equal(state.history[0].status,'discarded');
  assert.equal(candidates(state).length,200);
  assert.notEqual(state.pending.id,first.id);
  assert.throws(() => change(state,{type:'confirm',pendingId:first.id},24000),/변경/);
  state = change(state,{type:'confirm'},24000);
  assert.equal(candidates(state).length,195);
});

test('persisted pending results resume unchanged; confirm is idempotently guarded', () => {
  let state = change(initialState(),{type:'draw',reduced:true});
  const saved = JSON.stringify(state);
  assert.equal(validateState(JSON.parse(saved)).pending.duration,1400);
  state = change(JSON.parse(saved),{type:'confirm'},11400);
  assert.equal(state.history.length,1);
  assert.throws(() => change(state,{type:'confirm'},12000),/공개が|공개가/);
  assert.throws(() => change(state,{type:'reset',revision:0},12000),/기록이 변경/);
});

test('exclusion parser validates whole input and deduplicates ranges', () => {
  assert.deepEqual(parseExcluded('001, 13 15-17, 16'),[1,13,15,16,17]);
  for (const value of ['0','201','-1','2.5','17-15','1-1000','1;2','word']) assert.throws(() => parseExcluded(value));
});

test('unbiased RNG rejects out-of-range uint32 and sampler does not modify pool', () => {
  const values = [0xffffffff, 7]; let draws=0;
  assert.equal(randomBelow(10,{getRandomValues(a){a[0]=values[draws++];return a;}}),7);
  assert.equal(draws,2);
  const pool=[1,2,3,4,5]; assert.equal(sample(pool,5,webcrypto).length,5); assert.deepEqual(pool,[1,2,3,4,5]);
  assert.throws(() => sample([1,1],2,webcrypto));
});

test('damaged records fail closed instead of silently allowing repeat winners', () => {
  assert.throws(() => validateState({...initialState(),version:2}));
  assert.throws(() => validateState({...initialState(),excluded:[201]}));
  let state=change(initialState(),{type:'draw'},10000);
  state=change(state,{type:'confirm'},17000);
  const duplicate={...state.history[0],id:webcrypto.randomUUID()};
  assert.throws(() => validateState({...state,history:[...state.history,duplicate]}));
});

test('same entropy yields the same outcome for every presentation mode', () => {
  let expected;
  for (const mode of MODES) {
    let i=0; const rng={getRandomValues(a){a[0]=++i*173;return a;},randomUUID:()=>mode};
    const state=transition({...initialState(),mode},{type:'draw'},10000,rng);
    expected ??= state.pending.numbers;
    assert.deepEqual(state.pending.numbers,expected);
  }
});

test('new draws finish in three seconds with all reveals before confirmation', () => {
  for (const mode of MODES) {
    const state = change({...initialState(),mode},{type:'draw'},10000);
    assert.equal(state.pending.duration,3000);
    const timing = drawTiming(state.pending.duration);
    const lastReveal = timing.revealStart + (state.pending.numbers.length - 1) * timing.stagger;
    assert(lastReveal + 300 < 3000, 'leave time for the final number to settle');
    assert(timing.gridExit + 300 < 3000, 'grid must show the winner row before confirmation');
    assert.throws(() => change(state,{type:'confirm'},12999),/공개가 끝난/);
    assert.equal(change(state,{type:'confirm'},13000).history.length,1);
  }
});

test('older 6.8-second rounds remain readable and keep their confirmation deadline', () => {
  const state = change(initialState(),{type:'draw'},10000);
  state.pending.duration = 6800;
  const saved = JSON.parse(JSON.stringify(state));
  assert.deepEqual(validateState(saved).pending.numbers,state.pending.numbers);
  assert.throws(() => change(saved,{type:'confirm'},16799),/공개가 끝난/);
  const confirmed = change(saved,{type:'confirm'},16800);
  assert.equal(validateState(confirmed).history[0].duration,6800);
  assert.equal(candidates(confirmed).length,195);
  const next = change(confirmed,{type:'draw'},17000);
  assert.equal(next.pending.duration,3000);
  assert.equal(drawTiming(6800).revealStart,4200);
});

test('every mode exhausts a custom four-digit range without exclusions or duplicates', () => {
  for (const mode of MODES) {
    let state = change({...initialState(),mode},{type:'settings',rangeStart:1001,rangeEnd:1012,batch:5,excluded:'1005-1007'});
    const drawn = [];
    for (let i=0; i<2; i++) {
      state = change(state,{type:'draw'},10000+i*4000);
      assert.equal(state.pending.rangeStart,1001);
      assert.equal(state.pending.rangeEnd,1012);
      drawn.push(...state.pending.numbers);
      state = change(state,{type:'confirm'},13000+i*4000);
    }
    assert.deepEqual(drawn.sort((a,b)=>a-b),[1001,1002,1003,1004,1008,1009,1010,1011,1012]);
    assert.equal(candidates(state).length,0);
  }
});

test('changing ranges preserves past winners and exclusions remain range-bound', () => {
  let state = change(initialState(),{type:'draw'},10000);
  state = change(state,{type:'confirm'},13000);
  const winners = [...state.history[0].numbers];
  state = change(state,{type:'settings',rangeStart:9999,rangeEnd:9999,batch:5,excluded:''});
  assert.deepEqual(candidates(state),[9999]);
  state = change(state,{type:'draw'},20000);
  assert.deepEqual(state.pending.numbers,[9999]);
  assert.throws(()=>change(state,{type:'settings',rangeStart:1,rangeEnd:200,batch:5,excluded:''}),/먼저 확정/);
  state = change(state,{type:'confirm'},23000);
  state = change(state,{type:'settings',rangeStart:1,rangeEnd:200,batch:5,excluded:''});
  assert.equal(state.history.length,2);
  assert.equal(candidates(state).length,195);
  assert(winners.every(n=>!candidates(state).includes(n)));
  assert.throws(()=>parseExcluded('999',1001,1100),/1001–1100/);
  for (const [rangeStart,rangeEnd] of [[0,200],[20,10],[1,10000],[1.5,200],[1,NaN]]) {
    assert.throws(()=>change(state,{type:'settings',rangeStart,rangeEnd,batch:5,excluded:''}),/구간/);
  }
});

test('records without range fields migrate to 1-200 without losing the pending draw', () => {
  const legacy = change(initialState(),{type:'draw'},10000);
  delete legacy.rangeStart; delete legacy.rangeEnd;
  delete legacy.pending.rangeStart; delete legacy.pending.rangeEnd;
  legacy.pending.duration=6800;
  const migrated = validateState(JSON.parse(JSON.stringify(legacy)));
  assert.equal(migrated.rangeStart,1);
  assert.equal(migrated.rangeEnd,200);
  assert.deepEqual(migrated.pending,legacy.pending);
  assert.equal(change(migrated,{type:'confirm'},16800).history.length,1);
  assert.throws(()=>validateState({...legacy,rangeStart:1}));
});
