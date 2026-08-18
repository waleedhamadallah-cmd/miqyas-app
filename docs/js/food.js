/* ============================================================
   FOOD TAB: today's meals, food library list/search, quick add
   ============================================================ */
// Shared by the swipe-to-delete row action and the edit-meal sheet's own
// delete button, so both paths get the same undo toast instead of two
// slightly different deletion behaviors.
function deleteMealEntry(id){
  // Captures the exact log array being deleted from (the day being viewed
  // right now), not the mutable `state.log` reference — if the user switches
  // to a different day between this delete and tapping "تراجع", state.log
  // gets repointed by switchViewedDay(), and restoring into it would put
  // the meal back on the WRONG day instead of undoing the original delete.
  const targetMeals = state.log.meals;
  const idx = targetMeals.findIndex(m=>m.id===id);
  if(idx<0) return;
  const removed = targetMeals[idx];
  targetMeals.splice(idx,1);
  persist();
  renderAll();
  // Removes the matching Health Connect record too (if this meal was ever
  // synced there) — without this, deleting a meal in مِقياس left a
  // permanently-stale record behind in Health Connect/Samsung Health that
  // no longer matched anything in the user's actual log.
  syncHealthConnectDeleteNutrition(removed.hcRecordId);
  showUndoToast(`حذفت ${removed.name}`, ()=>{
    targetMeals.splice(idx,0,removed);
    persist();
    renderAll();
    // Re-syncs as a fresh record on undo — simpler and just as correct as
    // trying to resurrect the exact deleted record, and syncHealthConnectNutrition()
    // will overwrite removed.hcRecordId with the new record's own ID.
    syncHealthConnectNutrition(removed);
  });
}

function renderMealsToday(){
  const wrap = document.getElementById('mealsToday');
  wrap.innerHTML = '';
  if(state.log.meals.length===0){ wrap.innerHTML = emptyStateHtml('meal', 'ولا وجبة مسجلة اليوم بعد'); return; }
  state.log.meals.forEach(m=>{
    const row = document.createElement('div');
    row.className = 'entry-tile';
    const qtyTag = (m.qty!==undefined && m.qty!==1) ? ` · ×${trimQtyDisplay(m.qty)}` : '';
    row.innerHTML = `
      <div class="et-name">${escapeHtml(m.name)}</div>
      <div class="et-cal tabular">${m.calories}</div>
      <div class="et-macros tabular">ب${Math.round(m.protein)} ك${Math.round(m.carbs)} د${Math.round(m.fat)}${qtyTag}</div>`;
    row.addEventListener('click', ()=> openEditMealSheet(m.id));
    attachSwipeToDelete(row, ()=> deleteMealEntry(m.id));
    wrap.appendChild(row);
  });
}

function trimQtyDisplay(qty){
  // 1.5 -> "1.5", 2 -> "2", 0.75 -> "0.75" (never a trailing .0)
  return (Math.round(qty*100)/100).toString();
}

/* ============================================================
   EDIT MEAL ENTRY (rescale quantity or delete)
   ============================================================ */
let editMealId = null;
let editMealQty = 1;

// Legacy entries logged before qty/base* existed just use their current
// displayed macros as the 1x base — the best guess available, and correct
// for the overwhelming majority since qty defaults to 1 anyway.
function getMealEntryBase(entry){
  if(entry.baseCalories!==undefined) return entry;
  return {baseCalories:entry.calories, baseProtein:entry.protein, baseCarbs:entry.carbs,
    baseFat:entry.fat, baseFiber:entry.fiber||0, baseSodium:entry.sodium||0};
}

function openEditMealSheet(entryId){
  const entry = state.log.meals.find(m=>m.id===entryId);
  if(!entry) return;
  editMealId = entryId;
  editMealQty = entry.qty!==undefined ? entry.qty : 1;
  document.getElementById('editMealName').textContent = entry.name;
  document.getElementById('editMealQtyCustom').value = '';
  renderEditMealQtyChips();
  renderEditMealPreview();
  openSheet('sheetEditMeal');
}

