package com.shifuf.prism.core

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.UUID

const val BOOKMARK_ROOT_ID = "root"

data class BookmarkFolder(
    val id: String = UUID.randomUUID().toString(),
    val name: String,
    val parentId: String = BOOKMARK_ROOT_ID,
    val createdAt: Long = System.currentTimeMillis()
)

data class Bookmark(
    val id: String = UUID.randomUUID().toString(),
    val title: String,
    val url: String,
    val folderId: String = BOOKMARK_ROOT_ID,
    val createdAt: Long = System.currentTimeMillis()
)

data class BookmarkNode(
    val folders: List<BookmarkFolder>,
    val bookmarks: List<Bookmark>
)

class BookmarkStore(context: Context) {
    private val file = File(context.filesDir, "bookmarks.json")
    private val folders = linkedMapOf<String, BookmarkFolder>()
    private val items = linkedMapOf<String, Bookmark>()

    init {
        load()
        ensureRoot()
    }

    fun all(): List<Bookmark> = items.values.sortedByDescending { it.createdAt }

    fun allFolders(): List<BookmarkFolder> =
        folders.values.filter { it.id != BOOKMARK_ROOT_ID }.sortedBy { it.name.lowercase() }

    fun folder(id: String): BookmarkFolder? = folders[id]

    fun folderPath(folderId: String): List<BookmarkFolder> {
        val path = ArrayList<BookmarkFolder>()
        var cur = folderId
        val guard = HashSet<String>()
        while (cur != BOOKMARK_ROOT_ID && guard.add(cur)) {
            val f = folders[cur] ?: break
            path.add(0, f)
            cur = f.parentId
        }
        return path
    }

    fun children(folderId: String = BOOKMARK_ROOT_ID): BookmarkNode {
        val subFolders = folders.values
            .filter { it.parentId == folderId && it.id != BOOKMARK_ROOT_ID }
            .sortedBy { it.name.lowercase() }
        val marks = items.values
            .filter { it.folderId == folderId }
            .sortedByDescending { it.createdAt }
        return BookmarkNode(subFolders, marks)
    }

    fun addFolder(name: String, parentId: String = BOOKMARK_ROOT_ID): BookmarkFolder {
        val clean = name.trim().ifBlank { "未命名文件夹" }
        val parent = if (folders.containsKey(parentId)) parentId else BOOKMARK_ROOT_ID
        val existing = folders.values.find { it.parentId == parent && it.name.equals(clean, true) }
        if (existing != null) return existing
        val f = BookmarkFolder(name = clean, parentId = parent)
        folders[f.id] = f
        persist()
        return f
    }

    fun renameFolder(id: String, name: String) {
        val f = folders[id] ?: return
        if (id == BOOKMARK_ROOT_ID) return
        folders[id] = f.copy(name = name.trim().ifBlank { f.name })
        persist()
    }

    fun removeFolder(id: String, recursive: Boolean = true) {
        if (id == BOOKMARK_ROOT_ID) return
        val toRemove = linkedSetOf(id)
        if (recursive) {
            var changed = true
            while (changed) {
                changed = false
                folders.values.forEach { f ->
                    if (f.parentId in toRemove && toRemove.add(f.id)) changed = true
                }
            }
        }
        toRemove.forEach { folders.remove(it) }
        val moveTo = BOOKMARK_ROOT_ID
        items.values.filter { it.folderId in toRemove }.forEach { b ->
            items[b.id] = b.copy(folderId = moveTo)
        }
        if (!recursive) {
            // already moved children of only this folder above if they were in toRemove
        }
        persist()
    }

    fun add(title: String, url: String, folderId: String = BOOKMARK_ROOT_ID): Bookmark {
        val targetFolder = if (folders.containsKey(folderId)) folderId else BOOKMARK_ROOT_ID
        val existing = items.values.find { it.url == url }
        if (existing != null) {
            val updated = existing.copy(
                title = title.ifBlank { existing.title },
                folderId = targetFolder,
                createdAt = System.currentTimeMillis()
            )
            items[updated.id] = updated
            persist()
            return updated
        }
        val b = Bookmark(
            title = title.ifBlank { url },
            url = url,
            folderId = targetFolder
        )
        items[b.id] = b
        persist()
        return b
    }

    fun moveBookmark(id: String, folderId: String) {
        val b = items[id] ?: return
        val target = if (folders.containsKey(folderId)) folderId else BOOKMARK_ROOT_ID
        items[id] = b.copy(folderId = target)
        persist()
    }

