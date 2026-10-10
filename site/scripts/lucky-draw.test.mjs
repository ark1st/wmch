import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { initialState, transition, validateState, candidates, parseExcluded, sample, randomBelow, MODES, DURATION, drawTiming, winnerNumbers, invalidNumbers, prizesRemaining, nextCount } from '../public/lucky-draw/core.mjs';
const change = (state, action, time = 10000) => transition(state, action, time, webcrypto);

test('all 250 default tickets can win once, with no duplicates across 50 rounds', () => {
  let state = {...initialState(),prizeTotal:250}; const drawn = [];
  for (let round = 0; round < 50; round++) {
    const time = 10000 + round * 10000;
    state = change(state, {type:'draw'}, time);
    assert.equal(state.pending.numbers.length, 5);
    drawn.push(...state.pending.numbers);
    state = change(state, {type:'confirm'}, time + DURATION);
  }
  assert.deepEqual([...drawn].sort((a,b)=>a-b),Array.from({length:250},(_,i)=>i+1));
  assert.equal(candidates(state).length, 0);
  assert.throws(() => change(state,{type:'draw'},500000), /소진/);
});

test('excluded tickets never appear; the last round uses remaining tickets', () => {
  let state = change(initialState(), {type:'settings', rangeEnd:200, excluded:'1-193, 200', batch:5});
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
    assert.equal(candidates(state).length,250);
    assert.throws(() => change(state,{type:'draw'}), /먼저 확정/);
    assert.throws(() => change(state,{type:'settings',excluded:'10',batch:2}), /먼저 확정/);
    assert.throws(() => change(state,{type:'confirm'}), /공개가 끝난/);
    assert.throws(() => change(state,{type:'reset'}), /공개 중/);
  }
});

test('invalid tickets do not consume prizes and can never be drawn again', () => {
  let state = change(initialState(),{type:'draw'},10000);
  const first = structuredClone(state.pending);
  assert.throws(()=>change(state,{type:'reroll',pendingId:first.id},17000));
  state = change(state,{type:'mark-invalid',number:first.numbers[0],invalid:true,pendingId:first.id},13000);
  state = change(state,{type:'confirm',pendingId:first.id},13000);
  assert.deepEqual(state.history[0].numbers,first.numbers);
  assert.equal(state.history[0].status,'confirmed');
  assert.equal(winnerNumbers(state).length,4);
  assert.equal(prizesRemaining(state),71);
  assert.equal(candidates(state).length,245);
  state = change(state,{type:'draw'},17000);
  assert.equal(state.pending.numbers.length,5);
  assert(state.pending.numbers.every(n=>!first.numbers.includes(n)));
  assert.notEqual(state.pending.id,first.id);
  assert.throws(() => change(state,{type:'confirm',pendingId:first.id},24000),/변경/);
  state = change(state,{type:'confirm'},24000);
  assert.equal(winnerNumbers(state).length,9);
  assert.equal(candidates(state).length,240);
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
  for (const value of ['0','251','-1','2.5','17-15','1-1000','1;2','word']) assert.throws(() => parseExcluded(value));
});

test('unbiased RNG rejects out-of-range uint32 and sampler does not modify pool', () => {
  const values = [0xffffffff, 7]; let draws=0;
  assert.equal(randomBelow(10,{getRandomValues(a){a[0]=values[draws++];return a;}}),7);
  assert.equal(draws,2);
  const pool=[1,2,3,4,5]; assert.equal(sample(pool,5,webcrypto).length,5); assert.deepEqual(pool,[1,2,3,4,5]);
  assert.throws(() => sample([1,1],2,webcrypto));
});

test('damaged records fail closed instead of silently allowing repeat winners', () => {
  assert.throws(() => validateState({...initialState(),version:3}));
  assert.throws(() => validateState({...initialState(),excluded:[251]}));
  let state=change(initialState(),{type:'draw'},10000);
  state=change(state,{type:'confirm'},17000);
  const duplicate={...state.history[0],id:webcrypto.randomUUID()};
  assert.throws(() => validateState({...state,history:[...state.history,duplicate]}));
});

test('same entropy yields the same outcome for every presentation mode', () => {
  let expected;
  for (const mode of ['random',...MODES]) {
    let i=0; const rng={getRandomValues(a){a[0]=++i*173;return a;},randomUUID:()=>mode};
    const state=transition({...initialState(),mode},{type:'draw'},10000,rng);
    expected ??= state.pending.numbers;
    assert.deepEqual(state.pending.numbers,expected);
  }
});

