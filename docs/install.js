// Install page logic: bakes the helper origin into the bookmarklet and renders the draggable link plus the
// copyable text for phones. No username is needed: the helper learns it from Diigo's replies.
const CODE = "(()=>{var q=(window.__dl2cfg||\"%%DL2_CFG%%\").h;window.__dl2?window.__dl2():ee();function ee(){let l=document,E=e=>e.replace(/\\s+/g,\"\"),F=/^(button|noscript|script|select|style|textarea|title)$/i,P=()=>{let e=l.createTreeWalker(l.body,5,i=>i.nodeType==3?1:F.test(i.tagName)?2:3),t=[],n,o=\"\";for(;n=e.nextNode();){let i=E(n.nodeValue);i&&(t.push({n,o:o.length,l:i.length}),o+=i)}return{L:t,T:o}},A=(e,t,n)=>{let o=0;for(let i=0;i<e.length;i++)if(!/\\s/.test(e[i])&&o++==t)return n?i+1:i;return e.length},Y=(e,t,n)=>{let o,i;for(let s of e.L)if(!o&&t>=s.o&&t<s.o+s.l&&(o=s),n>=s.o&&n<s.o+s.l){i=s;break}if(!o||!i)return;let d=l.createRange();return d.setStart(o.n,A(o.n.nodeValue,t-o.o)),d.setEnd(i.n,A(i.n.nodeValue,n-i.o,1)),d},J=(e,t)=>{let n=t.T.length;for(let o of t.L)e.intersectsNode(o.n)&&(n=o.o+o.l);return n},H=[\"yellow\",\"blue\",\"green\",\"pink\"],I=[\"#ff9\",\"#abd5ff\",\"#b2e57e\",\"#fcc\"],c={},M=new CSSStyleSheet;M.replaceSync(H.map((e,t)=>(c[e]=new Highlight,CSS.highlights.set(\"dl2\"+e,c[e]),`::highlight(dl2${e}){background:${I[t]};color:#111}`)).join(\"\")),l.adoptedStyleSheets=[...l.adoptedStyleSheets,M];let O=(e,t)=>(e=e.cloneRange(),(c[t]||c.yellow).add(e),e),p=[],g,u,h,W,z,w=(e,t,n)=>{let o=l.createElement(e);return o.style.cssText=\"all:initial;font:14px system-ui;text-align:center;cursor:pointer;\"+t,n&&(o.textContent=n),o},m=w(\"div\",\"position:fixed;right:12px;bottom:12px;z-index:2147483647;display:flex;align-items:center;gap:8px;background:#fff;border-radius:30px;padding:5px 12px;border:1px solid #bbb\"),T=w(\"span\",\"max-width:40vw;overflow:hidden;white-space:nowrap\"),k=w(\"button\",\"width:44px;height:44px;border-radius:50%;color:#fff;font:700 20px system-ui\",\"✎\"),B=[...H,0].map((e,t)=>{let n=w(\"button\",\"display:none;width:30px;height:30px;border-radius:50%;border:2px solid #0003;background:\"+(I[t]||\"#eee\"),e?\"\":\"✕\");return n.onclick=()=>e?Q(e):Z(),n}),y=w(\"iframe\",\"display:none\");m.append(T,...B,k),l.documentElement.append(m,y),m.onpointerdown=e=>e.preventDefault(),window.__dl2=L;let r=(e,t)=>{T.textContent=e,T.style.color=t||\"#333\"},N=()=>B.forEach((e,t)=>{e.style.display=(t<4?u:h)?\"\":\"none\"}),V=e=>{u=h=0,N(),getSelection().removeAllRanges(),r(e)},b=new URL(q).origin,$=q+\"/helper.html?v=mto5ypc2\",G=navigator.maxTouchPoints>1,f=0,a,K=0,x,S={};addEventListener(\"message\",e=>{let t=e.data;if(e.origin!=b||!t||t.t!=\"dl2\")return;if(t.ready)return x&&x(e.source);let n=S[t.id];n&&(delete S[t.id],n(t))});let U=(e,t)=>new Promise((n,o)=>{let i=Date.now(),d=setInterval(()=>{e.closed?s(o,\"Popups isolated\"):Date.now()-i>t?s(o,\"Helper unreachable\"):e.postMessage({t:\"dl2\",hello:1},b)},250),s=(D,j)=>{clearInterval(d),x=0,D(j)};x=D=>D==e&&s(n)}),v=()=>{k.style.background=f||G?\"#1f5fbf\":\"#777\"},X=()=>f==1?y.contentWindow:f==2&&a&&!a.closed?a:(f=0,v(),0),R=(e,t)=>new Promise((n,o)=>{let i=++K,d=setTimeout(()=>{delete S[i],o(\"Timed out\")},2e4);S[i]=s=>{clearTimeout(d),s.ok?n(s.r):o(s.e)},X().postMessage({t:\"dl2\",v:3,id:i,cmd:e,url:location.href,title:l.title,...t},b)}),_=async e=>{let t;if(!X()){if(a=open($,\"dl2\",\"popup,width=460,height=380\"),!a)throw\"Popup blocked\";try{await U(a,8e3)}catch(n){throw a.close(),a=0,n}f=2,t=1,v()}try{return await e()}finally{t&&G&&(a.postMessage({t:\"dl2\",bye:1},b),a.close(),a=0,f=0,v())}},C=()=>p.length+\" highlight\"+(p.length==1?\"\":\"s\");async function L(){r(\"Loading\");try{g=P();let e=await _(()=>R(\"load\",{T:g.T}));for(let t in c)c[t].clear();p.length=h=0;for(let t of e.anns){let n=Y(g,t.s,t.e);n&&p.push({r:O(n,t.color),id:t.id})}r(e.user?C():\"Sign in to Diigo\",e.user?\"green\":\"#a60\")}catch(e){r(e,\"#a60\")}}async function Q(e){let t=u;if(!t)return;g=P();let n=t.toString(),o=t.getBoundingClientRect(),i=O(t,e);V(\"Saving\");try{p.push({r:i,id:(await _(()=>R(\"add\",{raw:n,x:J(t,g),T:g.T,color:e,top:o.top+scrollY|0,left:o.left+scrollX|0}))).id}),r(\"Saved · \"+C(),\"green\")}catch(d){c[e].delete(i),r(d,\"#c22\")}}async function Z(){let e=h;if(e){V(\"Removing\");try{if((await _(()=>R(\"del\",{ann:e.id}))).kept)return r(\"Diigo kept it\",\"#c22\");for(let n in c)c[n].delete(e.r);p.splice(p.indexOf(e),1),r(\"Removed · \"+C(),\"green\")}catch(t){r(t,\"#c22\")}}}k.onclick=L,l.addEventListener(\"selectionchange\",()=>{clearTimeout(z),z=setTimeout(()=>{let e=getSelection(),t=e.rangeCount&&e.getRangeAt(0),n=Date.now();t&&(h=p.find(o=>o.r.isPointInRange(t.startContainer,t.startOffset)),W=n),t&&!e.isCollapsed&&!m.contains(t.commonAncestorContainer)&&E(t.toString()).length>4?u=t.cloneRange():n-W>8e3&&(u=h=0),N()},120)}),r(\"Connecting\"),(async()=>{try{y.src=$,await U(y.contentWindow,6e3),f=1}catch{y.remove()}v(),f?L():r(\"Tap pen to load\",\"#a60\")})()}})();";

// A javascript: URL is percent-decoded before it runs, so literal % signs, whitespace and # must be encoded.
function encodeBookmarklet(code) {
  return code.replace(/[%#\s]/g, (c) => '%' + c.charCodeAt(0).toString(16).padStart(2, '0').toUpperCase());
}

function main() {
  const helper = location.origin + location.pathname.replace(/\/[^/]*$/, '');
  const bm = 'javascript:' + encodeBookmarklet(CODE.replace('"%%DL2_CFG%%"', JSON.stringify({ h: helper })));
  const link = document.getElementById('bm-link');
  const urlBox = document.getElementById('bm-url');
  const copyBtn = document.getElementById('copy');
  link.setAttribute('href', bm);
  urlBox.value = bm;
  document.getElementById('size').textContent = bm.length + ' characters';

  copyBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(urlBox.value);
      copyBtn.textContent = 'Copied';
    } catch {
      urlBox.focus(); urlBox.select();
      copyBtn.textContent = 'Select all and copy';
    }
    setTimeout(() => { copyBtn.textContent = 'Copy bookmarklet'; }, 2000);
  });
  link.addEventListener('click', (ev) => {
    ev.preventDefault();
    document.getElementById('drag-hint').hidden = false;
  });
}

main();
