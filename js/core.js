/* ============================================================
   CORE: constants, storage, cloud sync, defaults, shared utils
   Loaded first — everything else depends on this file.
   ============================================================ */
function uid(){ return Date.now().toString(36) + Math.random().toString(36).slice(2,7); }

const LOCAL_KEY = 'miqyas_state_v1';

const SYNC_CFG_KEY = 'miqyas_sync_cfg_v1';

let appState = null;

let cloudDoc = null;

let cloudUnsub = null;

function loadLocalState(){
  try{
    const raw = localStorage.getItem(LOCAL_KEY);
    return raw ? JSON.parse(raw) : null;
  }catch(e){ return null; }
}

function saveLocalOnly(){
  try{ localStorage.setItem(LOCAL_KEY, JSON.stringify(appState)); }
  catch(e){ console.error('local save failed', e); }
}

function persist(){
  appState.updatedAt = Date.now();
  saveLocalOnly();
  if(cloudDoc){
    cloudDoc.set(appState).catch(e=> console.error('cloud push failed', e));
  }
}

function defaultAppState(){
  return { library:{foods:defaultFoods(), exercises:defaultExercises()}, goals:defaultGoals(), plan:null, logs:{}, bodyWeights:{}, updatedAt:0 };
}

function rebindFromAppState(){
  state.library = appState.library;
  state.goals = appState.goals;
  state.plan = appState.plan;
  state.selectedPresetType = state.plan.type || 'upper_lower_4';
  if(!appState.logs[state.today]) appState.logs[state.today] = {meals:[], workouts:[]};
  state.log = appState.logs[state.today];
  if(!appState.bodyWeights) appState.bodyWeights = {};
}

function getSyncConfig(){
  try{ const raw = localStorage.getItem(SYNC_CFG_KEY); return raw ? JSON.parse(raw) : null; }
  catch(e){ return null; }
}

function setSyncConfig(cfg){ localStorage.setItem(SYNC_CFG_KEY, JSON.stringify(cfg)); }

function clearSyncConfig(){ localStorage.removeItem(SYNC_CFG_KEY); }

function loadScript(src){
  return new Promise((resolve, reject)=>{
    const s = document.createElement('script');
    s.src = src; s.onload = ()=>resolve(); s.onerror = ()=>reject(new Error('فشل تحميل '+src));
    document.head.appendChild(s);
  });
}

