/* ============================================================
   مِقياس — AI dish-recognition proxy (Cloudflare Worker)
   ============================================================

   WHY THIS FILE EXISTS
   مِقياس is a static PWA (docs/) with no backend of its own. It can't call
   Google's Gemini API directly from the browser/WebView, because that would
   mean shipping the Gemini API key inside the app's JS — anyone could open
   dev tools (or unzip the APK) and steal it. This tiny Worker sits in
   between: the app sends it a photo, the Worker (which is the only place
   that ever sees the real API key) asks Gemini to identify the dish, and
   sends back just a short answer. The key never touches the app.

   WHAT THIS DOES
   1. Receives a POST with { image: base64Jpeg, mimeType, text, candidates: [...],
      mode, secret }. The app sends EITHER an image (photo scan) OR a typed
      text description of the meal — never both — plus a `mode`:
        - mode "library" (default): `candidates` is the user's own food-
          library names — since Waleed's own note was that ~99% of what he
          eats is already in his library, we ask Gemini to match against
          THAT list first, and only fall back to a short generic guess (no
          macros) if nothing matches — the app then opens a blank manual-
          entry form for those.
        - mode "general": ignores the user's library entirely and asks
          Gemini to estimate full macros (calories/protein/carbs/fat) for
          whatever it sees/reads from its own general food knowledge — for
          things that just aren't in the user's library at all (restaurant
          items, one-off foods, etc). The app then opens the manual-entry
          form PRE-FILLED with those estimates so the user can double-check
          numbers before they're logged, rather than trusting an AI guess
          blindly.
   2. Calls Gemini's Interactions API with the image or text description +
      a mode-specific prompt, and returns strict JSON back — shape depends
      on mode (see buildPrompt() below).
   3. Returns that JSON to the app, which lets the user add/confirm each
      item individually (tap each one) instead of only ever getting one
      dish out of a single request.

   UPDATE (Aug 2026): the first version of this file called the older
   "generateContent" endpoint (contents/parts/inline_data). That format
   started 404ing — turns out Google replaced it with a new "Interactions
   API" (POST .../v1beta/interactions, body shape { model, input, ... },
   response has an output_text / steps[] shape instead of candidates[]).
   This version calls the new API. If Google changes the shape again later,
   the error message returned to the app will say so explicitly — see the
   note further down.

   ============================================================
   DEPLOY STEPS (takes ~5 minutes, all free)
   ============================================================
   1. Get a Gemini API key: https://aistudio.google.com/apikey (free tier).
   2. Go to https://dash.cloudflare.com > Workers & Pages > Create >
      "Create Worker". Give it any name (e.g. "miqyas-ai-proxy").
   3. Delete the default starter code in the editor and paste this entire
      file in its place, then click "Deploy".
   4. Open the Worker's Settings > Variables and Secrets, and add:
        - GEMINI_API_KEY   (type: Secret)  = the key from step 1
        - APP_SECRET       (type: Secret)  = any random string you make up
          (this is a lightweight abuse guard — see note below)
        - GEMINI_MODEL     (type: Plain text, optional) = e.g. "gemini-3-flash-preview"
          Only set this if you want to override the DEFAULT_MODEL below. To
          find the current name yourself: open https://aistudio.google.com,
          start a new prompt, pick a "Flash" model from the picker, run it
          once, then click "Get code" — the exact model string Google is
          using right now is right there in the generated snippet.
   5. Copy the Worker's URL (shown at the top of its dashboard page, looks
      like https://miqyas-ai-proxy.YOUR-SUBDOMAIN.workers.dev) and paste it
      into مِقياس's Settings > الذكاء الاصطناعي > "رابط سيرفر الذكاء
      الاصطناعي". Paste the same APP_SECRET value into the "كلمة سر
      التطبيق" field there too.

   ⚠️ A NOTE ON THE MODEL NAME AND API SHAPE
   Google has changed both the model name AND the request/response format
   of this API at least once already during this project (see the "UPDATE"
   note above) — so treat both as things that can go stale, not just the
   version number. DEFAULT_MODEL below is whatever was confirmed working
   last (via Google AI Studio's own "Get code" output), not something I can
   independently verify. If the Worker ever errors with "model not found" /
   404, or the response shape looks different from what extractInteractionText()
   expects below, that's not a real bug in مِقياس — it means Google moved
   the goalposts again. Fix for a stale model name: see the GEMINI_MODEL
   note two paragraphs up. Fix for a changed response shape: open
   https://aistudio.google.com, run a prompt, click "Get code", pick the
   REST/curl option if available (or read the JS/Python snippet), and send
   me what the request/response looks like now — I'll update
   extractInteractionText() and the request body below to match.

   ⚠️ A NOTE ON SECURITY
   The Worker's URL itself is not truly secret — it's called from
   client-side JS, so it's visible to anyone who inspects مِقياس's network
   traffic or decompiles the APK. The APP_SECRET check below raises the bar
   (a casual scraper won't have it) but a determined person could still
   extract it from the app and hit your Worker directly, burning your
   Gemini quota. For a personal/hobby app this is a reasonable trade-off;
   just know it's not bulletproof. Cloudflare's free tier and Gemini's free
   tier both have their own rate limits as a backstop.
   ============================================================ */

