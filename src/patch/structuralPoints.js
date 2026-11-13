'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { parse, nodes, match, matches, expression: expr, statement: stmt, one, identifier: id, edit } = require('./structure');
const { sha256, transform } = require('./integrity');

function helper(file) {
  return fs.readFileSync(path.join(__dirname, '..', file), 'utf8').replace(/\nmodule\.exports = [^\n]+;\n$/, '\n');
}
const scopeSource = helper('viewScope.js');
const visibleSource = helper('viewVisibility.js');
const historySource = visibleSource + helper('historyPresentation.js') + helper('historyGroups.js');
const scopeName = 'codexScopePlsScope';
function text(source, node) { return source.slice(node.start, node.end); }
function insertion(start, value) { return { start, end: start, text: value }; }
function replacement(node, value) { return { start: node.start, end: node.end, text: value }; }
function point(source, node, name, edits, prefix = '') {
  // Injected helpers use these globals. Never let a renamed vendor binding
  // silently shadow them at the insertion site.
  const reserved = new Set(['document', 'window', 'require', 'process', 'JSON', 'Map', 'Set']);
  const bindings = nodes(node, child => child.type === 'VariableDeclarator' || /Function/.test(child.type) || child.type === 'CatchClause');
  const patterns = bindings.flatMap(binding => binding.type === 'VariableDeclarator' ? [binding.id]
    : binding.type === 'CatchClause' ? [binding.param] : [binding.id, ...(binding.params || [])]).filter(Boolean);
  if (patterns.some(pattern => nodes(pattern, child => child.type === 'Identifier' && reserved.has(child.name)).length)) {
    throw new Error('Unrecognized Codex structure: helper global is shadowed');
  }
  return { name, before: text(source, node), after: prefix + edit(source, node, edits) };
}
function sourceTree(bytes) {
  const source = bytes.toString('utf8');
  if (!Buffer.from(source).equals(bytes) || /codexScopePls|codex-scope-pls/.test(source)) {
    throw new Error('Unknown, conflicting or partially patched Codex target');
  }
  return { source, tree: parse(source) };
}
function definition(bytes, points) {
  const result = { originalHash: sha256(bytes), points, previousPatchedHashes: [] };
  const patched = transform(bytes, result);
  parse(patched.toString('utf8'));
  result.currentPatchedHashes = [sha256(patched)];
  return result;
}
function functionWithProps(tree, props, accept = () => true) {
  return one(nodes(tree, node => node.type === 'FunctionDeclaration' && node.params.length === 1 &&
    nodes(node.body, child => child.type === 'VariableDeclarator' && child.id.type === 'ObjectPattern' &&
      props.every(name => child.id.properties.some(property => property.key?.name === name)), true).length === 1 && accept(node)), props.join('/'));
}
function propertyBinding(fn, name) {
  return id(one(nodes(fn.body, node => node.type === 'Property' && node.key.name === name && node.value.type === 'Identifier', true), name).value);
}
function cacheInfo(fn) {
  const { captures } = one(matches(fn.body, stmt('let $cache=(0,$runtime.c)($size);').declarations[0], true), 'component cache');
  if (!Number.isInteger(captures.$size.value) || captures.$size.value < 1) throw new Error('Invalid component cache size');
  const cache = id(captures.$cache);
  const accesses = nodes(fn.body, node => node.type === 'MemberExpression' && node.object.name === cache && node.computed, true);
  if (accesses.some(node => !Number.isInteger(node.property.value) || node.property.value < 0 || node.property.value >= captures.$size.value)) {
    throw new Error('Unrecognized component cache access');
  }
  return { cache, size: captures.$size, next: captures.$size.value };
}
function reactNamespace(fn) {
  const call = one(matches(fn.body, expr('(0,$react.useState)($initial)'), true), 'React state hook');
  return id(call.captures.$react);
}
function subscription(fn, react) {
  return insertion(fn.body.start + 1, `\n${historySource}\nconst ${scopeName}=codexScopePlsUseViewScope(${react},document,window);\n`);
}