function renderEditMealQtyChips(){
  document.querySelectorAll('#editMealQtyChips .filter-chip').forEach(chip=>{
    chip.classList.toggle('active', parseFloat(chip.getAttribute('data-qty'))===editMealQty);
  });
}

function setEditMealQty(qty){
  if(!(qty>0)) return;
  editMealQty = Math.round(qty*100)/100;
  renderEditMealQtyChips();
  renderEditMealPreview();
}

function renderEditMealPreview(){
  const entry = state.log.meals.find(m=>m.id===editMealId);
  const preview = document.getElementById('editMealPreview');
  if(!entry || !preview) return;
  const base = getMealEntryBase(entry);
  const cal = Math.round(base.baseCalories*editMealQty);
  const p = Math.round(base.baseProtein*editMealQty);
  const c = Math.round(base.baseCarbs*editMealQty);
  const f = Math.round(base.baseFat*editMealQty);
  preview.innerHTML = `
    <div class="rt-row"><span>سعرات</span><b>${cal}</b></div>
    <div class="rt-row"><span>بروتين</span><b>${p} غ</b></div>
    <div class="rt-row"><span>كارب</span><b>${c} غ</b></div>
    <div class="rt-row"><span>دهون</span><b>${f} غ</b></div>`;
}

function saveEditMealQty(){
  const entry = state.log.meals.find(m=>m.id===editMealId);
  if(!entry) return;
  const base = getMealEntryBase(entry);
  entry.baseCalories = base.baseCalories; entry.baseProtein = base.baseProtein;
  entry.baseCarbs = base.baseCarbs; entry.baseFat = base.baseFat;
  entry.baseFiber = base.baseFiber; entry.baseSodium = base.baseSodium;
  entry.qty = editMealQty;
  entry.calories = Math.round(base.baseCalories*editMealQty);
  entry.protein = Math.round(base.baseProtein*editMealQty);
  entry.carbs = Math.round(base.baseCarbs*editMealQty);
  entry.fat = Math.round(base.baseFat*editMealQty);
  entry.fiber = Math.round(base.baseFiber*editMealQty);
  entry.sodium = Math.round(base.baseSodium*editMealQty);
  // Health Connect has no "update a record in place" API — the correct way
  // to reflect an edit is deleting the old record and writing a fresh one
  // with the new macros (syncHealthConnectNutrition() below overwrites
  // entry.hcRecordId with the new record's ID once it resolves). Entries
  // logged before this feature existed simply have no hcRecordId yet, so
  // the delete call below is a no-op for them and this just becomes a
  // normal first-time sync.
  const oldRecordId = entry.hcRecordId;
  persist();
  renderAll();
  closeAllSheets();
  showToast('تم تحديث الوجبة ✏️');
  syncHealthConnectDeleteNutrition(oldRecordId);
  syncHealthConnectNutrition(entry);
}

// Tie-break order once favorite/usageCount are equal (the common case for
// anyone who hasn't built up usage history yet, e.g. a first-time "الكل"
// view) — mains/carbs/salads read before snacks/desserts, instead of
// falling back to raw array order (which used to list ~17 desserts before
// a single real meal). Doesn't touch favorite/usageCount at all, so it
// takes effect immediately for existing libraries too, no migration needed.
const FOOD_TYPE_ORDER = {protein:0, carb:1, salad:2, snack:3};
function sortFoodList(list){
  return [...list].sort((a,b)=>
    (b.favorite - a.favorite) ||
    ((b.usageCount||0) - (a.usageCount||0)) ||
    ((FOOD_TYPE_ORDER[a.foodType] ?? 2) - (FOOD_TYPE_ORDER[b.foodType] ?? 2))
  );
}

function toggleFoodFavorite(food){
  food.favorite = !food.favorite;
  persist();
  vibrate(8);
  renderFoodLibList();
  renderSheetFoodList();
}

