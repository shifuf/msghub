package com.shifuf.prism.script

import android.webkit.JavascriptInterface
import android.webkit.WebView
import org.json.JSONObject

/**
 * JS bridge exposing a Greasemonkey-like GM_* subset under window.BS_GM.
 * Injected userscripts get a local alias: const GM_* = BS_GM.*
 */
class GmBridge(
    private val webView: WebView,
    private val storage: MutableMap<String, String> = linkedMapOf()
) {
    @JavascriptInterface
    fun getValue(name: String, defaultValue: String?): String {
        return storage[name] ?: defaultValue.orEmpty()
    }

    @JavascriptInterface
    fun setValue(name: String, value: String) {
        storage[name] = value
    }

    @JavascriptInterface
    fun deleteValue(name: String) {
        storage.remove(name)
    }

    @JavascriptInterface
    fun listValues(): String {
        return JSONObject(storage as Map<*, *>).toString()
    }

    @JavascriptInterface
    fun log(message: String) {
        android.util.Log.i("Userscript", message)
    }

    @JavascriptInterface
    fun notification(title: String, text: String) {
        android.util.Log.i("UserscriptNotify", "$title: $text")
    }

    companion object {
        const val INTERFACE_NAME = "BS_GM"

        /**
         * Runtime polyfill injected before each userscript.
         */
        fun runtimePrelude(): String = """
            (function(){
              if (window.__BS_GM_READY) return;
              window.__BS_GM_READY = true;
              const g = window.BS_GM || {};
              window.GM_getValue = function(k, d){ try { return g.getValue(String(k), d == null ? '' : String(d)); } catch(e){ return d; } };
              window.GM_setValue = function(k, v){ try { g.setValue(String(k), String(v)); } catch(e){} };
              window.GM_deleteValue = function(k){ try { g.deleteValue(String(k)); } catch(e){} };
              window.GM_listValues = function(){ try { return Object.keys(JSON.parse(g.listValues()||'{}')); } catch(e){ return []; } };
              window.GM_log = function(m){ try { g.log(String(m)); } catch(e){ console.log(m); } };
              window.GM_notification = function(a,b){
                try {
                  if (typeof a === 'object' && a) g.notification(String(a.title||''), String(a.text||a.detail||''));
                  else g.notification(String(a||''), String(b||''));
                } catch(e){}
              };
              window.GM_addStyle = function(css){
                try {
                  const s = document.createElement('style');
                  s.textContent = String(css||'');
                  (document.head || document.documentElement).appendChild(s);
                  return s;
                } catch(e){ return null; }
              };
              window.GM_xmlhttpRequest = function(details){
                // MVP: fallback to fetch; full cookie/header fidelity later
                details = details || {};
                const method = (details.method || 'GET').toUpperCase();
                const headers = details.headers || {};
                fetch(details.url, { method, headers, body: details.data })
                  .then(async (res) => {
                    const text = await res.text();
                    if (details.onload) details.onload({ status: res.status, responseText: text, responseHeaders: '' });
                  })
                  .catch((err) => { if (details.onerror) details.onerror({ error: String(err) }); });
              };
              window.unsafeWindow = window;
            })();
        """.trimIndent()
    }
}
