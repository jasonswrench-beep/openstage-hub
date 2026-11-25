// SPDX-License-Identifier: Apache-2.0
// Runs the tests `npm test` runs, for tools/build-installer.mjs: an installer is not built from code whose tests fail.
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";

/** Why the tests in `folder` (every *.test.mjs directly in it) do not pass, in plain words; null when they all do. */
export function testsProblem(folder) {
  const files = readdirSync(folder).filter((n) => n.endsWith(".test.mjs")).sort().map((n) => join(folder, n));
  if (files.length === 0) return `there are no tests in ${folder}.`;
  const env = { ...process.env };
  // Settings that can make Node run fewer tests than there are, or none.
  delete env.NODE_OPTIONS;
  delete env.NODE_TEST_CONTEXT;
  const done = spawnSync(process.execPath, ["--test", "--test-reporter=spec", ...files], { env, encoding: "utf8" });
  if (done.status === 0) return null;
  const said = `${done.stdout ?? ""}${done.stderr ?? ""}${done.error ? done.error.message : ""}`.trim();
  return `the tests do not pass:\n${said}`;
}
