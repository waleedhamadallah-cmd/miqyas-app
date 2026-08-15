/* ============================================================
   PROGRESS TAB: body weight, measurements, monthly insight,
   cloud sync settings UI
   ============================================================ */

/* ============================================================
   BODY WEIGHT TRACKING
   ============================================================ */

function getBodyWeightHistory(){
  return Object.keys(appState.bodyWeights).sort().map(date=>({date, weight: appState.bodyWeights[date]}));
}

function renderWeightCard(){
  const wrap = document.getElementById('weightCard');
  wrap.onclick = openBodyWeightSheet;
  const history = getBodyWeightHistory();
  if(history.length===0){
    wrap.innerHTML = `<div class="wc-icon">⚖️</div>
      <div class="wc-tx"><div class="w1">وزن الجسم</div><div class="w2">ما سجلت وزنك بعد — اضغط للبدء</div></div>`;
    return;
  }
  const latest = history[history.length-1];
  let trendTxt = 'أول تسجيل لك';
  if(history.length>1){
    const first = history[0];
    const diff = Math.round((latest.weight-first.weight)*10)/10;
    if(diff===0) trendTxt = 'ثابت من أول تسجيل';
    else trendTxt = `${diff>0?'▲':'▼'} ${Math.abs(diff)} كغ من أول تسجيل`;
  }
  wrap.innerHTML = `<div class="wc-icon">⚖️</div>
    <div class="wc-tx"><div class="w1">وزن الجسم</div><div class="w2">${trendTxt}</div></div>
    <div class="wc-num tabular">${latest.weight}<span>كغ</span></div>`;
}

function openBodyWeightSheet(){
  const todayW = appState.bodyWeights[state.today];
  document.getElementById('bwInput').value = todayW || '';
  const todayBF = (appState.bodyFat||{})[state.today];
  document.getElementById('bfInput').value = todayBF || '';
  const todayM = (appState.bodyMeasurements||{})[state.today] || {};
  document.getElementById('measArm').value = todayM.arm || '';
  document.getElementById('measWaist').value = todayM.waist || '';
  document.getElementById('measChest').value = todayM.chest || '';
  renderBodyWeightSheetBody();
  renderMeasurementCharts();
  renderBodyFatChart();
  openSheet('sheetBodyWeight');
}

function getBodyFatHistory(){
  if(!appState.bodyFat) return [];
  return Object.keys(appState.bodyFat).sort().map(date=>({date, weight: appState.bodyFat[date]}));
}
function renderBodyFatChart(){
  const wrap = document.getElementById('bfChartWrap');
  if(!wrap) return;
  const history = getBodyFatHistory();
  if(history.length===0){ wrap.innerHTML = ''; return; }
  const latest = history[history.length-1].weight;
  wrap.innerHTML = `<div class="section-title" style="margin-top:14px;">نسبة الدهون — آخر قياس: ${latest}٪</div><div class="chart-wrap">${buildChartSvg(history)}</div>`;
}

function renderBodyWeightSheetBody(){
  const history = getBodyWeightHistory();
  const statsWrap = document.getElementById('bwStatsWrap');
  const chartWrap = document.getElementById('bwChartWrap');
  if(history.length===0){
    statsWrap.innerHTML = '';
    chartWrap.innerHTML = emptyStateHtml('chart', 'سجّل وزنك اليوم عشان يبدأ المنحنى');
    return;
  }
  const weights = history.map(h=>h.weight);
  const first = history[0].weight;
  const latest = history[history.length-1].weight;
  const min = Math.min(...weights);
  const max = Math.max(...weights);
  statsWrap.innerHTML = `<div class="ex-detail-stats">
    <div class="ex-stat"><div class="sv tabular">${first}</div><div class="sl">أول وزن</div></div>
    <div class="ex-stat"><div class="sv tabular">${latest}</div><div class="sl">آخر وزن</div></div>
    <div class="ex-stat"><div class="sv tabular">${min} - ${max}</div><div class="sl">أقل - أعلى</div></div>
  </div>`;
  chartWrap.innerHTML = buildChartSvg(history);
}

/* ============================================================
   WEIGHT vs. CALORIES TREND (weekly-bucketed, last N weeks)
   ============================================================ */

