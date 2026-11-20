package com.shifuf.prism.ui

import android.content.Intent
import android.os.Bundle
import android.view.LayoutInflater
import android.view.Menu
import android.view.MenuItem
import android.view.View
import android.view.ViewGroup
import android.widget.EditText
import android.widget.TextView
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.shifuf.prism.BrowserApp
import com.shifuf.prism.MainActivity
import com.shifuf.prism.R
import com.shifuf.prism.core.BOOKMARK_ROOT_ID
import com.shifuf.prism.core.Bookmark
import com.shifuf.prism.core.BookmarkFolder
import com.google.android.material.appbar.MaterialToolbar
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class BookmarksActivity : PrismActivity() {
    private val store get() = BrowserApp.instance.bookmarks
    private lateinit var recycler: RecyclerView
    private lateinit var emptyView: TextView
    private lateinit var toolbar: MaterialToolbar
    private lateinit var adapter: Adapter
    private var currentFolderId: String = BOOKMARK_ROOT_ID
    private var searchQuery = ""
    private val df = SimpleDateFormat("yyyy-MM-dd HH:mm", Locale.getDefault())

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_list)
        toolbar = findViewById(R.id.toolbar)
        setSupportActionBar(toolbar)
        supportActionBar?.setDisplayHomeAsUpEnabled(true)
        toolbar.setNavigationOnClickListener { navigateFolderUp() }

        recycler = findViewById(R.id.recycler)
        emptyView = findViewById(R.id.emptyView)
        emptyView.text = getString(R.string.empty_bookmarks)
        adapter = Adapter(
            onFolderClick = { openFolder(it.id) },
            onFolderLongClick = { folderActions(it) },
            onBookmarkClick = { openUrl(it.url) },
            onBookmarkLongClick = { bookmarkActions(it) }
        )
        recycler.layoutManager = LinearLayoutManager(this)
        recycler.adapter = adapter
        currentFolderId = savedInstanceState?.getString("folder_id") ?: BOOKMARK_ROOT_ID
        setupLibrarySearch { searchQuery = it; refresh() }
        refresh()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        outState.putString("folder_id", currentFolderId)
        super.onSaveInstanceState(outState)
    }

    private fun navigateFolderUp() {
        if (currentFolderId != BOOKMARK_ROOT_ID) {
            val parent = store.folder(currentFolderId)?.parentId ?: BOOKMARK_ROOT_ID
            openFolder(parent)
        } else {
            finish()
        }
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        if (currentFolderId != BOOKMARK_ROOT_ID) {
            navigateFolderUp()
        } else {
            @Suppress("DEPRECATION")
            super.onBackPressed()
        }
    }

    private fun openFolder(id: String) {
        currentFolderId = id
        refresh()
    }

    private fun refresh() {
        val path = store.folderPath(currentFolderId)
        setPageHeading(if (path.isEmpty()) getString(R.string.bookmarks_title) else path.last().name,
            if (path.isEmpty()) "整理喜欢的网站，随时继续探索" else path.joinToString(" / ") { it.name })

        val node = store.children(currentFolderId)
        val rows = ArrayList<Row>()
        node.folders.filter { UiSearch.matches(searchQuery, it.name) }.forEach { rows.add(Row.Folder(it)) }
        node.bookmarks.filter { UiSearch.matches(searchQuery, it.title, it.url) }.forEach { rows.add(Row.Mark(it)) }
        emptyView.text = if (searchQuery.isBlank()) getString(R.string.empty_bookmarks) else "当前文件夹中没有匹配的书签"
        adapter.submit(rows, df)
        emptyView.visibility = if (rows.isEmpty()) View.VISIBLE else View.GONE
        recycler.visibility = if (rows.isEmpty()) View.GONE else View.VISIBLE
    }

    private fun openUrl(url: String) {
        startActivity(
            Intent(this, MainActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
                .putExtra(MainActivity.EXTRA_OPEN_URL, url)
        )
        finish()
    }

    private fun folderActions(folder: BookmarkFolder) {
        val options = arrayOf("打开", "重命名", "删除文件夹")
        DialogUi.material(this)
            .setTitle(folder.name)
            .setItems(options) { _, which ->
                when (which) {
                    0 -> openFolder(folder.id)
                    1 -> renameFolder(folder)
                    2 -> confirmDeleteFolder(folder)
                }
            }
            .show()
    }

    private fun bookmarkActions(b: Bookmark) {
        val options = arrayOf("打开", "编辑", "移动到文件夹", "添加到主页", "删除")
        DialogUi.material(this)
            .setTitle(b.title)
            .setItems(options) { _, which ->
                when (which) {
                    0 -> openUrl(b.url)
                    1 -> editBookmark(b)
                    2 -> moveBookmark(b)
                    3 -> {
                        BrowserApp.instance.homeShortcuts.add(b.title, b.url)
                        android.widget.Toast.makeText(this, "已添加到主页", android.widget.Toast.LENGTH_SHORT).show()
                    }
                    4 -> {
                        store.remove(b.id)
                        refresh()
                    }
                }
            }
            .show()
    }

    private fun editBookmark(b: Bookmark) {
        val density = resources.displayMetrics.density
        val pad = (16 * density).toInt()
        val root = android.widget.LinearLayout(this).apply {
            orientation = android.widget.LinearLayout.VERTICAL
            setPadding(pad, pad, pad, pad / 2)
        }
        val titleInput = DialogUi.styledEditText(this, "名称", prefill = b.title)
        val urlInput = DialogUi.styledEditText(this, "链接", prefill = b.url).apply {
            inputType = android.text.InputType.TYPE_TEXT_VARIATION_URI
        }
        root.addView(titleInput)
        root.addView(urlInput, android.widget.LinearLayout.LayoutParams(-1, -2).apply { topMargin = pad / 2 })
        DialogUi.material(this)
            .setTitle("编辑书签")
            .setView(root)
            .setPositiveButton("保存") { _, _ ->
                store.update(
                    b.id,
                    titleInput.text?.toString().orEmpty(),
                    urlInput.text?.toString().orEmpty()
                )
                refresh()
            }
            .setNegativeButton(android.R.string.cancel, null)
            .show()
    }

    private fun renameFolder(folder: BookmarkFolder) {
        val input = DialogUi.styledEditText(this, "文件夹名称", prefill = folder.name)
        DialogUi.material(this)
            .setTitle("重命名文件夹")
            .setView(DialogUi.wrap(this, input))
            .setPositiveButton(android.R.string.ok) { _, _ ->
                store.renameFolder(folder.id, input.text?.toString().orEmpty())
                refresh()
            }
            .setNegativeButton(android.R.string.cancel, null)
            .show()
    }

    private fun confirmDeleteFolder(folder: BookmarkFolder) {
        DialogUi.material(this)
            .setTitle("删除文件夹")
            .setMessage("删除「${folder.name}」？其中的书签会移到根目录。")
            .setPositiveButton("删除") { _, _ ->
                store.removeFolder(folder.id, recursive = true)
                if (currentFolderId == folder.id) {
                    currentFolderId = folder.parentId
                }
                refresh()
            }
            .setNegativeButton(android.R.string.cancel, null)
            .show()
    }

    private fun moveBookmark(b: Bookmark) {
        val folders = listOf(BOOKMARK_ROOT_ID to "根目录") +
            store.allFolders().map { f ->
                val path = store.folderPath(f.id).joinToString(" / ") { it.name }
                f.id to path
            }
        val labels = folders.map { it.second }.toTypedArray()
        val currentIndex = folders.indexOfFirst { it.first == b.folderId }.coerceAtLeast(0)
        DialogUi.material(this)
            .setTitle("移动到")
            .setSingleChoiceItems(labels, currentIndex) { dialog, which ->
                store.moveBookmark(b.id, folders[which].first)
                refresh()
                dialog.dismiss()
            }
            .setNegativeButton(android.R.string.cancel, null)
            .show()
    }

    private fun createFolder() {
        val input = DialogUi.styledEditText(this, "文件夹名称")
        DialogUi.material(this)
            .setTitle(R.string.new_folder)
            .setView(DialogUi.wrap(this, input))
            .setPositiveButton("创建") { _, _ ->
                val name = input.text?.toString().orEmpty()
                store.addFolder(name, currentFolderId)
                refresh()
            }
            .setNegativeButton(android.R.string.cancel, null)
            .show()
    }

    override fun onCreateOptionsMenu(menu: Menu): Boolean {
        menu.add(0, 1, 0, R.string.new_folder).setShowAsAction(MenuItem.SHOW_AS_ACTION_IF_ROOM)
        menu.add(0, 2, 1, R.string.clear).setShowAsAction(MenuItem.SHOW_AS_ACTION_NEVER)
        return true
    }

    override fun onOptionsItemSelected(item: MenuItem): Boolean {
        return when (item.itemId) {
            1 -> { createFolder(); true }
            2 -> {
                DialogUi.material(this)
                    .setTitle("清空书签")
                    .setMessage("删除全部书签和文件夹？")
                    .setPositiveButton("清空") { _, _ ->
                        store.clear()
                        currentFolderId = BOOKMARK_ROOT_ID
                        refresh()
                    }
                    .setNegativeButton(android.R.string.cancel, null)
                    .show()
                true
            }
            else -> super.onOptionsItemSelected(item)
        }
    }

    private sealed class Row {
        data class Folder(val folder: BookmarkFolder) : Row()
        data class Mark(val bookmark: Bookmark) : Row()
    }

    private class Adapter(
        val onFolderClick: (BookmarkFolder) -> Unit,
        val onFolderLongClick: (BookmarkFolder) -> Unit,
        val onBookmarkClick: (Bookmark) -> Unit,
        val onBookmarkLongClick: (Bookmark) -> Unit
    ) : RecyclerView.Adapter<Adapter.VH>() {
        private val data = mutableListOf<Row>()
        private var df: SimpleDateFormat? = null

        fun submit(list: List<Row>, df: SimpleDateFormat) {
            this.df = df
            data.clear()
            data.addAll(list)
            notifyDataSetChanged()
        }

        override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): VH {
            val v = LayoutInflater.from(parent.context).inflate(R.layout.item_simple, parent, false)
            return VH(v)
        }

        override fun getItemCount() = data.size
        override fun onBindViewHolder(holder: VH, position: Int) = holder.bind(data[position])

        inner class VH(itemView: View) : RecyclerView.ViewHolder(itemView) {
            private val title: TextView = itemView.findViewById(R.id.title)
            private val subtitle: TextView = itemView.findViewById(R.id.subtitle)
            private val meta: TextView = itemView.findViewById(R.id.meta)

            fun bind(row: Row) {
                when (row) {
                    is Row.Folder -> {
                        title.text = row.folder.name
                        itemView.findViewById<android.widget.ImageView>(R.id.rowIcon).setImageResource(R.drawable.ic_folder)
                        title.compoundDrawablePadding = (10 * itemView.resources.displayMetrics.density).toInt()
                        
                        subtitle.text = "文件夹"
                        meta.text = df?.format(Date(row.folder.createdAt)).orEmpty()
                        itemView.setOnClickListener { onFolderClick(row.folder) }
                        itemView.setOnLongClickListener { onFolderLongClick(row.folder); true }
                    }
                    is Row.Mark -> {
                        title.text = row.bookmark.title
                        itemView.findViewById<android.widget.ImageView>(R.id.rowIcon).setImageResource(R.drawable.ic_star)
                        subtitle.text = row.bookmark.url
                        meta.text = df?.format(Date(row.bookmark.createdAt)).orEmpty()
                        // Prefetch favicon for future home-add / offline use
                        runCatching {
                            BrowserApp.instance.favicons.ensureCached(row.bookmark.url)
                        }
                        itemView.setOnClickListener { onBookmarkClick(row.bookmark) }
                        itemView.setOnLongClickListener { onBookmarkLongClick(row.bookmark); true }
                    }
                }
            }
        }
    }
}
