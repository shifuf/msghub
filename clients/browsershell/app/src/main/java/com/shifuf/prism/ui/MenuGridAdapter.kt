package com.shifuf.prism.ui

import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.ImageView
import android.widget.TextView
import androidx.annotation.DrawableRes
import androidx.recyclerview.widget.GridLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.shifuf.prism.R

data class MenuGridItem(
    val id: Int,
    val title: String,
    @DrawableRes val icon: Int,
    val active: Boolean = false
)

class MenuPagerAdapter(
    private val pages: List<List<MenuGridItem>>,
    private val onClick: (MenuGridItem) -> Unit
) : RecyclerView.Adapter<MenuPagerAdapter.PageVH>() {

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): PageVH {
        val rv = RecyclerView(parent.context).apply {
            layoutParams = ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
            overScrollMode = View.OVER_SCROLL_NEVER
            isNestedScrollingEnabled = false
        }
        return PageVH(rv)
    }

    override fun getItemCount(): Int = pages.size

    override fun onBindViewHolder(holder: PageVH, position: Int) {
        holder.bind(pages[position], onClick)
    }

    class PageVH(private val recycler: RecyclerView) : RecyclerView.ViewHolder(recycler) {
        private val manager = GridLayoutManager(recycler.context, 4)
        init {
            recycler.layoutManager = manager
            recycler.addOnLayoutChangeListener { _, left, _, right, _, _, _, _, _ ->
                val columns = UiLayoutPolicy.menuColumns(
                    ((right - left) / recycler.resources.displayMetrics.density).toInt(),
                    recycler.resources.configuration.fontScale)
                if (manager.spanCount != columns) manager.spanCount = columns
            }
        }
        fun bind(items: List<MenuGridItem>, onClick: (MenuGridItem) -> Unit) {
            manager.spanCount = UiLayoutPolicy.menuColumns(
                recycler.resources.configuration.screenWidthDp.coerceAtMost(600), recycler.resources.configuration.fontScale)
            recycler.adapter = MenuGridAdapter(onClick).also { it.submit(items) }
        }
    }
}

class MenuGridAdapter(
    private val onClick: (MenuGridItem) -> Unit
) : RecyclerView.Adapter<MenuGridAdapter.VH>() {
    private val data = mutableListOf<MenuGridItem>()

    fun submit(list: List<MenuGridItem>) {
        data.clear()
        data.addAll(list)
        notifyDataSetChanged()
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): VH {
        val v = LayoutInflater.from(parent.context).inflate(R.layout.item_menu_grid, parent, false)
        return VH(v)
    }

    override fun getItemCount(): Int = data.size
    override fun onBindViewHolder(holder: VH, position: Int) = holder.bind(data[position])

    inner class VH(itemView: View) : RecyclerView.ViewHolder(itemView) {
        private val icon: ImageView = itemView.findViewById(R.id.icon)
        private val label: TextView = itemView.findViewById(R.id.label)
        fun bind(item: MenuGridItem) {
            icon.setImageResource(item.icon)
            label.text = item.title
            val accent = itemView.context.getColor(R.color.via_accent)
            val normal = itemView.context.getColor(R.color.via_text)
            val iconNormal = itemView.context.getColor(R.color.via_icon)
            label.setTextColor(if (item.active) accent else normal)
            icon.setColorFilter(if (item.active) accent else iconNormal)
            icon.backgroundTintList = android.content.res.ColorStateList.valueOf(
                itemView.context.getColor(if (item.active) R.color.via_accent_soft else R.color.via_menu_icon_bg))
            itemView.isSelected = item.active
            itemView.contentDescription = item.title + when {
                !item.active -> ""
                item.id == 26 -> "，有未读消息"
                item.id == 2 -> "，已收藏"
                else -> "，已开启"
            }
            itemView.setOnClickListener { onClick(item) }
        }
    }
}
