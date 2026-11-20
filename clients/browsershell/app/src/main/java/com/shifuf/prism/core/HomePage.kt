package com.shifuf.prism.core

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import android.util.Base64
import java.io.ByteArrayOutputStream
import java.io.File

object HomePage {
    /**
     * Build home HTML. Wallpaper is always embedded as base64 JPEG when present,
     * so it works under WebView file/data security restrictions.
     */
    fun html(
        bgColor: String,
        logoText: String,
        engineName: String,
        wallpaperFile: File? = null,
        shortcuts: List<HomeShortcut> = emptyList(),
        iconDataUrls: Map<String, String> = emptyMap(),
        topInsetDp: Int = 72,
        bottomInsetDp: Int = 64
    ): String {
        val bg = sanitizeColor(bgColor)
        val logo = escapeHtml(logoText.take(2).ifBlank { "棱" })
        val safeEngine = escapeHtml(engineName)
        val light = isLightColor(bg)

        val inputText = if (light) "#111827" else "#F9FAFB"
        val inputPlaceholder = if (light) "rgba(17,24,39,.50)" else "rgba(249,250,251,.55)"
        val inputBg = if (light) "#FFFFFF" else "rgba(255,255,255,.16)"
        val inputBorder = if (light) "rgba(17,24,39,.16)" else "rgba(255,255,255,.28)"
        val fg = if (light) "#1F2328" else "#FFFFFF"
        val fgMuted = if (light) "rgba(31,35,40,.55)" else "rgba(255,255,255,.50)"
        val logoInner = if (light) "rgba(255,255,255,.96)" else "rgba(20,24,28,.92)"
        val logoInnerText = if (light) "#1F2328" else "#FFFFFF"
        val tileBg = if (light) "rgba(255,255,255,.88)" else "rgba(255,255,255,.14)"
        val tileBorder = if (light) "rgba(17,24,39,.10)" else "rgba(255,255,255,.16)"

        val wallData = wallpaperDataUrl(wallpaperFile)
        val hasWall = !wallData.isNullOrBlank()

        val wallCss = if (hasWall) {
            """
            html,body{
              background-color:$bg !important;
              background-image:url('$wallData') !important;
              background-position:center center !important;
              background-size:cover !important;
              background-repeat:no-repeat !important;
              background-attachment:fixed !important;
            }
            body::before{
              content:"";
              position:fixed;inset:0;z-index:0;pointer-events:none;
              background:linear-gradient(180deg,rgba(0,0,0,.18),rgba(0,0,0,.42));
            }
            .content{position:relative;z-index:1}
            """.trimIndent()
        } else {
            """
            html,body{background:$bg}
            .content{position:relative;z-index:1}
            """.trimIndent()
        }

        val finalFg = if (hasWall) "#FFFFFF" else fg
        val finalMuted = if (hasWall) "rgba(255,255,255,.62)" else fgMuted
        val finalInputText = if (hasWall) "#111827" else inputText
        val finalPlaceholder = if (hasWall) "rgba(17,24,39,.48)" else inputPlaceholder
        val finalInputBg = if (hasWall) "#FFFFFF" else inputBg
        val finalInputBorder = if (hasWall) "rgba(0,0,0,.12)" else inputBorder
        val finalLogoInner = if (hasWall) "rgba(20,24,28,.88)" else logoInner
        val finalLogoInnerText = if (hasWall) "#FFFFFF" else logoInnerText
        val finalTileBg = if (hasWall) "rgba(255,255,255,.16)" else tileBg
        val finalTileBorder = if (hasWall) "rgba(255,255,255,.22)" else tileBorder
        val finalTileText = if (hasWall) "#FFFFFF" else finalFg

        val shortcutTiles = buildString {
            shortcuts.forEach { s ->
                val cached = iconDataUrls[s.id].orEmpty()
                val icon = cached.ifBlank { s.iconUrl.ifBlank { HomeShortcutStore.faviconOf(s.url) } }
                val safeTitle = escapeHtml(s.title)
                val letter = escapeHtml(s.title.take(1).ifBlank { "?" }.uppercase())
                val hue = iconHue(s.url, s.title)
                append(
                    """
                    <a class="tile" href="${escapeHtml(s.url)}" data-id="${escapeHtml(s.id)}" draggable="true" title="$safeTitle">
                      <div class="icon-wrap">
                        <img class="icon" src="${escapeHtml(icon)}" alt="" loading="lazy"
                          onerror="this.onerror=null;this.style.display='none';var f=this.nextElementSibling;f.style.display='flex';f.style.background='hsl($hue 62% 48%)'"/>
                        <div class="icon-fallback" style="display:none;background:hsl($hue 62% 48%)">$letter</div>
                      </div>
                      <div class="label">$safeTitle</div>
                    </a>
                    """.trimIndent()
                )
            }
            append(
                """
                <a class="tile add" href="bshome://add" title="添加" draggable="false">
                  <div class="icon-wrap add-wrap"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg></div>
                  <div class="label">添加</div>
                </a>
                """.trimIndent()
            )
        }

        return """
<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"/>
<title>主页</title>
<style id="home-style">
  *{box-sizing:border-box;margin:0;padding:0}
  html,body{height:100%;width:100%;color:$finalFg;
    font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"PingFang SC","Microsoft YaHei",sans-serif}
  body{
    display:flex;flex-direction:column;align-items:center;
    padding:${topInsetDp.coerceIn(12, 24)}px 24px ${bottomInsetDp.coerceIn(16, 32)}px;
    overflow-x:hidden;overflow-y:auto;min-height:100%;
    -webkit-overflow-scrolling:touch;
  }
  $wallCss
  .content{width:min(680px,100%);display:flex;flex-direction:column;align-items:stretch;margin-top:2vh;animation:arrive .28s cubic-bezier(.22,1,.36,1) both}
  svg{width:24px;height:24px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round;flex-shrink:0}
  .brand{display:flex;align-items:center;gap:10px;margin-bottom:24px}.brand-copy{flex:1;min-width:0}.brand-action{width:48px;height:48px;display:flex;align-items:center;justify-content:center;border-radius:50%;background:$finalTileBg;color:$finalFg;text-decoration:none}.welcome{font-size:14px;color:$finalMuted;margin-top:8px;line-height:1.6}
  .eyebrow{font-size:10px;letter-spacing:2px;font-weight:600;color:$finalMuted;margin-bottom:5px}
  h1{font-size:24px;letter-spacing:-1px;font-weight:750;line-height:1.25}
  .logo{
    width:40px;height:40px;border-radius:13px;
    background:linear-gradient(145deg,#47A6FF,#007AFF);
    display:flex;align-items:center;justify-content:center;
    font-size:24px;font-weight:700;color:#fff;
    box-shadow:0 8px 24px rgba(0,122,255,.18);
    letter-spacing:-1px;flex-shrink:0;
  }
  .logo span{
    width:36px;height:36px;border-radius:11px;
    color:#fff;
    display:flex;align-items:center;justify-content:center;
  }
  form{width:100%;position:relative;max-width:100%}
  .search{
    width:100%;height:56px;border-radius:18px;
    border:1px solid $finalTileBorder;
    background:$finalInputBg;
    color:$finalInputText !important;
    -webkit-text-fill-color:$finalInputText !important;
    font-size:16px;padding:0 96px 0 46px;outline:none;
    box-shadow:0 4px 20px rgba(0,0,0,.035);
    transition:box-shadow .2s,border-color .2s;
    caret-color:$finalInputText;
  }
  .search::placeholder{color:$finalPlaceholder;opacity:1}
  .search-icon{position:absolute;left:15px;top:17px;width:22px;height:22px;color:$finalPlaceholder;pointer-events:none}
  .search:focus{border-color:#3B82F6;box-shadow:0 6px 20px rgba(59,130,246,.14)}
  .search::-webkit-search-cancel-button{-webkit-appearance:none;appearance:none;height:0;width:0}
  .clear{
    position:absolute;right:48px;top:28px;transform:translateY(-50%);
    width:44px;height:44px;border:0;border-radius:14px;
    background:transparent;color:$finalPlaceholder;
    display:none;align-items:center;justify-content:center;padding:0;
  }
  .clear.show{display:flex}
  .scan{position:absolute;right:4px;top:6px;width:44px;height:44px;display:flex;align-items:center;justify-content:center;border:0;border-radius:12px;background:transparent;color:$finalPlaceholder}
  .suggestions{position:relative;margin-top:8px;border-radius:16px;background:$finalInputBg;color:$finalInputText;overflow:hidden;max-height:42vh;overflow-y:auto;border:1px solid $finalInputBorder}
  .suggestions[hidden]{display:none}
  .suggestion{display:flex;align-items:center;gap:12px;min-height:56px;padding:10px 14px;color:inherit;text-decoration:none;border-bottom:1px solid $finalTileBorder}
  .suggestion:last-child{border-bottom:0}.suggestion svg{width:20px;height:20px;opacity:.55}
  .suggestion div{min-width:0;flex:1}.suggestion strong{display:block;font-size:14px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .suggestion small{display:block;margin-top:4px;font-size:11px;opacity:.6;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .hint{margin-top:12px;font-size:12px;color:$finalMuted;text-align:left;padding-left:4px}
  .section-head{display:flex;justify-content:space-between;align-items:center;margin:30px 0 14px;gap:12px}
  .section-head h2{font-size:21px;letter-spacing:-.5px}
  .section-head span{font-size:12px;color:$finalMuted}.section-head a{font-size:13px;color:${if (hasWall || !light) "#80BBFF" else "#007AFF"};text-decoration:none;min-height:44px;display:flex;align-items:center;gap:4px}.section-head a svg{width:16px;height:16px}
  .grid{
    width:100%;margin-top:24px;padding:0 4px;
    display:grid;grid-template-columns:repeat(4,minmax(0,1fr));
    gap:22px 10px;
    align-items:start;
  }
  .tile{
    display:flex;flex-direction:column;align-items:center;gap:8px;
    text-decoration:none;color:$finalTileText;
    -webkit-tap-highlight-color:transparent;
    min-width:0;transition:transform .18s,opacity .18s;
  }
  .icon-wrap{
    width:56px;height:56px;border-radius:16px;
    background:$finalTileBg;border:1px solid $finalTileBorder;
    display:flex;align-items:center;justify-content:center;
    overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.035);
    flex:0 0 56px;
  }
  .icon{
    width:32px;height:32px;object-fit:contain;border-radius:8px;
    image-rendering:auto;background:transparent;
  }
  .icon-fallback{
    width:100%;height:100%;align-items:center;justify-content:center;
    font-size:20px;font-weight:700;color:#fff;letter-spacing:0;
  }
  .add-wrap{background:rgba(0,122,255,.08)!important;border:0!important;color:#007AFF}
  .add-icon{
    font-size:30px;font-weight:300;color:#3B82F6;line-height:1;
  }
  .label{
    width:100%;max-width:90px;font-size:13px;line-height:1.4;text-align:center;
    white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
    text-shadow:${if (hasWall) "0 1px 2px rgba(0,0,0,.35)" else "none"};
  }
  .tile.add .label{color:$finalMuted}
  .tile.dragging{opacity:.35}
  .tile.drag-over .icon-wrap{outline:2px solid #3B82F6;outline-offset:2px;transform:scale(1.04)}
  .tile.lifted{
    position:relative;z-index:20;
    transform:scale(1.06);
    transition:transform .12s ease;
  }
  .tile.lifted .icon-wrap{box-shadow:0 10px 24px rgba(0,0,0,.22)}
  .ghost{
    position:fixed;z-index:9999;pointer-events:none;
    width:56px;height:56px;border-radius:16px;
    background:rgba(255,255,255,.95);
    box-shadow:0 10px 28px rgba(0,0,0,.28);
    display:flex;align-items:center;justify-content:center;
    overflow:hidden;opacity:.95;
  }
  .ghost img{width:32px;height:32px;object-fit:contain}
  .hint-bar{
    position:fixed;left:50%;bottom:calc(18px + env(safe-area-inset-bottom,0px));
    transform:translateX(-50%);
    background:rgba(17,24,39,.82);color:#fff;
    font-size:12px;padding:8px 14px;border-radius:999px;
    z-index:50;display:none;white-space:nowrap;
    backdrop-filter:blur(8px);
  }
  .hint-bar.show{display:block}
  .quick-actions{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin-top:28px}
  .quick-actions a{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;min-height:66px;padding:10px 4px;background:transparent;border-radius:14px;color:$finalTileText;text-decoration:none;font-size:12px;border:0;transition:transform .18s}
  .quick-actions svg{width:23px;height:23px;color:${if (hasWall || !light) "#80BBFF" else "#007AFF"}}
  .footer{margin-top:24px;text-align:center;color:$finalMuted;font-size:12px;letter-spacing:.3px}
  a:focus-visible,button:focus-visible{outline:2px solid #007AFF;outline-offset:4px}
  .tile:active,.quick-actions a:active{transform:scale(.95)}
  @keyframes arrive{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}
  @media(min-width:600px){.grid{grid-template-columns:repeat(6,minmax(0,1fr))}.content{margin-top:3vh}}
  @media(max-width:340px){body{padding-left:16px;padding-right:16px}.grid{grid-template-columns:repeat(3,minmax(0,1fr))}.quick-actions{grid-template-columns:repeat(2,minmax(0,1fr))}.quick-actions a{flex-direction:row;min-height:56px}.brand{margin-bottom:24px}h1{font-size:28px}}
  @media(max-height:500px){.content{margin-top:0}.brand{margin-bottom:16px}.section-head{margin-top:22px}}
  @media(prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}}
</style>
</head>
<body>
  <div class="content">
    <header class="brand"><div class="logo" aria-hidden="true"><span>$logo</span></div><div class="brand-copy"><h1>棱镜</h1></div><a class="brand-action" href="bshome://settings" aria-label="打开设置"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16 M4 17h16 M9 4v6 M15 14v6"/></svg></a></header>
    <form id="f">
      <svg class="search-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M10.5 4a6.5 6.5 0 1 0 0 13a6.5 6.5 0 1 0 0-13M16 16l5 5"/></svg>
      <input class="search" id="q" aria-label="搜索或输入网址" type="search" placeholder="$safeEngine 搜索或输入网址" enterkeyhint="search" autocomplete="off" inputmode="search"/>
      <button type="button" class="clear" id="c" aria-label="清空"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
      <button type="button" class="scan" id="scan" aria-label="扫一扫"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5M7 7h3v3H7zM14 7h3v3h-3zM7 14h3v3H7zM14 14h3v3h-3z"/></svg></button>
      <div id="suggestions" class="suggestions" aria-label="搜索建议" hidden></div>
    </form>
    <div class="grid" id="grid">
      $shortcutTiles
    </div>
    <nav class="quick-actions" aria-label="快捷访问">
      <a href="bshome://bookmarks"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9Z"/></svg>书签</a>
      <a href="bshome://history"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 11a9 9 0 1 1 2.6 7.4M3 4v7h7M12 7v5l3 2"/></svg>历史</a>
      <a href="bshome://downloads"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12M7 10l5 5 5-5M4 15v6h16v-6"/></svg>下载</a>
      <a href="bshome://messages"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5H4l-1 1V12.5A8.5 8.5 0 0 1 11.5 4H13a8 8 0 0 1 8 7.5M7 10h10M7 14h6"/></svg>消息</a>
    </nav>
  </div>
  <div class="hint-bar" id="hintBar">拖动排序 · 松手未移动则编辑</div>
<script>
  var q = document.getElementById('q');
  var c = document.getElementById('c');
  var grid = document.getElementById('grid');
  var hintBar = document.getElementById('hintBar');
  function syncClear(){ c.classList.toggle('show', !!q.value); }
  var suggestions = document.getElementById('suggestions');
  var suggestionTimer, suggestionToken = 0;
  function requestSuggestions(){
    clearTimeout(suggestionTimer);
    var token = ++suggestionToken;
    suggestionTimer = setTimeout(function(){
      if(document.activeElement !== q) return;
      location.href = 'bshome://suggest?q=' + encodeURIComponent(q.value.trim()) + '&token=' + token;
    }, 80);
  }
  window.showHomeSuggestions = function(token, query, items){
    if(token !== suggestionToken || q.value.trim() !== query || document.activeElement !== q) return;
    suggestions.replaceChildren();
    items.forEach(function(item){
      var a = document.createElement('a'); a.className = 'suggestion'; a.href = item.url;
      var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('viewBox','0 0 24 24');
      var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', item.kind === 'HISTORY' ? 'M3 11a9 9 0 1 1 2.6 7.4M3 4v7h7M12 7v5l3 2' : 'M4 4h16v16H4zM8 8h8M8 12h8');
      svg.appendChild(path); a.appendChild(svg);
      var text = document.createElement('div'), title = document.createElement('strong'), sub = document.createElement('small');
      title.textContent = item.title; sub.textContent = item.subtitle;
      text.appendChild(title); text.appendChild(sub); a.appendChild(text); suggestions.appendChild(a);
    });
    suggestions.hidden = !items.length;
  };
  window.dismissHomeSearch = function(){
    clearTimeout(suggestionTimer); ++suggestionToken;
    suggestions.replaceChildren(); suggestions.hidden = true; q.blur();
  };
  q.addEventListener('input', function(){ syncClear(); requestSuggestions(); });
  q.addEventListener('focus', requestSuggestions);
  q.addEventListener('blur', function(){ setTimeout(function(){ if(document.activeElement !== q) suggestions.hidden = true; }, 180); });
  c.addEventListener('mousedown', function(e){ e.preventDefault(); });
  c.addEventListener('click', function(){ q.value=''; syncClear(); q.focus(); requestSuggestions(); });
  document.getElementById('scan').addEventListener('click', function(){ location.href='bshome://scan'; });
  document.getElementById('f').addEventListener('submit', function(e){
    e.preventDefault();
    var v = q.value.trim();
    if(!v) return;
    location.href='bshome://navigate?q='+encodeURIComponent(v);
  });

  // Desktop right-click edit
  grid.addEventListener('contextmenu', function(e){
    var tile = e.target.closest('a.tile');
    if(!tile || tile.classList.contains('add')) return;
    e.preventDefault();
    var id = tile.getAttribute('data-id') || '';
    if(id) location.href = 'bshome://edit?id=' + encodeURIComponent(id);
  });

  // Touch: long-press then drag to reorder; release without move = edit
  var pressTimer = null;
  var activeTile = null;
  var activeId = null;
  var startX = 0, startY = 0;
  var dragging = false;
  var armed = false; // long-press armed
  var ghost = null;
  var suppressClick = false;
  var MOVE_SLOP = 10;

  function clearPressTimer(){
    if(pressTimer){ clearTimeout(pressTimer); pressTimer = null; }
  }
  function showHint(text){
    hintBar.textContent = text || '拖动排序 · 松手未移动则编辑';
    hintBar.classList.add('show');
  }
  function hideHint(){ hintBar.classList.remove('show'); }
  function clearDragOver(){
    Array.prototype.forEach.call(grid.querySelectorAll('.drag-over'), function(n){ n.classList.remove('drag-over'); });
  }
  function endDragVisual(){
    if(activeTile) activeTile.classList.remove('lifted','dragging');
    if(ghost && ghost.parentNode) ghost.parentNode.removeChild(ghost);
    ghost = null;
    clearDragOver();
    hideHint();
  }
  function tileFromPoint(x, y){
    var el = document.elementFromPoint(x, y);
    if(!el) return null;
    var t = el.closest('a.tile');
    if(!t || t.classList.contains('add')) return null;
    return t;
  }
  function armDrag(tile, id, x, y){
    armed = true;
    activeTile = tile;
    activeId = id;
    tile.classList.add('lifted');
    showHint('拖动可排序，松手未移动则编辑');
    // create ghost from icon
    ghost = document.createElement('div');
    ghost.className = 'ghost';
    var img = tile.querySelector('img.icon');
    if(img && img.style.display !== 'none'){
      var gimg = document.createElement('img');
      gimg.src = img.src;
      ghost.appendChild(gimg);
    } else {
      ghost.textContent = (tile.querySelector('.label')||{}).textContent || '';
      ghost.style.fontWeight = '700';
    }
    document.body.appendChild(ghost);
    ghost.style.left = (x - 26) + 'px';
    ghost.style.top = (y - 26) + 'px';
  }

  grid.addEventListener('touchstart', function(e){
    var tile = e.target.closest('a.tile');
    if(!tile || tile.classList.contains('add')) return;
    if(e.touches.length !== 1) return;
    var t = e.touches[0];
    startX = t.clientX; startY = t.clientY;
    dragging = false; armed = false; suppressClick = false;
    activeTile = tile;
    activeId = tile.getAttribute('data-id') || '';
    clearPressTimer();
    pressTimer = setTimeout(function(){
      pressTimer = null;
      if(!activeTile || !activeId) return;
      armDrag(activeTile, activeId, startX, startY);
    }, 380);
  }, {passive:true});

  grid.addEventListener('touchmove', function(e){
    if(!activeTile || e.touches.length !== 1) return;
    var t = e.touches[0];
    var dx = t.clientX - startX;
    var dy = t.clientY - startY;
    var dist = Math.sqrt(dx*dx + dy*dy);
    if(!armed){
      // cancel long-press if user scrolls early
      if(dist > MOVE_SLOP){ clearPressTimer(); activeTile = null; activeId = null; }
      return;
    }
    // armed: this is a drag
    if(dist > MOVE_SLOP) dragging = true;
    if(e.cancelable) e.preventDefault();
    if(ghost){
      ghost.style.left = (t.clientX - 26) + 'px';
      ghost.style.top = (t.clientY - 26) + 'px';
    }
    clearDragOver();
    var over = tileFromPoint(t.clientX, t.clientY);
    if(over && over !== activeTile) over.classList.add('drag-over');
  }, {passive:false});

  function finishTouch(e){
    clearPressTimer();
    var touch = (e.changedTouches && e.changedTouches[0]) || null;
    var x = touch ? touch.clientX : startX;
    var y = touch ? touch.clientY : startY;
    if(armed){
      suppressClick = true;
      if(dragging){
        var over = tileFromPoint(x, y);
        var toId = over ? (over.getAttribute('data-id') || '') : '';
        var fromId = activeId;
        endDragVisual();
        activeTile = null; activeId = null; armed = false; dragging = false;
        if(fromId && toId && fromId !== toId){
          location.href = 'bshome://reorder?from=' + encodeURIComponent(fromId) + '&to=' + encodeURIComponent(toId);
        }
      } else {
        // long-press without move → edit
        var id = activeId;
        endDragVisual();
        activeTile = null; activeId = null; armed = false; dragging = false;
        if(id) location.href = 'bshome://edit?id=' + encodeURIComponent(id);
      }
      return;
    }
    // normal tap navigation allowed
    activeTile = null; activeId = null;
  }
  grid.addEventListener('touchend', finishTouch, {passive:true});
  grid.addEventListener('touchcancel', function(){
    clearPressTimer(); endDragVisual();
    activeTile = null; activeId = null; armed = false; dragging = false;
  }, {passive:true});

  // Prevent click-through after drag/edit arm
  grid.addEventListener('click', function(e){
    if(suppressClick){
      e.preventDefault(); e.stopPropagation();
      suppressClick = false;
    }
  }, true);

  // Desktop HTML5 drag still supported
  var dragId = null;
  grid.addEventListener('dragstart', function(e){
    var tile = e.target.closest('a.tile');
    if(!tile || tile.classList.contains('add')) { e.preventDefault(); return; }
    dragId = tile.getAttribute('data-id');
    tile.classList.add('dragging');
    try { e.dataTransfer.setData('text/plain', dragId); e.dataTransfer.effectAllowed = 'move'; } catch(_){}
  });
  grid.addEventListener('dragend', function(e){
    var tile = e.target.closest('a.tile');
    if(tile) tile.classList.remove('dragging');
    clearDragOver();
    dragId = null;
  });
  grid.addEventListener('dragover', function(e){
    e.preventDefault();
    var tile = e.target.closest('a.tile');
    if(!tile || tile.classList.contains('add')) return;
    clearDragOver();
    tile.classList.add('drag-over');
  });
  grid.addEventListener('drop', function(e){
    e.preventDefault();
    var target = e.target.closest('a.tile');
    if(!target || target.classList.contains('add')) return;
    var toId = target.getAttribute('data-id');
    var fromId = dragId || (function(){ try { return e.dataTransfer.getData('text/plain'); } catch(_){ return ''; } })();
    if(fromId && toId && fromId !== toId){
      location.href = 'bshome://reorder?from=' + encodeURIComponent(fromId) + '&to=' + encodeURIComponent(toId);
    }
  });
</script>
</body>
</html>
        """.trimIndent()
    }

