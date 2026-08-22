"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
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

// lib/gemini.ts
var gemini_exports = {};
__export(gemini_exports, {
  GEMINI_BASE: () => GEMINI_BASE,
  GEMINI_STYLIST_MODEL: () => GEMINI_STYLIST_MODEL,
  geminiChat: () => geminiChat,
  retiredModelReplacement: () => retiredModelReplacement
});
module.exports = __toCommonJS(gemini_exports);

// lib/providerCooldown.ts
var cooldowns = /* @__PURE__ */ new Map();
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

// lib/gemini.ts
var GEMINI_BASE = "http://127.0.0.1:4951";
var GEMINI_STYLIST_MODEL = process.env.GEMINI_STYLIST_MODEL ?? "gemini-3.6-flash";
var RETIRED_RE = /(?:no longer available|deprecated|not found)[\s\S]{0,200}?use\s+models\/([A-Za-z0-9][\w.-]{2,60})/i;
function retiredModelReplacement(body, asked) {
  const m = RETIRED_RE.exec(body);
  const name = m?.[1]?.replace(/[.,"')\]}]+$/, "");
  return name && name !== asked ? name : null;
}
var liveModel = null;
async function geminiChat(messages, system, opts, retryCount = 0, modelOverride) {
  const apiKey = process.env.GOOGLE_AI_API_KEY;
  if (!apiKey) throw new Error("GOOGLE_AI_API_KEY is not set");
  if (isOnCooldown("gemini")) throw new Error("gemini is on rate-limit cooldown, skipping");
  const allMessages = system ? [{ role: "system", content: system }, ...messages] : messages;
  const model = modelOverride ?? liveModel ?? GEMINI_STYLIST_MODEL;
  const payload = {
    model,
    messages: allMessages,
    temperature: opts?.temperature ?? 0.4,
    max_tokens: opts?.max_tokens ?? 700
  };
  try {
    const res = await fetch(`${GEMINI_BASE}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(3e4)
    });
    if (res.status === 429) {
      markRateLimited("gemini");
      const rlErr = new Error("Gemini HTTP 429 (rate limited)");
      rlErr.isRateLimit = true;
      throw rlErr;
    }
    if (!res.ok) {
      const err = await res.text();
      const replacement = res.status === 404 ? retiredModelReplacement(err, model) : null;
      if (replacement && retryCount < 1) {
        console.warn(`[gemini] ${model} is retired \u2014 trying ${replacement}`);
        try {
          const out = await geminiChat(messages, system, opts, retryCount + 1, replacement);
          liveModel = replacement;
          return out;
        } catch (e) {
          e.isRetired = true;
          throw e;
        }
      }
      throw new Error(`Gemini HTTP ${res.status}: ${err}`);
    }
    const data = await res.json();
    return data.choices?.[0]?.message ?? { role: "assistant", content: null };
  } catch (err) {
    if (!err.isRateLimit && !err.isRetired && retryCount < 1 && !err.message?.includes("API key")) {
      await new Promise((r) => setTimeout(r, 2e3));
      return geminiChat(messages, system, opts, retryCount + 1);
    }
    throw err;
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  GEMINI_BASE,
  GEMINI_STYLIST_MODEL,
  geminiChat,
  retiredModelReplacement
});
