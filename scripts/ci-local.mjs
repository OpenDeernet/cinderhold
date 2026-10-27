#!/usr/bin/env node
// Runs the CI pipeline on this machine and reports the result to GitHub as a
// commit status ("ci/local"), so commits get a check mark without using
// GitHub-hosted Actions minutes.
//
//   npm run ci:report
//
// Needs a token with repo access in GITHUB_TOKEN, or a GitHub credential that
// `git credential fill` can return. Refuses to report on a dirty tree, since
// the result would not describe the commit.

import { execSync, spawnSync } from 'node:child_process';

const sh = (cmd) => execSync(cmd, { encoding: 'utf8' }).trim();

if (sh('git status --porcelain')) {
  console.error('ci-local: working tree has uncommitted changes; commit or stash first.');
  process.exit(2);
}

const sha = sh('git rev-parse HEAD');
const remote = sh('git remote get-url origin');
const m = remote.match(/github\.com[:/]([^/]+)\/(.+?)(\.git)?$/);
if (!m) {
  console.error(`ci-local: origin is not a GitHub remote: ${remote}`);
  process.exit(2);
}
const [, owner, repo] = m;

function token() {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  const out = spawnSync('git', ['credential', 'fill'], {
    input: `protocol=https\nhost=github.com\nusername=${owner}\n\n`,
    encoding: 'utf8',
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  });
  return out.stdout.match(/^password=(.*)$/m)?.[1] || null;
}

const auth = token();
if (!auth) {
  console.error('ci-local: no GitHub token (set GITHUB_TOKEN).');
  process.exit(2);
}

async function report(state, description) {
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/statuses/${sha}`, {
    method: 'POST',
    headers: { Authorization: `token ${auth}`, Accept: 'application/vnd.github+json' },
    body: JSON.stringify({ state, context: 'ci/local', description }),
  });
  if (!res.ok) console.error(`ci-local: GitHub answered ${res.status}: ${await res.text()}`);
}

console.log(`ci-local: ${owner}/${repo} @ ${sha.slice(0, 7)}`);
await report('pending', 'lint, tests, build and playthrough running');
const started = Date.now();
const run = spawnSync('npm', ['run', 'ci'], { stdio: 'inherit' });
const secs = Math.round((Date.now() - started) / 1000);
const ok = run.status === 0;
await report(ok ? 'success' : 'failure', ok ? `all checks passed in ${secs}s` : `failed after ${secs}s`);
console.log(`ci-local: ${ok ? 'passed' : 'FAILED'}, reported to GitHub`);
process.exit(ok ? 0 : 1);
