package com.shifuf.prism.push

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

class DeviceWorkExecutorsTest {
    @get:Rule val folder = TemporaryFolder()

    @Test fun receiptPersistsWhileTheNetworkRequestIsBlocked() {
        val workers = DeviceWorkExecutors()
        val networkStarted = CountDownLatch(1)
        val releaseNetwork = CountDownLatch(1)
        val persisted = CountDownLatch(1)
        val file = folder.newFile("device-receipts.json")
        try {
            workers.network.execute {
                networkStarted.countDown()
                releaseNetwork.await(5, TimeUnit.SECONDS)
            }
            assertTrue("The network request must already be in flight", networkStarted.await(2, TimeUnit.SECONDS))
            workers.receipts.execute {
                DeviceReceiptQueue(file).enqueue("received-only", "registration-1")
                persisted.countDown()
            }
            assertTrue("A slow network request must not hold up durable broadcast receipt storage", persisted.await(2, TimeUnit.SECONDS))
            assertEquals(DeviceReceipt("received-only", "registration-1", false), DeviceReceiptQueue(file).pending().single())
        } finally {
            releaseNetwork.countDown()
            workers.network.shutdownNow()
            workers.receipts.shutdownNow()
        }
    }
}