// Buckets the last `numWeeks` weeks (week 0 = the 7 days ending today) into
// {value|null} points for weight (avg of logged weigh-ins that week) and
// calories (avg of logged days that week) — oldest week first, so the two
// series line up index-for-index for buildDualChartSvg().
function getWeeklyTrendBuckets(numWeeks){
  const weightPoints = [], calPoints = [];
  for(let w=numWeeks-1; w>=0; w--){
    let calSum=0, calDays=0, weightSum=0, weightCount=0;
    for(let d=0; d<7; d++){
      const key = dateKeyOffset(w*7+d);
      const dayLog = appState.logs[key];
      if(dayLog && dayLog.meals && dayLog.meals.length>0){
        calSum += dayLog.meals.reduce((s,m)=>s+m.calories,0);
        calDays++;
      }
      const wt = appState.bodyWeights[key];
      if(wt!=null){ weightSum += wt; weightCount++; }
    }
    weightPoints.push({value: weightCount ? Math.round((weightSum/weightCount)*10)/10 : null});
    calPoints.push({value: calDays ? Math.round(calSum/calDays) : null});
  }
  return {weightPoints, calPoints};
}

function renderWeightCalorieTrend(){
  const wrap = document.getElementById('weightCalTrendCard');
  if(!wrap) return;
  const {weightPoints, calPoints} = getWeeklyTrendBuckets(8);
  const validWeights = weightPoints.filter(p=>p.value!=null);
  const validCals = calPoints.filter(p=>p.value!=null);
  if(validWeights.length<2 || validCals.length<2){
    wrap.innerHTML = emptyStateHtml('chart', 'سجّل وزنك وأكلك بانتظام لأسبوعين على الأقل عشان تشوف هنا هل نزولك أو ثباتك بالوزن يتماشى مع سعراتك');
    return;
  }
  const chart = buildDualChartSvg(weightPoints, calPoints, {colorA:'var(--shoulder)', colorB:'var(--protein)', labelA:'الوزن', labelB:'متوسط السعرات'});
  const firstW = validWeights[0].value, lastW = validWeights[validWeights.length-1].value;
  const firstC = validCals[0].value, lastC = validCals[validCals.length-1].value;
  const wDiff = Math.round((lastW-firstW)*10)/10;
  wrap.innerHTML = `<div class="chart-wrap">${chart}</div>
    <div class="empty-hint" style="padding-top:8px;">الوزن: ${firstW} ← ${lastW} كغ (${wDiff>=0?'+':''}${wDiff}) · متوسط السعرات: ${firstC.toLocaleString('en-US')} ← ${lastC.toLocaleString('en-US')}</div>`;
}

/* ============================================================
   BODY MEASUREMENTS (arm / waist / chest)
   ============================================================ */
const MEASUREMENT_KEYS = {arm:'الذراع', waist:'الخصر', chest:'الصدر'};

function getMeasurementHistory(key){
  const m = appState.bodyMeasurements || {};
  return Object.keys(m).sort().filter(date=> m[date][key]!==undefined).map(date=>({date, weight:m[date][key]}));
}
function saveMeasurements(){
  const arm = parseFloat(document.getElementById('measArm').value);
  const waist = parseFloat(document.getElementById('measWaist').value);
  const chest = parseFloat(document.getElementById('measChest').value);
  if(!appState.bodyMeasurements) appState.bodyMeasurements = {};
  const entry = appState.bodyMeasurements[state.today] || {};
  if(!isNaN(arm)) entry.arm = arm;
  if(!isNaN(waist)) entry.waist = waist;
  if(!isNaN(chest)) entry.chest = chest;
  if(Object.keys(entry).length===0){ showToast('عبّي قياس وحد على الأقل'); return; }
  appState.bodyMeasurements[state.today] = entry;
  persist();
  showToast('تم حفظ القياسات 📏');
  renderMeasurementCharts();
}
function renderMeasurementCharts(){
  const wrap = document.getElementById('measChartsWrap');
  if(!wrap) return;
  const parts = Object.keys(MEASUREMENT_KEYS).map(key=>{
    const history = getMeasurementHistory(key);
    if(history.length===0) return '';
    const latest = history[history.length-1].weight;
    return `<div class="section-title" style="margin-top:14px;">${MEASUREMENT_KEYS[key]} — آخر قياس: ${latest} سم</div><div class="chart-wrap">${buildChartSvg(history)}</div>`;
  }).join('');
  wrap.innerHTML = parts;
}

