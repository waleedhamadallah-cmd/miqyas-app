/* ============================================================
   HOME TAB: dashboard ring, macros, streak, week progress,
   monthly insight card, quick-add chips, today's summary
   ============================================================ */
function sumLog(){
  let cal=0,p=0,c=0,f=0;
  state.log.meals.forEach(m=>{ cal+=m.calories; p+=m.protein; c+=m.carbs; f+=m.fat; });
  return {cal,p,c,f};
}

function renderRing(){
  const {cal,p,c,f} = sumLog();
  const goal = state.goals;
  const over = cal > goal.calories;
  const remain = Math.abs(goal.calories - cal);

  animateCount(document.getElementById('calRemain'), remain);
  document.getElementById('calSub').textContent = `${cal.toLocaleString('en-US')} من ${goal.calories.toLocaleString('en-US')}`;
  const lblEl = document.querySelector('.ring-center .lbl');
  if(lblEl) lblEl.textContent = over ? 'سعرة زيادة عن الهدف' : 'سعرة متبقية';
  const centerEl = document.querySelector('.ring-center');
  if(centerEl) centerEl.classList.toggle('over-goal', over);
  document.getElementById('ringSvg').classList.toggle('over-goal', over);

  const pct = Math.min(cal / Math.max(goal.calories,1), 1);
  const r = 86, circumference = 2*Math.PI*r;
  const el = document.getElementById('ringProgress');
  el.style.strokeDasharray = `${circumference}`;
  el.style.strokeDashoffset = `${circumference * (1-pct)}`;
  el.style.transition = 'stroke-dashoffset .6s cubic-bezier(.2,.8,.2,1)';
  el.setAttribute('stroke', over ? 'url(#ringGradOver)' : 'url(#ringGrad)');

  setMacro('p', p, goal.protein); setMacro('c', c, goal.carbs); setMacro('f', f, goal.fat);
}

function setMacro(key, val, goal){
  const map = {p:'pVal',c:'cVal',f:'fVal'};
  const fillMap = {p:'pFill',c:'cFill',f:'fFill'};
  const over = val > goal;
  document.getElementById(map[key]).textContent = `${Math.round(val)}/${goal}`;
  const pct = Math.min((val/Math.max(goal,1))*100, 100);
  const fillEl = document.getElementById(fillMap[key]);
  fillEl.style.width = pct+'%';
  const pillEl = fillEl.closest('.macro-pill');
  if(pillEl) pillEl.classList.toggle('over', over);
}

function streakFlameTier(streak){
  if(streak<=0) return 0;
  if(streak<3) return 1;
  if(streak<7) return 2;
  if(streak<30) return 3;
  return 4;
}
function renderStreak(){
  document.getElementById('streakN').textContent = state.streak;
  const flameEl = document.getElementById('streakFlame');
  if(flameEl){
    for(let t=0;t<=4;t++) flameEl.classList.remove('tier-'+t);
    flameEl.classList.add('tier-'+streakFlameTier(state.streak));
  }
  const wrap = document.getElementById('streakDots');
  wrap.innerHTML = '';
  state.streakDays.forEach(on=>{
    const d = document.createElement('div');
    d.className = 'streak-dot'+(on?' on':'');
    wrap.appendChild(d);
  });
}

function renderWeekProgress(){
  document.getElementById('weekProgressText').textContent = `${state.weekLoggedDays} من 7`;
  const pct = (state.weekLoggedDays/7)*100;
  document.getElementById('weekProgressFill').style.width = pct+'%';
}

function monthKeyOf(dateKey){ return dateKey.slice(0,7); }

