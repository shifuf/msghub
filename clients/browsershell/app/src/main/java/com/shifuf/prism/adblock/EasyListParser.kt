package com.shifuf.prism.adblock

import android.net.Uri
import java.util.regex.Pattern
import java.util.regex.PatternSyntaxException

/**
 * EasyList / Adblock Plus filter subset:
 * - comments: ! ...  and [Adblock Plus ...]
 * - domain anchors: ||example.com^
 * - start anchors: |https://...
 * - plain substring rules
 * - exception rules: @@...
 * - basic options after $ are mostly ignored (still match body)
 * - element hiding: ##selector / domain##selector  (collected for CSS inject)
 *
 * Not supported: advanced regex, complex option logic, procedural filters, snippets.
 */
class EasyListParser {
    data class ParsedList(
        val domainBlocks: Set<String>,
        val pathContains: List<String>,
        val startWith: List<String>,
        val regexBlocks: List<Pattern>,
        val domainExceptions: Set<String>,
        val pathExceptions: List<String>,
        val elementHiding: List<String>,
        val rawAccepted: Int,
        val rawSkipped: Int
    )

    fun parse(lines: Sequence<String>): ParsedList {
        val domainBlocks = HashSet<String>()
        val pathContains = ArrayList<String>()
        val startWith = ArrayList<String>()
        val regexBlocks = ArrayList<Pattern>()
        val domainExceptions = HashSet<String>()
        val pathExceptions = ArrayList<String>()
        val elementHiding = ArrayList<String>()
        var accepted = 0
        var skipped = 0

        lines.forEach { raw ->
            var line = raw.trim()
            if (line.isEmpty() || line.startsWith("!") || line.startsWith("[")) {
                return@forEach
            }

            // Element hiding: example.com##.ad  or ##.ad
            if (line.contains("##") && !line.contains("#@#") && !line.startsWith("@@")) {
                val idx = line.indexOf("##")
                val selector = line.substring(idx + 2).trim()
                if (selector.isNotEmpty() && !selector.startsWith("+js") && !selector.startsWith("^")) {
                    elementHiding.add(selector)
                    accepted++
                } else {
                    skipped++
                }
                return@forEach
            }
            if (line.contains("#@#") || line.contains("#?#") || line.contains("#\$#")) {
                skipped++
                return@forEach
            }

            val exception = line.startsWith("@@")
            if (exception) line = line.removePrefix("@@")

            // strip options
            val dollar = line.indexOf('$')
            if (dollar >= 0) {
                val options = line.substring(dollar + 1)
                // skip highly dynamic / unsupported option-only rules for safety
                if (options.contains("csp=") || options.contains("rewrite=") || options.contains("removeparam")) {
                    skipped++
                    return@forEach
                }
                line = line.substring(0, dollar)
            }
            line = line.trim()
            if (line.isEmpty()) {
                skipped++
                return@forEach
            }

            // regex rule /rule/
            if (line.startsWith("/") && line.lastIndexOf('/') > 0) {
                val end = line.lastIndexOf('/')
                val body = line.substring(1, end)
                try {
                    val p = Pattern.compile(body, Pattern.CASE_INSENSITIVE)
                    if (exception) {
                        // treat regex exceptions as path exceptions on pattern string
                        pathExceptions.add(body)
                    } else {
                        regexBlocks.add(p)
                    }
                    accepted++
                } catch (_: PatternSyntaxException) {
                    skipped++
                }
                return@forEach
            }

            when {
                line.startsWith("||") -> {
                    var domain = line.removePrefix("||")
                    domain = domain.trimEnd('^', '*', '/')
                    domain = domain.substringBefore("/")
                    domain = domain.substringBefore("^")
                    domain = domain.lowercase().trim()
                    if (domain.isNotEmpty() && !domain.contains("*") && !domain.contains(" ")) {
                        if (exception) domainExceptions.add(domain) else domainBlocks.add(domain)
                        accepted++
                    } else {
                        skipped++
                    }
                }
                line.startsWith("|") -> {
                    val body = line.removePrefix("|").trimEnd('|')
                    if (body.isNotEmpty()) {
                        if (exception) pathExceptions.add(body.lowercase()) else startWith.add(body.lowercase())
                        accepted++
                    } else skipped++
                }
                else -> {
                    val body = line.trimEnd('^').lowercase()
                    if (body.length >= 3) {
                        if (exception) pathExceptions.add(body) else pathContains.add(body)
                        accepted++
                    } else skipped++
                }
            }
        }

        return ParsedList(
            domainBlocks = domainBlocks,
            pathContains = pathContains.distinct(),
            startWith = startWith.distinct(),
            regexBlocks = regexBlocks,
            domainExceptions = domainExceptions,
            pathExceptions = pathExceptions.distinct(),
            elementHiding = elementHiding.distinct(),
            rawAccepted = accepted,
            rawSkipped = skipped
        )
    }

    fun matches(
        url: String,
        list: ParsedList
    ): Boolean {
        val uri = runCatching { Uri.parse(url) }.getOrNull() ?: return false
        val host = uri.host?.lowercase() ?: return false
        val path = (uri.encodedPath ?: uri.path ?: "").lowercase()
        val query = (uri.encodedQuery ?: uri.query ?: "").lowercase()
        val full = url.lowercase()

        // exceptions first
        if (list.domainExceptions.any { host == it || host.endsWith(".$it") }) return false
        if (list.pathExceptions.any { full.contains(it) }) return false

        // Domain rules are strongest and relatively safe
        if (list.domainBlocks.any { host == it || host.endsWith(".$it") }) return true

        // Avoid ultra-short substring rules that break sites (e.g. "ad", "banner")
        if (list.startWith.any { it.length >= 12 && full.startsWith(it) }) return true

        // Prefer path/query matches over full-URL contains; require longer needles
        if (list.pathContains.any { needle ->
                needle.length >= 8 && (
                    path.contains(needle) ||
                        query.contains(needle) ||
                        (needle.contains('.') && full.contains(needle)) // domain-like tokens
                    )
            }
        ) return true

        // Regex is expensive and often over-broad on mobile — only use longer patterns
        if (list.regexBlocks.any { p ->
                p.pattern().length >= 10 && runCatching { p.matcher(url).find() }.getOrDefault(false)
            }
        ) return true
        return false
    }
}
