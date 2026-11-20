package com.shifuf.prism.core

import org.junit.Assert.*
import org.junit.Test

class InternalPageTest {
    @Test fun recognizesOnlyTheInternalHome() {
        assertTrue(InternalPage.isHome("about:home"))
        assertTrue(InternalPage.isHome("https://home.local/"))
        listOf("https://example.com/home.html", "https://home.local.evil/", "https://example.com/?q=home.local", "data:text/html,hello")
            .forEach { assertFalse(it, InternalPage.isHome(it)) }
    }
}
