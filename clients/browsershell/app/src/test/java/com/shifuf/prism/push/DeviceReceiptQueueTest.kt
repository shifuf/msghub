package com.shifuf.prism.push

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.assertNotNull
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class DeviceReceiptQueueTest {
    @get:Rule val folder = TemporaryFolder()

    @Test fun pendingArrivalIsDurableAndDoesNotClaimItWasDisplayed() {
        val file = folder.newFile("device-receipts.json")
        val queue = DeviceReceiptQueue(file)
        queue.enqueue("received-only", "registration-1")
        assertEquals(DeviceReceipt("received-only", "registration-1", false), DeviceReceiptQueue(file).pending().single())
        queue.markDisplayed("received-only", "registration-1")
        assertEquals(DeviceReceipt("received-only", "registration-1", true), DeviceReceiptQueue(file).pending().single())
    }

    @Test fun duplicateDeliveryIsIdempotentAndDisplayEvidenceCanUpgradeReceipt() {
        val queue = DeviceReceiptQueue(folder.newFile("device-receipts.json"))
        queue.enqueue("received-only", "registration-1")
        queue.enqueue("received-only", "registration-1")
        assertEquals(1, queue.pending().size)
        queue.acknowledge(queue.pending().single())
        assertTrue(queue.pending().isEmpty())
        assertTrue(queue.markDisplayed("received-only", "registration-1"))
        assertEquals(DeviceReceipt("received-only", "registration-1", true), queue.pending().single())
        queue.acknowledge(queue.pending().single())
        assertTrue(queue.pending().isEmpty())
        assertFalse(queue.markDisplayed("received-only", "registration-1"))
    }

    @Test fun corruptQueueIsPreservedBeforeARecoveryQueueIsWritten() {
        val file = folder.newFile("device-receipts.json")
        file.writeText("not-json")
        val queue = DeviceReceiptQueue(file)
        queue.enqueue("received-only", "registration-1")
        assertTrue(queue.pending().single().receivedToken == "received-only")
        assertNotNull(folder.root.listFiles()?.firstOrNull { it.name.startsWith("device-receipts.json.corrupt-") })
    }

    @Test fun arrivalAcknowledgementCannotEraseNewerTrayEvidence() {
        val file = folder.newFile("device-receipts.json")
        val queue = DeviceReceiptQueue(file)
        queue.enqueue("received-only", "registration-1")
        val inFlightArrival = queue.pending().single()
        assertTrue(DeviceReceiptQueue(file).markDisplayed("received-only", "registration-1"))
        queue.acknowledge(inFlightArrival)
        assertEquals(DeviceReceipt("received-only", "registration-1", true), DeviceReceiptQueue(file).pending().single())
    }
}
