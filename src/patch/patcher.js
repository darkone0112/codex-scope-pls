'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { sha256, transform, count } = require('./integrity');
const { readRegular, readBackup, ensureBackup } = require('./backup');

async function inspect(target, definition) {
  const current = await readRegular(target);
  const hash = sha256(current);
  const original = hash === definition.originalHash ? current : await readBackup(target, definition);
  const patched = transform(original, definition);
  const isCurrentPatch = current.equals(patched);
  const isPreviousPatch = (definition.previousPatchedHashes || []).includes(hash);
  if (!current.equals(original) && !isCurrentPatch && !isPreviousPatch) throw new Error('Unknown or partially patched bundle');
  const isPatched = !current.equals(original);
  return { current, original, patched, hash, isPatched, isCurrentPatch, isPreviousPatch,
    points: definition.points.map(p => ({ name: p.name, matches: count(current.toString('utf8'), isPatched ? p.after : p.before) })) };
}

async function replaceAtomically(target, expected, content) {
  const stat = await fs.lstat(target);
  const temp = `${target}.codex-scope-pls.${randomUUID()}.tmp`;
  let created = false;
  try {
    const handle = await fs.open(temp, 'wx', stat.mode & 0o777);
    created = true;
    try { await handle.writeFile(content); await handle.sync(); }
    finally { await handle.close(); }
    if (!(await readRegular(temp)).equals(content)) throw new Error('Temporary file validation failed');
    if (!(await readRegular(target)).equals(expected)) throw new Error('Target changed during operation');
    await fs.rename(temp, target);
    created = false;
    // Windows does not support opening a directory handle for fsync. Rename is
    // still the strongest replacement Node exposes there; POSIX gets fsync.
    if (process.platform !== 'win32') {
      const directory = await fs.open(path.dirname(target), 'r');
      try { await directory.sync(); } finally { await directory.close(); }
    }
  } finally {
    if (created) await fs.unlink(temp);
  }
}

async function change(target, definition, action) {
  if (!['apply', 'restore'].includes(action)) throw new Error('Invalid patch operation');
  const lock = `${target}.codex-scope-pls.lock`;
  const handle = await fs.open(lock, 'wx', 0o600);
  try {
    const state = await inspect(target, definition);
    if (action === 'apply') {
      await ensureBackup(target, definition, state.original);
      if (!state.isCurrentPatch) await replaceAtomically(target, state.current, state.patched);
    } else if (state.isPatched) {
      await readBackup(target, definition);
      await replaceAtomically(target, state.current, state.original);
    }
    return { changed: action === 'apply' ? !state.isCurrentPatch : state.isPatched,
      isPatched: action === 'apply', originalHash: definition.originalHash, points: state.points };
  } finally {
    await handle.close();
    await fs.unlink(lock);
  }
}
module.exports = { inspect, change };