function renderInsightCard(){
  const wrap = document.getElementById('insightCard');
  const now = new Date();
  const thisMonth = todayKey(now).slice(0,7);
  const prevDate = new Date(now.getFullYear(), now.getMonth()-1, 1);
  const prevMonth = todayKey(prevDate).slice(0,7);

  let thisProtein=0, thisDays=0, thisAdherent=0, thisLoggedDays=0;
  let prevProtein=0, prevDays=0;

  Object.keys(appState.logs).forEach(dateKey=>{
    const dayLog = appState.logs[dateKey];
    const mk = monthKeyOf(dateKey);
    const meals = dayLog.meals||[];
    if(meals.length===0) return;
    const cal = meals.reduce((s,m)=>s+m.calories,0);
    const p = meals.reduce((s,m)=>s+m.protein,0);
    if(mk===thisMonth){
      thisProtein += p; thisDays++; thisLoggedDays++;
      if(Math.abs(cal-state.goals.calories) <= state.goals.calories*0.15) thisAdherent++;
    } else if(mk===prevMonth){
      prevProtein += p; prevDays++;
    }
  });

  const thisAvg = thisDays ? thisProtein/thisDays : 0;
  const prevAvg = prevDays ? prevProtein/prevDays : 0;
  let compareHtml;
  // prevAvg===0 is its own guard, separate from prevDays===0: a user who
  // logged meals last month with zero protein recorded on all of them
  // (prevDays>0 but prevProtein===0) would otherwise divide by zero below
  // and show "Infinity%"/"NaN%" instead of a real comparison.
  if(prevDays===0 || thisDays===0 || prevAvg===0){
    compareHtml = `<div class="insight-row"><div class="insight-icon" style="background:var(--carb-soft); color:var(--carb-text);">${ICON_BAR_CHART}</div>
      <div class="insight-tx"><div class="it1">لسا مب كافي بيانات للمقارنة</div><div class="it2">سجل أكثر عشان تشوف مقارنة شهرية</div></div></div>`;
  } else {
    const diffPct = Math.round(((thisAvg-prevAvg)/prevAvg)*100);
    const up = diffPct>=0;
    compareHtml = `<div class="insight-row"><div class="insight-icon" style="background:var(--protein-soft); color:var(--protein-text);">${up?ICON_TREND_UP:ICON_TREND_DOWN}</div>
      <div class="insight-tx"><div class="it1">بروتينك هالشهر ${up?'أعلى':'أقل'} ${Math.abs(diffPct)}٪ من الشهر اللي فات</div><div class="it2">متوسط ${Math.round(thisAvg)}غ يومياً مقابل ${Math.round(prevAvg)}غ</div></div></div>`;
  }

  const adherencePct = thisLoggedDays ? Math.round((thisAdherent/thisLoggedDays)*100) : 0;
  const adherenceHtml = `<div class="insight-row"><div class="insight-icon" style="background:var(--fat-soft); color:var(--fat-text);">${ICON_TARGET}</div>
    <div class="insight-tx"><div class="it1">التزمت بهدف السعرات ${thisAdherent} من ${thisLoggedDays} يوم هالشهر</div><div class="it2">${adherencePct}٪ من الأيام اللي سجلتها ضمن الهدف</div></div></div>`;

  wrap.innerHTML = compareHtml + adherenceHtml;
}

function fmtDuration(sec){
  if(!sec) return '';
  const m = Math.round(sec/60);
  return m<1 ? 'أقل من دقيقة' : `${m} د`;
}

function renderTodaySummary(){
  const wrap = document.getElementById('todaySummary');
  wrap.innerHTML = '';
  const meals = [...state.log.meals].sort((a,b)=> (a.time||0) - (b.time||0));
  if(meals.length===0){
    wrap.innerHTML = emptyStateHtml('meal', 'لسا ما سجلت شي اليوم. اضغط + وابدأ');
    return;
  }
  meals.forEach(m=>{
    const row = document.createElement('div');
    row.className = 'entry-tile';
    const qtyTag = (m.qty!==undefined && m.qty!==1) ? ` · ×${trimQtyDisplay(m.qty)}` : '';
    row.innerHTML = `
      <div class="et-name">${escapeHtml(m.name)}</div>
      <div class="et-cal tabular">${m.calories}</div>
      <div class="et-macros tabular">ب${Math.round(m.protein)} ك${Math.round(m.carbs)} د${Math.round(m.fat)}${qtyTag}</div>`;
    row.addEventListener('click', ()=> openEditMealSheet(m.id));
    wrap.appendChild(row);
  });
}