// Library groups by what the food actually IS (macro role) instead of what
// meal-time it's usually eaten at — "بروتين/كارب/سلطة" tells you something
// useful about a food itself; "غدا/عشا" doesn't (a grilled chicken breast
// is "غدا" whether you eat it at noon or at 9pm). The add-meal picker sheet
// (sheetFood) keeps the old time-of-day chip filter — that one really is
// about "what am I eating right now", which time-of-day does answer.
const FOOD_TYPE_GROUPS = [
  {key:'protein', label:'بروتين',            icon:'🍗', soft:'var(--protein-soft)', text:'var(--protein-text)'},
  {key:'carb',    label:'كارب',              icon:'🍞', soft:'var(--carb-soft)',    text:'var(--carb-text)'},
  {key:'salad',   label:'سلطة',              icon:'🥗', soft:'var(--shoulder-soft)',text:'var(--shoulder-text)'},
  {key:'snack',   label:'حلويات وسناكات',    icon:'🍰', soft:'var(--fat-soft)',     text:'var(--fat-text)'}
];
const FOOD_TYPE_KEYS = new Set(FOOD_TYPE_GROUPS.map(g=>g.key));

// Which groups are expanded, kept across re-renders (typing a search
// letter re-renders the whole list; this keeps a group you opened from
// snapping shut on every keystroke).
// Starts fully collapsed: with "بروتين" pre-expanded, its first few rows
// landed at the exact fixed screen position of the floating (+) button on
// the very first open of the Food tab — no scrolling needed to hit it —
// which visually buried that row's own quick-add "+" underneath the FAB
// and made it untappable. Collapsed groups keep the tab short enough on
// first paint that nothing sits under the FAB before the user scrolls.
const libGroupsOpen = {};

function buildLibRow(food){
  const row = document.createElement('div');
  row.className = 'lib-row';
  const customTag = food.isCustom ? '<span class="custom-tag">مخصصة</span>' : '';
  row.innerHTML = `<div class="lm"><div class="n">${escapeHtml(food.name)}${customTag}</div><div class="d">${food.calories} سعرة · ب${food.protein} ك${food.carbs} د${food.fat}</div></div>
    <div class="lib-actions">
      <div class="fav-star${food.favorite?' on':''}" data-fav-food="${food.id}" aria-label="${food.favorite?'إزالة من المفضلة':'إضافة للمفضلة'}" role="button">${food.favorite?ICON_STAR_FILLED:ICON_STAR_OUTLINE}</div>
      ${food.isCustom ? `<div class="lib-edit" data-edit-food="${food.id}" aria-label="تعديل" role="button">${ICON_PENCIL}</div>` : ''}
      ${food.isCustom ? `<div class="lib-delete" data-del-food="${food.id}" aria-label="حذف" role="button">${ICON_TRASH}</div>` : ''}
      <div class="lib-add" aria-label="إضافة لليوم" role="button">+</div>
    </div>`;
  row.querySelector('.lib-add').addEventListener('click', (e)=>{ e.stopPropagation(); quickAddFood(food, null); });
  row.querySelector('[data-fav-food]').addEventListener('click', (e)=>{ e.stopPropagation(); toggleFoodFavorite(food); });
  const editBtn = row.querySelector('[data-edit-food]');
  if(editBtn) editBtn.addEventListener('click', (e)=>{ e.stopPropagation(); openEditFood(food); });
  if(food.isCustom){
    // Explicit, always-visible delete icon — matches the × on "وجبات
    // اليوم" instead of making swipe-to-delete the ONLY way to remove a
    // custom food (swipe stays too, as a bonus shortcut, not the only path).
    const delBtn = row.querySelector('[data-del-food]');
    if(delBtn) delBtn.addEventListener('click', (e)=>{ e.stopPropagation(); deleteCustomFood(food); });
    attachSwipeToDelete(row, ()=> deleteCustomFood(food));
  }
  return row;
}

