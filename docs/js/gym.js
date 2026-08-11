/* ============================================================
   GYM TAB: workout log, history, muscle heat map, weekly plan,
   plan editor, exercise picker + superset selection
   ============================================================ */
function computeGymWeekStats(){
  let count=0, volume=0;
  for(let i=0;i<=6;i++){
    const key = dateKeyOffset(i);
    const dayLog = (i===0) ? state.log : (appState.logs[key] || {workouts:[]});
    (dayLog.workouts||[]).forEach(w=>{
      count++;
      volume += (w.sets||[]).reduce((s,x)=> s + x.weight*x.reps, 0);
    });
  }
  const favCount = state.library.exercises.filter(e=>e.favorite).length;
  return {count, volume, favCount};
}
function renderGymStatsRow(){
  const wrap = document.getElementById('gymStatsRow');
  const {count, volume, favCount} = computeGymWeekStats();
  wrap.innerHTML = `
    <div class="gstat"><div class="gv tabular">${count}</div><div class="gl">تمارين الأسبوع</div></div>
    <div class="gstat"><div class="gv tabular">${Math.round(volume).toLocaleString('en-US')}</div><div class="gl">حجم التدريب (كغ)</div></div>
    <div class="gstat"><div class="gv tabular">${favCount}</div><div class="gl">⭐ مفضلة</div></div>
  `;
}
function renderGymFavorites(){
  const section = document.getElementById('gymFavSection');
  const wrap = document.getElementById('gymFavRow');
  const favs = state.library.exercises.filter(e=>e.favorite);
  if(favs.length===0){ section.style.display='none'; return; }
  section.style.display='';
  wrap.innerHTML = '';
  favs.forEach(ex=>{
    const chip = document.createElement('div');
    chip.className = 'food-chip';
    const hint = ex.lastWeight ? `${ex.lastWeight} كغ × ${ex.lastReps}` : 'أول مرة';
    chip.innerHTML = `<div class="plus">▶</div><div class="fname">${escapeHtml(ex.name)}</div><div class="fcal">${hint}</div>`;
    chip.addEventListener('click', ()=> startSession([ex]));
    wrap.appendChild(chip);
  });
}
function toggleFavorite(ex){
  ex.favorite = !ex.favorite;
  persist();
  renderExList();
  renderGymStatsRow();
  renderGymFavorites();
  showToast(ex.favorite ? `⭐ ضفت ${ex.name} للمفضلة` : `شلت ${ex.name} من المفضلة`);
}

function renderWorkoutsToday(){
  const wrap = document.getElementById('workoutsToday');
  const volEl = document.getElementById('gymTodayVolume');
  wrap.innerHTML = '';
  if(state.log.workouts.length===0){
    wrap.innerHTML = '<div class="empty-hint">ولا تمرين مسجل اليوم بعد</div>';
    if(volEl) volEl.textContent = '';
    return;
  }
  const totalVol = state.log.workouts.reduce((s,w)=> s + (w.sets||[]).reduce((ss,x)=>ss+x.weight*x.reps,0), 0);
  if(volEl) volEl.textContent = `حجم اليوم: ${Math.round(totalVol).toLocaleString('en-US')} كغ`;
  const deleteWorkout = (id)=>{
    const idx = state.log.workouts.findIndex(w=>w.id===id);
    if(idx<0) return;
    const removed = state.log.workouts[idx];
    state.log.workouts.splice(idx,1);
    persist();
    computeStreak();
    renderAll();
    showUndoToast(`حذفت ${removed.name}`, ()=>{
      state.log.workouts.splice(idx,0,removed);
      persist();
      computeStreak();
      renderAll();
    });
  };
  state.log.workouts.forEach(w=>{
    const setsTxt = w.sets.map(s=>`${s.weight}×${s.reps}`).join('، ');
    const durTxt = fmtDuration(w.durationSec);
    const row = document.createElement('div');
    row.className = 'entry-row';
    row.innerHTML = `${exAnimHtml(w,'sm')}
      <div class="entry-main"><div class="t1">${escapeHtml(w.name)}${w.isPR?'<span class="pr-badge">🏆</span>':''}${w.supersetId?'<span class="pr-badge" style="background:var(--shoulder-soft); color:var(--shoulder);">🔗 سوبرست</span>':''}</div><div class="t2">${w.group} · ${setsTxt}${durTxt?' · '+durTxt:''}</div></div>
      <div class="entry-side">${w.sets.length} جولات</div>
      <div class="entry-del" data-del-w="${w.id}">✕</div>`;
    attachSwipeToDelete(row, ()=> deleteWorkout(w.id));
    wrap.appendChild(row);
  });
  wrap.querySelectorAll('[data-del-w]').forEach(btn=>{
    btn.addEventListener('click', ()=> deleteWorkout(btn.getAttribute('data-del-w')));
  });
}

