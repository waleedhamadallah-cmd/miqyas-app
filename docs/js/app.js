/* ============================================================
   APP BOOTSTRAP: init(), greeting, master renderAll(), all event
   bindings. Loaded last, starts the app.
   ============================================================ */
function hideSplash(){
  const splash = document.getElementById('appSplash');
  if(!splash) return;
  splash.classList.add('hide');
  setTimeout(()=> splash.remove(), 400);
}
// Safety net: if init() ever throws before reaching hideSplash(), don't
// leave the user staring at a splash screen forever.
setTimeout(hideSplash, 4000);

async function init(){
  state.today = todayKey();
  state.viewDate = state.today;
  document.getElementById('dateText').textContent = formatDateHuman(new Date());
  setGreeting();

  appState = loadLocalState() || defaultAppState();
  if(!appState.bodyWeights) appState.bodyWeights = {};
  rebindFromAppState();

  // Render immediately from local cache so the app feels instant.
  // Cloud sync (if configured) happens quietly in the background after.
  computeStreak();
  renderAll();
  bindEvents();
  hideSplash();
  syncWidget();

  if(!appState.onboarded){
    setTimeout(()=>{ startOnboarding(); }, 400);
  }

  const cfg = getSyncConfig();
  if(cfg){
    connectCloud(cfg).then((ok)=>{
      if(!ok) return;
      cloudDoc.get().then((snap)=>{
        if(snap.exists){
          const cloudState = snap.data();
          if((cloudState.updatedAt||0) > (appState.updatedAt||0)){
            appState = cloudState;
            if(!appState.bodyWeights) appState.bodyWeights = {};
            saveLocalOnly();
            rebindFromAppState();
            computeStreak();
            renderAll();
            showToast('تم تحديث بياناتك من جهاز ثاني 🔄');
          } else if((appState.updatedAt||0) > (cloudState.updatedAt||0)){
            cloudDoc.set(appState);
          }
        } else {
          cloudDoc.set(appState);
        }
        subscribeCloud();
      }).catch((e)=> console.error('initial cloud sync failed', e));
    });
  } else {
    saveLocalOnly();
  }
}

function setGreeting(){
  const h = new Date().getHours();
  let g = 'مساء الخير 🌙';
  if(h < 12) g = 'صباح الخير ☀️';
  else if(h < 17) g = 'نهارك سعيد 👋';
  document.getElementById('greetText').textContent = g;
}

function renderAll(){
  renderViewedDayBanner();
  renderViewedDayLabels();
  renderRing();
  renderStreak();
  renderWeekProgress();
  renderInsightCard();
  renderWeeklyFoodSummary();
  renderWeightCard();
  renderWeightCalorieTrend();
  renderWaterCard();
  renderQuickChips();
  renderTodaySummary();
  renderPastDaysStrip();
  renderMealsToday();
  renderFoodCatBar();
  renderFoodLibList();
  renderCalDist();
}

/* ============================================================
   ACTIONS
   ============================================================ */

