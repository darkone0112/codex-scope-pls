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

async function changeAll(targets, action) {
  if (!['apply', 'restore'].includes(action)) throw new Error('Invalid patch operation');
  if (!targets.length || new Set(targets.map(item => item.target)).size !== targets.length) {
    throw new Error('Invalid patch targets');
  }
  const locks = [];
  const replaced = [];
  try {
    // Hold every target lock until the complete operation ends. The host target
    // is always first, so separate windows acquire these in the same order.
    for (const { target } of targets) {
      const lock = `${target}.codex-scope-pls.lock`;
      const handle = await fs.open(lock, 'wx', 0o600);
      locks.push({ lock, handle });
    }
    const prepared = [];
    for (const { target, definition } of targets) {
      prepared.push({ target, definition, state: await inspect(target, definition) });
    }
    // No target changes until every input and necessary backup is verified.
    for (const { target, definition, state } of prepared) {
      if (action === 'apply' && !state.patched.equals(state.original)) {
        await ensureBackup(target, definition, state.original);
      }
      else if (state.isPatched) await readBackup(target, definition);
    }
    for (const { target, state } of prepared) {
      if (!(await readRegular(target)).equals(state.current)) throw new Error('Target changed during operation');
    }
    // Upgrade replaces known prior revisions, including the retired submission
    // asset, before applying display points. Restore reverses target order.
    const order = action === 'apply' ? prepared : [...prepared].reverse();
    for (const item of order) {
      const content = action === 'apply' ? item.state.patched : item.state.original;
      if (!content.equals(item.state.current)) {
        // Record before replacement: rename may succeed before directory fsync fails.
        replaced.push({ ...item, content });
        await replaceAtomically(item.target, item.state.current, content);
      }
    }
    return prepared.map(({ definition, state }) => ({
      changed: action === 'apply' ? !state.patched.equals(state.current) : state.isPatched,
      isPatched: action === 'apply' ? !state.patched.equals(state.original) : false,
      originalHash: definition.originalHash, points: state.points
    }));
  } catch (error) {
    for (const { target, state, content } of replaced.reverse()) {
      const current = await readRegular(target);
      if (current.equals(state.current)) continue;
      if (!current.equals(content)) throw new Error('Patch failed; target changed before rollback');
      try { await replaceAtomically(target, content, state.current); }
      catch { throw new Error('Patch failed; rollback could not restore all targets'); }
    }
    throw error;
  } finally {
    for (const { lock, handle } of locks.reverse()) {
      try { await handle.close(); } finally { await fs.unlink(lock); }
    }
  }
}
async function change(target, definition, action) {
  return (await changeAll([{ target, definition }], action))[0];
}
module.exports = { inspect, change, changeAll };
