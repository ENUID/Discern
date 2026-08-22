"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// lib/providerCooldown.ts
function markRateLimited(provider, cooldownMs = 45e3) {
  cooldowns.set(provider, Date.now() + cooldownMs);
}
function isOnCooldown(provider) {
  const until = cooldowns.get(provider);
  if (until === void 0) return false;
  if (Date.now() > until) {
    cooldowns.delete(provider);
    return false;
  }
  return true;
}
var cooldowns;
var init_providerCooldown = __esm({
  "lib/providerCooldown.ts"() {
    "use strict";
    cooldowns = /* @__PURE__ */ new Map();
  }
});

// lib/cerebras.ts
var cerebras_exports = {};
__export(cerebras_exports, {
  CEREBRAS_CONFIGURED: () => CEREBRAS_CONFIGURED,
  CEREBRAS_MODEL: () => CEREBRAS_MODEL,
  CEREBRAS_VISION_CONFIGURED: () => CEREBRAS_VISION_CONFIGURED,
  CEREBRAS_VISION_MODEL: () => CEREBRAS_VISION_MODEL,
  cerebrasChat: () => cerebrasChat,
  cerebrasVisionChat: () => cerebrasVisionChat,
  pingCerebras: () => pingCerebras
});
async function cerebrasCompletion(messages, system, opts) {
  if (!CEREBRAS_API_KEY) throw new Error("CEREBRAS_API_KEY is not set. Get one at https://cloud.cerebras.ai and add it to .env.local / Vercel.");
  return chatCompletion(
    CEREBRAS_BASE,
    CEREBRAS_API_KEY,
    opts?.model ?? CEREBRAS_MODEL,
    messages,
    system,
    void 0,
    {
      max_tokens: opts?.max_tokens,
      temperature: opts?.temperature,
      extraPayload: opts?.reasoning_effort ? { reasoning_effort: opts.reasoning_effort } : void 0
    }
  );
}
async function cerebrasChat(messages, system, opts) {
  return cerebrasCompletion(messages, system, opts);
}
async function cerebrasVisionChat(system, question, imageDataUrls, opts) {
  if (!CEREBRAS_API_KEY) throw new Error("CEREBRAS_API_KEY is not set");
  const parts = [{ type: "text", text: question }];
  for (const url of imageDataUrls.slice(0, 10)) parts.push({ type: "image_url", image_url: { url } });
  const msg = await chatCompletion(
    CEREBRAS_BASE,
    CEREBRAS_API_KEY,
    opts?.model ?? CEREBRAS_VISION_MODEL,
    [{ role: "user", content: parts }],
    system,
    void 0,
    { max_tokens: opts?.max_tokens ?? 1100, temperature: opts?.temperature ?? 0.3 }
  );
  return msg?.content ?? "";
}
async function pingCerebras() {
  if (!CEREBRAS_API_KEY) throw new Error("CEREBRAS_API_KEY is not set");
  return cerebrasCompletion([{ role: "user", content: "Reply with the single word ok." }], void 0, { max_tokens: 10 });
}
var CEREBRAS_BASE, CEREBRAS_API_KEY, CEREBRAS_MODEL, CEREBRAS_CONFIGURED, CEREBRAS_VISION_MODEL, CEREBRAS_VISION_CONFIGURED;
var init_cerebras = __esm({
  "lib/cerebras.ts"() {
    "use strict";
    init_groq();
    CEREBRAS_BASE = process.env.CEREBRAS_BASE_URL ?? "https://api.cerebras.ai/v1";
    CEREBRAS_API_KEY = process.env.CEREBRAS_API_KEY ?? "";
    CEREBRAS_MODEL = process.env.CEREBRAS_MODEL ?? "gpt-oss-120b";
    CEREBRAS_CONFIGURED = !!CEREBRAS_API_KEY;
    CEREBRAS_VISION_MODEL = process.env.CEREBRAS_VISION_MODEL ?? "gemma-4-31b";
    CEREBRAS_VISION_CONFIGURED = !!CEREBRAS_API_KEY;
  }
});

