package com.shifuf.prism.push

import org.junit.Assert.*
import org.junit.Test

class PushPayloadTest {
    @Test fun nestedHttpLinkIsAccepted() {
        assertEquals("https://example.com/a", PushPayload.openUrl("""{"extra":{"url":"https://example.com/a"}}"""))
    }
    @Test fun malformedAndDangerousLinksAreRejected() {
        listOf("httpx://example.com", "javascript:alert(1)", "https:///missing", "https://user:password@example.com", "http:")
            .forEach { assertNull(it, PushPayload.openUrl(org.json.JSONObject().put("url", it).toString())) }
    }
    @Test fun malformedPayloadIsHarmless() {
        assertNull(PushPayload.openUrl("bad"))
        assertEquals(null to null, PushPayload.readFields("bad"))
    }
}
