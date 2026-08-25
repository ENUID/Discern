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

// lib/stylist/trace.ts
var trace_exports = {};
__export(trace_exports, {
  finishTrace: () => finishTrace,
  newTraceId: () => newTraceId,
  note: () => note,
  shown: () => shown,
  startTrace: () => startTrace,
  step: () => step
});
module.exports = __toCommonJS(trace_exports);
var CAP = {
  string: 300,
  question: 500,
  steps: 40,
  products: 24,
  queries: 8,
  title: 120
};
var cap = (s, n = CAP.string) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);
function newTraceId(now = Date.now(), rand = Math.random) {
  const t = now.toString(36);
  const r = Math.floor(rand() * 36 ** 4).toString(36).padStart(4, "0");
  return `r-${t}-${r}`;
}
function startTrace(input) {
  const startedAt = input.now ?? Date.now();
  return {
    id: newTraceId(startedAt),
    startedAt,
    question: cap(input.question, CAP.question),
    gender: input.gender ? cap(input.gender, 20) : void 0,
    country: input.country ? cap(input.country, 8) : void 0,
    currency: input.currency ? cap(input.currency, 8) : void 0,
    steps: []
  };
}
function step(t, name, detail) {
  if (!t || t.steps.length >= CAP.steps) return;
  t.steps.push({ at: Date.now() - t.startedAt, step: cap(name, 60), detail: detail ? cap(detail) : void 0 });
}
function note(t, fields) {
  if (!t) return;
  if (fields.route) t.route = cap(fields.route, 20);
  if (fields.answerVia) t.answerVia = cap(fields.answerVia, 20);
  if (fields.searchQuery) t.searchQuery = cap(fields.searchQuery, 200);
  if (fields.outfitQueries) t.outfitQueries = fields.outfitQueries.slice(0, CAP.queries).map((q) => cap(q, 200));
  if (fields.occasion) t.occasion = cap(fields.occasion, 40);
  if (fields.slots) t.slots = fields.slots.slice(0, CAP.queries).map((x) => cap(x, 30));
  if (fields.judge) t.judge = cap(fields.judge, 20);
  if (fields.judgeDetail) t.judgeDetail = cap(fields.judgeDetail, 60);
  if (fields.modelTrace) t.modelTrace = cap(fields.modelTrace);
  if (fields.outfitTrace) t.outfitTrace = fields.outfitTrace.slice(0, CAP.queries).map((x) => cap(x));
  if (fields.sameGarment) t.sameGarment = fields.sameGarment;
  if (fields.degraded !== void 0) t.degraded = fields.degraded;
}
function shown(t, products) {
  if (!t || !Array.isArray(products)) return;
  t.shown = products.slice(0, CAP.products).map((p) => {
    const o = p;
    return {
      id: cap(o?.id, 80),
      title: cap(o?.title, CAP.title),
      vendor: o?.vendor ? cap(o.vendor, 60) : void 0
    };
  });
}
function finishTrace(t) {
  if (!t) return null;
  t.ms = Date.now() - t.startedAt;
  return t;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  finishTrace,
  newTraceId,
  note,
  shown,
  startTrace,
  step
});