    fun update(id: String, title: String, url: String, folderId: String? = null): Bookmark? {
        val old = items[id] ?: return null
        val cleanUrl = url.trim()
        if (cleanUrl.isBlank()) return old
        val targetFolder = folderId?.let {
            if (folders.containsKey(it)) it else old.folderId
        } ?: old.folderId
        val updated = old.copy(
            title = title.trim().ifBlank { cleanUrl },
            url = cleanUrl,
            folderId = targetFolder
        )
        items[id] = updated
        persist()
        return updated
    }

    fun remove(id: String) {
        items.remove(id)
        persist()
    }

    fun isBookmarked(url: String): Boolean = items.values.any { it.url == url }

    fun findByUrl(url: String): Bookmark? = items.values.find { it.url == url }

    fun removeByUrl(url: String): Boolean {
        val hit = items.values.filter { it.url == url }
        if (hit.isEmpty()) return false
        hit.forEach { items.remove(it.id) }
        persist()
        return true
    }

    fun clear() {
        items.clear()
        folders.keys.filter { it != BOOKMARK_ROOT_ID }.toList().forEach { folders.remove(it) }
        persist()
    }

    private fun ensureRoot() {
        if (!folders.containsKey(BOOKMARK_ROOT_ID)) {
            folders[BOOKMARK_ROOT_ID] = BookmarkFolder(
                id = BOOKMARK_ROOT_ID,
                name = "书签",
                parentId = BOOKMARK_ROOT_ID
            )
        }
    }

    private fun load() {
        if (!file.exists()) return
        runCatching {
            val text = file.readText().trim()
            if (text.startsWith("[")) {
                // legacy flat array
                val arr = JSONArray(text)
                for (i in 0 until arr.length()) {
                    val o = arr.getJSONObject(i)
                    val b = Bookmark(
                        id = o.getString("id"),
                        title = o.optString("title"),
                        url = o.getString("url"),
                        folderId = o.optString("folderId", BOOKMARK_ROOT_ID).ifBlank { BOOKMARK_ROOT_ID },
                        createdAt = o.optLong("createdAt", System.currentTimeMillis())
                    )
                    items[b.id] = b
                }
            } else {
                val root = JSONObject(text)
                val fArr = root.optJSONArray("folders") ?: JSONArray()
                for (i in 0 until fArr.length()) {
                    val o = fArr.getJSONObject(i)
                    val f = BookmarkFolder(
                        id = o.getString("id"),
                        name = o.optString("name", "文件夹"),
                        parentId = o.optString("parentId", BOOKMARK_ROOT_ID).ifBlank { BOOKMARK_ROOT_ID },
                        createdAt = o.optLong("createdAt", System.currentTimeMillis())
                    )
                    folders[f.id] = f
                }
                val bArr = root.optJSONArray("bookmarks") ?: JSONArray()
                for (i in 0 until bArr.length()) {
                    val o = bArr.getJSONObject(i)
                    val b = Bookmark(
                        id = o.getString("id"),
                        title = o.optString("title"),
                        url = o.getString("url"),
                        folderId = o.optString("folderId", BOOKMARK_ROOT_ID).ifBlank { BOOKMARK_ROOT_ID },
                        createdAt = o.optLong("createdAt", System.currentTimeMillis())
                    )
                    items[b.id] = b
                }
            }
        }
        ensureRoot()
        // fix dangling folder refs
        items.values.toList().forEach { b ->
            if (!folders.containsKey(b.folderId)) {
                items[b.id] = b.copy(folderId = BOOKMARK_ROOT_ID)
            }
        }
    }

    private fun persist() {
        ensureRoot()
        val fArr = JSONArray()
        folders.values.filter { it.id != BOOKMARK_ROOT_ID }.forEach { f ->
            fArr.put(
                JSONObject()
                    .put("id", f.id)
                    .put("name", f.name)
                    .put("parentId", f.parentId)
                    .put("createdAt", f.createdAt)
            )
        }
        val bArr = JSONArray()
        items.values.forEach { b ->
            bArr.put(
                JSONObject()
                    .put("id", b.id)
                    .put("title", b.title)
                    .put("url", b.url)
                    .put("folderId", b.folderId)
                    .put("createdAt", b.createdAt)
            )
        }
        val root = JSONObject()
            .put("version", 2)
            .put("folders", fArr)
            .put("bookmarks", bArr)
        file.writeText(root.toString())
    }
}