test('automatic rotation covers every mode once per cycle without boundary repeats', () => {
  let state = {...initialState(),prizeTotal:200};
  const modes = [];
  assert.equal(state.mode,'random');
  // At each new cycle, entropy would pick the previous mode if the boundary guard were missing.
  let calls = 0;
  const rng = {getRandomValues(a){a[0]=++calls%6 === 0 && !state.modeRotation.length ? Math.max(0,MODES.indexOf(modes.at(-1))) : 0;return a;},randomUUID:()=>`round-${modes.length}`};
  for(let i=0;i<40;i++) {
    state = transition(state,{type:'draw'},10000+i*4000,rng);
    modes.push(state.pending.mode);
    if(i) assert.notEqual(modes[i],modes[i-1]);
    const restored = validateState(JSON.parse(JSON.stringify(state)));
    assert.deepEqual(restored.pending,state.pending);
    assert.deepEqual(restored.modeRotation,state.modeRotation);
    state = transition(restored,{type:'confirm'},13000+i*4000,rng);
  }
  for(let i=0;i<modes.length;i+=MODES.length) assert.deepEqual([...modes.slice(i,i+MODES.length)].sort(),[...MODES].sort());
});

test('a legacy fixed-mode record enables random rotation but preserves its pending draw', () => {
  const legacy = change({...initialState(),mode:'drum'},{type:'draw'},10000);
  delete legacy.modeRotation;
  const saved = structuredClone(legacy.pending);
  const migrated = validateState(legacy);
  assert.equal(migrated.mode,'random');
  assert.deepEqual(migrated.pending,saved);
  let state = change(migrated,{type:'confirm'},13000);
  state = change(state,{type:'draw'},14000);
  assert.notEqual(state.pending.mode,'drum');
  assert(state.pending.numbers.every(n=>!saved.numbers.includes(n)));
});

test('manual mode remains fixed, returning to automatic avoids the last manual presentation', () => {
  let state = change(initialState(),{type:'mode',mode:'envelope'});
  for(let i=0;i<2;i++) {
    state=change(state,{type:'draw'},10000+i*4000);
    assert.equal(state.pending.mode,'envelope');
    assert.throws(()=>change(state,{type:'mode',mode:'random'}),/먼저 확정/);
    state=change(state,{type:'confirm'},13000+i*4000);
  }
  state=change(state,{type:'mode',mode:'random'});
  state=change(state,{type:'draw'},20000);
  assert.notEqual(state.pending.mode,'envelope');
  assert.throws(()=>validateState({...state,modeRotation:['ticket','ticket']}));
  assert.throws(()=>validateState({...state,modeRotation:['unknown']}));
  assert.throws(()=>validateState({...state,pending:{...state.pending,mode:'random'}}));
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
  assert.equal(candidates(confirmed).length,245);
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
  let state = change({...initialState(),rangeEnd:200},{type:'draw'},10000);
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
  const legacy = change({...initialState(),rangeEnd:200},{type:'draw'},10000);
  legacy.version = 1;
  delete legacy.rangeStart; delete legacy.rangeEnd;
  delete legacy.pending.rangeStart; delete legacy.pending.rangeEnd;
  legacy.pending.duration=6800;
  const migrated = validateState(JSON.parse(JSON.stringify(legacy)));
  assert.equal(migrated.rangeStart,1);
  assert.equal(migrated.rangeEnd,200);
  assert.deepEqual(migrated.pending.numbers,legacy.pending.numbers);
  assert.equal(migrated.version,2);
  assert.deepEqual(migrated.pending.invalid,[]);
  assert.equal(change(migrated,{type:'confirm'},16800).history.length,1);
  assert.throws(()=>validateState({...legacy,rangeStart:1}));
});

test('75 prizes: invalid results keep normal batches, and only the final remainder reduces the batch', () => {
  let state=initialState(), time=10000;
  const seen=new Set();
  const run=(invalidCount,expectedBatch)=>{
    state=change(state,{type:'draw'},time);
    assert.equal(state.pending.numbers.length,expectedBatch);
    for(const n of state.pending.numbers){assert(!seen.has(n));seen.add(n);}
    for(const n of state.pending.numbers.slice(0,invalidCount)) state=change(state,{type:'mark-invalid',number:n,invalid:true},time+DURATION);
    state=change(state,{type:'confirm'},time+DURATION); time+=4000;
  };
  run(1,5); assert.equal(winnerNumbers(state).length,4);
  run(0,5); assert.equal(winnerNumbers(state).length,9);
  for(let i=0;i<12;i++) run(0,5);
  assert.equal(winnerNumbers(state).length,69);
  run(2,5); assert.equal(winnerNumbers(state).length,72);
  assert.equal(prizesRemaining(state),3); assert.equal(nextCount(state),3);
  run(0,3);
  assert.equal(winnerNumbers(state).length,75); assert.equal(invalidNumbers(state).length,3);
  assert.equal(seen.size,78); assert.equal(nextCount(state),0);
  assert.throws(()=>change(state,{type:'draw'},time),/모든 상품/);
});

