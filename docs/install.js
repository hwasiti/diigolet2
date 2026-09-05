// Install page logic: bakes the helper origin into the bookmarklet and renders the draggable link plus the
// copyable text for phones. No username is needed: the helper learns it from Diigo's replies.
const CODE = "(()=>{var O=(window.__dl2cfg||\"%%DL2_CFG%%\").h;window.__dl2?window.__dl2():K();function K(){let a=document,v=e=>e.replace(/\\s+/g,\"\"),U=/^(applet|bdo|button|iframe|map|noframes|noscript|optgroup|option|script|select|style|textarea|title)$/i,E=()=>{let e=a.createTreeWalker(a.body,5,s=>s.nodeType==3?1:U.test(s.tagName)||s.dl2?2:3),t=[],o,n=\"\";for(;o=e.nextNode();){let s=v(o.nodeValue);s&&(t.push({n:o,o:n.length,l:s.length}),n+=s)}return{L:t,T:n}},R=(e,t,o)=>{let n=0;for(let s=0;s<e.length;s++)if(!/\\s/.test(e[s])&&n++==t)return o?s+1:s;return e.length},X=(e,t,o)=>{let n,s;for(let l of e.L)if(!n&&t>=l.o&&t<l.o+l.l&&(n=l),o>=l.o&&o<l.o+l.l){s=l;break}if(!n||!s)return;let c=a.createRange();return c.setStart(n.n,R(n.n.nodeValue,t-n.o)),c.setEnd(s.n,R(s.n.nodeValue,o-s.o,1)),c},q=(e,t)=>{let o=t.T.length;for(let n of t.L)e.intersectsNode(n.n)&&(o=n.o+n.l);return o},k=[\"yellow\",\"blue\",\"green\",\"pink\"],D=[\"#ff9\",\"#abd5ff\",\"#b2e57e\",\"#fcc\"],h={},P=new CSSStyleSheet;P.replaceSync(k.map((e,t)=>(h[e]=new Highlight,CSS.highlights.set(\"dl2\"+e,h[e]),`::highlight(dl2${e}){background:${D[t]};color:#111}`)).join(\"\")),a.adoptedStyleSheets=[...a.adoptedStyleSheets,P];let M=(e,t)=>(e=e.cloneRange(),(h[t]||h.yellow).add(e),e),m=(e,t,o)=>{let n=a.createElement(e);return n.style.cssText=\"all:initial;font:14px system-ui;\"+t,o&&(n.textContent=o),n},g=m(\"div\",\"position:fixed;right:12px;bottom:12px;z-index:2147483647;display:flex;align-items:center;gap:8px;background:#fff;border-radius:30px;padding:5px 5px 5px 12px;box-shadow:0 2px 8px #0005\");g.dl2=1;let _=m(\"span\",\"max-width:40vw;overflow:hidden;white-space:nowrap;color:#333\"),L=m(\"button\",\"width:44px;height:44px;border-radius:50%;color:#fff;font:700 20px system-ui;text-align:center;cursor:pointer\",\"✎\"),A=k.map((e,t)=>{let o=m(\"button\",\"display:none;width:30px;height:30px;border-radius:50%;border:2px solid #0003;background:\"+D[t]);return o.onclick=()=>Y(e),o});g.append(_,...A,L),a.documentElement.append(g),g.onpointerdown=e=>e.preventDefault(),window.__dl2=()=>{g.style.display=g.style.display?\"\":\"none\"};let r=(e,t)=>{_.textContent=e,_.style.color=t||\"#333\"},y=e=>A.forEach(t=>{t.style.display=e?\"\":\"none\"}),x=new URL(O).origin,H=O+\"/helper.html?v=mto3uvby\",W=navigator.maxTouchPoints>1,d=0,p,i,F=0,b,S=new Map;addEventListener(\"message\",e=>{let t=e.data;if(e.origin!=x||!t||t.t!=\"dl2\")return;if(t.ready)return b&&b(e.source);let o=S.get(t.id);o&&(S.delete(t.id),t.ok?o[0](t.r):o[1](t.e))});let z=(e,t)=>new Promise((o,n)=>{let s=Date.now(),c=setInterval(()=>{e.closed?l(n,\"Popups isolated\"):Date.now()-s>t?l(n,\"Helper unreachable\"):e.postMessage({t:\"dl2\",hello:1},x)},250),l=(C,J)=>{clearInterval(c),b=0,C(J)};b=C=>C==e&&l(o)}),T=()=>{L.style.background=d||W?\"#1f5fbf\":\"#777\"},B=()=>d==1?p.contentWindow:d==2&&i&&!i.closed?i:(d=0,T(),0),I=(e,t)=>new Promise((o,n)=>{let s=++F,c=setTimeout(()=>{S.delete(s),n(\"Timed out\")},2e4);S.set(s,[l=>{clearTimeout(c),o(l)},l=>{clearTimeout(c),n(l)}]),B().postMessage({t:\"dl2\",v:3,id:s,cmd:e,url:location.href,title:a.title,...t},x)}),N=async e=>{let t;if(!B()){if(i=open(H+\"#popup\",\"dl2helper\",\"popup=yes,width=460,height=380\"),!i)throw\"Popup blocked\";try{await z(i,8e3)}catch(o){throw i.close(),i=0,o}d=2,t=1,T()}try{return await e()}finally{t&&W&&(i.postMessage({t:\"dl2\",bye:1},x),i.close(),i=0,d=0,T())}},u,w=0,f,V,$=()=>w+\" highlight\"+(w==1?\"\":\"s\");async function G(){r(\"Loading\");try{u=E();let e=await N(()=>I(\"load\",{T:u.T}));for(let t of k)h[t].clear();w=0;for(let t of e.anns){let o=X(u,t.s,t.e);o&&(M(o,t.color),w++)}r(e.user?$():\"Sign in to Diigo\",e.user?\"green\":\"#a60\")}catch(e){r(e,\"#a60\")}}async function Y(e){let t=f;if(!t)return r(\"Select text first\",\"#a60\");u=E();let o=t.toString();if(v(o).length<5)return r(\"Too short\",\"#a60\");let n=t.getBoundingClientRect(),s=M(t,e);f=0,y(),getSelection().removeAllRanges(),r(\"Saving\");try{await N(()=>I(\"add\",{raw:o,x:q(t,u),T:u.T,color:e,top:n.top+scrollY|0,left:n.left+scrollX|0})),w++,r(\"Saved · \"+$(),\"green\")}catch(c){h[e].delete(s),r(c,\"#c22\")}}L.onclick=()=>f?y(1):G(),a.addEventListener(\"selectionchange\",()=>{clearTimeout(V),V=setTimeout(()=>{let e=getSelection(),t=e.rangeCount&&!e.isCollapsed&&e.getRangeAt(0);t&&!g.contains(t.commonAncestorContainer)&&v(t.toString()).length>4?(f=t.cloneRange(),f.at=Date.now(),y(1)):f&&Date.now()-f.at>8e3&&(f=0,y())},120)}),r(\"Connecting\"),(async()=>{try{p=a.createElement(\"iframe\"),p.dl2=1,p.style.cssText=\"position:fixed;width:0;height:0;border:0;left:-9999px\",p.src=H,a.documentElement.append(p),await z(p.contentWindow,6e3),d=1}catch{p.remove()}T(),d?G():r(\"Tap pen to load\",\"#a60\")})()}})();";

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
