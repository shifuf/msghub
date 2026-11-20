package com.shifuf.prism.core

/** The homepage and native address bar use the same address/search decision. */
object NavigationInput {
    fun resolve(raw: String, search: (String) -> String): String {
        val text = raw.trim()
        if (text.isEmpty() || text == "about:home") return "about:home"
        if (listOf("http://", "https://", "file:", "data:").any { text.startsWith(it, true) }) return text
        return if (text.contains('.') && text.none { it.isWhitespace() }) "https://$text" else search(text)
    }
}
