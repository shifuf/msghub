package com.shifuf.prism.ui

import android.animation.ValueAnimator
import android.content.res.Configuration
import android.os.Bundle
import android.view.View
import android.view.ViewGroup
import android.view.animation.PathInterpolator
import android.widget.EditText
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.WindowCompat
import androidx.recyclerview.widget.RecyclerView
import com.google.android.material.appbar.MaterialToolbar
import com.shifuf.prism.R

/** Shared page hierarchy, adaptive gutters and motion for native management screens. */
open class PrismActivity : AppCompatActivity() {
    override fun onPostCreate(savedInstanceState: Bundle?) {
        super.onPostCreate(savedInstanceState)
        val toolbar = findViewById<MaterialToolbar>(R.id.toolbar) ?: return
        toolbar.setNavigationIcon(R.drawable.ic_back)
        toolbar.navigationContentDescription = "返回"
        toolbar.setBackgroundColor(getColor(R.color.via_bg))
        toolbar.minimumHeight = dp(48)
        toolbar.layoutParams.height = ViewGroup.LayoutParams.WRAP_CONTENT
        val heading = findViewById<TextView>(R.id.pageTitle)
        if (heading != null) {
            if (heading.text.isNullOrBlank()) heading.text = toolbar.title
            val subtitle = findViewById<TextView>(R.id.pageSubtitle)
            if (subtitle.text.isNullOrBlank()) subtitle.text = pageDescription()
            supportActionBar?.setDisplayShowTitleEnabled(false)
            toolbar.title = ""
            toolbar.subtitle = null
        } else {
            toolbar.setTitleTextAppearance(this, R.style.PrismPageTitle)
        }
        val dark = resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK == Configuration.UI_MODE_NIGHT_YES
        WindowCompat.getInsetsController(window, window.decorView).apply {
            isAppearanceLightStatusBars = !dark
            isAppearanceLightNavigationBars = !dark
        }
        window.statusBarColor = getColor(R.color.via_bg)
        window.navigationBarColor = getColor(R.color.via_bg)
        findViewById<RecyclerView>(R.id.recycler)?.apply {
            clipToPadding = false
            overScrollMode = View.OVER_SCROLL_IF_CONTENT_SCROLLS
            // Frequent progress and status updates should not flash or move existing rows.
            (itemAnimator as? androidx.recyclerview.widget.SimpleItemAnimator)?.supportsChangeAnimations = false
        }
        findViewById<TextView>(R.id.emptyView)?.apply {
            setCompoundDrawablesRelativeWithIntrinsicBounds(0, emptyIcon(), 0, 0)
            compoundDrawablePadding = dp(20)
            compoundDrawablesRelative.filterNotNull().forEach { drawable ->
                drawable.setTint(getColor(R.color.via_text_secondary))
                drawable.setBounds(0, 0, dp(40), dp(40))
            }
            setCompoundDrawablesRelative(null, compoundDrawablesRelative[1], null, null)
            textSize = 15f
            setLineSpacing(dp(6).toFloat(), 1f)
            accessibilityLiveRegion = View.ACCESSIBILITY_LIVE_REGION_POLITE
        }
        applyContentInsets()
        if (savedInstanceState == null && ValueAnimator.areAnimatorsEnabled()) {
            listOfNotNull(findViewById<View>(R.id.pageHeading), findViewById<View>(R.id.recycler)).forEachIndexed { i, view ->
                view.alpha = 0f
                view.translationY = dp(8).toFloat()
                view.animate().alpha(1f).translationY(0f).setStartDelay(i * 30L).setDuration(220)
                    .setInterpolator(PathInterpolator(.22f, 1f, .36f, 1f)).start()
            }
        }
    }

    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        applyContentInsets()
    }

    protected fun setPageHeading(title: CharSequence, subtitle: CharSequence? = null) {
        findViewById<TextView>(R.id.pageTitle)?.text = title
        if (subtitle != null) findViewById<TextView>(R.id.pageSubtitle)?.text = subtitle
    }

    protected fun setPageSummary(summary: CharSequence) {
        findViewById<TextView>(R.id.pageSubtitle)?.text = summary
    }

    private fun applyContentInsets() {
        val content = findViewById<ViewGroup>(android.R.id.content)
        val root = content.getChildAt(0) ?: return
        val width = resources.configuration.screenWidthDp
        val inset = dp(UiLayoutPolicy.contentInset(width))
        findViewById<RecyclerView>(R.id.recycler)?.setPadding(inset, dp(4), inset, dp(28))
        listOf(R.id.pageHeading, R.id.librarySearch, R.id.settingsSearch, R.id.searchBox).forEach { id ->
            findViewById<View>(id)?.let { view ->
                (view.layoutParams as? ViewGroup.MarginLayoutParams)?.let { params ->
                    params.marginStart = inset
                    params.marginEnd = inset
                    view.layoutParams = params
                }
            }
        }
        findViewById<View>(R.id.pageHeading)?.apply {
            // Keep room for results and actions when the keyboard or a landscape window is short.
            val compact = resources.configuration.screenHeightDp < 420
            setPadding(0, 0, 0, dp(if (compact) 10 else 20))
            findViewById<TextView>(R.id.pageTitle).textSize = if (compact) 24f else 32f
            findViewById<View>(R.id.pageSubtitle).visibility = if (compact) View.GONE else View.VISIBLE
        }
        root.setBackgroundColor(getColor(R.color.via_bg))
    }

    private fun pageDescription(): String = when (javaClass.simpleName) {
        "SettingsActivity" -> "让棱镜更合你的习惯"
        "BookmarksActivity" -> "整理喜欢的网站，随时继续探索"
        "HistoryActivity" -> "找回浏览过的精彩内容"
        "DownloadsActivity" -> "文件与下载进度，尽在这里"
        "ScriptsActivity" -> "为常用网站增添你的工具"
        "FilterRulesActivity" -> "选择规则，让浏览更清爽"
        "SnifferActivity" -> "当前网页发现的视频与音频"
        "PushHistoryActivity" -> "通知、已读状态与消息会话"
        else -> "查看网页请求与拦截记录"
    }

    private fun emptyIcon(): Int = when (javaClass.simpleName) {
        "BookmarksActivity" -> R.drawable.ic_star
        "HistoryActivity" -> R.drawable.ic_history
        "PushHistoryActivity" -> R.drawable.ic_message
        "DownloadsActivity" -> R.drawable.ic_download
        "ScriptsActivity" -> R.drawable.ic_code
        "FilterRulesActivity" -> R.drawable.ic_block
        "SnifferActivity" -> R.drawable.ic_sniffer
        else -> R.drawable.ic_network
    }

    protected fun setupLibrarySearch(hint: String = "搜索标题或网址", onQuery: (String) -> Unit) {
        findViewById<EditText>(R.id.librarySearch)?.apply {
            visibility = View.VISIBLE
            this.hint = hint
            addTextChangedListener(object : android.text.TextWatcher {
                override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
                override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) = onQuery(s?.toString().orEmpty())
                override fun afterTextChanged(s: android.text.Editable?) {}
            })
        }
    }

    protected fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()
}