const DEFAULT_MODEL = 'gemini-3-flash-preview';

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders() });
    }
    if (request.method !== 'POST') {
      return json({ error: 'POST only' }, 405);
    }
    if (!env.GEMINI_API_KEY) {
      return json({ error: 'GEMINI_API_KEY غير مضبوط بإعدادات الـ Worker' }, 500);
    }

    let body;
    try {
      body = await request.json();
      // A body of the literal JSON value `null` (or any other non-object,
      // e.g. a bare number/string/array) parses successfully, so the
      // try/catch above never fires for it — but `body.secret` below would
      // then throw on a null/primitive, escaping this handler entirely and
      // returning Cloudflare's generic error page (no CORS headers, no
      // Arabic message) instead of a clean json() response.
      if (!body || typeof body !== 'object') {
        return json({ error: 'طلب غير صالح (JSON)' }, 400);
      }
    } catch (e) {
      return json({ error: 'طلب غير صالح (JSON)' }, 400);
    }

    // Lightweight abuse guard — see the security note above.
    if (env.APP_SECRET && body.secret !== env.APP_SECRET) {
      return json({ error: 'غير مصرّح — تأكد من رمز الأمان بإعدادات التطبيق' }, 401);
    }

    const { image, mimeType, text, candidates, mode } = body || {};
    const searchMode = mode === 'general' ? 'general' : 'library';
    const textDescription = typeof text === 'string' ? text.trim().slice(0, 500) : '';
    const hasImage = !!(image && typeof image === 'string');
    if (!hasImage && !textDescription) {
      return json({ error: 'لازم صورة أو وصف نصي' }, 400);
    }

    const candidateList = Array.isArray(candidates)
      ? candidates.filter(n => typeof n === 'string' && n.trim()).slice(0, 300)
      : [];

    // Google's SDK examples sometimes show the model name prefixed with
    // "models/" (an internal resource-name convention) and sometimes bare —
    // the REST curl examples use it bare. Strip a leading "models/" defensively
    // so either form works regardless of where the value came from.
    const model = (env.GEMINI_MODEL || DEFAULT_MODEL).replace(/^models\//, '');
    const url = 'https://generativelanguage.googleapis.com/v1beta/interactions';

    const input = [
      { type: 'text', text: buildPrompt(searchMode, candidateList, hasImage, textDescription) }
    ];
    if (hasImage) {
      input.push({ type: 'image', data: image, mime_type: mimeType || 'image/jpeg' });
    }

    const geminiBody = {
      model,
      input,
      generation_config: {
        temperature: 0.2,
        // gemini-3-flash-preview is a "thinking" model — by default it can
        // spend real time reasoning before answering, which is overkill for
        // "which of these ~50 names does this photo match" and is almost
        // certainly why this feels slow. Pinning thinking_level to the
        // lowest tier trades a bit of accuracy on ambiguous photos for a
        // much faster reply on the common case (a clear photo of a known dish).
        thinking_level: 'minimal',
        // Was 800 — too tight for a full multi-item reply (the multi-item
        // prompt below explicitly asks for up to ~12 separate items, each
        // needing 4 numeric fields + a name + confidence in general mode),
        // risking the JSON being cut off mid-object on exactly the photos
        // this feature is meant to handle best. 2048 gives real headroom
        // while staying far below what would meaningfully slow the reply.
        max_output_tokens: 2048
      }
    };

    let geminiRes;
    try {
      geminiRes = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
        body: JSON.stringify(geminiBody)
      });
    } catch (e) {
      return json({ error: 'تعذّر الوصول لـ Gemini API: ' + e.message }, 502);
    }

    if (!geminiRes.ok) {
      const errText = await geminiRes.text().catch(() => '');
      return json({ error: `Gemini API رجّع خطأ ${geminiRes.status}`, detail: errText.slice(0, 500) }, 502);
    }

    let data;
    try {
      data = await geminiRes.json();
    } catch (e) {
      return json({ error: 'رد غير متوقع من Gemini API' }, 502);
    }

    const rawText = extractInteractionText(data);
    if (!rawText) {
      return json({ error: 'تعذّر إيجاد نص الرد داخل استجابة Gemini (شكل الرد تغيّر؟)', raw: JSON.stringify(data).slice(0, 500) }, 502);
    }

    const parsed = parseLooseJson(rawText);
    if (!parsed || typeof parsed !== 'object') {
      return json({ error: 'تعذّر فهم رد الذكاء الاصطناعي كـ JSON', raw: rawText.slice(0, 300) }, 502);
    }

    // Normally the model returns {"items": [...]}. If it ever ignores that
    // and returns a single item object directly (older prompt shape, or
    // just model drift), treat that as a one-item list instead of failing
    // outright. The shape of an "item" itself differs by mode — see below.
    const isBareItem = searchMode === 'general'
      ? (parsed.name !== undefined || parsed.calories !== undefined)
      : (parsed.match !== undefined || parsed.guess !== undefined);
    const rawItems = Array.isArray(parsed.items) ? parsed.items : (isBareItem ? [parsed] : []);

    // Clamped to a generous-but-sane per-item ceiling — a hallucinated or
    // malformed reply (e.g. a stray extra digit) would otherwise flow
    // straight through into the pre-filled "new food" form and, if the
    // user doesn't notice before saving, get written permanently into
    // their food library with no check anywhere else in the pipeline.
    const toNum = (v, max) => {
      const n = Number(v);
      if (!Number.isFinite(n)) return 0;
      return Math.min(Math.max(Math.round(n), 0), max);
    };

    const items = searchMode === 'general'
      ? rawItems.slice(0, 12).map(it => ({
          name: it && typeof it.name === 'string' ? it.name.trim() : '',
          calories: it ? toNum(it.calories, 5000) : 0,
          protein: it ? toNum(it.protein, 500) : 0,
          carbs: it ? toNum(it.carbs, 500) : 0,
          fat: it ? toNum(it.fat, 500) : 0,
          confidence: it && ['high', 'medium', 'low'].includes(it.confidence) ? it.confidence : 'low'
        }))
      : rawItems.slice(0, 12).map(it => ({
          match: it && typeof it.match === 'string' && it.match.trim() ? it.match.trim() : null,
          guess: it && typeof it.guess === 'string' ? it.guess.trim() : '',
          confidence: it && ['high', 'medium', 'low'].includes(it.confidence) ? it.confidence : 'low'
        }));

    return json({ items, mode: searchMode });
  }
};