function renderWaterCard(){
  const ml = state.log.waterMl || 0;
  const goal = state.goals.water || 2500;
  // "current / goal" needs an explicit LTR bidi isolate around the numeric
  // part — without it, the browser's bidi algorithm sees two numbers
  // separated by "/" immediately followed by an Arabic word ("مل") and
  // silently swaps which number reads first, so the DOM correctly says
  // e.g. "100 / 9,000" while the screen shows "9,000 / 100" (confirmed by
  // screenshot). Same fix already applied to the BMI gauge's tick labels
  // (.bmi-ticks{direction:ltr}) for the same reason.
  document.getElementById('waterValText').innerHTML =
    `<span class="ltr-num">${ml.toLocaleString('en-US')} / ${goal.toLocaleString('en-US')}</span> مل`;
  const pct = Math.min((ml/Math.max(goal,1))*100, 100);
  document.getElementById('waterFill').style.width = pct+'%';

  // Compact Home tile (sits beside the steps tile) — same numbers, painted
  // as a ring instead of a bar to match the steps mini row it's now next
  // to. The actual bar + quick-add chips + custom input live one tap away
  // in #sheetWaterDetail, opened via openWaterDetail() below.
  const miniValEl = document.getElementById('waterMiniValText');
  if(miniValEl){
    miniValEl.innerHTML = `<span class="ltr-num">${ml.toLocaleString('en-US')} / ${goal.toLocaleString('en-US')}</span>`;
    paintStepsRing('waterMiniRingProgress', 42, Math.min(ml/Math.max(goal,1), 1));
  }
}
function addWater(deltaMl){
  state.log.waterMl = Math.max(0, (state.log.waterMl||0) + deltaMl);
  persist();
  syncHealthConnectHydration(deltaMl);
  renderWaterCard();
  vibrate(12);
}
function openWaterDetail(){
  renderWaterCard();
  openSheet('sheetWaterDetail');
}

/* ============================================================
   STEPS — read-only, synced from Health Connect (written there by a
   wearable's companion app, e.g. Zepp). The Home row always shows
   TODAY's count regardless of state.viewDate — Health Connect step
   history for an arbitrary past day isn't wired (only the trailing
   30-day window used by the detail sheet/Progress trend is), and steps
   aren't something the user backdates/edits like a meal, so "today" is
   the only day the row itself ever needs to represent.

   Modeled on how a dedicated step-counter app (e.g. StepsApp) presents
   this: a ring (not a flat bar — a ring reads as "this is a real,
   first-class number" the way the calorie ring does), tappable into a
   full detail sheet with a bigger ring, distance, estimated calories
   burned, a goal-day streak, and a week/month history chart. On Home
   itself this is kept to ONE compact row — just the ring + count/goal —
   sharing a single card shell with the streak/week-progress rows (see
   .stats-combo in styles.css) instead of being its own separate card;
   distance/calories/streak only ever show in the detail sheet, so the
   Home screen doesn't repeat information across two places just to stay
   "complete".

   Three connection states, purely a function of (a) whether the native
   plugin exists at all and (b) appState.healthConnectGranted — rendering
   never fetches, only reads whatever core.js's healthConnectReadTodaySteps()/
   healthConnectReadStepsHistory() already cached, so these are always
   safe/cheap to call from renderAll():
     A) no plugin (plain web/PWA)      -> hide the row entirely
     B) plugin, not granted yet        -> lightweight inline connect prompt
     C) granted                        -> real row (cached count/goal ring +
                                           honest last-synced caption; a
                                           day with no fetch yet today reads
                                           as "لم تتم المزامنة اليوم بعد",
                                           never silently shown as state B)
   ============================================================ */
