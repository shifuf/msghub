package com.shifuf.prism.core

import org.junit.Assert.*
import org.junit.Test

class SearchSuggestionsTest {
    private val older = HistoryEntry(1, "Kotlin 文档", "https://kotlinlang.org/docs", 10)
    private val recent = HistoryEntry(2, "Kotlin 入门", "https://example.com/kotlin", 20)

    @Test fun matchingHistoryComesBeforeBookmarksWithoutUnrelatedSites() {
        val result = SearchSuggestions.match("kotlin", listOf(older, recent),
            listOf(Bookmark(title = "Kotlin 收藏", url = "https://book.example/kotlin")))
        assertEquals(listOf(recent.url, older.url, "https://book.example/kotlin"), result.map { it.url })
        assertEquals(SearchSuggestions.Item.Kind.HISTORY, result.first().kind)
    }

    @Test fun emptyInputShowsRecentUniqueHistory() {
        val result = SearchSuggestions.match("  ", listOf(older, recent, older.copy(id = 3, visitedAt = 30)))
        assertEquals(listOf(older.url, recent.url), result.map { it.url })
    }

    @Test fun fullUrlAndChineseTitleMatchHistory() {
        assertEquals(listOf(older.url), SearchSuggestions.match("https://kotlinlang.org/do", listOf(older, recent)).map { it.url })
        assertEquals(listOf(recent.url), SearchSuggestions.match("入门", listOf(older, recent)).map { it.url })
    }

    @Test fun sameHistoryAndBookmarkUrlOnlyAppearsOnce() {
        val result = SearchSuggestions.match("kotlin", listOf(older), listOf(Bookmark(title = "Kotlin", url = older.url)))
        assertEquals(1, result.size)
        assertEquals(SearchSuggestions.Item.Kind.HISTORY, result.single().kind)
    }

    @Test fun queryDoesNotMatchJustBecauseItStartsWithOneLetterAlias() {
        assertTrue(SearchSuggestions.match("githubzzzz").isEmpty())
        assertTrue(SearchSuggestions.match("完全不存在的网站").isEmpty())
        assertEquals("GitHub", SearchSuggestions.match("git").first().title)
    }

    @Test fun preservesCaseSensitivePathsAndHonorsLimit() {
        val history = listOf(older.copy(url = "https://example.com/A"), recent.copy(url = "https://example.com/a"))
        assertEquals(2, SearchSuggestions.match("example.com", history).size)
        assertEquals(1, SearchSuggestions.match("", history, limit = 1).size)
        assertTrue(SearchSuggestions.match("", history, limit = 0).isEmpty())
    }

    @Test fun internalAndExecutableUrlsNeverBecomeSuggestions() {
        val history = listOf(older.copy(url = "javascript:alert(1)"), recent.copy(url = "about:home"))
        assertTrue(SearchSuggestions.match("", history).isEmpty())
    }
}
