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

// Last cloud-sync failure (if any), so the Settings sync panel can show an
// honest "your data isn't actually syncing right now" state instead of a
// permanent "متصل" badge that keeps claiming everything's fine while
// cloudDoc.set()/onSnapshot() have been silently failing (wrong Firebase
// rules, device offline, revoked project, etc). Ephemeral/session-only —
// deliberately not part of appState, since it describes THIS device's
// current connection, not saved data.
let lastCloudSyncError = null;
let lastCloudSyncErrorToastAt = 0;

function reportCloudSyncError(e){
  console.error('cloud sync failed', e);
  lastCloudSyncError = {message: (e && (e.code || e.message)) || 'خطأ غير معروف', at: Date.now()};
  // persist()/onSnapshot can fire on almost every tap or every reconnect
  // attempt — a real outage would otherwise spam a toast repeatedly. One
  // notice every few minutes is enough to alert the user without being
  // annoying; the Settings sync panel (renderSyncStatus) shows the
  // persistent warning badge in between.
  const now = Date.now();
  if(now - lastCloudSyncErrorToastAt > 180000){
    lastCloudSyncErrorToastAt = now;
    showToast('تعذرت مزامنة بياناتك مع السحابة، بياناتك محفوظة على جهازك بس حالياً ⚠️');
  }
  if(typeof renderSyncStatus==='function' && document.getElementById('syncStatusBox')) renderSyncStatus();
}

function clearCloudSyncError(){
  if(!lastCloudSyncError) return;
  lastCloudSyncError = null;
  if(typeof renderSyncStatus==='function' && document.getElementById('syncStatusBox')) renderSyncStatus();
}

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
    cloudDoc.set(appState).then(clearCloudSyncError).catch(e=> reportCloudSyncError(e));
  }
  syncWidget();
}

// Pushes today's real calorie/water totals (never whatever day the user
// happens to be *viewing* via switchViewedDay) — and, if Health Connect is
// connected, today's steps/distance/calories-burned too — to the native
// home-screen widgets, if the app is running inside the installed Android
// build (this plugin doesn't exist on the plain web/PWA, so it's a silent
// no-op there). Runs after every persist() (i.e. after almost any action,
// including a fresh steps sync — see cacheSteps() below), so it stays
// completely silent on success/failure — errors just go to the console —
// instead of interrupting the user with a toast on every unrelated tap.
function syncWidget(){
  try{
    if(!(window.Capacitor && Capacitor.Plugins && Capacitor.Plugins.MiqyasWidget)) return;
    const key = todayKey(new Date());
    const dayLog = (appState && appState.logs && appState.logs[key]) || {meals:[], waterMl:0};
    const cal = (dayLog.meals||[]).reduce((s,m)=>s+(m.calories||0),0);
    const water = dayLog.waterMl || 0;
    const goals = (appState && appState.goals) || {};
    const payload = {
      dateKey: key,
      calCurrent: Math.round(cal),
      calGoal: Math.round(goals.calories || 2000),
      waterCurrent: Math.round(water),
      waterGoal: Math.round(goals.water || 2500)
    };

    // Steps widget fields — only meaningful once Health Connect is granted
    // and today's steps have actually been cached at least once; otherwise
    // stepsDateKey stays '' and the widget provider shows its own honest
    // "not synced yet" empty state instead of a fake zero.
    const stepsEntry = appState && appState.healthConnectGranted && appState.stepsCache ? appState.stepsCache[key] : null;
    if(stepsEntry){
      payload.stepsDateKey = key;
      payload.stepsCurrent = Math.round(stepsEntry.steps || 0);
      payload.stepsGoal = Math.round(goals.steps || 8000);
      payload.stepsDistanceKm = estimateStepsDistanceKm(stepsEntry.steps || 0);
      payload.stepsCalories = Math.round(estimateStepsCalories(stepsEntry.steps || 0));
      payload.stepsSyncedAt = stepsEntry.fetchedAt || 0;
    }

    Capacitor.Plugins.MiqyasWidget.update(payload)
      .catch((e)=> console.error('widget update failed', e));
  }catch(e){ console.error('syncWidget failed', e); }
}

/* ============================================================
   HEALTH CONNECT — write-only bridge (nutrition + hydration).
   No-ops entirely on the plain web/PWA and until the user explicitly
   grants access from Settings (appState.healthConnectGranted). One record
   per real event, written from the exact call sites that add a meal/water
   amount — not recomputed from persist() — matching Health Connect's own
   guidance to avoid whole-day aggregate records.
   ============================================================ */
function healthConnectPlugin(){
  return (window.Capacitor && Capacitor.Plugins && Capacitor.Plugins.MiqyasHealth) ? Capacitor.Plugins.MiqyasHealth : null;
}

async function healthConnectRequestAccess(){
  const plugin = healthConnectPlugin();
  if(!plugin) return {ok:false, reason:'not-native'};
  try{
    const avail = await plugin.checkAvailability();
    if(!avail.available){
      return {ok:false, reason: avail.needsProviderUpdate ? 'needs-update' : 'not-installed'};
    }
    const res = await plugin.requestHealthPermissions();
    appState.healthConnectGranted = !!res.granted;
    persist();
    return {ok: !!res.granted, reason: res.granted ? 'granted' : 'denied'};
  }catch(e){
    return {ok:false, reason:'error', message: e && e.message};
  }
}

async function healthConnectRefreshStatus(){
  const plugin = healthConnectPlugin();
  if(!plugin){ appState.healthConnectGranted = false; return false; }
  try{
    const res = await plugin.hasPermissions();
    appState.healthConnectGranted = !!res.granted;
    return appState.healthConnectGranted;
  }catch(e){ return false; }
}