/* ============================================================
   NUTRITION REPORT (exportable image — for a doctor / dietitian)
   ============================================================ */

function getReportData(days){
  const keys = [];
  for(let i=days-1;i>=0;i--) keys.push(dateKeyOffset(i));
  let loggedDays=0, cal=0, p=0, c=0, f=0, fiber=0, sodium=0, adherent=0;
  keys.forEach(key=>{
    const dayLog = appState.logs[key];
    const meals = (dayLog && dayLog.meals) || [];
    if(meals.length>0){
      loggedDays++;
      const dCal = meals.reduce((s,m)=>s+m.calories,0);
      cal += dCal;
      p += meals.reduce((s,m)=>s+m.protein,0);
      c += meals.reduce((s,m)=>s+m.carbs,0);
      f += meals.reduce((s,m)=>s+m.fat,0);
      fiber += meals.reduce((s,m)=>s+(m.fiber||0),0);
      sodium += meals.reduce((s,m)=>s+(m.sodium||0),0);
      if(Math.abs(dCal-state.goals.calories) <= state.goals.calories*0.15) adherent++;
    }
  });
  const weightEntries = keys.map(k=>appState.bodyWeights[k]).filter(v=>v!=null);
  const {weightPoints, calPoints} = getWeeklyTrendBuckets(Math.ceil(days/7));
  return {
    days, loggedDays,
    avgCal: loggedDays ? Math.round(cal/loggedDays) : 0,
    avgP: loggedDays ? Math.round(p/loggedDays) : 0,
    avgC: loggedDays ? Math.round(c/loggedDays) : 0,
    avgF: loggedDays ? Math.round(f/loggedDays) : 0,
    avgFiber: loggedDays ? Math.round(fiber/loggedDays) : 0,
    avgSodium: loggedDays ? Math.round(sodium/loggedDays) : 0,
    adherencePct: loggedDays ? Math.round((adherent/loggedDays)*100) : 0,
    firstWeight: weightEntries.length ? weightEntries[0] : null,
    lastWeight: weightEntries.length ? weightEntries[weightEntries.length-1] : null,
    weightCount: weightEntries.length,
    weightPoints, calPoints,
  };
}

