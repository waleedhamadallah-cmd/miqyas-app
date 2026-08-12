/* ============================================================
   FOOD TAB: today's meals, food library list/search, quick add
   ============================================================ */
function renderMealsToday(){
  const wrap = document.getElementById('mealsToday');
  wrap.innerHTML = '';
  if(state.log.meals.length===0){ wrap.innerHTML = '<div class="empty-hint">ولا وجبة مسجلة اليوم بعد</div>'; return; }
  const deleteMeal = (id)=>{
    const idx = state.log.meals.findIndex(m=>m.id===id);
    if(idx<0) return;
    const removed = state.log.meals[idx];
    state.log.meals.splice(idx,1);
    persist();
    renderAll();
    showUndoToast(`حذفت ${removed.name}`, ()=>{
      state.log.meals.splice(idx,0,removed);
      persist();
      renderAll();
    });
  };
  state.log.meals.forEach(m=>{
    const row = document.createElement('div');
    row.className = 'entry-row';
    row.innerHTML = `<div class="entry-dot" style="background:var(--protein)"></div>
      <div class="entry-main"><div class="t1">${escapeHtml(m.name)}</div><div class="t2">${m.category} · ب${Math.round(m.protein)} ك${Math.round(m.carbs)} د${Math.round(m.fat)}</div></div>
      <div class="entry-side tabular">${m.calories}</div>
      <div class="entry-del" data-del-meal="${m.id}">✕</div>`;
    attachSwipeToDelete(row, ()=> deleteMeal(m.id));
    wrap.appendChild(row);
  });
  wrap.querySelectorAll('[data-del-meal]').forEach(btn=>{
    btn.addEventListener('click', ()=> deleteMeal(btn.getAttribute('data-del-meal')));
  });
}

function renderFoodCatBar(){
  const bar = document.getElementById('foodCatBar');
  bar.innerHTML = '';
  FOOD_CATS.forEach(cat=>{
    const chip = document.createElement('div');
    chip.className = 'filter-chip'+(state.activeFoodCat===cat?' active':'');
    chip.textContent = cat;
    chip.addEventListener('click', ()=>{ state.activeFoodCat = cat; renderFoodCatBar(); renderFoodLibList(); });
    bar.appendChild(chip);
  });
}

function renderFoodLibList(){
  const wrap = document.getElementById('foodLibList');
  const q = (document.getElementById('foodSearch').value||'').trim();
  wrap.innerHTML = '';
  let list = state.library.foods;
  if(state.activeFoodCat!=='الكل') list = list.filter(f=>f.category===state.activeFoodCat);
  if(q) list = list.filter(f=>f.name.includes(q));
  if(list.length===0){ wrap.innerHTML = '<div class="empty-hint">ما فيه نتائج</div>'; return; }
  list.forEach(food=>{
    const row = document.createElement('div');
    row.className = 'lib-row';
    row.innerHTML = `<div class="lm"><div class="n">${escapeHtml(food.name)} ${food.favorite?'<span class="star">★</span>':''}</div><div class="d">${food.category} · ${food.calories} سعرة · ب${food.protein} ك${food.carbs} د${food.fat}</div></div>
      <div class="lib-add">+</div>`;
    row.querySelector('.lib-add').addEventListener('click', (e)=>{ e.stopPropagation(); quickAddFood(food, null); });
    wrap.appendChild(row);
  });
}

/* ============================================================
   RENDER: GYM VIEW
   ============================================================ */

async function quickAddFood(food, chipEl){
  const entry = {id:uid(), foodId:food.id, name:food.name, category:food.category,
    calories:food.calories, protein:food.protein, carbs:food.carbs, fat:food.fat,
    fiber:food.fiber||0, sodium:food.sodium||0, time:Date.now()};
  state.log.meals.push(entry);
  food.usageCount = (food.usageCount||0)+1;
  persist();
  vibrate(10);

  if(chipEl){ chipEl.classList.add('pulse'); setTimeout(()=>chipEl.classList.remove('pulse'), 400); }
  showToast(`أضيفت ${food.name}`);
  renderAll();
}

/* ============================================================
   CALORIE DISTRIBUTION CHART
   ============================================================ */