async function ensureFirebaseLoaded(){
  if(window.firebase && window.firebase.firestore) return;
  await loadScript('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
  await loadScript('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore-compat.js');
}

function parseFirebaseConfigInput(raw){
  let txt = (raw||'').trim();
  const m = txt.match(/\{[\s\S]*\}/);
  if(m) txt = m[0];
  try{ return JSON.parse(txt); }catch(e){}
  try{ const fn = new Function('return (' + txt + ')'); return fn(); }
  catch(e){ return null; }
}

async function connectCloud(cfg){
  try{
    await ensureFirebaseLoaded();
    let app;
    try{ app = firebase.app('miqyasApp'); }
    catch(e){ app = firebase.initializeApp(cfg.firebaseConfig, 'miqyasApp'); }
    const db = firebase.firestore(app);
    cloudDoc = db.collection('miqyas_sync').doc(cfg.syncCode);
    return true;
  }catch(e){ console.error('firebase connect failed', e); cloudDoc = null; return false; }
}

function subscribeCloud(){
  if(cloudUnsub){ cloudUnsub(); cloudUnsub = null; }
  if(!cloudDoc) return;
  cloudUnsub = cloudDoc.onSnapshot(snap=>{
    if(!snap.exists) return;
    const cloudState = snap.data();
    if((cloudState.updatedAt||0) > (appState.updatedAt||0)){
      appState = cloudState;
      saveLocalOnly();
      rebindFromAppState();
      renderAll();
      showToast('تم التحديث من جهاز ثاني 🔄');
    }
  }, err=> console.error('cloud listen error', err));
}

/* ============================================================
   DEFAULT LIBRARY
   ============================================================ */

function defaultFoods(){
  const mk = (name,category,calories,protein,carbs,fat)=>({id:uid(),name,category,calories,protein,carbs,fat,favorite:false,usageCount:0});
  return [
    mk('بيض مسلوق (٢ حبة)','فطور',140,12,1,10),
    mk('شوفان بالحليب','فطور',260,10,42,6),
    mk('جبن قريش + خبز أسمر','فطور',230,18,28,6),
    mk('زبادي يوناني بالعسل','فطور',180,15,20,4),
    mk('صدر دجاج مشوي (١٥٠غ)','غدا',250,40,0,8),
    mk('رز بسمتي مطبوخ (كوب)','غدا',205,4,45,0.5),
    mk('سلطة خضار بزيت زيتون','غدا',120,2,8,9),
    mk('لحم بقري مشوي (١٥٠غ)','غدا',320,38,0,18),
    mk('سمك مشوي (١٥٠غ)','عشا',210,36,0,6),
    mk('شوربة عدس','عشا',150,9,22,3),
    mk('لبنة + خبز أسمر','عشا',220,10,20,11),
    mk('تمر (٣ حبات)','سناك',70,0.5,18,0),
    mk('لوز (١٠ حبات)','سناك',70,2.5,2.5,6),
    mk('موزة','سناك',105,1.3,27,0.4),
    mk('بروتين شيك','سناك',130,25,4,2),
  ];
}

function defaultExercises(){
  const mk = (name,group,movementType)=>({id:uid(),name,group,movementType,favorite:false,usageCount:0,lastWeight:0,lastReps:0,prWeight:0,prReps:0,prVolume:0,prDate:null});
  return [
    mk('بنش برس','صدر','press'), mk('ضغط صدر بالدمبل','صدر','press'), mk('بينش مائل','صدر','press'),
    mk('سحب أمامي','ظهر','pull'), mk('بار عريض','ظهر','pull'), mk('تجديف بالبار','ظهر','pull'),
    mk('سكوات','أرجل','squat'), mk('لنجز','أرجل','squat'), mk('ضغط أرجل','أرجل','squat'),
    mk('ضغط أكتاف','أكتاف','press'), mk('رفرفة جانبية','أكتاف','raise'),
    mk('كيرل بار','بايسبس','curl'), mk('كيرل دمبل تبادلي','بايسبس','curl'),
    mk('بوش داون','ترايسبس','press'), mk('ديبس','ترايسبس','press'),
    mk('كرنش','بطن','core'), mk('بلانك','بطن','core'), mk('رفع أرجل معلق','بطن','core'),
  ];
}

function defaultGoals(){ return {calories:2200, protein:150, carbs:220, fat:70}; }

/* ============================================================
   MUSCLE GROUP COLORS + WEEKLY SPLIT PRESETS
   ============================================================ */

const GROUP_COLOR_VAR = {
  'صدر':{solid:'var(--protein)', soft:'var(--protein-soft)'},
  'ظهر':{solid:'var(--carb)', soft:'var(--carb-soft)'},
  'أرجل':{solid:'var(--fat)', soft:'var(--fat-soft)'},
  'أكتاف':{solid:'var(--shoulder)', soft:'var(--shoulder-soft)'},
  'بايسبس':{solid:'var(--biceps)', soft:'var(--biceps-soft)'},
  'ترايسبس':{solid:'var(--triceps)', soft:'var(--triceps-soft)'},
  'بطن':{solid:'var(--abs)', soft:'var(--abs-soft)'},
};

const WARMUP_TEXT = {
  'صدر':'تدوير أكتاف + ٢ جولة تسخين بوزن خفيف',
  'ظهر':'تعليق بسيط على البار + سحب خفيف للإحماء',
  'أرجل':'تدوير ركب وحوض + سكوات فاضي ١٥ مرة',
  'أكتاف':'تدوير أذرع + رفرفة خفيفة بدون وزن',
  'بايسبس':'تمديد وتقصير الساعد + جولة كيرل خفيفة',
  'ترايسبس':'تمديد الكتف للخلف + جولة بوش داون خفيفة',
  'بطن':'تنفس عميق + بلانك ٢٠ ثانية',
};

function warmupHintFor(groups){
  const uniq = [...new Set(groups)];
  if(uniq.length===0) return '';
  return uniq.slice(0,2).map(g=> WARMUP_TEXT[g] || '').filter(Boolean).join(' · ');
}

const SPLIT_PRESETS = {
  full_body_3: {
    label:'فل بودي', sub:'٣ أيام/أسبوع — مناسب للمبتدئين',
    days:{0:['صدر','ظهر','أرجل','أكتاف','بطن'], 2:['صدر','ظهر','أرجل','أكتاف','بطن'], 4:['صدر','ظهر','أرجل','أكتاف','بطن']}
  },
  upper_lower_4: {
    label:'علوي / سفلي', sub:'٤ أيام/أسبوع — توازن جيد',
    days:{0:['صدر','ظهر','أكتاف','بايسبس','ترايسبس'], 1:['أرجل','أرجل','بطن'], 3:['صدر','ظهر','أكتاف','بايسبس','ترايسبس'], 4:['أرجل','أرجل','بطن']}
  },
  ppl_6: {
    label:'دفع - سحب - أرجل', sub:'٦ أيام/أسبوع — مكثف',
    days:{0:['صدر','صدر','أكتاف','ترايسبس'], 1:['ظهر','ظهر','بايسبس'], 2:['أرجل','أرجل','بطن'], 3:['صدر','صدر','أكتاف','ترايسبس'], 4:['ظهر','ظهر','بايسبس'], 5:['أرجل','أرجل','بطن']}
  },
  bro_split_5:{
    label:'تقسيم عضلة يومياً', sub:'٥ أيام/أسبوع — تركيز عالي',
    days:{0:['صدر','صدر','صدر'], 1:['ظهر','ظهر','ظهر'], 2:['أرجل','أرجل','أرجل'], 3:['أكتاف','أكتاف','بطن'], 4:['بايسبس','بايسبس','ترايسبس','ترايسبس']}
  }
};

const ORDERED_DAYS = [6,0,1,2,3,4,5];

const DAY_LABELS = {6:'سبت',0:'أحد',1:'إثنين',2:'ثلاثاء',3:'أربعاء',4:'خميس',5:'جمعة'};

/* ============================================================
   STATE
   ============================================================ */

const state = {
  library: {foods:[], exercises:[]},
  goals: defaultGoals(),
  plan: {type:'upper_lower_4', days:{}},
  today: '',
  log: {meals:[], workouts:[]},
  streak: 0,
  streakDays: [],
  weekPlanned: 0,
  weekDone: 0,
  activeFoodCat: 'الكل',
  activeSheetFoodCat: 'الكل',
  activeExGroup: 'الكل',
  viewedPlanDay: new Date().getDay(),
  selectedPresetType: 'upper_lower_4',
  activeField: 'weight',
  weightVal: 0,
  repsVal: 0,
  // workout session (single exercise, or 2 for superset)
  sessionExercises: [],
  sessionSets: {},
  sessionActiveIdx: 0,
  sessionStartTime: 0,
  sessionTimerHandle: null,
  // superset picking (inside exercise picker sheet)
  supersetPickMode: false,
  supersetPicks: [],
};

function todayKey(d){
  const dt = d || new Date();
  const y = dt.getFullYear(), m = String(dt.getMonth()+1).padStart(2,'0'), day = String(dt.getDate()).padStart(2,'0');
  return `${y}-${m}-${day}`;
}

function dateKeyOffset(offsetDays){
  const d = new Date();
  d.setDate(d.getDate()-offsetDays);
  return todayKey(d);
}

const WEEKDAYS = ['الأحد','الاثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت'];

const MONTHS = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];