function renderGymHistory(){
  const wrap = document.getElementById('gymHistory');
  const cards = [];
  for(let i=1;i<=6;i++){
    const key = dateKeyOffset(i);
    const dayLog = appState.logs[key] || null;
    if(dayLog && dayLog.workouts && dayLog.workouts.length>0) cards.push({key, log:dayLog});
  }
  wrap.innerHTML = '';
  if(cards.length===0){ wrap.innerHTML = '<div class="empty-hint">ما فيه تمارين سابقة بعد</div>'; return; }
  cards.forEach(c=>{
    const d = new Date(c.key+'T00:00:00');
    const card = document.createElement('div');
    card.className = 'day-card';
    const names = c.log.workouts.map(w=>`${w.name} (${w.sets.length} جولات)`).join(' · ');
    const vol = c.log.workouts.reduce((s,w)=> s + (w.sets||[]).reduce((ss,x)=>ss+x.weight*x.reps,0), 0);
    const groups = [...new Set(c.log.workouts.map(w=>w.group))];
    const dotsHtml = groups.map(g=> `<span style="background:${(GROUP_COLOR_VAR[g]||{}).solid||'var(--text-mute)'}"></span>`).join('');
    card.innerHTML = `<div class="dh"><div class="dd">${formatDateHuman(d)}</div><div class="dc">${c.log.workouts.length} تمارين · <span class="dvol tabular">${Math.round(vol).toLocaleString('en-US')} كغ</span></div></div><div class="di">${escapeHtml(names)}</div><div class="dgroups">${dotsHtml}</div>`;
    wrap.appendChild(card);
  });
}

/* ============================================================
   MUSCLE HEAT MAP
   ============================================================ */

const HEAT_ZONE_GROUPS = ['صدر','ظهر','أرجل','أكتاف','بايسبس','ترايسبس','بطن'];

function computeMuscleHeat(){
  const heat = {};
  HEAT_ZONE_GROUPS.forEach(g=> heat[g]=0);
  for(let i=0;i<=6;i++){
    const key = dateKeyOffset(i);
    const dayLog = (i===0) ? state.log : (appState.logs[key] || {workouts:[]});
    const decay = 1 - i/7; // today counts full, older days fade out
    (dayLog.workouts||[]).forEach(w=>{
      const vol = (w.sets||[]).reduce((s,x)=> s + x.weight*x.reps, 0);
      if(heat[w.group]===undefined) return;
      heat[w.group] += vol * decay;
    });
  }
  return heat;
}

