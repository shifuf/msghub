package com.shifuf.prism.push

object NotificationPermissionPolicy {
    fun shouldRequest(apiLevel: Int, granted: Boolean, hasRequested: Boolean): Boolean =
        apiLevel >= 33 && !granted && !hasRequested
}
