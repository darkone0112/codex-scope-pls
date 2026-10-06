'use strict';
const fs = require('node:fs');
const path = require('node:path');

function staticSource(file, suffix) {
  const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  if (!source.endsWith(suffix)) throw new Error('Invalid packaged presentation source');
  return source.slice(0, -suffix.length);
}
const scope = staticSource('viewScope.js', '\nmodule.exports = { codexScopePlsViewScope };\n');
const visibility = staticSource('viewVisibility.js', '\nmodule.exports = { codexScopePlsVisible, codexScopePlsReadViewScope };\n');
const updates = staticSource('viewUpdates.js', '\nmodule.exports = { codexScopePlsSubscribeView };\n');
const notification = staticSource('viewNotification.js', '\nmodule.exports = { codexScopePlsAcceptViewScope };\n');
const history = staticSource('historyPresentation.js', '\nmodule.exports = { codexScopePlsUseViewScope, codexScopePlsHistoryEntries, codexScopePlsHistoryConversations };\n');
const groups = staticSource('historyGroups.js', '\nmodule.exports = { codexScopePlsGroupHistoryRows };\n');

function hostPoints(bundle) {
  const meta = bundle.viewMetaBefore;
  const native = bundle.nativeViewBefore;
  if (meta !== 'webviewMetaTags(e){let r=[],n=this.findPanelByWebview(e);' ||
    native !== 'async provideChatSessionItems(e,r){return(await this.requestThreadList(e)).data.map(o=>{') {
    throw new Error('Invalid presentation compatibility data');
  }
  return [
    { name: 'view scope metadata', before: meta,
      after: 'webviewMetaTags(e){\n/* codex-scope-pls:view-meta:1 */\n' + scope +
        '\nlet r=[`<meta name="codex-scope-pls-view" content="${ph(JSON.stringify(codexScopePlsViewScope(require("vscode"))))}">`],n=this.findPanelByWebview(e);' },
    { name: 'native chat session display', before: native,
      after: 'async provideChatSessionItems(e,r){\n/* codex-scope-pls:native-view:1 */\n' + scope + visibility +
        '\nconst viewScope=codexScopePlsViewScope(require("vscode"));return(await this.requestThreadList(e)).data.filter(o=>codexScopePlsVisible({kind:"local"},o,viewScope)).map(o=>{' },
    { name: 'live display preferences', before: 'async initializeWebview(e,r,n,o){let i=Ge.Uri.joinPath(this.extensionUri,"webview");',
      after: 'async initializeWebview(e,r,n,o){\n/* codex-scope-pls:view-updates:1 */\n' + scope + updates +
        '\nconst viewUpdates=codexScopePlsSubscribeView(require("vscode"),e,n);this.subscriptions.push(viewUpdates,viewUpdates.viewDisposal);let i=Ge.Uri.joinPath(this.extensionUri,"webview");' }
  ];
}
function rowPoints(before) {
  if (!before.startsWith('let Et=Tt;switch(n.kind){') || !before.endsWith('e}}}')) {
    throw new Error('Invalid row presentation compatibility data');
  }
  return [{ name: 'final chat row rendering', before,
    after: 'let Et=Tt;\n/* codex-scope-pls:row-view:1 */\n' + visibility +
      '\nif(!codexScopePlsVisible(n,Fe??Te,codexScopePlsReadViewScope(document)))return null;' + before.slice('let Et=Tt;'.length) }];
}
function historyPoints(bundle) {
  // The VS Code history menu calls these components directly, bypassing xmr.
  // Each guard is after the component's existing hooks and reads display data.
  const local = 'let Kn;return t[116]!==An||t[117]!==Ie||t[118]!==Ge';
  const cloud = 'let gt=ht;if(L===void 0&&I?.length===0&&!Me)return gt;';
  const pending = 'let C;return t[30]!==x||t[31]!==S?';
  const worktree = 'let he;return t[25]!==L||t[26]!==O||t[27]!==k';
  if (bundle.localHistoryBefore !== local || bundle.cloudHistoryBefore !== cloud ||
    bundle.pendingHistoryBefore !== pending || bundle.worktreeHistoryBefore !== worktree) {
    throw new Error('Invalid history presentation compatibility data');
  }
  function point(name, before, entry) {
    const declarationEnd = before.indexOf(';') + 1;
    return { name, before, after: before.slice(0, declarationEnd) +
      '\n/* codex-scope-pls:history-view:1 */\n' + visibility +
      `\nif(!codexScopePlsVisible(${entry},null,codexScopePlsReadViewScope(document)))return null;` +
      before.slice(declarationEnd) };
  }
  return [
    point('local history row', local, '{kind:"local",conversationId:n,cwd:mt}'),
    point('cloud history row', cloud, '{kind:"remote"}'),
    point('pending history row', pending, '{kind:"local",cwd:o.task.cwd}'),
    point('worktree history row', worktree, '{kind:"local",cwd:r.sourceWorkspaceRoot}')
  ];
}
function notificationPoints() {
  const before = 'return typeof i!=`object`||!i||!n0e(i)?null:i}function t0e(e)';
  return [{ name: 'display preference notification', before,
    after: '\n/* codex-scope-pls:view-notification:1 */\n' + visibility + notification +
      '\nif(codexScopePlsAcceptViewScope(i,document,window))return null;return typeof i!=`object`||!i||!n0e(i)?null:i}\nfunction t0e(e)' }];
}

