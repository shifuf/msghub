package com.shifuf.prism.ui

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.text.TextUtils
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.core.content.ContextCompat
import com.shifuf.prism.R
import com.google.android.material.dialog.MaterialAlertDialogBuilder

object DialogUi {
    /** One form for both home and settings; invalid input keeps the form and draft open. */
    fun showWebsiteEditor(
        context: Context,
        title: String,
        initialTitle: String = "",
        initialUrl: String = "",
        bookmarks: List<com.shifuf.prism.core.Bookmark> = emptyList(),
        onDelete: (() -> Unit)? = null,
        onSave: (String, String) -> Unit
    ) {
        val density = context.resources.displayMetrics.density
        fun dp(value: Int) = (density * value).toInt()
        val form = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(24), dp(8), dp(24), dp(8))
        }
        fun field(label: String, hint: String, value: String): EditText {
            form.addView(TextView(context).apply {
                text = label
                textSize = 13f
                setTextColor(context.getColor(R.color.via_text_secondary))
                setPadding(0, dp(8), 0, dp(8))
            })
            return styledEditText(context, hint, prefill = value).also { input ->
                form.addView(input, LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = dp(8) })
            }
        }
        val name = field("名称", "网站名称（选填）", initialTitle)
        val url = field("网址", "example.com 或 https://…", initialUrl).apply {
            inputType = android.text.InputType.TYPE_CLASS_TEXT or android.text.InputType.TYPE_TEXT_VARIATION_URI
            imeOptions = android.view.inputmethod.EditorInfo.IME_ACTION_DONE
        }
        name.imeOptions = android.view.inputmethod.EditorInfo.IME_ACTION_NEXT
        if (bookmarks.isNotEmpty()) {
            form.addView(com.google.android.material.button.MaterialButton(context, null,
                com.google.android.material.R.attr.borderlessButtonStyle).apply {
                text = "从书签选择"
                setIconResource(R.drawable.ic_star)
                setOnClickListener {
                    material(context).setTitle("选择书签")
                        .setItems(bookmarks.map { it.title.ifBlank { it.url } }.toTypedArray()) { _, index ->
                            name.setText(bookmarks[index].title)
                            url.setText(bookmarks[index].url)
                            url.error = null
                        }.setNegativeButton("取消", null).show()
                }
            }, LinearLayout.LayoutParams(-1, -2))
        }
        val dialog = androidx.appcompat.app.AppCompatDialog(context)
        dialog.supportRequestWindowFeature(android.view.Window.FEATURE_NO_TITLE)
        val heading = TextView(context).apply {
            text = title
            textSize = 20f
            typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
            setTextColor(context.getColor(R.color.via_text))
            setPadding(0, dp(12), 0, dp(8))
            androidx.core.view.ViewCompat.setAccessibilityHeading(this, true)
        }
        form.addView(heading, 0)
        fun save() {
            val raw = url.text.toString().trim()
            val normalized = if (raw.contains("://")) raw else "https://$raw"
            val parsed = runCatching { java.net.URI(normalized) }.getOrNull()
            if (raw.isBlank() || raw.any { it.isWhitespace() } || parsed == null ||
                parsed.scheme?.lowercase() !in listOf("http", "https") || parsed.rawAuthority.isNullOrBlank()) {
                url.error = "请输入有效的网站地址"
                url.requestFocus()
                return
            }
            onSave(name.text.toString().trim(), normalized)
            dialog.dismiss()
        }
        val actions = LinearLayout(context).apply {
            gravity = Gravity.END or Gravity.CENTER_VERTICAL
            setPadding(0, dp(12), 0, dp(8))
        }
        fun button(label: String, action: () -> Unit) = com.google.android.material.button.MaterialButton(
            context, null, com.google.android.material.R.attr.borderlessButtonStyle).apply {
            text = label
            minWidth = 0
            setPadding(dp(12), 0, dp(12), 0)
            setOnClickListener { action() }
        }
        if (onDelete != null) actions.addView(button("删除") { onDelete(); dialog.dismiss() }, LinearLayout.LayoutParams(0, -2, 1f))
        actions.addView(button("取消") { dialog.dismiss() }, LinearLayout.LayoutParams(0, -2, 1f))
        actions.addView(button("保存") { save() }, LinearLayout.LayoutParams(0, -2, 1f))
        form.addView(actions, LinearLayout.LayoutParams(-1, -2))
        val scroll = android.widget.ScrollView(context).apply {
            background = roundedShape(context, context.getColor(R.color.via_card), 24f)
            clipToOutline = true
            isFillViewport = false
            addView(form)
        }
        val root = FrameLayout(context).apply {
            isFocusableInTouchMode = true
            addView(scroll, FrameLayout.LayoutParams(-1, -2, Gravity.CENTER))
        }
        dialog.setContentView(root)
        dialog.window?.apply {
            setBackgroundDrawable(android.graphics.drawable.ColorDrawable(Color.TRANSPARENT))
            addFlags(android.view.WindowManager.LayoutParams.FLAG_DIM_BEHIND)
            setDimAmount(.45f)
            androidx.core.view.WindowCompat.setDecorFitsSystemWindows(this, false)
            setSoftInputMode(android.view.WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE)
        }
        androidx.core.view.ViewCompat.setOnApplyWindowInsetsListener(root) { view, insets ->
            val bars = insets.getInsets(androidx.core.view.WindowInsetsCompat.Type.systemBars() or androidx.core.view.WindowInsetsCompat.Type.displayCutout())
            val ime = insets.getInsets(androidx.core.view.WindowInsetsCompat.Type.ime())
            val gutter = ((context.resources.displayMetrics.widthPixels - dp(560)) / 2).coerceAtLeast(dp(20))
            view.setPadding(maxOf(gutter, bars.left + dp(12)), bars.top + dp(12),
                maxOf(gutter, bars.right + dp(12)), maxOf(ime.bottom, bars.bottom) + dp(12))
            androidx.core.view.WindowInsetsCompat.CONSUMED
        }
        url.setOnEditorActionListener { _, actionId, _ ->
            if (actionId == android.view.inputmethod.EditorInfo.IME_ACTION_DONE) { save(); true } else false
        }
        dialog.show()
        dialog.window?.setLayout(-1, -1)
        root.requestFocus()
        androidx.core.view.ViewCompat.requestApplyInsets(root)
    }

    fun styledEditText(
        context: Context,
        hint: String,
        singleLine: Boolean = true,
        minLines: Int = 1,
        prefill: String = ""
    ): EditText {
        val density = context.resources.displayMetrics.density
        val padH = (14 * density).toInt()
        val padV = (12 * density).toInt()
        return EditText(context).apply {
            this.hint = hint
            setText(prefill)
            setSingleLine(singleLine)
            if (!singleLine) this.minLines = minLines
            setTextColor(ContextCompat.getColor(context, R.color.via_input_text))
            setHintTextColor(ContextCompat.getColor(context, R.color.via_input_hint))
            setBackgroundResource(R.drawable.bg_dialog_input)
            setPadding(padH, padV, padH, padV)
            textSize = 16f
            try {
                importantForAutofill = View.IMPORTANT_FOR_AUTOFILL_NO
            } catch (_: Throwable) {}
            highlightColor = ContextCompat.getColor(context, R.color.via_accent_soft)
            minimumHeight = (48 * density).toInt()
            gravity = Gravity.TOP or Gravity.START
        }
    }

    fun wrap(context: Context, editText: EditText): FrameLayout {
        val density = context.resources.displayMetrics.density
        val m = (20 * density).toInt()
        return FrameLayout(context).apply {
            setPadding(m, m / 2, m, 0)
            addView(
                editText,
                FrameLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.WRAP_CONTENT
                )
            )
        }
    }

    fun roundedShape(context: Context, color: Int, radiusDp: Float = 20f): GradientDrawable {
        val density = context.resources.displayMetrics.density
        return GradientDrawable().apply {
            shape = GradientDrawable.RECTANGLE
            cornerRadius = radiusDp * density
            setColor(color)
        }
    }

    /** Adjacent rows share one rounded group, with an inset separator. */
    fun groupedRow(context: Context, first: Boolean, last: Boolean): android.graphics.drawable.Drawable {
        val density = context.resources.displayMetrics.density
        val radius = 20f * density
        val shape = GradientDrawable().apply {
            setColor(context.getColor(R.color.via_card))
            cornerRadii = floatArrayOf(
                if (first) radius else 0f, if (first) radius else 0f,
                if (first) radius else 0f, if (first) radius else 0f,
                if (last) radius else 0f, if (last) radius else 0f,
                if (last) radius else 0f, if (last) radius else 0f)
        }
        if (last) return shape
        val divider = android.graphics.drawable.ColorDrawable(context.getColor(R.color.via_divider))
        return android.graphics.drawable.LayerDrawable(arrayOf(shape, divider)).apply {
            setLayerHeight(1, (density * .5f).toInt().coerceAtLeast(1))
            setLayerGravity(1, Gravity.BOTTOM)
            setLayerInset(1, (64 * density).toInt(), 0, (16 * density).toInt(), 0)
        }
    }

    fun showDownloadConfirm(
        context: Context,
        fileName: String,
        url: String,
        engineLabel: String = "",
        onConfirm: (chosenName: String) -> Unit
    ) {
        val density = context.resources.displayMetrics.density
        val pad = (20 * density).toInt()
        val gap = (10 * density).toInt()
        val card = ContextCompat.getColor(context, R.color.via_card)
        val text = ContextCompat.getColor(context, R.color.via_text)
        val secondary = ContextCompat.getColor(context, R.color.via_text_secondary)
        val accent = ContextCompat.getColor(context, R.color.via_accent)
        val soft = ContextCompat.getColor(context, R.color.via_url_bg)

        val root = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(pad, pad, pad, (8 * density).toInt())
            background = roundedShape(context, card, 22f)
        }

        root.addView(TextView(context).apply {
            this.text = "确认下载"
            setTextColor(text)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 18f)
            typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
        })

        if (engineLabel.isNotBlank()) {
            root.addView(TextView(context).apply {
                this.text = "引擎 · $engineLabel"
                setTextColor(secondary)
                setTextSize(TypedValue.COMPLEX_UNIT_SP, 12f)
                setPadding(0, (6 * density).toInt(), 0, 0)
            })
        }

        val nameInput = styledEditText(context, "文件名", prefill = fileName)
        val nameWrap = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            background = roundedShape(context, soft, 16f)
            setPadding(gap + 4, gap + 2, gap + 4, gap + 2)
            val lp = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            )
            lp.topMargin = (14 * density).toInt()
            layoutParams = lp
        }
        nameWrap.addView(TextView(context).apply {
            this.text = "文件名（可修改）"
            setTextColor(secondary)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 11f)
        })
        nameWrap.addView(nameInput, LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        ).apply { topMargin = (4 * density).toInt() })
        root.addView(nameWrap)

        val urlCard = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            background = roundedShape(context, soft, 16f)
            setPadding(gap + 4, gap + 2, gap + 4, gap + 2)
            val lp = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            )
            lp.topMargin = gap
            layoutParams = lp
        }
        val urlHeader = LinearLayout(context).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        urlHeader.addView(TextView(context).apply {
            this.text = "下载链接"
            setTextColor(secondary)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 11f)
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
        })
        val copyBtn = TextView(context).apply {
            this.text = "复制"
            setTextColor(accent)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 12f)
            typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
            setPadding((8 * density).toInt(), (4 * density).toInt(), (8 * density).toInt(), (4 * density).toInt())
            background = roundedShape(context, Color.argb(28, Color.red(accent), Color.green(accent), Color.blue(accent)), 12f)
            setOnClickListener {
                val cm = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                cm.setPrimaryClip(ClipData.newPlainText("download", url))
                Toast.makeText(context, "已复制下载链接", Toast.LENGTH_SHORT).show()
            }
        }
        urlHeader.addView(copyBtn)
        urlCard.addView(urlHeader)
        urlCard.addView(TextView(context).apply {
            this.text = url
            setTextColor(text)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 12f)
            setPadding(0, (4 * density).toInt(), 0, 0)
            maxLines = 4
            ellipsize = TextUtils.TruncateAt.MIDDLE
        })
        root.addView(urlCard)

        val dialog = MaterialAlertDialogBuilder(context, R.style.ViaAlertDialog)
            .setView(root)
            .setPositiveButton("开始下载") { _, _ ->
                val chosen = nameInput.text?.toString()?.trim().orEmpty().ifBlank { fileName }
                onConfirm(chosen)
            }
            .setNegativeButton("取消", null)
            .create()
        dialog.show()
        dialog.window?.setBackgroundDrawable(roundedShape(context, card, 22f))
    }

    fun material(context: Context): MaterialAlertDialogBuilder {
        return MaterialAlertDialogBuilder(context, R.style.ViaAlertDialog)
    }
}
