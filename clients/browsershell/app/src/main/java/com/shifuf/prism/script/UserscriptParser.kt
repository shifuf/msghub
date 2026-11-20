package com.shifuf.prism.script

import java.util.regex.Pattern

data class Userscript(
    val id: String,
    val name: String,
    val namespace: String = "",
    val version: String = "1.0",
    val description: String = "",
    val matches: List<String> = listOf("*://*/*"),
    val excludes: List<String> = emptyList(),
    val runAt: String = "document-end",
    val grants: List<String> = emptyList(),
    val source: String,
    val updateUrl: String = "",
    val downloadUrl: String = "",
    var enabled: Boolean = true
)

object UserscriptParser {
    private val metaBlock = Regex(
        """//\s*==UserScript==([\s\S]*?)//\s*==/UserScript==""",
        RegexOption.IGNORE_CASE
    )
    private val metaLine = Regex("""//\s*@(\S+)\s+(.*)""")

    fun parse(source: String, fallbackId: String = System.currentTimeMillis().toString()): Userscript {
        val block = metaBlock.find(source)?.groupValues?.getOrNull(1).orEmpty()
        val map = linkedMapOf<String, MutableList<String>>()
        block.lineSequence().forEach { line ->
            val m = metaLine.find(line.trim()) ?: return@forEach
            val key = m.groupValues[1].lowercase()
            val value = m.groupValues[2].trim()
            map.getOrPut(key) { mutableListOf() }.add(value)
        }
        fun first(key: String, default: String = "") = map[key]?.firstOrNull() ?: default
        val name = first("name", "未命名脚本")
        val id = first("namespace", "") + ":" + name + ":" + first("version", "1.0")
        return Userscript(
            id = id.ifBlank { fallbackId },
            name = name,
            namespace = first("namespace"),
            version = first("version", "1.0"),
            description = first("description"),
            matches = map["match"]?.ifEmpty { null } ?: listOf("*://*/*"),
            excludes = map["exclude"].orEmpty(),
            runAt = first("run-at", "document-end"),
            grants = map["grant"].orEmpty(),
            source = source,
            updateUrl = first("updateurl"),
            downloadUrl = first("downloadurl"),
            enabled = true
        )
    }

    fun matchesUrl(script: Userscript, url: String): Boolean {
        if (script.excludes.any { matchPattern(it, url) }) return false
        return script.matches.any { matchPattern(it, url) }
    }

    private fun matchPattern(pattern: String, url: String): Boolean {
        val regex = buildString {
            append('^')
            pattern.forEach { ch ->
                when (ch) {
                    '*' -> append(".*")
                    '?' -> append('.')
                    '.', '+', '(', ')', '[', ']', '{', '}', '^', '$', '|' -> {
                        append('\\'); append(ch)
                    }
                    else -> append(ch)
                }
            }
            append('$')
        }
        return runCatching { Pattern.compile(regex, Pattern.CASE_INSENSITIVE).matcher(url).find() }
            .getOrDefault(false)
    }
}
