/* ============================================================
   AI DISH SCAN — send a photo OR a typed description to a user-hosted
   Cloudflare Worker proxy (holds the Gemini API key server-side; see
   server/ai-proxy-worker.js). مِقياس never talks to Gemini directly and
   the API key never touches this app.

   Two search modes (appState.aiScanMode, toggled in the sheet itself):
   - 'library' (default): matches against the user's own food library
     first; a non-match only returns a short guessed NAME (no macros) —
     the user fills the numbers in manually.
   - 'general': ignores the library and asks the AI to estimate full
     macros for anything, even food the user has never logged before.
     Tapping a result pre-fills the "new food" form with those estimates
     so the user can double-check/adjust before anything is logged,
     instead of trusting an AI guess blindly.
   ============================================================ */

function aiScanConfigured(){
  return !!(appState && appState.aiProxyUrl);
}

// Tracks an in-flight request so a second submit (double-tap, Enter key +
// button click, or picking a new photo while text analysis is still
// pending) cancels the stale one instead of both racing to overwrite
// #aiScanResult — previously whichever response happened to resolve LAST
// silently won, discarding the other (and its API cost) with zero trace.
let aiScanAbortController = null;
// Belt-and-suspenders alongside the AbortController above: if a browser
// ever resolves an aborted fetch's .json() before honoring the abort,
// this sequence check still stops a stale response from rendering.
let aiScanRequestSeq = 0;

function abortInFlightAiScan(){
  if(aiScanAbortController){ aiScanAbortController.abort(); aiScanAbortController = null; }
}

function setAiScanControlsDisabled(disabled){
  ['aiScanTextSubmitBtn','aiScanCameraBtn','aiScanGalleryBtn'].forEach(id=>{
    const el = document.getElementById(id);
    if(el) el.disabled = disabled;
  });
  const textInput = document.getElementById('aiScanTextInput');
  if(textInput) textInput.disabled = disabled;
}

// A scan result set the user hasn't fully worked through yet (still has
// items left after tapping one that navigates away to the manual-entry
// form). Restored on the next AI-sheet open instead of being wiped, so
// scanning a multi-item plate doesn't force a full (paid) re-scan just to
// deal with item 2 after saving item 1. Cleared once empty or once the
// user explicitly taps "تم".
let aiScanPending = null;

function removeFromAiScanPending(item){
  if(!aiScanPending) return;
  const idx = aiScanPending.items.indexOf(item);
  if(idx>-1) aiScanPending.items.splice(idx,1);
  if(!aiScanPending.items.length) aiScanPending = null;
}

function renderAiScanModeToggle(){
  const mode = (appState && appState.aiScanMode) || 'library';
  const libBtn = document.getElementById('aiModeLibraryBtn');
  const genBtn = document.getElementById('aiModeGeneralBtn');
  if(libBtn){ libBtn.classList.toggle('active', mode==='library'); libBtn.setAttribute('aria-pressed', mode==='library'); }
  if(genBtn){ genBtn.classList.toggle('active', mode==='general'); genBtn.setAttribute('aria-pressed', mode==='general'); }

  const explainer = document.getElementById('aiScanModeExplainer');
  if(explainer){
    explainer.textContent = mode==='general'
      ? 'يقدّر لك القيم الغذائية مباشرة، حتى لو الصنف مو بمكتبتك'
      : 'يطابق مع أطباقك المحفوظة أول، وإلا يعطيك تخمين بالاسم بس';
  }
}

function setAiScanMode(mode){
  appState.aiScanMode = (mode==='general') ? 'general' : 'library';
  persist();
  renderAiScanModeToggle();
}

