/**
 * Flags unsupported-sounding claim language in the project's public-facing
 * text (README, docs, and the browser UI's own copy) — words like "proves",
 * "guarantees", "state-of-the-art", "understands", "benchmark",
 * "production-ready" used WITHOUT a nearby hedge/negation ("not", "never",
 * "no ", "cannot", "isn't", "does not", "NOT CLAIMED").
 *
 * This is a heuristic line-scanner, not a language model — it will produce
 * some noise on legitimate hedged sentences that happen to be long. It is
 * meant to be read by a person deciding whether a flagged line is fine
 * (usually: it already says "not a benchmark") or a real problem, not to
 * gate CI automatically.
 *
 * Usage: node scripts/claim-audit.mjs
 */
import { readFile, readdir } from 'node:fs/promises';
import { join, extname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const BANNED_TERMS = [
  'always', 'proves', 'guarantees', 'guaranteed', 'state-of-the-art', 'human-like',
  'understands', 'general reasoning', 'benchmark', 'production-ready', 'production ready',
];
const HEDGE_PATTERN = /\b(not|never|no |cannot|can't|isn't|doesn't|does not|without|not claim|NOT CLAIMED)\b/i;
const SCAN_TARGETS = [
  { dir: '.', files: ['README.md'] },
  { dir: 'docs', extensions: ['.md'] },
  { dir: 'public', extensions: ['.html', '.js'] },
];

async function collectFiles(root) {
  const files = [];
  for (const target of SCAN_TARGETS) {
    const dirPath = join(root, target.dir);
    if (target.files) {
      for (const file of target.files) files.push(join(dirPath, file));
      continue;
    }
    let entries;
    try { entries = await readdir(dirPath); } catch { continue; }
    for (const entry of entries) {
      if (target.extensions.includes(extname(entry))) files.push(join(dirPath, entry));
    }
  }
  return files;
}

async function main() {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const files = await collectFiles(root);
  const findings = [];

  for (const filePath of files) {
    let content;
    try { content = await readFile(filePath, 'utf8'); } catch { continue; }
    const lines = content.split('\n');
    lines.forEach((line, index) => {
      const lower = line.toLowerCase();
      for (const term of BANNED_TERMS) {
        if (!lower.includes(term)) continue;
        if (HEDGE_PATTERN.test(line)) continue; // hedged/negated nearby — not flagged
        findings.push({ file: relative(root, filePath), line: index + 1, term, text: line.trim().slice(0, 160) });
      }
    });
  }

  if (findings.length === 0) {
    console.log('claim-audit: no unhedged instances of banned claim language found.');
    return;
  }

  console.log(`claim-audit: ${findings.length} line(s) worth a human look (term present without a nearby hedge/negation):\n`);
  for (const finding of findings) {
    console.log(`  ${finding.file}:${finding.line}  [${finding.term}]`);
    console.log(`    ${finding.text}`);
  }
  console.log('\nThis is informational, not a build gate — review each line and confirm the surrounding context is actually hedged.');
}

main();
