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
  bindAndroidBackButton();
  bindDateRolloverCheck();
  hideSplash();
  syncWidget();
  applyReminderSettings();

  // Non-blocking: the card already rendered instantly from yesterday's
  // cache above, this just fetches a fresh number in the background so it
  // doesn't hold up the splash screen or the rest of init().
  if(appState.healthConnectGranted) refreshSteps();

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
            // saveLocalOnly() (not persist()) is used here on purpose, to
            // avoid immediately pushing the just-pulled data straight back
            // to the cloud — but that also means it skips persist()'s own
            // syncWidget() call, so without this the home-screen widget and
            // any reminder schedule silently keep showing/using whatever
            // was on THIS device before the sync, until the app is fully
            // closed and reopened.
            syncWidget();
            applyReminderSettings();
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
  // Recomputed on every render (cheap — a 7-day loop) so the streak flame
  // and week-progress bar never lag behind a meal just logged/deleted this
  // session; previously this only refreshed on init/rollover/cloud-sync, so
  // logging today's first meal wouldn't light up "today" until the app was
  // reopened.
  computeStreak();
  renderViewedDayBanner();
  renderViewedDayLabels();
  renderRing();
  renderStreak();
  renderWeekProgress();
  renderInsightCard();
  renderWeeklyFoodSummary();
  renderWeightCard();
  renderWeightCalorieTrend();
  renderStepsTrendCard();
  renderWaterCard();
  renderStepsCard();
  renderTodaySummary();
  renderPastDaysStrip();
  renderMealsToday();
  renderFoodLibList();
}

/* ============================================================
   ACTIONS
   ============================================================ */