function bindEvents(){
  document.querySelectorAll('.nav-btn').forEach(btn=>{
    btn.addEventListener('click', ()=> switchTab(btn.getAttribute('data-tab')));
  });
  document.getElementById('goFoodLib').addEventListener('click', ()=> switchTab('food'));

  const fab = document.getElementById('fab');
  fab.addEventListener('click', ()=>{
    if(document.getElementById('sheetQuick').classList.contains('show')) closeAllSheets();
    else{ openSheet('sheetQuick'); fab.classList.add('rot'); }
  });

  overlay.addEventListener('click', closeAllSheets);
  document.querySelectorAll('[data-close]').forEach(b=> b.addEventListener('click', closeAllSheets));

  document.getElementById('qaFood').addEventListener('click', ()=>{
    state.activeSheetFoodCat='الكل';
    state.mealBuilderMode = false;
    state.mealBuilderStep = 'protein';
    state.mealBuilderPicks = {protein:null, carb:null};
    document.getElementById('sheetFoodSearch').value='';
    document.getElementById('mealBuilderToggle').classList.remove('on');
    renderSheetFoodCatBar(); renderMealBuilderBar(); renderSheetFoodList();
    openSheet('sheetFood');
  });
  document.getElementById('mealBuilderToggle').addEventListener('click', toggleMealBuilder);
  document.getElementById('qaWeight').addEventListener('click', ()=>{
    openBodyWeightSheet();
  });
  document.getElementById('btnSaveBodyWeight').addEventListener('click', ()=>{
    const val = parseFloat(document.getElementById('bwInput').value);
    if(!val || val<=0){ showToast('اكتب وزن صحيح أول'); return; }
    appState.bodyWeights[state.today] = Math.round(val*10)/10;
    const bfVal = parseFloat(document.getElementById('bfInput').value);
    if(bfVal && bfVal>0){
      if(!appState.bodyFat) appState.bodyFat = {};
      appState.bodyFat[state.today] = Math.round(bfVal*10)/10;
    }
    persist();
    renderWeightCard();
    renderBodyWeightSheetBody();
    renderBodyFatChart();
    showToast('تم حفظ وزنك 💪');
  });

  document.getElementById('sheetFoodSearch').addEventListener('input', renderSheetFoodList);
  document.getElementById('foodSearch').addEventListener('input', renderFoodLibList);
  document.getElementById('btnReturnToday').addEventListener('click', returnToToday);

  document.getElementById('btnAddCustomFood').addEventListener('click', ()=> { resetNewFoodSheet(); openSheet('sheetNewFood'); });
  document.getElementById('btnAddCustomFood2').addEventListener('click', ()=> { resetNewFoodSheet(); openSheet('sheetNewFood'); });

  document.getElementById('btnSaveNewFood').addEventListener('click', async ()=>{
    const name = document.getElementById('nfName').value.trim();
    const cat = document.getElementById('nfCat').value;
    const cal = parseFloat(document.getElementById('nfCal').value)||0;
    const p = parseFloat(document.getElementById('nfP').value)||0;
    const c = parseFloat(document.getElementById('nfC').value)||0;
    const f = parseFloat(document.getElementById('nfF').value)||0;
    const fiber = parseFloat(document.getElementById('nfFiber').value)||0;
    const sodium = parseFloat(document.getElementById('nfSodium').value)||0;
    if(!name){ showToast('اكتب اسم الوجبة أول'); return; }

    if(state.editingFoodId){
      const food = state.library.foods.find(fd=>fd.id===state.editingFoodId);
      if(food){
        Object.assign(food, {name, category:cat, calories:cal, protein:p, carbs:c, fat:f, fiber, sodium});
        persist();
        showToast(`تم تحديث ${name} ✏️`);
      }
      resetNewFoodSheet();
      closeAllSheets();
      renderAll();
      return;
    }

    const food = {id:uid(), name, category:cat, calories:cal, protein:p, carbs:c, fat:f, fiber, sodium, favorite:false, usageCount:0, isCustom:true};
    state.library.foods.push(food);
    resetNewFoodSheet();
    await quickAddFood(food, null);
    closeAllSheets();
  });

  document.querySelectorAll('.acc-head').forEach(head=>{
    head.addEventListener('click', (e)=>{
      if(e.target.closest('.link')) return;
      head.parentElement.classList.toggle('open');
    });
  });

  document.getElementById('btnSettings').addEventListener('click', ()=>{
    document.getElementById('goalCal').value = state.goals.calories;
    document.getElementById('goalP').value = state.goals.protein;
    document.getElementById('goalC').value = state.goals.carbs;
    document.getElementById('goalF').value = state.goals.fat;
    document.getElementById('goalWater').value = state.goals.water;
    document.getElementById('goalFiber').value = state.goals.fiber;
    document.getElementById('goalSodium').value = state.goals.sodium;
    renderSyncStatus();
    renderThemeButtons();
    const syncItem = document.querySelector('.acc-item[data-acc="sync"]');
    if(syncItem) syncItem.classList.toggle('open', !!getSyncConfig());
    openSheet('sheetSettings');
  });
  document.getElementById('btnSaveGoals').addEventListener('click', ()=>{
    state.goals = {
      calories: parseInt(document.getElementById('goalCal').value,10) || defaultGoals().calories,
      protein: parseInt(document.getElementById('goalP').value,10) || defaultGoals().protein,
      carbs: parseInt(document.getElementById('goalC').value,10) || defaultGoals().carbs,
      fat: parseInt(document.getElementById('goalF').value,10) || defaultGoals().fat,
      water: parseInt(document.getElementById('goalWater').value,10) || defaultGoals().water,
      fiber: parseInt(document.getElementById('goalFiber').value,10) || defaultGoals().fiber,
      sodium: parseInt(document.getElementById('goalSodium').value,10) || defaultGoals().sodium,
    };
    appState.goals = state.goals;
    persist();
    showToast('تم تحديث الأهداف');
    closeAllSheets();
    renderAll();
  });

  /* ---------- Theme ---------- */
  document.getElementById('themeDarkBtn').addEventListener('click', ()=>{ if(appState.theme!=='dark') toggleTheme(); renderThemeButtons(); });
  document.getElementById('themeLightBtn').addEventListener('click', ()=>{ if(appState.theme!=='light') toggleTheme(); renderThemeButtons(); });

  /* ---------- Water tracker ---------- */
  document.querySelectorAll('[data-water]').forEach(btn=>{
    btn.addEventListener('click', ()=> addWater(parseInt(btn.getAttribute('data-water'),10)));
  });
  document.getElementById('btnAddCustomWater').addEventListener('click', ()=>{
    const input = document.getElementById('waterCustomInput');
    const val = parseInt(input.value,10);
    if(!val || val<=0){ showToast('اكتب كمية صحيحة بالمل'); return; }
    addWater(val);
    input.value = '';
  });

  /* ---------- Smart goal calculator (opens onboarding flow) ---------- */
  document.getElementById('btnOpenSmartGoals').addEventListener('click', ()=> startOnboarding(true));

  /* ---------- Backup export / import ---------- */
  document.getElementById('btnExportData').addEventListener('click', ()=> exportDataFile());
  document.getElementById('btnImportData').addEventListener('click', ()=> document.getElementById('importFileInput').click());
  document.getElementById('importFileInput').addEventListener('change', (e)=>{
    const file = e.target.files[0];
    if(file) importDataFile(file, ()=>{ e.target.value=''; closeAllSheets(); });
  });

  /* ---------- Share card ---------- */
  document.getElementById('btnOpenShareCard').addEventListener('click', ()=>{
    openSheet('sheetShareCard');
    setTimeout(drawShareCard, 50);
  });
  document.getElementById('btnDownloadShareCard').addEventListener('click', ()=>{
    const canvas = document.getElementById('shareCanvas');
    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/png');
    a.download = `miqyas-week-${state.today}.png`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
  });

  /* ---------- Nutrition report (for a doctor / dietitian) ---------- */
  document.getElementById('btnOpenReport').addEventListener('click', ()=>{
    document.querySelectorAll('#reportPeriodBar .filter-chip').forEach(c=> c.classList.toggle('active', c.getAttribute('data-period')==='30'));
    openSheet('sheetReport');
    setTimeout(()=> renderReportPreview(30), 50);
  });
  document.getElementById('reportPeriodBar').addEventListener('click', (e)=>{
    const chip = e.target.closest('.filter-chip');
    if(!chip) return;
    document.querySelectorAll('#reportPeriodBar .filter-chip').forEach(c=> c.classList.remove('active'));
    chip.classList.add('active');
    renderReportPreview(parseInt(chip.getAttribute('data-period'),10));
  });
  document.getElementById('btnDownloadReport').addEventListener('click', ()=>{
    const canvas = document.getElementById('reportCanvas');
    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/png');
    a.download = `miqyas-report-${reportPeriod}d-${state.today}.png`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
  });

  /* ---------- Meal templates ---------- */
  document.getElementById('btnOpenTemplates').addEventListener('click', ()=>{
    renderTemplateList();
    openSheet('sheetMealTemplates');
  });
  document.getElementById('btnSaveTodayAsTemplate').addEventListener('click', ()=> saveTodayAsTemplate());

  /* ---------- Recipe builder ---------- */
  document.getElementById('btnOpenRecipeBuilder').addEventListener('click', ()=>{
    recipeSelectedIds = [];
    document.getElementById('recipeSearch').value = '';
    renderRecipePickList();
    renderRecipeTotals();
    openSheet('sheetRecipeBuilder');
  });
  document.getElementById('recipeSearch').addEventListener('input', renderRecipePickList);
  document.getElementById('btnSaveRecipe').addEventListener('click', ()=> saveRecipe());

  /* ---------- Body measurements ---------- */
  document.getElementById('btnSaveMeasurements').addEventListener('click', ()=> saveMeasurements());

  /* ---------- Onboarding ---------- */
  bindOnboardingEvents();
}

