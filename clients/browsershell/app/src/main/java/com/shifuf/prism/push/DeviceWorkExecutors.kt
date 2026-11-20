package com.shifuf.prism.push

import java.util.concurrent.Executors

/** Broadcast persistence and tray observation must not wait behind a slow HTTP request. */
internal class DeviceWorkExecutors {
    val network = Executors.newSingleThreadScheduledExecutor { runnable ->
        Thread(runnable, "prism-device-api").apply { isDaemon = true }
    }
    val receipts = Executors.newSingleThreadScheduledExecutor { runnable ->
        Thread(runnable, "prism-device-receipt").apply { isDaemon = true }
    }
}
