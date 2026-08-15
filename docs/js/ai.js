/* ============================================================
   AI DISH SCAN — send a photo to a user-hosted Cloudflare Worker
   proxy (holds the Gemini API key server-side; see
   server/ai-proxy-worker.js) which tries to match it against the
   user's own food library first, and falls back to a short guessed
   name to prefill the "new food" form. مِقياس never talks to Gemini
   directly and the API key never touches this app.
   ============================================================ */

function aiScanConfigured(){
  return !!(appState && appState.aiProxyUrl);
}

function resetAiScanSheet(){
  const preview = document.getElementById('aiScanPreview');
  const result = document.getElementById('aiScanResult');
  const loading = document.getElementById('aiScanLoading');
  const hint = document.getElementById('aiScanHint');
  const configuredWrap = document.getElementById('aiScanConfigured');
  const notConfigured = document.getElementById('aiScanNotConfigured');

  if(preview){ preview.style.display='none'; preview.src=''; }
  if(result) result.innerHTML = '';
  if(loading) loading.style.display = 'none';
  if(hint){ hint.style.display = 'block'; hint.textContent = 'صوّر طبقك أو اختر صورة، وراح أحاول ألقاه بمكتبتك.'; }

  const ok = aiScanConfigured();
  if(configuredWrap) configuredWrap.style.display = ok ? 'block' : 'none';
  if(notConfigured) notConfigured.style.display = ok ? 'none' : 'block';
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

async function handleAiScanFile(file){
  if(!file) return;
  if(!aiScanConfigured()){
    showToast('لازم تضيف رابط سيرفر الذكاء الاصطناعي بالإعدادات أول');
    return;
  }

  const preview = document.getElementById('aiScanPreview');
  const loading = document.getElementById('aiScanLoading');
  const result = document.getElementById('aiScanResult');
  const hint = document.getElementById('aiScanHint');

  result.innerHTML = '';
  if(hint) hint.style.display = 'none';
  loading.style.display = 'flex';

  try{
    const dataUrl = await fileToResizedBase64(file, 768, 0.7);
    const base64 = dataUrl.split(',')[1];
    preview.src = dataUrl;
    preview.style.display = 'block';

    const candidates = (state.library.foods||[]).map(f=>f.name);

    const res = await fetch(appState.aiProxyUrl, {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({
        image: base64,
        mimeType: 'image/jpeg',
        candidates,
        secret: appState.aiProxySecret || ''
      })
    });

    let data;
    try{ data = await res.json(); }catch(e){ data = null; }

    if(!res.ok){
      const msg = (data && data.error) ? data.error : `السيرفر رجّع خطأ (${res.status})`;
      throw new Error(msg);
    }
    if(!data) throw new Error('رد غير متوقع من السيرفر');

    renderAiScanResult(data);
  }catch(e){
    result.innerHTML = `<div class="ai-scan-error">تعذّر التحليل: ${escapeHtml(e.message||'خطأ غير معروف')}</div>`;
  }finally{
    loading.style.display = 'none';
  }
}

function renderAiScanResult(data){
  const result = document.getElementById('aiScanResult');

  if(data.match){
    const food = (state.library.foods||[]).find(f=>f.name===data.match);
    if(food){
      result.innerHTML = `
        <div class="ai-scan-match">
          <div class="ai-scan-match-title">لقيت طبق يطابق:</div>
          <div class="food-chip" id="aiScanMatchChip" style="width:100%; max-width:none;">
            <div class="plus">+</div>
            <div class="fname">${escapeHtml(food.name)}</div>
            <div class="fcal tabular">${food.calories} سعرة</div>
          </div>
          <button class="btn-secondary" id="aiScanNotThis" style="margin-top:10px;">مو هذا، سجّل يدوياً</button>
        </div>`;
      document.getElementById('aiScanMatchChip').addEventListener('click', async ()=>{
        await quickAddFood(food, null);
        closeAllSheets();
      });
      document.getElementById('aiScanNotThis').addEventListener('click', ()=> openAiScanManualFallback(data.guess));
      return;
    }
  }

  result.innerHTML = `
    <div class="ai-scan-noguess">
      ما لقيت تطابق واضح بمكتبتك${data.guess ? ` — تخميني إنه "${escapeHtml(data.guess)}"` : ''}.
    </div>
    <button class="btn-secondary" id="aiScanManualBtn" style="margin-top:10px;">كمّل التسجيل يدوياً</button>`;
  document.getElementById('aiScanManualBtn').addEventListener('click', ()=> openAiScanManualFallback(data.guess));
}

function openAiScanManualFallback(guess){
  resetNewFoodSheet();
  if(guess) document.getElementById('nfName').value = guess;
  openSheet('sheetNewFood');
}
