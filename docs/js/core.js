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
  return {
    library:{foods:defaultFoods(), exercises:defaultExercises()}, goals:defaultGoals(), plan:null, logs:{},
    bodyWeights:{}, bodyFat:{}, bodyMeasurements:{}, mealTemplates:[], equipment:[...ALL_EQUIPMENT],
    theme:'dark', onboarded:false, updatedAt:0
  };
}

function rebindFromAppState(){
  state.library = appState.library;
  state.goals = appState.goals;
  state.plan = appState.plan;
  state.selectedPresetType = state.plan.type || 'upper_lower_4';
  if(!appState.logs[state.today]) appState.logs[state.today] = {meals:[], workouts:[], waterMl:0};
  if(appState.logs[state.today].waterMl===undefined) appState.logs[state.today].waterMl = 0;
  state.log = appState.logs[state.today];
  if(!appState.bodyWeights) appState.bodyWeights = {};
  if(!appState.bodyFat) appState.bodyFat = {};
  if(!appState.bodyMeasurements) appState.bodyMeasurements = {};
  if(!appState.mealTemplates) appState.mealTemplates = [];
  if(!appState.equipment) appState.equipment = [...ALL_EQUIPMENT];
  if(!appState.theme) appState.theme = 'dark';
  if(appState.onboarded===undefined) appState.onboarded = true; // existing users skip onboarding
  if(appState.goals.water===undefined) appState.goals.water = 2500;
  if(appState.goals.fiber===undefined) appState.goals.fiber = 30;
  if(appState.goals.sodium===undefined) appState.goals.sodium = 2300;
  (appState.library.exercises||[]).forEach(ex=>{
    if(ex.equipment===undefined) ex.equipment = 'barbell';
    if(ex.injured===undefined) ex.injured = false;
  });
  (appState.library.foods||[]).forEach(f=>{
    if(f.fiber===undefined) f.fiber = 0;
    if(f.sodium===undefined) f.sodium = 0;
  });
  // One-time food-library refresh: replaces the default food list with the
  // curated menu. Bumping FOOD_LIB_VERSION in the future will re-trigger
  // this once more without touching custom foods added after this point
  // (custom foods are preserved; only the original defaults are swapped).
  const FOOD_LIB_VERSION = 3;
  if(appState.foodLibraryVersion !== FOOD_LIB_VERSION){
    const custom = (appState.library.foods||[]).filter(f=>f.isCustom);
    appState.library.foods = [...defaultFoods(), ...custom];
    appState.foodLibraryVersion = FOOD_LIB_VERSION;
    state.library = appState.library;
  }
  applyTheme(appState.theme);
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
  const mk = (name,category,foodType,calories,protein,carbs,fat)=>({id:uid(),name,category,foodType,calories,protein,carbs,fat,fiber:0,sodium:0,favorite:false,usageCount:0});
  return [
    mk("تشيز كيك مانجو","سناك","snack",379.9,6,42,21),
    mk("تشيز كيك شوكلت","سناك","snack",248.72,5,28,14),
    mk("تشيز كيك توت أزرق","سناك","snack",266.6,5,30,15),
    mk("بودنق رايس","سناك","snack",136.67,4,22,3),
    mk("كنافة صحية","سناك","snack",318.54,7,38,15),
    mk("عريكة صحية","سناك","snack",248,5,35,10),
    mk("كيك ليمون","سناك","snack",167,3,26,5),
    mk("كيك ريد فلفيت","سناك","snack",167,3,24,7),
    mk("تشيز كيك توت","سناك","snack",298,6,32,16),
    mk("كرات الطاقة","سناك","snack",190,5,18,10),
    mk("كيك براوني","سناك","snack",120,2,16,5),
    mk("كنافة رول","سناك","snack",113,2,14,5),
    mk("سناك مكسرات","سناك","snack",130,4,8,10),
    mk("كنافة كرانش","سناك","snack",125,3,15,6),
    mk("بسبوسة صحية","سناك","snack",105,2,18,3),
    mk("تشيز كيك فراولة","سناك","snack",379.9,6,40,22),
    mk("كيك شوكلت","سناك","snack",167,3,24,7),
    mk("كرات اللحم","غدا","protein",470.8,40,10,30),
    mk("لحم شيلي","غدا","protein",456,48,10,24),
    mk("لحم ستيك مع مشروم","غدا","protein",510,56,8,30),
    mk("ستيك مع صوص الفلفل الأسود","غدا","protein",475.8,54,6,28),
    mk("دجاج باربيكيو","غدا","protein",402.6,56,12,14),
    mk("دجاج برياني","غدا","protein",368,48,10,16),
    mk("دجاج تندوري","غدا","protein",573.4,60,12,34.8),
    mk("دجاج مشوي","غدا","protein",374,60,4,14),
    mk("دجاج ليمون","غدا","protein",368,56,8,12),
    mk("دجاج كريسبي","غدا","protein",420,36,24,20),
    mk("دجاج شيلي","غدا","protein",374,50,12,14),
    mk("دجاج أبولو","غدا","protein",420,48,12,20),
    mk("دجاج فاهيتا","غدا","protein",426,54,14,16),
    mk("لحم بامية","غدا","protein",396,44,14,18.2),
    mk("دجاج بيتزا","غدا","protein",420,48,16,18.2),
    mk("دجاج بامية","غدا","protein",388,48,12,16.4),
    mk("دجاج زعتر","غدا","protein",336,50,6,12.4),
    mk("صالونة سمك هامور","غدا","protein",214,42,2,4.2),
    mk("كفتة دجاج","غدا","protein",468,46,10,28),
    mk("دجاج كبسة","غدا","protein",404,46,16,17.4),
    mk("شيش طاووق","غدا","protein",442,56,8,20.2),
    mk("لحم فاهيتا","غدا","protein",436,48,12,24.4),
    mk("ستيك لحم بالصوص الأبيض","غدا","protein",532,54,8,34.2),
    mk("روبيان بالزعفران","غدا","protein",214,40,4,4.2),
    mk("دجاج مندي","غدا","protein",380,54,6,14),
    mk("دجاج رانش","غدا","protein",368,52,8,14.2),
    mk("دجاج سيشوان","غدا","protein",487,48,18,25.6),
    mk("سلمون مشوي","غدا","protein",506,50,0,34),
    mk("دجاج مع ملوخية","غدا","protein",394,50,12,16),
    mk("دجاج زبده","غدا","protein",545,48,16,33),
    mk("كباب دجاج","غدا","protein",374,52,6,16),
    mk("دجاج بالكاري","غدا","protein",582.6,48,16,37.2),
    mk("جمبري مشوي","غدا","protein",360,64,4,9.8),
    mk("صالونة سمك فيليه","غدا","protein",274,46,4,9.2),
    mk("روبيان مع صوص الليمون والشبت","غدا","protein",471.88,50,12,28.4),
    mk("دجاج طحينية","غدا","protein",807.2,56,20,54.2),
    mk("دجاج مسخن","غدا","protein",340,50,6,12.8),
    mk("دجاج كريمة","غدا","protein",340,48,8,12.8),
    mk("دجاج مسالا","غدا","protein",410,50,14,17.2),
    mk("برسكت لحم","غدا","protein",396,44,14,18.2),
    mk("دجاج زعفران","غدا","protein",420,48,16,18.2),
    mk("كوفته دجاج صوص أبيض","غدا","protein",388,48,12,16.4),
    mk("ستيك بارتبيلو","غدا","protein",336,50,6,12.4),
    mk("دجاج تكا مسالا","غدا","protein",214,42,2,4.2),
    mk("دجاج كانتون","غدا","protein",468,46,10,28),
    mk("دجاج ماشروم","غدا","protein",404,46,16,17.4),
    mk("بيكاتا تندوري","غدا","protein",442,56,8,20.2),
    mk("أوشن فيليه","غدا","protein",436,48,12,24.4),
    mk("تشكن إيطالينو","غدا","protein",532,54,8,34.2),
    mk("دجاج برياني (٢)","غدا","protein",214,40,4,4.2),
    mk("دجاج جوز الهند المشوي","غدا","protein",916,60,24,64.4),
    mk("دجاج مقلوبة","غدا","protein",368,52,8,14.2),
    mk("سلطة فتوش","غدا","salad",95,2,16,3),
    mk("سلطة خضراء","غدا","salad",50,2,6,2),
    mk("سلطة تبولة","غدا","salad",220,5,32,8),
    mk("سلطة فواكه","غدا","salad",130,1.5,32,1),
    mk("قطع فواكه مشكلة","غدا","salad",130,1.5,32,1),
    mk("سلطة الذرة","غدا","salad",145,3.5,22,4),
    mk("جرجير والرمان","غدا","salad",70,2,8,2.5),
    mk("سلطة بالفاصوليا","غدا","salad",105,5,15,2.5),
    mk("سلطة ستاندر","غدا","salad",45,1.5,5,1.5),
    mk("سلطة شمندر","غدا","salad",60,2,12,0),
    mk("سلطة السيزر","غدا","salad",110,7,9,5),
    mk("سلطة يونانية","غدا","salad",110,4.5,7,7),
    mk("سلطة جرجير","غدا","salad",35,1.5,4,1.5),
    mk("مكرونة سباغتي","غدا","carb",310,11,62,2),
    mk("مكرونة صوص أحمر","غدا","carb",300,10,56,4),
    mk("مكرونة مكسيكي","غدا","carb",340,12,56,8),
    mk("بيستو باستا","غدا","carb",440,14,54,18),
    mk("بطاطس مشوية","غدا","carb",190,5,42,0.4),
    mk("بطاطس مهروسة","غدا","carb",220,4,36,6),
    mk("كشري","غدا","carb",320,10,62,4),
    mk("ماك آند تشيز","غدا","carb",420,16,48,18),
    mk("أرز أبيض","غدا","carb",260,5,56,0.6),
    mk("أرز برياني","غدا","carb",320,6,60,6),
    mk("أرز صيني","غدا","carb",340,8,60,8),
    mk("أرز كبسة أحمر","غدا","carb",290,6,60,2),
    mk("أرز زعفران","غدا","carb",300,6,62,4),
    mk("أرز أمريكي","غدا","carb",260,5,56,0.6),
    mk("أرز أمريكي أحمر","غدا","carb",280,6,58,2),
    mk("رز مندي","غدا","carb",310,6,62,4),
    mk("رز بخاري","غدا","carb",300,6,62,4),
    mk("رز صيادية","غدا","carb",310,6,62,4),
    mk("رز سبانخ","غدا","carb",290,6,58,4),
    mk("مكرونة ألفريدو","غدا","carb",380,12,48,16),
  ];
}

