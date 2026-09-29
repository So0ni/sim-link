package dev.simlink.gateway

import dev.simlink.gateway.telephony.*
import org.junit.Assert.*
import org.junit.Test

class SimMappingTest {
    @Test fun retainsOnlyUnchangedObservedMapping() {
        val first = SimObservation(1, 0, "Test")
        val old = listOf(SimMapping("old", first))
        assertEquals("old", reconcileSims(old, listOf(first)) { "new" }.single().key)
        for (changed in listOf(first.copy(subscriptionId = 2), first.copy(slotIndex = 1), first.copy(carrier = "Other")))
            assertEquals("new", reconcileSims(old, listOf(changed)) { "new" }.single().key)
    }
    @Test fun removalAndReappearanceNeverReuseRetiredIdentity() {
        val sim = SimObservation(1, 0, "Test")
        val removed = reconcileSims(listOf(SimMapping("old", sim)), emptyList()) { "unused" }
        assertEquals("new", reconcileSims(removed, listOf(sim)) { "new" }.single().key)
    }
    @Test fun listOrderDoesNotChangeDualSimIdentities() {
        val one = SimMapping("one", SimObservation(1, 0, "Test"))
        val two = SimMapping("two", SimObservation(2, 1, "Test"))
        assertEquals(listOf(two, one), reconcileSims(listOf(one, two), listOf(two.observation, one.observation)) { "new" })
    }
}
