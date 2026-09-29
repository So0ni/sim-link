package dev.simlink.gateway
import dev.simlink.gateway.connection.PairingQr
import org.junit.Assert.*
import org.junit.Test
class PairingQrTest {
    private fun payload(server: String = "https://sim.example.com", token: String = "a".repeat(43), expiry: Long = 2000) =
        """{"type":"simlink.pairing","version":1,"apiVersion":1,"server":"$server","pairingToken":"$token","expiresAt":$expiry}"""
    @Test fun acceptsVersionedPayload() {
        val code = PairingQr.parse(payload(), 1000)
        assertEquals("https://sim.example.com", code.server)
        assertEquals("a".repeat(43), code.token)
    }
    @Test fun rejectsExpiredWrongVersionAndMalformedCredentials() {
        for (raw in listOf(payload(expiry = 1000), payload(token = "short"), payload().replace("simlink.pairing", "other"), payload().replace("version", "unsupported"), "https://example.com", "x".repeat(4097))) {
            assertThrows(Exception::class.java) { PairingQr.parse(raw, 1000) }
        }
    }
    @Test fun rejectsCredentialUrlsAndNonOriginPaths() {
        for (server in listOf("https://user:pass@example.com", "https://example.com/path", "javascript:alert(1)", "https://example.com?token=x")) {
            assertThrows(Exception::class.java) { PairingQr.parse(payload(server), 1000) }
        }
    }
    @Test fun httpParsingDoesNotPerformPairing() {
        assertEquals("http://192.168.1.10:8787", PairingQr.parse(payload("http://192.168.1.10:8787"), 1000).server)
    }
}