// Simple word-wrap for canvas text (Arabic shapes correctly per fillText
// call regardless of split points, since we only break on natural spaces).
function wrapCanvasText(ctx, text, cx, y, maxWidth, lineHeight){
  const words = text.split(' ');
  let line = '';
  const lines = [];
  words.forEach(word=>{
    const test = line ? line + ' ' + word : word;
    if(ctx.measureText(test).width > maxWidth && line){
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  });
  if(line) lines.push(line);
  lines.forEach((l,i)=> ctx.fillText(l, cx, y + i*lineHeight));
  return lines.length;
}

function drawReportStatBox(ctx, x, y, w, h, value, label, color){
  ctx.fillStyle = '#F5F3EE';
  roundRect(ctx, x, y, w, h, 14); ctx.fill();
  ctx.textAlign = 'center';
  ctx.fillStyle = color;
  ctx.font = '900 26px Arial';
  ctx.fillText(String(value), x+w/2, y+h/2-2);
  ctx.fillStyle = '#63686F';
  ctx.font = '600 12px Arial';
  ctx.fillText(label, x+w/2, y+h/2+20);
}

function drawReportTrendChart(ctx, x, y, w, h, weightPoints, calPoints){
  const pad = 10;
  function drawSeries(points, color, dashed){
    const vals = points.map(p=>p.value).filter(v=>v!=null);
    if(vals.length<2) return;
    const min = Math.min(...vals), max = Math.max(...vals);
    const range = (max-min) || 1;
    const n = points.length;
    const stepX = n>1 ? (w-pad*2)/(n-1) : 0;
    ctx.beginPath();
    ctx.strokeStyle = color; ctx.lineWidth = 3; ctx.lineCap='round'; ctx.lineJoin='round';
    ctx.setLineDash(dashed ? [9,7] : []);
    let started = false;
    points.forEach((p,i)=>{
      const px = x+pad+i*stepX;
      if(p.value==null){ started=false; return; }
      const py = y+h-pad-((p.value-min)/range)*(h-pad*2);
      if(!started){ ctx.moveTo(px,py); started=true; } else { ctx.lineTo(px,py); }
    });
    ctx.stroke();
    ctx.setLineDash([]);
  }
  drawSeries(weightPoints, '#5B9DFF', false);
  drawSeries(calPoints, '#FF6B4A', true);
}

function drawReportCanvas(days){
  const canvas = document.getElementById('reportCanvas');
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  const data = getReportData(days);

  ctx.direction = 'rtl';
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0,0,w,h);

  // header band
  ctx.fillStyle = '#F5F3EE';
  ctx.fillRect(0,0,w,110);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#1A1D21';
  ctx.font = '900 30px Arial';
  ctx.fillText('تقرير التغذية', w/2, 52);
  ctx.font = '700 15px Arial';
  ctx.fillStyle = '#0E8F77';
  ctx.fillText('مِقياس', w/2, 78);
  ctx.font = '500 13px Arial';
  ctx.fillStyle = '#63686F';
  const periodLabel = days<=7 ? 'آخر 7 أيام' : (days<=30 ? 'آخر 30 يوم' : 'آخر 90 يوم');
  ctx.fillText(`${periodLabel} · أُنشئ بتاريخ ${formatDateHuman(new Date())}`, w/2, 98);

  let y = 145;
  ctx.textAlign = 'right';
  ctx.fillStyle = '#1A1D21';
  ctx.font = '800 20px Arial';
  ctx.fillText('ملخص الفترة', w-30, y);
  y += 25;

  const statLabels = [
    [`${data.loggedDays}/${data.days}`, 'أيام مسجَّلة', '#0E8F77'],
    [`${data.adherencePct}٪`, 'التزام بهدف السعرات', '#F2B84B'],
    [data.avgCal.toLocaleString('en-US'), 'متوسط السعرات', '#FF6B4A'],
    [`${data.avgP} غ`, 'متوسط البروتين', '#FF6B4A'],
    [`${data.avgC} غ`, 'متوسط الكارب', '#2FD3A6'],
    [`${data.avgF} غ`, 'متوسط الدهون', '#F2B84B'],
    [`${data.avgFiber} غ`, 'متوسط الألياف', '#5B9DFF'],
    [`${data.avgSodium.toLocaleString('en-US')} مغ`, 'متوسط الصوديوم', '#5B9DFF'],
  ];
  const boxW = (w-30-30-16)/2, boxH = 78, gapX = 16, gapY = 14;
  statLabels.forEach((s,i)=>{
    const col = i%2, row = Math.floor(i/2);
    const x = 30 + col*(boxW+gapX);
    const by = y + row*(boxH+gapY);
    drawReportStatBox(ctx, x, by, boxW, boxH, s[0], s[1], s[2]);
  });
  y += Math.ceil(statLabels.length/2)*(boxH+gapY) + 20;

  ctx.textAlign = 'right';
  ctx.fillStyle = '#1A1D21';
  ctx.font = '800 20px Arial';
  ctx.fillText('الوزن', w-30, y);
  y += 25;
  const wStats = [
    [data.firstWeight!=null ? data.firstWeight : '—', 'أول وزن مسجَّل'],
    [data.lastWeight!=null ? data.lastWeight : '—', 'آخر وزن مسجَّل'],
    [data.firstWeight!=null && data.lastWeight!=null ? (()=>{const d=Math.round((data.lastWeight-data.firstWeight)*10)/10; return (d>=0?'+':'')+d;})() : '—', 'التغيّر (كغ)'],
  ];
  const wBoxW = (w-30-30-16*2)/3;
  wStats.forEach((s,i)=>{
    const x = 30 + i*(wBoxW+16);
    drawReportStatBox(ctx, x, y, wBoxW, boxH, s[0], s[1], '#5B9DFF');
  });
  y += boxH + 34;

  ctx.textAlign = 'right';
  ctx.fillStyle = '#1A1D21';
  ctx.font = '800 20px Arial';
  ctx.fillText('الاتجاه الأسبوعي: الوزن مقابل السعرات', w-30, y);
  y += 20;
  drawReportTrendChart(ctx, 30, y, w-60, 200, data.weightPoints, data.calPoints);
  y += 200 + 26;

  ctx.textAlign = 'right';
  ctx.font = '600 13px Arial';
  ctx.fillStyle = '#5B9DFF';
  ctx.fillText('⎯ الوزن', w-30, y);
  ctx.fillStyle = '#FF6B4A';
  ctx.fillText('- - متوسط السعرات', w-140, y);
  y += 40;

  ctx.strokeStyle = '#E2DED4'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(30,y); ctx.lineTo(w-30,y); ctx.stroke();
  y += 26;

  ctx.textAlign = 'right';
  ctx.fillStyle = '#63686F';
  ctx.font = '500 12px Arial';
  const disclaimer = 'التقرير مبني على بيانات مسجَّلة ذاتياً بتطبيق مِقياس وما يغني عن تقييم مختص التغذية أو الطبيب.';
  wrapCanvasText(ctx, disclaimer, w-30, y, w-60, 19);

  return canvas;
}

