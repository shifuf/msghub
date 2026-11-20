package com.shifuf.prism.ui

import android.graphics.Bitmap
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.ImageButton
import android.widget.ImageView
import android.widget.TextView
import androidx.core.content.ContextCompat
import androidx.recyclerview.widget.RecyclerView
import com.shifuf.prism.R
import com.shifuf.prism.core.PreferenceStore
import com.shifuf.prism.core.TabInfo

class TabListAdapter(
    private val onOpen: (String) -> Unit,
    private val onClose: (String) -> Unit,
    private val faviconProvider: (String) -> Bitmap? = { null }
) : RecyclerView.Adapter<TabListAdapter.VH>() {
    private val data = mutableListOf<TabInfo>()

    fun submit(list: List<TabInfo>) {
        data.clear()
        data.addAll(list)
        notifyDataSetChanged()
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): VH {
        val v = LayoutInflater.from(parent.context).inflate(R.layout.item_tab, parent, false)
        return VH(v)
    }

    override fun getItemCount(): Int = data.size
    override fun onBindViewHolder(holder: VH, position: Int) = holder.bind(data[position])

    inner class VH(itemView: View) : RecyclerView.ViewHolder(itemView) {
        private val icon: ImageView = itemView.findViewById(R.id.tabIcon)
        private val title: TextView = itemView.findViewById(R.id.tabTitle)
        private val close: ImageButton = itemView.findViewById(R.id.tabClose)

        fun bind(tab: TabInfo) {
            val isHome = tab.url == PreferenceStore.HOME_URL ||
                tab.url.startsWith("about:home") ||
                tab.url.startsWith("data:")
            val display = when {
                isHome -> "主页"
                tab.title.isNotBlank() && !tab.title.startsWith("data:") -> tab.title
                else -> "新标签页"
            }
            title.text = display
            itemView.findViewById<TextView>(R.id.tabHost).text =
                (if (tab.isActive) "正在浏览 · " else "") +
                    if (isHome) "个人收藏与快捷访问" else
                        runCatching { android.net.Uri.parse(tab.url).host?.removePrefix("www.") }.getOrNull().orEmpty().ifBlank { tab.url }
            close.contentDescription = "关闭标签：$display"
            val color = if (tab.isActive) R.color.via_accent else R.color.via_text
            title.setTextColor(ContextCompat.getColor(itemView.context, color))
            itemView.setBackgroundResource(if (tab.isActive) R.drawable.bg_tab_card_active else R.drawable.bg_list_row)
            itemView.contentDescription = display + if (tab.isActive) "，当前标签" else ""
            val fav = faviconProvider(tab.id)
            if (fav != null && !fav.isRecycled) {
                icon.setImageBitmap(fav)
                icon.clearColorFilter()
                icon.scaleType = ImageView.ScaleType.CENTER_CROP
            } else {
                icon.setImageResource(if (isHome) R.drawable.ic_home else R.drawable.ic_globe)
                icon.setColorFilter(ContextCompat.getColor(itemView.context, R.color.via_text_secondary))
                icon.scaleType = ImageView.ScaleType.CENTER_INSIDE
            }
            itemView.setOnClickListener { onOpen(tab.id) }
            close.setOnClickListener { onClose(tab.id) }
        }
    }
}
