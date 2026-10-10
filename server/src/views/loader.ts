/**
 * 页面跳转时的加载动画：一只黑色 Q 版小猫从左往右走。服务端页面和前端共用。
 *
 * 整页跳转（阅读页之间、阅读页 → 编辑器）时，浏览器在新页面绘制出来之前会一直显示旧页面，
 * 所以在点击链接、提交 GET 表单时把小猫放到旧页面上；新页面出来后旧页面连同小猫一起消失。
 * 前端路由内部的跳转由 web/src/main.tsx 根据路由的加载状态显示同一只小猫。
 */

/** 小猫（朝右）。腿、尾巴、身体起伏都是 CSS 动画，类名见 PAGE_LOADER_CSS */
export const CAT_SVG = `<svg class="cat" viewBox="0 0 72 52" width="72" height="52" aria-hidden="true">
<ellipse class="cat-shadow" cx="34" cy="49" rx="20" ry="2.2"/>
<g class="cat-legs-b"><rect x="18" y="36" width="5" height="11" rx="2.5"/><rect x="38" y="36" width="5" height="11" rx="2.5"/></g>
<g class="cat-bob">
<path class="cat-tail" d="M18 31 C10 31 6 25 8.5 15" />
<ellipse class="cat-fill" cx="30" cy="34" rx="15" ry="10"/>
<g class="cat-head">
<path class="cat-fill" d="M38 13 L39.5 2.5 Q40 1 41.2 2 L47 9 Z"/>
<path class="cat-fill" d="M55 9 L60.5 2.2 Q61.6 1.2 62 2.7 L62.8 14 Z"/>
<path class="cat-ear" d="M40.6 9.5 L41.3 5 L44.2 8.6 Z"/>
<path class="cat-ear" d="M57.6 8.4 L60.6 5 L60.9 10.4 Z"/>
<ellipse class="cat-fill" cx="50" cy="20" rx="14" ry="12.5"/>
<g class="cat-eyes"><ellipse cx="45.5" cy="19.5" rx="2.6" ry="3.3" fill="#fff"/><ellipse cx="56" cy="19.5" rx="2.6" ry="3.3" fill="#fff"/><circle cx="46.4" cy="20" r="1.6" fill="#16161a"/><circle cx="56.9" cy="20" r="1.6" fill="#16161a"/><circle cx="46.9" cy="19" r=".55" fill="#fff"/><circle cx="57.4" cy="19" r=".55" fill="#fff"/></g>
<path d="M50.2 24 l1.4 1.1 l1.4 -1.1 Z" fill="#f4a3b4"/>
<path class="cat-whisker" d="M40 24.5 L34.5 23.5 M40 26.5 L34.8 27.3 M60.5 24.5 L66 23.5 M60.5 26.5 L65.8 27.3"/>
<ellipse cx="43" cy="25.2" rx="2" ry="1.1" fill="#f4a3b4" opacity=".55"/><ellipse cx="59" cy="25.2" rx="2" ry="1.1" fill="#f4a3b4" opacity=".55"/>
</g>
</g>
<g class="cat-legs-f"><rect x="23" y="37" width="5" height="11" rx="2.5"/><rect x="34" y="37" width="5" height="11" rx="2.5"/></g>
</svg>`

export const PAGE_LOADER_CSS = `
.page-loader { position: fixed; left: 0; right: 0; bottom: 14px; height: 56px; z-index: 60; pointer-events: none; overflow: hidden; }
.page-loader .cat { position: absolute; left: 0; bottom: 0; animation: cat-walk 4.5s linear infinite; }
@keyframes cat-walk { from { transform: translateX(-12px); } to { transform: translateX(calc(100vw + 8px)); } }
.cat .cat-fill, .cat .cat-legs-b rect, .cat .cat-legs-f rect { fill: #1d1d22; }
.cat .cat-tail { fill: none; stroke: #1d1d22; stroke-width: 5; stroke-linecap: round; transform-origin: 18px 31px; animation: cat-tail 1s ease-in-out infinite alternate; }
.cat .cat-ear { fill: #f4a3b4; }
.cat .cat-whisker { stroke: #8a8a94; stroke-width: .8; stroke-linecap: round; }
.cat .cat-shadow { fill: rgba(0,0,0,.12); }
.cat .cat-legs-f rect, .cat .cat-legs-b rect { transform-box: fill-box; transform-origin: 50% 0; animation: cat-step .4s ease-in-out infinite alternate; }
.cat .cat-legs-f rect:last-child, .cat .cat-legs-b rect:first-child { animation-direction: alternate-reverse; }
.cat .cat-legs-b rect { fill: #2c2c33; }
.cat .cat-bob { animation: cat-bob .2s ease-in-out infinite alternate; }
.cat .cat-eyes { transform-box: fill-box; transform-origin: 50% 50%; animation: cat-blink 3.2s infinite; }
@keyframes cat-step { from { transform: rotate(24deg); } to { transform: rotate(-24deg); } }
@keyframes cat-bob { from { transform: translateY(0); } to { transform: translateY(-1.4px); } }
@keyframes cat-tail { from { transform: rotate(-8deg); } to { transform: rotate(10deg); } }
@keyframes cat-blink { 0%, 92%, 100% { transform: scaleY(1); } 95% { transform: scaleY(.1); } }
/* 深色模式下给黑猫加一圈浅色光晕，避免和背景融在一起 */
:root[data-theme="dark"] .cat { filter: drop-shadow(0 0 1px rgba(255,255,255,.55)); }
:root[data-theme="dark"] .cat .cat-shadow { fill: rgba(255,255,255,.08); }
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) .cat { filter: drop-shadow(0 0 1px rgba(255,255,255,.55)); }
  :root:not([data-theme="light"]) .cat .cat-shadow { fill: rgba(255,255,255,.08); }
}
/* 减少动态效果：原地停在左下角，只保留眨眼 */
@media (prefers-reduced-motion: reduce) {
  .page-loader .cat { animation: none; left: 16px; }
  .cat .cat-legs-f rect, .cat .cat-legs-b rect, .cat .cat-bob, .cat .cat-tail { animation: none; }
}
`

/** 跳转很快时不出现，避免一闪而过 */
export const PAGE_LOADER_DELAY = 200

/** 整页跳转时显示小猫。window.__pageLoader 供前端代码用 location.href 跳转前调用 */
export const PAGE_LOADER_JS = `(function(){
var el,t,CAT=${JSON.stringify(CAT_SVG)};
function show(){if(el)return;el=document.createElement('div');el.className='page-loader';el.setAttribute('role','status');el.setAttribute('aria-label','页面加载中');el.innerHTML=CAT;document.body.appendChild(el)}
function start(){clearTimeout(t);t=setTimeout(show,${PAGE_LOADER_DELAY})}
function stop(){clearTimeout(t);if(el){el.remove();el=null}}
window.__pageLoader={start:start,stop:stop};
document.addEventListener('click',function(e){
if(e.defaultPrevented||e.button!==0||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey)return;
var a=e.target.closest&&e.target.closest('a[href]');if(!a||a.hasAttribute('download')||(a.target&&a.target!=='_self'))return;
var u=new URL(a.href,location.href);if(u.origin!==location.origin)return;
if(u.pathname===location.pathname&&u.search===location.search)return;
if(/^\\/(api|uploads|plugins|assets)\\//.test(u.pathname))return;
start()});
document.addEventListener('submit',function(e){var f=e.target;if(!e.defaultPrevented&&(f.getAttribute('method')||'get').toLowerCase()==='get'&&!f.target)start()});
addEventListener('pageshow',stop);addEventListener('pagehide',stop)})()`