function renderFoodLibList(){
  const wrap = document.getElementById('foodLibList');
  const q = (document.getElementById('foodSearch').value||'').trim();
  wrap.innerHTML = '';
  let list = state.library.foods;
  if(q) list = list.filter(f=>f.name.includes(q));
  if(list.length===0){ wrap.innerHTML = emptyStateHtml('search', 'ما فيه نتائج'); return; }

  const groups = FOOD_TYPE_GROUPS.map(g=> ({...g, items: sortFoodList(list.filter(f=>f.foodType===g.key))}));
  const otherItems = sortFoodList(list.filter(f=>!FOOD_TYPE_KEYS.has(f.foodType)));
  if(otherItems.length) groups.push({key:'other', label:'أخرى', icon:'🍽️', soft:'var(--surface-2)', text:'var(--text-dim)', items:otherItems});

  groups.filter(g=>g.items.length>0).forEach(g=>{
    // Searching should surface matches immediately instead of hiding them
    // behind a collapsed group the user has to think to open.
    const isOpen = q ? true : !!libGroupsOpen[g.key];
    const card = document.createElement('div');
    card.className = 'acc-group';
    card.innerHTML = `<div class="acc-item${isOpen?' open':''}">
      <div class="acc-head">
        <span class="acc-title"><span class="lib-group-ic" style="background:${g.soft}; color:${g.text};">${g.icon}</span>${g.label}<span class="acc-count">${g.items.length}</span></span>
        <span class="acc-chevron">⌄</span>
      </div>
      <div class="acc-body"><div class="lib-group-rows"></div></div>
    </div>`;
    const item = card.querySelector('.acc-item');
    card.querySelector('.acc-head').addEventListener('click', ()=>{
      libGroupsOpen[g.key] = item.classList.toggle('open');
    });
    const rowsWrap = card.querySelector('.lib-group-rows');
    g.items.forEach(food=> rowsWrap.appendChild(buildLibRow(food)));
    wrap.appendChild(card);
  });
}

/* ============================================================
   EDIT / DELETE CUSTOM FOODS
   ============================================================ */
function openEditFood(food){
  state.editingFoodId = food.id;
  document.getElementById('sheetNewFoodTitle').textContent = 'تعديل الوجبة';
  document.getElementById('btnSaveNewFoodLabel').textContent = 'حفظ التعديلات';
  document.getElementById('nfName').value = food.name;
  document.getElementById('nfType').value = food.foodType || '';
  document.getElementById('nfCal').value = food.calories;
  document.getElementById('nfP').value = food.protein;
  document.getElementById('nfC').value = food.carbs;
  document.getElementById('nfF').value = food.fat;
  openSheet('sheetNewFood');
}

function resetNewFoodSheet(){
  state.editingFoodId = null;
  // Cleared here (not just after a successful save) so opening this form
  // from anywhere OTHER than a barcode scan — the library's own "+ إضافة
  // وجبة جديدة", editing an existing food, or AI-scan's general-mode
  // fallback — never accidentally attaches a stale barcode left over from
  // an earlier scan. applyBarcodeProductToNewFoodForm()/openBarcodeManualNewFood()
  // in barcode.js both call this first, then set the real value right after.
  if(typeof pendingNewFoodBarcode!=='undefined') pendingNewFoodBarcode = null;
  document.getElementById('sheetNewFoodTitle').textContent = 'وجبة جديدة';
  document.getElementById('btnSaveNewFoodLabel').textContent = 'حفظ وإضافة لليوم';
  ['nfName','nfCal','nfP','nfC','nfF','nfType'].forEach(id=> document.getElementById(id).value='');
}

function deleteCustomFood(food){
  const idx = state.library.foods.findIndex(f=>f.id===food.id);
  if(idx<0) return;
  state.library.foods.splice(idx,1);
  persist();
  renderAll();
  showUndoToast(`حذفت ${food.name} من المكتبة`, ()=>{
    state.library.foods.splice(idx,0,food);
    persist();
    renderAll();
  });
}

/* ============================================================
   WEEKLY FOOD SUMMARY (progress tab)
   ============================================================ */
