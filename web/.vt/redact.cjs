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

// lib/redact.ts
var redact_exports = {};
__export(redact_exports, {
  redactSecrets: () => redactSecrets
});
module.exports = __toCommonJS(redact_exports);
function redactSecrets(input) {
  const raw = String(input?.message ?? input ?? "").replace(/\s+/g, " ").trim();
  if (!raw) return "";
  return raw.replace(/(bearer\s+)\S+/gi, "$1[redacted]").replace(/([?&](?:key|api_?key|access_?token|token)=)[^&\s"']+/gi, "$1[redacted]").replace(/("(?:api_?key|key|token|authorization)"\s*:\s*")[^"]*/gi, "$1[redacted]").replace(/\b[A-Za-z0-9_-]{24,}\b/g, "[redacted]").slice(0, 300);
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  redactSecrets
});
