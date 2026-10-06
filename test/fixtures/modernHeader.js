'use strict';
function fn(e,t,n){let r=Ne(),i=o(tt),a=(0,gn.useMemo)(()=>t.map(e=>e.id),[t]),s=_(yt,a),c=Ie(),l=(0,gn.useRef)(new Map);return(0,gn.useMemo)(()=>{let a=mn(pn({tasks:e,localConversations:t,pendingWorktrees:r,pendingThreadStarts:i,envForFilter:n,threadSortKey:Ae,isBackgroundSubagentsEnabled:c,clientThreadIdsByConversationId:s}),l.current);return l.current=new Map(a.map(e=>[e.key,e])),a},[e,n,s,c,t,r,i])}
module.exports=fn;
