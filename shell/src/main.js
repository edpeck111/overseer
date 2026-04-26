// OVERSEER v3 shell — entry point.
//
// Sprint 0: minimal stub that just confirms the bundle loads. Sprint 1
// (Chrome + HOME) brings status strip, breadcrumb, hotkey bar, command
// palette, and the home menu to life.

import { createStore } from "./state/store.js";
import { httpTransport } from "./transport/http.js";

const store = createStore({
  version: "3.0.0-dev0",
  module: "HOME",
  mesh: { health: "?", peers: 0 },
  power: null,
});

console.info("OVERSEER v3 shell loaded. Module:", store.get("module"));

// Sprint 1 will wire transport into the store; Sprint 0 leaves the
// import in place so the dependency graph is real and esbuild includes
// the transport module in the bundle.
void httpTransport;