/* ============================================================
   PLAN GENERATION
   ============================================================ */

function pickExercisesForDay(groups, library){
  const lib = library || state.library;
  const chosen = [];
  const usedPerGroup = {};
  groups.forEach(g=>{
    usedPerGroup[g] = usedPerGroup[g]||0;
    const candidates = lib.exercises.filter(e=>e.group===g)
      .sort((a,b)=> (b.favorite - a.favorite) || (b.usageCount - a.usageCount));
    const pick = candidates[usedPerGroup[g]] || candidates[0];
    if(pick && !chosen.includes(pick.id)) chosen.push(pick.id);
    usedPerGroup[g]++;
  });
  return chosen;
}

function generatePlan(type, library){
  const preset = SPLIT_PRESETS[type] || SPLIT_PRESETS.upper_lower_4;
  const days = {};
  for(let d=0; d<7; d++){
    const groups = preset.days[d] || [];
    days[d] = groups.length ? pickExercisesForDay(groups, library) : [];
  }
  return {type, days};
}

/* ============================================================
   EXERCISE ICON HTML
   ============================================================ */

function exAnimHtml(ex, size){
  if(!ex) return '';
  const gc = GROUP_COLOR_VAR[ex.group] || GROUP_COLOR_VAR['صدر'];
  const mt = ex.movementType || 'press';
  let inner = '';
  if(mt==='press'){ inner = '<div class="post l"></div><div class="post r"></div><div class="bar"></div>'; }
  else if(mt==='pull'){ inner = '<div class="post l"></div><div class="post r"></div><div class="bar"></div>'; }
  else if(mt==='squat'){ inner = '<div class="leg l"></div><div class="leg r"></div><div class="torso"></div>'; }
  else if(mt==='curl'){ inner = '<div class="dot"></div><div class="arm"></div>'; }
  else if(mt==='raise'){ inner = '<div class="arm"></div>'; }
  else if(mt==='core'){ inner = '<div class="torso2"></div>'; }
  const sizeCls = size ? ' '+size : '';
  return `<div class="ex-anim ex-anim--${mt}${sizeCls}" style="--gc:${gc.solid};--gcbg:${gc.soft}">${inner}</div>`;
}