function renderMuscleHeatmap(){
  const heat = computeMuscleHeat();
  const maxV = Math.max(...Object.values(heat), 1);
  const op = (g)=> (0.10 + (heat[g]/maxV)*0.85).toFixed(2);
  const armsHeat = Math.max(heat['بايسبس']||0, heat['ترايسبس']||0);
  const armsOp = (0.10 + (armsHeat/maxV)*0.85).toFixed(2);

  const svg = `
  <svg viewBox="0 0 200 300" width="118" height="177">
    <ellipse cx="100" cy="26" rx="17" ry="19" fill="var(--border-soft)"/>
    <rect x="90" y="42" width="20" height="14" rx="4" fill="var(--border-soft)"/>
    <path d="M76 54 h48 l6 20 h-60 z" fill="${GROUP_COLOR_VAR['ظهر'].solid}" fill-opacity="${op('ظهر')}"/>
    <circle cx="60" cy="72" r="15" fill="${GROUP_COLOR_VAR['أكتاف'].solid}" fill-opacity="${op('أكتاف')}"/>
    <circle cx="140" cy="72" r="15" fill="${GROUP_COLOR_VAR['أكتاف'].solid}" fill-opacity="${op('أكتاف')}"/>
    <rect x="68" y="70" width="64" height="52" rx="16" fill="${GROUP_COLOR_VAR['صدر'].solid}" fill-opacity="${op('صدر')}"/>
    <rect x="40" y="76" width="19" height="95" rx="9.5" fill="${GROUP_COLOR_VAR['بايسبس'].solid}" fill-opacity="${armsOp}"/>
    <rect x="141" y="76" width="19" height="95" rx="9.5" fill="${GROUP_COLOR_VAR['بايسبس'].solid}" fill-opacity="${armsOp}"/>
    <rect x="72" y="124" width="56" height="60" rx="12" fill="${GROUP_COLOR_VAR['بطن'].solid}" fill-opacity="${op('بطن')}"/>
    <rect x="70" y="188" width="26" height="105" rx="13" fill="${GROUP_COLOR_VAR['أرجل'].solid}" fill-opacity="${op('أرجل')}"/>
    <rect x="104" y="188" width="26" height="105" rx="13" fill="${GROUP_COLOR_VAR['أرجل'].solid}" fill-opacity="${op('أرجل')}"/>
  </svg>`;

  const legendGroups = ['صدر','ظهر','أكتاف','بايسبس','ترايسبس','بطن','أرجل'];
  const legend = legendGroups.map(g=>{
    const t = Math.round((heat[g]/maxV)*100);
    return `<div class="hl-row"><span class="hl-dot" style="background:${GROUP_COLOR_VAR[g].solid}; opacity:${(0.25+t/100*0.75).toFixed(2)}"></span><span class="hl-tx">${g} <b>${t>0?t+'٪':'—'}</b></span></div>`;
  }).join('');

  document.getElementById('heatmapBody').innerHTML = `${svg}<div class="heatmap-legend">${legend}</div>`;

  const sorted = Object.entries(heat).sort((a,b)=>b[1]-a[1]);
  const hot = sorted.filter(([g,v])=> v>0 && v/maxV>0.55).map(([g])=>g);
  const cold = HEAT_ZONE_GROUPS.filter(g=> (heat[g]/maxV) < 0.2);
  let summary = '';
  if(hot.length) summary += `🔥 مجهدة، تحتاج راحة: <b>${hot.join('، ')}</b><br>`;
  if(cold.length) summary += `✅ جاهزة للتمرين: <b>${cold.join('، ')}</b>`;
  if(!hot.length && !cold.length) summary = 'وزّع تمارينك أكثر خلال الأسبوع عشان تشوف الخريطة تتلوّن 🎨';
  document.getElementById('heatmapSummary').innerHTML = summary;
}

function renderOvertrainWarning(){
  const wrap = document.getElementById('overtrainWarnWrap');
  const heat = computeMuscleHeat();
  const maxV = Math.max(...Object.values(heat), 1);
  const critical = HEAT_ZONE_GROUPS.filter(g=> heat[g]>0 && heat[g]/maxV > 0.85);
  if(critical.length===0){ wrap.innerHTML=''; return; }
  wrap.innerHTML = `<div class="warn-banner">⚠️ <span><b>${critical.join('، ')}</b> تحت إجهاد عالي جداً آخر الأيام — فكر تاخذ يوم راحة إضافي لها قبل لا تكررها، تجنباً للإفراط بالتدريب.</span></div>`;
}

/* ============================================================
   WEEKLY VOLUME LANDMARKS (evidence-based set-count ranges)
   ============================================================ */
