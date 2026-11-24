// Codex 26.1117.41037 loader and item projection; provider delegation and webview entry are shortened.
class Host{
webviewMetaTags(e){let r=[],n=this.findPanelByWebview(e);if(n){let o=this.initialRouteMetaTag(n);o!=null&&r.push(o)}return r.push(`<meta name="${Wge}" content="${Ah(this.extensionVersion)}">`),r.push(`<meta name="${Hge}" content="${Ah(this.codexAppSessionId)}">`),r.push(`<meta name="${Gge}" content="${Ah(this.buildFlavor)}">`),r.join(`
`)}
async provideChatSessionItems(request){return this.loadConversationItems(request)}
async loadConversationItems(t){let r=await this.codexAppServer.request("thread/list",{limit:50,cursor:null,sortKey:"created_at",modelProviders:t?[RS]:null,archived:!1,sourceKinds:la,useStateDbOnly:!0});if(r.error)throw new Error(r.error.message);if(r.result==null)throw new Error("No result in response");return r.result.data.map(n=>{let o=n.createdAt*1e3,i={conversationId:n.id,preview:n.name?.trim()||n.preview,createdAtMs:Number.isFinite(o)?o:null,modelProvider:n.modelProvider};return{summary:i,item:this.toChatSessionItem(i)}})}
toChatSessionItem(t){let{conversationId:r,preview:n,createdAtMs:o}=t,i=i9e(r),s=a9e(n),a=o!=null?{startTime:o}:void 0;return{id:r,resource:i,label:s,timing:a}}
async initializeWebview(e,r,n,o){let i=je.Uri.joinPath(this.extensionUri,"webview");}
}
module.exports=Host;
