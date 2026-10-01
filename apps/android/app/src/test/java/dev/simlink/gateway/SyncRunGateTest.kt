package dev.simlink.gateway

import dev.simlink.gateway.sync.SyncRunGate
import org.junit.Assert.*
import org.junit.Test
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

class SyncRunGateTest {
    @Test fun concurrentWakeupDefersWithoutExecutingAndCanResume() {
        val entered = CountDownLatch(1)
        val release = CountDownLatch(1)
        val worker = Thread { SyncRunGate.run { entered.countDown(); release.await(); false } }
        worker.start()
        try {
            assertTrue(entered.await(2, TimeUnit.SECONDS))
            assertTrue(SyncRunGate.run { fail("Concurrent sync must not execute"); false })
        } finally { release.countDown(); worker.join(2000) }
        var executed = false
        assertFalse(SyncRunGate.run { executed = true; false })
        assertTrue(executed)
    }

    @Test fun failureReleasesGateAndRetryResultIsPreserved() {
        try { SyncRunGate.run { throw IllegalStateException() }; fail() }
        catch (_: IllegalStateException) { }
        assertTrue(SyncRunGate.run { true })
        assertFalse(SyncRunGate.run { false })
    }
}
