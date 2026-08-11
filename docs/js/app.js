/* ============================================================
   APP BOOTSTRAP: init(), greeting, master renderAll(), all event
   bindings. Loaded last, starts the app.
   ============================================================ */
async function init(){
  state.today = todayKey();
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
  renderRing();
  renderStreak();
  renderWeekProgress();
  renderInsightCard();
  renderWeightCard();
  renderQuickChips();
  renderTodaySummary();
  renderMealsToday();
  renderFoodCatBar();
  renderFoodLibList();
  renderWorkoutsToday();
  renderGymHistory();
  renderDayStrip();
  renderPlanCard();
  renderMuscleHeatmap();
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
    document.getElementById('sheetFoodSearch').value='';
    renderSheetFoodCatBar(); renderSheetFoodList();
    openSheet('sheetFood');
  });
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
    persist();
    renderWeightCard();
    renderBodyWeightSheetBody();
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

  document.getElementById('btnAddCustomFood').addEventListener('click', ()=> openSheet('sheetNewFood'));
  document.getElementById('btnAddCustomFood2').addEventListener('click', ()=> openSheet('sheetNewFood'));

  document.getElementById('btnSaveNewFood').addEventListener('click', async ()=>{
    const name = document.getElementById('nfName').value.trim();
    const cat = document.getElementById('nfCat').value;
    const cal = parseFloat(document.getElementById('nfCal').value)||0;
    const p = parseFloat(document.getElementById('nfP').value)||0;
    const c = parseFloat(document.getElementById('nfC').value)||0;
    const f = parseFloat(document.getElementById('nfF').value)||0;
    if(!name){ showToast('اكتب اسم الوجبة أول'); return; }
    const food = {id:uid(), name, category:cat, calories:cal, protein:p, carbs:c, fat:f, favorite:false, usageCount:0};
    state.library.foods.push(food);
    ['nfName','nfCal','nfP','nfC','nfF'].forEach(id=> document.getElementById(id).value='');
    await quickAddFood(food, null);
    closeAllSheets();
  });

  document.getElementById('btnAddCustomEx').addEventListener('click', ()=> openSheet('sheetNewEx'));
  document.getElementById('btnSaveNewEx').addEventListener('click', ()=>{
    const name = document.getElementById('neName').value.trim();
    const group = document.getElementById('neGroup').value;
    const movementType = document.getElementById('neMovement').value;
    if(!name){ showToast('اكتب اسم التمرين أول'); return; }
    const ex = {id:uid(), name, group, movementType, favorite:false, usageCount:0, lastWeight:0, lastReps:0, prWeight:0, prReps:0, prVolume:0, prDate:null};
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
    if(state.activeField==='weight'){ state.activeField='reps'; updateFieldDisplay(); }
  });

  document.getElementById('btnFinishWorkout').addEventListener('click', ()=>{
    const totalSets = state.sessionExercises.reduce((n,ex)=> n + state.sessionSets[ex.id].length, 0);
    if(totalSets===0){ showToast('ضيف جولة وحدة على الأقل'); return; }
    stopSessionTimer();
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

  document.getElementById('btnSettings').addEventListener('click', ()=>{
    document.getElementById('goalCal').value = state.goals.calories;
    document.getElementById('goalP').value = state.goals.protein;
    document.getElementById('goalC').value = state.goals.carbs;
    document.getElementById('goalF').value = state.goals.fat;
    renderSyncStatus();
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
}

init();
