/* ============================================================
   REMINDERS: local notification scheduling via @capacitor/local-notifications.
   Entirely a no-op outside the installed native app (the plugin object
   simply won't exist in a browser/PWA context) — every function here is
   safe to call unconditionally from anywhere in the app. Follows the same
   Capacitor.Plugins.X bridge pattern used by syncWidget()/healthConnectPlugin()
   in core.js.
   ============================================================ */

// Fixed notification IDs so re-scheduling always replaces the previous
// one instead of stacking duplicates. Water reminders occupy a small
// reserved ID range (capped at 12 slots/day — plenty for any realistic
// interval, and keeps us far from the meal reminder's ID).
const REMINDER_ID_MEAL = 9001;
const REMINDER_ID_WATER_BASE = 9100;
const REMINDER_WATER_MAX_SLOTS = 12;
const REMINDER_ID_STEPS_GOAL = 9200;

function localNotificationsPlugin(){
  return (window.Capacitor && Capacitor.Plugins && Capacitor.Plugins.LocalNotifications)
    ? Capacitor.Plugins.LocalNotifications : null;
}

function remindersAvailable(){
  return !!localNotificationsPlugin();
}

async function hasReminderPermission(){
  const plugin = localNotificationsPlugin();
  if(!plugin) return false;
  try{
    const res = await plugin.checkPermissions();
    return res && res.display === 'granted';
  }catch(e){ return false; }
}

async function requestReminderPermission(){
  const plugin = localNotificationsPlugin();
  if(!plugin) return {ok:false, reason:'not-native'};
  try{
    const res = await plugin.requestPermissions();
    const granted = res && res.display === 'granted';
    return {ok: granted, reason: granted ? 'granted' : 'denied'};
  }catch(e){
    return {ok:false, reason:'error', message: e && e.message};
  }
}

// "HH:MM" -> {h, m}. Falls back to a sane default if malformed.
function parseTimeHHMM(str, fallback){
  const m = /^(\d{1,2}):(\d{2})$/.exec((str||'').trim());
  if(!m) return parseTimeHHMM(fallback || '09:00');
  const h = Math.min(23, Math.max(0, parseInt(m[1],10)));
  const mi = Math.min(59, Math.max(0, parseInt(m[2],10)));
  return {h, m: mi};
}

async function cancelMealReminder(){
  const plugin = localNotificationsPlugin();
  if(!plugin) return;
  try{ await plugin.cancel({notifications:[{id:REMINDER_ID_MEAL}]}); }catch(e){ /* no-op */ }
}

async function scheduleMealReminder(timeStr){
  const plugin = localNotificationsPlugin();
  if(!plugin) return;
  const {h, m} = parseTimeHHMM(timeStr, '20:00');
  try{
    // Reflects whether today's meals are already logged at schedule time —
    // best-effort personalization; the body text is fixed once scheduled
    // (a daily repeating notification can't be recomputed on the fly), and
    // gets refreshed the next time applyReminderSettings() runs (e.g. on
    // every app open/foreground).
    const key = todayKey(new Date());
    const dayLog = (appState && appState.logs && appState.logs[key]) || {meals:[]};
    const hasLogged = (dayLog.meals||[]).length > 0;
    const body = hasLogged
      ? 'لا تنسَ إكمال تسجيل وجباتك لهذا اليوم 🍽️'
      : 'ما سجّلت أي وجبة اليوم لسا — سجّل وجباتك في مِقياس 🍽️';
    await plugin.schedule({
      notifications: [{
        id: REMINDER_ID_MEAL,
        title: 'تذكير بتسجيل الأكل',
        body,
        schedule: { on: { hour: h, minute: m }, allowWhileIdle: true },
        smallIcon: 'ic_stat_icon'
      }]
    });
  }catch(e){ console.error('scheduleMealReminder failed', e); }
}

async function cancelWaterReminders(){
  const plugin = localNotificationsPlugin();
  if(!plugin) return;
  try{
    const ids = [];
    for(let i=0;i<REMINDER_WATER_MAX_SLOTS;i++) ids.push({id: REMINDER_ID_WATER_BASE + i});
    await plugin.cancel({notifications: ids});
  }catch(e){ /* no-op */ }
}

async function scheduleWaterReminders(startStr, endStr, intervalHours){
  const plugin = localNotificationsPlugin();
  if(!plugin) return;
  const start = parseTimeHHMM(startStr, '09:00');
  const end = parseTimeHHMM(endStr, '21:00');
  const interval = Math.max(1, Math.min(12, Math.round(intervalHours) || 2));

  const startMin = start.h*60 + start.m;
  let endMin = end.h*60 + end.m;
  if(endMin <= startMin) endMin += 24*60; // supports an end time past midnight

  const notifications = [];
  let t = startMin;
  let slot = 0;
  while(t <= endMin && slot < REMINDER_WATER_MAX_SLOTS){
    const h = Math.floor(t/60) % 24;
    const m = t % 60;
    notifications.push({
      id: REMINDER_ID_WATER_BASE + slot,
      title: 'تذكير بشرب الماء',
      body: 'وقت شرب كوب ماء 💧',
      schedule: { on: { hour: h, minute: m }, allowWhileIdle: true },
      smallIcon: 'ic_stat_icon'
    });
    slot++;
    t += interval*60;
  }
  try{ await plugin.schedule({ notifications }); }catch(e){ console.error('scheduleWaterReminders failed', e); }
}

// One-off, near-immediate notification (no repeating `on:` schedule like
// the meal/water reminders above) — called from cacheSteps() in core.js
// the moment today's synced step count first crosses the daily goal.
// Silently does nothing without notification permission already granted
// (never prompts for it on its own — that only ever happens from the
// Reminders section in Settings, same as the meal/water reminders).
async function notifyStepsGoalReached(steps, goal){
  const plugin = localNotificationsPlugin();
  if(!plugin) return;
  try{
    if(!(await hasReminderPermission())) return;
    await plugin.schedule({
      notifications: [{
        id: REMINDER_ID_STEPS_GOAL,
        title: 'وصلت هدف خطواتك اليوم 🎉',
        body: `${Math.round(steps).toLocaleString('en-US')} خطوة من ${Math.round(goal).toLocaleString('en-US')} — أحسنت!`,
        schedule: { at: new Date(Date.now() + 500), allowWhileIdle: true },
        smallIcon: 'ic_stat_icon'
      }]
    });
  }catch(e){ console.error('notifyStepsGoalReached failed', e); }
}

// Single entry point: reads appState.reminders and (re)applies everything —
// cancels + reschedules from scratch each time, which keeps this idempotent
// and safe to call after every settings change or on every app open.
async function applyReminderSettings(){
  try{
    if(!appState || !appState.reminders) return;
    if(!remindersAvailable()) return; // silent no-op on web/PWA
    const r = appState.reminders;

    if(r.mealEnabled){
      const granted = await hasReminderPermission();
      if(granted) await scheduleMealReminder(r.mealTime);
      else await cancelMealReminder();
    } else {
      await cancelMealReminder();
    }

    if(r.waterEnabled){
      const granted = await hasReminderPermission();
      if(granted) await scheduleWaterReminders(r.waterStart, r.waterEnd, r.waterIntervalHours);
      else await cancelWaterReminders();
    } else {
      await cancelWaterReminders();
    }
  }catch(e){ console.error('applyReminderSettings failed', e); }
}
