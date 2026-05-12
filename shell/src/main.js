// OVERSEER v3 shell — entry point.
// Boots the chrome, sets up the transport stack, dispatches content
// rendering through the SCREENS registry on every store.module change.

import "./styles/main.css";

import { createStore }      from "./state/store.js";
import { initialState }     from "./state/initial.js";
import { mountStatusBar }   from "./chrome/statusbar.js";
import { mountBreadcrumb }  from "./chrome/breadcrumb.js";
import { mountHotkeyBar }   from "./chrome/hotkey_bar.js";
import { observeMode }      from "./chrome/mode.js";
import { mountPalette }     from "./palette/palette.js";
import { mountRouter }      from "./router.js";
import { makeTransport }    from "./transport/transport.js";
import { ActionQueue }      from "./transport/queue.js";
import { makeDispatcher }   from "./transport/dispatcher.js";
import { SCREENS }          from "./modules/_screens.js";
import { mountPlaceholder } from "./modules/_placeholder.js";

const store = createStore(initialState());

mountStatusBar (document.getElementById("statusbar"),  store);
mountBreadcrumb(document.getElementById("breadcrumb"), store);
mountHotkeyBar (document.getElementById("hotkeybar"),  store);

const palette = mountPalette(document.getElementById("palette"), store);

const transport = makeTransport({ store });
const queue     = new ActionQueue({ store });
const dispatch  = makeDispatcher({ store, transport, queue });

const ctx = { transport, queue, dispatch, store };

// Content routing — single subscriber to "module". On change: unmount
// the current screen (call its returned cleanup), look up the new
// screen in SCREENS or fall back to placeholder, mount it. Sprint 4+
// modules each register their entry into SCREENS at boot time.
const content = document.getElementById("content");
let currentUnmount = null;

function dispatchScreen(name) {
  if (typeof currentUnmount === "function") {
    try { currentUnmount(); } catch (e) { console.error("[shell] cleanup threw", e); }
  }
  const key = String(name || "HOME").toUpperCase();
  const mounter = SCREENS[key] || mountPlaceholder;
  currentUnmount = mounter(content, store, ctx) || null;
}

store.subscribe("module", dispatchScreen);
dispatchScreen(store.get("module"));

mountRouter(store, { palette });
observeMode(document.getElementById("term"));

window.__overseer = ctx;     // debug + plugin hook
