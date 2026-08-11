/* ============================================================
   WORKOUT SESSION: set entry, live barbell, timer, progression
   hints, PR detection + celebration
   ============================================================ */
function renderBarbellWrap(){
  const wrap = document.getElementById('barbellWrap');
  if(!wrap) return;
  wrap.innerHTML = plateIconsHtml(state.weightVal, {id:'liveBarbell'}) + `<div class="bb-weight-label tabular">${state.weightVal} كغ</div>`;
}

function startSession(exercises){
  state.sessionExercises = exercises;
  state.sessionSets = {};
  exercises.forEach(e=> state.sessionSets[e.id] = []);
  state.sessionActiveIdx = 0;
  state.sessionStartTime = Date.now();
  loadFieldsForActiveExercise();
  renderSessionTabs();
  renderPickedCard();
  renderProgressionHint();
  updateFieldDisplay();
  _lastPlateCount = decomposePlates(Math.max(0,(state.weightVal-20)/2)).length;
  renderSetChips();
  startSessionTimer();
  stopRestTimer();
  openSheet('sheetSets');
}

function activeSessionExercise(){ return state.sessionExercises[state.sessionActiveIdx]; }

function loadFieldsForActiveExercise(){
  const ex = activeSessionExercise();
  state.weightVal = ex.lastWeight || 0;
  state.repsVal = ex.lastReps || 0;
  state.activeField = 'weight';
}

function renderSessionTabs(){
  const wrap = document.getElementById('sessionTabsWrap');
  if(state.sessionExercises.length<2){ wrap.innerHTML=''; return; }
  wrap.innerHTML = `<div class="superset-tabs">
    ${state.sessionExercises.map((ex,i)=>`<div class="superset-tab${i===state.sessionActiveIdx?' active':''}" data-tab-idx="${i}">${escapeHtml(ex.name)} (${state.sessionSets[ex.id].length})</div>`).join('')}
  </div>`;
  wrap.querySelectorAll('[data-tab-idx]').forEach(el=>{
    el.addEventListener('click', ()=>{
      state.sessionActiveIdx = parseInt(el.getAttribute('data-tab-idx'),10);
      loadFieldsForActiveExercise();
      renderSessionTabs();
      renderPickedCard();
      renderProgressionHint();
      updateFieldDisplay();
      renderSetChips();
    });
  });
}

function renderPickedCard(){
  const ex = activeSessionExercise();
  document.getElementById('pickedExIcon').innerHTML = exAnimHtml(ex,'lg');
  document.getElementById('pickedExName').textContent = ex.name;
  document.getElementById('pickedExHint').textContent = ex.lastWeight ? `آخر مرة: ${ex.lastWeight} كغ × ${ex.lastReps}` : 'أول مرة تسجل هذا التمرين — بالتوفيق 💪';
}

function getProgressionSuggestion(ex){
  const sessions = [];
  Object.keys(appState.logs).sort().reverse().forEach(dateKey=>{
    (appState.logs[dateKey].workouts||[]).forEach(w=>{
      if(w.exerciseId===ex.id) sessions.push(w);
    });
  });
  if(sessions.length<2) return null;
  const repsOk = (w)=> w.sets.length>0 && w.sets.every(s=>s.reps>=10);
  const [s1,s2] = sessions;
  if(repsOk(s1) && repsOk(s2) && s1.sets[0].weight===s2.sets[0].weight && s1.sets[0].weight>0){
    return Math.round((s1.sets[0].weight + 2.5)*2)/2;
  }
  return null;
}

function renderProgressionHint(){
  const wrap = document.getElementById('progressionHintWrap');
  const ex = activeSessionExercise();
  const suggestion = getProgressionSuggestion(ex);
  if(!suggestion){ wrap.innerHTML=''; return; }
  wrap.innerHTML = `<div class="progression-hint" id="progressionHintBtn">
    <span class="ph-tx">💡 آخر مرتين ثابت على نفس الوزن — جرب ${suggestion} كغ هالمرة؟</span>
    <span class="ph-btn">استخدمه</span>
  </div>`;
  document.getElementById('progressionHintBtn').addEventListener('click', ()=>{
    state.weightVal = suggestion;
    state.activeField = 'weight';
    updateFieldDisplay();
  });
}

function startSessionTimer(){
  if(state.sessionTimerHandle) clearInterval(state.sessionTimerHandle);
  const tick = ()=>{
    const secs = Math.floor((Date.now()-state.sessionStartTime)/1000);
    const m = Math.floor(secs/60), s = secs%60;
    const el = document.getElementById('sessionTimer');
    if(el) el.textContent = `⏱ ${m}:${String(s).padStart(2,'0')}`;
  };
  tick();
  state.sessionTimerHandle = setInterval(tick, 1000);
}

function stopSessionTimer(){
  if(state.sessionTimerHandle){ clearInterval(state.sessionTimerHandle); state.sessionTimerHandle=null; }
}

/* ============================================================
   REST TIMER
   ============================================================ */
let restTimerHandle = null;
let restTimerRemaining = 90;
const REST_DEFAULT = 90;