function syncHealthConnectNutrition(entry){
  try{
    if(!appState || !appState.healthConnectGranted) return;
    const plugin = healthConnectPlugin();
    if(!plugin || !entry) return;
    plugin.writeNutrition({
      name: entry.name || 'وجبة',
      calories: Math.round(entry.calories||0),
      protein: Math.round(entry.protein||0),
      carbs: Math.round(entry.carbs||0),
      fat: Math.round(entry.fat||0)
    }).then(res=>{
      // Stash Health Connect's own ID for this exact record on the meal
      // entry (entry is the live object sitting inside appState.logs[...].
      // meals, not a copy) so a later edit/delete can find and
      // remove/replace this specific record — see
      // syncHealthConnectDeleteNutrition() below, and its call sites in
      // food.js (deleteMealEntry/saveEditMealQty). Without this, editing or
      // deleting a logged meal only ever updated مِقياس's own log — the
      // original Health Connect record (and anything reading from it, e.g.
      // Samsung Health) silently kept showing the old/stale numbers forever.
      if(res && res.recordId){ entry.hcRecordId = res.recordId; persist(); }
    }).catch(()=>{});
  }catch(e){ /* no-op outside the native app / without permission */ }
}

// Removes a single previously-synced Health Connect nutrition record by ID
// — the delete-side counterpart to syncHealthConnectNutrition() above.
// Fire-and-forget/best-effort like every other Health Connect call in this
// file: silently does nothing without a recordId, without permission, or
// outside the native app.
function syncHealthConnectDeleteNutrition(recordId){
  try{
    if(!appState || !appState.healthConnectGranted || !recordId) return;
    const plugin = healthConnectPlugin();
    if(!plugin || !plugin.deleteNutrition) return;
    plugin.deleteNutrition({recordId}).catch(()=>{});
  }catch(e){ /* no-op outside the native app / without permission */ }
}

// Body weight — mirrors syncHealthConnectNutrition()'s delete-old/write-new
// pattern above, since a weight entry for a given day can be overwritten
// (re-saving that day with a corrected number) and Health Connect has no
// "update in place" API either. appState.bodyWeightHcRecordIds tracks the
// per-date record ID the same way entry.hcRecordId tracks it per-meal —
// bodyWeights itself is just {dateKey: number}, with no object to stash an
// ID on directly.
function syncHealthConnectWeight(dateKey, weightKg){
  try{
    if(!appState || !appState.healthConnectGranted || !weightKg) return;
    const plugin = healthConnectPlugin();
    if(!plugin || !plugin.writeWeight) return;
    if(!appState.bodyWeightHcRecordIds) appState.bodyWeightHcRecordIds = {};
    const oldRecordId = appState.bodyWeightHcRecordIds[dateKey];
    const writeFresh = ()=>{
      plugin.writeWeight({weightKg, dateKey}).then(res=>{
        if(res && res.recordId){
          appState.bodyWeightHcRecordIds[dateKey] = res.recordId;
          persist();
        }
      }).catch(()=>{});
    };
    if(oldRecordId && plugin.deleteWeight){
      plugin.deleteWeight({recordId: oldRecordId}).catch(()=>{}).then(writeFresh);
    } else {
      writeFresh();
    }
  }catch(e){ /* no-op outside the native app / without permission */ }
}

function syncHealthConnectHydration(ml){
  try{
    if(!appState || !appState.healthConnectGranted) return;
    if(!(ml>0)) return; // only real intake events, never the "-250" undo button
    const plugin = healthConnectPlugin();
    if(!plugin) return;
    plugin.writeHydration({volumeMl: Math.round(ml)}).catch(()=>{});
  }catch(e){ /* no-op outside the native app / without permission */ }
}

/* ============================================================
   HEALTH CONNECT — read-only bridge (steps).
   Read-only, steps-only, up to the trailing 30 days — see
   HealthConnectPlugin.kt's class doc for the permission-scope rationale.
   Both fetch functions below are plain fetch-and-cache helpers: they never
   touch the DOM themselves (that's renderStepsCard()/renderStepsDetail()
   in home.js) and they always resolve (never throw) so a caller can
   safely fire-and-forget them.
   ============================================================ */

// Writes {steps, fetchedAt} into appState.stepsCache[dateKey] and persists.
// Shared by both read helpers below so the cache always has a consistent
// shape regardless of which one last touched a given day.
//
// Also the single choke point every steps value (today or historical)
// passes through, so it's the natural place to fire the one-off "goal
// reached" notification the moment TODAY's synced count first crosses the
// goal — gated on appState.stepsGoalNotifiedDate so re-fetching an
// already-met day (e.g. every app resume) doesn't re-notify, and scoped to
// dateKey===today so a bulk 30-day history fetch never fires it for a past
// day that happened to meet the goal.
function cacheSteps(dateKey, steps){
  if(!appState) return;
  if(!appState.stepsCache) appState.stepsCache = {};
  const roundedSteps = Math.max(0, Math.round(steps||0));
  appState.stepsCache[dateKey] = {steps: roundedSteps, fetchedAt: Date.now()};
  const goal = (appState.goals && appState.goals.steps) || 8000;
  const isToday = dateKey === todayKey(new Date());
  // Gated purely on stepsGoalNotifiedDate (not an old-value-vs-new-value
  // "just crossed" edge check) so a sync that finds the goal already met —
  // e.g. Health Connect access (or notification permission) only gets
  // granted mid-afternoon, well after the goal was actually crossed — still
  // gets a chance to notify. stepsGoalNotifiedDate is deliberately NOT set
  // here until notifyStepsGoalReached() confirms it actually scheduled the
  // notification (permission granted, no error) — otherwise a sync that
  // happens before notification permission is granted would burn the flag
  // and permanently lose today's notification even after the user grants
  // permission minutes later. The next sync (app resume, pull-to-refresh)
  // simply retries as long as the flag is still unset for today.
  if(isToday && roundedSteps >= goal && appState.stepsGoalNotifiedDate !== dateKey && typeof notifyStepsGoalReached==='function'){
    notifyStepsGoalReached(roundedSteps, goal).then(sent=>{
      if(sent){
        appState.stepsGoalNotifiedDate = dateKey;
        persist();
      }
    });
  }
  persist();
}

