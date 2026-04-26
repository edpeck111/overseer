// OVERSEER v3 shell — entry point.
//
// Sprint 1 boot order:
//   1. import CSS so esbuild emits dist/main.css
//   2. create the shared store with placeholder values
//   3. mount chrome (status strip, breadcrumb, hotkey bar)
//   4. observe terminal width and set data-mode (phone/tablet/desktop)
//   5. mount HOME, register hotkey routing, register palette opener
//
// Sprint 2 will wire transport into the store; Sprint 3 onwards swaps
// each module's stub for the real one.

import "./styles/main.css";

import { createStore } from "./state/store.js";
import { mountStatusBar }  from "./chrome/statusbar.js";
import { mountBreadcrumb } from "./chrome/breadcrumb.js";
import { mountHotkeyBar }  from "./chrome/hotkey_bar.js";
import { mountPalette }    from "./palette/palette.js";
import { mountHome }       from "./modules/home.js";
import { observeMode }     from "./chrome/mode.js";
import { mountRouter }     from "./router.js";
import { initialState }    from "./state/initial.js";

const store = createStore(initialState());

// Chrome — always-on, P2 spatial consistency.
mountStatusBar (document.getElementById("statusbar"),  store);
mountBreadcrumb(document.getElementById("breadcrumb"), store);
mountHotkeyBar (document.getElementById("hotkeybar"),  store);

// Overlays.
const palette = mountPalette(document.getElementById("palette"), store);

// Content. HOME is the default screen for Sprint 1; subsequent sprints
// swap their module-id when the user activates their hotkey.
mountHome(document.getElementById("content"), store);

// Routing — wires keyboard hotkeys to module switches and `:` to palette.
mountRouter(store, { palette });

// Mode observer — sets data-mode on the terminal element on resize.
observeMode(document.getElementById("term"));
