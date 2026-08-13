/* ============================================================
   APP BOOTSTRAP: init(), greeting, master renderAll(), all event
   bindings. Loaded last, starts the app.
   ============================================================ */
async function init(){
  state.today = todayKey();
  state.viewDate = state.today;
  document.getElementById('dateText').textContent = formatDateHuman(new Date());
  setGreeting();

  appState = loadLocalState() || defaultAppState();
  if(!appState.plan) appState.plan = generatePlan('upper_lower_4', appState.library);
  if(!appState.bodyWeights) appState.bodyWeights = {};
  rebindFromAppState();
  state.viewedPlanDay = new Date().getDay();

  // Render immediately from local cache so the app feels instant.
  // Cloud sync (if configured) happens quietly in the background after.
  computeStreak();
  renderAll();
  bindEvents();

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
  renderWaterCard();
  renderQuickChips();
  renderTodaySummary();
  renderPastDaysStrip();
  renderMealsToday();
  renderFoodCatBar();
  renderFoodLibList();
  renderCalDist();
  renderWorkoutsToday();
  renderGymHistory();
  renderDayStrip();
  renderPlanCard();
  renderOvertrainWarning();
  renderVolumeLandmarks();
  renderGymStatsRow();
  renderGymFavorites();
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
  document.getElementById('qaWorkout').addEventListener('click', ()=>{
    state.activeExGroup='الكل';
    document.getElementById('exSearch').value='';
    state.supersetPickMode=false; state.supersetPicks=[];
    renderExGroupBar(); renderExList(); renderSupersetBar();
    openSheet('sheetWorkoutPick');
  });
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
  document.getElementById('btnStartWorkout').addEventListener('click', ()=>{
    state.activeExGroup='الكل';
    document.getElementById('exSearch').value='';
    state.supersetPickMode=false; state.supersetPicks=[];
    renderExGroupBar(); renderExList(); renderSupersetBar();
    openSheet('sheetWorkoutPick');
  });
  document.getElementById('supersetToggle').addEventListener('click', (e)=>{
    state.supersetPickMode = !state.supersetPickMode;
    state.supersetPicks = [];
    e.currentTarget.classList.toggle('on', state.supersetPickMode);
    renderExList();
    renderSupersetBar();
  });
  document.getElementById('btnStartSuperset').addEventListener('click', ()=>{
    if(state.supersetPicks.length!==2) return;
    startSession([...state.supersetPicks]);
  });

  document.getElementById('sheetFoodSearch').addEventListener('input', renderSheetFoodList);
  document.getElementById('foodSearch').addEventListener('input', renderFoodLibList);
  document.getElementById('exSearch').addEventListener('input', renderExList);
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

  document.getElementById('btnAddCustomEx').addEventListener('click', ()=> openSheet('sheetNewEx'));
  document.getElementById('btnSaveNewEx').addEventListener('click', ()=>{
    const name = document.getElementById('neName').value.trim();
    const group = document.getElementById('neGroup').value;
    const movementType = document.getElementById('neMovement').value;
    if(!name){ showToast('اكتب اسم التمرين أول'); return; }
    const ex = {id:uid(), name, group, movementType, equipment:'barbell', injured:false, favorite:false, usageCount:0, lastWeight:0, lastReps:0, prWeight:0, prReps:0, prVolume:0, prDate:null};
    state.library.exercises.push(ex);
    persist();
    document.getElementById('neName').value='';
    startSession([ex]);
  });

  document.getElementById('fieldWeightBtn').addEventListener('click', ()=>{ state.activeField='weight'; updateFieldDisplay(); });
  document.getElementById('fieldRepsBtn').addEventListener('click', ()=>{ state.activeField='reps'; updateFieldDisplay(); });

  document.getElementById('keypad').addEventListener('click', (e)=>{
    const k = e.target.closest('.key');
    if(!k) return;
    keypadPress(k.getAttribute('data-k'));
  });

  document.getElementById('btnAddSet').addEventListener('click', ()=>{
    if(state.weightVal<=0 && state.repsVal<=0){ showToast('حدد الوزن أو التكرارات'); return; }
    const ex = activeSessionExercise();
    state.sessionSets[ex.id].push({weight:state.weightVal, reps:state.repsVal});
    renderSetChips();
    renderSessionTabs();
    vibrate(15);
    startRestTimer(90);
    if(state.activeField==='weight'){ state.activeField='reps'; updateFieldDisplay(); }
  });

  document.getElementById('btnFinishWorkout').addEventListener('click', ()=>{
    const totalSets = state.sessionExercises.reduce((n,ex)=> n + state.sessionSets[ex.id].length, 0);
    if(totalSets===0){ showToast('ضيف جولة وحدة على الأقل'); return; }
    stopSessionTimer();
    stopRestTimer();
    const durationSec = Math.floor((Date.now()-state.sessionStartTime)/1000);
    const supersetId = state.sessionExercises.length>1 ? uid() : null;
    const prNames = [];
    const savedNames = [];
    state.sessionExercises.forEach(ex=>{
      const sets = state.sessionSets[ex.id];
      if(sets.length===0) return;
      const {isPR, volume} = checkAndApplyPR(ex, sets);
      const entry = {id:uid(), exerciseId:ex.id, name:ex.name, group:ex.group, movementType:ex.movementType,
        sets:[...sets], time:Date.now(), durationSec, supersetId, volume, isPR};
      state.log.workouts.push(entry);
      const last = sets[sets.length-1];
      ex.lastWeight = last.weight; ex.lastReps = last.reps; ex.usageCount = (ex.usageCount||0)+1;
      savedNames.push(ex.name);
      if(isPR) prNames.push(ex.name);
    });
    persist();
    computeStreak();
    closeAllSheets();
    renderAll();
    if(prNames.length>0){ showPRCelebration(prNames); }
    else{ showToast(`تم حفظ ${savedNames.join(' + ')} 💪`); }
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
    renderSyncStatus();
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
    };
    appState.goals = state.goals;
    persist();
    showToast('تم تحديث الأهداف');
    closeAllSheets();
    renderAll();
  });

  document.getElementById('btnEditPlan').addEventListener('click', ()=>{
    state.selectedPresetType = state.plan.type || 'upper_lower_4';
    renderPlanPresetList();
    openSheet('sheetPlanEdit');
  });
  document.getElementById('btnApplyPlan').addEventListener('click', ()=>{
    state.plan = generatePlan(state.selectedPresetType);
    appState.plan = state.plan;
    persist();
    computeStreak();
    closeAllSheets();
    renderAll();
    showToast('تم تحديث خطتك');
  });

  document.getElementById('btnShowPRs').addEventListener('click', ()=>{
    renderPRList();
    openSheet('sheetPRs');
  });
  document.getElementById('btnPrClose').addEventListener('click', ()=>{
    document.getElementById('prOverlay').classList.remove('show');
  });

  /* ---------- Theme ---------- */
  document.getElementById('themeDarkBtn').addEventListener('click', ()=>{ if(appState.theme!=='dark') toggleTheme(); renderThemeButtons(); });
  document.getElementById('themeLightBtn').addEventListener('click', ()=>{ if(appState.theme!=='light') toggleTheme(); renderThemeButtons(); });

  /* ---------- Equipment filter (exercise picker) ---------- */
  document.getElementById('qaWorkout').addEventListener('click', ()=> renderExEquipBar());
  document.getElementById('btnStartWorkout').addEventListener('click', ()=> renderExEquipBar());

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

  /* ---------- Rest timer controls ---------- */
  document.getElementById('restTimerMinus').addEventListener('click', ()=> adjustRestTimer(-15));
  document.getElementById('restTimerPlus').addEventListener('click', ()=> adjustRestTimer(15));
  document.getElementById('restTimerSkip').addEventListener('click', ()=> stopRestTimer());

  /* ---------- Extended goals fields ---------- */
  document.getElementById('btnSettings').addEventListener('click', ()=>{
    document.getElementById('goalWater').value = state.goals.water;
    document.getElementById('goalFiber').value = state.goals.fiber;
    document.getElementById('goalSodium').value = state.goals.sodium;
    renderThemeButtons();
    renderEquipRow();
  });
  document.getElementById('btnSaveGoals').addEventListener('click', ()=>{
    state.goals.water = parseInt(document.getElementById('goalWater').value,10) || defaultGoals().water;
    state.goals.fiber = parseInt(document.getElementById('goalFiber').value,10) || defaultGoals().fiber;
    state.goals.sodium = parseInt(document.getElementById('goalSodium').value,10) || defaultGoals().sodium;
    appState.goals = state.goals;
    persist();
    renderWaterCard();
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
   EQUIPMENT SETTINGS ROW
   ============================================================ */
function renderEquipRow(){
  const wrap = document.getElementById('equipRow');
  wrap.innerHTML = '';
  ALL_EQUIPMENT.forEach(eq=>{
    const chip = document.createElement('div');
    const on = (appState.equipment||[]).includes(eq);
    chip.className = 'equip-chip'+(on?' on':'');
    chip.textContent = EQUIPMENT_LABELS[eq];
    chip.addEventListener('click', ()=>{
      const list = appState.equipment || [];
      if(list.includes(eq)){
        if(list.length===1){ showToast('لازم يبقى معدة وحدة على الأقل'); return; }
        appState.equipment = list.filter(x=>x!==eq);
      } else {
        appState.equipment = [...list, eq];
      }
      persist();
      renderEquipRow();
    });
    wrap.appendChild(chip);
  });
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
  let totalCal=0, mealDays=0, workouts=0, volume=0;
  const seen = new Set();
  for(let i=0;i<=6;i++){
    const key = dateKeyOffset(i);
    const dayLog = appState.logs[key] || {meals:[],workouts:[]};
    if((dayLog.meals||[]).length>0){ mealDays++; totalCal += dayLog.meals.reduce((s,m)=>s+m.calories,0); }
    (dayLog.workouts||[]).forEach(wk=>{ workouts++; volume += (wk.sets||[]).reduce((s,x)=>s+x.weight*x.reps,0); });
  }
  const avgCal = mealDays ? Math.round(totalCal/mealDays) : 0;

  ctx.textAlign = 'center';
  ctx.fillStyle = '#F3F1EA';
  ctx.font = '900 34px Arial';
  ctx.fillText('ملخص أسبوعي — مِقياس', w/2, 70);
  ctx.font = '500 16px Arial';
  ctx.fillStyle = '#8A9199';
  ctx.fillText(formatDateHuman(new Date()), w/2, 100);

  // ring-ish stat blocks
  const stats = [
    {label:'تمارين', value:workouts, color:'#2FD3A6'},
    {label:'حجم التدريب (كغ)', value:Math.round(volume).toLocaleString('en-US'), color:'#FF6B4A'},
    {label:'متوسط السعرات', value:avgCal.toLocaleString('en-US'), color:'#F2B84B'},
    {label:'سلسلة الأيام', value:state.streak, color:'#5B9DFF'},
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

  // PR highlight
  const prEx = state.library.exercises.filter(e=>e.prDate===state.today);
  ctx.fillStyle = '#8A9199';
  ctx.font = '600 16px Arial';
  if(prEx.length>0){
    ctx.fillStyle = '#F2B84B';
    ctx.font = '800 20px Arial';
    ctx.fillText(`🏆 رقم قياسي جديد: ${prEx[0].name}`, w/2, 470);
  }

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