function defaultExercises(){
  const mk = (name,group,movementType,equipment)=>({id:uid(),name,group,movementType,equipment:equipment||'barbell',injured:false,favorite:false,usageCount:0,lastWeight:0,lastReps:0,prWeight:0,prReps:0,prVolume:0,prDate:null});
  return [
    mk('بنش برس','صدر','press','barbell'), mk('ضغط صدر بالدمبل','صدر','press','dumbbell'), mk('بينش مائل','صدر','press','barbell'),
    mk('سحب أمامي','ظهر','pull','machine'), mk('بار عريض','ظهر','pull','bodyweight'), mk('تجديف بالبار','ظهر','pull','barbell'),
    mk('سكوات','أرجل','squat','barbell'), mk('لنجز','أرجل','squat','dumbbell'), mk('ضغط أرجل','أرجل','squat','machine'),
    mk('ضغط أكتاف','أكتاف','press','dumbbell'), mk('رفرفة جانبية','أكتاف','raise','dumbbell'),
    mk('كيرل بار','بايسبس','curl','barbell'), mk('كيرل دمبل تبادلي','بايسبس','curl','dumbbell'),
    mk('بوش داون','ترايسبس','press','machine'), mk('ديبس','ترايسبس','press','bodyweight'),
    mk('كرنش','بطن','core','bodyweight'), mk('بلانك','بطن','core','bodyweight'), mk('رفع أرجل معلق','بطن','core','bodyweight'),
  ];
}

