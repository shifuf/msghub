package com.shifuf.prism.core

import org.junit.Assert.assertEquals
import org.junit.Test

class NavigationInputTest {
    @Test fun homepageAndAddressBarAcceptIpPortsFragmentsAndInternationalDomains() {
        listOf("192.168.1.1", "example.com:8443", "example.com#section", "例子.测试").forEach {
            assertEquals("https://$it", NavigationInput.resolve(it) { "search:$it" })
        }
        assertEquals("http://127.0.0.1:18765", NavigationInput.resolve(" http://127.0.0.1:18765 ") { "search:$it" })
        assertEquals("search:hello world", NavigationInput.resolve("hello world") { "search:$it" })
    }
}