/* ============================================================
   INIT
   ============================================================ */

function formatDateHuman(d){ return `${WEEKDAYS[d.getDay()]}، ${d.getDate()} ${MONTHS[d.getMonth()]}`; }

function computeStreak(){
  const days = [];
  let planned=0, done=0;
  for(let i=6;i>=0;i--){
    const key = dateKeyOffset(i);
    const dt = new Date(); dt.setDate(dt.getDate()-i);
    const dow = dt.getDay();
    const dayLog = (i===0) ? state.log : (appState.logs[key] || {meals:[],workouts:[]});
    const worked = !!(dayLog.workouts && dayLog.workouts.length>0);
    days.push(worked);
    const isPlanDay = !!(state.plan.days[dow] && state.plan.days[dow].length>0);
    if(isPlanDay) planned++;
    if(isPlanDay && worked) done++;
  }
  state.streakDays = days;
  state.weekPlanned = planned;
  state.weekDone = done;
  let streak = 0;
  for(let i=days.length-1;i>=0;i--){ if(days[i]) streak++; else break; }
  state.streak = streak;
}

/* ============================================================
   RENDER: HOME
   ============================================================ */

const FOOD_CATS = ['الكل','فطور','غدا','عشا','سناك'];

const PLATE_SIZES = [25,20,15,10,5,2.5,1.25];

const PLATE_COLORS = {25:'#E5555B',20:'#5B9DFF',15:'#F2D33C',10:'#2FD3A6',5:'#F3F1EA',2.5:'#7C858F',1.25:'#B7BEC6'};

const PLATE_HEIGHTS = {25:44,20:40,15:36,10:32,5:26,2.5:20,1.25:16};

const PLATE_HEIGHTS_SM = {25:26,20:24,15:22,10:20,5:17,2.5:14,1.25:11};