function hostDefinition(bytes) {
  const { source, tree } = sourceTree(bytes);
  const method = name => one(nodes(tree, node => node.type === 'MethodDefinition' && node.key.name === name &&
    !node.static && !node.computed && node.kind === 'method'), name);
  const meta = method('webviewMetaTags');
  const metaPattern = stmt('let $tags=[],$panel=this.findPanelByWebview($view);');
  const metaMatch = match(metaPattern, meta.value.body.body[0]);
  if (!metaMatch || meta.value.async || meta.value.params.length !== 1 || id(meta.value.params[0]) !== id(metaMatch.$view)) throw new Error('Unrecognized webview metadata structure');
  // Own HTML escaping removes the dependency on a vendor minified helper.
  const tag = '`<meta name="codex-scope-pls-view" content="${JSON.stringify(codexScopePlsViewScope(require("vscode"))).replace(/[&<>\"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",\'"\':"&quot;"})[c])}">`';
  const points = [point(source, meta, 'workspace metadata', [
    insertion(meta.value.body.start + 1, `\n${scopeSource}\n`),
    replacement(meta.value.body.body[0].declarations[0].init, `[${tag}]`)
  ])];
  const nativePattern = parse('class Host{async provideChatSessionItems($request,$token){return(await this.requestThreadList($request)).data.map($row=>{let $summary=this.toThreadListSummary($row);return{summary:$summary,item:this.toChatSessionItem($summary)}})}}').body[0].body.body[0];
  const native = one(matches(tree, nativePattern), 'native session display structure').node;
  const data = native.value.body.body[0].argument.callee.object;
  points.push(point(source, native, 'native session display', [
    insertion(native.value.body.start + 1, `\n${scopeSource}${visibleSource}\nconst ${scopeName}=codexScopePlsViewScope(require("vscode"));\n`),
    replacement(data, `${text(source, data)}.filter(codexScopePlsRow=>codexScopePlsVisible({kind:"local"},codexScopePlsRow,${scopeName}))`)
  ]));
  const initialize = method('initializeWebview');
  const params = initialize.value.params;
  const initPattern = stmt('let $root=$vscode.Uri.joinPath(this.extensionUri,"webview");');
  if (!initialize.value.async || params.length !== 4 || !match(initPattern, initialize.value.body.body[0])) throw new Error('Unrecognized webview initialization structure');
  points.push(point(source, initialize, 'live preferences', [insertion(initialize.value.body.start + 1,
    `\n${scopeSource}${helper('viewUpdates.js')}\nconst codexScopePlsUpdates=codexScopePlsSubscribeView(require("vscode"),${id(params[0])},${id(params[2])});this.subscriptions.push(codexScopePlsUpdates,codexScopePlsUpdates.viewDisposal);\n`)]));
  return definition(bytes, points);
}

