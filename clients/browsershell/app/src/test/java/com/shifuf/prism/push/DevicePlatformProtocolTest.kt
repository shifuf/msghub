package com.shifuf.prism.push

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class DevicePlatformProtocolTest {
    @Test fun extractsReceivedTokenWithoutReusingReadOrConversationCredentials() {
        assertEquals("receive-only", PushPayload.receivedToken(
            """{"extra":{"receivedToken":"receive-only","readToken":"read-only","conversationToken":"conversation-only"}}"""
        ))
        assertNull(PushPayload.receivedToken("""{"readToken":"read-only","conversationToken":"conversation-only"}"""))
    }

    @Test fun selectsOnlyTheReceiptSignatureIssuedForThisRegistrationId() {
        val extras = """{"receivedTokens":{"rid-a":"sig-a","rid-b":"sig-b"}}"""
        assertEquals("sig-b", PushPayload.receivedToken(extras, "rid-b"))
        assertNull(PushPayload.receivedToken(extras, "rid-c"))
        assertNull(PushPayload.receivedToken(extras))
    }

    @Test fun selectsOwnReceiptFromThePlatformsJsonEncodedTokenMap() {
        val extras = """{"receivedTokens":"{\"rid-a\":\"sig-a\",\"rid-b\":\"sig-b\"}","readToken":"read-only"}"""
        assertEquals("sig-b", PushPayload.receivedToken(extras, "rid-b"))
        assertNull(PushPayload.receivedToken(extras, "rid-c"))
        assertNull(PushPayload.receivedToken(extras))
    }

    @Test fun acceptsOnlySingleUseSixteenDigitHexPairCode() {
        assertTrue(DevicePlatformProtocol.isPairCode("0123456789aBcDeF"))
        listOf("", "0123456789ABCDE", "0123456789ABCDEFG", "0123456789ABCDe ").forEach {
            assertFalse(DevicePlatformProtocol.isPairCode(it))
        }
    }

    @Test fun pairingRequestUsesTheServerContractAndPrivateResponseToken() {
        val body = DevicePlatformProtocol.pairBody(
            "0123456789abcdef", "registration-1", "app-key", "Pixel", "2.2.2", "35",
            notificationsEnabled = true, channelEnabled = false, connected = true
        )
        assertEquals("0123456789abcdef", body.getString("code"))
        assertEquals("registration-1", body.getString("registrationId"))
        assertEquals("app-key", body.getString("appKey"))
        assertEquals("Pixel", body.getString("name"))
        assertEquals("2.2.2", body.getString("appVersion"))
        assertEquals("35", body.getString("osVersion"))
        assertTrue(body.getBoolean("notificationsEnabled"))
        assertFalse(body.getBoolean("channelEnabled"))
        assertTrue(body.getBoolean("connected"))
        assertEquals("device-7" to "opaque-token", DevicePlatformProtocol.parsePairResponse(
            """{"success":true,"data":{"id":"device-7","token":"opaque-token"}}"""
        ))
    }

    @Test(expected = IllegalArgumentException::class)
    fun pairingRequestRejectsInvalidCodesBeforeSending() {
        DevicePlatformProtocol.pairBody("one-time-code", "registration-1", "app-key", null, null, null, true, true, true)
    }

    @Test fun heartbeatAndReceiptResponsesRequireTheNormalSuccessEnvelope() {
        assertTrue(DevicePlatformProtocol.isAcknowledged("""{"success":true,"data":{"ok":true}}"""))
        assertFalse(DevicePlatformProtocol.isAcknowledged("""{"success":false,"data":{"ok":true}}"""))
        val body = DevicePlatformProtocol.receiptBody("received-only", "registration-1", displayed = false)
        assertEquals("received-only", body.getString("receivedToken"))
        assertEquals("registration-1", body.getString("registrationId"))
        assertFalse(body.getBoolean("displayed"))
    }
}