// Refreshes *today's* step count only. Cheap, meant to be called often
// (app resume, pull-to-refresh, right after granting access) — mirrors
// readTodaySteps() on the native side, which re-aggregates from local
// midnight to now every time (no server round-trip, Health Connect is a
// local on-device store).
async function healthConnectReadTodaySteps(){
  try{
    if(!appState || !appState.healthConnectGranted) return null;
    const plugin = healthConnectPlugin();
    if(!plugin) return null;
    const res = await plugin.readTodaySteps();
    const steps = (res && typeof res.steps==='number') ? res.steps : 0;
    cacheSteps(todayKey(new Date()), steps);
    return steps;
  }catch(e){ return null; /* no-op outside the native app / without permission */ }
}

// Refreshes a trailing N-day window (today + previous N-1 days, capped at
// 30 — Health Connect's own default access window without the extra
// READ_HEALTH_DATA_HISTORY permission this app deliberately doesn't
// request) in one native call. Used for both the Home card's 7-day
// preview and the steps-detail sheet's 30-day monthly view/streak — see
// refreshStepsWeek()/refreshStepsMonth() in progress.js. Fills every day
// in the cache, including days Health Connect returned no record for
// (real zero, not "unknown") — see readStepsHistory() on the native side.
async function healthConnectReadStepsHistory(days){
  try{
    if(!appState || !appState.healthConnectGranted) return null;
    const plugin = healthConnectPlugin();
    if(!plugin) return null;
    const n = Math.max(1, Math.min(30, days||7));
    const res = await plugin.readStepsHistory({days: n});
    const list = (res && Array.isArray(res.days)) ? res.days : [];
    list.forEach(d=>{ if(d && d.date) cacheSteps(d.date, d.steps||0); });
    return list;
  }catch(e){ return null; /* no-op outside the native app / without permission */ }
}

// Most recent recorded body weight (kg) — falls back to a population
// average (70kg) if the user hasn't logged one yet, purely so the steps
// distance/calorie estimates below are never blank for a brand-new user.
// Never itself shown as if it were a real logged weight.
function latestBodyWeightKg(){
  const weights = appState && appState.bodyWeights;
  if(!weights) return 70;
  const dates = Object.keys(weights).sort();
  if(dates.length===0) return 70;
  return weights[dates[dates.length-1]] || 70;
}

// Distance/calorie estimates from a step count. StepsRecord carries no
// distance/energy fields of its own (a raw count is all any source,
// including Zepp, is required to report to Health Connect), so these are
// computed client-side the same way most pedometer apps do:
//  - stride length personalized from height (heightCm * 0.414 / 100),
//    falling back to an average adult height (170cm) if the user hasn't
//    filled in Settings' profile.
//  - calories via the standard MET-based walking energy-expenditure
//    formula (an "average pace" MET of 3.5, ~4.8km/h — the same method
//    used by widely-cited steps-to-calories calculators), scaled by the
//    user's own latest logged weight.
// Deliberately NOT wired into the main calorie ring/goal math anywhere —
// that ring tracks food *intake* against a fixed target, and folding an
// estimated *expenditure* number into it would silently change what
// "سعرة متبقية" means for every existing user. These are shown purely as
// their own informational stats on the steps card/detail sheet.
function estimateStepsDistanceKm(steps){
  const heightCm = (appState && appState.profile && appState.profile.heightCm) || 170;
  const strideM = (heightCm/100) * 0.414;
  return (Math.max(0,steps) * strideM) / 1000;
}
function estimateStepsCalories(steps){
  const AVG_WALK_KMH = 4.824; // ~1.34 m/s, the "average pace" reference speed
  const MET = 3.5;
  const distanceKm = estimateStepsDistanceKm(steps);
  const hours = distanceKm / AVG_WALK_KMH;
  return hours * 60 * (MET * 3.5 * latestBodyWeightKg() / 200);
}

// Consecutive days (most recent backwards, up to the 30-day cache window)
// meeting the daily steps goal — separate from the meal-logging streak
// above. Today doesn't break an existing streak just for not being over
// the goal *yet*; it simply isn't counted until it is, matching how
// StepsApp and most pedometer apps treat a still-in-progress "today".
// Only reflects whatever's in appState.stepsCache, so it's only as deep as
// the last healthConnectReadStepsHistory(30) call reached — see
// refreshStepsMonth() in progress.js.
function computeStepsStreak(){
  const goal = (state.goals && state.goals.steps) || 8000;
  const cache = (appState && appState.stepsCache) || {};
  let streak = 0;
  for(let i=0;i<30;i++){
    const key = dateKeyOffset(i);
    const entry = cache[key];
    const met = !!(entry && entry.steps >= goal);
    if(i===0){ if(met) streak++; continue; }
    if(met) streak++; else break;
  }
  return streak;
}

function defaultAppState(){
  return {
    library:{foods:defaultFoods()}, goals:defaultGoals(), logs:{},
    bodyWeights:{}, bodyFat:{}, bodyMeasurements:{}, mealTemplates:[],
    theme:'dark', onboarded:false, updatedAt:0, healthConnectGranted:false,
    // Cache of {steps, fetchedAt} per dateKey, read from Health Connect —
    // see renderStepsCard()/refreshSteps() in docs/js/home.js. Just a
    // re-fetchable snapshot (not user-entered data), so it's fine if it
    // rides along in a cloud sync payload like the rest of appState — the
    // steps card itself only ever renders on a device with the native
    // Health Connect plugin available, which re-fetches fresh on its own
    // right after any pull, so a stale/foreign value never lingers visibly.
    stepsCache:{},
    // dateKey of the last day a "goal reached" steps notification already
    // fired for — see cacheSteps() in this file — so re-fetching an
    // already-met day doesn't re-notify every refresh.
    stepsGoalNotifiedDate:null,
    // {dateKey: Health Connect record ID} for synced body-weight entries —
    // see syncHealthConnectWeight() in this file — so a re-saved day can
    // delete its old record instead of leaving a stale duplicate behind.
    bodyWeightHcRecordIds:{},
    aiProxyUrl:'', aiProxySecret:'',
    // 'library' matches only against the user's own saved foods (fast,
    // trusted, no macros shown for a non-match); 'general' asks the AI to
    // estimate full macros for anything, even foods outside the library.
    aiScanMode:'library',
    // heightCm powers the BMI gauge on the Progress tab's weight card;
    // targetWeightKg (optional) powers the start→target bar there. Both
    // null until the user fills them in (onboarding sets heightCm; either
    // can be set/edited from the body-weight sheet).
    profile:{heightCm:null, targetWeightKg:null},
    // Local reminder notifications (native app only — no-op on the plain
    // web/PWA). mealEnabled fires one daily reminder at mealTime; waterEnabled
    // fires repeating reminders between waterStart/waterEnd every
    // waterIntervalHours. All off by default.
    reminders:{
      mealEnabled:false, mealTime:'20:00',
      waterEnabled:false, waterStart:'09:00', waterEnd:'21:00', waterIntervalHours:2
    }
  };
}

