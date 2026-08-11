/* ============================================================
   PROGRESS TAB: personal records, exercise charts, body weight,
   cloud sync settings UI
   ============================================================ */
function renderPRList(){
  const wrap = document.getElementById('prList');
  const withPR = state.library.exercises.filter(ex=>(ex.prWeight||0)>0)
    .sort((a,b)=> (b.prWeight||0)-(a.prWeight||0));
  if(withPR.length===0){ wrap.innerHTML = '<div class="empty-hint">لسا ما سجلت أرقام قياسية. سجل أوزانك بالنادي وبتظهر هنا تلقائياً 🏆</div>'; return; }
  wrap.innerHTML = '';
  withPR.forEach(ex=>{
    const row = document.createElement('div');
    row.className = 'lib-row';
    row.innerHTML = `${exAnimHtml(ex,'sm')}<div class="lm"><div class="n">${escapeHtml(ex.name)}</div><div class="d">أعلى وزن: ${ex.prWeight} كغ × ${ex.prReps||'-'} · حجم أقصى: ${ex.prVolume||0}</div></div>
      <div class="plan-icon-btn" data-detail2="${ex.id}">📈</div>`;
    row.querySelector('[data-detail2]').addEventListener('click', (e)=>{ e.stopPropagation(); openExerciseDetail(ex); });
    wrap.appendChild(row);
  });
}

function getExerciseHistory(exId){
  const points = [];
  Object.keys(appState.logs).sort().forEach(dateKey=>{
    const dayLog = appState.logs[dateKey];
    (dayLog.workouts||[]).forEach(w=>{
      if(w.exerciseId===exId){
        const maxW = Math.max(...w.sets.map(s=>s.weight));
        points.push({date:dateKey, weight:maxW});
      }
    });
  });
  return points;
}

function openExerciseDetail(ex){
  document.getElementById('exDetailTitle').textContent = ex.name;
  const history = getExerciseHistory(ex.id);
  const sessions = history.length;
  const first = history.length ? history[0].weight : 0;
  const latest = history.length ? history[history.length-1].weight : 0;
  const estMax = latest ? calcOneRepMax(latest, ex.prReps||1) : 0;
  const body = document.getElementById('exDetailBody');
  body.innerHTML = `
    <div class="ex-detail-head">${exAnimHtml(ex,'lg')}<div class="tx"><div class="exn" style="font-family:var(--font-d); font-weight:800; font-size:16px;">${escapeHtml(ex.group)}</div><div class="exhint" style="color:var(--text-mute); font-size:12px;">${sessions} جلسة مسجلة</div>${estMax?`<div class="orm-badge">💪 تقدير أقصى وزن (1RM): ${estMax} كغ</div>`:''}</div></div>
    <div class="ex-detail-stats">
      <div class="ex-stat"><div class="sv tabular">${first||'-'}</div><div class="sl">أول وزن</div></div>
      <div class="ex-stat"><div class="sv tabular">${latest||'-'}</div><div class="sl">آخر وزن</div></div>
      <div class="ex-stat"><div class="sv tabular">${ex.prWeight||0}</div><div class="sl">🏆 قياسي</div></div>
    </div>
    <div class="chart-wrap">${buildChartSvg(history)}</div>
  `;
  openSheet('sheetExDetail');
}

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
  const todayM = (appState.bodyMeasurements||{})[state.today] || {};
  document.getElementById('measArm').value = todayM.arm || '';
  document.getElementById('measWaist').value = todayM.waist || '';
  document.getElementById('measChest').value = todayM.chest || '';
  renderBodyWeightSheetBody();
  renderMeasurementCharts();
  openSheet('sheetBodyWeight');
}

function renderBodyWeightSheetBody(){
  const history = getBodyWeightHistory();
  const statsWrap = document.getElementById('bwStatsWrap');
  const chartWrap = document.getElementById('bwChartWrap');
  if(history.length===0){
    statsWrap.innerHTML = '';
    chartWrap.innerHTML = '<div class="empty-hint">سجّل وزنك اليوم عشان يبدأ المنحنى 📈</div>';
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
        resEl.innerHTML = `<div class="sync-badge off" style="width:100%; box-sizing:border-box; color:var(--danger);">❌ فشل: ${escapeHtml(e.code||e.message||'خطأ غير معروف')}</div>`;
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