/* ============================================================
   THEME BUTTONS
   ============================================================ */
function renderThemeButtons(){
  document.getElementById('themeDarkBtn').classList.toggle('active', appState.theme!=='light');
  document.getElementById('themeLightBtn').classList.toggle('active', appState.theme==='light');
}

/* ============================================================
   SHARE CARD (canvas)
   ============================================================ */
function drawShareCard(){
  const canvas = document.getElementById('shareCanvas');
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;

  // background gradient
  const grad = ctx.createLinearGradient(0,0,0,h);
  grad.addColorStop(0, '#171C21'); grad.addColorStop(1, '#12161A');
  ctx.fillStyle = grad; ctx.fillRect(0,0,w,h);

  // week stats
  let totalCal=0, totalProtein=0, mealDays=0, waterDays=0;
  for(let i=0;i<=6;i++){
    const key = dateKeyOffset(i);
    const dayLog = appState.logs[key] || {meals:[]};
    if((dayLog.meals||[]).length>0){
      mealDays++;
      totalCal += dayLog.meals.reduce((s,m)=>s+m.calories,0);
      totalProtein += dayLog.meals.reduce((s,m)=>s+m.protein,0);
    }
    if((dayLog.waterMl||0) > 0) waterDays++;
  }
  const avgCal = mealDays ? Math.round(totalCal/mealDays) : 0;
  const avgProtein = mealDays ? Math.round(totalProtein/mealDays) : 0;

  ctx.textAlign = 'center';
  ctx.fillStyle = '#F3F1EA';
  ctx.font = '900 34px Arial';
  ctx.fillText('ملخص أسبوعي — مِقياس', w/2, 70);
  ctx.font = '500 16px Arial';
  ctx.fillStyle = '#8A9199';
  ctx.fillText(formatDateHuman(new Date()), w/2, 100);

  // ring-ish stat blocks
  const stats = [
    {label:'أيام سجّلت فيها', value:mealDays, color:'#2FD3A6'},
    {label:'سلسلة الأيام', value:state.streak, color:'#5B9DFF'},
    {label:'متوسط السعرات', value:avgCal.toLocaleString('en-US'), color:'#F2B84B'},
    {label:'متوسط البروتين (غ)', value:avgProtein.toLocaleString('en-US'), color:'#FF6B4A'},
  ];
  const boxW = (w-80)/2, boxH = 130, gap=20;
  stats.forEach((s,i)=>{
    const col = i%2, row = Math.floor(i/2);
    const x = 40 + col*(boxW+gap), y = 150 + row*(boxH+gap);
    ctx.fillStyle = '#1C2329';
    roundRect(ctx, x, y, boxW, boxH, 20); ctx.fill();
    ctx.fillStyle = s.color;
    ctx.font = '900 40px Arial';
    ctx.fillText(String(s.value), x+boxW/2, y+65);
    ctx.fillStyle = '#8A9199';
    ctx.font = '500 15px Arial';
    ctx.fillText(s.label, x+boxW/2, y+95);
  });

  ctx.fillStyle = '#4A5058';
  ctx.font = '500 13px Arial';
  ctx.fillText('صُنع بتطبيق مِقياس', w/2, h-30);
}
function roundRect(ctx,x,y,width,height,radius){
  ctx.beginPath();
  ctx.moveTo(x+radius,y);
  ctx.arcTo(x+width,y,x+width,y+height,radius);
  ctx.arcTo(x+width,y+height,x,y+height,radius);
  ctx.arcTo(x,y+height,x,y,radius);
  ctx.arcTo(x,y,x+width,y,radius);
  ctx.closePath();
}