// lib/groq.ts
function stripThinkTags(text) {
  if (!text) return text;
  return text.replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/<think>[\s\S]*$/gi, "").trim();
}
function stripSafetyLabels(text) {
  if (!text) return text;
  return text.replace(/^[ \t>*_-]*(?:user|response|prompt|content|assistant|output|input|message|conversation|overall|final)\s+safety\s*[:=]\s*\S.*$/gim, "").replace(/\n{3,}/g, "\n\n").trim();
}
function stripAiDashes(text) {
  if (!text) return text;
  return text.replace(/\s*[—–]\s*/g, ", ").replace(/,\s*,/g, ",").replace(/,\s*([.!?])/g, "$1").trim();
}
function looksLikeLeakedReasoning(text) {
  if (!text || text.length < 350) return false;
  let hits = 0;
  for (const re of REASONING_LEAK_SIGNALS) {
    if (re.test(text)) hits++;
    if (hits >= 2) return true;
  }
  return false;
}
function headersFor(base, apiKey) {
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`
  };
  return headers;
}
async function chatCompletion(base, apiKey, model, messages, system, tools, opts, retryCount = 0) {
  if (!apiKey) throw new Error(`No API key configured for ${base}`);
  if (isOnCooldown(base)) throw new Error(`${base} is on rate-limit cooldown, skipping`);
  const allMessages = system ? [{ role: "system", content: system }, ...messages] : messages;
  const payload = {
    model,
    messages: allMessages,
    temperature: opts?.temperature ?? 0.1,
    max_tokens: opts?.max_tokens ?? 1200,
    ...opts?.extraPayload ?? {}
  };
  if (tools && tools.length > 0) {
    payload.tools = tools;
    payload.tool_choice = "auto";
  }
  try {
    const res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: headersFor(base, apiKey),
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(25e3)
    });
    if (res.status === 429) {
      markRateLimited(base);
      const rlErr = new Error(`AI Provider HTTP 429 (rate limited): ${base}`);
      rlErr.isRateLimit = true;
      throw rlErr;
    }
    if (!res.ok) {
      const errorText = await res.text();
      try {
        const errorJson = JSON.parse(errorText);
        if (errorJson.error?.code === "tool_use_failed" && errorJson.error?.failed_generation) {
          console.warn("Caught tool_use_failed error. Self-healing via failed_generation parser...");
          return {
            role: "assistant",
            content: errorJson.error.failed_generation
          };
        }
      } catch (e) {
      }
      throw new Error(`AI Provider HTTP ${res.status}: ${errorText}`);
    }
    const data = await res.json();
    return data.choices?.[0]?.message;
  } catch (err) {
    if (!err.isRateLimit && retryCount < 2 && !err.message?.includes("API key")) {
      console.warn(`AI provider connection error on ${base}: ${err.message}. Retrying in 2000ms...`);
      await new Promise((resolve) => setTimeout(resolve, 2e3));
      return chatCompletion(base, apiKey, model, messages, system, tools, opts, retryCount + 1);
    }
    throw err;
  }
}
async function groqDirectVisionChat(messages, system, opts, retryCount = 0) {
  if (!GROQ_DIRECT_API_KEY) {
    const e = new Error("GROQ_API_KEY not set");
    e.status = 0;
    throw e;
  }
  const allMessages = [{ role: "system", content: system }, ...messages];
  const payload = {
    model: GROQ_DIRECT_VISION_MODEL,
    messages: allMessages,
    temperature: opts?.temperature ?? 0.2,
    max_tokens: opts?.max_tokens ?? 700
  };
  try {
    const res = await fetch(`${GROQ_DIRECT_BASE}/chat/completions`, {
      method: "POST",
      headers: headersFor(GROQ_DIRECT_BASE, GROQ_DIRECT_API_KEY),
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(3e4)
    });
    if (res.status === 429 && retryCount < 1) {
      await new Promise((r) => setTimeout(r, 3e3));
      return groqDirectVisionChat(messages, system, opts, retryCount + 1);
    }
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Groq direct vision HTTP ${res.status}: ${err}`);
    }
    const data = await res.json();
    return data.choices?.[0]?.message;
  } catch (err) {
    if (retryCount < 1 && !err.message?.includes("API key")) {
      await new Promise((r) => setTimeout(r, 2e3));
      return groqDirectVisionChat(messages, system, opts, retryCount + 1);
    }
    throw err;
  }
}
async function geminiVisionChat(systemPrompt, question, imageDataUrls, opts) {
  const apiKey = process.env.GOOGLE_AI_API_KEY;
  if (!apiKey) {
    const e2 = new Error("GOOGLE_AI_API_KEY not set");
    e2.status = 0;
    throw e2;
  }
  const parts = [{ text: `${systemPrompt}

${question}` }];
  for (const url of imageDataUrls) {
    const m = url.match(/^data:([^;]+);base64,(.+)$/);
    if (m) parts.push({ inline_data: { mime_type: m[1], data: m[2] } });
  }
  const body = JSON.stringify({
    contents: [{ role: "user", parts }],
    generationConfig: { maxOutputTokens: opts?.max_tokens ?? 900, temperature: opts?.temperature ?? 0.3 }
  });
  let last429 = false;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, attempt * 2500));
    let res;
    try {
      res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body, signal: AbortSignal.timeout(3e4) }
      );
    } catch (e2) {
      if (attempt < 2) continue;
      throw e2;
    }
    if (res.status === 429) {
      last429 = true;
      if (attempt < 2) continue;
      const e2 = new Error("Gemini rate limit");
      e2.status = 429;
      throw e2;
    }
    if (res.status >= 500 && attempt < 2) continue;
    if (!res.ok) throw new Error(`Gemini HTTP ${res.status}: ${await res.text()}`);
    const data = await res.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  }
  const e = new Error(last429 ? "Gemini rate limit" : "Gemini failed");
  if (last429) e.status = 429;
  throw e;
}
async function wardrobeVisionChat(systemPrompt, question, imageDataUrls, opts) {
  const errors = [];
  try {
    const content = stripSafetyLabels(stripAiDashes(stripThinkTags((await geminiVisionChat(systemPrompt, question, imageDataUrls, opts)).trim())));
    if (!content) throw new Error("empty content");
    if (looksLikeLeakedReasoning(content)) throw new Error("leaked reasoning");
    return content;
  } catch (err2) {
    errors.push({ name: "gemini", err: err2 });
  }
  const imageParts = imageDataUrls.map((url) => ({
    type: "image_url",
    image_url: { url, detail: "low" }
  }));
  const visionMessages = [{ role: "user", content: [{ type: "text", text: question }, ...imageParts] }];
  if (process.env.CEREBRAS_API_KEY) {
    try {
      const { cerebrasVisionChat: cerebrasVisionChat2 } = await Promise.resolve().then(() => (init_cerebras(), cerebras_exports));
      const raw = await cerebrasVisionChat2(systemPrompt, question, imageDataUrls, opts);
      const content = stripSafetyLabels(stripAiDashes(stripThinkTags(raw.trim())));
      if (!content) throw new Error("empty content");
      if (looksLikeLeakedReasoning(content)) throw new Error("leaked reasoning");
      return content;
    } catch (err2) {
      errors.push({ name: "cerebras", err: err2 });
    }
  }
  try {
    const msg = await groqDirectVisionChat(visionMessages, systemPrompt, opts);
    const content = stripSafetyLabels(stripAiDashes(stripThinkTags((msg?.content ?? "").trim())));
    if (!content) throw new Error("empty content");
    if (looksLikeLeakedReasoning(content)) throw new Error("leaked reasoning");
    return content;
  } catch (err2) {
    errors.push({ name: "groq-direct", err: err2 });
  }
  const err = new Error(`vision: ${errors.map((e) => `${e.name}(${e.err?.message})`).join(" | ")}`);
  err.status = errors.find((e) => e.err?.status === 429)?.err.status ?? errors[0]?.err?.status;
  throw err;
}
var CHAT_MODEL, FAST_MODEL, GROQ_DIRECT_BASE, GROQ_DIRECT_API_KEY, GROQ_DIRECT_SMART_MODEL, GROQ_DIRECT_FAST_MODEL, GROQ_DIRECT_VISION_MODEL, REASONING_LEAK_SIGNALS;
var init_groq = __esm({
  "lib/groq.ts"() {
    "use strict";
    init_providerCooldown();
    CHAT_MODEL = process.env.GROQ_SMART_MODEL ?? "openai/gpt-oss-120b";
    FAST_MODEL = process.env.GROQ_FAST_MODEL ?? "openai/gpt-oss-20b";
    GROQ_DIRECT_BASE = process.env.GROQ_BASE_URL ?? "https://api.groq.com/openai/v1";
    GROQ_DIRECT_API_KEY = process.env.GROQ_API_KEY ?? "";
    GROQ_DIRECT_SMART_MODEL = process.env.GROQ_SMART_MODEL ?? "openai/gpt-oss-120b";
    GROQ_DIRECT_FAST_MODEL = process.env.GROQ_FAST_MODEL ?? "openai/gpt-oss-20b";
    GROQ_DIRECT_VISION_MODEL = process.env.GROQ_VISION_MODEL ?? "qwen/qwen3.6-27b";
    REASONING_LEAK_SIGNALS = [
      /\bthe user (says?|wants?|is asking|said|likely)\b/i,
      /\bwe (need to|must|can|should)\b/i,
      /\blet'?s (do|check|see|think|write|make sure)\b/i,
      /\bthe rules? (say|states?|is)\b/i,
      /\bcheck rules?:?/i,
      /\b(now\s+)?(the\s+)?final (response|answer):?/i,
      /\bshould we\b/i
    ];
  }
});