function stepsFreshnessCaption(fetchedAt){
  if(!fetchedAt) return {text:'لم تتم المزامنة اليوم بعد', stale:false};
  const diffMs = Date.now() - fetchedAt;
  const diffMin = Math.floor(diffMs/60000);
  let text;
  if(diffMin < 1) text = 'آخر مزامنة: الآن';
  else if(diffMin < 60) text = `آخر مزامنة: قبل ${diffMin} دقيقة`;
  else{
    const diffHr = Math.floor(diffMin/60);
    if(diffHr < 24) text = `آخر مزامنة: قبل ${diffHr} ساعة`;
    else text = `آخر مزامنة: قبل ${Math.floor(diffHr/24)} يوم`;
  }
  return {text, stale: diffMs > 24*60*60*1000};
}

// Shared by the Home card's small ring and the detail sheet's big ring —
// same technique renderRing() uses for the main calorie ring (stroke-dasharray
// trick on an SVG <circle>), just parameterized by element id + radius so
// both sizes share one implementation.
function paintStepsRing(elId, r, pct){
  const el = document.getElementById(elId);
  if(!el) return;
  const circumference = 2*Math.PI*r;
  el.style.strokeDasharray = `${circumference}`;
  el.style.strokeDashoffset = `${circumference * (1-pct)}`;
  el.style.transition = 'stroke-dashoffset .6s cubic-bezier(.2,.8,.2,1)';
}

function renderStepsCard(){
  const card = document.getElementById('stepsCard');
  if(!card) return;
  const connectWrap = document.getElementById('stepsCardConnect');
  const dataWrap = document.getElementById('stepsCardData');
  const plugin = healthConnectPlugin();
  if(!plugin){
    // No step data source exists at all here (plain web/PWA, or a native
    // build missing the plugin) — hide the whole card rather than show a
    // connect prompt that could never do anything.
    card.style.display = 'none';
    return;
  }
  card.style.display = '';
  if(!appState.healthConnectGranted){
    connectWrap.style.display = '';
    dataWrap.style.display = 'none';
    return;
  }
  connectWrap.style.display = 'none';
  dataWrap.style.display = '';
  const cached = (appState.stepsCache && appState.stepsCache[todayKey(new Date())]) || null;
  const steps = cached ? cached.steps : 0;
  const goal = state.goals.steps || 8000;
  const pct = Math.min(steps/Math.max(goal,1), 1);

  paintStepsRing('stepsRingProgress', 42, pct);
  document.getElementById('stepsValText').textContent = steps.toLocaleString('en-US');
  document.getElementById('stepsGoalText').textContent = goal.toLocaleString('en-US');
  // Distance/calories are deliberately NOT duplicated on this compact Home
  // row (that's what made the old design tall) — they're one tap away in
  // #sheetStepsDetail via renderStepsDetail().

  const fresh = stepsFreshnessCaption(cached ? cached.fetchedAt : null);
  const captionEl = document.getElementById('stepsCaption');
  captionEl.textContent = fresh.text;
  captionEl.classList.toggle('stale', fresh.stale);
}

// Fire-and-forget: fetch today's real count from Health Connect, then
// re-render. Safe to call whenever (init, app resume, right after the
// user grants access) — healthConnectReadTodaySteps() itself is a no-op
// that resolves null outside the native app / without permission.
async function refreshSteps(){
  await healthConnectReadTodaySteps();
  renderStepsCard();
  if(typeof renderStepsDetail==='function') renderStepsDetail();
}

/* ============================================================
   STEPS DETAIL SHEET — opened by tapping the Home steps card (or the
   Progress-tab weekly preview). Bigger ring + streak badge, distance and
   estimated calories, and a week/7-day ↔ month/30-day chart toggle —
   see stepsBarsForRange()/refreshStepsHistory() in progress.js for how
   the 30-day cache backing all of this gets populated.
   ============================================================ */
