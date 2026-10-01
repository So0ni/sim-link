package dev.simlink.gateway.calls

import org.junit.Assert.*
import org.junit.Test
class CallPolicyTest {
    @Test fun systemOutcomesDoNotInferMissedFromZeroDuration() {
        assertEquals("incoming",callOutcome(1))
        assertEquals("missed",callOutcome(3))
        assertEquals("rejected",callOutcome(5))
        assertEquals("blocked",callOutcome(6))
        listOf(0,2,4,7,99).forEach { assertNull(callOutcome(it)) }
    }
    @Test fun providerResetCannotLeaveCursorBeyondNewRecords() {
        assertEquals(0L,scanCursor(200,1))
        assertEquals(200L,scanCursor(200,200))
        assertEquals(200L,scanCursor(200,300))
    }
}
