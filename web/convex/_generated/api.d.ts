/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as brandHealth from "../brandHealth.js";
import type * as imageOrder from "../imageOrder.js";
import type * as qualitySignals from "../qualitySignals.js";
import type * as searchCache from "../searchCache.js";
import type * as searchHistory from "../searchHistory.js";
import type * as shop from "../shop.js";
import type * as shopperShelf from "../shopperShelf.js";
import type * as stylistMemory from "../stylistMemory.js";
import type * as stylistSessions from "../stylistSessions.js";
import type * as subscriptions from "../subscriptions.js";
import type * as tasteProfile from "../tasteProfile.js";
import type * as users from "../users.js";
import type * as verificationCodes from "../verificationCodes.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  brandHealth: typeof brandHealth;
  imageOrder: typeof imageOrder;
  qualitySignals: typeof qualitySignals;
  searchCache: typeof searchCache;
  searchHistory: typeof searchHistory;
  shop: typeof shop;
  shopperShelf: typeof shopperShelf;
  stylistMemory: typeof stylistMemory;
  stylistSessions: typeof stylistSessions;
  subscriptions: typeof subscriptions;
  tasteProfile: typeof tasteProfile;
  users: typeof users;
  verificationCodes: typeof verificationCodes;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
