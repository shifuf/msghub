package com.shifuf.prism.push

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Handler
import android.os.Looper
import android.util.Log
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Re-init JPush after boot / package replace so long-connection can recover
 * without requiring the user to manually open the UI first.
 */
class PushBootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent?) {
        val action = intent?.action.orEmpty()
        Log.i(TAG, "onReceive $action")
        when (action) {
            Intent.ACTION_BOOT_COMPLETED,
            Intent.ACTION_MY_PACKAGE_REPLACED,
            Intent.ACTION_USER_PRESENT -> {
                if (!JPushHelper.isEnabled(context)) return
                PushNotifier.ensureChannel(context)
                val result = goAsync()
                val finished = AtomicBoolean(false)
                val finish = { if (finished.compareAndSet(false, true)) runCatching { result.finish() } }
                Handler(Looper.getMainLooper()).postDelayed({ finish() }, COMPLETION_TIMEOUT_MS)
                if (action == Intent.ACTION_USER_PRESENT) JPushHelper.recover(context)
                JPushHelper.init(context, privacyAgreed = true) { finish() }
            }
        }
    }

    companion object {
        private const val TAG = "PrismPushBoot"
        private const val COMPLETION_TIMEOUT_MS = 8_000L
    }
}
