package com.shifuf.prism.ui

import android.view.MotionEvent
import android.view.View
import android.view.ViewConfiguration
import kotlin.math.abs

/**
 * Left-edge swipe → back, right-edge swipe → forward.
 */
class EdgeSwipeGesture(
    private val host: View,
    private val onBack: () -> Boolean,
    private val onForward: () -> Boolean
) : View.OnTouchListener {
    private val edgePx: Int
    private val touchSlop: Int
    private var tracking = false
    private var fromLeft = false
    private var startX = 0f
    private var startY = 0f

    init {
        val density = host.resources.displayMetrics.density
        edgePx = (28 * density).toInt()
        touchSlop = ViewConfiguration.get(host.context).scaledTouchSlop
        host.setOnTouchListener(this)
    }

    override fun onTouch(v: View, event: MotionEvent): Boolean {
        when (event.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                val w = host.width
                fromLeft = event.x <= edgePx
                val fromRight = event.x >= w - edgePx
                tracking = fromLeft || fromRight
                if (!fromLeft && fromRight) fromLeft = false
                startX = event.x
                startY = event.y
                return false // don't steal page scroll yet
            }
            MotionEvent.ACTION_MOVE -> {
                if (!tracking) return false
                val dx = event.x - startX
                val dy = event.y - startY
                if (abs(dx) > touchSlop && abs(dx) > abs(dy) * 1.2f) {
                    // claimed horizontal edge swipe
                    return true
                }
            }
            MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                if (!tracking) return false
                val dx = event.x - startX
                val dy = event.y - startY
                tracking = false
                if (abs(dx) < touchSlop * 3 || abs(dx) < abs(dy)) return false
                return if (fromLeft && dx > 0) {
                    onBack()
                } else if (!fromLeft && dx < 0) {
                    onForward()
                } else false
            }
        }
        return false
    }
}