let reportPeriod = 30;
function renderReportPreview(days){
  reportPeriod = days;
  drawReportCanvas(days);
}

function renderSyncStatus(){
  const cfg = getSyncConfig();
  const box = document.getElementById('syncStatusBox');
  if(cfg && cloudDoc){
    box.innerHTML = `
      <div class="sync-badge"><span class="sync-dot"></span>متصل — بياناتك تتزامن تلقائياً</div>
      <div class="entry-row" style="margin-bottom:12px;">
        <div class="entry-main"><div class="t1">رمز المزامنة</div><div class="t2 tabular" style="direction:ltr; text-align:right;">${escapeHtml(cfg.syncCode)}</div></div>
      </div>
      <div class="empty-hint" style="padding:0 0 10px; text-align:right;">لازم يكون عندك نفس الرمز <b>ونفس كود Firebase بالحرف</b> بالجهازين. تأكد ما فيه مسافة زايدة أول أو آخر الرمز.</div>
      <div id="syncTestResult"></div>
      <button class="btn-secondary" id="btnTestSync" style="margin-top:0;">🔄 مزامنة الآن واختبار الاتصال</button>
      <button class="btn-secondary" id="btnDisableSync">فصل المزامنة عن هذا الجهاز</button>
    `;
    document.getElementById('btnDisableSync').addEventListener('click', ()=>{
      clearSyncConfig();
      if(cloudUnsub){ cloudUnsub(); cloudUnsub=null; }
      cloudDoc = null;
      showToast('تم فصل المزامنة، بياناتك محفوظة محلياً بس الحين');
      renderSyncStatus();
    });
    document.getElementById('btnTestSync').addEventListener('click', async ()=>{
      const resEl = document.getElementById('syncTestResult');
      resEl.innerHTML = '<div class="empty-hint" style="padding:8px 0;">جاري الاختبار...</div>';
      try{
        const snap = await cloudDoc.get();
        if(snap.exists){
          const cloudState = snap.data();
          const cloudDate = cloudState.updatedAt ? new Date(cloudState.updatedAt).toLocaleString('ar') : 'غير معروف';
          if((cloudState.updatedAt||0) > (appState.updatedAt||0)){
            appState = cloudState; saveLocalOnly(); rebindFromAppState(); computeStreak(); renderAll();
          } else if((appState.updatedAt||0) > (cloudState.updatedAt||0)){
            await cloudDoc.set(appState);
          }
          resEl.innerHTML = `<div class="sync-badge" style="width:100%; box-sizing:border-box;">✅ الاتصال شغال. آخر تحديث بالسحابة: ${cloudDate}</div>`;
        } else {
          await cloudDoc.set(appState);
          resEl.innerHTML = `<div class="sync-badge" style="width:100%; box-sizing:border-box;">✅ الاتصال شغال، وأول نسخة اترفعت الحين</div>`;
        }
      }catch(e){
        console.error(e);
        resEl.innerHTML = `<div class="sync-badge off" style="width:100%; box-sizing:border-box; color:var(--danger-text);">❌ فشل: ${escapeHtml(e.code||e.message||'خطأ غير معروف')}</div>`;
      }
    });
  } else {
    box.innerHTML = `
      <div class="sync-badge off"><span class="sync-dot"></span>غير متصل — بياناتك على هذا الجهاز بس</div>
      <div class="empty-hint" style="padding:0 0 12px; text-align:right; line-height:2;">
        فعّل المزامنة عشان نفس بياناتك تطلع بجوالك وكمبيوترك. تحتاج حساب Firebase مجاني (٥ دقايق أول مرة بس):<br>
        ١. افتح <a href="https://console.firebase.google.com" target="_blank" style="color:var(--accent-2);">console.firebase.google.com</a> وسوّي مشروع جديد (مجاني)<br>
        ٢. من القائمة الجانبية: Build ← Firestore Database ← Create database ← اختر Start in test mode<br>
        ٣. من إعدادات المشروع ⚙️ ← General ← اضغط أيقونة الويب (&lt;/&gt;) لتسجيل تطبيق ويب<br>
        ٤. انسخ كود firebaseConfig كامل (يبدأ بـ { ) والصقه بالمربع تحت<br>
        ٥. <b>مهم:</b> من Firestore Database ← تبويب Rules، استبدل المحتوى بهذا واضغط Publish:
      </div>
      <div class="chart-wrap" style="direction:ltr; text-align:left; font-family:monospace; font-size:11.5px; padding:12px; margin-bottom:12px; white-space:pre-wrap;">rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /miqyas_sync/{docId} {
      allow read, write: if true;
    }
  }
}</div>
      <div class="form-field"><label>رمز مزامنة سري (اختاره بنفسك، ونفس الرمز بالجهاز الثاني بالحرف)</label><input type="text" id="syncCode" placeholder="مثال: sara-gym-2026" style="direction:ltr; text-align:left;"></div>
      <div class="form-field"><label>إعدادات Firebase</label><textarea id="syncConfig" rows="6" placeholder='{"apiKey":"...","projectId":"...","..."}'></textarea></div>
      <div id="syncTestResult"></div>
      <button class="btn-primary" id="btnEnableSync">تفعيل المزامنة</button>
    `;
    document.getElementById('btnEnableSync').addEventListener('click', onEnableSyncClick);
  }
}

