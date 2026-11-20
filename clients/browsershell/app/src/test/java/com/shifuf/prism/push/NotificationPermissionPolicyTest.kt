package com.shifuf.prism.push

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class NotificationPermissionPolicyTest {
    @Test fun promptsOnceOnlyOnAndroid33WhenPermissionIsStillMissing() {
        assertFalse(NotificationPermissionPolicy.shouldRequest(32, granted = false, hasRequested = false))
        assertTrue(NotificationPermissionPolicy.shouldRequest(33, granted = false, hasRequested = false))
        assertFalse(NotificationPermissionPolicy.shouldRequest(33, granted = true, hasRequested = false))
        assertFalse(NotificationPermissionPolicy.shouldRequest(33, granted = false, hasRequested = true))
    }
}