function startRestTimer(seconds){
  restTimerRemaining = seconds != null ? seconds : REST_DEFAULT;
  const box = document.getElementById('restTimerBox');
  if(!box) return;
  box.classList.add('show');
  updateRestTimerDisplay();
  if(restTimerHandle) clearInterval(restTimerHandle);
  restTimerHandle = setInterval(()=>{
    restTimerRemaining--;
    if(restTimerRemaining<=0){
      clearInterval(restTimerHandle);
      restTimerHandle = null;
      updateRestTimerDisplay();
      vibrate([100,50,100]);
      showToast('⏱ خلصت الراحة، جاهز للجولة الجاية 💪');
      setTimeout(()=> box.classList.remove('show'), 1200);
      return;
    }
    updateRestTimerDisplay();
  }, 1000);
}
function updateRestTimerDisplay(){
  const el = document.getElementById('restTimerVal');
  if(!el) return;
  const m = Math.floor(Math.max(restTimerRemaining,0)/60);
  const s = Math.max(restTimerRemaining,0)%60;
  el.textContent = `${m}:${String(s).padStart(2,'0')}`;
}
function adjustRestTimer(delta){
  restTimerRemaining = Math.max(0, restTimerRemaining+delta);
  updateRestTimerDisplay();
}
function stopRestTimer(){
  if(restTimerHandle){ clearInterval(restTimerHandle); restTimerHandle=null; }
  const box = document.getElementById('restTimerBox');
  if(box) box.classList.remove('show');
}

function updateFieldDisplay(){
  document.getElementById('fieldWeightVal').textContent = state.weightVal;
  document.getElementById('fieldRepsVal').textContent = state.repsVal;
  document.getElementById('fieldWeightBtn').classList.toggle('active', state.activeField==='weight');
  document.getElementById('fieldRepsBtn').classList.toggle('active', state.activeField==='reps');
  renderBarbellWrap();
}

let _lastPlateCount = 0;

function keypadPress(k){
  let cur = state.activeField==='weight' ? state.weightVal : state.repsVal;
  cur = String(cur);
  if(cur==='0') cur = '';
  if(k==='clear'){ cur = '0'; }
  else if(k==='back'){ cur = cur.slice(0,-1); if(cur==='') cur='0'; }
  else{ cur += k; if(cur.length>4) cur = cur.slice(0,4); }
  const num = Math.max(0, parseInt(cur||'0',10));
  if(state.activeField==='weight') state.weightVal = num; else state.repsVal = num;
  updateFieldDisplay();
  if(state.activeField==='weight'){
    const plateCount = decomposePlates(Math.max(0,(num-20)/2)).length;
    if(plateCount > _lastPlateCount){
      const bb = document.getElementById('liveBarbell');
      if(bb){ bb.classList.remove('bounce'); void bb.offsetWidth; bb.classList.add('bounce'); }
    }
    _lastPlateCount = plateCount;
  }
}

function renderSetChips(){
  const wrap = document.getElementById('setChips');
  const ex = activeSessionExercise();
  const sets = state.sessionSets[ex.id];
  wrap.innerHTML = '';
  sets.forEach((s,idx)=>{
    const chip = document.createElement('div');
    chip.className = 'set-chip';
    chip.innerHTML = `<span>${idx+1}) ${s.weight} كغ × ${s.reps}</span>${plateIconsHtml(s.weight,{size:'sm',max:4})}<span class="x" data-rm="${idx}">✕</span>`;
    wrap.appendChild(chip);
  });
  wrap.querySelectorAll('[data-rm]').forEach(x=>{
    x.addEventListener('click', ()=>{
      const idx = parseInt(x.getAttribute('data-rm'),10);
      sets.splice(idx,1);
      renderSetChips();
      renderSessionTabs();
    });
  });
}

function computeVolume(sets){ return sets.reduce((s,x)=> s + x.weight*x.reps, 0); }

function checkAndApplyPR(ex, sets){
  const volume = computeVolume(sets);
  const maxSetWeight = Math.max(...sets.map(s=>s.weight));
  let isPR = false;
  if(maxSetWeight > (ex.prWeight||0)){
    ex.prWeight = maxSetWeight;
    const best = sets.find(s=>s.weight===maxSetWeight);
    ex.prReps = best.reps; ex.prDate = state.today;
    isPR = true;
  }
  if(volume > (ex.prVolume||0)){ ex.prVolume = volume; isPR = true; }
  return {isPR, volume};
}

function showPRCelebration(names){
  vibrate([60,40,60,40,120]);
  document.getElementById('prTitle').textContent = 'رقم قياسي جديد! 🎉';
  document.getElementById('prSub').textContent = names.join(' + ') + ' — استمر على هالمستوى';
  const overlay = document.getElementById('prOverlay');
  const card = document.getElementById('prCard');
  card.querySelectorAll('.pr-confetti').forEach(c=>c.remove());
  const colors = ['var(--protein)','var(--carb)','var(--fat)','var(--shoulder)','var(--biceps)'];
  for(let i=0;i<18;i++){
    const dot = document.createElement('div');
    dot.className = 'pr-confetti';
    dot.style.left = (Math.random()*90+5)+'%';
    dot.style.background = colors[i%colors.length];
    dot.style.animationDelay = (Math.random()*0.4)+'s';
    card.appendChild(dot);
  }
  overlay.classList.add('show');
}

/* ============================================================
   BIND EVENTS
   ============================================================ */

