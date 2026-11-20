package com.shifuf.prism.core

/**
 * Address-bar suggestions: history + keyword/pinyin prefix sites + search.
 */
object SearchSuggestions {
    data class Item(
        val title: String,
        val subtitle: String,
        val url: String,
        val keywords: List<String> = emptyList(),
        val kind: Kind = Kind.SITE
    ) {
        enum class Kind { SEARCH, HISTORY, SITE, BOOKMARK }
    }

    private val sites = listOf(
        Item("百度", "baidu.com", "https://www.baidu.com", listOf("b", "ba", "bai", "baidu", "百度", "bd")),
        Item("哔哩哔哩", "bilibili.com", "https://www.bilibili.com", listOf("b", "bi", "bili", "bilibili", "哔哩", "哔哩哔哩", "b站", "bzhan")),
        Item("谷歌", "google.com", "https://www.google.com", listOf("g", "go", "google", "谷歌", "gg")),
        Item("知乎", "zhihu.com", "https://www.zhihu.com", listOf("z", "zh", "zhihu", "知乎")),
        Item("微博", "weibo.com", "https://m.weibo.cn", listOf("w", "wb", "weibo", "微博")),
        Item("淘宝", "taobao.com", "https://m.taobao.com", listOf("t", "tb", "taobao", "淘宝")),
        Item("京东", "jd.com", "https://m.jd.com", listOf("j", "jd", "jingdong", "京东")),
        Item("抖音", "douyin.com", "https://www.douyin.com", listOf("d", "dy", "douyin", "抖音")),
        Item("快手", "kuaishou.com", "https://www.kuaishou.com", listOf("k", "ks", "kuaishou", "快手")),
        Item("腾讯视频", "v.qq.com", "https://m.v.qq.com", listOf("t", "tx", "tengxun", "腾讯", "qq视频")),
        Item("爱奇艺", "iqiyi.com", "https://m.iqiyi.com", listOf("a", "aqy", "iqiyi", "爱奇艺")),
        Item("优酷", "youku.com", "https://www.youku.com", listOf("y", "yk", "youku", "优酷")),
        Item("网易云音乐", "music.163.com", "https://music.163.com", listOf("w", "wyy", "wangyiyun", "网易云", "网易")),
        Item("GitHub", "github.com", "https://github.com", listOf("g", "gh", "git", "github")),
        Item("Stack Overflow", "stackoverflow.com", "https://stackoverflow.com", listOf("s", "so", "stack", "stackoverflow")),
        Item("必应", "bing.com", "https://www.bing.com", listOf("b", "bi", "bing", "必应")),
        Item("搜狗", "sogou.com", "https://m.sogou.com", listOf("s", "sg", "sogou", "搜狗")),
        Item("360搜索", "so.com", "https://m.so.com", listOf("3", "360", "so")),
        Item("小红书", "xiaohongshu.com", "https://www.xiaohongshu.com", listOf("x", "xhs", "xiaohongshu", "小红书")),
        Item("豆瓣", "douban.com", "https://m.douban.com", listOf("d", "db", "douban", "豆瓣")),
        Item("CSDN", "csdn.net", "https://www.csdn.net", listOf("c", "csdn")),
        Item("掘金", "juejin.cn", "https://juejin.cn", listOf("j", "jj", "juejin", "掘金")),
        Item("微信读书", "weread.qq.com", "https://weread.qq.com", listOf("w", "wxds", "weread", "微信读书")),
        Item("高德地图", "amap.com", "https://m.amap.com", listOf("g", "gd", "gaode", "高德", "地图")),
        Item("12306", "12306.cn", "https://www.12306.cn", listOf("1", "12306", "火车")),
        Item("今日头条", "toutiao.com", "https://m.toutiao.com", listOf("j", "tt", "toutiao", "头条")),
        Item("网易新闻", "163.com", "https://3g.163.com", listOf("w", "wy", "163", "网易"))
    )

    fun suggest(query: String, limit: Int = 6): List<Item> {
        val app = com.shifuf.prism.BrowserApp.instance
        return match(query, if (app.prefs.privateMode) emptyList() else app.historyStore.all(),
            app.bookmarks.all(), limit)
    }

    /** Local matches come first. Site shortcuts only fill a query with no local matches. */
    fun match(
        query: String,
        history: List<HistoryEntry> = emptyList(),
        bookmarks: List<Bookmark> = emptyList(),
        limit: Int = 6
    ): List<Item> {
        if (limit <= 0) return emptyList()
        val q = query.trim().lowercase(java.util.Locale.ROOT)
        fun matches(title: String, url: String) = q.isEmpty() ||
            title.lowercase(java.util.Locale.ROOT).contains(q) || url.lowercase(java.util.Locale.ROOT).contains(q)
        fun webUrl(url: String) = url.startsWith("https://", true) || url.startsWith("http://", true)
        val local = history.sortedByDescending { it.visitedAt }
            .filter { webUrl(it.url) && matches(it.title, it.url) }
            .map { Item(it.title.ifBlank { it.url }, "历史 · ${it.url}", it.url, kind = Item.Kind.HISTORY) } +
            if (q.isEmpty()) emptyList() else bookmarks
                .filter { webUrl(it.url) && matches(it.title, it.url) }
                .map { Item(it.title.ifBlank { it.url }, "书签 · ${it.url}", it.url, kind = Item.Kind.BOOKMARK) }
        if (local.isNotEmpty() || q.isEmpty()) return local.distinctBy { it.url }.take(limit)
        return sites.filter { item ->
            item.keywords.any { it.startsWith(q) } || matches(item.title, item.subtitle)
        }.distinctBy { it.url }.take(limit)
    }
}
