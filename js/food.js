/* ============================================================
   FOOD TAB: today's meals, food library list/search, quick add
   ============================================================ */
function renderMealsToday(){
  const wrap = document.getElementById('mealsToday');
  wrap.innerHTML = '';
  if(state.log.meals.length===0){ wrap.innerHTML = '<div class="empty-hint">ولا وجبة مسجلة اليوم بعد</div>'; return; }
  state.log.meals.forEach(m=>{
    const row = document.createElement('div');
    row.className = 'entry-row';
    row.innerHTML = `<div class="entry-dot" style="background:var(--protein)"></div>
      <div class="entry-main"><div class="t1">${escapeHtml(m.name)}</div><div class="t2">${m.category} · ب${Math.round(m.protein)} ك${Math.round(m.carbs)} د${Math.round(m.fat)}</div></div>
      <div class="entry-side tabular">${m.calories}</div>
      <div class="entry-del" data-del-meal="${m.id}">✕</div>`;
    wrap.appendChild(row);
  });
  wrap.querySelectorAll('[data-del-meal]').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      const id = btn.getAttribute('data-del-meal');
      state.log.meals = state.log.meals.filter(m=>m.id!==id);
      persist();
      renderAll();
    });
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
    calories:food.calories, protein:food.protein, carbs:food.carbs, fat:food.fat, time:Date.now()};
  state.log.meals.push(entry);
  food.usageCount = (food.usageCount||0)+1;
  persist();

  if(chipEl){ chipEl.classList.add('pulse'); setTimeout(()=>chipEl.classList.remove('pulse'), 400); }
  showToast(`أضيفت ${food.name}`);
  renderAll();
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