function defaultGoals(){ return {calories:2200, protein:150, carbs:220, fat:70, water:2500, fiber:30, sodium:2300}; }

const EQUIPMENT_LABELS = {barbell:'بار حديد', dumbbell:'دمبل', machine:'أجهزة', bodyweight:'وزن الجسم'};
const ALL_EQUIPMENT = ['barbell','dumbbell','machine','bodyweight'];

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
  mealBuilderMode: false,
  mealBuilderStep: 'protein',
  mealBuilderPicks: {protein:null, carb:null},  activeExGroup: 'الكل',
  activeEquipFilter: null,
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
    const candidates = lib.exercises.filter(e=>e.group===g && !e.injured)
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
   HAPTICS
   ============================================================ */
function vibrate(pattern){
  try{ if(navigator.vibrate) navigator.vibrate(pattern); }catch(e){}
}

/* ============================================================
   THEME (dark / light)
   ============================================================ */
function applyTheme(theme){
  document.documentElement.setAttribute('data-theme', theme==='light' ? 'light' : 'dark');
}
function toggleTheme(){
  appState.theme = appState.theme==='light' ? 'dark' : 'light';
  applyTheme(appState.theme);
  persist();
}

/* ============================================================
   NUTRITION / TRAINING FORMULAS
   ============================================================ */