// lib/services/sameGarment.ts
var sameGarment_exports = {};
__export(sameGarment_exports, {
  findSameGarment: () => findSameGarment,
  sameGarmentEnabled: () => sameGarmentEnabled
});
module.exports = __toCommonJS(sameGarment_exports);
init_groq();
var TIMEOUT_MS = Number(process.env.SAME_GARMENT_TIMEOUT_MS ?? 12e3);
var MAX_CANDIDATES = 6;
function sameGarmentEnabled() {
  return (process.env.SAME_GARMENT_VISION ?? "on").toLowerCase() === "on";
}
function thumb(src, px = 384) {
  try {
    const u = new URL(src.startsWith("//") ? `https:${src}` : src);
    if (/cdn\.shopify|shopifycdn/.test(u.hostname) || u.pathname.includes("/cdn/shop/")) {
      u.searchParams.set("width", String(px));
      u.searchParams.delete("height");
    }
    return u.toString();
  } catch {
    return src;
  }
}
var SYSTEM = "You compare garments in photographs and you are strict about sameness. You reply with JSON and nothing else.";
function prompt(n) {
  return `Image 1 is a garment a shopper is trying to find. Images 2 to ${n + 1} are products from a shop, in order.

Which of the shop products, if any, is THE SAME GARMENT as image 1?

The same garment means the same product, allowing for a different photograph of it: another angle, other lighting, on a foot or a body instead of held or flat, a screenshot instead of the original. Judge the object itself \u2014 its shape and construction, its material, its colour, where any pattern sits, its fastenings and trim, its sole or its collar, and any lettering or logo on it.

Two products of the same type and colour are NOT the same garment. A blue denim sandal is not a match for another blue denim sandal unless the details actually agree. Answer 0 unless you are genuinely confident: a wrong match is worse than admitting there is none, because the shopper asked for this exact piece and will believe you.

Reply with ONLY this JSON:
{"same": <1-${n} for the matching shop product, or 0 if none of them is>, "confidence": <0-100>, "closest": <1-${n}>, "why": "<up to 12 words>"}`;
}
var NONE = { sameIndex: null, closestIndex: null, confidence: 0, why: "" };
var CONFIDENT = 70;
async function findSameGarment(wantedImage, candidateImages, budgetMs) {
  if (!sameGarmentEnabled() || !wantedImage) return NONE;
  const cands = candidateImages.filter(Boolean).slice(0, MAX_CANDIDATES);
  if (cands.length === 0) return NONE;
  try {
    const raw = await Promise.race([
      wardrobeVisionChat(
        SYSTEM,
        prompt(cands.length),
        [wantedImage, ...cands.map((u) => thumb(u))],
        { max_tokens: 150, temperature: 0 }
      ),
      new Promise((r) => setTimeout(() => r(null), Math.max(3e3, Math.min(TIMEOUT_MS, budgetMs ?? TIMEOUT_MS))))
    ]);
    if (!raw) return NONE;
    const m = String(raw).match(/\{[\s\S]*\}/);
    if (!m) return NONE;
    const parsed = JSON.parse(m[0]);
    const confidence = Math.max(0, Math.min(100, Number(parsed.confidence) || 0));
    const same = Number(parsed.same);
    const closest = Number(parsed.closest);
    const sameOk = Number.isInteger(same) && same >= 1 && same <= cands.length && confidence >= CONFIDENT;
    const closestOk = Number.isInteger(closest) && closest >= 1 && closest <= cands.length;
    return {
      sameIndex: sameOk ? same - 1 : null,
      closestIndex: closestOk ? closest - 1 : null,
      confidence,
      why: typeof parsed.why === "string" ? parsed.why.slice(0, 90) : ""
    };
  } catch {
    return NONE;
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  findSameGarment,
  sameGarmentEnabled
});
