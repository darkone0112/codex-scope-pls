'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { readRegular } = require('./backup');
const { assetPath } = require('./moduleGraph');

function receiptPath(host) { return `${host}.codex-scope-pls.installation.json`; }
function validate(receipt, version) {
  const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
  if (![1, 2].includes(receipt?.schema) || typeof version !== 'string' || !/^\d[0-9A-Za-z.-]{0,127}$/.test(version) ||
    receipt.version !== version || !Array.isArray(receipt.targets) || receipt.targets.length < 2 || receipt.targets.length > 4 ||
    receipt.targets.some(target => !target || typeof target !== 'object' || Array.isArray(target))) {
    throw new Error('Invalid installation receipt');
  }
  const paths = receipt.targets.map(target => target.relativePath);
  const legacyPaths = receipt.schema !== 1 || receipt.targets.length === 3 &&
    /^webview\/assets\/app-initial-[a-f0-9]+\.js$/.test(paths[1]) && /^webview\/assets\/header-[a-f0-9]+\.js$/.test(paths[2]);
  if (paths[0] !== 'out/extension.js' || !paths.slice(1).every(assetPath) || !legacyPaths || new Set(paths).size !== paths.length ||
    receipt.targets.some(target => !hash(target.originalHash) || !Array.isArray(target.patchedHashes) ||
      target.patchedHashes.length < 1 || target.patchedHashes.length > 16 || !target.patchedHashes.every(hash))) {
    throw new Error('Invalid installation receipt targets');
  }
  if (receipt.schema === 2) {
    const roles = receipt.targets.flatMap(target => Array.isArray(target.roles) ? target.roles : []);
    if (receipt.targets.some(target => !Array.isArray(target.roles) || target.roles.length === 0) ||
      receipt.targets[0].roles.length !== 1 || receipt.targets[0].roles[0] !== 'host' || roles.length !== 4 ||
      ['host', 'notifications', 'rows', 'history'].some(role => roles.filter(value => value === role).length !== 1)) {
      throw new Error('Invalid installation receipt roles');
    }
  }
  return receipt;
}
async function readReceipt(host, version) {
  let bytes;
  try { bytes = await readRegular(receiptPath(host)); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  if (bytes.length > 8192) throw new Error('Installation receipt exceeds size limit');
  let value;
  try { value = JSON.parse(bytes.toString('utf8')); }
  catch { throw new Error('Malformed installation receipt'); }
  return { value: validate(value, version), bytes };
}
async function saveReceipt(host, receipt) {
  validate(receipt.value, receipt.value.version);
  const target = receiptPath(host);
  const content = Buffer.from(`${JSON.stringify(receipt.value, null, 2)}\n`);
  let current;
  try { current = await readRegular(target); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (current?.equals(content)) return;
  if (current ? !receipt.previous?.equals(current) : receipt.previous != null) throw new Error('Installation receipt changed during operation');
  const temp = `${target}.${randomUUID()}.tmp`;
  const handle = await fs.open(temp, 'wx', 0o600);
  try {
    try { await handle.writeFile(content); await handle.sync(); }
    finally { await handle.close(); }
    if (!(await readRegular(temp)).equals(content)) throw new Error('Installation receipt write failed');
    if (current) {
      if (!(await readRegular(target)).equals(current)) throw new Error('Installation receipt changed during operation');
      await fs.rename(temp, target);
    } else {
      // link creates the receipt atomically without overwriting a racing writer.
      await fs.link(temp, target);
      await fs.unlink(temp);
    }
    if (process.platform !== 'win32') {
      const directory = await fs.open(path.dirname(target), 'r');
      try { await directory.sync(); } finally { await directory.close(); }
    }
  } finally {
    await fs.unlink(temp).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}
module.exports = { receiptPath, readReceipt, saveReceipt, validate };