function renderHealthConnectStatus(){
  const box = document.getElementById('healthConnectStatusBox');
  if(!box) return;
  const connected = !!(appState && appState.healthConnectGranted);
  box.innerHTML = connected
    ? '<div class="sync-badge"><span class="sync-dot"></span>متصل — وجباتك وماءك يترسلون لـ Health Connect</div>'
    : '<div class="sync-badge off"><span class="sync-dot"></span>غير متصل</div>';
}

async function onEnableSyncClick(){
  const code = (document.getElementById('syncCode').value||'').trim();
  const raw = (document.getElementById('syncConfig').value||'').trim();
  const resEl = document.getElementById('syncTestResult');
  resEl.innerHTML = '';
  if(!code){ showToast('اختر رمز مزامنة أول'); return; }
  const parsed = parseFirebaseConfigInput(raw);
  if(!parsed || !parsed.apiKey || !parsed.projectId){ showToast('تأكد إنك نسخت كود Firebase كامل وصحيح'); return; }

  setSyncConfig({firebaseConfig:parsed, syncCode:code});
  showToast('جاري الاتصال...');
  const ok = await connectCloud({firebaseConfig:parsed, syncCode:code});
  if(!ok){ showToast('فشل الاتصال، تأكد من الكود والإنترنت'); clearSyncConfig(); return; }

  try{
    const snap = await cloudDoc.get();
    if(snap.exists){
      const cloudState = snap.data();
      if((cloudState.updatedAt||0) >= (appState.updatedAt||0)){
        appState = cloudState;
        saveLocalOnly();
        rebindFromAppState();
      } else {
        await cloudDoc.set(appState);
      }
    } else {
      await cloudDoc.set(appState);
    }
    subscribeCloud();
    showToast('تمت المزامنة بنجاح 🎉');
    closeAllSheets();
    computeStreak();
    renderAll();
  }catch(e){
    console.error(e);
    showToast('صار خطأ: ' + (e.code || e.message || 'غير معروف') + ' — راجع صلاحيات Firestore (Rules)');
    if(resEl) resEl.innerHTML = `<div class="sync-badge off" style="width:100%; box-sizing:border-box; color:var(--danger);">❌ ${escapeHtml(e.code||e.message||'خطأ غير معروف')}</div>`;
  }
}

