// Copied Codex 26.1117.41037 message parser.
function Klt(e,t){let n=t.location.origin,r=!1;if(e.origin===n&&(r=!0),!r)return null;let i=e.data;if(Ylt(i)){let e=qlt(t).receive(i);if(e.type!==`passthrough`&&e.acknowledgement!=null&&bg.postMessage({type:`chunked-message-ack`,transferId:e.acknowledgement.transferId,sequence:e.acknowledgement.sequence}),e.type===`pending`)return null;i=e.message}return typeof i!=`object`||!i||!Jlt(i)?null:i}
module.exports=Klt;