const VOLUME_LANDMARKS = {
  'صدر':[8,20], 'ظهر':[10,22], 'أرجل':[8,18], 'أكتاف':[8,20], 'بايسبس':[6,16], 'ترايسبس':[6,16], 'بطن':[6,20]
};
function computeWeeklySetCounts(){
  const counts = {}; HEAT_ZONE_GROUPS.forEach(g=> counts[g]=0);
  for(let i=0;i<=6;i++){
    const key = dateKeyOffset(i);
    const dayLog = (i===0) ? state.log : (appState.logs[key] || {workouts:[]});
    (dayLog.workouts||[]).forEach(w=>{
      if(counts[w.group]===undefined) return;
      counts[w.group] += (w.sets||[]).length;
    });
  }
  return counts;
}
function renderVolumeLandmarks(){
  const wrap = document.getElementById('landmarkCard');
  if(!wrap) return;
  const counts = computeWeeklySetCounts();
  const scaleMax = 24;
  const rows = HEAT_ZONE_GROUPS.map(g=>{
    const [min,max] = VOLUME_LANDMARKS[g];
    const count = counts[g];
    const bandLeftPct = (min/scaleMax)*100;
    const bandWidthPct = ((max-min)/scaleMax)*100;
    const fillPct = Math.min((count/scaleMax)*100, 100);
    let statusTxt = '';
    if(count>0 && count<min) statusTxt = 'أقل من المعدل';
    else if(count>max) statusTxt = 'فوق المعدل';
    else if(count>=min) statusTxt = 'ضمن المعدل المثالي ✓';
    return `<div class="landmark-row">
      <div class="lr-head"><b>${g}</b><span class="tabular">${count} جولة${statusTxt?' · '+statusTxt:''}</span></div>
      <div class="landmark-track">
        <div class="lt-band" style="left:${bandLeftPct}%; width:${bandWidthPct}%;"></div>
        <div class="lt-fill" style="width:${fillPct}%;"></div>
      </div>
    </div>`;
  }).join('');
  wrap.innerHTML = rows;
}

/* ============================================================
   VISUAL WEIGHT PLATES (BARBELL)
   ============================================================ */

function renderDayStrip(){
  const wrap = document.getElementById('dayStrip');
  wrap.innerHTML = '';
  const todayIdx = new Date().getDay();
  ORDERED_DAYS.forEach(d=>{
    const exIds = state.plan.days[d] || [];
    const groups = [...new Set(exIds.map(id=>{
      const ex = state.library.exercises.find(e=>e.id===id);
      return ex ? ex.group : null;
    }).filter(Boolean))];
    const pill = document.createElement('div');
    pill.className = 'day-pill'+(d===todayIdx?' today':'')+(d===state.viewedPlanDay?' viewed':'');
    let dotsHtml = groups.slice(0,3).map(g=>`<span class="dot2" style="background:${(GROUP_COLOR_VAR[g]||{}).solid||'var(--text-mute)'}"></span>`).join('');
    if(groups.length===0) dotsHtml = '<span class="rest">راحة</span>';
    pill.innerHTML = `<div class="dl">${DAY_LABELS[d]}</div><div class="dots">${dotsHtml}</div>`;
    pill.addEventListener('click', ()=>{ state.viewedPlanDay = d; renderDayStrip(); renderPlanCard(); });
    wrap.appendChild(pill);
  });
}

function renderPlanCard(){
  const wrap = document.getElementById('planCard');
  const d = state.viewedPlanDay;
  const todayIdx = new Date().getDay();
  const exIds = state.plan.days[d] || [];
  const title = (d===todayIdx ? 'خطة اليوم' : 'خطة يوم '+DAY_LABELS[d]);
  if(exIds.length===0){
    wrap.innerHTML = `<div class="ph">${title}</div><div class="empty-hint">يوم راحة 🌴 خلك مرتاح، أو ضيف تمرين إضافي لو تحب</div>`;
    return;
  }
  const dayGroups = exIds.map(id=>{ const ex = state.library.exercises.find(e=>e.id===id); return ex?ex.group:null; }).filter(Boolean);
  const warmup = warmupHintFor(dayGroups);
  const estMin = exIds.length * 6;
  let rows = '';
  exIds.forEach((id, idx)=>{
    const ex = state.library.exercises.find(e=>e.id===id);
    if(!ex) return;
    const hint = ex.lastWeight ? `آخر مرة: ${ex.lastWeight} كغ × ${ex.lastReps}` : 'أول مرة';
    rows += `<div class="plan-ex-row">
      ${exAnimHtml(ex)}
      <div class="pm"><div class="n">${escapeHtml(ex.name)}</div><div class="h">${ex.group} · ${hint}</div></div>
      <div class="pbtns">
        <div class="plan-icon-btn" data-detail="${id}">📈</div>
        <div class="plan-icon-btn" data-swap="${id}" data-slot="${idx}" data-day="${d}">🔁</div>
        <div class="plan-icon-btn go" data-start="${id}">▶</div>
      </div>
    </div>`;
  });
  wrap.innerHTML = `<div class="ph">${title}<span class="plan-meta">${exIds.length} تمارين · ~${estMin} د</span></div>${warmup?`<div class="warmup-hint">🔥 <span>إحماء مقترح: ${escapeHtml(warmup)}</span></div>`:''}${rows}`;
  wrap.querySelectorAll('[data-start]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const ex = state.library.exercises.find(e=>e.id===btn.getAttribute('data-start'));
      if(ex) startSession([ex]);
    });
  });
  wrap.querySelectorAll('[data-swap]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      openSwapSheet(btn.getAttribute('data-day'), parseInt(btn.getAttribute('data-slot'),10), btn.getAttribute('data-swap'));
    });
  });
  wrap.querySelectorAll('[data-detail]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const ex = state.library.exercises.find(e=>e.id===btn.getAttribute('data-detail'));
      if(ex) openExerciseDetail(ex);
    });
  });
}

