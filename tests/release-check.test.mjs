// SPDX-License-Identifier: Apache-2.0
// node --test tests/*.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gitState, releaseProblems } from "../tools/release-check.mjs";

const HEAD = "a".repeat(40);

test("a release build may start only from a clean tree at the commit the tag names", () => {
  assert.deepEqual(releaseProblems({ status: "", head: HEAD, tagCommit: HEAD }, "1.0.2"), []);
  assert.match(releaseProblems({ status: " M src/main.ts\n?? notes.txt", head: HEAD, tagCommit: HEAD }, "1.0.2")[0], /not committed \(src\/main\.ts, notes\.txt\)/);
  assert.match(releaseProblems({ status: "", head: HEAD, tagCommit: null }, "1.0.2")[0], /no tag v1\.0\.2/);
  assert.match(releaseProblems({ status: "", head: HEAD, tagCommit: "b".repeat(40) }, "1.0.2")[0], /is at bbbbbbb, not at the commit checked out \(aaaaaaa\)/);
  assert.equal(releaseProblems({ status: " M a", head: HEAD, tagCommit: null }, "1.0.2").length, 2);
  assert.match(releaseProblems({ status: null, head: null, tagCommit: null }, "1.0.2")[0], /git could not read/);
});

test("the check reads a real repository the same way", (t) => {
  const repo = mkdtempSync(join(tmpdir(), "hub-release-check-"));
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  const git = (...args) => {
    const done = spawnSync("git", ["-c", "user.name=test", "-c", "user.email=test@example.invalid", "-c", "commit.gpgsign=false", "-c", "tag.gpgsign=false", ...args], { cwd: repo, encoding: "utf8" });
    assert.equal(done.status, 0, done.stderr);
  };
  git("init", "-q");
  writeFileSync(join(repo, "a.txt"), "one\n");
  git("add", ".");
  git("commit", "-q", "-m", "one");
  assert.match(releaseProblems(gitState(repo, "9.9.9"), "9.9.9").join(" "), /no tag v9\.9\.9/);
  git("tag", "v9.9.9");
  assert.deepEqual(releaseProblems(gitState(repo, "9.9.9"), "9.9.9"), []);
  writeFileSync(join(repo, "a.txt"), "two\n");
  assert.match(releaseProblems(gitState(repo, "9.9.9"), "9.9.9").join(" "), /not committed \(a\.txt\)/);
  git("commit", "-q", "-am", "two");
  assert.match(releaseProblems(gitState(repo, "9.9.9"), "9.9.9").join(" "), /tag v9\.9\.9 is at/);
});
