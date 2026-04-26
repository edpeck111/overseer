// Verifies shell/src/sextant/ produces byte-equal output to the Python
// prototype on the curated fixture set. Run from repo root:
//
//     node tests/fixtures/sextant_js_parity.mjs

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { rasterize } from "../../shell/src/sextant/rasterizer.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const inputs   = JSON.parse(readFileSync(path.join(__dirname, "sextant_input_bitmaps.json"), "utf8"));
const expected = JSON.parse(readFileSync(path.join(__dirname, "sextant_fixtures.json"), "utf8"));

let pass = 0, fail = 0;
for (const [name, bitmap] of Object.entries(inputs)) {
  const got = rasterize(bitmap);
  if (got === expected[name]) {
    console.log(" PASS:", name);
    pass++;
  } else {
    console.error("FAIL:", name);
    console.error("  expected:");
    console.error(expected[name].split("\n").map(l => "    " + l).join("\n"));
    console.error("  got:");
    console.error(got.split("\n").map(l => "    " + l).join("\n"));
    fail++;
  }
}
console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
