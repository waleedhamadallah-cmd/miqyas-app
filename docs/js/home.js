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
  const remain = Math.max(goal.calories - cal, 0);
  document.getElementById('calRemain').textContent = remain.toLocaleString('en-US');
  document.getElementById('calSub').textContent = `${cal.toLocaleString('en-US')} من ${goal.calories.toLocaleString('en-US')}`;

  const pct = Math.min(cal / Math.max(goal.calories,1), 1);
  const r = 86, circumference = 2*Math.PI*r;
  const el = document.getElementById('ringProgress');
  el.style.strokeDasharray = `${circumference}`;
  el.style.strokeDashoffset = `${circumference * (1-pct)}`;
  el.style.transition = 'stroke-dashoffset .6s cubic-bezier(.2,.8,.2,1)';

  setMacro('p', p, goal.protein); setMacro('c', c, goal.carbs); setMacro('f', f, goal.fat);
}

function setMacro(key, val, goal){
  const map = {p:'pVal',c:'cVal',f:'fVal'};
  const fillMap = {p:'pFill',c:'cFill',f:'fFill'};
  document.getElementById(map[key]).textContent = `${Math.round(val)}/${goal}`;
  const pct = Math.min((val/Math.max(goal,1))*100, 100);
  document.getElementById(fillMap[key]).style.width = pct+'%';
}

function renderStreak(){
  document.getElementById('streakN').textContent = state.streak;
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
  if(prevDays===0 || thisDays===0){
    compareHtml = `<div class="insight-row"><div class="insight-icon" style="background:var(--carb-soft); color:var(--carb);">📊</div>
      <div class="insight-tx"><div class="it1">لسا مب كافي بيانات للمقارنة</div><div class="it2">سجل أكثر عشان تشوف مقارنة شهرية</div></div></div>`;
  } else {
    const diffPct = Math.round(((thisAvg-prevAvg)/prevAvg)*100);
    const up = diffPct>=0;
    compareHtml = `<div class="insight-row"><div class="insight-icon" style="background:var(--protein-soft); color:var(--protein);">${up?'📈':'📉'}</div>
      <div class="insight-tx"><div class="it1">بروتينك هالشهر ${up?'أعلى':'أقل'} ${Math.abs(diffPct)}٪ من الشهر اللي فات</div><div class="it2">متوسط ${Math.round(thisAvg)}غ يومياً مقابل ${Math.round(prevAvg)}غ</div></div></div>`;
  }

  const adherencePct = thisLoggedDays ? Math.round((thisAdherent/thisLoggedDays)*100) : 0;
  const adherenceHtml = `<div class="insight-row"><div class="insight-icon" style="background:var(--fat-soft); color:var(--fat);">🎯</div>
    <div class="insight-tx"><div class="it1">التزمت بهدف السعرات ${thisAdherent} من ${thisLoggedDays} يوم هالشهر</div><div class="it2">${adherencePct}٪ من الأيام اللي سجلتها ضمن الهدف</div></div></div>`;

  wrap.innerHTML = compareHtml + adherenceHtml;
}

function renderQuickChips(){
  const wrap = document.getElementById('quickChips');
  wrap.innerHTML = '';
  if(state.library.foods.length===0){
    wrap.innerHTML = '<div class="empty-hint">مكتبتك فاضية، ضيف وجبة عشان تبدأ</div>';
    return;
  }
  const top = [...state.library.foods].sort((a,b)=>b.usageCount-a.usageCount).slice(0,8);
  top.forEach(food=>{
    const chip = document.createElement('div');
    chip.className = 'food-chip';
    chip.innerHTML = `<div class="plus">+</div><div class="fname">${escapeHtml(food.name)}</div><div class="fcal tabular">${food.calories} سعرة</div>`;
    chip.addEventListener('click', ()=> quickAddFood(food, chip));
    wrap.appendChild(chip);
  });
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
    wrap.innerHTML = '<div class="empty-hint">لسا ما سجلت شي اليوم. اضغط + وابدأ 🍽️</div>';
    return;
  }
  meals.forEach(m=>{
    const row = document.createElement('div');
    row.className = 'entry-row';
    row.innerHTML = `<div class="entry-dot" style="background:var(--protein)"></div>
      <div class="entry-main"><div class="t1">${escapeHtml(m.name)}</div><div class="t2">${m.category} · ب${Math.round(m.protein)} ك${Math.round(m.carbs)} د${Math.round(m.fat)}</div></div>
      <div class="entry-side tabular">${m.calories}</div>`;
    wrap.appendChild(row);
  });
}

function renderWaterCard(){
  const ml = state.log.waterMl || 0;
  const goal = state.goals.water || 2500;
  document.getElementById('waterValText').textContent = `${ml.toLocaleString('en-US')} / ${goal.toLocaleString('en-US')} مل`;
  const pct = Math.min((ml/Math.max(goal,1))*100, 100);
  document.getElementById('waterFill').style.width = pct+'%';
}
function addWater(deltaMl){
  state.log.waterMl = Math.max(0, (state.log.waterMl||0) + deltaMl);
  persist();
  renderWaterCard();
  vibrate(12);
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
  ['mealsTodayLabel','foodMealsLabel','foodDistLabel'].forEach(id=>{
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
      switchViewedDay(key);
      if(!isToday) switchTab('food');
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