function decomposePlates(perSideKg){
  const plates = [];
  let remaining = perSideKg;
  for(const s of PLATE_SIZES){
    let guard = 0;
    while(remaining >= s - 0.001 && guard<12){ plates.push(s); remaining -= s; guard++; }
  }
  return plates;
}

function plateIconsHtml(weightKg, opts){
  opts = opts || {};
  const bar = 20;
  const perSide = Math.max(0, (weightKg - bar) / 2);
  const plates = decomposePlates(perSide);
  const maxShow = opts.max || 6;
  const shown = plates.slice(0, maxShow);
  const overflow = plates.length - shown.length;
  const heights = opts.size==='sm' ? PLATE_HEIGHTS_SM : PLATE_HEIGHTS;
  const plateEls = shown.map(s=> `<div class="plate" style="height:${heights[s]}px; background:${PLATE_COLORS[s]};"></div>`).join('');
  const overflowEl = overflow>0 ? `<div class="bb-more">+${overflow}</div>` : '';
  const sizeCls = opts.size==='sm' ? ' sm' : '';
  return `<div class="barbell${sizeCls}" id="${opts.id||''}">
    <div class="bb-sleeve"></div><div class="bb-plates">${plateEls}${overflowEl}</div>
    <div class="bb-bar"></div>
    <div class="bb-plates">${plateEls}${overflowEl}</div><div class="bb-sleeve"></div>
  </div>`;
}

function buildChartSvg(points){
  const w = 300, h = 140, pad = 18;
  if(points.length===0) return '<div class="empty-hint">ما فيه سجل كافي لرسم منحنى بعد</div>';
  if(points.length===1){
    return `<div class="empty-hint">سجّل مرة ثانية عشان يظهر منحنى التقدم 📈 (آخر وزن: ${points[0].weight} كغ)</div>`;
  }
  const weights = points.map(p=>p.weight);
  const min = Math.min(...weights), max = Math.max(...weights);
  const range = (max-min) || 1;
  const stepX = (w-pad*2) / (points.length-1);
  const coords = points.map((p,i)=>{
    const x = pad + i*stepX;
    const y = h - pad - ((p.weight-min)/range) * (h-pad*2);
    return [x,y];
  });
  const pathD = coords.map((c,i)=> (i===0?'M':'L')+c[0].toFixed(1)+','+c[1].toFixed(1)).join(' ');
  const dots = coords.map((c,i)=> `<circle cx="${c[0].toFixed(1)}" cy="${c[1].toFixed(1)}" r="3.5" fill="var(--accent)"/>`).join('');
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" height="140">
    <path d="${pathD}" fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
    ${dots}
  </svg>`;
}

function showToast(msg){
  const t = document.getElementById('toast');
  document.getElementById('toastMsg').textContent = msg;
  t.classList.add('show');
  clearTimeout(showToast._tm);
  showToast._tm = setTimeout(()=>t.classList.remove('show'), 1800);
}

function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

/* ============================================================
   SHEETS CONTROL
   ============================================================ */

const overlay = document.getElementById('overlay');

const allSheets = ['sheetQuick','sheetFood','sheetNewFood','sheetWorkoutPick','sheetNewEx','sheetSets','sheetSettings','sheetPlanEdit','sheetSwap','sheetPRs','sheetExDetail','sheetBodyWeight'];

function openSheet(id){
  closeAllSheets();
  overlay.classList.add('show');
  document.getElementById(id).classList.add('show');
}

function closeAllSheets(){
  overlay.classList.remove('show');
  allSheets.forEach(id=>document.getElementById(id).classList.remove('show'));
  document.getElementById('fab').classList.remove('rot');
  stopSessionTimer();
}

/* ============================================================
   TABS
   ============================================================ */

function switchTab(tab){
  document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b=>b.classList.remove('active'));
  document.getElementById('view-'+tab).classList.add('active');
  document.querySelector(`.nav-btn[data-tab="${tab}"]`).classList.add('active');
}

/* ============================================================
   FOOD SHEET (picker within FAB flow)
   ============================================================ */