function renderWeeklyFoodSummary(){
  const wrap = document.getElementById('weeklyFoodInsight');
  if(!wrap) return;
  const days = [];
  for(let i=0;i<7;i++){
    const d = new Date();
    d.setDate(d.getDate()-i);
    days.push(todayKey(d));
  }
  let totalCal = 0, loggedDays = 0;
  days.forEach(dateKey=>{
    const dayLog = appState.logs[dateKey];
    const meals = dayLog ? (dayLog.meals||[]) : [];
    if(meals.length===0) return;
    loggedDays++;
    meals.forEach(m=> totalCal += m.calories);
  });

  if(loggedDays===0){
    wrap.innerHTML = `<div class="insight-row"><div class="insight-icon" style="background:var(--carb-soft); color:var(--carb-text);">${ICON_CALENDAR}</div>
      <div class="insight-tx"><div class="it1">ما فيه بيانات كافية هالأسبوع</div><div class="it2">سجل وجباتك عشان يبين لك ملخص أسبوعي</div></div></div>`;
    return;
  }

  const avgCal = Math.round(totalCal/loggedDays);
  const avgHtml = `<div class="insight-row"><div class="insight-icon" style="background:var(--protein-soft); color:var(--protein-text);">${ICON_BAR_CHART}</div>
    <div class="insight-tx"><div class="it1">متوسط سعراتك ${avgCal.toLocaleString('en-US')} سعرة باليوم</div><div class="it2">على أساس ${loggedDays} من آخر 7 أيام سجلتها</div></div></div>`;

  wrap.innerHTML = avgHtml;
}

// Builds a logged-meal entry with qty=1 and its base-serving macros saved
// alongside the (currently identical) displayed macros. Keeping the base
// values separate from the scaled ones lets the edit-meal sheet rescale a
// logged entry later (½×, 1.5×, a custom multiplier, ...) without losing
// precision from repeatedly scaling an already-scaled number.
function makeMealEntry(name, foodId, calories, protein, carbs, fat, fiber, sodium){
  return {
    id:uid(), foodId, name, qty:1,
    baseCalories:calories, baseProtein:protein, baseCarbs:carbs, baseFat:fat,
    baseFiber:fiber||0, baseSodium:sodium||0,
    calories, protein, carbs, fat, fiber:fiber||0, sodium:sodium||0,
    time:Date.now()
  };
}

async function quickAddFood(food, chipEl){
  const entry = makeMealEntry(food.name, food.id, food.calories, food.protein, food.carbs, food.fat, food.fiber, food.sodium);
  state.log.meals.push(entry);
  food.usageCount = (food.usageCount||0)+1;
  persist();
  syncHealthConnectNutrition(entry);
  vibrate(10);

  if(chipEl){ chipEl.classList.add('pulse'); setTimeout(()=>chipEl.classList.remove('pulse'), 400); }
  showToast(`أضيفت ${food.name}`);
  renderAll();
}

function renderSheetFoodList(){
  const wrap = document.getElementById('sheetFoodList');
  const q = (document.getElementById('sheetFoodSearch').value||'').trim();
  wrap.innerHTML = '';
  let list = state.library.foods;
  if(state.mealBuilderMode){
    list = list.filter(f=>f.foodType===state.mealBuilderStep);
  }
  if(q) list = list.filter(f=>f.name.includes(q));
  list = sortFoodList(list);
  if(list.length===0){ wrap.innerHTML = emptyStateHtml('search', 'ما فيه نتائج، جرب اسم ثاني أو ضيف وجبة جديدة'); return; }
  list.forEach(food=>{
    const row = document.createElement('div');
    row.className = 'lib-row';
    // In meal-builder mode tapping a row only PICKS it as a component (step
    // 1 of 2) — it doesn't log anything yet, unlike normal mode where "+"
    // means instant add. Showing the same "+" in both modes used to imply
    // the food was logged the moment you tapped it, even mid-pick.
    const marker = state.mealBuilderMode ? '›' : '+';
    row.innerHTML = `<div class="lm"><div class="n">${escapeHtml(food.name)}</div><div class="d">${food.calories} سعرة · ب${food.protein} ك${food.carbs} د${food.fat}</div></div>
      <div class="lib-add">${marker}</div>`;
    row.addEventListener('click', async ()=>{
      if(state.mealBuilderMode){ pickMealBuilderFood(food); }
      else{ await quickAddFood(food, null); closeAllSheets(); }
    });
    wrap.appendChild(row);
  });
}