function rebindFromAppState(){
  state.library = appState.library;
  state.goals = appState.goals;
  if(!appState.logs[state.today]) appState.logs[state.today] = {meals:[], waterMl:0};
  if(appState.logs[state.today].waterMl===undefined) appState.logs[state.today].waterMl = 0;
  state.log = appState.logs[state.today];
  if(!appState.bodyWeights) appState.bodyWeights = {};
  if(!appState.bodyFat) appState.bodyFat = {};
  if(!appState.bodyMeasurements) appState.bodyMeasurements = {};
  if(!appState.mealTemplates) appState.mealTemplates = [];
  if(!appState.theme) appState.theme = 'dark';
  if(appState.onboarded===undefined) appState.onboarded = true; // existing users skip onboarding
  if(appState.goals.water===undefined) appState.goals.water = 2500;
  if(appState.goals.fiber===undefined) appState.goals.fiber = 30;
  if(appState.goals.sodium===undefined) appState.goals.sodium = 2300;
  if(appState.goals.steps===undefined) appState.goals.steps = 8000;
  if(appState.healthConnectGranted===undefined) appState.healthConnectGranted = false;
  if(!appState.stepsCache) appState.stepsCache = {};
  if(appState.stepsGoalNotifiedDate===undefined) appState.stepsGoalNotifiedDate = null;
  if(!appState.bodyWeightHcRecordIds) appState.bodyWeightHcRecordIds = {};
  if(appState.aiProxyUrl===undefined) appState.aiProxyUrl = '';
  if(appState.aiProxySecret===undefined) appState.aiProxySecret = '';
  if(appState.aiScanMode!=='library' && appState.aiScanMode!=='general') appState.aiScanMode = 'library';
  if(!appState.profile) appState.profile = {};
  if(appState.profile.heightCm===undefined) appState.profile.heightCm = null;
  if(appState.profile.targetWeightKg===undefined) appState.profile.targetWeightKg = null;
  if(!appState.reminders) appState.reminders = {};
  if(appState.reminders.mealEnabled===undefined) appState.reminders.mealEnabled = false;
  if(appState.reminders.mealTime===undefined) appState.reminders.mealTime = '20:00';
  if(appState.reminders.waterEnabled===undefined) appState.reminders.waterEnabled = false;
  if(appState.reminders.waterStart===undefined) appState.reminders.waterStart = '09:00';
  if(appState.reminders.waterEnd===undefined) appState.reminders.waterEnd = '21:00';
  if(appState.reminders.waterIntervalHours===undefined) appState.reminders.waterIntervalHours = 2;
  (appState.library.foods||[]).forEach(f=>{
    if(f.fiber===undefined) f.fiber = 0;
    if(f.sodium===undefined) f.sodium = 0;
    if(f.sugar===undefined) f.sugar = 0;
    if(f.satFat===undefined) f.satFat = 0;
    if(f.servingUnit===undefined) f.servingUnit = 'حصة';
  });
  // One-time food-library refresh: replaces the default food list with the
  // curated menu. Bumping FOOD_LIB_VERSION in the future will re-trigger
  // this once more without touching custom foods added after this point
  // (custom foods are preserved; only the original defaults are swapped).
  const FOOD_LIB_VERSION = 4;
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
    clearCloudSyncError();
    if(!snap.exists) return;
    const cloudState = snap.data();
    if((cloudState.updatedAt||0) > (appState.updatedAt||0)){
      appState = cloudState;
      saveLocalOnly();
      rebindFromAppState();
      renderAll();
      // Same reasoning as the initial-pull path in app.js: saveLocalOnly()
      // deliberately skips persist()'s syncWidget() call (so we don't
      // immediately push this just-pulled data back to the cloud), so the
      // widget/reminders have to be refreshed explicitly here too.
      syncWidget();
      applyReminderSettings();
      showToast('تم التحديث من جهاز ثاني 🔄');
    }
  }, err=> reportCloudSyncError(err));
}

/* ============================================================
   DEFAULT LIBRARY
   ============================================================ */

function defaultFoods(){
  const mk = (name,category,foodType,calories,protein,carbs,fat)=>({id:uid(),name,category,foodType,calories,protein,carbs,fat,fiber:0,sodium:0,favorite:false,usageCount:0});
  // Order here is what a brand-new user sees first under "الكل" (favorite/
  // usageCount are both 0 for everyone at first, so the list falls back to
  // this insertion order). Mains/carbs/salads first, snacks & desserts last
  // — so a first-time open doesn't read as "this app is mostly cheesecake".
  return [
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
  ];
}

// 8,000 (not the "10,000 steps" myth — that number traces back to 1960s
// pedometer marketing, not a health guideline) — current step-count
// research (e.g. the 2023 meta-analysis covered by Harvard Health) shows
// mortality-risk reduction accruing up to roughly 7,000-8,000 steps/day,
// after which the benefit curve flattens; picked as a realistic, still
// evidence-backed default rather than an inflated one. User-editable in
// Settings same as every other goal here.
function defaultGoals(){ return {calories:2200, protein:150, carbs:220, fat:70, water:2500, fiber:30, sodium:2300, steps:8000}; }