// The Interactions API's response has output_text as a convenience field
// added by Google's own SDKs, per their docs — it may or may not be present
// on a raw REST response, so fall back to walking steps[] → content[] for
// the actual model_output text if output_text is missing.
function extractInteractionText(data) {
  if (!data) return '';
  if (typeof data.output_text === 'string' && data.output_text.trim()) {
    return data.output_text;
  }
  if (Array.isArray(data.steps)) {
    let combined = '';
    for (const step of data.steps) {
      const content = step && step.content;
      if (!Array.isArray(content)) continue;
      for (const part of content) {
        if (part && part.type === 'text' && typeof part.text === 'string') {
          combined += part.text;
        }
      }
    }
    if (combined.trim()) return combined;
  }
  return '';
}

// The model is asked for pure JSON but may still wrap it in ```json fences
// or add stray whitespace/text around it — this recovers the JSON either way.
function parseLooseJson(text) {
  const direct = tryParse(text);
  if (direct) return direct;

  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    const fromFence = tryParse(fenced[1]);
    if (fromFence) return fromFence;
  }

  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    const slice = tryParse(text.slice(firstBrace, lastBrace + 1));
    if (slice) return slice;
  }

  return null;
}

function tryParse(s) {
  try {
    const v = JSON.parse(s);
    return (v && typeof v === 'object') ? v : null;
  } catch (e) {
    return null;
  }
}

