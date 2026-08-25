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

// lib/stylist/limits.ts
var limits_exports = {};
__export(limits_exports, {
  PROVIDER_OUT_MS: () => PROVIDER_OUT_MS,
  __state: () => __state,
  isRateLimited: () => isRateLimited,
  markProviderOut: () => markProviderOut,
  modelLooksDown: () => modelLooksDown,
  noteModelFailure: () => noteModelFailure,
  noteModelSuccess: () => noteModelSuccess,
  providerOutUntil: () => providerOutUntil,
  stylistRateLimited: () => stylistRateLimited
});
module.exports = __toCommonJS(limits_exports);
var stylistBuckets = /* @__PURE__ */ new Map();
var STYLIST_MAX = 30;
var STYLIST_WIN = 6e4;
var lastStylistSweep = 0;
var STYLIST_SWEEP_EVERY = 5 * 6e4;
function stylistRateLimited(req) {
  const ip = req.headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim() ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const now = Date.now();
  if (now - lastStylistSweep > STYLIST_SWEEP_EVERY) {
    lastStylistSweep = now;
    stylistBuckets.forEach((bucket, key) => {
      if (now > bucket.resetAt) stylistBuckets.delete(key);
    });
  }
  const b = stylistBuckets.get(ip);
  if (!b || now > b.resetAt) {
    stylistBuckets.set(ip, { count: 1, resetAt: now + STYLIST_WIN });
    return false;
  }
  if (b.count >= STYLIST_MAX) return true;
  b.count++;
  return false;
}
var BREAKER_TRIP_AT = 3;
var BREAKER_COOLDOWN_MS = 6e4;
var modelFailures = 0;
var breakerOpenedAt = 0;
function modelLooksDown() {
  if (modelFailures < BREAKER_TRIP_AT) return false;
  if (Date.now() - breakerOpenedAt > BREAKER_COOLDOWN_MS) {
    modelFailures = 0;
    return false;
  }
  return true;
}
function noteModelFailure() {
  modelFailures++;
  if (modelFailures === BREAKER_TRIP_AT) {
    breakerOpenedAt = Date.now();
    console.warn("[stylist] model breaker OPEN \u2014 serving the catalogue directly for 60s");
  }
}
function noteModelSuccess() {
  if (modelFailures > 0) console.log("[stylist] model breaker closed");
  modelFailures = 0;
}
var providerOut = /* @__PURE__ */ new Map();
var PROVIDER_OUT_MS = 10 * 6e4;
function markProviderOut(name) {
  providerOut.set(name, Date.now() + PROVIDER_OUT_MS);
}
function providerOutUntil(name) {
  return providerOut.get(name);
}
function isRateLimited(err) {
  const msg = err?.message || "";
  return /\b429\b|rate limit|too many requests|quota/i.test(msg);
}
var __state = {
  buckets: () => stylistBuckets,
  failures: () => modelFailures,
  providerOut: () => providerOut
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  PROVIDER_OUT_MS,
  __state,
  isRateLimited,
  markProviderOut,
  modelLooksDown,
  noteModelFailure,
  noteModelSuccess,
  providerOutUntil,
  stylistRateLimited
});
