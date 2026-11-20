package com.shifuf.prism.push

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class ConversationProtocolTest {
    @Test fun nullableLegacyTitleAndContentRemainReadable() {
        val value = ConversationProtocol.parseConversation("""{"success":true,"data":{"messageId":"42","title":null,"content":null,"replies":[],"canReply":true}}""", "42")
        assertEquals("", value.title)
        assertEquals("", value.content)
    }
    @Test fun readCredentialNeverGrantsConversationAccess() {
        assertNull(PushPayload.conversationFields("""{"messageId":"42","readToken":"read-only"}"""))
        assertNull(PushPayload.conversationFields("""{"conversationId":"42","readToken":"read-only"}"""))
        assertEquals(ConversationCredentials("42", "chat-secret"), PushPayload.conversationFields(
            """{"extra":"{\"conversationId\":\"42\",\"conversationToken\":\"chat-secret\",\"readToken\":\"read-secret\"}"}"""))
    }

    @Test fun cannotSendCredentialsToChangedOrCleartextOrigin() {
        assertNull(ConversationProtocol.endpoint("https://new.example.com", "https://old.example.com", "conversation"))
        assertNull(ConversationProtocol.endpoint("http://msg.example.com", "http://msg.example.com", "reply"))
        assertNull(ConversationProtocol.endpoint("https://msg.example.com", "", "reply"))
        assertEquals("https://msg.example.com/api/public/messages/reply",
            ConversationProtocol.endpoint("https://MSG.example.com/", "https://msg.example.com", "reply"))
    }

    @Test fun replyPayloadTrimsTextAndKeepsIdempotencyKey() {
        val pending = PendingReply("abc", "  Hello\n  ")
        val body = ConversationProtocol.replyBody(ConversationCredentials("42", "chat-only"), pending)
        assertEquals("42", body.getString("messageId"))
        assertEquals("chat-only", body.getString("token"))
        assertEquals("Hello", body.getString("content"))
        assertEquals("abc", body.getString("clientId"))
        assertFalse(body.has("readToken"))
    }

    @Test fun malformedSuccessEnvelopeIsNeverShownAsSuccessfulChat() {
        listOf("<html>upstream error</html>", "{}", """{"success":true,"data":{}}""",
            """{"success":false,"data":{"messageId":"42","replies":[]}}""").forEach {
            assertTrue(runCatching { ConversationProtocol.parseConversation(it, "42") }.isFailure)
        }
    }

    @Test fun parsesServerTimesAndReplyReadStateFromEnvelope() {
        val result = ConversationProtocol.parseConversation("""{"success":true,"data":{"messageId":"42","title":"Notice","content":"Original","canReply":true,"replies":[{"id":"r1","author":"admin","content":"Hello","createdAt":"2026-11-17T10:00:00Z","readAt":null},{"id":"r2","author":"device","content":"Thanks","clientId":"local-1","createdAt":"2026-11-17T10:01:00Z","readAt":"2026-11-17T10:02:00Z"}]}}""", "42")
        assertEquals(2, result.replies.size)
        assertEquals("2026-11-17T10:00:00Z", result.replies[0].createdAt)
        assertNull(result.replies[0].readAt)
        assertEquals("local-1", result.replies[1].clientId)
        assertTrue(result.canReply)
        assertTrue(runCatching { ConversationProtocol.parseConversation("""{"success":true,"data":{"messageId":"other","title":"","content":"","replies":[],"canReply":true}}""", "42") }.isFailure)
    }
}