function headerPoints(bundle) {
  const merged = bundle.mergedHistoryBefore;
  if (merged !== 'function fn(e,t,r){let i=Be(),a=n(pt),o=(0,gn.useMemo)(()=>t.map(e=>e.id),[t]),s=f(Ie,o),c=Me(),l=(0,gn.useRef)(new Map);return(0,gn.useMemo)(()=>{let n=mn(pn({tasks:e,localConversations:t,pendingWorktrees:i,pendingThreadStarts:a,envForFilter:r,threadSortKey:be,isBackgroundSubagentsEnabled:c,clientThreadIdsByConversationId:s}),l.current);return l.current=new Map(n.map(e=>[e.key,e])),n},[e,r,s,c,t,i,a])}') {
    throw new Error('Invalid merged history compatibility data');
  }
  const helpers = '\n/* codex-scope-pls:history-list:1 */\n' + visibility + history + groups;
  return [
    { name: 'history before preview and counts', before: merged,
      after: 'function fn(e,t,r){' + helpers +
        '\nconst viewScope=codexScopePlsUseViewScope(gn,document,window);' +
        merged.slice('function fn(e,t,r){'.length)
          .replace('new Map(n.map(e=>[e.key,e])),n}', 'new Map(n.map(e=>[e.key,e])),codexScopePlsHistoryEntries(n,viewScope)}')
          .replace('[e,r,s,c,t,i,a])}', '[e,r,s,c,t,i,a,viewScope])}') },
    { name: 'history menu preference subscription', before: 'function vn(e){let t=(0,Cn.c)(34),',
      after: 'function vn(e){' + helpers + '\nconst viewScope=codexScopePlsUseViewScope(wn,document,window);let t=(0,Cn.c)(35),' },
    { name: 'local history tab and search', before: 'let re=a.filter(T),E=fn(r.data,a,te),',
      after: 'let re=codexScopePlsHistoryConversations(a,viewScope).filter(T),E=fn(r.data,a,te),' },
    { name: 'progress count preference subscription', before: 'function On(e){let t=(0,jn.c)(64),r;',
      after: 'function On(e){' + helpers + '\nconst viewScope=codexScopePlsUseViewScope(Mn,document,window);let t=(0,jn.c)(64),r;' },
    { name: 'visible progress count', before: 'let D=E,O=re.length+D.length,k;',
      after: 'let D=E,O=(viewScope==null||viewScope.showCloudChats?re.length:0)+codexScopePlsHistoryConversations(D,viewScope).length,k;' },
    { name: 'inline history group subscription', before: 'function Et(e){let t=(0,jt.c)(23),',
      // jt=g() is compiler-cache runtime. Resolve React at module scope because
      // Et's local row variable p shadows the imported React factory p().
      after: 'function codexScopePlsInlineReact(){return p()}\nfunction Et(e){' + helpers +
        '\nconst viewScope=codexScopePlsUseViewScope(codexScopePlsInlineReact(),document,window);let t=(0,jt.c)(23),' },
    { name: 'inline history folder sections', before: 'else p=t[12];let m;t[17]!==n.length||t[18]!==f?',
      after: 'else p=t[12];p=codexScopePlsGroupHistoryRows(d,p,J,viewScope);let m;t[17]!==n.length||t[18]!==f?' },
    ...groupedMenuPoints()
  ];
}

function groupedMenuPoints() {
  const recent = 'F.map(e=>(0,Z.jsx)(En,{item:e,isActive:e.kind===`local`&&x===(e.pendingThreadStart?.clientThreadId??e.conversation?.id),onClose:s,onActiveArchiveStart:g},e.key))';
  const local = 'P.map(e=>(0,Z.jsx)(Tn,{conversationId:e.id,hostId:e.hostId,updatedAt:e.recencyAt??e.updatedAt,isActive:x===e.id,onClose:s,onActiveArchiveStart:g},e.id))';
  // The compiler cache for V must include the preference: its entries can stay
  // identical when grouping changes while the recent menu remains open.
  const cache = 't[22]!==g?(V=b===`recent`&&';
  // Parenthesize the callback parameter so the original exact patch point no
  // longer occurs inside the wrapped output. Row callback behavior is identical.
  return [
    { name: 'recent history folder sections', before: recent,
      after: `codexScopePlsGroupHistoryRows(F,${recent.replace('F.map(e=>', 'F.map((e)=>')},Z,viewScope)` },
    { name: 'local history folder sections', before: local,
      after: `codexScopePlsGroupHistoryRows(P,${local.replace('P.map(e=>', 'P.map((e)=>')},Z,viewScope)` },
    { name: 'recent folder preference cache', before: cache,
      after: 't[22]!==g||t[34]!==viewScope?(V=b===`recent`&&' },
    { name: 'recent folder preference cache store', before: 't[22]=g,t[23]=V):V=t[23];',
      after: 't[22]=g,t[23]=V,t[34]=viewScope):V=t[23];' }
  ];
}
module.exports = { hostPoints, rowPoints, historyPoints, notificationPoints, headerPoints };
