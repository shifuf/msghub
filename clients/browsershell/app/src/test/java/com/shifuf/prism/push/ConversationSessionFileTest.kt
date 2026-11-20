package com.shifuf.prism.push

import org.junit.Assert.*
import org.junit.Test
import java.nio.file.Files

class ConversationSessionFileTest {
    @Test fun failedReplyAndDraftSurviveRestartWithoutNewClientId() {
        val path = Files.createTempDirectory("conversation-session").resolve("state.json").toFile()
        val store = ConversationSessionFile(path)
        val reply = PendingReply.create("hello")
        store.write(ConversationSession("next draft", reply))
        val loaded = ConversationSessionFile(path).read()
        assertEquals("next draft", loaded.draft)
        assertEquals(reply.clientId, loaded.pending!!.clientId)
        assertEquals("hello", loaded.pending.content)
        java.util.UUID.fromString(loaded.pending.clientId)
    }
}