function openSwapSheet(dayIdx, slotIdx, currentExId){
  const current = state.library.exercises.find(e=>e.id===currentExId);
  const group = current ? current.group : null;
  document.getElementById('swapTitle').textContent = 'بدائل ' + (group || '');
  const wrap = document.getElementById('swapList');
  wrap.innerHTML = '';
  const candidates = state.library.exercises.filter(e=>e.group===group);
  candidates.forEach(ex=>{
    const row = document.createElement('div');
    row.className = 'lib-row';
    row.innerHTML = `${exAnimHtml(ex,'sm')}<div class="lm"><div class="n">${escapeHtml(ex.name)} ${ex.id===currentExId?'<span class="star">★ الحالي</span>':''}</div><div class="d">${ex.group}</div></div>`;
    row.addEventListener('click', async ()=>{
      state.plan.days[dayIdx][slotIdx] = ex.id;
      persist();
      closeAllSheets();
      renderDayStrip(); renderPlanCard();
      showToast('تم تغيير التمرين');
    });
    wrap.appendChild(row);
  });
}

function renderPlanPresetList(){
  const wrap = document.getElementById('planPresetList');
  wrap.innerHTML = '';
  Object.keys(SPLIT_PRESETS).forEach(key=>{
    const p = SPLIT_PRESETS[key];
    const card = document.createElement('div');
    card.className = 'qa-option';
    card.style.borderColor = state.selectedPresetType===key ? 'var(--accent)' : '';
    card.innerHTML = `<div class="ic" style="background:${state.selectedPresetType===key?'var(--protein-soft)':'var(--surface-2)'}; color:${state.selectedPresetType===key?'var(--protein)':'var(--text-mute)'};">🗓️</div>
      <div class="tx"><b>${p.label}</b><span>${p.sub}</span></div>`;
    card.addEventListener('click', ()=>{ state.selectedPresetType = key; renderPlanPresetList(); });
    wrap.appendChild(card);
  });
}

/* ============================================================
   RENDER ALL
   ============================================================ */

const EX_GROUPS = ['الكل','صدر','ظهر','أرجل','أكتاف','بايسبس','ترايسبس','بطن'];

function renderExGroupBar(){
  const bar = document.getElementById('exGroupBar');
  bar.innerHTML = '';
  EX_GROUPS.forEach(g=>{
    const chip = document.createElement('div');
    chip.className = 'filter-chip'+(state.activeExGroup===g?' active':'');
    chip.textContent = g;
    chip.addEventListener('click', ()=>{ state.activeExGroup = g; renderExGroupBar(); renderExList(); });
    bar.appendChild(chip);
  });
}