function bindEvents(){
  document.querySelectorAll('.nav-btn').forEach(btn=>{
    btn.addEventListener('click', ()=> switchTab(btn.getAttribute('data-tab')));
  });

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
  document.getElementById('qaAiScan').addEventListener('click', ()=>{
    // A previous scan with items the user hasn't finished dealing with yet
    // (e.g. saved item 1 of a 3-item plate, then tapped the AI icon again
    // for item 2) gets restored instead of wiped — see aiScanPending.
    if(typeof aiScanPending !== 'undefined' && aiScanPending && aiScanPending.items.length){
      restoreAiScanPendingSheet();
    } else {
      resetAiScanSheet();
    }
    openSheet('sheetAiScan');
  });
  document.getElementById('qaBarcode').addEventListener('click', ()=> openBarcodeScanSheet());
  document.getElementById('btnBarcodeManualSubmit').addEventListener('click', ()=>{
    const val = document.getElementById('barcodeManualInput').value.trim();
    if(!val){ showToast('اكتب رقم الباركود أول'); return; }
    handleScannedBarcode(val);
  });
  document.getElementById('barcodeManualInput').addEventListener('keydown', (e)=>{
    if(e.key==='Enter'){ e.preventDefault(); document.getElementById('btnBarcodeManualSubmit').click(); }
  });
  document.getElementById('aiScanCameraBtn').addEventListener('click', ()=> document.getElementById('aiScanCameraInput').click());
  document.getElementById('aiScanGalleryBtn').addEventListener('click', ()=> document.getElementById('aiScanGalleryInput').click());
  document.getElementById('aiScanCameraInput').addEventListener('change', (e)=>{
    const f = e.target.files[0]; e.target.value='';
    if(f) handleAiScanFile(f);
  });
  document.getElementById('aiScanGalleryInput').addEventListener('change', (e)=>{
    const f = e.target.files[0]; e.target.value='';
    if(f) handleAiScanFile(f);
  });
  document.getElementById('aiModeLibraryBtn').addEventListener('click', ()=> setAiScanMode('library'));
  document.getElementById('aiModeGeneralBtn').addEventListener('click', ()=> setAiScanMode('general'));
  document.querySelectorAll('#aiScanModeToggle .theme-opt').forEach(btn=>{
    btn.addEventListener('keydown', (e)=>{
      if(e.key==='Enter' || e.key===' '){ e.preventDefault(); btn.click(); }
    });
  });
  document.getElementById('aiScanTextSubmitBtn').addEventListener('click', ()=>{
    handleAiScanText(document.getElementById('aiScanTextInput').value);
  });
  document.getElementById('aiScanTextInput').addEventListener('keydown', (e)=>{
    if(e.key==='Enter'){ e.preventDefault(); handleAiScanText(e.target.value); }
  });
  document.getElementById('btnSaveAiSettings').addEventListener('click', ()=>{
    appState.aiProxyUrl = document.getElementById('aiProxyUrlInput').value.trim();
    appState.aiProxySecret = document.getElementById('aiProxySecretInput').value.trim();
    persist();
    showToast('تم حفظ إعدادات الذكاء الاصطناعي ✅');
  });
  document.getElementById('btnSaveBodyWeight').addEventListener('click', ()=>{
    const dateKey = bwEditDate || state.today;
    const val = parseFloat(document.getElementById('bwInput').value);
    if(!val || val<=0){ showToast('اكتب وزن صحيح أول'); return; }
    appState.bodyWeights[dateKey] = Math.round(val*10)/10;
    syncHealthConnectWeight(dateKey, appState.bodyWeights[dateKey]);
    const bfVal = parseFloat(document.getElementById('bfInput').value);
    if(bfVal && bfVal>0){
      if(!appState.bodyFat) appState.bodyFat = {};
      appState.bodyFat[dateKey] = Math.round(bfVal*10)/10;
    }
    const heightVal = parseFloat(document.getElementById('bwHeight').value);
    appState.profile.heightCm = (heightVal && heightVal>0) ? Math.round(heightVal) : null;
    const targetVal = parseFloat(document.getElementById('bwTarget').value);
    appState.profile.targetWeightKg = (targetVal && targetVal>0) ? Math.round(targetVal*10)/10 : null;
    persist();
    renderWeightCard();
    renderBodyWeightSheetBody();
    renderBodyFatChart();
    // renderAll() calls this on every other render path, but this handler
    // never did — so "الوزن مقابل السعرات" right below the weight card kept
    // showing pre-save data until some unrelated action triggered a full
    // renderAll().
    renderWeightCalorieTrend();
    showToast(dateKey===state.today ? 'تم حفظ وزنك 💪' : 'تم تحديث وزن ذاك اليوم 💪');
  });
  document.getElementById('bwDateInput').addEventListener('change', (e)=>{
    let dateKey = e.target.value;
    if(!dateKey) return;
    if(dateKey > state.today){ dateKey = state.today; e.target.value = state.today; }
    loadBodyWeightFieldsForDate(dateKey);
  });

  document.getElementById('sheetFoodSearch').addEventListener('input', renderSheetFoodList);
  document.getElementById('foodSearch').addEventListener('input', renderFoodLibList);
  document.getElementById('btnReturnToday').addEventListener('click', returnToToday);

  document.getElementById('btnAddCustomFood').addEventListener('click', ()=> { resetNewFoodSheet(); openSheet('sheetNewFood'); });
  document.getElementById('btnAddCustomFood2').addEventListener('click', ()=> { resetNewFoodSheet(); openSheet('sheetNewFood'); });

  document.getElementById('btnSaveNewFood').addEventListener('click', async ()=>{
    const name = document.getElementById('nfName').value.trim();
    const cat = document.getElementById('nfCat').value;
    const type = document.getElementById('nfType').value;
    const cal = parseFloat(document.getElementById('nfCal').value)||0;
    const p = parseFloat(document.getElementById('nfP').value)||0;
    const c = parseFloat(document.getElementById('nfC').value)||0;
    const f = parseFloat(document.getElementById('nfF').value)||0;
    if(!name){ showToast('اكتب اسم الوجبة أول'); return; }

    if(state.editingFoodId){
      const food = state.library.foods.find(fd=>fd.id===state.editingFoodId);
      if(food){
        // fiber/sodium intentionally left untouched here — the fields were
        // removed from this form, so whatever value the food already had
        // (usually 0 from defaultFoods()) just carries forward as-is.
        Object.assign(food, {name, category:cat, foodType: type || undefined, calories:cal, protein:p, carbs:c, fat:f});
        persist();
        showToast(`تم تحديث ${name} ✏️`);
      }
      resetNewFoodSheet();
      closeAllSheets();
      renderAll();
      return;
    }

    // Carries over the barcode (if this form was opened from a barcode
    // scan — see applyBarcodeProductToNewFoodForm()/openBarcodeManualNewFood()
    // in barcode.js) so scanning the same product again next time hits the
    // "already in my library" instant-log path instead of doing another
    // Open Food Facts lookup.
    const food = {id:uid(), name, category:cat, foodType: type || undefined, calories:cal, protein:p, carbs:c, fat:f, fiber:0, sodium:0, favorite:false, usageCount:0, isCustom:true, barcode: pendingNewFoodBarcode || undefined};
    pendingNewFoodBarcode = null;
    state.library.foods.push(food);
    resetNewFoodSheet();
    await quickAddFood(food, null);
    closeAllSheets();
  });

  /* ---------- Edit logged meal (quantity / delete) ---------- */
  document.getElementById('editMealQtyChips').addEventListener('click', (e)=>{
    const chip = e.target.closest('.filter-chip');
    if(!chip) return;
    document.getElementById('editMealQtyCustom').value = '';
    setEditMealQty(parseFloat(chip.getAttribute('data-qty')));
  });
  document.getElementById('editMealQtyCustom').addEventListener('input', (e)=>{
    const val = parseFloat(e.target.value);
    if(val>0) setEditMealQty(val);
  });
  document.getElementById('btnSaveEditMeal').addEventListener('click', ()=> saveEditMealQty());
  document.getElementById('btnDeleteEditMeal').addEventListener('click', ()=>{
    if(!editMealId) return;
    deleteMealEntry(editMealId);
    closeAllSheets();
  });

  /* ---------- Apply template with a chosen portion scale ---------- */
  document.getElementById('applyTemplateQtyChips').addEventListener('click', (e)=>{
    const chip = e.target.closest('.filter-chip');
    if(!chip) return;
    document.getElementById('applyTemplateQtyCustom').value = '';
    setApplyTemplateQty(parseFloat(chip.getAttribute('data-qty')));
  });
  document.getElementById('applyTemplateQtyCustom').addEventListener('input', (e)=>{
    const val = parseFloat(e.target.value);
    if(val>0) setApplyTemplateQty(val);
  });
  document.getElementById('btnConfirmApplyTemplate').addEventListener('click', ()=> confirmApplyTemplate());

  // Scoped to the static Settings accordion only — the food library's
  // accordion headers are rendered dynamically and already bind their own
  // click listener per-element inside renderFoodLibList() (food.js). Binding
  // here too (unscoped) used to double-bind those headers on first load,
  // causing each click to toggle .open on then back off in the same event.
  document.querySelectorAll('#sheetSettings .acc-head').forEach(head=>{
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
    document.getElementById('goalSteps').value = state.goals.steps;
    document.getElementById('aiProxyUrlInput').value = appState.aiProxyUrl || '';
    document.getElementById('aiProxySecretInput').value = appState.aiProxySecret || '';
    renderReminderSettings();
    renderSyncStatus();
    renderThemeButtons();
    renderHealthConnectStatus();
    // Also re-checks steps access: the user could've flipped the Health
    // Connect permission from Android's own system settings since the last
    // time this sheet was open, outside anything this app controls.
    healthConnectRefreshStatus().then(()=>{
      renderHealthConnectStatus();
      renderStepsCard();
      if(appState.healthConnectGranted) refreshSteps();
    });
    const syncItem = document.querySelector('.acc-item[data-acc="sync"]');
    if(syncItem) syncItem.classList.toggle('open', !!getSyncConfig());

    openSheet('sheetSettings');
  });
  // The <input min="0"> attributes on these fields are only a soft UI hint
  // (spinner arrows / on-submit form validation) — nothing here ever calls
  // checkValidity(), so a value like "-500" typed directly still comes
  // through .value as-is. This helper is what actually blocks a negative
  // (or non-numeric) goal from being saved: falls back to the same default
  // 0/NaN already fell back to before, and additionally treats any
  // negative number the same way.
  const readGoalInt = (id, fallback)=>{
    const n = parseInt(document.getElementById(id).value, 10);
    return (Number.isFinite(n) && n > 0) ? n : fallback;
  };
  document.getElementById('btnSaveGoals').addEventListener('click', ()=>{
    state.goals = {
      calories: readGoalInt('goalCal', defaultGoals().calories),
      protein: readGoalInt('goalP', defaultGoals().protein),
      carbs: readGoalInt('goalC', defaultGoals().carbs),
      fat: readGoalInt('goalF', defaultGoals().fat),
      water: readGoalInt('goalWater', defaultGoals().water),
      steps: readGoalInt('goalSteps', defaultGoals().steps),
      // No longer user-editable (fields removed from Settings) — keep
      // whatever was already set so old data/goals reports don't break.
      fiber: state.goals.fiber,
      sodium: state.goals.sodium,
    };
    appState.goals = state.goals;
    persist();
    showToast('تم تحديث الأهداف');
    closeAllSheets();
    renderAll();
  });

  /* ---------- Reminders ---------- */
  document.getElementById('reminderMealToggle').addEventListener('change', ()=> updateReminderFieldStates());
  document.getElementById('reminderWaterToggle').addEventListener('change', ()=> updateReminderFieldStates());
  document.getElementById('btnSaveReminders').addEventListener('click', async ()=>{
    const mealEnabled = document.getElementById('reminderMealToggle').checked;
    const waterEnabled = document.getElementById('reminderWaterToggle').checked;

    if((mealEnabled || waterEnabled) && remindersAvailable()){
      const granted = await hasReminderPermission();
      if(!granted){
        const res = await requestReminderPermission();
        if(!res.ok){
          showToast('لازم توافق على صلاحية الإشعارات عشان تفعّل التذكيرات');
          return;
        }
      }
    }

    appState.reminders = {
      mealEnabled,
      mealTime: document.getElementById('reminderMealTime').value || '20:00',
      waterEnabled,
      waterStart: document.getElementById('reminderWaterStart').value || '09:00',
      waterEnd: document.getElementById('reminderWaterEnd').value || '21:00',
      waterIntervalHours: parseInt(document.getElementById('reminderWaterInterval').value,10) || 2,
    };
    persist();
    applyReminderSettings();
    showToast('تم حفظ التذكيرات 🔔');
  });

  /* ---------- Theme ---------- */
  document.getElementById('themeDarkBtn').addEventListener('click', ()=>{ if(appState.theme!=='dark') toggleTheme(); renderThemeButtons(); });
  document.getElementById('themeLightBtn').addEventListener('click', ()=>{ if(appState.theme!=='light') toggleTheme(); renderThemeButtons(); });
  // role="button" divs (like aiScanModeToggle's .theme-opt buttons) need
  // their own Enter/Space handling — a native <button> gets that for free,
  // a div with just role="button" doesn't.
  document.querySelectorAll('#sheetSettings .theme-toggle .theme-opt').forEach(btn=>{
    btn.addEventListener('keydown', (e)=>{
      if(e.key==='Enter' || e.key===' '){ e.preventDefault(); btn.click(); }
    });
  });

  /* ---------- Water tracker ---------- */
  document.querySelectorAll('[data-water]').forEach(btn=>{
    btn.addEventListener('click', ()=> addWater(parseInt(btn.getAttribute('data-water'),10)));
    btn.addEventListener('keydown', (e)=>{
      if(e.key==='Enter' || e.key===' '){ e.preventDefault(); btn.click(); }
    });
  });
  document.getElementById('btnAddCustomWater').addEventListener('click', ()=>{
    const input = document.getElementById('waterCustomInput');
    const val = parseInt(input.value,10);
    if(!val || val<=0){ showToast('اكتب كمية صحيحة بالمل'); return; }
    addWater(val);
    input.value = '';
  });
  document.getElementById('btnAddCustomWater').addEventListener('keydown', (e)=>{
    if(e.key==='Enter' || e.key===' '){ e.preventDefault(); e.target.click(); }
  });

  // Tapping the compact Home water tile opens the full bar/quick-add sheet
  // — same role="button" + Enter/Space pattern as the steps tile beside it.
  const waterMiniCardEl = document.getElementById('waterMiniCard');
  if(waterMiniCardEl){
    waterMiniCardEl.addEventListener('click', ()=> openWaterDetail());
    waterMiniCardEl.addEventListener('keydown', (e)=>{
      if(e.key==='Enter' || e.key===' '){ e.preventDefault(); openWaterDetail(); }
    });
  }

  /* ---------- Smart goal calculator (opens onboarding flow) ---------- */
  document.getElementById('btnOpenSmartGoals').addEventListener('click', ()=> startOnboarding(true));

  /* ---------- Backup export / import ---------- */
  document.getElementById('btnExportData').addEventListener('click', ()=> exportDataFile());
  document.getElementById('btnImportData').addEventListener('click', ()=> document.getElementById('importFileInput').click());

  // Tapping the Home steps-card's inline "connect" prompt jumps straight to
  // Settings with the Health Connect accordion already open, instead of
  // making the user hunt for it themselves.
  const stepsConnectPromptEl = document.getElementById('stepsConnectPrompt');
  if(stepsConnectPromptEl){
    stepsConnectPromptEl.addEventListener('click', ()=>{
      document.getElementById('btnSettings').click();
      const healthItem = document.querySelector('.acc-item[data-acc="health"]');
      if(healthItem) healthItem.classList.add('open');
    });
  }

  // Tapping the connected steps card opens the full detail sheet (ring +
  // streak + distance/calories + week/month chart) — role="button" so it
  // also needs the Enter/Space keydown handling every other custom
  // "button"-role element in this app gets.
  const stepsCardDataEl = document.getElementById('stepsCardData');
  if(stepsCardDataEl){
    stepsCardDataEl.addEventListener('click', ()=> openStepsDetail());
    stepsCardDataEl.addEventListener('keydown', (e)=>{
      if(e.key==='Enter' || e.key===' '){ e.preventDefault(); openStepsDetail(); }
    });
  }
  const stepsPeriodBarEl = document.getElementById('stepsPeriodBar');
  if(stepsPeriodBarEl){
    stepsPeriodBarEl.addEventListener('click', (e)=>{
      const chip = e.target.closest('.filter-chip');
      if(!chip) return;
      document.querySelectorAll('#stepsPeriodBar .filter-chip').forEach(c=> c.classList.remove('active'));
      chip.classList.add('active');
      stepsDetailPeriod = parseInt(chip.getAttribute('data-period'),10) || 7;
      renderStepsDetail();
    });
  }

  document.getElementById('btnHealthConnectConnect').addEventListener('click', async ()=>{
    const btn = document.getElementById('btnHealthConnectConnect');
    const oldLabel = btn.textContent;
    btn.textContent = 'جارٍ الربط...';
    const res = await healthConnectRequestAccess();
    btn.textContent = oldLabel;
    renderHealthConnectStatus();
    if(res.ok){
      showToast('تم الربط مع Health Connect ✅');
      refreshSteps();
      return;
    }
    const msgs = {
      'not-native': 'هذي الميزة تشتغل بس بالتطبيق المثبّت على جوالك، مو بالمتصفح',
      'not-installed': 'ثبّت تطبيق Health Connect من متجر Play أول',
      'needs-update': 'حدّث تطبيق Health Connect من متجر Play',
      'denied': 'ما وافقت على الصلاحيات — تقدر تجرب مرة ثانية من هنا',
      'error': 'صار خطأ: ' + (res.message||'غير معروف')
    };
    showToast(msgs[res.reason] || 'ما قدرنا نربط الحين، جرب مرة ثانية');
  });
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
    // recipeCat/recipeName/recipeType were never reset anywhere (only
    // recipeName/recipeType got cleared, and only on a successful save) —
    // so closing the builder without saving, or saving once, left the next
    // recipe silently starting from whatever the last one had. This is the
    // "start fresh" moment, same idea as resetNewFoodSheet() for the food form.
    document.getElementById('recipeName').value = '';
    document.getElementById('recipeCat').selectedIndex = 0;
    document.getElementById('recipeType').value = '';
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
   REMINDER SETTINGS
   ============================================================ */
function renderReminderSettings(){
  const r = (appState.reminders) || {};
  document.getElementById('reminderMealToggle').checked = !!r.mealEnabled;
  document.getElementById('reminderMealTime').value = r.mealTime || '20:00';
  document.getElementById('reminderWaterToggle').checked = !!r.waterEnabled;
  document.getElementById('reminderWaterStart').value = r.waterStart || '09:00';
  document.getElementById('reminderWaterEnd').value = r.waterEnd || '21:00';
  document.getElementById('reminderWaterInterval').value = String(r.waterIntervalHours || 2);

  const hint = document.getElementById('reminderNativeHint');
  hint.style.display = remindersAvailable() ? 'none' : 'block';

  updateReminderFieldStates();
}

function updateReminderFieldStates(){
  const mealOn = document.getElementById('reminderMealToggle').checked;
  const waterOn = document.getElementById('reminderWaterToggle').checked;
  document.getElementById('reminderMealTimeField').classList.toggle('disabled', !mealOn);
  document.getElementById('reminderWaterFields').classList.toggle('disabled', !waterOn);
}

/* ============================================================
   THEME BUTTONS
   ============================================================ */
function renderThemeButtons(){
  const darkBtn = document.getElementById('themeDarkBtn');
  const lightBtn = document.getElementById('themeLightBtn');
  darkBtn.classList.toggle('active', appState.theme!=='light');
  lightBtn.classList.toggle('active', appState.theme==='light');
  // Kept in sync with .active — see renderAiScanModeToggle() in ai.js for
  // the same pattern on the other theme-opt toggle in this app (the AI scan
  // mode switch), which already did this correctly.
  darkBtn.setAttribute('aria-pressed', appState.theme!=='light');
  lightBtn.setAttribute('aria-pressed', appState.theme==='light');
}

/* ============================================================
   SHARE CARD (canvas)
   ============================================================ */
// Reuses the report card's helpers (drawReportSectionTitle/drawReportStatBox
// and the REPORT_* colors, defined in progress.js which loads before this
// file) instead of a separate flat/fixed-height design, so both exportable
// images look like one system and this one picked up the same fix for the
// dead blank space a fixed canvas height used to leave below short content.
function drawShareCard(){
  const canvas = document.getElementById('shareCanvas');
  const ctx = canvas.getContext('2d');
  const W = 600, M = 30, CW = W - M*2;

  let totalCal=0, totalProtein=0, mealDays=0, waterDays=0, adherentDays=0;
  for(let i=0;i<=6;i++){
    const key = dateKeyOffset(i);
    const dayLog = appState.logs[key] || {meals:[]};
    const meals = dayLog.meals || [];
    if(meals.length>0){
      mealDays++;
      const dCal = meals.reduce((s,m)=>s+m.calories,0);
      totalCal += dCal;
      totalProtein += meals.reduce((s,m)=>s+m.protein,0);
      if(Math.abs(dCal-state.goals.calories) <= state.goals.calories*0.15) adherentDays++;
    }
    if((dayLog.waterMl||0) > 0) waterDays++;
  }
  const avgCal = mealDays ? Math.round(totalCal/mealDays) : 0;
  const avgProtein = mealDays ? Math.round(totalProtein/mealDays) : 0;
  const adherencePct = mealDays ? Math.round((adherentDays/mealDays)*100) : 0;

  const HEADER_H = 132, TOP_PAD = 28, STAT_BOX_H = 92, GAP_X = 16, GAP_Y = 14, SECTION_GAP = 30, FOOTER_H = 64;
  const gridH = 3*STAT_BOX_H + 2*GAP_Y;
  const totalH = HEADER_H + TOP_PAD + 24 + gridH + SECTION_GAP + FOOTER_H;

  canvas.width = W;
  canvas.height = Math.round(totalH);
  const w = canvas.width, h = canvas.height;
  ctx.direction = 'rtl';

  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0,0,w,h);

  const headGrad = ctx.createLinearGradient(0,0,w,0);
  headGrad.addColorStop(0, REPORT_TEAL_DARK);
  headGrad.addColorStop(1, REPORT_TEAL);
  ctx.fillStyle = headGrad;
  ctx.fillRect(0,0,w,HEADER_H);

  const lx = w/2, ly = 34;
  ctx.fillStyle = 'rgba(255,255,255,.92)';
  [[-18,14,8],[0,20,8],[18,26,8]].forEach(([dx,bh,bw])=>{
    roundRect(ctx, lx+dx-bw/2, ly+26-bh, bw, bh, 3);
    ctx.fill();
  });

  ctx.textAlign = 'center';
  ctx.fillStyle = '#FFFFFF';
  ctx.font = '900 27px Arial';
  ctx.fillText('ملخص الأسبوع', w/2, 92);
  ctx.font = '600 13px Arial';
  ctx.fillStyle = 'rgba(255,255,255,.85)';
  ctx.fillText(`مِقياس · ${formatDateHuman(new Date())}`, w/2, 114);

  let y = HEADER_H + TOP_PAD;
  drawReportSectionTitle(ctx, 'إنجازك هالأسبوع', w-M, y, REPORT_TEAL);
  y += 24;

  const stats = [
    [`${mealDays}/7`, 'أيام سجّلت فيها', REPORT_TEAL, '🗓️'],
    [`${state.streak}`, 'سلسلة الأيام', REPORT_BLUE, '⚡'],
    [avgCal.toLocaleString('en-US'), 'متوسط السعرات', REPORT_PROTEIN, '🔥'],
    [`${avgProtein} غ`, 'متوسط البروتين', REPORT_PROTEIN, '🍗'],
    [`${waterDays}/7`, 'أيام شربت فيها ماء', REPORT_BLUE, '💧'],
    [`${adherencePct}٪`, 'التزام بهدف السعرات', REPORT_FAT, '🎯'],
  ];
  const boxW = (CW-GAP_X)/2;
  stats.forEach((s,i)=>{
    const col = i%2, row = Math.floor(i/2);
    const x = M + col*(boxW+GAP_X);
    const by = y + row*(STAT_BOX_H+GAP_Y);
    drawReportStatBox(ctx, x, by, boxW, STAT_BOX_H, s[0], s[1], s[2], s[3]);
  });
  y += gridH + SECTION_GAP;

  ctx.strokeStyle = REPORT_LINE; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(M,y); ctx.lineTo(w-M,y); ctx.stroke();
  y += 30;
  ctx.textAlign = 'center';
  ctx.fillStyle = REPORT_TEAL;
  ctx.font = '700 13px Arial';
  ctx.fillText('صُنع بتطبيق مِقياس', w/2, y);

  return canvas;
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
    if(weightKg){
      appState.bodyWeights[state.today] = weightKg;
      syncHealthConnectWeight(state.today, weightKg);
    }
    // Height was already being collected here for the calorie calc above —
    // it just wasn't kept afterwards. Persisting it now is what lets the
    // Progress tab's weight card show a BMI gauge without asking again.
    if(heightCm) appState.profile.heightCm = heightCm;
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
