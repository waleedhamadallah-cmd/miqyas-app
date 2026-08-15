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

// WHO adult BMI bands — same 0/18.5/25/30/40 scale most health apps use.
// Color reuses مِقياس's existing macro palette (blue/teal/orange/red)
// instead of inventing new colors, so it reads consistently with the rest
// of the app's charts.
const BMI_BANDS = [
  {max:18.5, label:'نقص وزن', color:'var(--shoulder)', text:'var(--shoulder-text)', soft:'var(--shoulder-soft)'},
  {max:25,   label:'وزن طبيعي', color:'var(--carb)',     text:'var(--carb-text)',     soft:'var(--carb-soft)'},
  {max:30,   label:'زيادة وزن', color:'var(--fat)',      text:'var(--fat-text)',      soft:'var(--fat-soft)'},
  {max:Infinity, label:'سمنة',  color:'var(--danger)',   text:'var(--danger-text)',   soft:'var(--danger-soft)'}
];
function calcBmi(weightKg, heightCm){
  const h = heightCm/100;
  return weightKg / (h*h);
}
function bmiBand(bmi){ return BMI_BANDS.find(b=> bmi < b.max) || BMI_BANDS[BMI_BANDS.length-1]; }

// Segmented 0→40 gauge with a marker at the current BMI. Kept left-to-right
// (direction:ltr in CSS) even in this RTL app — same convention already
// used for the line charts, so numeric scales read in the universal
// low-to-high direction instead of being mirrored.
function buildBmiGauge(bmi){
  const SCALE_MAX = 40;
  const bounds = [0, 18.5, 25, 30, SCALE_MAX];
  const segs = BMI_BANDS.map((b,i)=>{
    const from = bounds[i], to = Math.min(bounds[i+1], SCALE_MAX);
    return `<div class="bmi-seg" style="width:${((to-from)/SCALE_MAX*100).toFixed(2)}%; background:${b.color};"></div>`;
  }).join('');
  const markerPct = Math.min(Math.max(bmi,0), SCALE_MAX) / SCALE_MAX * 100;
  return `<div class="bmi-gauge">
    <div class="bmi-track">${segs}<div class="bmi-marker" style="left:${markerPct.toFixed(2)}%;"></div></div>
    <div class="bmi-ticks"><span>0</span><span>18.5</span><span>25</span><span>30</span><span>40</span></div>
  </div>`;
}

