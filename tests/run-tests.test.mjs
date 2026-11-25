// SPDX-License-Identifier: Apache-2.0
// node --test tests/*.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { testsProblem } from "../tools/run-tests.mjs";

test("the build goes on only when there are tests and all of them pass", (t) => {
  const folder = mkdtempSync(join(tmpdir(), "hub-run-tests-"));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const write = (name, ok) => writeFileSync(join(folder, name), `import { test } from "node:test";\nimport assert from "node:assert";\ntest("${name}", () => assert.ok(${ok}));\n`);
  write("notes.mjs", false); // not a test file
  assert.match(testsProblem(folder), /there are no tests/);
  write("good.test.mjs", true);
  assert.equal(testsProblem(folder), null);
  write("bad.test.mjs", false);
  assert.match(testsProblem(folder), /the tests do not pass:[^]*bad\.test\.mjs/);
});