let stepsDetailPeriod = 7;

// 30 cached days grouped into 5 six-day buckets, most-recent-day-of-each-
// bucket used as its label (short d/m, not a weekday name — a bucket
// spans multiple weekdays so a single weekday label would be misleading).
// Each bar is that bucket's daily AVERAGE, compared against the same daily
// goal line the 7-day view uses — matches how StepsApp's own "monthly"
// view reads (weekly averages, not 30 illegibly-thin daily bars).
function stepsMonthlyBars(){
  const goal = state.goals.steps || 8000;
  const bucketSize = 6, bucketCount = 5;
  const bars = [];
  for(let b=bucketCount-1; b>=0; b--){
    let sum = 0, have = 0;
    for(let d=0; d<bucketSize; d++){
      const key = dateKeyOffset(b*bucketSize + d);
      const entry = appState.stepsCache && appState.stepsCache[key];
      if(entry){ sum += entry.steps; have++; }
    }
    const repDate = new Date(dateKeyOffset(b*bucketSize)+'T00:00:00');
    bars.push({label: `${repDate.getDate()}/${repDate.getMonth()+1}`, value: have ? Math.round(sum/bucketSize) : 0});
  }
  return {bars, goal};
}

function openStepsDetail(){
  stepsDetailPeriod = 7;
  document.querySelectorAll('#stepsPeriodBar .filter-chip').forEach(c=> c.classList.toggle('active', c.getAttribute('data-period')==='7'));
  renderStepsDetail();
  openSheet('sheetStepsDetail');
  // The sheet's own 30-day fetch — cheap to call every open since it's a
  // single native aggregate call, and keeps the streak/monthly view from
  // ever silently going stale across sessions.
  if(typeof refreshStepsHistory==='function') refreshStepsHistory();
}

function renderStepsDetail(){
  const sheet = document.getElementById('sheetStepsDetail');
  if(!sheet) return;
  const goal = state.goals.steps || 8000;
  const todayEntry = (appState.stepsCache && appState.stepsCache[todayKey(new Date())]) || null;
  const todaySteps = todayEntry ? todayEntry.steps : 0;
  const pct = Math.min(todaySteps/Math.max(goal,1), 1);

  paintStepsRing('stepsDetailRingProgress', 42, pct);
  document.getElementById('stepsDetailValText').textContent = todaySteps.toLocaleString('en-US');
  document.getElementById('stepsDetailGoalText').textContent = `من ${goal.toLocaleString('en-US')}`;

  const streak = typeof computeStepsStreak==='function' ? computeStepsStreak() : 0;
  document.getElementById('stepsStreakN').textContent = streak;
  const flameEl = document.getElementById('stepsStreakFlame');
  if(flameEl){
    for(let t=0;t<=4;t++) flameEl.classList.remove('tier-'+t);
    flameEl.classList.add('tier-'+streakFlameTier(streak));
  }

  document.getElementById('stepsDetailDist').textContent = `${estimateStepsDistanceKm(todaySteps).toFixed(2)} كم`;
  document.getElementById('stepsDetailCal').textContent = Math.round(estimateStepsCalories(todaySteps)).toLocaleString('en-US');
  // stepsFreshnessCaption() returns a full sentence ("آخر مزامنة: قبل 5
  // دقائق") meant to stand alone as the Home card's caption line. Here it's
  // shown under a ".sd-label" that already reads "آخر مزامنة", so the raw
  // text would repeat the label twice — strip the redundant prefix, keeping
  // just the value ("قبل 5 دقائق" / "الآن" / "لم تتم المزامنة اليوم بعد").
  const fresh = stepsFreshnessCaption(todayEntry ? todayEntry.fetchedAt : null);
  document.getElementById('stepsDetailSync').textContent = fresh.text.replace(/^آخر مزامنة:\s*/, '');

  const {bars} = stepsDetailPeriod===30 ? stepsMonthlyBars() : stepsBarsForRange(7);
  const chartWrap = document.getElementById('stepsDetailChart');
  if(chartWrap) chartWrap.innerHTML = buildStepsBarChart(bars, goal);
  const avg = bars.length ? Math.round(bars.reduce((s,b)=>s+b.value,0)/bars.length) : 0;
  const hintEl = document.getElementById('stepsDetailHint');
  if(hintEl){
    hintEl.textContent = stepsDetailPeriod===30
      ? `متوسط الشهر: ${avg.toLocaleString('en-US')} خطوة/يوم`
      : `متوسط الأسبوع: ${avg.toLocaleString('en-US')} خطوة/يوم`;
  }
}