function resetAiScanSheet(){
  abortInFlightAiScan();
  aiScanPending = null;
  setAiScanControlsDisabled(false);

  const preview = document.getElementById('aiScanPreview');
  const result = document.getElementById('aiScanResult');
  const loading = document.getElementById('aiScanLoading');
  const hint = document.getElementById('aiScanHint');
  const configuredWrap = document.getElementById('aiScanConfigured');
  const notConfigured = document.getElementById('aiScanNotConfigured');
  const textInput = document.getElementById('aiScanTextInput');

  if(preview){ preview.style.display='none'; preview.src=''; }
  if(result) result.innerHTML = '';
  if(loading) loading.style.display = 'none';
  if(hint){ hint.style.display = 'block'; hint.textContent = 'صوّر طبقك، اختر صورة، أو اكتب وصف وجبتك.'; }
  if(textInput) textInput.value = '';

  renderAiScanModeToggle();

  const ok = aiScanConfigured();
  if(configuredWrap) configuredWrap.style.display = ok ? 'block' : 'none';
  if(notConfigured) notConfigured.style.display = ok ? 'none' : 'block';
}

// Called instead of resetAiScanSheet() when re-opening the AI sheet while
// aiScanPending still has unhandled items from the previous scan (see the
// comment on aiScanPending above) — re-renders those items instead of
// wiping them.
function restoreAiScanPendingSheet(){
  abortInFlightAiScan();
  setAiScanControlsDisabled(false);

  const preview = document.getElementById('aiScanPreview');
  const loading = document.getElementById('aiScanLoading');
  const hint = document.getElementById('aiScanHint');
  const configuredWrap = document.getElementById('aiScanConfigured');
  const notConfigured = document.getElementById('aiScanNotConfigured');
  const textInput = document.getElementById('aiScanTextInput');

  if(preview){ preview.style.display='none'; preview.src=''; }
  if(loading) loading.style.display = 'none';
  if(hint) hint.style.display = 'none';
  if(textInput) textInput.value = '';

  appState.aiScanMode = aiScanPending.mode;
  persist();
  renderAiScanModeToggle();

  const ok = aiScanConfigured();
  if(configuredWrap) configuredWrap.style.display = ok ? 'block' : 'none';
  if(notConfigured) notConfigured.style.display = ok ? 'none' : 'block';

  renderAiScanResult({ items: aiScanPending.items, mode: aiScanPending.mode });
}

