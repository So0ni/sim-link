package dev.simlink.gateway

import org.junit.Assert.*
import dev.simlink.gateway.telephony.*
import org.junit.Test

class SendStateTest {
    @Test fun allPartsMustSucceedBeforeSent() {
        assertEquals(SendState.PROCESSING, summarizeSend(listOf(-1, null), false, 1000))
        assertEquals(SendState.SENT, summarizeSend(listOf(-1, -1), false, 1000))
    }
    @Test fun timeoutAndInterruptedExecutionAreUnknownNotFailure() {
        assertEquals(SendState.UNKNOWN, summarizeSend(listOf(null), false, 120_000))
        assertEquals(SendState.UNKNOWN, summarizeSend(listOf(null), true, 10))
    }
    @Test fun partialSuccessCannotBecomeWholeMessageFailure() {
        assertEquals(SendState.PARTIAL, summarizeSend(listOf(-1, 4), false, 10))
        assertEquals(SendState.PARTIAL, summarizeSend(listOf(-1, 4, null), true, 200_000))
    }
    @Test fun allConfirmedFailuresAreFailure() {
        assertEquals(SendState.FAILED, summarizeSend(listOf(4, 1), false, 10))
        assertEquals(SendState.UNKNOWN, summarizeSend(listOf(4, null), false, 200_000))
    }
    @Test fun lateSuccessSupersedesAnUnknownBoundary() {
        assertEquals(SendState.SENT, summarizeSend(listOf(-1, -1), true, 200_000))
    }
    @Test fun requiresExplicitInternationalNumber() {
        assertEquals("+6581234567", normalizedRecipient("+65 8123 4567"))
        assertNull(normalizedRecipient("81234567"))
        assertNull(normalizedRecipient("+012345678"))
        assertNull(normalizedRecipient("+65;1234567"))
    }
}
