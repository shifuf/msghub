package com.shifuf.prism.core

import java.util.ArrayDeque

data class NetworkEntry(
    val id: Long,
    val url: String,
    val method: String,
    val resourceType: String,
    val pageUrl: String,
    val blocked: Boolean,
    val timestamp: Long = System.currentTimeMillis()
)

class NetworkLogStore {
    private val lock = Any()
    // newest first
    private val entries = ArrayDeque<NetworkEntry>(MAX + 8)
    private var seq = 0L

    fun add(
        url: String,
        method: String,
        resourceType: String,
        pageUrl: String,
        blocked: Boolean
    ): NetworkEntry {
        val entry = NetworkEntry(
            id = synchronized(lock) { ++seq },
            url = url,
            method = method,
            resourceType = resourceType,
            pageUrl = pageUrl,
            blocked = blocked
        )
        synchronized(lock) {
            entries.addFirst(entry)
            while (entries.size > MAX) {
                entries.removeLast()
            }
        }
        return entry
    }

    fun snapshot(): List<NetworkEntry> = synchronized(lock) { entries.toList() }

    fun clear() = synchronized(lock) { entries.clear() }

    fun clearSince(sinceMs: Long): Int = synchronized(lock) {
        val before = entries.size
        val kept = entries.filter { it.timestamp < sinceMs }
        entries.clear()
        kept.forEach { entries.addLast(it) }
        before - entries.size
    }

    companion object {
        private const val MAX = 200
    }
}
