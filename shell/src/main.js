// OVERSEER v3 shell — entry point.
// Boots the chrome, mounts HOME, hands keystrokes to the router.

import "./styles/main.css";

import { createStore }     from "./state/store.js";
import { initialState }    from "./state/initial.js";
import { mountStatusBar }  from "./chrome/statusbar.js";
import { mountBreadcrumb } from "./chrome/breadcrumb.js";
import { mountHotkeyBar }  from "./chrome/hotkey_bar.js";
import { observeMode }     from "./chrome/mode.js";
import { mountPalette }    from "./palette/palette.js";
import { mountHome }       from "./modules/home.js";
import { mountPlaceholder } from "./modules/_placeholder.js";
import { mountRouter }     from "./router.js";

const store = createStore(initialState());

mountStatusBar (document.getElementById("statusbar"),  store);
mountBreadcrumb(document.getElementById("breadcrumb"), store);
mountHotkeyBar (document.getElementById("hotkeybar"),  store);

const palette = mountPalette(document.getElementById("palette"), store);

// Mount HOME first; the placeholder takes over the content area when
// the user navigates to a non-HOME module.
const content = document.getElementById("content");
mountHome(content, store);
mountPlaceholder(content, store);

mountRouter(store, { palette });
observeMode(document.getElementById("term"));

// HOME re-mounts whenever the user comes back via Q so the menu's
// active state is fresh. Sprint 2 will fold this into proper view
// management; the duplicate mounts are cheap because the store-driven
// updates are idempotent.
store.subscribe("module", (m) => {
  if (m === "HOME") mountHome(content, store);
});
