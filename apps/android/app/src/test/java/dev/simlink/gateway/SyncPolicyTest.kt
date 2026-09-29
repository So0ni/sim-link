package dev.simlink.gateway

import dev.simlink.gateway.connection.serverOrigin
import dev.simlink.gateway.sync.*
import org.junit.Assert.*
import org.junit.Test

class SyncPolicyTest {
    @Test fun httpsOriginIsNormalizedWithoutPathsOrCredentials() {
        assertEquals("https://sim.example.com", serverOrigin(" HTTPS://SIM.EXAMPLE.COM:443/ "))
        assertEquals("https://192.168.1.10:8443", serverOrigin("https://192.168.1.10:8443"))
        listOf("http://sim.example.com", "https://user:pass@example.com", "https://example.com/api", "https://example.com?token=x", "https://example.com/#x").forEach { value ->
            assertThrows(Exception::class.java) { serverOrigin(value) }
        }
    }
    @Test fun httpRequiresExplicitOptIn() {
        assertEquals("http://192.168.1.10:8787", serverOrigin("http://192.168.1.10:8787/", true))
        assertThrows(Exception::class.java) { serverOrigin("http://192.168.1.10:8787") }
    }
    @Test fun credentialAndEventFailuresDoNotEnterBlindRetry() {
        assertEquals(UploadAction.PAUSE_CONNECTION, uploadAction(401))
        assertEquals(UploadAction.PAUSE_CONNECTION, uploadAction(403))
        assertEquals(UploadAction.BLOCK_EVENT, uploadAction(409))
        assertEquals(UploadAction.BLOCK_EVENT, uploadAction(400))
        assertEquals(UploadAction.BLOCK_EVENT, uploadAction(302))
        assertEquals(UploadAction.RETRY, uploadAction(429))
        assertEquals(UploadAction.RETRY, uploadAction(503))
    }
    @Test fun onlyMatchingPersistedAckMarksSynced() {
        assertTrue(matchesAck("a", "a", 1, 123))
        assertFalse(matchesAck("a", "b", 1, 123))
        assertFalse(matchesAck("a", "a", 0, 123))
        assertFalse(matchesAck("a", "a", 1, -1))
    }
}
