/* ============================================================
   BARCODE SCAN — packaged-product lookup via Open Food Facts (free, no
   API key: https://world.openfoodfacts.org). Two paths once a barcode is
   read (camera or typed manually):
   - Already in the user's own library (a food that was scanned+saved once
     before, matched by its stored `barcode` field) → logs it immediately,
     same one-tap trust the user already gets for any other library food.
   - Not in the library yet → looks the barcode up on Open Food Facts and
     opens the manual "new food" form pre-filled with its name/macros (per
     100g) for the user to review/adjust before saving — external data
     never gets trusted blindly, same principle as AI-scan's general mode.
     If Open Food Facts has nothing for that barcode either, the form just
     opens empty so the user can still fill it in by hand.

   Scanning itself uses the browser's native BarcodeDetector API (built
   into Chrome/Android WebView — no extra library, no native Kotlin code,
   works identically in the installed app and the plain web PWA on a
   supported browser) — see MDN's Barcode Detection API. Where it isn't
   supported (desktop Safari/Firefox, older WebViews), the sheet just
   skips the camera and leans on the always-available manual-entry input,
   which drives the exact same lookup.
   ============================================================ */

// Attached to the next food saved via sheetNewFood (see btnSaveNewFood in
// app.js) so a product looked up here is remembered for next time —
// cleared by resetNewFoodSheet() so an unrelated "add new food" (or an
// AI-scan general-mode fallback) never accidentally inherits a stale
// barcode from an earlier scan.
let pendingNewFoodBarcode = null;

let barcodeMediaStream = null;
let barcodeDetectorTimer = null;
let barcodeScanHandled = false;

function barcodeDetectionSupported(){
  return typeof window!=='undefined' && 'BarcodeDetector' in window;
}

function openBarcodeScanSheet(){
  pendingNewFoodBarcode = null;
  barcodeScanHandled = false;
  const manualInput = document.getElementById('barcodeManualInput');
  if(manualInput) manualInput.value = '';
  const status = document.getElementById('barcodeScanStatus');
  if(status) status.textContent = barcodeDetectionSupported()
    ? 'وجّه الكاميرا نحو باركود المنتج.'
    : 'المسح بالكاميرا مو مدعوم بهذا المتصفح — اكتب رقم الباركود تحت.';
  openSheet('sheetBarcodeScan');
  if(barcodeDetectionSupported()) startBarcodeCamera();
}

function stopBarcodeCamera(){
  if(barcodeDetectorTimer){ clearInterval(barcodeDetectorTimer); barcodeDetectorTimer = null; }
  if(barcodeMediaStream){
    barcodeMediaStream.getTracks().forEach(t=> t.stop());
    barcodeMediaStream = null;
  }
  const wrap = document.getElementById('barcodeScanCameraWrap');
  if(wrap) wrap.style.display = 'none';
}

async function startBarcodeCamera(){
  const video = document.getElementById('barcodeScanVideo');
  const wrap = document.getElementById('barcodeScanCameraWrap');
  const status = document.getElementById('barcodeScanStatus');
  if(!video || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return;
  try{
    barcodeMediaStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment' }
    });
    video.srcObject = barcodeMediaStream;
    await video.play();
    if(wrap) wrap.style.display = 'block';

    const detector = new window.BarcodeDetector({
      formats: ['ean_13','ean_8','upc_a','upc_e','code_128']
    });
    barcodeDetectorTimer = setInterval(async ()=>{
      if(barcodeScanHandled || video.readyState < 2) return;
      try{
        const codes = await detector.detect(video);
        if(codes && codes.length){
          handleScannedBarcode(codes[0].rawValue);
        }
      }catch(e){ /* a single failed detect() tick just retries next interval */ }
    }, 350);
  }catch(e){
    // No camera / permission denied / not supported at runtime despite the
    // feature check above — the manual-entry input still works either way.
    if(status) status.textContent = 'ما قدرنا نفتح الكاميرا — اكتب رقم الباركود تحت بدالها.';
  }
}

function handleScannedBarcode(code){
  const trimmed = (code||'').trim();
  if(!trimmed || barcodeScanHandled) return;
  barcodeScanHandled = true;
  stopBarcodeCamera();

  const status = document.getElementById('barcodeScanStatus');

  const known = (state.library.foods||[]).find(f=> f.barcode===trimmed);
  if(known){
    quickAddFood(known, null);
    closeAllSheets();
    return;
  }

  if(status) status.textContent = 'جارٍ البحث عن هذا المنتج...';
  lookupOpenFoodFacts(trimmed).then(product=>{
    if(product){
      applyBarcodeProductToNewFoodForm(trimmed, product);
    }else{
      showToast('ما لقيت هذا المنتج بقاعدة Open Food Facts، عبّي بياناته يدوياً');
      openBarcodeManualNewFood(trimmed);
    }
  });
}

// Returns {name, calories, protein, carbs, fat} (per 100g, matching Open
// Food Facts' own convention) or null if the product isn't in their
// database or the request itself fails for any reason (offline, rate
// limit, CORS, malformed response, ...) — every failure path collapses to
// the same "not found" outcome so the caller doesn't need to distinguish
// "doesn't exist" from "couldn't check right now".
async function lookupOpenFoodFacts(barcode){
  try{
    const res = await fetch(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(barcode)}.json`);
    if(!res.ok) return null;
    const data = await res.json();
    if(!data || data.status!==1 || !data.product) return null;
    const p = data.product;
    const n = p.nutriments || {};
    const name = p.product_name || p.product_name_ar || p.generic_name || '';
    if(!name) return null;
    return {
      name,
      calories: Math.round(n['energy-kcal_100g'] ?? n['energy-kcal'] ?? 0),
      protein: Math.round(n['proteins_100g'] ?? 0),
      carbs: Math.round(n['carbohydrates_100g'] ?? 0),
      fat: Math.round(n['fat_100g'] ?? 0)
    };
  }catch(e){ return null; }
}

function applyBarcodeProductToNewFoodForm(barcode, product){
  resetNewFoodSheet();
  pendingNewFoodBarcode = barcode;
  document.getElementById('nfName').value = product.name;
  document.getElementById('nfCal').value = product.calories || '';
  document.getElementById('nfP').value = product.protein || '';
  document.getElementById('nfC').value = product.carbs || '';
  document.getElementById('nfF').value = product.fat || '';
  closeAllSheets();
  openSheet('sheetNewFood');
  showToast('القيم لكل ١٠٠غ من Open Food Facts — عدّلها إذا وزن حصتك مختلف');
}

function openBarcodeManualNewFood(barcode){
  resetNewFoodSheet();
  pendingNewFoodBarcode = barcode;
  closeAllSheets();
  openSheet('sheetNewFood');
}