const state = {
  library: {foods:[]},
  goals: defaultGoals(),
  today: '',
  log: {meals:[]},
  streak: 0,
  streakDays: [],
  weekLoggedDays: 0,
  activeSheetFoodCat: 'الكل',
  mealBuilderMode: false,
  mealBuilderStep: 'protein',
  mealBuilderPicks: {protein:null, carb:null},
  // set to a food id while editing an existing custom food, null when adding new
  editingFoodId: null,
  // date key (YYYY-MM-DD) the app is currently "viewing" — equals `today` normally,
  // but switches to a past/future day when picked from the home days strip, so the
  // whole app (ring, macros, water, meal list, food tab) behaves as if that day is today
  viewDate: '',
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

// Short weekday labels for compact UI (e.g. the home days-strip pills), indexed
// the same as Date#getDay() (0 = Sunday).
const DAY_LABELS = ['أحد','اثنين','ثلاثاء','أربعاء','خميس','جمعة','سبت'];

const MONTHS = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];

function formatDateHuman(d){ return `${WEEKDAYS[d.getDay()]}، ${d.getDate()} ${MONTHS[d.getMonth()]}`; }

function computeStreak(){
  // Streak + week progress are based on logging consistency: a day "counts"
  // if at least one meal was logged that day (matches real "today", not
  // whatever day the home-strip might currently be viewing).
  const days = [];
  let loggedThisWeek = 0;
  for(let i=6;i>=0;i--){
    const key = dateKeyOffset(i);
    const dayLog = appState.logs[key] || {meals:[]};
    const logged = !!(dayLog.meals && dayLog.meals.length>0);
    days.push(logged);
    if(logged) loggedThisWeek++;
  }
  state.streakDays = days;
  state.weekLoggedDays = loggedThisWeek;
  let streak = 0;
  for(let i=days.length-1;i>=0;i--){ if(days[i]) streak++; else break; }
  state.streak = streak;
}

/* ============================================================
   RENDER: HOME
   ============================================================ */

const FOOD_CATS = ['الكل','فطور','غدا','عشا','سناك'];

// Shared meal-category → color mapping, used everywhere a meal's category
// needs a visual accent (calorie-distribution chart, meal-list row dots).
const MEAL_CAT_COLORS = {'فطور':'var(--fat)','غدا':'var(--protein)','عشا':'var(--carb)','سناك':'var(--shoulder)'};

// Shared inline-icon set (24px viewBox, stroke=currentColor to inherit
// whatever color the surrounding element sets) — used anywhere small action
// icons are built as HTML strings instead of static markup in index.html,
// so row actions (delete/edit/favorite), insight badges and status icons
// all come from the same line-icon system instead of mixing in raw emoji
// (emoji render inconsistently across Android OEM keyboards/fonts).
const ICON_X = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="6" y1="6" x2="18" y2="18"></line><line x1="18" y1="6" x2="6" y2="18"></line></svg>';
const ICON_PENCIL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20l1-4L16 5l3 3L8 19z"></path><line x1="14" y1="7" x2="17" y2="10"></line></svg>';
const ICON_TRASH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 7 20 7"></polyline><path d="M9 7V4h6v3"></path><path d="M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>';
const ICON_STAR_OUTLINE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2.5 15.1 9 22 9.7 16.8 14.3 18.5 21.5 12 17.6 5.5 21.5 7.2 14.3 2 9.7 8.9 9"></polygon></svg>';
const ICON_STAR_FILLED = '<svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><polygon points="12 2.5 15.1 9 22 9.7 16.8 14.3 18.5 21.5 12 17.6 5.5 21.5 7.2 14.3 2 9.7 8.9 9"></polygon></svg>';
const ICON_TREND_UP = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 17 10 10 14 14 21 7"></polyline><polyline points="15 7 21 7 21 13"></polyline></svg>';
const ICON_TREND_DOWN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 7 10 14 14 10 21 17"></polyline><polyline points="21 10 21 17 14 17"></polyline></svg>';
const ICON_TARGET = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"></circle><circle cx="12" cy="12" r="5"></circle><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none"></circle></svg>';
const ICON_BAR_CHART = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="6" y1="20" x2="6" y2="12"></line><line x1="12" y1="20" x2="12" y2="7"></line><line x1="18" y1="20" x2="18" y2="15"></line><line x1="3" y1="20" x2="21" y2="20"></line></svg>';
const ICON_CALENDAR = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="2"></rect><line x1="3" y1="10" x2="21" y2="10"></line><line x1="8" y1="3" x2="8" y2="7"></line><line x1="16" y1="3" x2="16" y2="7"></line></svg>';
const ICON_MEAL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8"></circle><circle cx="12" cy="12" r="3"></circle></svg>';
const ICON_SCALE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="3" x2="12" y2="21"></line><line x1="5" y1="7" x2="19" y2="7"></line><path d="M5 7l-3 6a3 3 0 0 0 6 0z"></path><path d="M19 7l-3 6a3 3 0 0 0 6 0z"></path></svg>';
const ICON_CHECK_CIRCLE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"></circle><polyline points="8 12.5 11 15.5 16 9.5"></polyline></svg>';
const ICON_X_CIRCLE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"></circle><line x1="9" y1="9" x2="15" y2="15"></line><line x1="15" y1="9" x2="9" y2="15"></line></svg>';
const ICON_SYNC = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"></path></svg>';