function renderWeightCard(){
  const wrap = document.getElementById('weightCard');
  wrap.onclick = openBodyWeightSheet;
  const history = getBodyWeightHistory();
  if(history.length===0){
    wrap.innerHTML = `<div class="wc-empty">
      <div class="wc-icon">⚖️</div>
      <div class="wc-tx"><div class="w1">وزن الجسم</div><div class="w2">ما سجلت وزنك بعد — اضغط للبدء</div></div>
    </div>`;
    return;
  }
  const latest = history[history.length-1];
  const first = history[0];
  let trendHtml = '<span class="wc-trend">أول تسجيل لك</span>';
  if(history.length>1){
    const diff = Math.round((latest.weight-first.weight)*10)/10;
    if(diff===0) trendHtml = '<span class="wc-trend">ثابت من أول تسجيل</span>';
    else trendHtml = `<span class="wc-trend">${diff>0?'▲':'▼'} ${Math.abs(diff)} كغ من أول تسجيل</span>`;
  }

  const chartHtml = history.length>1
    ? `<div class="chart-wrap wc-chart">${buildChartSvg(history)}</div>`
    : '';

  let bmiHtml = '';
  const heightCm = appState.profile && appState.profile.heightCm;
  if(heightCm){
    const bmi = Math.round(calcBmi(latest.weight, heightCm)*10)/10;
    const band = bmiBand(bmi);
    bmiHtml = `<div class="bmi-block">
      <div class="bmi-head">
        <span class="bmi-badge" style="background:${band.soft}; color:${band.text};">${band.label}</span>
        <span class="bmi-val tabular">مؤشر كتلة الجسم <b>${bmi}</b></span>
      </div>
      ${buildBmiGauge(bmi)}
    </div>`;
  } else {
    bmiHtml = `<div class="bmi-block bmi-prompt">أضف طولك عشان نحسب مؤشر كتلة جسمك (BMI) — اضغط هنا</div>`;
  }

  let targetHtml = '';
  const target = appState.profile && appState.profile.targetWeightKg;
  if(target){
    const total = Math.abs(target - first.weight) || 1;
    const done = Math.min(Math.max(Math.abs(latest.weight - first.weight) / total, 0), 1);
    targetHtml = `<div class="wc-target">
      <div class="wc-target-row"><span>البداية <b class="tabular">${first.weight}كغ</b></span><span>الهدف <b class="tabular">${target}كغ</b></span></div>
      <div class="wc-target-track"><div class="wc-target-fill" style="width:${(done*100).toFixed(1)}%;"></div></div>
    </div>`;
  }

  wrap.innerHTML = `
    <div class="wc-top">
      <div class="wc-tx"><div class="w1">الوزن الحالي</div>${trendHtml}</div>
      <div class="wc-num tabular">${latest.weight}<span>كغ</span></div>
    </div>
    ${chartHtml}
    ${targetHtml}
    ${bmiHtml}
  `;
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
  document.getElementById('bwHeight').value = appState.profile.heightCm || '';
  document.getElementById('bwTarget').value = appState.profile.targetWeightKg || '';
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

// Simple word-wrap for canvas text — split into a pure "measure" step and a
// "draw" step so the final image height can be computed up front (see
// drawReportCanvas) instead of leaving a big blank area below the content.
function computeWrappedLines(ctx, text, maxWidth){
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
  return lines;
}
function drawWrappedLines(ctx, lines, cx, y, lineHeight){
  lines.forEach((l,i)=> ctx.fillText(l, cx, y + i*lineHeight));
}

const REPORT_INK = '#1A1D21';
const REPORT_MUTED = '#63686F';
const REPORT_TEAL = '#0E8F77';
const REPORT_TEAL_DARK = '#0A6B58';
const REPORT_LINE = '#E4E0D6';
const REPORT_PROTEIN = '#FF6B4A';
const REPORT_CARB = '#2FD3A6';
const REPORT_FAT = '#F2B84B';
const REPORT_BLUE = '#5B9DFF';

function drawReportSectionTitle(ctx, title, x, y, color){
  ctx.textAlign = 'right';
  ctx.fillStyle = REPORT_INK;
  ctx.font = '800 20px Arial';
  ctx.fillText(title, x, y);
  const tw = Math.min(ctx.measureText(title).width, 60);
  ctx.fillStyle = color || REPORT_TEAL;
  roundRect(ctx, x-tw, y+9, tw, 4, 2);
  ctx.fill();
}

function drawReportStatBox(ctx, x, y, w, h, value, label, color, icon){
  ctx.save();
  ctx.shadowColor = 'rgba(30,26,18,.10)';
  ctx.shadowBlur = 10;
  ctx.shadowOffsetY = 3;
  ctx.fillStyle = '#FFFFFF';
  roundRect(ctx, x, y, w, h, 16);
  ctx.fill();
  ctx.restore();

  ctx.fillStyle = color;
  roundRect(ctx, x+16, y, w-32, 3.5, 2);
  ctx.fill();

  ctx.textAlign = 'center';
  if(icon){
    ctx.font = '16px Arial';
    ctx.fillText(icon, x+w/2, y+27);
  }
  ctx.fillStyle = color;
  ctx.font = '900 23px Arial';
  // Force LTR just for the value: it's a number (possibly signed, e.g.
  // "-1.3"), and drawing it inside an RTL text run can flip the minus
  // sign to the wrong side ("1.3-") — this keeps signed values readable.
  ctx.direction = 'ltr';
  ctx.fillText(String(value), x+w/2, y + (icon ? h/2+9 : h/2-1));
  ctx.direction = 'rtl';
  ctx.fillStyle = REPORT_MUTED;
  ctx.font = '600 12px Arial';
  ctx.fillText(label, x+w/2, y+h-14);
}

function drawReportDonut(ctx, cx, cy, rOuter, rInner, segments, centerValue, centerLabel){
  let start = -Math.PI/2;
  const ringR = (rOuter+rInner)/2;
  ctx.lineCap = 'butt';
  segments.forEach(seg=>{
    const frac = Math.max(seg.pct,0)/100;
    if(frac<=0) return;
    const end = start + frac*Math.PI*2;
    ctx.beginPath();
    ctx.arc(cx, cy, ringR, start, end);
    ctx.lineWidth = rOuter-rInner;
    ctx.strokeStyle = seg.color;
    ctx.stroke();
    start = end;
  });
  ctx.textAlign = 'center';
  ctx.fillStyle = REPORT_INK;
  ctx.font = '900 22px Arial';
  ctx.fillText(String(centerValue), cx, cy+2);
  ctx.fillStyle = REPORT_MUTED;
  ctx.font = '600 11px Arial';
  ctx.fillText(centerLabel, cx, cy+19);
}

function drawReportTrendChart(ctx, x, y, w, h, weightPoints, calPoints){
  const pad = 8;
  const weightVals = weightPoints.map(p=>p.value).filter(v=>v!=null);
  const calVals = calPoints.map(p=>p.value).filter(v=>v!=null);

  // Short periods (e.g. "آخر 7 أيام") can bucket down to a single week —
  // not enough points for a line. Rather than silently render an empty
  // chart with dangling gridlines, say so explicitly.
  if(weightVals.length<2 && calVals.length<2){
    ctx.textAlign = 'center';
    ctx.fillStyle = REPORT_MUTED;
    ctx.font = '600 13px Arial';
    ctx.fillText('لسا ما فيه بيانات كافية لعرض اتجاه هذه الفترة', x+w/2, y+h/2);
    return;
  }

  // gridlines + weight axis labels (min / mid / max) so the chart reads as
  // an actual chart instead of a bare line floating on white space.
  if(weightVals.length>=2){
    const min = Math.min(...weightVals), max = Math.max(...weightVals);
    ctx.strokeStyle = REPORT_LINE; ctx.lineWidth = 1; ctx.setLineDash([4,4]);
    ctx.textAlign = 'left'; ctx.fillStyle = REPORT_MUTED; ctx.font = '600 11px Arial';
    [0, 0.5, 1].forEach(t=>{
      const gy = y+pad+(h-pad*2)*t;
      ctx.beginPath(); ctx.moveTo(x, gy); ctx.lineTo(x+w, gy); ctx.stroke();
      const val = max - (max-min)*t;
      ctx.fillText(val.toFixed(1), x, gy-4);
    });
    ctx.setLineDash([]);
  }

  function drawSeries(points, color, dashed, fill){
    const vals = points.map(p=>p.value).filter(v=>v!=null);
    if(vals.length<2) return null;
    const min = Math.min(...vals), max = Math.max(...vals);
    const range = (max-min) || 1;
    const n = points.length;
    const stepX = n>1 ? (w-pad*2)/(n-1) : 0;
    const coords = [];
    ctx.beginPath();
    ctx.strokeStyle = color; ctx.lineWidth = 3; ctx.lineCap='round'; ctx.lineJoin='round';
    ctx.setLineDash(dashed ? [8,6] : []);
    let started = false;
    points.forEach((p,i)=>{
      const px = x+pad+i*stepX;
      if(p.value==null){ started=false; return; }
      const py = y+h-pad-((p.value-min)/range)*(h-pad*2);
      coords.push([px,py]);
      if(!started){ ctx.moveTo(px,py); started=true; } else { ctx.lineTo(px,py); }
    });
    ctx.stroke();
    ctx.setLineDash([]);

    if(fill && coords.length>1){
      const grad = ctx.createLinearGradient(0,y,0,y+h);
      grad.addColorStop(0, color+'33');
      grad.addColorStop(1, color+'00');
      ctx.beginPath();
      ctx.moveTo(coords[0][0], y+h-pad);
      coords.forEach(c=> ctx.lineTo(c[0], c[1]));
      ctx.lineTo(coords[coords.length-1][0], y+h-pad);
      ctx.closePath();
      ctx.fillStyle = grad;
      ctx.fill();
    }

    const last = coords[coords.length-1];
    if(last){
      ctx.beginPath();
      ctx.arc(last[0], last[1], 4.5, 0, Math.PI*2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.strokeStyle = '#FFFFFF'; ctx.lineWidth = 2; ctx.stroke();
    }
    return coords;
  }
  drawSeries(calPoints, REPORT_PROTEIN, true, false);
  drawSeries(weightPoints, REPORT_BLUE, false, true);
}

// Renders the full report onto #reportCanvas. Runs a lightweight first pass
// to measure the disclaimer's wrapped line count (the only variable-height
// element), sizes the canvas to fit the *actual* content, then draws once —
// this is what removes the large blank strip that used to sit under a
// fixed 1160px canvas regardless of how much content there was.
function drawReportCanvas(days){
  const canvas = document.getElementById('reportCanvas');
  const ctx = canvas.getContext('2d');
  const W = 700, M = 32, CW = W - M*2;
  const data = getReportData(days);
  const periodLabel = days<=7 ? 'آخر 7 أيام' : (days<=30 ? 'آخر 30 يوم' : 'آخر 90 يوم');

  ctx.direction = 'rtl';
  ctx.font = '500 12px Arial';
  const disclaimer = 'التقرير مبني على بيانات مسجَّلة ذاتياً بتطبيق مِقياس وما يغني عن تقييم مختص التغذية أو الطبيب.';
  const disclaimerLines = computeWrappedLines(ctx, disclaimer, CW);

  const HEADER_H = 140;
  const TOP_PAD = 30;
  const STAT_BOX_H = 92, STAT_GAP_X = 16, STAT_GAP_Y = 14;
  const statRows = 3;
  const statGridH = statRows*STAT_BOX_H + (statRows-1)*STAT_GAP_Y;
  const SECTION_GAP = 34;
  const DONUT_H = 190;
  const WEIGHT_BOX_H = 92;
  const MICRO_BOX_H = 78;
  const CHART_LEGEND_H = 26;
  const CHART_H = 190;
  const FOOTER_H = 34 + disclaimerLines.length*19 + 24;

  const totalH = HEADER_H
    + TOP_PAD + 24 + statGridH + SECTION_GAP
    + 24 + DONUT_H + SECTION_GAP
    + 24 + WEIGHT_BOX_H + SECTION_GAP
    + 24 + MICRO_BOX_H + SECTION_GAP
    + 24 + CHART_LEGEND_H + CHART_H + SECTION_GAP
    + FOOTER_H;

  canvas.width = W;
  canvas.height = Math.round(totalH);
  const w = canvas.width, h = canvas.height;
  ctx.direction = 'rtl';

  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0,0,w,h);

  // ---- header ----
  const headGrad = ctx.createLinearGradient(0,0,w,0);
  headGrad.addColorStop(0, REPORT_TEAL_DARK);
  headGrad.addColorStop(1, REPORT_TEAL);
  ctx.fillStyle = headGrad;
  ctx.fillRect(0,0,w,HEADER_H);

  // small logo mark: three bars of rising height, echoing "مقياس" (a scale/measure)
  const lx = w/2, ly = 34;
  ctx.fillStyle = 'rgba(255,255,255,.92)';
  [[-18,14,8],[0,20,8],[18,26,8]].forEach(([dx,bh,bw])=>{
    roundRect(ctx, lx+dx-bw/2, ly+26-bh, bw, bh, 3);
    ctx.fill();
  });

  ctx.textAlign = 'center';
  ctx.fillStyle = '#FFFFFF';
  ctx.font = '900 27px Arial';
  ctx.fillText('تقرير التغذية', w/2, 92);
  ctx.font = '600 13px Arial';
  ctx.fillStyle = 'rgba(255,255,255,.85)';
  ctx.fillText(`مِقياس · ${periodLabel} · أُنشئ بتاريخ ${formatDateHuman(new Date())}`, w/2, 114);

  let y = HEADER_H + TOP_PAD;

  // ---- summary grid ----
  drawReportSectionTitle(ctx, 'ملخص الفترة', w-M, y, REPORT_TEAL);
  y += 24;
  const statLabels = [
    [`${data.loggedDays}/${data.days}`, 'أيام مسجَّلة', REPORT_TEAL, '🗓️'],
    [`${data.adherencePct}٪`, 'التزام بهدف السعرات', REPORT_FAT, '🎯'],
    [data.avgCal.toLocaleString('en-US'), 'متوسط السعرات', REPORT_PROTEIN, '🔥'],
    [`${data.avgP} غ`, 'متوسط البروتين', REPORT_PROTEIN, '🍗'],
    [`${data.avgC} غ`, 'متوسط الكارب', REPORT_CARB, '🍞'],
    [`${data.avgF} غ`, 'متوسط الدهون', REPORT_FAT, '🥑'],
  ];
  const boxW = (CW-STAT_GAP_X)/2;
  statLabels.forEach((s,i)=>{
    const col = i%2, row = Math.floor(i/2);
    const x = M + col*(boxW+STAT_GAP_X);
    const by = y + row*(STAT_BOX_H+STAT_GAP_Y);
    drawReportStatBox(ctx, x, by, boxW, STAT_BOX_H, s[0], s[1], s[2], s[3]);
  });
  y += statGridH + SECTION_GAP;

  // ---- macro distribution donut ----
  drawReportSectionTitle(ctx, 'توزيع الماكروز', w-M, y, REPORT_CARB);
  y += 24;
  const pCal = data.avgP*4, cCal = data.avgC*4, fCal = data.avgF*9;
  const macroTotal = (pCal+cCal+fCal) || 1;
  const macroSegs = [
    {label:'بروتين', grams:data.avgP, pct: Math.round(pCal/macroTotal*100), color: REPORT_PROTEIN},
    {label:'كارب',   grams:data.avgC, pct: Math.round(cCal/macroTotal*100), color: REPORT_CARB},
    {label:'دهون',   grams:data.avgF, pct: Math.round(fCal/macroTotal*100), color: REPORT_FAT},
  ];
  const donutCx = w/2, donutCy = y+70;
  drawReportDonut(ctx, donutCx, donutCy, 68, 42, macroSegs, data.avgCal.toLocaleString('en-US'), 'سعرة/يوم');
  const legendY = y+70+68+30;
  const chipW = CW/3;
  ctx.font = '700 13px Arial';
  macroSegs.forEach((s,i)=>{
    const cx = M + chipW*i + chipW/2;
    ctx.beginPath(); ctx.arc(cx+ (ctx.measureText(`${s.label} ${s.pct}٪`).width/2)+9, legendY, 5, 0, Math.PI*2);
    ctx.fillStyle = s.color; ctx.fill();
    ctx.textAlign = 'center';
    ctx.fillStyle = REPORT_INK;
    ctx.fillText(`${s.label} ${s.pct}٪`, cx, legendY+4);
    ctx.fillStyle = REPORT_MUTED;
    ctx.font = '500 11px Arial';
    ctx.fillText(`${s.grams} غ`, cx, legendY+20);
    ctx.font = '700 13px Arial';
  });
  y += DONUT_H + SECTION_GAP;

  // ---- weight ----
  drawReportSectionTitle(ctx, 'الوزن', w-M, y, REPORT_BLUE);
  y += 24;
  let changeVal = '—', changeColor = REPORT_MUTED, changeIcon = '➖';
  if(data.firstWeight!=null && data.lastWeight!=null){
    const d = Math.round((data.lastWeight-data.firstWeight)*10)/10;
    changeVal = (d>0?'+':'') + d;
    if(d<0){ changeColor = REPORT_CARB; changeIcon = '📉'; }
    else if(d>0){ changeColor = REPORT_FAT; changeIcon = '📈'; }
    else { changeIcon = '➖'; }
  }
  const wStats = [
    [data.firstWeight!=null ? data.firstWeight : '—', 'أول وزن مسجَّل', REPORT_BLUE, '⚖️'],
    [data.lastWeight!=null ? data.lastWeight : '—', 'آخر وزن مسجَّل', REPORT_BLUE, '⚖️'],
    [changeVal, 'التغيّر (كغ)', changeColor, changeIcon],
  ];
  const wBoxW = (CW-STAT_GAP_X*2)/3;
  wStats.forEach((s,i)=>{
    const x = M + i*(wBoxW+STAT_GAP_X);
    drawReportStatBox(ctx, x, y, wBoxW, WEIGHT_BOX_H, s[0], s[1], s[2], s[3]);
  });
  y += WEIGHT_BOX_H + SECTION_GAP;

  // ---- micro-nutrients ----
  drawReportSectionTitle(ctx, 'عناصر إضافية', w-M, y, REPORT_FAT);
  y += 24;
  const microW = (CW-STAT_GAP_X)/2;
  drawReportStatBox(ctx, M, y, microW, MICRO_BOX_H, `${data.avgFiber} غ`, 'متوسط الألياف اليومي', REPORT_CARB, '🌾');
  drawReportStatBox(ctx, M+microW+STAT_GAP_X, y, microW, MICRO_BOX_H, `${data.avgSodium.toLocaleString('en-US')} ملغ`, 'متوسط الصوديوم اليومي', REPORT_FAT, '🧂');
  y += MICRO_BOX_H + SECTION_GAP;

  // ---- trend chart ----
  drawReportSectionTitle(ctx, 'الاتجاه الأسبوعي: الوزن مقابل السعرات', w-M, y, REPORT_TEAL);
  y += 24;
  ctx.font = '700 12px Arial';
  ctx.textAlign = 'right';
  ctx.fillStyle = REPORT_BLUE;
  ctx.beginPath(); ctx.arc(w-M-4, y-4, 4.5, 0, Math.PI*2); ctx.fill();
  ctx.fillText('الوزن', w-M-14, y);
  ctx.fillStyle = REPORT_PROTEIN;
  ctx.beginPath(); ctx.arc(w-M-100, y-4, 4.5, 0, Math.PI*2); ctx.fill();
  ctx.fillText('متوسط السعرات', w-M-110, y);
  y += CHART_LEGEND_H;
  drawReportTrendChart(ctx, M, y, CW, CHART_H, data.weightPoints, data.calPoints);
  y += CHART_H + SECTION_GAP;

  // ---- footer ----
  ctx.strokeStyle = REPORT_LINE; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(M,y); ctx.lineTo(w-M,y); ctx.stroke();
  y += 26;
  ctx.textAlign = 'right';
  ctx.fillStyle = REPORT_MUTED;
  ctx.font = '500 12px Arial';
  drawWrappedLines(ctx, disclaimerLines, w-M, y, 19);
  y += disclaimerLines.length*19 + 18;
  ctx.textAlign = 'center';
  ctx.fillStyle = REPORT_TEAL;
  ctx.font = '700 12px Arial';
  ctx.fillText('صُنع بتطبيق مِقياس', w/2, y);

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