test('after 70 prizes, a five-number draw with two invalids leaves exactly two prizes', () => {
  let state=initialState();
  for(let i=0;i<14;i++){state=change(state,{type:'draw'},10000+i*4000);state=change(state,{type:'confirm'},13000+i*4000);}
  state=change(state,{type:'draw'},70000);
  for(const n of state.pending.numbers.slice(0,2)) state=change(state,{type:'mark-invalid',number:n,invalid:true},73000);
  state=change(state,{type:'confirm'},73000);
  assert.equal(winnerNumbers(state).length,73); assert.equal(prizesRemaining(state),2);
  state=change(state,{type:'draw'},74000); assert.equal(state.pending.numbers.length,2);
});

test('all-invalid rounds persist, exclude every number, and do not trigger a replacement draw', () => {
  let state=change(initialState(),{type:'draw'},10000); const numbers=[...state.pending.numbers];
  assert.throws(()=>change(state,{type:'mark-invalid',number:numbers[0],invalid:true},12000),/공개가 끝난/);
  assert.throws(()=>change(state,{type:'mark-invalid',number:9999,invalid:true},13000));
  for(const number of numbers) state=change(state,{type:'mark-invalid',number,invalid:true},13000);
  state=validateState(JSON.parse(JSON.stringify(state)));
  assert.equal(state.pending.invalid.length,5);
  state=change(state,{type:'confirm'},13000);
  assert.equal(state.pending,null); assert.equal(prizesRemaining(state),75);
  assert(numbers.every(n=>!candidates(state).includes(n)));
  assert.equal(nextCount(state),5);
});

test('page changes apply five/three presets and share a single no-repeat pool and prize total', () => {
  let state=initialState(); const seen=[];
  assert.deepEqual(state.programs.slice(0,5).map(p=>[p.batch,p.hosts,p.planned]),[[5,3,15],[5,4,20],[3,3,9],[3,5,15],[3,2,6]]);
  for(let i=0;i<6;i++) {
    state=change(state,{type:'program',id:state.programs[i].id});
    state=change(state,{type:'draw'},10000+i*4000);
    assert.equal(state.pending.numbers.length,i>=2&&i<=4?3:5);
    assert.equal(state.pending.programId,state.programs[i].id);
    seen.push(...state.pending.numbers);
    assert.throws(()=>change(state,{type:'program',id:'page-1'}),/먼저 확정/);
    state=change(state,{type:'confirm'},13000+i*4000);
  }
  assert.equal(seen.length,new Set(seen).size);
  assert.equal(winnerNumbers(state,'page-3').length,3);
  assert.equal(prizesRemaining(state),75-seen.length);
  const changed=structuredClone(state.programs);changed[2].title='진행자 수정';changed[2].batch=4;changed[2].planned=12;
  state=change(state,{type:'program-settings',programs:changed,revision:state.revision});
  assert.equal(state.history[2].programTitle,'뚜뚜빠빠');
  state=change(state,{type:'program',id:'page-3'});assert.equal(state.batch,4);
});

test('correcting a confirmed invalid ticket changes counts without returning it to the pool', () => {
  let state=change(initialState(),{type:'draw'},10000);state=change(state,{type:'confirm'},13000);
  const round=state.history[0],number=round.numbers[0];
  assert.throws(()=>change(state,{type:'amend-invalid',id:round.id,number,invalid:true,revision:0}));
  state=change(state,{type:'amend-invalid',id:round.id,number,invalid:true,revision:state.revision});
  assert.equal(prizesRemaining(state),71);assert.equal(winnerNumbers(state).length,4);assert(!candidates(state).includes(number));
  state=change(state,{type:'settings',batch:5,excluded:'',prizeTotal:4});
  assert.throws(()=>change(state,{type:'amend-invalid',id:round.id,number,invalid:false,revision:state.revision}),/상품 수/);
});

test('old discarded records stay readable but are excluded from all future draws', () => {
  const oldRound={id:'old',numbers:[1,2,3,4,5],mode:'ticket',rangeStart:1,rangeEnd:200,startedAt:10000,duration:6800,status:'discarded',resolvedAt:16800};
  const legacy={version:1,revision:2,mode:'ticket',batch:5,rangeStart:1,rangeEnd:200,excluded:[],sound:false,pending:{...oldRound,id:'pending',numbers:[1,6,7,8,9],status:undefined,startedAt:20000},history:[oldRound],view:'result',shownId:null};
  let state=validateState(legacy);
  assert.deepEqual(state.pending.numbers,[1,6,7,8,9]);
  state=change(state,{type:'confirm'},26800);
  assert([1,2,3,4,5,6,7,8,9].every(n=>!candidates(state).includes(n)));
  assert.equal(winnerNumbers(state).length,5);
});
