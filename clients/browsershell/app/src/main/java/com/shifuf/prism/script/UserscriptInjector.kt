package com.shifuf.prism.script

import android.util.Base64
import android.webkit.WebView
import com.shifuf.prism.BrowserApp

class UserscriptInjector(
    private val webView: WebView,
    private val store: UserscriptStore = BrowserApp.instance.scriptStore
) {
    fun injectForUrl(url: String?, stage: String) {
        if (url.isNullOrBlank() || url.startsWith("about:") || url.startsWith("data:")) return
        val scripts = store.enabledFor(url).filter { runAtMatches(it.runAt, stage) }
        if (scripts.isEmpty()) return
        val prelude = GmBridge.runtimePrelude()
        eval(prelude)
        scripts.forEach { script ->
            val body = stripMeta(script.source)
            val wrapped = """
                (function(){
                  try {
                    $body
                  } catch(e) {
                    console.error('[Userscript:${script.name}]', e);
                  }
                })();
            """.trimIndent()
            eval(wrapped)
        }
    }

    private fun runAtMatches(runAt: String, stage: String): Boolean {
        val r = runAt.lowercase()
        return when (stage) {
            "start" -> r.contains("start")
            "end" -> !r.contains("start") // document-end / document-idle / default
            else -> true
        }
    }

    private fun stripMeta(source: String): String {
        return source.replace(
            Regex("""//\s*==UserScript==[\s\S]*?//\s*==/UserScript==""", RegexOption.IGNORE_CASE),
            ""
        )
    }

    private fun eval(js: String) {
        // Prefer evaluateJavascript; base64 wrapper avoids quote hell for large scripts
        val b64 = Base64.encodeToString(js.toByteArray(Charsets.UTF_8), Base64.NO_WRAP)
        val loader = """
            (function(){
              try {
                const s = decodeURIComponent(escape(atob('$b64')));
                (0, eval)(s);
              } catch(e) { console.error('[Userscript inject]', e); }
            })();
        """.trimIndent()
        webView.post {
            webView.evaluateJavascript(loader, null)
        }
    }
}