/* ============================================================
   MEAL BUILDER (combine a protein pick + a carb pick into ONE meal)
   ============================================================ */
function toggleMealBuilder(){
  state.mealBuilderMode = !state.mealBuilderMode;
  state.mealBuilderStep = 'protein';
  state.mealBuilderPicks = {protein:null, carb:null};
  document.getElementById('mealBuilderToggle').classList.toggle('on', state.mealBuilderMode);
  renderMealBuilderBar();
  renderSheetFoodList();
}
function pickMealBuilderFood(food){
  state.mealBuilderPicks[state.mealBuilderStep] = food;
  if(state.mealBuilderStep==='protein') state.mealBuilderStep = 'carb';
  renderMealBuilderBar();
  renderSheetFoodList();
}
function skipMealBuilderStep(){
  if(state.mealBuilderStep==='protein'){ state.mealBuilderStep = 'carb'; renderMealBuilderBar(); renderSheetFoodList(); }
  else{ finishMealBuilder(); }
}
function renderMealBuilderBar(){
  const wrap = document.getElementById('mealBuilderBar');
  if(!state.mealBuilderMode){ wrap.style.display='none'; wrap.innerHTML=''; return; }
  wrap.style.display='block';
  const p = state.mealBuilderPicks.protein, c = state.mealBuilderPicks.carb;
  const bothPicked = p && c;
  wrap.innerHTML = `<div class="mb-bar">
    <div class="mb-steps">
      <div class="mb-step ${state.mealBuilderStep==='protein'?'active':(p?'done':'')}">١. البروتين ${p?'✓':''}</div>
      <div class="mb-step ${state.mealBuilderStep==='carb'?'active':(c?'done':'')}">٢. الكارب ${c?'✓':''}</div>
    </div>
    <div class="mb-picks">${p?`🥩 <b>${escapeHtml(p.name)}</b>`:'اختر بروتين من القائمة تحت'}${c?`<br>🍚 <b>${escapeHtml(c.name)}</b>`:(p?'<br>اختر كارب، أو خلص بدونه':'')}</div>
    <div class="mb-actions">
      ${(p||c) ? `<button class="btn-secondary" id="btnFinishMealBuilder">✅ خلّصها وجبة وحدة${bothPicked?'':' (بس اللي اخترته)'}</button>` : `<button class="btn-secondary" id="btnSkipMealStep">تخطي هالخطوة</button>`}
    </div>
  </div>`;
  const finishBtn = document.getElementById('btnFinishMealBuilder');
  if(finishBtn) finishBtn.addEventListener('click', finishMealBuilder);
  const skipBtn = document.getElementById('btnSkipMealStep');
  if(skipBtn) skipBtn.addEventListener('click', skipMealBuilderStep);
}
async function finishMealBuilder(){
  const p = state.mealBuilderPicks.protein, c = state.mealBuilderPicks.carb;
  if(!p && !c){ showToast('اختر عنصر وحد على الأقل'); return; }
  const items = [p,c].filter(Boolean);
  const name = items.map(i=>i.name).join(' + ');
  const totals = items.reduce((acc,f)=>({
    calories:acc.calories+f.calories, protein:acc.protein+f.protein, carbs:acc.carbs+f.carbs,
    fat:acc.fat+f.fat, fiber:acc.fiber+(f.fiber||0), sodium:acc.sodium+(f.sodium||0)
  }), {calories:0,protein:0,carbs:0,fat:0,fiber:0,sodium:0});
  const entry = makeMealEntry(name, null,
    Math.round(totals.calories), Math.round(totals.protein), Math.round(totals.carbs),
    Math.round(totals.fat), Math.round(totals.fiber), Math.round(totals.sodium));
  state.log.meals.push(entry);
  items.forEach(f=> f.usageCount = (f.usageCount||0)+1);
  persist();
  syncHealthConnectNutrition(entry);
  vibrate(10);
  showToast(`أضيفت ${name} 🍽️`);
  renderAll();
  toggleMealBuilder(); // reset for next time
  closeAllSheets();
}

