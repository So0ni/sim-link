package dev.simlink.gateway
import dev.simlink.gateway.sync.*
import org.junit.Assert.*
import org.junit.Test
import java.io.IOException
class UploadRetryTest {
    @Test fun transientUploadGetsTwoExtraAttempts() {
        var calls = 0; val delays = mutableListOf<Long>()
        assertEquals("ack", retryUpload({ false }, { delays.add(it); true }) {
            if (++calls < 3) throw IOException() else "ack"
        })
        assertEquals(listOf(2000L, 5000L), delays); assertEquals(3, calls)
    }
    @Test fun permanentAndRateLimitedFailuresDoNotRetry() {
        for (status in listOf(400,401,403,409,429)) {
            assertThrows(UploadFailure::class.java) { retryUpload({ false }, { error("No quick retry") }) { throw UploadFailure(status) } }
        }
    }
    @Test fun retryAfterDisablesQuickRetry() {
        assertThrows(UploadFailure::class.java) { retryUpload({ false }, { error("Server requested backoff") }) { throw UploadFailure(503, true) } }
    }
    @Test fun failureBudgetAndCancellationKeepWorkForLater() {
        var calls = 0
        assertThrows(IOException::class.java) { retryUpload({ false }, { true }) { calls++; throw IOException() } }
        assertEquals(3, calls)
        calls = 0
        assertThrows(IOException::class.java) { retryUpload({ false }, { false }) { calls++; throw IOException() } }
        assertEquals(1, calls)
        assertThrows(IOException::class.java) { retryUpload({ true }, { error("Cancelled") }) { throw IOException() } }
    }
}