function renderCalDist(){
  const wrap = document.getElementById('calDistWrap');
  if(!wrap) return;
  const sums = {'فطور':0,'غدا':0,'عشا':0,'سناك':0};
  state.log.meals.forEach(m=> { if(sums[m.category]!==undefined) sums[m.category]+=m.calories; });
  const total = Object.values(sums).reduce((a,b)=>a+b,0);
  if(total===0){ wrap.innerHTML = '<div class="empty-hint">سجل وجبة عشان يبين لك التوزيع</div>'; return; }
  const order = ['فطور','غدا','عشا','سناك'];
  const colors = {'فطور':'var(--fat)','غدا':'var(--protein)','عشا':'var(--carb)','سناك':'var(--shoulder)'};
  const rows = order.map(cat=>{
    const pct = Math.round((sums[cat]/total)*100);
    return `<div style="margin-bottom:10px;">
      <div style="display:flex; justify-content:space-between; font-size:11.5px; color:var(--text-dim); margin-bottom:4px;"><span>${cat}</span><span class="tabular">${sums[cat]} سعرة (${pct}٪)</span></div>
      <div style="height:8px; background:var(--border-soft); border-radius:99px; overflow:hidden;"><div style="height:100%; width:${pct}%; background:${colors[cat]}; border-radius:99px;"></div></div>
    </div>`;
  }).join('');
  wrap.innerHTML = rows;
}

/* ============================================================
   MEAL TEMPLATES
   ============================================================ */
function renderTemplateList(){
  const wrap = document.getElementById('templateList');
  const templates = appState.mealTemplates || [];
  if(templates.length===0){ wrap.innerHTML = '<div class="empty-hint">ما عندك قوالب بعد. سجل وجبات يومك واحفظها كقالب.</div>'; return; }
  wrap.innerHTML = '';
  templates.forEach(t=>{
    const cal = t.foods.reduce((s,f)=>s+f.calories,0);
    const row = document.createElement('div');
    row.className = 'template-row';
    row.innerHTML = `<div class="tm"><div class="n">${escapeHtml(t.name)}</div><div class="d">${t.foods.length} وجبات · ${cal} سعرة</div></div>
      <div class="tbtn" data-apply="${t.id}">تطبيق</div>
      <div class="tdel" data-deltmpl="${t.id}">✕</div>`;
    wrap.appendChild(row);
  });
  wrap.querySelectorAll('[data-apply]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const t = templates.find(x=>x.id===btn.getAttribute('data-apply'));
      if(!t) return;
      t.foods.forEach(f=>{
        state.log.meals.push({id:uid(), foodId:f.foodId, name:f.name, category:f.category,
          calories:f.calories, protein:f.protein, carbs:f.carbs, fat:f.fat, fiber:f.fiber||0, sodium:f.sodium||0, time:Date.now()});
      });
      persist();
      renderAll();
      closeAllSheets();
      showToast(`تم تطبيق قالب ${t.name} 🎉`);
    });
  });
  wrap.querySelectorAll('[data-deltmpl]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      appState.mealTemplates = templates.filter(x=>x.id!==btn.getAttribute('data-deltmpl'));
      persist();
      renderTemplateList();
    });
  });
}
function saveTodayAsTemplate(){
  if(state.log.meals.length===0){ showToast('ما فيه وجبات اليوم للحفظ'); return; }
  const name = prompt('اسم القالب:', 'وجباتي المعتادة');
  if(!name) return;
  const foods = state.log.meals.map(m=>({foodId:m.foodId, name:m.name, category:m.category, calories:m.calories, protein:m.protein, carbs:m.carbs, fat:m.fat, fiber:m.fiber||0, sodium:m.sodium||0}));
  if(!appState.mealTemplates) appState.mealTemplates = [];
  appState.mealTemplates.push({id:uid(), name, foods});
  persist();
  renderTemplateList();
  showToast('تم حفظ القالب 💾');
}

/* ============================================================
   RECIPE BUILDER
   ============================================================ */
