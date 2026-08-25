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

// lib/fashion/garmentProfile.ts
var garmentProfile_exports = {};
__export(garmentProfile_exports, {
  PROFILE_PROMPT_VERSION: () => PROFILE_PROMPT_VERSION,
  PROFILE_SCHEMA_VERSION: () => PROFILE_SCHEMA_VERSION,
  PROFILE_SYSTEM: () => PROFILE_SYSTEM,
  parseProfile: () => parseProfile,
  profilePrompt: () => profilePrompt,
  worksWith: () => worksWith
});
module.exports = __toCommonJS(garmentProfile_exports);
var PROFILE_SCHEMA_VERSION = 1;
var PROFILE_PROMPT_VERSION = 1;
var PROFILE_SYSTEM = "You are a garment analyst. You look at a photograph of one piece of clothing and record what it is, as structured JSON. You never guess beyond what the photograph and the copy support, and you only ever output JSON.";
function profilePrompt(title, description) {
  return `This is one product. Read the photograph first; the words are supporting evidence.

TITLE: ${title}
COPY: ${String(description || "").slice(0, 400)}

Return ONLY this JSON, using EXACTLY these allowed values:
{
  "garment": "<shirt|t-shirt|polo|sweater|cardigan|jacket|blazer|coat|vest|trouser|jean|chino|short|skirt|dress|jumpsuit|sneaker|loafer|boot|derby|sandal|bag|belt|hat|scarf>",
  "fit": "<slim|regular|relaxed|oversized|wide>",
  "volume": "<fitted|boxy>",
  "fabric": "<one word: linen, cotton, wool, denim, leather, silk, cashmere, corduroy, canvas, jersey, suede, velvet, nylon, blend>",
  "weight": "<light|mid|heavy>",
  "drape": "<crisp|fluid|structured>",
  "pattern": "<plain|stripe|check|floral|geometric|abstract|texture>",
  "patternScale": "<none|small|medium|large>",
  "colour": "<precise colour name, two words at most: ecru, mid-wash indigo, dark olive, charcoal>",
  "formality": <1 gym, 2 casual, 3 smart casual, 4 formal, 5 black tie>,
  "aesthetic": "<tailored|classic|minimal|workwear|streetwear|artisanal|sport|resort|romantic>",
  "season": "<summer|winter|transitional|all>",
  "details": ["at most four short phrases: camp collar, short sleeve, patch pocket, pleated front, wide leg, zip through"],
  "quality": <0 nothing stated, 1 basic, 2 good fibre or construction named, 3 exceptional cloth or handwork>
}

Judge the GARMENT, never the model wearing it or the background. If the photograph is a screenshot, ignore every interface element. Where the photograph and the copy disagree, believe the photograph.`;
}
var ONE_OF = (v, allowed, fallback) => typeof v === "string" && allowed.includes(v.toLowerCase()) ? v.toLowerCase() : fallback;
function parseProfile(raw) {
  try {
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) return null;
    const o = JSON.parse(m[0]);
    const garment = typeof o.garment === "string" ? o.garment.toLowerCase().trim() : "";
    if (!garment) return null;
    const n = Number(o.formality);
    const q = Number(o.quality);
    return {
      garment,
      fit: ONE_OF(o.fit, ["slim", "regular", "relaxed", "oversized", "wide"], "regular"),
      volume: ONE_OF(o.volume, ["fitted", "boxy"], "fitted"),
      fabric: typeof o.fabric === "string" ? o.fabric.toLowerCase().trim() : "blend",
      weight: ONE_OF(o.weight, ["light", "mid", "heavy"], "mid"),
      drape: ONE_OF(o.drape, ["crisp", "fluid", "structured"], "crisp"),
      pattern: ONE_OF(o.pattern, ["plain", "stripe", "check", "floral", "geometric", "abstract", "texture"], "plain"),
      patternScale: ONE_OF(o.patternScale, ["none", "small", "medium", "large"], "none"),
      colour: typeof o.colour === "string" ? o.colour.toLowerCase().trim().slice(0, 24) : "",
      formality: Number.isFinite(n) && n >= 1 && n <= 5 ? Math.round(n) : 3,
      aesthetic: ONE_OF(o.aesthetic, ["tailored", "classic", "minimal", "workwear", "streetwear", "artisanal", "sport", "resort", "romantic"], "classic"),
      season: ONE_OF(o.season, ["summer", "winter", "transitional", "all"], "all"),
      details: Array.isArray(o.details) ? o.details.filter((d) => typeof d === "string").map((d) => d.toLowerCase().trim()).slice(0, 4) : [],
      quality: Number.isFinite(q) && q >= 0 && q <= 3 ? Math.round(q) : 0
    };
  } catch {
    return null;
  }
}
function worksWith(a, b) {
  const gap = Math.abs(a.formality - b.formality);
  const formality = gap === 0 ? 1 : gap === 1 ? 0.85 : gap === 2 ? 0.4 : 0.05;
  const wideBottom = b.fit === "wide" || b.fit === "relaxed" || b.fit === "oversized";
  const slimBottom = b.fit === "slim";
  const volume = a.volume === "boxy" ? wideBottom ? 0.9 : slimBottom ? 0.45 : 0.75 : wideBottom ? 1 : 0.8;
  const bothPatterned = a.pattern !== "plain" && b.pattern !== "plain";
  const sameScale = a.patternScale === b.patternScale && a.patternScale !== "none";
  const pattern = !bothPatterned ? 1 : sameScale ? 0.25 : 0.55;
  const wOrder = { light: 0, mid: 1, heavy: 2 };
  const wGap = Math.abs(wOrder[a.weight] - wOrder[b.weight]);
  const seasonClash = a.season === "summer" && b.season === "winter" || a.season === "winter" && b.season === "summer";
  const cloth = (wGap === 0 ? 1 : wGap === 1 ? 0.8 : 0.45) * (seasonClash ? 0.4 : 1);
  const FAMILY = {
    tailored: "smart",
    classic: "smart",
    minimal: "smart",
    romantic: "smart",
    workwear: "rugged",
    artisanal: "rugged",
    streetwear: "casual",
    sport: "casual",
    resort: "casual"
  };
  const aesthetic = a.aesthetic === b.aesthetic ? 1 : FAMILY[a.aesthetic] === FAMILY[b.aesthetic] ? 0.85 : 0.5;
  const base = formality * 0.34 + volume * 0.2 + pattern * 0.18 + cloth * 0.16 + aesthetic * 0.12;
  let penalty = 1;
  if (gap >= 3) penalty *= 0.15;
  if (bothPatterned && sameScale && (a.patternScale === "medium" || a.patternScale === "large")) penalty *= 0.4;
  if (seasonClash) penalty *= 0.45;
  if (wGap >= 2) penalty *= 0.75;
  return Math.max(0, Math.min(1, +(base * penalty).toFixed(3)));
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  PROFILE_PROMPT_VERSION,
  PROFILE_SCHEMA_VERSION,
  PROFILE_SYSTEM,
  parseProfile,
  profilePrompt,
  worksWith
});
