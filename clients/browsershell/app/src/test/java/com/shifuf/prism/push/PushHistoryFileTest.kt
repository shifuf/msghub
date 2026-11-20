package com.shifuf.prism.push

import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

class PushHistoryFileTest {
    @get:Rule val temp = TemporaryFolder()

    @Test fun replyKeepsCredentialOriginAfterPlatformSettingsChange() {
        val store = PushHistoryFile(temp.newFolder().resolve("history.json"))
        store.insert(PushHistoryItem(title = "original", content = "start", messageId = "plat_42",
            extras = """{"messageId":"42","conversationId":"42","conversationToken":"chat-a"}""",
            receiptBase = "https://a.example.com"))
        val reply = store.insert(PushHistoryItem(title = "reply", content = "hello", messageId = "reply_42_r1",
            extras = """{"messageId":"42","conversationId":"42","conversationToken":"chat-a","replyId":"r1"}""",
            receiptBase = "https://b.example.com")).item
        assertEquals("https://a.example.com", reply.receiptBase)
        assertNull(ConversationProtocol.endpoint("https://b.example.com", reply.receiptBase, "conversation"))
    }

    @Test fun replyWithoutKnownMatchingCapabilityCannotAssumeCurrentOrigin() {
        val store = PushHistoryFile(temp.newFolder().resolve("history.json"))
        store.insert(PushHistoryItem(title = "other", content = "", messageId = "plat_42",
            extras = """{"conversationId":"42","conversationToken":"other-token"}""", receiptBase = "https://a.example.com"))
        val reply = store.insert(PushHistoryItem(title = "reply", content = "", messageId = "reply_42_r1",
            extras = """{"conversationId":"42","conversationToken":"chat-a","replyId":"r1"}""",
            receiptBase = "https://b.example.com")).item
        assertEquals("", reply.receiptBase)
    }

    @Test fun repliesInOneConversationAreSeparateUnreadMessagesAndDuplicateReplyKeepsReadState() {
        val store = PushHistoryFile(temp.newFolder().resolve("history.json"))
        store.insert(PushHistoryItem(title = "original", content = "start", messageId = "plat_42", read = true,
            extras = """{"messageId":"42","readToken":"read","conversationId":"42","conversationToken":"chat"}"""))
        store.insert(PushHistoryItem(title = "reply", content = "first", messageId = "plat_42", read = true,
            extras = """{"messageId":"42","replyId":"r1","conversationId":"42","conversationToken":"chat"}"""))
        store.insert(PushHistoryItem(title = "reply", content = "second", messageId = "plat_42",
            extras = """{"messageId":"42","replyId":"r2","conversationId":"42","conversationToken":"chat"}"""))
        val duplicate = store.insert(PushHistoryItem(title = "reply retry", content = "first", messageId = "plat_42",
            extras = """{"messageId":"42","replyId":"r1","conversationId":"42","conversationToken":"chat"}"""))
        assertEquals(3, store.all().size)
        assertEquals(1, store.all().count { !it.read })
        assertFalse(duplicate.inserted)
        assertTrue(duplicate.item.read)
        assertEquals("first", duplicate.item.content)
    }

    @Test fun duplicateDeliveryRetainsOriginalReadStateAndTimestamp() {
        val file = PushHistoryFile(temp.newFolder().resolve("history.json"))
        val original = PushHistoryItem(title = "old", content = "text", messageId = "42", receivedAt = 1, read = true)
        file.insert(original)
        val result = file.insert(PushHistoryItem(title = "retry", content = "text", messageId = "42"))
        assertFalse(result.inserted)
        assertEquals(original, result.item)
        assertEquals(1, file.all().size)
    }

    @Test fun separateInstancesSerializeWritesAndSeeDeletes() {
        val path = temp.newFolder().resolve("history.json")
        val first = PushHistoryFile(path)
        val second = PushHistoryFile(path)
        val pool = Executors.newFixedThreadPool(4)
        val futures = (1..80).map { n -> pool.submit {
            (if (n % 2 == 0) first else second).insert(PushHistoryItem(title = "$n", content = "", messageId = "$n"))
        } }
        futures.forEach { it.get(10, TimeUnit.SECONDS) }
        pool.shutdownNow()
        assertEquals(80, first.all().size)
        first.update { it.clear() }
        assertTrue(second.all().isEmpty())
    }

    @Test fun malformedStoreIsBackedUpAndNewMessagesStillWork() {
        val path = temp.newFolder().resolve("history.json")
        path.writeText("broken")
        PushHistoryFile(path).insert(PushHistoryItem(title = "new", content = ""))
        assertEquals("new", PushHistoryFile(path).all().single().title)
        assertEquals("broken", path.parentFile!!.listFiles()!!.single { it.name.contains(".corrupt-") }.readText())
    }

    @Test fun duplicateCompletesReceiptAndLinkWithoutLosingReadState() {
        val store = PushHistoryFile(temp.newFolder().resolve("history.json"))
        store.insert(PushHistoryItem(title = "old", content = "", messageId = "42", read = true,
            extras = """{"messageId":"42","url":"https://example.com"}"""))
        val item = store.insert(PushHistoryItem(title = "retry", content = "", messageId = "42",
            extras = """{"extra":{"messageId":"42","readToken":"secret"}}""")).item
        assertTrue(item.read)
        assertEquals("42" to "secret", PushPayload.readFields(item.extras))
        assertEquals("https://example.com", PushPayload.openUrl(item.extras))
    }
}
