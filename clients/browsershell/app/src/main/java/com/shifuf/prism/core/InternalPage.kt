package com.shifuf.prism.core

object InternalPage {
    fun isHome(url: String): Boolean {
        if (url == "about:home") return true
        return runCatching {
            val uri = java.net.URI(url)
            uri.scheme == "https" && uri.host == "home.local" &&
                (uri.path.isNullOrEmpty() || uri.path == "/") && uri.port == -1 && uri.userInfo == null
        }.getOrDefault(false)
    }
}
