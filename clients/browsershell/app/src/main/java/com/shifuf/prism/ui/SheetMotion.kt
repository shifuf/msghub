package com.shifuf.prism.ui

import android.animation.ValueAnimator
import android.view.View
import android.view.animation.PathInterpolator

/** Cancels both animations and their completion callbacks before a state change. */
object SheetMotion {
    fun show(overlay: View, sheet: View) {
        cancel(overlay, sheet)
        overlay.visibility = View.VISIBLE
        overlay.alpha = 1f
        sheet.translationY = 0f
        if (!ValueAnimator.areAnimatorsEnabled()) return
        overlay.alpha = 0f
        sheet.translationY = 48 * sheet.resources.displayMetrics.density
        overlay.animate().alpha(1f).setDuration(200).start()
        sheet.animate().translationY(0f).setDuration(300)
            .setInterpolator(PathInterpolator(0.22f, 1f, 0.36f, 1f)).start()
    }

    fun hide(overlay: View, sheet: View) {
        cancel(overlay, sheet)
        if (overlay.visibility != View.VISIBLE) return
        if (!ValueAnimator.areAnimatorsEnabled()) {
            overlay.visibility = View.GONE
            overlay.alpha = 1f
            sheet.translationY = 0f
            return
        }
        sheet.animate().translationY(32 * sheet.resources.displayMetrics.density)
            .setDuration(180).start()
        overlay.animate().alpha(0f).setDuration(180).withEndAction {
            overlay.visibility = View.GONE
            overlay.alpha = 1f
            sheet.translationY = 0f
        }.start()
    }

    private fun cancel(overlay: View, sheet: View) {
        overlay.animate().withEndAction(null).cancel()
        sheet.animate().withEndAction(null).cancel()
    }
}