// The whole origin/chunk parser must agree, including acknowledgement order.
// Only identifier spelling and string quoting may vary.
const messagePattern = stmt('function $parse($event,$window){let $source=$event.source,$origin=$window.location.origin;if($event.origin!==$origin||$source===$window&&$origin!==``&&$origin!==$nullOrigin&&$event.origin!==$origin)return null;let $data=$event.data;if($chunk($data)){let $received=$receiver($window).receive($data);if($received.type!==`passthrough`&&$received.acknowledgement!=null&&$api.postMessage({type:`chunked-message-ack`,transferId:$received.acknowledgement.transferId,sequence:$received.acknowledgement.sequence}),$received.type===`pending`)return null;$data=$received.message}return typeof $data!=`object`||!$data||!$valid($data)?null:$data}');
const rowPattern = stmt('switch($entry.kind){case`remote`:{let $r;return $cache[$s0]!==$entry||$cache[$s1]!==$remote?($r=$remote($entry),$cache[$s0]=$entry,$cache[$s1]=$remote,$cache[$s2]=$r):$r=$cache[$s2],$r}case`local`:{let $l;return $cache[$s3]!==$entry||$cache[$s4]!==$local?($l=$local($entry),$cache[$s3]=$entry,$cache[$s4]=$local,$cache[$s5]=$l):$l=$cache[$s5],$l}}');
const localRowReturn = stmt('return $cache[$s0]!==$entry||$cache[$s1]!==$render?($result=$render($entry),$cache[$s0]=$entry,$cache[$s1]=$render,$cache[$s2]=$result):$result=$cache[$s2],$result;');
function notificationDefinition(bytes) {
  const { source, tree } = sourceTree(bytes);
  const message = one(matches(tree, messagePattern), 'origin and chunk parser');
  const last = message.node.body.body.at(-1);
  const points = [point(source, message.node, 'display preference notification', [insertion(last.start,
    `\n${visibleSource}${helper('viewNotification.js')}\nif(codexScopePlsAcceptViewScope(${id(message.captures.$data)},document,${id(message.captures.$window)}))return null;\n`)])];
  return definition(bytes, points);
}
function rowDefinition(bytes) {
  const { source, tree } = sourceTree(bytes);
  const switched = matches(tree, rowPattern);
  const local = nodes(tree, node => node.type === 'FunctionDeclaration').flatMap(fn => {
    const terminal = fn.body.body.at(-1), captures = match(localRowReturn, terminal);
    if (!captures) return [];
    const entry = id(captures.$entry);
    const props = nodes(fn.body, node => node.type === 'VariableDeclarator' && node.id.type === 'ObjectPattern' &&
      node.id.properties.some(property => property.key?.name === 'entry' && property.value.name === entry), true);
    if (props.length !== 1 || matches(fn.body, expr(`${entry}.conversationId`), true).length < 1 ||
      matches(fn.body, expr(`${entry}.summary??null`), true).length !== 1) return [];
    return [{ fn, terminal, captures }];
  });
  one([...switched, ...local], 'final row boundary');
  if (local.length) {
    const { fn, terminal, captures } = local[0], entry = id(captures.$entry);
    const cache = cacheInfo(fn);
    const slots = [captures.$s0, captures.$s1, captures.$s2].map(node => node.value);
    if (cache.cache !== id(captures.$cache) || !slots.every((slot, i) => Number.isInteger(slot) && slot === slots[0] + i) ||
      slots[0] < 0 || slots[2] >= cache.size.value) throw new Error('Invalid local row cache boundary');
    const fallback = one(matches(fn.body, expr(`${entry}.summary??null`), true), 'local row summary');
    const binding = one(nodes(fn.body, node => node.type === 'VariableDeclarator' && node.init === fallback.node, true), 'local summary binding');
    const resolved = one(matches(fn.body, expr(`$store($selector,$key)??${id(binding.id)}`), true), 'resolved local summary');
    const summary = one(nodes(fn.body, node => node.type === 'VariableDeclarator' && node.init === resolved.node, true), 'resolved local summary binding');
    if (summary.end >= terminal.start) throw new Error('Summary is unavailable at local row boundary');
    return definition(bytes, [point(source, fn, 'final local row display', [insertion(terminal.start,
      `\n${visibleSource}\nif(!codexScopePlsVisible({kind:"local",conversationId:${entry}.conversationId},${id(summary.id)},codexScopePlsReadViewScope(document)))return null;\n`)])]);
  }
  const row = switched[0];
  const entry = id(row.captures.$entry);
  const slots = Array.from({ length: 6 }, (_, index) => row.captures[`$s${index}`].value);
  if (!slots.every((value, index) => Number.isInteger(value) && value === slots[0] + index)) throw new Error('Unrecognized final row cache slots');
  const fn = one(nodes(tree, node => node.type === 'FunctionDeclaration' && node.body.body.at(-1) === row.node), 'final row component');
  const cache = cacheInfo(fn);
  if (cache.cache !== id(row.captures.$cache) || slots[0] < 0 || slots[5] >= cache.size.value) throw new Error('Final row cache is outside its allocation');
  const fallback = one(matches(fn.body, expr(`${entry}.kind===\`local\`?${entry}.summary??null:null`), true), 'row summary fallback');
  const declaration = one(nodes(fn.body, node => node.type === 'VariableDeclarator' && node.init === fallback.node, true), 'summary binding');
  const resolved = one(matches(fn.body, expr(`$store($selector,$key)??${id(declaration.id)}`), true), 'resolved row summary');
  const summary = one(nodes(fn.body, node => node.type === 'VariableDeclarator' && node.init === resolved.node, true), 'resolved summary binding');
  if (summary.end >= row.node.start) throw new Error('Summary is unavailable at row boundary');
  return definition(bytes, [point(source, fn, 'final row display', [insertion(row.node.start,
    `\n${visibleSource}\nif(!codexScopePlsVisible(${entry},${id(summary.id)},codexScopePlsReadViewScope(document)))return null;\n`)])]);
}
function combineDefinitions(bytes, definitions) {
  return definition(bytes, definitions.flatMap(item => item.points));
}
function appDefinition(bytes) {
  return combineDefinitions(bytes, [notificationDefinition(bytes), rowDefinition(bytes)]);
}