function fileToResizedBase64(file, maxDim, quality){
  return new Promise((resolve, reject)=>{
    if(!file.type || file.type.indexOf('image/')!==0){
      reject(new Error('هذا الملف مو صورة'));
      return;
    }
    const reader = new FileReader();
    reader.onerror = ()=> reject(new Error('تعذّرت قراءة الصورة'));
    reader.onload = ()=>{
      const img = new Image();
      img.onerror = ()=> reject(new Error('تعذّر تحميل الصورة'));
      img.onload = ()=>{
        let w = img.width, h = img.height;
        if(w > maxDim || h > maxDim){
          const scale = maxDim / Math.max(w,h);
          w = Math.round(w*scale); h = Math.round(h*scale);
        }
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        const dataUrl = canvas.toDataURL('image/jpeg', quality);
        resolve(dataUrl);
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

async function callAiProxy(payload){
  const result = document.getElementById('aiScanResult');
  const loading = document.getElementById('aiScanLoading');
  const hint = document.getElementById('aiScanHint');

  // Cancel whatever request is still in flight (double-tap, Enter key
  // racing the button, or a new photo picked mid-analysis) so only THIS
  // request's response ever touches the DOM — see aiScanAbortController.
  abortInFlightAiScan();
  const controller = new AbortController();
  aiScanAbortController = controller;
  const mySeq = ++aiScanRequestSeq;
  setAiScanControlsDisabled(true);

  result.innerHTML = '';
  if(hint) hint.style.display = 'none';
  loading.style.display = 'flex';

  try{
    const candidates = (state.library.foods||[]).map(f=>f.name);
    const res = await fetch(appState.aiProxyUrl, {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({
        ...payload,
        candidates,
        mode: appState.aiScanMode || 'library',
        secret: appState.aiProxySecret || ''
      }),
      signal: controller.signal
    });

    let data;
    try{ data = await res.json(); }catch(e){ data = null; }

    if(!res.ok){
      const msg = (data && data.error) ? data.error : `السيرفر رجّع خطأ (${res.status})`;
      throw new Error(msg);
    }
    if(!data) throw new Error('رد غير متوقع من السيرفر');

    if(mySeq !== aiScanRequestSeq) return; // superseded by a newer request
    renderAiScanResult(data);
  }catch(e){
    if(e && e.name==='AbortError') return; // superseded; the newer request owns the UI now
    if(mySeq !== aiScanRequestSeq) return;
    // A native fetch network failure (offline/DNS/CORS) throws a TypeError
    // whose .message is raw English ("Failed to fetch") — every other
    // error path here already throws a scripted Arabic message, so only
    // this case needs a translated fallback instead of trusting e.message.
    const msg = (e instanceof TypeError) ? 'تعذّر الاتصال بالسيرفر — تحقق من الإنترنت' : (e.message||'خطأ غير معروف');
    result.innerHTML = `<div class="ai-scan-error">تعذّر التحليل: ${escapeHtml(msg)}</div>`;
  }finally{
    if(mySeq === aiScanRequestSeq){
      loading.style.display = 'none';
      setAiScanControlsDisabled(false);
      aiScanAbortController = null;
    }
  }
}

async function handleAiScanFile(file){
  if(!file) return;
  if(!aiScanConfigured()){
    showToast('لازم تضيف رابط سيرفر الذكاء الاصطناعي بالإعدادات أول');
    return;
  }

  const preview = document.getElementById('aiScanPreview');
  const loadingText = document.getElementById('aiScanLoadingText');
  if(loadingText) loadingText.textContent = 'جارٍ تحليل الصورة...';

  try{
    const dataUrl = await fileToResizedBase64(file, 768, 0.7);
    const base64 = dataUrl.split(',')[1];
    preview.src = dataUrl;
    preview.style.display = 'block';
    await callAiProxy({ image: base64, mimeType: 'image/jpeg' });
  }catch(e){
    const result = document.getElementById('aiScanResult');
    result.innerHTML = `<div class="ai-scan-error">تعذّر التحليل: ${escapeHtml(e.message||'خطأ غير معروف')}</div>`;
    document.getElementById('aiScanLoading').style.display = 'none';
  }
}

async function handleAiScanText(text){
  const trimmed = (text||'').trim();
  if(!trimmed){ showToast('اكتب وصف وجبتك أول'); return; }
  if(!aiScanConfigured()){
    showToast('لازم تضيف رابط سيرفر الذكاء الاصطناعي بالإعدادات أول');
    return;
  }
  const loadingText = document.getElementById('aiScanLoadingText');
  if(loadingText) loadingText.textContent = 'جارٍ تحليل الوصف...';
  await callAiProxy({ text: trimmed });
}

function renderAiScanResult(data){
  const result = document.getElementById('aiScanResult');
  result.innerHTML = '';

  const mode = data.mode==='general' ? 'general' : 'library';
  const items = Array.isArray(data.items) ? data.items : [];

  // Remember this result set so tapping into the manual-entry form for one
  // item (below) doesn't lose the rest — see aiScanPending's definition.
  aiScanPending = items.length ? { mode, items: items.slice() } : null;

  if(!items.length){
    result.innerHTML = `<div class="ai-scan-noguess">ما قدرت أميّز أي صنف واضح.</div>
      <button class="btn-secondary" id="aiScanManualBtn" style="margin-top:10px;">سجّل يدوياً</button>`;
    document.getElementById('aiScanManualBtn').addEventListener('click', ()=> openAiScanManualFallback(''));
    return;
  }

  const titleEl = document.createElement('div');
  titleEl.className = 'ai-scan-match-title';
  titleEl.textContent = items.length > 1 ? `لقيت ${items.length} أصناف:` : 'لقيت صنف:';
  result.appendChild(titleEl);

  const listEl = document.createElement('div');
  listEl.id = 'aiScanItemsList';
  result.appendChild(listEl);

  items.forEach(item=>{
    const row = document.createElement('div');
    row.className = 'ai-scan-item-row';

    if(mode==='general'){
      // General mode never auto-logs — it opens the food form pre-filled
      // with the AI's estimate so the user reviews/adjusts before saving,
      // since these numbers aren't backed by the user's own library.
      const name = item.name || 'صنف غير معروف';
      row.innerHTML = `
        <div class="food-chip ai-scan-item-chip" style="width:100%; max-width:none;">
          <div class="plus">${ICON_PENCIL}</div>
          <div class="fname">${escapeHtml(name)}</div>
          <div class="fcal tabular">${item.calories||0} سعرة</div>
        </div>`;
      row.querySelector('.ai-scan-item-chip').addEventListener('click', ()=>{
        removeFromAiScanPending(item);
        openAiScanManualFallback({
          name, calories:item.calories||0, protein:item.protein||0,
          carbs:item.carbs||0, fat:item.fat||0
        });
      });
    } else {
      const food = item.match ? findLibraryFoodByName(item.match) : null;
      if(food){
        row.innerHTML = `
          <div class="food-chip ai-scan-item-chip" style="width:100%; max-width:none;">
            <div class="plus">+</div>
            <div class="fname">${escapeHtml(food.name)}</div>
            <div class="fcal tabular">${food.calories} سعرة</div>
          </div>`;
        const chip = row.querySelector('.ai-scan-item-chip');
        chip.addEventListener('click', async ()=>{
          if(chip.classList.contains('added')) return;
          chip.classList.add('added');
          chip.querySelector('.plus').textContent = '✓';
          await quickAddFood(food, null);
        });
      }else{
        row.innerHTML = `
          <div class="ai-scan-noguess" style="margin-top:0;">
            ${item.guess ? `ما لقيت تطابق بمكتبتك — تخميني إنه "${escapeHtml(item.guess)}". جرّب "بحث عام" فوق عشان أقدّر لك قيمه الغذائية مباشرة.` : 'ما لقيت تطابق واضح لهذا الصنف بمكتبتك'}
          </div>
          <button class="btn-secondary ai-scan-manual-item-btn" style="margin-top:8px;">أضفه يدوياً</button>`;
        row.querySelector('.ai-scan-manual-item-btn').addEventListener('click', ()=>{
          removeFromAiScanPending(item);
          openAiScanManualFallback(item.guess);
        });
      }
    }
    listEl.appendChild(row);
  });

  const doneBtn = document.createElement('button');
  doneBtn.className = 'btn-primary';
  doneBtn.style.marginTop = '14px';
  doneBtn.textContent = 'تم';
  doneBtn.addEventListener('click', ()=>{ aiScanPending = null; closeAllSheets(); });
  result.appendChild(doneBtn);
}

// Exact food-name matching against a fresh Gemini reply is fragile for
// Arabic text (stray diacritics, doubled spaces, NFC/NFKC form
// differences) even though the prompt asks for an exact copy of the
// library name — fall back to a normalized comparison before giving up
// and treating a real match as "no match found".
function normalizeArabicName(s){
  return (s||'').normalize('NFKC').replace(/[\u064B-\u065F\u0670]/g,'').replace(/\s+/g,' ').trim();
}
function findLibraryFoodByName(name){
  const foods = state.library.foods||[];
  let food = foods.find(f=>f.name===name);
  if(!food){
    const norm = normalizeArabicName(name);
    food = foods.find(f=>normalizeArabicName(f.name)===norm);
  }
  return food;
}

// `prefill` is either a plain string (a name-only guess from library mode,
// existing behavior) or an object {name, calories, protein, carbs, fat}
// with a full AI estimate from general mode.
function openAiScanManualFallback(prefill){
  resetNewFoodSheet();
  if(typeof prefill === 'string'){
    if(prefill) document.getElementById('nfName').value = prefill;
  } else if(prefill && typeof prefill === 'object'){
    document.getElementById('nfName').value = prefill.name || '';
    document.getElementById('nfCal').value = prefill.calories || '';
    document.getElementById('nfP').value = prefill.protein || '';
    document.getElementById('nfC').value = prefill.carbs || '';
    document.getElementById('nfF').value = prefill.fat || '';
  }
  openSheet('sheetNewFood');
}
