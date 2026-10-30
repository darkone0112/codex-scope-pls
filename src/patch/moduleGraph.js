'use strict';
const path = require('node:path');
const { parse, nodes } = require('./structure');

// The inspected modular build contains ~17,600 JS chunks (~516 MiB), including
// translations. Bound cumulative reads, but retain only role candidates.
const MAX_MODULES = 20000;
const MAX_MODULE_BYTES = 25 * 1024 * 1024;
const MAX_GRAPH_BYTES = 768 * 1024 * 1024;

function assetPath(value) {
  return typeof value === 'string' && /^webview\/assets\/(?:[A-Za-z0-9_-][A-Za-z0-9._-]*\/)*[A-Za-z0-9_-][A-Za-z0-9._-]*\.m?js$/.test(value);
}
function localModule(from, specifier) {
  if (!specifier.startsWith('./') && !specifier.startsWith('../') || /[\\%?#:\0]/.test(specifier)) {
    throw new Error('Unsupported non-local webview module reference');
  }
  const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(from), specifier));
  if (!assetPath(resolved)) throw new Error('Webview module reference escapes the asset directory');
  return resolved;
}
function stringValue(node) {
  if (node?.type === 'Literal' && typeof node.value === 'string') return node.value;
  if (node?.type === 'TemplateLiteral' && node.expressions.length === 0) return node.quasis[0].value.cooked;
  return null;
}
function entryModules(html) {
  if (Buffer.byteLength(html) > 1024 * 1024) throw new Error('Webview HTML exceeds size limit');
  const content = html.replace(/<!--[\s\S]*?-->/g, '');
  if (/<base\b/i.test(content)) throw new Error('Unsupported webview base URL');
  const entries = [];
  for (const tag of content.match(/<script\b[^>]*>/gi) || []) {
    const attributes = new Map();
    for (const match of tag.matchAll(/\s(type|src)\s*=\s*(["'])(.*?)\2/gi)) {
      const key = match[1].toLowerCase();
      if (attributes.has(key)) throw new Error('Ambiguous webview script attributes');
      attributes.set(key, match[3]);
    }
    if (attributes.get('type') !== 'module') continue;
    if (!attributes.get('src')) throw new Error('Unsupported inline webview module');
    entries.push(localModule('webview/index.html', attributes.get('src')));
  }
  if (entries.length < 1 || entries.length > 8) throw new Error('Expected bounded external webview entry modules');
  return [...new Set(entries)];
}
function imports(source) {
  const tree = parse(source);
  const result = [];
  for (const node of nodes(tree, item => ['ImportDeclaration', 'ImportExpression', 'ExportNamedDeclaration', 'ExportAllDeclaration'].includes(item.type))) {
    if (!node.source) continue;
    const value = stringValue(node.source);
    // Computed runtime imports are not guessed or executed. If a required role
    // is reachable only through one, its absence fails recognition below.
    if (value == null && node.type === 'ImportExpression') continue;
    if (value == null) throw new Error('Unsupported webview import');
    if (/\.m?js$/.test(value)) result.push({ specifier: value, lazy: node.type === 'ImportExpression' });
    else if (!value.startsWith('.') || !/\.(css|svg|png|jpg|webp|woff2?)$/.test(value)) {
      throw new Error('Unsupported webview import type');
    }
  }
  return result;
}
// The reader is either a checked installed-file reader or a VSIX-entry reader.
// Both traverse the identical graph; no directory-wide filename guessing.
async function discoverModules(read, complete, retain = () => true) {
  const html = await read('webview/index.html');
  let queue = entryModules(html.toString('utf8'));
  const seen = new Set(), assets = [];
  let total = 0;
  while (queue.length) {
    const nextLayer = new Set();
    for (let index = 0; index < queue.length; index++) {
      const relativePath = queue[index];
      if (seen.has(relativePath)) continue;
      seen.add(relativePath);
      if (seen.size > MAX_MODULES) throw new Error('Webview import graph exceeds module limit');
      const bytes = await read(relativePath);
      total += bytes.length;
      if (bytes.length > MAX_MODULE_BYTES || total > MAX_GRAPH_BYTES) throw new Error('Webview import graph exceeds size limit');
      const source = bytes.toString('utf8');
      if (!Buffer.from(source).equals(bytes)) throw new Error('Webview module is not UTF-8');
      if (retain(bytes)) assets.push({ relativePath, bytes });
      for (const { specifier } of imports(source)) {
        const next = localModule(relativePath, specifier);
        if (!seen.has(next)) nextLayer.add(next);
      }
    }
    // Finish each import-distance layer before selecting roles. A tie at that
    // distance is ambiguous. Once all roles are verified, do not traverse more
    // distant optional routes/locales. This is bounded startup discovery, not a
    // claim to classify every module in the vendor's application.
    if (complete(assets)) return assets;
    queue = [...nextLayer].filter(file => !seen.has(file));
  }
  return assets;
}
module.exports = { discoverModules, assetPath, entryModules, imports };