const mergedPatternSource = 'function $merge($tasks,$locals,$env){let $worktrees=$getWorktrees(),$pending=$atom($pendingAtom),$ids=(0,$react.useMemo)(()=>$locals.map($row=>$row.id),[$locals]),$clients=$select($clientAtom,$ids),$background=$getBackground(),$memo=(0,$react.useRef)(new Map);return(0,$react.useMemo)(()=>{let $entries=$reconcile($derive({tasks:$tasks,localConversations:$locals,pendingWorktrees:$worktrees,pendingThreadStarts:$pending,envForFilter:$env,threadSortKey:$sort,isBackgroundSubagentsEnabled:$background,clientThreadIdsByConversationId:$clients}),$memo.current);return $memo.current=new Map($entries.map($entry=>[$entry.key,$entry])),$entries},[$tasks,$env,$clients,$background,$locals,$worktrees,$pending])}';
const mergedPattern = stmt(mergedPatternSource);
const localMergedPattern = stmt('function $merge($locals){let $worktrees=$getWorktrees(),$pending=$atom($pendingAtom),$ids=(0,$react.useMemo)(()=>$locals.map($row=>$row.conversationId),[$locals]),$clients=$select($clientAtom,$ids),$background=$getBackground(),$memo=(0,$react.useRef)(new Map);return(0,$react.useMemo)(()=>{let $entries=$reconcile($derive({localConversations:$locals,pendingWorktrees:$worktrees,pendingThreadStarts:$pending,threadSortKey:$sort,isBackgroundSubagentsEnabled:$background,clientThreadIdsByConversationId:$clients}),$memo.current);return $memo.current=new Map($entries.map($entry=>[$entry.key,$entry])),$entries},[$clients,$background,$locals,$worktrees,$pending])}');

function cacheGuard(fn, node, cache, edits, source) {
  const branch = one(nodes(fn.body, candidate => candidate.type === 'ConditionalExpression' &&
    candidate.consequent.start <= node.start && candidate.consequent.end >= node.end &&
    match(expr(`$rendered=${cache.cache}[$slot]`), candidate.alternate) && candidate.consequent.type === 'SequenceExpression', true), 'render cache branch');
  const slot = cache.next++;
  edits.push(replacement(branch.test, `(${text(source, branch.test)})||${cache.cache}[${slot}]!==${scopeName}`));
  const rendered = id(branch.alternate.left);
  edits.push(insertion(branch.consequent.end, `,${cache.cache}[${slot}]=${scopeName},${rendered}`));
}

