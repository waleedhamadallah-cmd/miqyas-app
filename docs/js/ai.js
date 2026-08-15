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
  result.innerHTML = '';

  // The server always returns {items:[...]} — one entry per distinct food
  // item it spotted in the photo (a plate can be rice + meat + salad, three
  // separate items, not one). Each renders as its own row so the user can
  // tap to add each one individually, instead of only ever getting one dish
  // out of a photo that clearly has several.
  const items = Array.isArray(data.items) ? data.items : [];

  if(!items.length){
    result.innerHTML = `<div class="ai-scan-noguess">ما قدرت أميّز أي صنف واضح بالصورة.</div>
      <button class="btn-secondary" id="aiScanManualBtn" style="margin-top:10px;">سجّل يدوياً</button>`;
    document.getElementById('aiScanManualBtn').addEventListener('click', ()=> openAiScanManualFallback(''));
    return;
  }

  const titleEl = document.createElement('div');
  titleEl.className = 'ai-scan-match-title';
  titleEl.textContent = items.length > 1 ? `لقيت ${items.length} أصناف بالصورة:` : 'لقيت صنف يطابق:';
  result.appendChild(titleEl);

  const listEl = document.createElement('div');
  listEl.id = 'aiScanItemsList';
  result.appendChild(listEl);

  items.forEach(item=>{
    const food = item.match ? (state.library.foods||[]).find(f=>f.name===item.match) : null;
    const row = document.createElement('div');
    row.className = 'ai-scan-item-row';

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
          ${item.guess ? `ما لقيت تطابق — تخميني إنه "${escapeHtml(item.guess)}"` : 'ما لقيت تطابق واضح لهذا الصنف'}
        </div>
        <button class="btn-secondary ai-scan-manual-item-btn" style="margin-top:8px;">أضفه يدوياً</button>`;
      row.querySelector('.ai-scan-manual-item-btn').addEventListener('click', ()=> openAiScanManualFallback(item.guess));
    }
    listEl.appendChild(row);
  });

  const doneBtn = document.createElement('button');
  doneBtn.className = 'btn-primary';
  doneBtn.style.marginTop = '14px';
  doneBtn.textContent = 'تم';
  doneBtn.addEventListener('click', ()=> closeAllSheets());
  result.appendChild(doneBtn);
}

function openAiScanManualFallback(guess){
  resetNewFoodSheet();
  if(guess) document.getElementById('nfName').value = guess;
  openSheet('sheetNewFood');
}
