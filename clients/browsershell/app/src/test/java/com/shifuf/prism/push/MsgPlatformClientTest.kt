package com.shifuf.prism.push

import org.junit.Assert.assertEquals
import org.junit.Test

class MsgPlatformClientTest {
    @Test fun readsStringEncodedExtra() {
        val extra = org.json.JSONObject().put("extra", """{"message_id":"42","read_token":"secret"}""").toString()
        assertEquals("42" to "secret", MsgPlatformClient.extractReadFields(extra))
    }

    @Test fun ignoresJsonNullFields() {
        assertEquals(null to null, MsgPlatformClient.extractReadFields("""{"messageId":null,"readToken":null}"""))
    }

    @Test fun readsNestedPayloadEvenWhenOuterIdIsBlank() {
        assertEquals("42" to "secret", MsgPlatformClient.extractReadFields(
            """{"messageId":"","extra":{"messageId":"42","readToken":"secret"}}"""
        ))
    }
}
