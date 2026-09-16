'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { sha256 } = require('./integrity');
function backupPath(target, definition) {
  if (typeof definition.version !== 'string' || !/^\d[0-9A-Za-z.-]{0,127}$/.test(definition.version) || !/^[a-f0-9]{64}$/.test(definition.originalHash)) {
    throw new Error('Invalid backup identity');
  }
  return `${target}.codex-scope-pls.${definition.version}.${definition.originalHash}.original`;
}
async function readRegular(file) {
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw new Error('Refusing non-regular or linked file');
  return fs.readFile(file);
}
async function readBackup(target, definition) {
  const bytes = await readRegular(backupPath(target, definition));
  if (sha256(bytes) !== definition.originalHash) throw new Error('Backup SHA-256 mismatch');
  return bytes;
}
async function ensureBackup(target, definition, original) {
  const file = backupPath(target, definition);
  let handle;
  try { handle = await fs.open(file, 'wx', 0o600); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  if (handle) {
    try { await handle.writeFile(original); await handle.sync(); }
    finally { await handle.close(); }
  }
  // Existing backups are never overwritten, even if incomplete from a crash.
  await readBackup(target, definition);
  if (process.platform !== 'win32') {
    const directory = await fs.open(path.dirname(file), 'r');
    try { await directory.sync(); } finally { await directory.close(); }
  }
}
module.exports = { backupPath, readRegular, readBackup, ensureBackup };
