package com.shifuf.prism.push

import org.junit.Assert.*
import org.junit.Test
import java.nio.file.Files

class ReadReceiptQueueTest {
    @Test fun identicalCredentialsAtDifferentOriginsRemainIndependent() {
        val queue = ReadReceiptQueue(Files.createTempDirectory("receipts-origin").resolve("queue.json").toFile())
        queue.enqueue("https://one.example.com", "m1", "same-token")
        queue.enqueue("https://two.example.com", "m1", "same-token")
        assertEquals(2, queue.pending().size)
        queue.acknowledge(queue.pending().first())
        assertEquals("https://two.example.com", queue.pending().single().base)
    }

    @Test fun corruptQueueIsPreservedAndNewReceiptCanBeQueued() {
        val file = Files.createTempDirectory("receipts-corrupt").resolve("queue.json").toFile()
        file.writeText("{broken")
        val queue = ReadReceiptQueue(file)
        queue.enqueue("https://msg.example.com", "new", "token")
        assertEquals("new", queue.pending().single().messageId)
        assertEquals("{broken", file.parentFile!!.listFiles()!!.single { it.name.contains(".corrupt-") }.readText())
    }
    @Test fun offlineReceiptSurvivesRestartAndDuplicateClicks() {
        val file = Files.createTempDirectory("receipts").resolve("queue.json").toFile()
        val queue = ReadReceiptQueue(file)
        queue.enqueue("https://msg.example.com", "m1", "token1")
        queue.enqueue("https://msg.example.com/", "m1", "token1")
        assertEquals(1, ReadReceiptQueue(file).pending().size)
        assertFalse(queue.isAcknowledged("m1", "token1"))
        queue.acknowledge(queue.pending().single())
        assertTrue(ReadReceiptQueue(file).isAcknowledged("m1", "token1"))
        assertTrue(ReadReceiptQueue(file).pending().isEmpty())
    }
    @Test fun acknowledgementCannotDropAnotherMessagesPendingReceipt() {
        val queue = ReadReceiptQueue(Files.createTempDirectory("receipts").resolve("queue.json").toFile())
        queue.enqueue("https://msg.example.com", "m1", "token1")
        val inflight = queue.pending().single()
        ReadReceiptQueue(queue.file).enqueue("https://msg.example.com", "m2", "token2")
        queue.acknowledge(inflight)
        assertEquals(listOf("m2"), queue.pending().map { it.messageId })
    }
    @Test fun receiptTargetRejectsCleartextCredentialsAndUntrustedChanges() {
        assertNull(ReadReceiptQueue.trustedBase("http://msg.example.com"))
        assertNull(ReadReceiptQueue.trustedBase("https://user:pass@msg.example.com"))
        assertNull(ReadReceiptQueue.trustedBase("https://msg.example.com/?redirect=evil"))
        assertEquals("https://msg.example.com", ReadReceiptQueue.trustedBase("https://msg.example.com/"))
    }
    @Test fun receivedMessageKeepsOriginalPlatformWhenDuplicateArrivesAfterSettingsChange() {
        val file = Files.createTempDirectory("receipt-origin").resolve("history.json").toFile()
        val history = PushHistoryFile(file)
        history.insert(PushHistoryItem(title = "a", content = "b", messageId = "m1", receiptBase = "https://original.example.com"))
        history.insert(PushHistoryItem(title = "a", content = "b", messageId = "m1", receiptBase = "https://changed.example.com"))
        assertEquals("https://original.example.com", PushHistoryFile(file).all().single().receiptBase)
    }
}
