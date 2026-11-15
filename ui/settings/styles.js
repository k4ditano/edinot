// Estilos de la página de Ajustes y de los controles compartidos
// (controls.jsx). Se inyectan una vez en <head> para no tocar el build ni
// ui/shell.css; usan sus tokens (--bg, --side, --line, --accent…).

const CSS = `
/* ── Controles compartidos (.ui-*) ───────────────────────────────── */
.ui-switch {
  width: 38px; height: 22px; border-radius: 999px; border: 0; padding: 2px; flex: none;
  display: inline-flex; justify-content: flex-start; cursor: pointer;
  background: color-mix(in srgb, var(--line) 70%, var(--muted));
  transition: background-color .15s ease;
}
.ui-switch i {
  width: 18px; height: 18px; border-radius: 50%; background: #fff;
  box-shadow: 0 1px 2px rgba(0,0,0,.2); transition: transform .15s ease;
}
.ui-switch.on { background: var(--accent); }
.ui-switch.on i { transform: translateX(16px); }
.ui-switch:disabled { opacity: .5; cursor: default; }
.ui-switch:focus-visible, .ui-seg button:focus-visible, .ui-select:focus-visible, .ui-btn:focus-visible,
.ui-swatch:focus-visible, .st-sn:focus-visible, .st-theme:focus-visible, .ui-input:focus-visible,
.st-kbd-btn:focus-visible, .ui-slider input:focus-visible {
  outline: 2px solid var(--accent); outline-offset: 2px;
}
.ui-seg {
  display: inline-flex; padding: 3px; gap: 2px; background: var(--side);
  border: 1px solid var(--line); border-radius: 9px; font-size: 13px; flex: none;
}
.ui-seg button {
  height: 28px; padding: 0 12px; border-radius: 6px; border: 0; background: transparent;
  color: var(--muted); cursor: pointer; font-size: 13px; white-space: nowrap;
}
.ui-seg button:hover { color: var(--fg); }
.ui-seg button[aria-pressed=true] { background: var(--bg); color: var(--fg); box-shadow: 0 1px 2px rgba(0,0,0,.08); }
.macwin.dark .ui-seg button[aria-pressed=true] { background: var(--hover); box-shadow: 0 1px 2px rgba(0,0,0,.4); }
.ui-seg button:disabled { opacity: .45; cursor: default; }
.ui-seg.sm button { height: 24px; padding: 0 9px; font-size: 12.5px; }
.ui-select {
  height: 32px; min-width: 150px; max-width: 280px; display: inline-flex; align-items: center; gap: 8px;
  padding: 0 8px 0 12px; border-radius: 8px; border: 1px solid var(--line); background: var(--bg);
  color: var(--fg); font-size: 13.5px; cursor: pointer; text-align: left;
}
.ui-select:hover { border-color: color-mix(in srgb, var(--line) 55%, var(--fg)); }
.ui-select:disabled { opacity: .5; cursor: default; }
.ui-select svg { color: var(--muted); }
.ui-select-val { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ui-listbox {
  position: fixed; z-index: 9995; margin: 0; padding: 5px; list-style: none; box-sizing: border-box;
  max-height: 320px; overflow-y: auto; outline: none;
  background: var(--bg); color: var(--fg); border-radius: 10px; font-family: var(--font-ui); font-size: 13.5px;
  box-shadow: 0 12px 32px rgba(20,24,16,.16), 0 0 0 1px rgba(20,24,16,.07);
}
:root.dark .ui-listbox, :root.dark .ui-popover { box-shadow: 0 14px 36px rgba(0,0,0,.5), 0 0 0 1px rgba(255,255,255,.08); }
.ui-option { display: flex; align-items: center; gap: 8px; min-height: 30px; padding: 4px 10px; border-radius: 7px; cursor: pointer; }
.ui-option.active { background: var(--hover); }
.ui-option[aria-selected=true] { font-weight: 500; }
.ui-option svg { color: var(--accent); margin-left: auto; }
.ui-option-label { flex: 1; min-width: 0; }
.ui-option-hint { color: var(--muted); font-size: 12px; }
.ui-option.disabled { opacity: .45; cursor: default; }
.ui-slider { display: inline-flex; align-items: center; gap: 10px; color: var(--muted); font-size: 12px; }
.ui-slider-max { font-size: 17px; }
.ui-slider input {
  -webkit-appearance: none; appearance: none; height: 4px; border-radius: 999px; margin: 0; cursor: pointer;
  background: linear-gradient(to right, var(--accent) var(--pct, 50%), var(--line) var(--pct, 50%));
}
.ui-slider input::-webkit-slider-thumb {
  -webkit-appearance: none; width: 18px; height: 18px; border-radius: 50%; background: #fff;
  border: 0; box-shadow: 0 1px 3px rgba(0,0,0,.3), 0 0 0 1px rgba(0,0,0,.06);
}
.ui-btn {
  height: 32px; padding: 0 14px; border-radius: 8px; font-size: 13.5px; font-weight: 500; cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center; gap: 6px; white-space: nowrap; flex: none;
  border: 1px solid var(--line); background: var(--bg); color: var(--fg); text-decoration: none;
}
.ui-btn:hover { background: var(--hover); }
.ui-btn:disabled { opacity: .5; cursor: default; }
.ui-btn.sm { height: 28px; padding: 0 10px; font-size: 12.5px; }
.ui-btn-primary { background: var(--accent); border-color: var(--accent); color: var(--accent-fg); }
.ui-btn-primary:hover { background: color-mix(in srgb, var(--accent) 88%, #000); }
.ui-btn-danger { color: #b3261e; }
.macwin.dark .ui-btn-danger { color: #f2a59c; }
.ui-btn-danger:hover { background: color-mix(in srgb, #c53030 12%, var(--bg)); }
.ui-btn-ghost { border-color: transparent; background: transparent; color: var(--muted); }
.ui-btn-ghost:hover { color: var(--fg); }
.ui-input {
  height: 32px; padding: 0 10px; border-radius: 8px; border: 1px solid var(--line); background: var(--bg);
  color: var(--fg); font-size: 13.5px; min-width: 0; box-sizing: border-box; outline: none;
}
.ui-input:focus { border-color: var(--accent); }
.ui-input.mono { font-family: var(--font-mono); font-size: 12.5px; }
.ui-kbds { display: inline-flex; gap: 3px; }
.ui-kbd {
  min-width: 22px; height: 22px; padding: 0 6px; box-sizing: border-box; border-radius: 6px;
  display: inline-flex; align-items: center; justify-content: center;
  font-family: var(--font-ui); font-size: 12px; font-weight: 500; color: var(--fg);
  background: var(--bg); border: 1px solid var(--line); box-shadow: 0 1px 0 var(--line);
}
.ui-swatches { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; justify-content: flex-end; }
.ui-swatch { width: 26px; height: 26px; border-radius: 50%; border: 0; padding: 0; cursor: pointer; flex: none; }
.ui-swatch.on { box-shadow: 0 0 0 2px var(--bg), 0 0 0 4px var(--sw); }
.ui-popover {
  position: fixed; z-index: 9995; box-sizing: border-box; padding: 12px; border-radius: 12px;
  background: var(--bg); color: var(--fg); font-family: var(--font-ui); font-size: 13px;
  box-shadow: 0 12px 32px rgba(20,24,16,.16), 0 0 0 1px rgba(20,24,16,.07);
}

/* ── Página ─────────────────────────────────────────────────────── */
.st-page { flex: 1; min-width: 0; min-height: 0; display: flex; background: var(--bg); color: var(--fg); }
.st-nav {
  width: 248px; flex: none; background: var(--side); border-right: 1px solid var(--line);
  padding: 16px 10px; box-sizing: border-box; display: flex; flex-direction: column; min-height: 0;
}
.st-nav-head { display: flex; align-items: center; gap: 4px; margin: 4px 0 12px; }
.st-nav h1 { font-size: 18px; font-weight: 600; margin: 0 0 0 10px; flex: 1; }
.st-search {
  display: flex; align-items: center; gap: 8px; height: 34px; padding: 0 10px; border-radius: 9px;
  border: 1px solid var(--line); background: var(--bg); color: var(--muted); font-size: 13px; margin: 0 2px 4px; flex: none;
}
.st-search:focus-within { border-color: var(--accent); }
.st-search input { flex: 1; min-width: 0; border: 0; outline: none; background: transparent; font: inherit; color: var(--fg); }
.st-search input::placeholder { color: var(--muted); }
.st-search-clear { border: 0; background: none; color: var(--muted); cursor: pointer; padding: 2px; display: inline-flex; border-radius: 4px; }
.st-nav-scroll { flex: 1; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; margin: 0 -4px; padding: 0 4px; }
.st-grp { font-size: 11.5px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; color: var(--muted); padding: 14px 10px 6px; margin: 0; }
.st-sn {
  display: flex; align-items: center; gap: 10px; min-height: 32px; padding: 0 10px; border-radius: 8px; color: var(--fg);
  font-size: 13.5px; border: 0; background: transparent; width: 100%; text-align: left; cursor: pointer; flex: none; box-sizing: border-box;
}
.st-sn:hover { background: var(--hover); }
.st-sn[aria-current=page] { background: var(--accent-soft); font-weight: 500; }
.st-sn-adv { margin-top: auto; color: var(--muted); }
.st-nav-spacer { flex: 1; min-height: 12px; }
.st-sr { display: flex; flex-direction: column; align-items: flex-start; gap: 1px; padding: 6px 10px; }
.st-sr-sec { font-size: 11.5px; color: var(--muted); font-weight: 400; }
.st-sr mark { background: var(--hl); color: inherit; border-radius: 2px; }
.st-sr.kfocus { box-shadow: inset 0 0 0 2px var(--accent); }
.st-empty { padding: 10px; color: var(--muted); font-size: 13px; }
.st-main { flex: 1; min-width: 0; overflow-y: auto; display: flex; justify-content: center; padding: 40px 48px 72px; box-sizing: border-box; scroll-padding-top: 24px; }
.st-col { width: 100%; max-width: 720px; }
.st-title { font-size: 26px; font-weight: 600; margin: 0 0 4px; letter-spacing: -.01em; }
.st-desc { margin: 0 0 24px; color: var(--muted); font-size: 14px; line-height: 1.5; }
.st-row { display: flex; align-items: center; gap: 24px; padding: 16px 0; border-top: 1px solid var(--line); border-radius: 2px; }
.st-row.last, .st-col > .st-row:last-child, .st-group > .st-row:last-child { border-bottom: 1px solid var(--line); }
.st-row.stack { flex-direction: column; align-items: stretch; gap: 12px; }
.st-lbl { flex: 1; min-width: 0; }
.st-lbl-t { display: block; font-weight: 500; font-size: 14.5px; }
.st-lbl-h { display: block; font-size: 13px; color: var(--muted); margin-top: 2px; line-height: 1.45; }
.st-lbl-h code, .st-hint code { font-family: var(--font-mono); font-size: 12px; background: var(--side); padding: 1px 4px; border-radius: 4px; }
.st-ctl { flex: none; display: flex; align-items: center; gap: 8px; max-width: 100%; flex-wrap: wrap; justify-content: flex-end; }
.st-row.stack > .st-ctl { justify-content: flex-start; flex: 1; }
.st-row.st-flash { animation: st-flash 1.6s ease-out; }
@keyframes st-flash { 0%, 35% { background: var(--accent-soft); box-shadow: 0 0 0 8px var(--accent-soft); } 100% { background: transparent; box-shadow: 0 0 0 8px transparent; } }
.st-group { margin-top: 32px; }
.st-desc + .st-group { margin-top: 0; }
.st-group-t { font-size: 15px; font-weight: 600; margin: 0 0 10px; }
.st-hint { font-size: 13px; color: var(--muted); line-height: 1.5; }
.st-notice { font-size: 13px; padding: 10px 12px; border-radius: 9px; background: var(--side); border: 1px solid var(--line); line-height: 1.45; margin: 8px 0; }
.st-notice.error { background: color-mix(in srgb, #c53030 9%, var(--bg)); border-color: color-mix(in srgb, #c53030 30%, var(--line)); color: color-mix(in srgb, #b3261e 70%, var(--fg)); }
.st-notice.ok { background: var(--accent-soft); border-color: color-mix(in srgb, var(--accent) 30%, var(--line)); }
.st-notice code { font-family: var(--font-mono); font-size: 12px; word-break: break-all; }
.st-inline { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; width: 100%; }
.st-inline > .ui-input { flex: 1; min-width: 160px; }
.st-field { display: flex; flex-direction: column; gap: 6px; flex: 1; min-width: 180px; font-size: 12.5px; color: var(--muted); }
.st-fields { display: flex; gap: 12px; flex-wrap: wrap; width: 100%; }
.st-pill { display: inline-flex; align-items: center; gap: 6px; height: 24px; padding: 0 10px; border-radius: 999px; font-size: 12.5px; font-weight: 500; background: var(--side); border: 1px solid var(--line); white-space: nowrap; }
.st-pill.ok { background: var(--accent-soft); border-color: transparent; color: var(--accent); }
.st-pill.bad { color: var(--muted); }
.st-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--faint); flex: none; display: inline-block; }
.st-dot.on { background: var(--accent); }
.st-dot.warn { background: #d8b04a; }
.st-dot.bad { background: #c53030; }
.st-list { display: flex; flex-direction: column; border: 1px solid var(--line); border-radius: 10px; overflow: hidden; width: 100%; }
.st-li { display: flex; align-items: center; gap: 10px; min-height: 44px; padding: 6px 8px 6px 12px; border-top: 1px solid var(--line); font-size: 13.5px; }
.st-li:first-child { border-top: 0; }
.st-li.on { background: var(--accent-soft); }
.st-li-main { flex: 1; min-width: 0; display: flex; align-items: center; gap: 10px; background: none; border: 0; padding: 0; color: inherit; font: inherit; text-align: left; cursor: pointer; min-height: 32px; }
.st-li-main:disabled { cursor: default; }
.st-li-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.st-li-meta { color: var(--muted); font-size: 12.5px; white-space: nowrap; }
.st-li-ic { width: 30px; height: 30px; flex: none; display: inline-flex; align-items: center; justify-content: center; border: 0; border-radius: 7px; background: transparent; color: var(--muted); cursor: pointer; padding: 0; }
.st-li-ic:hover { background: var(--hover); color: var(--fg); }
.st-li-ic.danger:hover { color: #c53030; background: color-mix(in srgb, #c53030 10%, var(--bg)); }
.st-li-ic:disabled { opacity: .4; cursor: default; }
.st-vault-ic { width: 26px; height: 26px; border-radius: 7px; flex: none; display: inline-flex; align-items: center; justify-content: center; font-size: 14px; color: #fff; font-weight: 600; }
.st-role { font-size: 11.5px; font-weight: 600; padding: 2px 8px; border-radius: 999px; background: var(--side); border: 1px solid var(--line); color: var(--muted); text-transform: lowercase; }
.st-role.owner { background: var(--accent-soft); color: var(--accent); border-color: transparent; }
.st-sub { margin: 12px 0 0; padding: 14px; border: 1px solid var(--line); border-radius: 12px; background: var(--panel); display: flex; flex-direction: column; gap: 10px; width: 100%; box-sizing: border-box; }
.st-sub-head { display: flex; align-items: center; gap: 8px; }
.st-sub-head b { flex: 1; font-weight: 600; font-size: 13.5px; }
.st-sub-label { font-size: 11.5px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; color: var(--muted); }
.st-account { display: flex; align-items: center; gap: 14px; }
.st-avatar { width: 44px; height: 44px; border-radius: 50%; background: var(--accent); color: var(--accent-fg); display: inline-flex; align-items: center; justify-content: center; font-weight: 600; font-size: 18px; flex: none; }
.st-account-t { flex: 1; min-width: 0; }
.st-account-t b { display: block; font-size: 15px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.st-account-t span { display: block; font-size: 13px; color: var(--muted); margin-top: 2px; }
.st-meter { width: 220px; display: flex; flex-direction: column; gap: 6px; font-size: 12.5px; color: var(--muted); }
.st-meter-bar { height: 6px; border-radius: 999px; background: var(--line); overflow: hidden; }
.st-meter-bar i { display: block; height: 100%; background: var(--accent); border-radius: 999px; }
.st-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.st-chip { display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 6px 0 10px; border-radius: 999px; border: 1px solid var(--line); background: var(--bg); font-size: 13px; }
.st-chip.def { padding-right: 10px; color: var(--muted); }
.st-chip button { border: 0; background: none; color: var(--muted); cursor: pointer; padding: 2px; display: inline-flex; border-radius: 50%; }
.st-chip button:hover { color: var(--fg); background: var(--hover); }
.st-textarea { width: 100%; box-sizing: border-box; min-height: 240px; padding: 12px; border-radius: 10px; border: 1px solid var(--line); background: var(--bg); color: var(--fg); font-family: var(--font-mono); font-size: 12.5px; line-height: 1.55; resize: vertical; outline: none; }
.st-textarea:focus { border-color: var(--accent); }
.st-pre { margin: 0; padding: 10px 12px; border-radius: 9px; background: var(--side); border: 1px solid var(--line); font-family: var(--font-mono); font-size: 12px; overflow-x: auto; white-space: pre; }
.st-snip { display: flex; flex-direction: column; gap: 6px; width: 100%; }
.st-snip-head { display: flex; align-items: center; justify-content: space-between; font-family: var(--font-mono); font-size: 12px; color: var(--muted); }
.st-details { width: 100%; }
.st-details summary { cursor: pointer; font-size: 13.5px; font-weight: 500; color: var(--fg); padding: 4px 0; }
.st-details ol { margin: 8px 0 0; padding-left: 20px; line-height: 1.65; font-size: 13px; color: var(--muted); }
.st-details code { font-family: var(--font-mono); font-size: 12px; }
.st-stats { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; width: 100%; }
.st-stat { padding: 10px 12px; border: 1px solid var(--line); border-radius: 10px; background: var(--panel); }
.st-stat span { display: block; font-size: 12px; color: var(--muted); }
.st-stat b { display: block; font-size: 16px; font-weight: 600; margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.st-stat b.mono { font-family: var(--font-mono); font-size: 12.5px; }
.st-progress { height: 6px; border-radius: 999px; background: var(--line); overflow: hidden; width: 100%; }
.st-progress i { display: block; height: 100%; background: var(--accent); }
.st-cards { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; width: 100%; }
.st-card { display: flex; align-items: center; gap: 12px; padding: 12px; border: 1px solid var(--line); border-radius: 12px; background: var(--bg); color: var(--fg); cursor: pointer; text-align: left; font: inherit; }
.st-card:hover:not(:disabled) { background: var(--hover); }
.st-card:disabled { opacity: .6; cursor: default; }
.st-card-g { width: 34px; height: 34px; border-radius: 9px; background: var(--side); border: 1px solid var(--line); display: inline-flex; align-items: center; justify-content: center; font-weight: 600; flex: none; }
.st-card-t { flex: 1; min-width: 0; }
.st-card-t b { display: block; font-size: 13.5px; font-weight: 600; }
.st-card-t span { display: block; font-size: 12.5px; color: var(--muted); }
.st-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.st-table th { text-align: left; font-weight: 600; font-size: 12px; color: var(--muted); padding: 6px 8px; border-bottom: 1px solid var(--line); }
.st-table td { padding: 8px; border-bottom: 1px solid var(--line); }
.st-table td.mono { font-family: var(--font-mono); font-size: 12px; }
.st-cli-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; width: 100%; }
.st-cli { padding: 10px 12px; border: 1px solid var(--line); border-radius: 10px; background: var(--bg); }
.st-cli.on { border-color: color-mix(in srgb, var(--accent) 45%, var(--line)); background: var(--accent-soft); }
.st-cli-h { display: flex; align-items: center; justify-content: space-between; font-weight: 600; font-size: 13.5px; }
.st-cli-b { font-family: var(--font-mono); font-size: 11.5px; color: var(--muted); margin-top: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.st-update { display: flex; align-items: flex-start; gap: 14px; padding: 14px; border: 1px solid var(--line); border-radius: 12px; background: var(--panel); width: 100%; box-sizing: border-box; }
.st-update.available, .st-update.downloaded { border-color: color-mix(in srgb, var(--accent) 45%, var(--line)); }
.st-update.error { border-color: color-mix(in srgb, #c53030 45%, var(--line)); }
.st-update-ic { width: 36px; height: 36px; border-radius: 10px; background: var(--accent-soft); color: var(--accent); display: inline-flex; align-items: center; justify-content: center; flex: none; }
.st-update-ic .ic > svg { width: 18px; height: 18px; }
.st-update-ic.spin .ic { animation: st-spin 1.1s linear infinite; display: inline-flex; }
@keyframes st-spin { to { transform: rotate(360deg); } }
.st-update-t { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 8px; }
.st-update-t b { font-size: 14.5px; font-weight: 600; }
.st-update-t span { font-size: 13px; color: var(--muted); }
.st-shortcut-row { padding: 7px 0; min-height: 30px; }
.st-shortcut-row .st-lbl-t { font-size: 14px; }
.st-shortcut-row .st-ctl { gap: 6px; }
.st-sc-top { display: flex; flex-direction: column; gap: 8px; margin-bottom: 4px; }
.st-group > .st-shortcut-row:last-child { border-bottom: 1px solid var(--line); }
.st-kbd-btn { display: inline-flex; align-items: center; gap: 3px; min-height: 30px; padding: 3px 6px; border-radius: 8px; border: 1px dashed transparent; background: transparent; cursor: pointer; }
.st-kbd-btn:hover { border-color: var(--line); background: var(--side); }
.st-kbd-btn.rec { border-color: var(--accent); background: var(--accent-soft); color: var(--accent); font-size: 12.5px; padding: 0 10px; }
.st-kbd-btn.conflict .ui-kbd { border-color: #c53030; color: #b3261e; }
.macwin.dark .st-kbd-btn.conflict .ui-kbd { color: #f2a59c; }
.st-kbd-none { font-size: 12.5px; color: var(--faint); }
.st-conflict { font-size: 12.5px; color: #b3261e; display: block; margin-top: 2px; }
.macwin.dark .st-conflict { color: #f2a59c; }
.st-modified { font-size: 11.5px; color: var(--accent); font-weight: 500; margin-left: 6px; }

/* Tarjetas de tema */
.st-themes { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; margin-bottom: 22px; }
.st-themes.more { grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; margin: 0; width: 100%; }
.st-theme { padding: 0; border-radius: 12px; border: 1px solid var(--line); background: var(--bg); cursor: pointer; text-align: left; overflow: hidden; color: var(--fg); font: inherit; display: flex; flex-direction: column; }
.st-theme[aria-pressed=true] { border: 2px solid var(--accent); }
.st-theme-prev { display: flex; width: 100%; align-self: stretch; height: 92px; border-bottom: 1px solid var(--line); }
.st-themes.more .st-theme-prev { height: 58px; }
.st-theme-side { width: 34%; }
.st-theme-body { flex: 1; padding: 14px; display: flex; flex-direction: column; gap: 7px; }
.st-themes.more .st-theme-body { padding: 9px 10px; gap: 5px; }
.st-theme-body i { display: block; height: 6px; border-radius: 3px; }
.st-theme-body i:first-child { height: 9px; width: 70%; }
.st-theme-body i:nth-child(2) { width: 90%; }
.st-theme-body i:nth-child(3) { width: 80%; }
.st-theme-name { display: flex; align-items: center; justify-content: space-between; gap: 6px; padding: 10px 12px; font-size: 13.5px; font-weight: 500; }
.st-themes.more .st-theme-name { padding: 7px 10px; font-size: 12.5px; }
.st-theme-name svg { color: var(--accent); }
.st-theme-sys { background: linear-gradient(135deg, #F8F8F4 50%, #151714 50%); }
.st-custom-sw { width: 26px; height: 26px; border-radius: 50%; border: 1px dashed var(--faint); background: transparent; color: var(--muted); display: inline-flex; align-items: center; justify-content: center; cursor: pointer; padding: 0; flex: none; }
.st-custom-sw.on { border: 0; box-shadow: 0 0 0 2px var(--bg), 0 0 0 4px var(--sw); color: #fff; }
.st-pop-grid { display: grid; grid-template-columns: repeat(5, 26px); gap: 10px; justify-content: space-between; margin-bottom: 12px; }
.st-pop-row { display: flex; align-items: center; gap: 8px; }
.st-pop-row input[type=color] { width: 36px; height: 30px; padding: 0; border: 1px solid var(--line); border-radius: 7px; background: var(--bg); cursor: pointer; }
.st-pop-t { font-size: 12px; color: var(--muted); margin-bottom: 8px; font-weight: 500; }
.st-logo { max-height: 40px; max-width: 180px; border-radius: 6px; border: 1px solid var(--line); background: #fff; padding: 3px; }
.st-back { width: 30px; height: 30px; }

/* ── Interfaz compacta y reducir animaciones (aplican a toda la app) ── */
.macwin.ui-compact .sh-nav { height: 28px; font-size: 13.5px; }
.macwin.ui-compact .sh-tree-row, .macwin.ui-compact .sh-fav { height: 26px; min-height: 26px; font-size: 13px; }
.macwin.ui-compact .sh-sec-head { padding: 10px 10px 4px; }
.macwin.ui-compact .sh-search { height: 32px; }
.macwin.ui-compact .pal-row { min-height: 30px; padding-top: 4px; padding-bottom: 4px; }
.macwin.ui-compact .st-row:not(.st-shortcut-row) { padding: 11px 0; }
.macwin.ui-compact .st-sn { min-height: 28px; }
.macwin.reduce-motion *, .macwin.reduce-motion *::before, .macwin.reduce-motion *::after,
:root.reduce-motion body > * *, :root.reduce-motion body > *::before {
  animation-duration: .001ms !important; animation-iteration-count: 1 !important;
  transition-duration: .001ms !important; scroll-behavior: auto !important;
}

/* ═══ Diseño de referencia (2026-11-12): píldoras, pasteles y acento negro ═══ */
.ui-switch { background: color-mix(in srgb, var(--fg) 16%, var(--bg)); }
.ui-switch.on { background: var(--accent); }
.ui-seg { background: color-mix(in srgb, var(--fg) 6%, transparent); border: 0; border-radius: 999px; padding: 3px; }
.ui-seg button { height: 30px; border-radius: 999px; font-weight: 500; padding: 0 14px; }
.ui-seg button[aria-pressed=true] { background: var(--pill-bg); box-shadow: var(--shadow-pill); }
.macwin.dark .ui-seg button[aria-pressed=true] { background: var(--pill-bg); }
.ui-seg.sm button { height: 24px; }
.ui-select, .ui-input { height: 36px; border-radius: 12px; border-color: var(--line); }
.ui-input:focus, .st-search:focus-within { border-color: var(--fg); box-shadow: 0 0 0 3px color-mix(in srgb, var(--fg) 10%, transparent); }
.ui-btn { height: 34px; padding: 0 16px; border-radius: 999px; border-color: transparent; background: color-mix(in srgb, var(--fg) 6%, transparent); }
.ui-btn:hover { background: color-mix(in srgb, var(--fg) 10%, transparent); }
.ui-btn.sm { height: 30px; }
.ui-btn-primary { background: var(--accent); border-color: var(--accent); color: var(--accent-fg); }
.ui-btn-primary:hover { background: color-mix(in srgb, var(--accent) 86%, var(--bg)); }
.ui-btn-ghost { background: transparent; }
.ui-listbox, .ui-popover { border-radius: 16px; box-shadow: var(--shadow-pop); }
.ui-option { border-radius: 10px; min-height: 34px; }
.ui-option.active { background: color-mix(in srgb, var(--fg) 6%, transparent); }
.ui-option svg { color: var(--fg); }
.ui-kbd { border: 0; box-shadow: none; background: color-mix(in srgb, var(--fg) 9%, transparent); color: var(--muted); }
.ui-slider input::-webkit-slider-thumb { box-shadow: var(--shadow-pill); }

.st-nav { background: color-mix(in srgb, var(--side) 30%, var(--bg)); border-right: 0; padding: 22px 14px 14px; }
.st-nav h1 { font-size: 20px; font-weight: 600; letter-spacing: -0.02em; }
.st-search { border: 0; border-radius: 999px; background: color-mix(in srgb, var(--fg) 5%, transparent); height: 38px; padding: 0 14px; }
.st-grp { text-transform: none; letter-spacing: 0; font-size: 12px; font-weight: 500; padding: 16px 12px 6px; }
.st-sn { min-height: 38px; border-radius: 999px; padding: 0 14px; font-weight: 500; }
.st-sn:hover { background: color-mix(in srgb, var(--bg) 60%, transparent); }
.st-sn[aria-current=page] { background: var(--pill-bg); box-shadow: var(--shadow-pill); font-weight: 600; }
.st-title { font-size: 30px; font-weight: 600; letter-spacing: -0.03em; }
.st-row { border-top-color: var(--line); }
.st-lbl-t { font-weight: 600; }
.st-lbl-h code, .st-hint code { background: color-mix(in srgb, var(--fg) 7%, transparent); border-radius: 6px; }
.st-group-t { font-weight: 600; letter-spacing: -0.01em; }
.st-notice, .st-pre { border-radius: 16px; border: 0; background: color-mix(in srgb, var(--fg) 4.5%, transparent); }
.st-notice.ok { background: var(--pastel-green); color: var(--pastel-green-ink); }
.st-notice.error { background: var(--pastel-rose); color: var(--pastel-rose-ink); border: 0; }
.st-pill { background: color-mix(in srgb, var(--fg) 6%, transparent); border: 0; }
.st-pill.ok { background: var(--pastel-green); color: var(--pastel-green-ink); }
.st-role { border: 0; background: color-mix(in srgb, var(--fg) 6%, transparent); }
.st-role.owner { background: var(--pastel-lilac); color: var(--pastel-lilac-ink); }
.st-list, .st-sub, .st-update, .st-stat, .st-cli, .st-card, .st-textarea { border-radius: 20px; }
.st-list { border-color: var(--line); }
.st-li.on, .st-cli.on { background: color-mix(in srgb, var(--fg) 4%, transparent); }
.st-cli.on, .st-update.available, .st-update.downloaded { border-color: var(--fg); }
.st-update-ic { background: var(--pastel-blue); color: var(--pastel-blue-ink); border-radius: 12px; }
.st-card:hover:not(:disabled) { background: color-mix(in srgb, var(--fg) 3%, transparent); border-color: var(--fg); }
.st-card-g { background: color-mix(in srgb, var(--fg) 6%, transparent); border: 0; border-radius: 12px; }
.st-chip { border-color: transparent; background: color-mix(in srgb, var(--fg) 6%, transparent); }
.st-kbd-btn { border-radius: 999px; }
.st-kbd-btn.rec { border-color: var(--fg); background: color-mix(in srgb, var(--fg) 6%, transparent); color: var(--fg); }
.st-modified { color: var(--muted); }
.st-theme { border-radius: 20px; }
.st-theme[aria-pressed=true] { border: 2px solid var(--fg); }
.st-theme-name svg { color: var(--fg); }
.st-theme-side { opacity: .95; }
.st-avatar { background: var(--accent); }
.st-meter-bar i, .st-progress i { background: var(--accent); }

@media (max-width: 900px) {
  .st-nav { width: 200px; }
  .st-main { padding: 28px 20px 60px; }
  .st-cards, .st-cli-grid { grid-template-columns: minmax(0, 1fr); }
  .st-themes.more { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}

/* Sincronización: panel del código de emparejamiento y lista de equipos */
.st-pair { display: flex; gap: 20px; align-items: center; padding: 16px; border: 1px solid var(--line); border-radius: 12px; background: var(--side); width: 100%; box-sizing: border-box; flex-wrap: wrap; }
.st-pair-qr { border-radius: 8px; background: #fff; padding: 6px; flex: none; image-rendering: pixelated; }
.st-pair-main { flex: 1; min-width: 200px; }
.st-pair-code { font-family: var(--font-mono); font-size: 26px; font-weight: 600; letter-spacing: .08em; margin: 2px 0 4px; user-select: all; }
.st-devices { list-style: none; margin: 0; padding: 0; width: 100%; display: flex; flex-direction: column; }
.st-devices li { display: flex; align-items: center; gap: 14px; padding: 10px 0; border-top: 1px solid var(--line); }
.st-devices li:first-child { border-top: 0; padding-top: 2px; }
.st-dev-name { flex: 1; min-width: 0; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.st-share { display: flex; flex-direction: column; gap: 10px; align-items: flex-start; width: 100%; }
.st-share-opts { display: flex; flex-direction: column; gap: 8px; padding-left: 22px; }
.st-radio { display: inline-flex; align-items: center; gap: 8px; font-size: 13.5px; cursor: pointer; }
`;

let injected = false;
export function ensureSettingsStyles() {
  if (injected || typeof document === 'undefined') return;
  injected = true;
  const el = document.createElement('style');
  el.id = 'edinot-settings-css';
  el.textContent = CSS;
  document.head.appendChild(el);
}