function headerDefinition(bytes) {
  const { source, tree } = sourceTree(bytes);
  const mergedVariants = ['id', 'conversationId'].flatMap(key =>
    matches(tree, key === 'id' ? mergedPattern : stmt(mergedPatternSource.replace('$row.id', '$row.conversationId')))
      .map(found => ({ ...found, conversationKey: key })));
  const local = matches(tree, localMergedPattern);
  if (local.length) {
    one([...mergedVariants, ...local], 'derived history hook');
    return localHeaderDefinition(bytes, source, tree, local[0]);
  }
  const merged = one(mergedVariants, 'derived history hook');
  const react = id(merged.captures.$react), mergeName = id(merged.captures.$merge);
  const memo = merged.node.body.body.at(-1).argument;
  const output = memo.arguments[0].body.body.at(-1).argument.expressions.at(-1);
  const dependencies = memo.arguments[1];
  const points = [point(source, merged.node, 'history before preview and counts', [
    subscription(merged.node, react),
    replacement(output, `codexScopePlsHistoryEntries(${text(source, output)},${scopeName})`),
    insertion(dependencies.end - 1, `,${scopeName}`)
  ])];
  const menu = functionWithProps(tree, ['cloudtasksQuery', 'localConversations', 'onClose', 'autoFocusSearch', 'showFilters']);
  const locals = propertyBinding(menu, 'localConversations'), cloud = propertyBinding(menu, 'cloudtasksQuery');
  const list = one(matches(menu.body, expr(`${mergeName}(${cloud}.data,${locals},$env)`), true), 'history menu source');
  const listDeclaration = one(nodes(menu.body, node => node.type === 'VariableDeclarator' && node.init === list.node, true), 'menu list binding');
  const declarationList = one(nodes(menu.body, node => node.type === 'VariableDeclaration' && node.declarations.includes(listDeclaration), true), 'menu list declaration');
  const localList = declarationList.declarations[declarationList.declarations.indexOf(listDeclaration) - 1];
  if (!localList || !match(expr(`${locals}.filter($predicate)`), localList.init)) throw new Error('Unrecognized local history source');
  const menuEdits = [subscription(menu, reactNamespace(menu)), replacement(localList.init,
    `codexScopePlsHistoryConversations(${locals},${scopeName}).filter(${text(source, localList.init.arguments[0])})`)];
  const cache = cacheInfo(menu);
  const key = merged.conversationKey;
  const recent = key === 'id'
    ? '$row.kind===`local`&&$active===($row.pendingThreadStart?.clientThreadId??$row.conversation?.id)'
    : '$row.kind===`remote`?$remoteActive===$row.task.id:$active===($row.pendingThreadStart?.clientThreadId??$row.conversation?.conversationId)';
  const maps = [
    expr(`$rows.map($row=>(0,$jsx.jsx)($component,{item:$row,isActive:${recent},onClose:$close,onActiveArchiveStart:$archive},$row.key))`),
    expr(`$rows.map($row=>(0,$jsx.jsx)($component,{conversationId:$row.${key},hostId:$row.hostId,updatedAt:$row.recencyAt??$row.updatedAt,isActive:$active===$row.${key},onClose:$close,onActiveArchiveStart:$archive},$row.${key}))`)
  ];
  for (const [index, pattern] of maps.entries()) {
    const found = one(matches(menu.body, pattern, true), 'history row map');
    menuEdits.push(replacement(found.node, `codexScopePlsGroupHistoryRows(${id(found.captures.$rows)},${text(source, found.node)},${id(found.captures.$jsx)},${scopeName})`));
    if (index === 0) cacheGuard(menu, found.node, cache, menuEdits, source);
  }
  menuEdits.push(replacement(cache.size, String(cache.next)));
  points.push(point(source, menu, 'history menu and grouping', menuEdits));

  const progress = one(nodes(tree, node => node.type === 'FunctionDeclaration' &&
    nodes(node.body, item => item.type === 'Property' && item.key.name === 'id' &&
      (item.value.value === 'codex.recentTasksMenu.count' || item.value.quasis?.[0]?.value.cooked === 'codex.recentTasksMenu.count'), true).length === 1), 'progress count component');
  const count = one(matches(progress.body, expr('$cloud.length+$local.length'), true), 'progress count');
  let localCount = `codexScopePlsHistoryConversations(${id(count.captures.$local)},${scopeName}).length`;
  if (merged.conversationKey === 'conversationId') {
    const data = one(nodes(progress.body, node => node.type === 'VariableDeclarator' && node.id.type === 'ObjectPattern' &&
      node.id.properties.some(property => property.key?.name === 'data'), true), 'progress source conversations');
    const sourceRows = id(one(data.id.properties.filter(property => property.key?.name === 'data'), 'progress data binding').value);
    const projectionPattern = stmt('function $project($conversation){return{hostId:$conversation.hostId,threadId:$conversation.conversationId}}');
    const projection = one(matches(progress.body, expr('$keys=$locals.map($project)'), true).filter(found =>
      nodes(tree, node => node.type === 'FunctionDeclaration' && node.id.name === id(found.captures.$project) &&
        match(projectionPattern, node)).length === 1), 'progress identity projection');
    one(nodes(progress.body, node => node.type === 'VariableDeclarator' &&
      node.id.name === id(projection.captures.$locals) && match(expr(`(${sourceRows}??[]).filter($predicate)`), node.init), true), 'progress local source');
    one(nodes(progress.body, node => node.type === 'VariableDeclarator' && node.id.name === id(count.captures.$local) &&
      node.init?.type === 'CallExpression' && node.init.arguments.length === 2 &&
      node.init.arguments[1].name === id(projection.captures.$keys), true), 'progress identity count');
    localCount = `codexScopePlsHistoryInProgress(${id(count.captures.$local)},${sourceRows},${scopeName}).length`;
  }
  points.push(point(source, progress, 'visible progress count', [subscription(progress, reactNamespace(progress)), replacement(count.node,
    `(${scopeName}==null||${scopeName}.showCloudChats?${id(count.captures.$cloud)}.length:0)+${localCount}`)]));

  points.push(inlineHistoryPoint(source, tree, react, ['mergedTasks', 'tasksQuery']));
  return definition(bytes, points);
}
function inlineHistoryPoint(source, tree, react, props) {
  const inline = functionWithProps(tree, props, fn => matches(fn.body, expr('$rows=$preview.map($callback)'), true)
    .some(found => found.captures.$callback.type === 'Identifier'));
  const rendered = one(matches(inline.body, expr('$rows=$preview.map($callback)'), true), 'inline row map');
  id(rendered.captures.$callback);
  const branch = one(nodes(inline.body, node => node.type === 'IfStatement' && node.consequent.start <= rendered.node.start &&
    node.consequent.end >= rendered.node.end && node.alternate?.type === 'ExpressionStatement', true), 'inline row cache');
  const jsx = one([...new Set(matches(inline.body, expr('(0,$jsx.jsxs)(`div`,$props)'), true)
    .map(found => id(found.captures.$jsx)))], 'inline render namespace');
  const inlineEdits = [subscription(inline, 'codexScopePlsInlineReact()'), insertion(branch.end,
    `;${id(rendered.captures.$rows)}=codexScopePlsGroupHistoryRows(${id(rendered.captures.$preview)},${id(rendered.captures.$rows)},${jsx},${scopeName});`)];
  return point(source, inline, 'inline folder sections', inlineEdits, `function codexScopePlsInlineReact(){return ${react}}\n`);
}
function localHeaderDefinition(bytes, source, tree, merged) {
  const react = id(merged.captures.$react), mergeName = id(merged.captures.$merge);
  const memo = merged.node.body.body.at(-1).argument;
  const output = memo.arguments[0].body.body.at(-1).argument.expressions.at(-1);
  const points = [point(source, merged.node, 'local history before preview and counts', [
    subscription(merged.node, react), replacement(output, `codexScopePlsHistoryEntries(${text(source, output)},${scopeName})`),
    insertion(memo.arguments[1].end - 1, `,${scopeName}`)
  ])];
  const menu = functionWithProps(tree, ['localConversations', 'onClose', 'autoFocusSearch']);
  const locals = propertyBinding(menu, 'localConversations');
  one(matches(menu.body, expr(`${mergeName}(${locals})`), true), 'local menu history source');
  const rows = one(matches(menu.body, expr('$rows.map($row=>(0,$jsx.jsx)($component,{item:$row,isActive:$row.kind===`local`&&$active===($row.pendingThreadStart?.clientThreadId??$row.conversation?.conversationId),onClose:$close,onActiveArchiveStart:$archive},$row.key))'), true), 'local menu row map');
  const cache = cacheInfo(menu), edits = [subscription(menu, reactNamespace(menu))];
  edits.push(replacement(rows.node, `codexScopePlsGroupHistoryRows(${id(rows.captures.$rows)},${text(source, rows.node)},${id(rows.captures.$jsx)},${scopeName})`));
  cacheGuard(menu, rows.node, cache, edits, source);
  edits.push(replacement(cache.size, String(cache.next)));
  points.push(point(source, menu, 'local history menu and grouping', edits));

  const progress = one(nodes(tree, node => node.type === 'FunctionDeclaration' &&
    nodes(node.body, item => item.type === 'Property' && item.key.name === 'id' &&
      (item.value.value === 'codex.recentTasksMenu.count' || item.value.quasis?.[0]?.value.cooked === 'codex.recentTasksMenu.count'), true).length === 1), 'local progress component');
  const count = one(matches(progress.body, expr('$query($atom,$keys).length'), true), 'local progress count');
  const data = one(nodes(progress.body, node => node.type === 'VariableDeclarator' && node.id.type === 'ObjectPattern' &&
    node.id.properties.some(property => property.key?.name === 'data'), true), 'local progress summaries');
  const summaries = id(one(data.id.properties.filter(property => property.key?.name === 'data'), 'local progress data binding').value);
  const projector = stmt('function $project($conversation){return{hostId:$conversation.hostId,threadId:$conversation.conversationId}}');
  const projection = one(matches(progress.body, expr(`${id(count.captures.$keys)}=$locals.map($project)`), true).filter(found =>
    nodes(tree, node => node.type === 'FunctionDeclaration' && node.id.name === id(found.captures.$project) && match(projector, node)).length === 1), 'local progress identity projection');
  // The projection source is a memoized alias of (loaded summaries ?? []).
  const filtered = one(nodes(progress.body, node => node.type === 'VariableDeclarator' && node.id.name === id(projection.captures.$locals) &&
    match(expr('$source.filter($predicate)'), node.init), true), 'local progress source filter');
  const alias = id(filtered.init.callee.object);
  one(matches(progress.body, expr(`${alias}=${summaries}??[]`), true), 'loaded progress summaries');
  points.push(point(source, progress, 'visible local progress count', [subscription(progress, reactNamespace(progress)),
    replacement(count.node, `codexScopePlsHistoryInProgress(${text(source, count.node.object)},${summaries}??[],${scopeName}).length`)]));
  points.push(inlineHistoryPoint(source, tree, react, ['mergedTasks']));
  return definition(bytes, points);
}
module.exports = { hostDefinition, appDefinition, notificationDefinition, rowDefinition, headerDefinition, combineDefinitions };