// Small hand-drawn line-art illustrations for empty states, matching the
// stroke weight/style of the section-title icons used throughout the app
// (24px viewBox originals scaled up here) — used instead of emoji so empty
// states feel like part of the same design system.
const EMPTY_ILLOS = {
  meal: '<svg class="empty-illo" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="32" cy="36" r="17"></circle><path d="M24 36a8 8 0 0 1 16 0"></path><line x1="17" y1="15" x2="22" y2="21"></line><line x1="47" y1="15" x2="42" y2="21"></line><line x1="32" y1="12" x2="32" y2="19"></line></svg>',
  search: '<svg class="empty-illo" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="27" cy="27" r="15"></circle><line x1="38" y1="38" x2="51" y2="51"></line></svg>',
  list: '<svg class="empty-illo" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="15" y="10" width="34" height="44" rx="4"></rect><line x1="22" y1="23" x2="42" y2="23"></line><line x1="22" y1="33" x2="42" y2="33"></line><line x1="22" y1="43" x2="34" y2="43"></line></svg>',
  chart: '<svg class="empty-illo" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="13" y1="51" x2="13" y2="13"></line><line x1="13" y1="51" x2="51" y2="51"></line><path d="M19 43l9-11 8 7 13-17"></path></svg>'
};
function emptyStateHtml(kind, text){
  const icon = EMPTY_ILLOS[kind] || EMPTY_ILLOS.list;
  return `<div class="empty-state">${icon}<div class="empty-state-text">${text}</div></div>`;
}