/* ============================================================
   DAYS STRIP — jump the whole app into viewing/editing another
   day (past or future), right = past, left = today → coming days
   ============================================================ */
function isViewingToday(){ return state.viewDate === state.today; }

function switchViewedDay(dateKey){
  state.viewDate = dateKey;
  if(!appState.logs[dateKey]) appState.logs[dateKey] = {meals:[], waterMl:0};
  if(appState.logs[dateKey].waterMl===undefined) appState.logs[dateKey].waterMl = 0;
  state.log = appState.logs[dateKey];
  renderAll();
}

function returnToToday(){
  switchViewedDay(state.today);
  switchTab('home');
}

function renderViewedDayBanner(){
  const banner = document.getElementById('viewDayBanner');
  if(!banner) return;
  if(isViewingToday()){ banner.style.display = 'none'; return; }
  const d = new Date(state.viewDate+'T00:00:00');
  document.getElementById('viewDayBannerText').textContent = `تعدّل يوم: ${formatDateHuman(d)}`;
  banner.style.display = 'flex';
}

function renderViewedDayLabels(){
  const label = isViewingToday() ? 'اليوم' : formatDateHuman(new Date(state.viewDate+'T00:00:00'));
  ['mealsTodayLabel','foodMealsLabel'].forEach(id=>{
    const el = document.getElementById(id);
    if(el) el.textContent = label;
  });
}

let pastStripInitialized = false;
function renderPastDaysStrip(){
  const wrap = document.getElementById('pastDaysStrip');
  if(!wrap) return;
  const prevScroll = wrap.scrollLeft;
  wrap.innerHTML = '';

  const makePill = (key, isToday)=>{
    const d = new Date(key+'T00:00:00');
    const dayLog = appState.logs[key];
    const hasMeals = !!(dayLog && dayLog.meals && dayLog.meals.length>0);
    const pill = document.createElement('div');
    pill.className = 'date-pill'
      + (hasMeals ? ' logged' : '')
      + (isToday ? ' today' : '')
      + (key===state.viewDate ? ' viewed' : '');
    const label = isToday ? 'اليوم' : DAY_LABELS[d.getDay()];
    pill.innerHTML = `<div class="dpl">${label}</div><div class="dpn tabular">${d.getDate()}</div><div class="dpdot"></div>`;
    pill.addEventListener('click', ()=>{
      // Just switch the viewed day in place — it used to also force-navigate
      // to the food tab, which yanked the user off the home screen every
      // time they tapped a past day just to glance at it.
      switchViewedDay(key);
    });
    return pill;
  };

  for(let i=10;i>=1;i--){ wrap.appendChild(makePill(dateKeyOffset(i), false)); }
  wrap.appendChild(makePill(state.today, true));
  for(let i=1;i<=3;i++){ wrap.appendChild(makePill(dateKeyOffset(-i), false)); }

  if(!pastStripInitialized){
    pastStripInitialized = true;
    const todayPill = wrap.querySelector('.date-pill.today');
    if(todayPill) todayPill.scrollIntoView({inline:'center', block:'nearest'});
  } else {
    wrap.scrollLeft = prevScroll;
  }
}

/* ============================================================
   RENDER: FOOD VIEW
   ============================================================ */

