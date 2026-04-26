// Screen registry — single source of truth mapping module name → mounter.
// main.js dispatches to this on every store.module change. Modules
// without an entry fall back to the Sprint-1 placeholder so the user
// sees a "coming Sprint N" card rather than a dead screen.

import { mountHome }  from "./home.js";
import { mountPower } from "./power.js";

/** @type {Record<string, (root: HTMLElement, store: any, ctx: any) => (() => void) | undefined>} */
export const SCREENS = {
  HOME:  mountHome,
  POWER: mountPower,
  // KNOWLEDGE, COMMS, ... land in their respective sprints
};