    fun wallpaperDataUrl(file: File?): String? {
        if (file == null || !file.exists() || file.length() < 32) return null
        return runCatching {
            val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            BitmapFactory.decodeFile(file.absolutePath, bounds)
            if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null

            val targets = listOf(1080 to 75, 900 to 70, 720 to 65, 540 to 60)
            for ((maxSide, quality) in targets) {
                var sample = 1
                while (bounds.outWidth / sample > maxSide || bounds.outHeight / sample > maxSide) {
                    sample *= 2
                }
                val bmp = BitmapFactory.decodeFile(
                    file.absolutePath,
                    BitmapFactory.Options().apply {
                        inSampleSize = sample
                        inPreferredConfig = Bitmap.Config.RGB_565
                    }
                ) ?: continue
                val baos = ByteArrayOutputStream()
                val ok = bmp.compress(Bitmap.CompressFormat.JPEG, quality, baos)
                bmp.recycle()
                if (!ok) continue
                val bytes = baos.toByteArray()
                if (bytes.size <= 350_000) {
                    return "data:image/jpeg;base64," + Base64.encodeToString(bytes, Base64.NO_WRAP)
                }
            }
            null
        }.getOrNull()
    }

    fun isLightColor(colorHex: String): Boolean {
        return try {
            val c = Color.parseColor(sanitizeColor(colorHex))
            val r = Color.red(c)
            val g = Color.green(c)
            val b = Color.blue(c)
            (r * 0.299 + g * 0.587 + b * 0.114) > 160
        } catch (_: Exception) {
            false
        }
    }

    private fun sanitizeColor(c: String): String {
        return try {
            Color.parseColor(c)
            c
        } catch (_: Exception) {
            "#2C333A"
        }
    }

    private fun escapeHtml(s: String): String =
        s.replace("&", "&amp;")
            .replace("<", "&lt;")
            .replace(">", "&gt;")
            .replace("\"", "&quot;")
            .replace("'", "&#39;")

    /** Stable hue 0-359 from host/title so fallback letter tiles look consistent. */
    private fun iconHue(url: String, title: String): Int {
        val key = (runCatching { android.net.Uri.parse(url).host }.getOrNull()
            ?: title.ifBlank { url }).lowercase()
        var h = 0
        for (c in key) h = (h * 31 + c.code) and 0x7fffffff
        return h % 360
    }
}
