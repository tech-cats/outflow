/** 服务端阅读页与前端 SPA 共用的基础样式 */
const DARK_VARS = `
    --bg: #17181a;
    --bg-soft: #1e1f22;
    --bg-hover: #2a2b2f;
    --fg: #e6e6e3;
    --fg-soft: #b1b3b8;
    --fg-muted: #7d8087;
    --border: #2f3034;
    --accent: #5b8def;
    --accent-fg: #ffffff;
    --accent-soft: #1e2a44;
    --danger: #f47067;
    --ok: #57ab5a;
    --warn: #c69026;
    --code-bg: #232428;
    --shadow: 0 1px 2px rgba(0,0,0,.3), 0 4px 16px rgba(0,0,0,.3);
    color-scheme: dark;
`

export const baseCss = `
:root {
  --bg: #ffffff;
  --bg-soft: #f7f7f5;
  --bg-hover: #efefec;
  --fg: #1f2328;
  --fg-soft: #57606a;
  --fg-muted: #8b949e;
  --border: #e5e5e2;
  --accent: #2f6feb;
  --accent-fg: #ffffff;
  --accent-soft: #e8f0fe;
  --danger: #cf222e;
  --ok: #1a7f37;
  --warn: #9a6700;
  --code-bg: #f3f3f1;
  --radius: 8px;
  --shadow: 0 1px 2px rgba(0,0,0,.04), 0 4px 16px rgba(0,0,0,.06);
  --font: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif;
  --mono: ui-monospace, SFMono-Regular, "JetBrains Mono", Menlo, Consolas, monospace;
  color-scheme: light;
}
/* 深色：未手动选择时跟随系统；data-theme 为用户手动选择 */
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
${DARK_VARS}  }
}
:root[data-theme="dark"] {
${DARK_VARS}}
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body { background: var(--bg); color: var(--fg); font: 15px/1.6 var(--font); -webkit-font-smoothing: antialiased; }
/* 页面内容不足一屏时页脚贴底：阅读页是 body 的直接子元素，SPA 包在 #root 里 */
body, #root { display: flex; flex-direction: column; min-height: 100vh; }
#root { flex: 1 0 auto; min-height: 0; }
a { color: var(--accent); text-decoration: none; }
a:hover { text-decoration: underline; }
button, input, select, textarea { font: inherit; color: inherit; }

.topbar { position: sticky; top: 0; z-index: 20; display: flex; align-items: center; gap: 16px; height: 52px; padding: 0 20px; background: color-mix(in srgb, var(--bg) 88%, transparent); backdrop-filter: blur(8px); border-bottom: 1px solid var(--border); }
.brand { font-weight: 700; font-size: 17px; color: var(--fg); letter-spacing: .2px; display: flex; align-items: center; gap: 8px; }
.brand:hover { text-decoration: none; }
.brand-mark { width: 22px; height: 22px; border-radius: 6px; background: linear-gradient(135deg, var(--accent), #8a5cf6); display: inline-block; }
.topbar .search { flex: 1; max-width: 420px; margin: 0; }
.topbar .spacer { flex: 1; }
.topbar .nav { display: flex; align-items: center; gap: 12px; font-size: 14px; }
.topbar .nav a, .topbar .nav button.link { color: var(--fg-soft); }
.topbar .nav a.btn-primary { color: var(--accent-fg); }
.theme-toggle { border: 0; background: none; cursor: pointer; width: 30px; height: 30px; border-radius: 8px; color: var(--fg-soft); font-size: 16px; line-height: 1; display: inline-flex; align-items: center; justify-content: center; }
.theme-toggle:hover { background: var(--bg-hover); color: var(--fg); }

.input { width: 100%; padding: 7px 11px; border: 1px solid var(--border); border-radius: var(--radius); background: var(--bg); outline: none; transition: border-color .15s, box-shadow .15s; }
.input:focus { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
.btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; padding: 6px 14px; border-radius: var(--radius); border: 1px solid var(--border); background: var(--bg); color: var(--fg); cursor: pointer; font-size: 14px; white-space: nowrap; transition: background .15s; }
.btn:hover { background: var(--bg-hover); text-decoration: none; }
.btn:disabled { opacity: .55; cursor: not-allowed; }
.btn-primary { background: var(--accent); border-color: var(--accent); color: var(--accent-fg); }
.btn-primary:hover { background: color-mix(in srgb, var(--accent) 88%, black); }
.btn-danger { color: var(--danger); }
.btn-sm { padding: 3px 10px; font-size: 13px; }
button.link { background: none; border: 0; padding: 0; cursor: pointer; color: var(--accent); }

.badge { display: inline-flex; align-items: center; gap: 4px; padding: 1px 8px; font-size: 12px; border-radius: 999px; border: 1px solid var(--border); color: var(--fg-soft); background: var(--bg-soft); }
.badge.public { color: var(--ok); border-color: color-mix(in srgb, var(--ok) 35%, transparent); }
.badge.protected { color: var(--warn); border-color: color-mix(in srgb, var(--warn) 35%, transparent); }
.badge.draft { color: var(--fg-muted); border-style: dashed; }

.layout { flex: 1 0 auto; display: grid; grid-template-columns: 270px minmax(0, 1fr); }
.sidebar { border-right: 1px solid var(--border); background: var(--bg-soft); padding: 16px 10px; position: sticky; top: 52px; max-height: calc(100vh - 52px); overflow-y: auto; }
.sidebar h3 { font-size: 12px; text-transform: uppercase; letter-spacing: .6px; color: var(--fg-muted); margin: 4px 10px 8px; display: flex; align-items: center; justify-content: space-between; }
.main { padding: 32px 48px 96px; min-width: 0; }
.container { width: 100%; max-width: 900px; margin: 0 auto; padding: 32px 20px 96px; }

.tree, .tree ul { list-style: none; margin: 0; padding: 0; }
.tree ul { padding-left: 14px; }
.tree a, .tree .row { display: block; padding: 4px 10px; border-radius: 6px; color: var(--fg-soft); font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.tree a:hover, .tree .row:hover { background: var(--bg-hover); text-decoration: none; }
.tree a.active, .tree .row.active { background: var(--accent-soft); color: var(--accent); font-weight: 500; }

.article { max-width: 760px; margin: 0 auto; }
.crumbs { font-size: 13px; color: var(--fg-muted); margin-bottom: 8px; display: flex; flex-wrap: wrap; gap: 6px; }
.crumbs a { color: var(--fg-muted); }
.doc-title { font-size: 34px; line-height: 1.25; font-weight: 700; margin: 0 0 10px; letter-spacing: -.3px; word-break: break-word; }
.doc-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; color: var(--fg-muted); font-size: 13px; margin-bottom: 28px; }
.doc-meta .actions { margin-left: auto; display: flex; gap: 8px; }

.prose { font-size: 16px; line-height: 1.75; word-break: break-word; }
.prose > :first-child { margin-top: 0; }
.prose h1, .prose h2, .prose h3, .prose h4 { line-height: 1.35; margin: 1.6em 0 .6em; font-weight: 650; }
.prose h1 { font-size: 1.75em; } .prose h2 { font-size: 1.4em; padding-bottom: .25em; border-bottom: 1px solid var(--border); } .prose h3 { font-size: 1.2em; } .prose h4 { font-size: 1.05em; }
.prose p { margin: .7em 0; }
.prose ul, .prose ol { padding-left: 1.6em; margin: .6em 0; }
.prose li > p { margin: .2em 0; }
.prose blockquote { margin: 1em 0; padding: .2em 1em; border-left: 3px solid var(--border); color: var(--fg-soft); }
.prose code { font-family: var(--mono); font-size: .88em; background: var(--code-bg); padding: .15em .4em; border-radius: 4px; }
.prose pre { background: var(--code-bg); padding: 14px 16px; border-radius: var(--radius); overflow-x: auto; font-size: 14px; line-height: 1.55; }
.prose pre code { background: none; padding: 0; font-size: inherit; }
.prose hr { border: 0; border-top: 1px solid var(--border); margin: 2em 0; }
.prose img { max-width: 100%; border-radius: 6px; }
.prose a { text-decoration: underline; text-underline-offset: 2px; }
.prose ul.task-list, .prose ul[data-type="taskList"] { list-style: none; padding-left: .2em; }
.prose li.task-item, .prose ul[data-type="taskList"] li { display: flex; gap: .5em; align-items: flex-start; }
.prose li.task-item input, .prose ul[data-type="taskList"] li > label { margin-top: .45em; }
.prose ul[data-type="taskList"] li > div { flex: 1; }

.card { border: 1px solid var(--border); border-radius: 12px; background: var(--bg); padding: 18px 20px; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 16px; }
.muted { color: var(--fg-muted); }
.small { font-size: 13px; }
.empty { color: var(--fg-muted); padding: 24px 0; text-align: center; }
.list { list-style: none; padding: 0; margin: 0; }
.list li { padding: 10px 0; border-bottom: 1px solid var(--border); }
.list li:last-child { border-bottom: 0; }
.notice { position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%); background: var(--fg); color: var(--bg); padding: 10px 16px; border-radius: 999px; box-shadow: var(--shadow); font-size: 14px; z-index: 50; }
.notice a { color: inherit; text-decoration: underline; margin-left: 8px; }

.bell { position: relative; }
.bell-count { display: inline-block; min-width: 16px; height: 16px; padding: 0 4px; margin-left: 3px; border-radius: 999px; background: var(--danger); color: #fff; font-size: 11px; line-height: 16px; text-align: center; vertical-align: 1px; }
.bell-count[hidden] { display: none; }
.mention { color: var(--accent); font-weight: 500; }
.comment-body a { text-decoration: underline; text-underline-offset: 2px; word-break: break-all; }
.comment:target { background: var(--accent-soft); border-radius: 6px; }
.site-footer { margin-top: auto; padding: 20px 16px 28px; text-align: center; font-size: 12px; color: var(--fg-muted); border-top: 1px solid var(--border); }
.site-footer a { color: inherit; text-decoration: underline; text-underline-offset: 2px; }

.discussion { margin-top: 56px; padding-top: 20px; border-top: 1px solid var(--border); }
.discussion h2 { font-size: 18px; margin: 0 0 12px; }
.thread { padding: 12px 0; border-bottom: 1px solid var(--border); }
.thread .comment + .comment { margin: 10px 0 0 16px; padding-left: 12px; border-left: 2px solid var(--border); }
.comment-head { display: flex; align-items: baseline; gap: 8px; font-size: 13px; color: var(--fg-muted); }
.comment-head strong { color: var(--fg); font-weight: 600; }
.comment-del { margin-left: auto; font-size: 12px; color: var(--fg-muted) !important; }
.comment-body { margin-top: 2px; font-size: 14px; line-height: 1.6; white-space: pre-wrap; word-break: break-word; }
.comment-form { display: flex; flex-direction: column; gap: 8px; margin-top: 12px; }
.comment-form textarea { resize: vertical; font: inherit; font-size: 14px; }
.thread .comment-form { margin-left: 16px; }

@media (max-width: 860px) {
  .layout { grid-template-columns: 1fr; }
  .sidebar { position: static; height: auto; max-height: none; border-right: 0; border-bottom: 1px solid var(--border); }
  .main { padding: 24px 16px 80px; }
  .topbar { padding: 0 12px; gap: 10px; }
  .topbar .search { max-width: none; }
  .doc-title { font-size: 26px; }
}
`

/** 站点名可自定义，页脚保留项目出处 */
export const POWERED_BY = 'Powered by <a href="https://github.com/tech-cats/outflow" target="_blank" rel="noopener">Outflow</a>'

/** 放在 <head> 最前面：渲染前应用用户选择的主题，避免闪烁 */
export const THEME_INIT_JS = `try{var t=localStorage.getItem('outflow-theme');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t}catch(e){}`

/** 在浅色/深色之间切换（以当前实际生效的主题为准），并记住选择；SPA 端见 web/src/theme.ts */
export const THEME_TOGGLE_JS = `function(){var r=document.documentElement,c=r.dataset.theme||(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'),n=c==='dark'?'light':'dark';r.dataset.theme=n;try{localStorage.setItem('outflow-theme',n)}catch(e){}}`
