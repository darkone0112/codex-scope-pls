// Codex 26.1007 display methods; initialization body truncated after its entry.
class Host{
webviewMetaTags(e){let r=[],n=this.findPanelByWebview(e);if(n){let o=this.initialRouteMetaTag(n);o!=null&&r.push(o)}return r.push(`<meta name="${Wge}" content="${Ah(this.extensionVersion)}">`),r.push(`<meta name="${Hge}" content="${Ah(this.codexAppSessionId)}">`),r.push(`<meta name="${Gge}" content="${Ah(this.buildFlavor)}">`),r.join(`
`)}
async provideChatSessionItems(e,r){return(await this.requestThreadList(e)).data.map(o=>{let i=this.toThreadListSummary(o);return{summary:i,item:this.toChatSessionItem(i)}})}
async initializeWebview(e,r,n,o){let i=je.Uri.joinPath(this.extensionUri,"webview");}
}
module.exports=Host;
