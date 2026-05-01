export const STYLES = `
@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600;700&display=swap');

.wv-wrap{position:relative;width:100vw;height:100vh;overflow:hidden;font-family:var(--font-ui);background:var(--bg-solid);color:var(--text);
  display:flex;flex-direction:column}

.wv-scanlines{display:var(--scanlines);position:absolute;inset:0;z-index:15;pointer-events:none;
  background:repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(0,0,0,0.08) 2px,rgba(0,0,0,0.08) 4px)}

.wv-grid-overlay{display:var(--grid-display);position:absolute;inset:0;z-index:14;pointer-events:none;
  background-image:linear-gradient(rgba(0,255,65,0.03) 1px,transparent 1px),linear-gradient(90deg,rgba(0,255,65,0.03) 1px,transparent 1px);
  background-size:60px 60px;animation:gridPulse 4s ease-in-out infinite}
@keyframes gridPulse{0%,100%{opacity:1}50%{opacity:0.4}}

.wv-hud-corners{display:block;position:absolute;inset:0;z-index:14;pointer-events:none}
.wv-hud-inner{position:absolute;inset:8px;border:1px solid var(--border);border-radius:var(--corner-size);opacity:0.4}
.wv-hud-inner::before,.wv-hud-inner::after{content:'';position:absolute;width:16px;height:16px;border-color:var(--accent);border-style:solid;opacity:0.5}
.wv-hud-inner::before{top:-1px;left:-1px;border-width:2px 0 0 0}
.wv-hud-inner::after{bottom:-1px;right:-1px;border-width:0 0 2px 2px}

.wv-classification{display:var(--classification-display);position:absolute;top:52px;left:50%;transform:translateX(-50%);z-index:20;
  background:rgba(0,0,0,0.8);border:1px solid var(--border);padding:2px 16px;font-size:10px;font-family:var(--font-mono);letter-spacing:3px;color:var(--text)}

.wv-ticker{display:var(--ticker-display);position:absolute;bottom:28px;left:0;right:0;z-index:20;overflow:hidden;
  background:rgba(0,0,0,0.6);border-top:1px solid var(--border);border-bottom:1px solid var(--border);padding:3px 0;font-family:var(--font-mono);font-size:9px;color:var(--text-muted);white-space:nowrap}
.wv-ticker-inner{display:inline-block;animation:ticker 60s linear infinite}
@keyframes ticker{from{transform:translateX(0)}to{transform:translateX(-50%)}}

.wv-glow{text-shadow:0 0 8px var(--accent-glow),0 0 16px var(--accent-glow)}
.wv-blink{animation:blink 1.5s step-end infinite}
@keyframes blink{0%,100%{opacity:1}50%{opacity:0}}
.wv-pulse{animation:pulse 2s ease-in-out infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.5}}

.wv-loading-overlay{position:absolute;inset:0;z-index:50;background:var(--bg-solid);display:flex;align-items:center;justify-content:center}
.spinner{width:32px;height:32px;border:2px solid var(--border);border-top-color:var(--accent);border-radius:50%;animation:spin .8s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}

/* ── View mode toggle ── */
.wv-view-toggle{display:flex;gap:2px;background:var(--bg-solid);border:1px solid var(--border);border-radius:6px;padding:2px}
.wv-view-btn{padding:3px 10px;border:none;background:transparent;color:var(--text-muted);font-size:11px;font-family:inherit;cursor:pointer;border-radius:4px;transition:all .15s}
.wv-view-btn.active{background:var(--accent);color:#000;font-weight:600}

/* ── Theme switcher ── */
.wv-theme-switcher{position:relative}
.wv-theme-btn{width:28px;height:28px;border:1px solid var(--border);border-radius:6px;background:var(--bg-solid);color:var(--text);cursor:pointer;font-size:14px;display:flex;align-items:center;justify-content:center}
.wv-theme-dropdown{position:absolute;top:32px;right:0;background:var(--bg-solid);border:1px solid var(--border-hover);border-radius:8px;padding:4px;min-width:140px;z-index:40;box-shadow:0 4px 16px rgba(0,0,0,0.4)}
.wv-theme-option{display:flex;align-items:center;gap:6px;width:100%;padding:6px 8px;border:none;background:transparent;color:var(--text);font-size:12px;font-family:inherit;cursor:pointer;border-radius:4px;transition:background .1s}
.wv-theme-option:hover,.wv-theme-option.active{background:var(--bg-hover)}
.wv-theme-option .swatch{width:10px;height:10px;border-radius:50%;flex-shrink:0}

/* ── Cesium container ── */
.wv-map{position:relative;flex:1;min-height:0}

/* ── Sidebar ── */
.wv-sidebar{position:absolute;top:0;left:0;bottom:0;width:260px;z-index:25;background:var(--bg-nav);border-right:1px solid var(--border);
  backdrop-filter:blur(12px);overflow-y:auto;overflow-x:hidden;transition:transform .2s ease;
  box-shadow:calc(var(--glow-intensity) * 4px) 0 calc(var(--glow-intensity) * 16px) var(--accent-glow)}
.wv-sidebar.collapsed{transform:translateX(-260px)}
.wv-sidebar::-webkit-scrollbar{width:4px}
.wv-sidebar::-webkit-scrollbar-track{background:transparent}
.wv-sidebar::-webkit-scrollbar-thumb{background:var(--border);border-radius:2px}

.wv-sidebar-header{padding:12px 14px 8px;border-bottom:1px solid var(--border)}
.wv-sidebar-header h2{margin:0;font-size:13px;font-weight:700;letter-spacing:0.05em}
.wv-sidebar-header p{margin:2px 0 0;font-size:10px;color:var(--text-muted)}

.wv-section{border-bottom:1px solid var(--border)}
.wv-section-header{display:flex;justify-content:space-between;align-items:center;padding:8px 14px;cursor:pointer;font-size:11px;font-weight:600;color:var(--text-dim);user-select:none;transition:background .1s}
.wv-section-header:hover{background:var(--bg-hover)}
.wv-section-header .arrow{font-size:8px;transition:transform .2s}
.wv-section-header.open .arrow{transform:rotate(90deg)}
.wv-section-body{max-height:0;overflow:hidden;transition:max-height .25s ease}
.wv-section-body.open{max-height:600px}

.wv-row{display:flex;align-items:center;justify-content:space-between;padding:5px 14px;font-size:11px}
.wv-row label{display:flex;align-items:center;gap:6px;color:var(--text-dim)}
.wv-row input[type="checkbox"]{accent-color:var(--accent);width:14px;height:14px}

.dot{width:6px;height:6px;border-radius:50%;flex-shrink:0}

.wv-bm-grid{display:grid;grid-template-columns:1fr 1fr;gap:4px;padding:4px 10px 8px}
.wv-bm-btn{padding:5px;border:1px solid var(--border);border-radius:5px;background:transparent;color:var(--text-dim);font-size:10px;font-family:inherit;cursor:pointer;transition:all .15s}
.wv-bm-btn:hover{border-color:var(--border-hover);color:var(--text)}
.wv-bm-btn.active{border-color:var(--accent);color:var(--accent);background:var(--accent-glow)}

.wv-sidebar-toggle{position:absolute;top:50%;z-index:26;width:24px;height:48px;border:1px solid var(--border);border-radius:0 6px 6px 0;
  background:var(--bg-nav);color:var(--text-dim);font-size:14px;cursor:pointer;display:flex;align-items:center;justify-content:center;
  transition:left .2s ease;transform:translateY(-50%)}
.wv-sidebar:not(.collapsed) ~ .wv-sidebar-toggle{left:260px}

/* ── Context menu ── */
.wv-ctx-menu button{display:flex;align-items:center;gap:6px;width:100%;padding:6px 12px;border:none;background:transparent;color:var(--text);font-size:11px;font-family:inherit;cursor:pointer;text-align:left}
.wv-ctx-menu button:hover{background:var(--bg-hover)}
.wv-ctx-menu::-webkit-scrollbar{width:4px}
.wv-ctx-menu::-webkit-scrollbar-track{background:transparent}
.wv-ctx-menu::-webkit-scrollbar-thumb{background:var(--border);border-radius:2px}

/* ── Hover tooltip ── */
.wv-hover-tooltip{position:fixed;z-index:150;background:rgba(0,0,0,0.88);border:1px solid var(--border-hover);border-radius:6px;padding:5px 10px;box-shadow:0 2px 12px rgba(0,0,0,0.5);pointer-events:none;font-size:11px;font-family:var(--font-ui);color:var(--text);max-width:260px;white-space:nowrap;backdrop-filter:blur(8px);line-height:1.4}
.wv-hover-tooltip div{white-space:nowrap}

/* ── Elevation popup ── */
.wv-elev-popup{position:absolute;z-index:200;background:var(--bg-solid);border:1px solid var(--border);border-radius:6px;padding:6px 10px;
  box-shadow:0 4px 12px rgba(0,0,0,0.4);pointer-events:none;white-space:nowrap}
.wv-elev-popup .val{font-family:var(--font-mono);font-size:13px;font-weight:700;color:var(--accent)}
.wv-elev-popup .coords{font-size:10px;color:var(--text-muted);margin-top:1px}

/* ── Annotation inline edit ── */
.wv-annotation-input{background:var(--bg-solid);border:1px solid var(--accent);border-radius:4px;padding:4px 8px;
  color:var(--text);font-size:12px;font-family:var(--font-mono);width:200px;outline:none;
  box-shadow:0 2px 8px rgba(0,0,0,0.4)}

/* ── Status bar ── */
.wv-status{position:absolute;bottom:0;left:0;right:0;z-index:25;display:flex;align-items:center;gap:12px;
  padding:4px 12px;background:var(--bg-nav);border-top:1px solid var(--border);font-size:10px;backdrop-filter:blur(8px);
  box-shadow:0 calc(var(--glow-intensity) * -4px) calc(var(--glow-intensity) * 12px) var(--accent-glow)}
.wv-status-item{display:flex;align-items:center;gap:4px}
.indicator{width:6px;height:6px;border-radius:50%;flex-shrink:0}
.indicator.ok{background:var(--ok);box-shadow:0 0 calc(var(--glow-intensity) * 6px) var(--ok)}
.indicator.err{background:var(--err)}
.indicator.loading{background:var(--warn);animation:blink 1s step-end infinite}
.indicator.off{background:var(--text-darker)}
.wv-status-sep{width:1px;height:14px;background:var(--border)}
.wv-coords{color:var(--text-muted);font-family:var(--font-mono)}

/* ── Zoom controls ── */
.wv-zoom-controls{position:absolute;right:12px;bottom:40px;z-index:30;display:flex;flex-direction:column;gap:2px}
.wv-zoom-btn{width:32px;height:32px;border:1px solid var(--border);border-radius:6px;background:var(--bg-solid);color:var(--text);font-size:16px;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all .15s;backdrop-filter:blur(8px)}
.wv-zoom-btn:hover{border-color:var(--border-hover);background:var(--bg-hover)}
.wv-zoom-btn:active{transform:scale(0.95)}

/* ── Measurement tools bar ── */
.wv-tools-bar{position:absolute;left:12px;bottom:40px;z-index:30;display:flex;gap:2px;align-items:center}
.wv-tool-btn{display:flex;align-items:center;gap:4px;padding:6px 10px;border:1px solid var(--border);border-radius:6px;background:var(--bg-solid);color:var(--text-dim);font-size:10px;font-family:var(--font-mono);cursor:pointer;transition:all .15s;backdrop-filter:blur(8px);white-space:nowrap}
.wv-tool-btn:hover{border-color:var(--accent);color:var(--accent)}
.wv-tool-btn.active{border-color:var(--accent);color:var(--accent);background:rgba(74,158,255,0.1)}
.wv-tool-btn.clear{border-color:var(--err);color:var(--err)}
.wv-tool-btn.clear:hover{background:rgba(239,68,68,0.1)}
.wv-tool-btn svg{flex-shrink:0}

/* ── Orbital presets ── */
.wv-orbit-presets{position:absolute;right:12px;bottom:180px;z-index:30;display:flex;flex-direction:column;gap:2px}
.wv-orbit-btn{padding:4px 10px;border:1px solid var(--border);border-radius:6px;background:var(--bg-solid);color:var(--text-dim);font-size:10px;font-family:var(--font-mono);cursor:pointer;transition:all .15s;backdrop-filter:blur(8px);white-space:nowrap;text-align:right}
.wv-orbit-btn:hover{border-color:var(--accent);color:var(--accent)}
.wv-orbit-btn .alt{font-size:8px;color:var(--text-muted);margin-left:4px}

/* ── Compass ── */
.wv-compass{position:absolute;right:12px;top:56px;z-index:30;width:48px;height:48px;border:1px solid var(--border);border-radius:50%;background:var(--bg-solid);backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;cursor:pointer;transition:border-color .15s}
.wv-compass:hover{border-color:var(--border-hover)}
.wv-compass-inner{position:relative;width:32px;height:32px;transition:transform .1s linear}
.wv-compass-n{position:absolute;top:0;left:50%;transform:translateX(-50%);font-size:10px;font-weight:700;color:var(--err);font-family:var(--font-mono)}
.wv-compass-s{position:absolute;bottom:0;left:50%;transform:translateX(-50%);font-size:8px;color:var(--text-muted);font-family:var(--font-mono)}
.wv-compass-needle{position:absolute;top:6px;left:50%;transform:translateX(-50%);width:0;height:14px;border-left:2px solid transparent;border-right:2px solid transparent;border-bottom:14px solid var(--err)}

/* ── Space mode indicator ── */
.wv-space-badge{position:absolute;top:56px;left:50%;transform:translateX(-50%);z-index:30;padding:3px 12px;border:1px solid var(--accent);border-radius:4px;background:rgba(0,0,0,0.7);font-size:10px;font-family:var(--font-mono);color:var(--accent);letter-spacing:2px;backdrop-filter:blur(8px);display:none;pointer-events:none}
.wv-space-badge.visible{display:block}

/* ── Satellite info panel ── */
.wv-sat-info{position:absolute;left:50%;bottom:40px;transform:translateX(-50%);z-index:30;background:var(--bg-solid);border:1px solid var(--border);border-radius:8px;padding:8px 14px;font-family:var(--font-mono);font-size:11px;backdrop-filter:blur(12px);min-width:200px;display:flex;flex-direction:column;gap:4px;box-shadow:0 4px 16px rgba(0,0,0,0.5)}
.wv-sat-info .sat-name{font-weight:700;color:var(--accent);font-size:12px}
.wv-sat-info .sat-row{display:flex;justify-content:space-between;gap:12px}
.wv-sat-info .sat-label{color:var(--text-muted)}
.wv-sat-info .sat-val{color:var(--text)}
.wv-sat-info .sat-close{position:absolute;top:4px;right:6px;background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:14px}

/* ── Elevation profile panel ── */
.wv-profile-panel{position:absolute;left:12px;bottom:82px;z-index:30;background:rgba(0,0,0,0.9);border:1px solid var(--border);border-radius:8px;backdrop-filter:blur(12px);box-shadow:0 4px 16px rgba(0,0,0,0.5);overflow:hidden}
.wv-profile-header{display:flex;justify-content:space-between;align-items:center;padding:6px 10px;border-bottom:1px solid var(--border)}
.wv-profile-title{font-family:var(--font-mono);font-size:10px;font-weight:700;color:#ff4488;letter-spacing:1px}
.wv-profile-close{background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:16px;padding:0 4px;line-height:1}
.wv-profile-close:hover{color:var(--text)}
.wv-profile-chart{width:480px;height:180px}
.wv-profile-chart canvas{display:block}
.wv-profile-hint{padding:20px 24px;font-family:var(--font-mono);font-size:10px;color:var(--text-muted);white-space:nowrap}

/* ── Coordinate formats panel ── */
.wv-coord-panel{position:absolute;right:12px;top:110px;z-index:30;background:rgba(0,0,0,0.85);border:1px solid var(--border);border-radius:8px;padding:6px 10px;font-family:var(--font-mono);backdrop-filter:blur(12px);min-width:220px;box-shadow:0 4px 12px rgba(0,0,0,0.4)}
.wv-coord-close{position:absolute;top:4px;right:6px;background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:14px;padding:0 2px;line-height:1}
.wv-coord-close:hover{color:var(--text)}
.wv-coord-row{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:2px 0}
.wv-coord-row+.wv-coord-row{border-top:1px solid rgba(255,255,255,0.05)}
.wv-coord-label{font-size:9px;font-weight:700;color:var(--accent);letter-spacing:0.5px;min-width:32px}
.wv-coord-val{font-size:10px;color:var(--text-dim);cursor:pointer;transition:color .1s}
.wv-coord-val:hover{color:var(--text)}

/* ── Widget system ── */
.wv-widget{position:absolute;z-index:30;background:var(--bg-nav);border:1px solid var(--border);border-radius:8px;backdrop-filter:blur(12px);box-shadow:0 4px 16px rgba(0,0,0,0.5);overflow:hidden;transition:box-shadow .15s;touch-action:none}
.wv-widget:hover{box-shadow:0 4px 20px rgba(0,0,0,0.6)}
.wv-widget-header{display:flex;align-items:center;gap:6px;padding:6px 10px;cursor:grab;user-select:none;font-size:11px;font-weight:600;font-family:var(--font-mono);color:var(--text-dim);border-bottom:1px solid var(--border);touch-action:none}
.wv-widget-header:active{cursor:grabbing}
.wv-widget-title{flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.wv-widget-header button{background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:12px;padding:0 4px;line-height:1;transition:color .1s}
.wv-widget-header button:hover{color:var(--text)}
.wv-widget-body{padding:8px;max-height:60vh;overflow-y:auto}
.wv-widget-body::-webkit-scrollbar{width:4px}
.wv-widget-body::-webkit-scrollbar-track{background:transparent}
.wv-widget-body::-webkit-scrollbar-thumb{background:var(--border);border-radius:2px}

.wv-widget-bar{position:absolute;top:56px;left:12px;z-index:40;display:flex;gap:4px;flex-wrap:wrap;max-width:calc(100vw - 24px)}
.wv-widget-bar-btn{padding:4px 8px;border:1px solid var(--border);border-radius:6px;background:var(--bg-solid);color:var(--text-dim);font-size:10px;font-family:var(--font-mono);cursor:pointer;transition:all .15s;backdrop-filter:blur(8px);display:flex;align-items:center;gap:4px;white-space:nowrap}
.wv-widget-bar-btn:hover{border-color:var(--accent);color:var(--accent)}
.wv-widget-bar-btn.hidden{opacity:0.35}

/* ── Basemap preview cards ── */
.wv-bm-preview-grid{display:grid;grid-template-columns:1fr 1fr;gap:6px}
.wv-bm-preview-card{display:flex;flex-direction:column;align-items:center;gap:4px;padding:6px;border:1px solid var(--border);border-radius:6px;background:transparent;color:var(--text-dim);cursor:pointer;transition:all .15s}
.wv-bm-preview-card:hover{border-color:var(--border-hover);color:var(--text)}
.wv-bm-preview-card.active{border-color:var(--accent);color:var(--accent);background:var(--accent-glow)}
.wv-bm-preview-thumb{width:100%;height:48px;border-radius:4px;background-size:cover;background-position:center}
.wv-bm-preview-label{font-size:10px;font-family:var(--font-mono)}

/* ── Settings rows ── */
.wv-setting-group{border-bottom:1px solid var(--border);padding-bottom:6px;margin-bottom:6px}
.wv-setting-group:last-child{border-bottom:none;margin-bottom:0;padding-bottom:0}
.wv-setting-label{font-size:10px;font-weight:600;color:var(--accent);letter-spacing:0.5px;margin-bottom:4px;font-family:var(--font-mono)}
.wv-setting-row{display:flex;align-items:center;justify-content:space-between;padding:3px 0;font-size:11px}
.wv-setting-row label{color:var(--text-dim);font-size:11px}
.wv-setting-row select,.wv-setting-row input[type="number"]{background:#1a1a1a;border:1px solid #333;border-radius:4px;padding:2px 6px;color:#ccc;font-size:11px;font-family:var(--font-mono);outline:none;max-width:100px}
.wv-setting-row select{cursor:pointer}
.wv-setting-reset{width:100%;padding:6px;border:1px solid var(--border);border-radius:4px;background:transparent;color:var(--text-muted);font-size:10px;font-family:var(--font-mono);cursor:pointer;transition:all .15s}
.wv-setting-reset:hover{border-color:var(--accent);color:var(--accent)}

/* ── Search results ── */
.wv-search-results{max-height:200px;overflow-y:auto}
.wv-search-item{display:block;width:100%;text-align:left;padding:5px 6px;border:none;background:transparent;color:var(--text-dim);font-size:10px;font-family:var(--font-mono);cursor:pointer;border-radius:4px;transition:background .1s}
.wv-search-item:hover{background:var(--bg-hover);color:var(--text)}

/* ── Bookmark list ── */
.wv-bookmark-item{display:flex;align-items:center;justify-content:space-between;padding:4px 0;gap:6px}
.wv-bookmark-name{flex:1;color:var(--text-dim);font-size:10px;font-family:var(--font-mono);cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.wv-bookmark-name:hover{color:var(--accent)}
.wv-bookmark-del{background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:12px;padding:0 4px}
.wv-bookmark-del:hover{color:var(--err)}
`;
