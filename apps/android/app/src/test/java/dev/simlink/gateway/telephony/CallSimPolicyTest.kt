package dev.simlink.gateway.telephony

import org.junit.Assert.*
import org.junit.Test

class CallSimPolicyTest {
    private val first=SimMapping("sms-key-one",SimObservation(11,0,"Carrier"))
    private val second=SimMapping("sms-key-two",SimObservation(22,1,"Carrier"))
    @Test fun mapsBothSubscriptionsToTheExistingSmsKeys() {
        val snapshot=SimSnapshot("available",listOf(first,second))
        assertEquals(first.key,callSimKey(snapshot,11))
        assertEquals(second.key,callSimKey(snapshot,22))
    }
    @Test fun noFallbackToOnlySimOrSlotNumber() {
        val snapshot=SimSnapshot("available",listOf(first))
        listOf(-1,0,1,22).forEach { assertNull(callSimKey(snapshot,it)) }
        assertNull(callSimKey(SimSnapshot("unavailable",listOf(first)),11))
        assertNull(callSimKey(SimSnapshot("available",listOf(first,first.copy(key="ambiguous"))),11))
    }
}