/* ============================================================
   ONBOARDING FLOW
   ============================================================ */
let obCurrentStep = 1;
let obSelectedGoal = null;

function startOnboarding(fromSettings){
  obCurrentStep = 1;
  obSelectedGoal = null;
  document.querySelectorAll('.ob-choice').forEach(c=>c.classList.remove('active'));
  renderOnboardingStep();
  openSheet('sheetOnboarding');
}
function renderOnboardingStep(){
  document.querySelectorAll('.ob-step').forEach(s=>s.classList.remove('active'));
  document.getElementById('obStep'+obCurrentStep).classList.add('active');
  ['obDot1','obDot2','obDot3'].forEach((id,i)=>{
    document.getElementById(id).classList.toggle('done', i < obCurrentStep);
  });
  document.getElementById('obBackBtn').style.display = obCurrentStep>1 ? 'block' : 'none';
  document.getElementById('obNextBtn').textContent = obCurrentStep===3 ? 'اعتمد الأهداف' : 'التالي';
  if(obCurrentStep===3) computeAndShowOnboardingResult();
}
function computeAndShowOnboardingResult(){
  const sex = document.getElementById('obSex').value;
  const age = parseInt(document.getElementById('obAge').value,10) || 25;
  const heightCm = parseFloat(document.getElementById('obHeight').value) || 175;
  const weightKg = parseFloat(document.getElementById('obWeight').value) || 75;
  const activity = document.getElementById('obActivity').value;
  const goals = calcSmartGoals({sex, age, heightCm, weightKg, activity, goal: obSelectedGoal || 'maintain'});
  document.getElementById('obCalResult').textContent = goals.calories.toLocaleString('en-US');
  document.getElementById('obPResult').textContent = goals.protein;
  document.getElementById('obCResult').textContent = goals.carbs;
  document.getElementById('obFResult').textContent = goals.fat;
}
function bindOnboardingEvents(){
  document.querySelectorAll('.ob-choice').forEach(el=>{
    el.addEventListener('click', ()=>{
      document.querySelectorAll('.ob-choice').forEach(c=>c.classList.remove('active'));
      el.classList.add('active');
      obSelectedGoal = el.getAttribute('data-goal');
    });
  });
  document.getElementById('obNextBtn').addEventListener('click', ()=>{
    if(obCurrentStep===1 && !obSelectedGoal){ showToast('اختر هدفك أول'); return; }
    if(obCurrentStep<3){ obCurrentStep++; renderOnboardingStep(); return; }
    // finalize
    const sex = document.getElementById('obSex').value;
    const age = parseInt(document.getElementById('obAge').value,10) || 25;
    const heightCm = parseFloat(document.getElementById('obHeight').value) || 175;
    const weightKg = parseFloat(document.getElementById('obWeight').value) || 75;
    const activity = document.getElementById('obActivity').value;
    const goals = calcSmartGoals({sex, age, heightCm, weightKg, activity, goal: obSelectedGoal || 'maintain'});
    state.goals = {...state.goals, ...goals};
    appState.goals = state.goals;
    appState.onboarded = true;
    if(weightKg) appState.bodyWeights[state.today] = weightKg;
    persist();
    closeAllSheets();
    renderAll();
    showToast('تمام! أهدافك جاهزة 🎉');
  });
  document.getElementById('obBackBtn').addEventListener('click', ()=>{
    if(obCurrentStep>1){ obCurrentStep--; renderOnboardingStep(); }
  });
}

init();
