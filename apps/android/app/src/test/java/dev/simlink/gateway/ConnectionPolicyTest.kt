package dev.simlink.gateway

import dev.simlink.gateway.connection.canRetainQueue
import org.junit.Assert.*
import org.junit.Test

class ConnectionPolicyTest {
    @Test fun onlyVerifiedSameServerAndDeviceRetainQueue() {
        assertTrue(canRetainQueue("server", "device", "server", "device"))
        assertFalse(canRetainQueue(null, "device", "server", "device"))
        assertFalse(canRetainQueue("other", "device", "server", "device"))
        assertFalse(canRetainQueue("server", "other", "server", "device"))
    }
}