function buildPrompt(mode, candidateList, hasImage, textDescription) {
  const inputInstruction = hasImage
    ? 'حلّل الصورة المرفقة للطبق/الوجبة.'
    : `المستخدم وصف وجبته بالنص التالي (ما فيه صورة مرفقة، اعتمد على النص وحده):\n"${textDescription}"`;

  const multiItemNote = 'مهم: قد تحتوي الوجبة أكثر من صنف طعام منفصل (مثلاً أرز + لحم + سلطة كأصناف منفصلة، أو أكثر من طبق واحد). حدد كل صنف طعام منفصل واضح تقدر تميزه كعنصر مستقل — لا تدمجهم بعنصر وحيد إلا إذا كانوا فعلاً طبق واحد مركّب معروف بهذا الاسم.';

  if (mode === 'general') {
    return `أنت مساعد تغذية لتطبيق تتبع أكل عربي اسمه "مِقياس".
${inputInstruction}

${multiItemNote}

لكل عنصر تحدده، قدّر أفضل تقدير ممكن للقيم الغذائية بناءً على معرفتك العامة بالأطعمة — بغض النظر عن أي مكتبة أطعمة خاصة بالمستخدم، هذا بحث عام:
- "name": اسم الصنف بالعربي (مختصر وواضح)
- "calories": تقدير السعرات الحرارية (رقم فقط)
- "protein": تقدير البروتين بالغرام (رقم فقط)
- "carbs": تقدير الكاربوهيدرات بالغرام (رقم فقط)
- "fat": تقدير الدهون بالغرام (رقم فقط)
- "confidence": "high" أو "medium" أو "low" حسب مدى ثقتك بالتقدير

رجّع فقط JSON صالح بهذا الشكل بالضبط، بدون أي نص أو شرح إضافي قبله أو بعده (إذا فيه صنف واحد بس، رجّع مصفوفة فيها عنصر وحيد):
{"items": [{"name": "...", "calories": 0, "protein": 0, "carbs": 0, "fat": 0, "confidence": "high"}]}`;
  }

  const listBlock = candidateList.length
    ? `قائمة أسماء أطباق سبق للمستخدم تسجيلها بتطبيقه (طابق كل صنف معها أولاً قبل أي شي ثاني):\n${candidateList.map(n => `- ${n}`).join('\n')}`
    : 'ما فيه قائمة أطباق معروفة متاحة حالياً.';

  return `أنت مساعد يتعرف على أصناف الطعام، لتطبيق تتبع تغذية عربي اسمه "مِقياس".
${inputInstruction}
${listBlock}

${multiItemNote}

لكل عنصر تحدده، طبّق هذي القواعد:
1. إذا كان يطابق (أو قريب جداً من) أحد الأسماء بالقائمة أعلاه، رجّع نفس الاسم بالضبط كما هو مكتوب بالقائمة بحقل "match".
2. إذا ما فيه تطابق واضح بالقائمة، خلّي "match" يساوي null، وارجع بحقل "guess" وصف قصير (كلمتين إلى ثلاث كلمات) بالعربي لاسم الصنف المحتمل.
3. حدد "confidence" كـ "high" أو "medium" أو "low" حسب مدى ثقتك بالتحديد.

رجّع فقط JSON صالح بهذا الشكل بالضبط، بدون أي نص أو شرح إضافي قبله أو بعده (إذا فيه صنف واحد بس، رجّع مصفوفة فيها عنصر وحيد):
{"items": [{"match": "اسم من القائمة أو null", "guess": "وصف قصير بالعربي", "confidence": "high"}]}`;
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() }
  });
}
