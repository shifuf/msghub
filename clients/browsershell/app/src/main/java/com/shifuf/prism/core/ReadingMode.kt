package com.shifuf.prism.core

import android.webkit.WebView

/**
 * Lightweight reader mode: extract main content, strip chrome/ads, apply readable typography.
 */
object ReadingMode {
    fun inject(webView: WebView) {
        val js = """
            (function(){
              try {
                if (document.getElementById('__bs_reader_style')) {
                  // toggle off
                  var s = document.getElementById('__bs_reader_style');
                  if (s) s.remove();
                  var o = document.getElementById('__bs_reader_overlay');
                  if (o) o.remove();
                  document.documentElement.style.overflow = '';
                  return 'off';
                }
                function textLen(el){
                  return (el && el.innerText ? el.innerText : '').replace(/\s+/g,' ').trim().length;
                }
                var candidates = Array.prototype.slice.call(document.querySelectorAll('article, main, [role="main"], .post, .article, .content, #content, #main, .entry-content, .post-content'));
                if (!candidates.length) candidates = Array.prototype.slice.call(document.querySelectorAll('div, section'));
                var best = null, bestScore = 0;
                candidates.forEach(function(el){
                  var t = textLen(el);
                  if (t < 200) return;
                  var links = el.querySelectorAll('a').length;
                  var paras = el.querySelectorAll('p').length;
                  var score = t + paras * 80 - links * 20;
                  if (score > bestScore) { bestScore = score; best = el; }
                });
                if (!best) best = document.body;
                var title = (document.querySelector('h1') && document.querySelector('h1').innerText)
                  || document.title || '';
                var clone = best.cloneNode(true);
                clone.querySelectorAll('script,style,iframe,nav,aside,footer,form,button,noscript,[class*="ad"],[id*="ad"],[class*="share"],[class*="comment"]').forEach(function(n){ try{n.remove();}catch(e){} });
                var html = clone.innerHTML;
                var overlay = document.createElement('div');
                overlay.id = '__bs_reader_overlay';
                overlay.innerHTML = '<div class="bs-reader-card"><div class="bs-reader-bar"><button id="__bs_reader_close">退出阅读</button></div><h1 class="bs-reader-title"></h1><div class="bs-reader-body"></div></div>';
                overlay.querySelector('.bs-reader-title').textContent = title;
                overlay.querySelector('.bs-reader-body').innerHTML = html;
                var style = document.createElement('style');
                style.id = '__bs_reader_style';
                style.textContent = `
                  #__bs_reader_overlay{position:fixed;inset:0;z-index:2147483646;background:#F7F4EE;overflow:auto;-webkit-overflow-scrolling:touch}
                  .bs-reader-card{max-width:720px;margin:0 auto;padding:20px 18px 48px;color:#1F2328;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;line-height:1.75;font-size:17px}
                  .bs-reader-bar{display:flex;justify-content:flex-end;margin-bottom:12px;position:sticky;top:0;background:linear-gradient(#F7F4EE,rgba(247,244,238,.92));padding:8px 0}
                  #__bs_reader_close{border:0;background:#4C8BF5;color:#fff;border-radius:16px;padding:8px 14px;font-size:13px}
                  .bs-reader-title{font-size:26px;line-height:1.3;margin:0 0 18px;font-weight:700}
                  .bs-reader-body img,.bs-reader-body video{max-width:100%;height:auto;border-radius:10px;margin:12px 0}
                  .bs-reader-body p{margin:0 0 1em}
                  .bs-reader-body a{color:#2F6FED;text-decoration:none}
                  .bs-reader-body h1,.bs-reader-body h2,.bs-reader-body h3{line-height:1.35;margin:1.2em 0 .6em}
                `;
                document.documentElement.appendChild(style);
                document.documentElement.appendChild(overlay);
                document.documentElement.style.overflow = 'hidden';
                document.getElementById('__bs_reader_close').onclick = function(){
                  style.remove(); overlay.remove(); document.documentElement.style.overflow = '';
                };
                return 'on';
              } catch(e) { return 'error:' + e; }
            })();
        """.trimIndent()
        webView.evaluateJavascript(js, null)
    }
}