// Mifflin-St Jeor: estimates daily calorie needs from body stats + activity.
function calcSmartGoals({sex, age, heightCm, weightKg, activity, goal}){
  let bmr;
  if(sex==='female') bmr = 10*weightKg + 6.25*heightCm - 5*age - 161;
  else bmr = 10*weightKg + 6.25*heightCm - 5*age + 5;
  const activityFactors = {low:1.2, medium:1.55, high:1.725};
  let tdee = bmr * (activityFactors[activity] || 1.375);
  if(goal==='lose') tdee -= 400;
  else if(goal==='gain') tdee += 350;
  const calories = Math.round(tdee/10)*10;
  const protein = Math.round(weightKg*1.9);
  const fat = Math.round((calories*0.27)/9);
  const carbs = Math.round((calories - protein*4 - fat*9)/4);
  return {calories, protein, carbs:Math.max(carbs,50), fat};
}
// Epley formula: estimated one-rep max from any logged set.
function calcOneRepMax(weight, reps){
  if(reps<=0) return weight;
  if(reps===1) return weight;
  return Math.round(weight * (1 + reps/30) * 10) / 10;
}

/* ============================================================
   EXPORT / IMPORT BACKUP
   ============================================================ */
function exportDataFile(){
  const blob = new Blob([JSON.stringify(appState, null, 2)], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `miqyas-backup-${state.today}.json`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
function importDataFile(file, onDone){
  const reader = new FileReader();
  reader.onload = ()=>{
    try{
      const parsed = JSON.parse(reader.result);
      if(!parsed.library || !parsed.logs){ showToast('الملف مو نسخة احتياطية صحيحة'); return; }
      appState = parsed;
      appState.updatedAt = Date.now();
      saveLocalOnly();
      rebindFromAppState();
      computeStreak();
      renderAll();
      showToast('تم استرجاع النسخة الاحتياطية 🎉');
      if(onDone) onDone();
    }catch(e){ showToast('فشل قراءة الملف، تأكد إنه JSON صحيح'); }
  };
  reader.readAsText(file);
}

/* ============================================================
   UNDO TOAST
   ============================================================ */
function showUndoToast(msg, restoreFn){
  const t = document.getElementById('toast');
  const msgEl = document.getElementById('toastMsg');
  msgEl.innerHTML = escapeHtml(msg) + ' <span id="toastUndoBtn" style="color:var(--accent-2); font-weight:800; cursor:pointer; margin-inline-start:8px;">تراجع</span>';
  t.classList.add('show');
  clearTimeout(showToast._tm);
  let undone = false;
  document.getElementById('toastUndoBtn').addEventListener('click', ()=>{
    if(undone) return;
    undone = true;
    restoreFn();
    t.classList.remove('show');
  });
  showToast._tm = setTimeout(()=>{ t.classList.remove('show'); }, 5000);
}

/* ============================================================
   SWIPE TO DELETE
   ============================================================ */
function attachSwipeToDelete(rowEl, onConfirmDelete){
  let startX = 0, curX = 0, dragging = false;
  const threshold = 70;
  function onStart(x){ startX = x; curX = x; dragging = true; rowEl.style.transition = 'none'; }
  function onMove(x){
    if(!dragging) return;
    curX = x;
    const dx = curX - startX;
    rowEl.style.transform = `translateX(${dx}px)`;
    rowEl.style.opacity = String(1 - Math.min(Math.abs(dx)/220, 0.5));
  }
  function onEnd(){
    if(!dragging) return;
    dragging = false;
    rowEl.style.transition = 'transform .2s ease, opacity .2s ease';
    const dx = curX - startX;
    if(Math.abs(dx) > threshold){
      rowEl.style.transform = `translateX(${dx>0?260:-260}px)`;
      rowEl.style.opacity = '0';
      setTimeout(()=> onConfirmDelete(), 180);
    } else {
      rowEl.style.transform = 'translateX(0)';
      rowEl.style.opacity = '1';
    }
  }
  rowEl.addEventListener('touchstart', e=> onStart(e.touches[0].clientX), {passive:true});
  rowEl.addEventListener('touchmove', e=> onMove(e.touches[0].clientX), {passive:true});
  rowEl.addEventListener('touchend', onEnd);
}

/* ============================================================
   SHEETS CONTROL
   ============================================================ */

const overlay = document.getElementById('overlay');

const allSheets = ['sheetQuick','sheetFood','sheetNewFood','sheetWorkoutPick','sheetNewEx','sheetSets','sheetSettings','sheetPlanEdit','sheetSwap','sheetPRs','sheetExDetail','sheetBodyWeight','sheetOnboarding','sheetRecipeBuilder','sheetMealTemplates','sheetShareCard'];

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
  stopRestTimer();
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

