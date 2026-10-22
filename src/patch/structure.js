'use strict';
// Parse only; never execute vendor code. Dollar-prefixed identifiers in a
// pattern capture syntax nodes, with repeated captures required to agree.
const acorn = require('acorn');
const { isDeepStrictEqual } = require('node:util');

function parse(source, sourceType = 'module') {
  return acorn.parse(source, { ecmaVersion: 'latest', sourceType });
}
function children(node) {
  return Object.values(node).flatMap(value => Array.isArray(value) ? value.filter(item => item?.type)
    : value?.type ? [value] : []);
}
function nodes(root, predicate, skipFunctions = false) {
  const result = [];
  function visit(node) {
    if (predicate(node)) result.push(node);
    if (skipFunctions && node !== root && /Function|ArrowFunction/.test(node.type)) return;
    for (const child of children(node)) visit(child);
  }
  visit(root);
  return result;
}
function shape(node) {
  if (Array.isArray(node)) return node.map(shape);
  if (!node || typeof node !== 'object') return node;
  // Minifiers can choose quotes or a substitution-free template literal.
  if (node.type === 'TemplateLiteral' && node.expressions.length === 0) {
    return { type: 'Literal', value: node.quasis[0].value.cooked };
  }
  return Object.fromEntries(Object.entries(node).filter(([key]) => !['start', 'end', 'raw'].includes(key))
    .map(([key, value]) => [key, shape(value)]));
}
function match(pattern, actual, captures = {}) {
  function compare(a, b) {
    if (a?.type === 'Identifier' && a.name.startsWith('$')) {
      if (!b?.type) return false;
      if (captures[a.name] && !isDeepStrictEqual(shape(captures[a.name]), shape(b))) return false;
      captures[a.name] ??= b;
      return true;
    }
    if (Array.isArray(a)) return Array.isArray(b) && a.length === b.length && a.every((item, index) => compare(item, b[index]));
    if (!a || typeof a !== 'object') return a === b;
    if (!b || typeof b !== 'object') return false;
    if (a.type === 'Literal' && b.type === 'TemplateLiteral' && b.expressions.length === 0) return a.value === b.quasis[0].value.cooked;
    if (b.type === 'Literal' && a.type === 'TemplateLiteral' && a.expressions.length === 0) return b.value === a.quasis[0].value.cooked;
    const keys = value => Object.keys(value).filter(key => !['start', 'end', 'raw'].includes(key));
    return keys(a).length === keys(b).length && keys(a).every(key => compare(a[key], b[key]));
  }
  return compare(pattern, actual) ? captures : null;
}
function expression(source) { return parse(`(${source})`).body[0].expression; }
function statement(source) { return parse(`function pattern(){${source}}`).body[0].body.body[0]; }
function matches(root, pattern, skipFunctions = false) {
  return nodes(root, node => node.type === pattern.type, skipFunctions)
    .flatMap(node => { const captures = match(pattern, node); return captures ? [{ node, captures }] : []; });
}
function one(values, label) {
  if (values.length !== 1) throw new Error(`Unrecognized Codex structure: ${label} (expected 1, found ${values.length})`);
  return values[0];
}
function identifier(node) {
  if (node?.type !== 'Identifier') throw new Error('Unrecognized Codex structure: expected identifier');
  return node.name;
}
function edit(source, root, edits) {
  let result = source.slice(root.start, root.end), last = root.end;
  for (const change of [...edits].sort((a, b) => b.start - a.start)) {
    if (change.start < root.start || change.end > last || change.start > change.end) throw new Error('Overlapping structural edits');
    result = result.slice(0, change.start - root.start) + change.text + result.slice(change.end - root.start);
    last = change.start;
  }
  return result;
}
module.exports = { parse, nodes, match, matches, expression, statement, one, identifier, edit };