let recipeSelectedIds = [];
function renderRecipePickList(){
  const wrap = document.getElementById('recipePickList');
  const q = (document.getElementById('recipeSearch').value||'').trim();
  let list = state.library.foods;
  if(q) list = list.filter(f=>f.name.includes(q));
  wrap.innerHTML = '';
  list.forEach(f=>{
    const row = document.createElement('div');
    row.className = 'recipe-pick-row';
    const checked = recipeSelectedIds.includes(f.id);
    row.innerHTML = `<input type="checkbox" data-rpick="${f.id}" ${checked?'checked':''}><div class="lm"><div class="n">${escapeHtml(f.name)}</div><div class="d">${f.calories} سعرة · ب${f.protein} ك${f.carbs} د${f.fat}</div></div>`;
    row.querySelector('input').addEventListener('change', (e)=>{
      if(e.target.checked) recipeSelectedIds.push(f.id);
      else recipeSelectedIds = recipeSelectedIds.filter(id=>id!==f.id);
      renderRecipeTotals();
    });
    wrap.appendChild(row);
  });
}
function renderRecipeTotals(){
  const wrap = document.getElementById('recipeTotals');
  const items = state.library.foods.filter(f=>recipeSelectedIds.includes(f.id));
  const totals = items.reduce((acc,f)=>({
    calories:acc.calories+f.calories, protein:acc.protein+f.protein, carbs:acc.carbs+f.carbs,
    fat:acc.fat+f.fat, fiber:acc.fiber+(f.fiber||0), sodium:acc.sodium+(f.sodium||0)
  }), {calories:0,protein:0,carbs:0,fat:0,fiber:0,sodium:0});
  wrap.innerHTML = `
    <div class="rt-row"><span>السعرات</span><b class="tabular">${Math.round(totals.calories)}</b></div>
    <div class="rt-row"><span>بروتين</span><b class="tabular">${Math.round(totals.protein)} غ</b></div>
    <div class="rt-row"><span>كارب</span><b class="tabular">${Math.round(totals.carbs)} غ</b></div>
    <div class="rt-row"><span>دهون</span><b class="tabular">${Math.round(totals.fat)} غ</b></div>
  `;
}
function saveRecipe(){
  const name = (document.getElementById('recipeName').value||'').trim();
  const cat = document.getElementById('recipeCat').value;
  if(!name){ showToast('اكتب اسم الوصفة أول'); return; }
  if(recipeSelectedIds.length===0){ showToast('اختر مكوّن وحد على الأقل'); return; }
  const items = state.library.foods.filter(f=>recipeSelectedIds.includes(f.id));
  const totals = items.reduce((acc,f)=>({
    calories:acc.calories+f.calories, protein:acc.protein+f.protein, carbs:acc.carbs+f.carbs,
    fat:acc.fat+f.fat, fiber:acc.fiber+(f.fiber||0), sodium:acc.sodium+(f.sodium||0)
  }), {calories:0,protein:0,carbs:0,fat:0,fiber:0,sodium:0});
  const food = {id:uid(), name, category:cat, calories:Math.round(totals.calories), protein:Math.round(totals.protein),
    carbs:Math.round(totals.carbs), fat:Math.round(totals.fat), fiber:Math.round(totals.fiber), sodium:Math.round(totals.sodium),
    favorite:false, usageCount:0, isCustom:true};
  state.library.foods.push(food);
  persist();
  recipeSelectedIds = [];
  document.getElementById('recipeName').value = '';
  closeAllSheets();
  renderAll();
  showToast(`تم حفظ وصفة ${name} 🍲`);
}

function renderSheetFoodCatBar(){
  const bar = document.getElementById('sheetFoodCatBar');
  bar.innerHTML = '';
  FOOD_CATS.forEach(cat=>{
    const chip = document.createElement('div');
    chip.className = 'filter-chip'+(state.activeSheetFoodCat===cat?' active':'');
    chip.textContent = cat;
    chip.addEventListener('click', ()=>{ state.activeSheetFoodCat = cat; renderSheetFoodCatBar(); renderSheetFoodList(); });
    bar.appendChild(chip);
  });
}

function renderSheetFoodList(){
  const wrap = document.getElementById('sheetFoodList');
  const q = (document.getElementById('sheetFoodSearch').value||'').trim();
  wrap.innerHTML = '';
  let list = state.library.foods;
  if(state.activeSheetFoodCat!=='الكل') list = list.filter(f=>f.category===state.activeSheetFoodCat);
  if(q) list = list.filter(f=>f.name.includes(q));
  if(list.length===0){ wrap.innerHTML = '<div class="empty-hint">ما فيه نتائج، جرب اسم ثاني أو ضيف وجبة جديدة</div>'; return; }
  list.forEach(food=>{
    const row = document.createElement('div');
    row.className = 'lib-row';
    row.innerHTML = `<div class="lm"><div class="n">${escapeHtml(food.name)}</div><div class="d">${food.category} · ${food.calories} سعرة · ب${food.protein} ك${food.carbs} د${food.fat}</div></div>
      <div class="lib-add">+</div>`;
    row.addEventListener('click', async ()=>{ await quickAddFood(food, null); closeAllSheets(); });
    wrap.appendChild(row);
  });
}

/* ============================================================
   EXERCISE PICKER SHEET
   ============================================================ */

