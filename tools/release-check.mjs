// SPDX-License-Identifier: Apache-2.0
// Checks that a release build starts from exactly one committed, tagged state of this repository:
// nothing uncommitted or untracked, and HEAD is the commit the tag v<release> names.
// tools/build-installer.mjs runs it before a signed build and again after it (a build must not change a tracked file).
import { spawnSync } from "node:child_process";

/** Reads what the check needs from git, in the folder `repo`. */
export function gitState(repo, release) {
  const git = (...args) => {
    const done = spawnSync("git", args, { cwd: repo, encoding: "utf8" });
    return done.status === 0 ? done.stdout.trimEnd() : null; // not trim(): a status line can start with a space
  };
  return {
    status: git("status", "--porcelain"),
    head: git("rev-parse", "HEAD"),
    tagCommit: git("rev-parse", "-q", "--verify", `refs/tags/v${release}^{commit}`),
  };
}

/** The reasons a release build may not start from this state, in plain words; an empty list means it may. */
export function releaseProblems({ status, head, tagCommit }, release) {
  const tag = `v${release}`;
  if (status === null || head === null) return ["git could not read this repository, so the build cannot show which commit it came from."];
  const problems = [];
  if (status !== "") {
    const files = status.split(/\r?\n/).map((line) => line.slice(3));
    const shown = files.slice(0, 10).join(", ") + (files.length > 10 ? ` and ${files.length - 10} more` : "");
    problems.push(`there are changes not committed (${shown}). Commit everything first.`);
  }
  if (!tagCommit) problems.push(`there is no tag ${tag}. Tag the commit to be built: git tag ${tag}`);
  else if (tagCommit !== head) {
    problems.push(`the tag ${tag} is at ${tagCommit.slice(0, 7)}, not at the commit checked out (${head.slice(0, 7)}). Check out the tagged commit, or move the tag if no release uses it yet.`);
  }
  return problems;
}
