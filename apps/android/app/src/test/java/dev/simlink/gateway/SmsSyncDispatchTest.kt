package dev.simlink.gateway

import dev.simlink.gateway.sync.SmsSyncDispatch
import dev.simlink.gateway.sync.scheduleSmsWithFallback
import org.junit.Assert.*
import org.junit.Test

class SmsSyncDispatchTest {
    @Test fun quotaRejectionFallsBackAndReportsTotalFailure() {
        var ordinary = 0
        assertTrue(scheduleSmsWithFallback({ false }, { ordinary++; true }))
        assertEquals(1, ordinary)
        assertFalse(scheduleSmsWithFallback({ false }, { false }))
        assertTrue(scheduleSmsWithFallback({ true }, { error("Unneeded fallback") }))
    }

    @Test fun smsAfterFinalQueueReadRequestsRetryWithoutCancellingRunningUpload() {
        val dispatch = SmsSyncDispatch()
        assertTrue(dispatch.request { true })
        dispatch.started()
        repeat(3) { assertTrue(dispatch.request { error("Must not replace running upload") }) }
        var reschedule = false
        dispatch.finished(false) { reschedule = it }
        assertTrue(reschedule)
        dispatch.started()
        dispatch.finished(false) { reschedule = it }
        assertFalse(reschedule)
    }

    @Test fun networkFailureRetainsRetryAndNewSmsCanPromotePendingWork() {
        val dispatch = SmsSyncDispatch()
        dispatch.started()
        dispatch.finished(true) { assertTrue(it) }
        var scheduled = false
        assertTrue(dispatch.request { scheduled = true; true })
        assertTrue(scheduled)
    }

    @Test fun stoppedJobAllowsNextSmsToRequestScheduling() {
        val dispatch = SmsSyncDispatch()
        dispatch.started()
        dispatch.request { error("Already running") }
        dispatch.stopped()
        assertFalse(dispatch.request { false })
        dispatch.started()
        dispatch.finished(false) { assertFalse(it) }
    }
}
