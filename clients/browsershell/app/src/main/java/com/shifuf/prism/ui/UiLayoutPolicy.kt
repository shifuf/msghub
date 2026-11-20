package com.shifuf.prism.ui

/** Window-based layout rules, independent of device orientation or Android views. */
object UiLayoutPolicy {
    fun menuColumns(widthDp: Int, fontScale: Float): Int =
        (widthDp / (80f * fontScale.coerceIn(1f, 2f))).toInt().coerceIn(2, 5)

    fun contentInset(widthDp: Int): Int = maxOf(16, (widthDp - 720) / 2)

    fun sheetHeight(heightDp: Int): Int =
        minOf(640, (heightDp - 32).coerceAtLeast(0))
}

object UiSearch {
    fun matches(query: String, vararg fields: String?): Boolean {
        val text = fields.filterNotNull().joinToString(" ")
        return query.trim().split(Regex("\\s+")).all { text.contains(it, ignoreCase = true) }
    }
}