function renderExEquipBar(){
  const bar = document.getElementById('exEquipBar');
  if(!bar) return;
  bar.innerHTML = '';
  const allChip = document.createElement('div');
  allChip.className = 'filter-chip'+(!state.activeEquipFilter?' active':'');
  allChip.textContent = 'كل المعدات';
  allChip.addEventListener('click', ()=>{ state.activeEquipFilter=null; renderExEquipBar(); renderExList(); });
  bar.appendChild(allChip);
  (appState.equipment||ALL_EQUIPMENT).forEach(eq=>{
    const chip = document.createElement('div');
    chip.className = 'filter-chip'+(state.activeEquipFilter===eq?' active':'');
    chip.textContent = EQUIPMENT_LABELS[eq] || eq;
    chip.addEventListener('click', ()=>{ state.activeEquipFilter = (state.activeEquipFilter===eq?null:eq); renderExEquipBar(); renderExList(); });
    bar.appendChild(chip);
  });
}

function renderExList(){
  const wrap = document.getElementById('exList');
  const q = (document.getElementById('exSearch').value||'').trim();
  wrap.innerHTML = '';
  let list = [...state.library.exercises];
  if(state.activeExGroup!=='الكل') list = list.filter(e=>e.group===state.activeExGroup);
  if(state.activeEquipFilter) list = list.filter(e=>e.equipment===state.activeEquipFilter);
  if(q) list = list.filter(e=>e.name.includes(q));
  list.sort((a,b)=> (b.favorite - a.favorite) || (b.usageCount - a.usageCount));
  if(list.length===0){ wrap.innerHTML = '<div class="empty-hint">ما فيه نتائج</div>'; return; }
  list.forEach(ex=>{
    const row = document.createElement('div');
    row.className = 'lib-row';
    const picked = state.supersetPickMode && state.supersetPicks.some(p=>p.id===ex.id);
    if(picked) row.classList.add('superset-picker-chip');
    const hint = ex.lastWeight ? `آخر مرة: ${ex.lastWeight} كغ × ${ex.lastReps}` : 'ما سجلته من قبل';
    const equipTag = EQUIPMENT_LABELS[ex.equipment] || '';
    row.innerHTML = `${exAnimHtml(ex,'sm')}<div class="lm"><div class="n">${escapeHtml(ex.name)}${picked?'<span class="pr-badge">مختار</span>':''}${ex.injured?'<span class="injury-badge">🩹</span>':''}</div><div class="d">${ex.group} · ${equipTag} · ${hint}</div></div><div class="injury-toggle" data-injury="${ex.id}">${ex.injured?'🩹':'🏥'}</div><div class="fav-star${ex.favorite?' on':''}" data-fav="${ex.id}">${ex.favorite?'★':'☆'}</div>`;
    row.addEventListener('click', ()=>{
      if(state.supersetPickMode) toggleSupersetPick(ex);
      else startSession([ex]);
    });
    row.querySelector('[data-fav]').addEventListener('click', (e)=>{
      e.stopPropagation();
      toggleFavorite(ex);
    });
    row.querySelector('[data-injury]').addEventListener('click', (e)=>{
      e.stopPropagation();
      ex.injured = !ex.injured;
      persist();
      renderExList();
      showToast(ex.injured ? `🩹 ${ex.name} متجنّب مؤقتاً` : `تم إلغاء تجنّب ${ex.name}`);
    });
    wrap.appendChild(row);
  });
}

function toggleSupersetPick(ex){
  const idx = state.supersetPicks.findIndex(p=>p.id===ex.id);
  if(idx>=0){ state.supersetPicks.splice(idx,1); }
  else{
    if(state.supersetPicks.length>=2){ showToast('تقدر تختار تمرينين بس'); return; }
    state.supersetPicks.push(ex);
  }
  renderExList();
  renderSupersetBar();
}

function renderSupersetBar(){
  const bar = document.getElementById('supersetBar');
  const btn = document.getElementById('btnStartSuperset');
  const txt = document.getElementById('supersetBarText');
  if(!state.supersetPickMode){ bar.style.display='none'; return; }
  bar.style.display='flex';
  if(state.supersetPicks.length===0) txt.textContent = 'اختر تمرينين تسويهم بدون راحة بينهم';
  else txt.textContent = 'مختار: ' + state.supersetPicks.map(p=>p.name).join(' + ');
  btn.disabled = state.supersetPicks.length!==2;
}