// Animates a number-bearing element's text from its current displayed value
// to `target` over a short duration, instead of snapping instantly — used
// for logged numbers that change (calories remaining, switching viewed day).
function animateCount(el, target, opts){
  if(!el) return;
  opts = opts || {};
  const duration = opts.duration || 500;
  const suffix = opts.suffix || '';
  const formatter = opts.formatter || (n => Math.round(n).toLocaleString('en-US'));
  const prevRaw = el.dataset.countRaw;
  const startVal = prevRaw!=null ? parseFloat(prevRaw) : target;
  el.dataset.countRaw = String(target);
  if(!isFinite(startVal) || startVal===target){ el.textContent = formatter(target)+suffix; return; }
  const startTime = performance.now();
  function tick(now){
    const t = Math.min((now-startTime)/duration, 1);
    const eased = 1 - Math.pow(1-t, 3);
    const val = startVal + (target-startVal)*eased;
    el.textContent = formatter(val)+suffix;
    if(t<1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

// Centered moving average (window clamped at the array edges) — used to
// overlay a smoothed trend line on top of raw day-to-day values, which
// otherwise zigzag from ordinary water-weight/measurement noise and can
// make an actually-steady trend look erratic at a glance.
function movingAverage(values, window){
  const half = Math.floor(window/2);
  return values.map((_,i)=>{
    const lo = Math.max(0, i-half), hi = Math.min(values.length-1, i+half);
    const slice = values.slice(lo, hi+1);
    return slice.reduce((s,v)=>s+v,0)/slice.length;
  });
}

function buildChartSvg(points){
  const w = 300, h = 140, pad = 18;
  if(points.length===0) return emptyStateHtml('chart', 'ما فيه سجل كافي لرسم منحنى بعد');
  if(points.length===1){
    return emptyStateHtml('chart', `سجّل مرة ثانية عشان يظهر منحنى التقدم (آخر وزن: ${points[0].weight} كغ)`);
  }
  const weights = points.map(p=>p.weight);
  const min = Math.min(...weights), max = Math.max(...weights);
  const range = (max-min) || 1;
  const stepX = (w-pad*2) / (points.length-1);
  const yFor = v => h - pad - ((v-min)/range) * (h-pad*2);
  const coords = weights.map((v,i)=> [pad + i*stepX, yFor(v)]);
  const pathD = coords.map((c,i)=> (i===0?'M':'L')+c[0].toFixed(1)+','+c[1].toFixed(1)).join(' ');

  // With enough points, the raw line becomes a thin, muted backdrop (data
  // stays visible, nothing is hidden) and a bold smoothed line on top
  // carries the actual trend — with too few points a moving average isn't
  // meaningfully different from the raw line, so skip it below 5.
  const smoothEnabled = points.length>=5;
  let smoothPathD = '';
  if(smoothEnabled){
    const smoothed = movingAverage(weights, Math.min(5, points.length));
    const sCoords = smoothed.map((v,i)=> [pad + i*stepX, yFor(v)]);
    smoothPathD = sCoords.map((c,i)=> (i===0?'M':'L')+c[0].toFixed(1)+','+c[1].toFixed(1)).join(' ');
  }

  const dots = coords.map((c,i)=> `<circle cx="${c[0].toFixed(1)}" cy="${c[1].toFixed(1)}" r="${smoothEnabled?2.5:3.5}" fill="var(--accent)" ${smoothEnabled?'opacity=".55"':''}/>`).join('');
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" height="140">
    <path d="${pathD}" fill="none" stroke="var(--accent)" stroke-width="${smoothEnabled?1.5:2.5}" stroke-linecap="round" stroke-linejoin="round" opacity="${smoothEnabled?'.4':'1'}"/>
    ${dots}
    ${smoothEnabled ? `<path d="${smoothPathD}" fill="none" stroke="var(--accent)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>` : ''}
  </svg>`;
}

// Two independently-normalized line series on one chart — e.g. weight vs.
// average calories, plotted together so trends line up even though the
// two live on totally different scales (kg vs kcal). Points with value:null
// break the line for that gap instead of connecting across missing data.
function buildDualChartSvg(pointsA, pointsB, opts){
  opts = opts || {};
  const colorA = opts.colorA || 'var(--shoulder)';
  const colorB = opts.colorB || 'var(--protein)';
  const labelA = opts.labelA || '';
  const labelB = opts.labelB || '';
  const w = 300, h = 140, pad = 18;
  const validA = pointsA.filter(p=>p.value!=null);
  const validB = pointsB.filter(p=>p.value!=null);
  if(validA.length<2 || validB.length<2){
    return emptyStateHtml('chart', 'سجّل وزنك وأكلك لأسبوعين متتاليين على الأقل عشان يبين المنحنى');
  }
  const n = Math.max(pointsA.length, pointsB.length);
  const stepX = n>1 ? (w-pad*2)/(n-1) : 0;
  function pathFor(points){
    const vals = points.map(p=>p.value).filter(v=>v!=null);
    if(vals.length<2) return '';
    const min = Math.min(...vals), max = Math.max(...vals);
    const range = (max-min) || 1;
    let d = '', started = false;
    points.forEach((p,i)=>{
      const x = pad + i*stepX;
      if(p.value==null){ started = false; return; }
      const y = h - pad - ((p.value-min)/range) * (h-pad*2);
      d += (started ? 'L' : 'M') + x.toFixed(1) + ',' + y.toFixed(1) + ' ';
      started = true;
    });
    return d.trim();
  }
  const dA = pathFor(pointsA);
  const dB = pathFor(pointsB);
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" height="140">
    ${dA ? `<path d="${dA}" fill="none" stroke="${colorA}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>` : ''}
    ${dB ? `<path d="${dB}" fill="none" stroke="${colorB}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="5,4"/>` : ''}
  </svg>
  <div class="chart-legend">
    <span class="chart-legend-item"><span class="chart-legend-dot" style="background:${colorA}"></span>${escapeHtml(labelA)}</span>
    <span class="chart-legend-item"><span class="chart-legend-dot" style="background:${colorB}"></span>${escapeHtml(labelB)}</span>
  </div>`;
}

// Steps are a discrete per-day total (not a continuously-sampled value like
// weight), so a bar chart reads more honestly than a line chart connecting
// day-to-day dots that implies a trend between them that isn't really
// there. `days` is exactly 7 entries {date, steps}, oldest first (as
// returned by readWeekSteps()/the stepsCache) — every day always present,
// zero-filled rather than sparse, so bar heights are never misleadingly
// skipped. Dashed reference line marks the daily goal.
// Generic bars = [{label, value}], oldest first (leftmost) — same
// left-to-right-is-chronological convention as every other chart in this
// file (SVG coordinate space isn't mirrored by the page's RTL direction,
// so leftmost=oldest reads correctly regardless). Used both for a plain
// daily view (bars.length===7, label = weekday) and a monthly view where
// the caller has already pre-bucketed 30 days into a handful of weekly
// averages (label = a short date) — this function itself doesn't care
// which, it just draws whatever bars it's given against one goal
// reference line.
function buildStepsBarChart(bars, goal){
  if(!bars || bars.length===0) return emptyStateHtml('chart', 'وصّل Health Connect عشان يبين هنا اتجاه خطواتك');
  const w = 300, h = 140, pad = 18, padBottom = 30;
  const maxVal = Math.max(goal, ...bars.map(b=>b.value), 1);
  const plotH = h - pad - padBottom;
  const barSlot = (w - pad*2) / bars.length;
  const barW = Math.min(barSlot*0.55, 26);
  const yFor = v => pad + plotH - (v/maxVal)*plotH;
  const rects = bars.map((b,i)=>{
    const cx = pad + barSlot*i + barSlot/2;
    const y = yFor(b.value);
    const barH = Math.max(pad + plotH - y, b.value>0 ? 2 : 0);
    const met = b.value >= goal;
    return `<g>
      <rect x="${(cx-barW/2).toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${barH.toFixed(1)}" rx="4"
        fill="${met ? 'var(--steps)' : 'var(--steps-soft)'}" stroke="${met ? 'none' : 'var(--steps)'}" stroke-width="${met?0:1.5}"/>
      <text x="${cx.toFixed(1)}" y="${h-14}" text-anchor="middle" font-size="9" fill="var(--text-mute)">${escapeHtml(b.label)}</text>
    </g>`;
  }).join('');
  const goalY = yFor(goal).toFixed(1);
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" height="140">
    <line x1="${pad}" y1="${goalY}" x2="${w-pad}" y2="${goalY}" stroke="var(--text-mute)" stroke-width="1" stroke-dasharray="4,3"/>
    ${rects}
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
      // Unlike every delete action in the app (which gives a 5s undo toast),
      // this instantly replaces 100% of appState with no way back — the old
      // data is simply gone the moment saveLocalOnly()/persist() run below.
      // A blocking confirm here is the minimum needed so a wrong-file tap
      // can't silently wipe someone's real data.
      if(!window.confirm('استرجاع هذي النسخة الاحتياطية بيستبدل كل بياناتك الحالية بالكامل (الأكل، الوزن، الإعدادات...) ولا يمكن التراجع. متأكد؟')) return;
      appState = parsed;
      appState.updatedAt = Date.now();
      saveLocalOnly();
      rebindFromAppState();
      computeStreak();
      renderAll();
      // Same reasoning as the other saveLocalOnly() call sites — a restored
      // backup can carry different reminder settings / goals than what's
      // currently on screen, so the widget and reminder schedule need an
      // explicit refresh here too.
      syncWidget();
      applyReminderSettings();
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

const allSheets = ['sheetQuick','sheetFood','sheetNewFood','sheetEditMeal','sheetApplyTemplate','sheetAiScan','sheetBarcodeScan','sheetSettings','sheetBodyWeight','sheetOnboarding','sheetRecipeBuilder','sheetMealTemplates','sheetShareCard','sheetReport','sheetStepsDetail','sheetWaterDetail'];

function openSheet(id){
  closeAllSheets();
  overlay.classList.add('show');
  document.getElementById(id).classList.add('show');
}

function closeAllSheets(){
  overlay.classList.remove('show');
  allSheets.forEach(id=>document.getElementById(id).classList.remove('show'));
  document.getElementById('fab').classList.remove('rot');
  // The barcode sheet leaves a live camera stream running until this
  // fires — every path that closes a sheet (backdrop tap, ✕ button, or
  // navigating straight into sheetNewFood after a successful scan) goes
  // through here, so this is the one place that reliably stops it instead
  // of leaving the camera light on after the sheet is gone.
  if(typeof stopBarcodeCamera==='function') stopBarcodeCamera();
}

/* ============================================================
   TABS
   ============================================================ */

function switchTab(tab){
  document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b=>b.classList.remove('active'));
  document.getElementById('view-'+tab).classList.add('active');
  document.querySelector(`.nav-btn[data-tab="${tab}"]`).classList.add('active');
  // The floating (+) button is redundant on Home — water already has its
  // own +/- buttons right there, and the FAB used to just float on top of
  // the meals list with nothing useful to add from Home anyway. Keep it on
  // Food/Progress, where it's still the fastest way to add a meal or log a
  // weight/AI scan. #app.has-fab gives the active view extra bottom padding
  // (see styles.css) so the last card in a long list never ends up hidden
  // behind it.
  const fab = document.getElementById('fab');
  const showFab = tab !== 'home';
  if(fab) fab.classList.toggle('fab-hidden', !showFab);
  const appEl = document.getElementById('app');
  if(appEl) appEl.classList.toggle('has-fab', showFab);
  // Opening Progress re-fetches the weekly steps trend — a heavier native
  // aggregate call than the Home card's today-only refresh, so it only
  // happens when the user is actually about to look at it, not on every
  // app resume.
  if(tab==='progress' && appState && appState.healthConnectGranted && typeof refreshStepsHistory==='function') refreshStepsHistory();
}

/* ============================================================
   ANDROID HARDWARE/GESTURE BACK BUTTON
   Silent no-op on the plain web/PWA (Capacitor.Plugins.App doesn't exist
   there — the browser's own back button behavior applies instead, which is
   fine/expected outside the installed app).

   Without this, Capacitor's default Android behavior is to check the
   WebView's own history and exit the app immediately if there's nothing to
   go back to — and since مِقياس is a single-page app that never pushes
   browser history entries (tabs/sheets/viewed-day are all plain JS state,
   not URLs), canGoBack() is always false, so ANY back press instantly
   exited the whole app instead of just closing whatever sheet/state was
   open. This listener takes over that decision entirely: close an open
   sheet first, then return from a non-today viewed day, then return to the
   Home tab, and only actually exit once the user is already at that true
   root screen — with one "press again to exit" confirmation so a single
   stray back tap from Home can't kick them out by accident.
   ============================================================ */
function bindAndroidBackButton(){
  const appPlugin = window.Capacitor && Capacitor.Plugins && Capacitor.Plugins.App;
  if(!appPlugin) return;
  let lastBackPressAt = 0;
  appPlugin.addListener('backButton', ()=>{
    if(document.querySelector('.sheet.show')){
      closeAllSheets();
      return;
    }
    if(typeof isViewingToday==='function' && !isViewingToday()){
      returnToToday();
      return;
    }
    const homeBtn = document.querySelector('.nav-btn[data-tab="home"]');
    if(homeBtn && !homeBtn.classList.contains('active')){
      switchTab('home');
      return;
    }
    const now = Date.now();
    if(now - lastBackPressAt < 2000){
      appPlugin.exitApp();
    } else {
      lastBackPressAt = now;
      showToast('اضغط رجوع مرة ثانية للخروج');
    }
  });
}

/* ============================================================
   MIDNIGHT ROLLOVER — state.today is only ever set once, at init(). A
   phone app very commonly stays alive in the background for hours (the
   user checks it before bed, then again the next morning without ever
   force-closing it) — without this, every log/water tap in that second
   session would silently land on YESTERDAY's date until the user manually
   killed and reopened the app. This re-checks the real date whenever the
   app becomes visible again (tab refocus on web, resume on native) and
   quietly rolls the whole app state over to the new day if it changed.
   Deliberately does NOT yank the user off a past day they're mid-editing —
   only advances state.viewDate/state.log along with state.today when they
   were actually looking at "today" at the moment it rolled over.
   ============================================================ */
function checkDateRollover(){
  const freshToday = todayKey();
  if(freshToday === state.today) return;
  const wasViewingToday = (state.viewDate === state.today);
  state.today = freshToday;
  if(!appState.logs[state.today]) appState.logs[state.today] = {meals:[], waterMl:0};
  if(appState.logs[state.today].waterMl===undefined) appState.logs[state.today].waterMl = 0;
  if(wasViewingToday){
    state.viewDate = state.today;
    state.log = appState.logs[state.today];
  }
  const dateTextEl = document.getElementById('dateText');
  if(dateTextEl) dateTextEl.textContent = formatDateHuman(new Date());
  if(typeof setGreeting==='function') setGreeting();
  computeStreak();
  renderAll();
  // Without this, a rollover only ever updated in-memory state — nothing
  // wrote the fresh empty day back to localStorage/cloud, and the
  // home-screen widget kept showing yesterday's numbers (or yesterday's
  // stale "goal reached" ring color) until some unrelated action in the
  // app happened to call persist() on its own.
  persist();
}

// Runs on every return-to-foreground, not just a date rollover — steps are
// "as of last sync" data (Zepp/the watch push to Health Connect on their
// own schedule, mِقياس doesn't stream it), so re-checking on resume is the
// cheapest way to keep the Home card from ever looking too stale without
// polling in the background. Reminder text/schedules are refreshed here
// too (meal reminder body reflects whether today's meals are logged yet —
// see scheduleMealReminder() — which only stays accurate if this runs on
// every foreground, not just when Settings is opened).
function onAppForeground(){
  checkDateRollover();
  if(appState && appState.healthConnectGranted && typeof refreshSteps==='function') refreshSteps();
  if(typeof applyReminderSettings==='function') applyReminderSettings();
}

function bindDateRolloverCheck(){
  document.addEventListener('visibilitychange', ()=>{ if(!document.hidden) onAppForeground(); });
  const appPlugin = window.Capacitor && Capacitor.Plugins && Capacitor.Plugins.App;
  if(appPlugin && appPlugin.addListener){
    appPlugin.addListener('appStateChange', ({isActive})=>{ if(isActive) onAppForeground(); });
    appPlugin.addListener('resume', ()=> onAppForeground());
  }
}

/* ============================================================
   FOOD SHEET (picker within FAB flow)
   ============================================================ */

