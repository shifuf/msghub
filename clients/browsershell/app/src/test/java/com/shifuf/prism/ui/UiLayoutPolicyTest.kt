package com.shifuf.prism.ui

import org.junit.Assert.*
import org.junit.Test

class UiLayoutPolicyTest {
    @Test fun narrowWindowsAndLargeFontsKeepMenuTargetsReadable() {
        assertEquals(3, UiLayoutPolicy.menuColumns(280, 1f))
        assertEquals(4, UiLayoutPolicy.menuColumns(360, 1f))
        assertEquals(2, UiLayoutPolicy.menuColumns(320, 2f))
        assertEquals(5, UiLayoutPolicy.menuColumns(720, 1f))
    }

    @Test fun wideContentIsCenteredAndShortSheetsLeaveSpaceAbove() {
        assertEquals(16, UiLayoutPolicy.contentInset(360))
        assertEquals(140, UiLayoutPolicy.contentInset(1000))
        assertTrue(UiLayoutPolicy.sheetHeight(240) in 1..208)
        assertTrue(UiLayoutPolicy.sheetHeight(800) in 1..640)
        assertEquals(0, UiLayoutPolicy.sheetHeight(0))
    }

    @Test fun filteringMatchesAllWordsIgnoringCaseAndWhitespace() {
        assertTrue(UiSearch.matches("  浏览  UA ", "浏览器标识", "移动 UA"))
        assertFalse(UiSearch.matches("下载 目录", "下载", "系统引擎"))
        assertTrue(UiSearch.matches(" ", "任意条目"))
        assertTrue(UiSearch.matches("PRISM", "Prism 浏览器"))
    }
}
