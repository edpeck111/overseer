// OVERSEER v3 shell — entry point.
// Boots the chrome, mounts HOME, hands keystrokes to the router, wires
// the transport + outbound queue + optimistic dispatcher.

import "./styles/main.css";

import { createStore }      from "./state/store.js";
import { initialState }     from "./state/initial.js";
import { mountStatusBar }   from "./chrome/statusbar.js";
import { mountBreadcrumb }  from "./chrome/breadcrumb.js";
import { mountHotkeyBar }   from "./chrome/hotkey_bar.js";
import { observeMode }      from "./chrome/mode.js";
import { mountPalette }     from "./palette/palette.js";
import { mountHome }        from "./modules/home.js";
import { mountPlaceholder } from "./modules/_placeholder.js";
import { mountRouter }      from "./router.js";
import { makeTransport }    from "./transport/transport.js";
import { ActionQueue }      from "./transport/queue.js";
import { makeDispatcher }   from "./transport/dispatcher.js";

const store = createStore(initialState());

mountStatusBar (document.getElementById("statusbar"),  store);
mountBreadcrumb(document.getElementById("breadcrumb"), store);
mountHotkeyBar (document.getElementById("hotkeybar"),  store);

const palette = mountPalette(document.getElementById("palette"), store);

const content = document.getElementById("content");
mountHome(content, store);
mountPlaceholder(content, store);

mountRouter(store, { palette });
observeMode(document.getElementById("term"));

// Transport: HttpTransport on WiFi, OmpTransport on mesh. The
// transport pushes its health into store.mesh; the status strip's
// MESH:●●○ indicator already subscribes to mesh and re-renders.
const transport = makeTransport({ store });
const queue     = new ActionQueue({ store });
const dispatch  = makeDispatcher({ store, transport, queue });

// Expose for debug / palette plugins / module use.
window.__overseer = { store, transport, queue, dispatch };

store.subscribe("module", (m) => { if (m === "HOME") mountHome(content, store); });
