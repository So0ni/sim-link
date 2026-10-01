package dev.simlink.gateway

import dev.simlink.gateway.sync.*
import org.junit.Assert.*
import org.junit.Test

class SyncEngineTest {
    private class Memory : SyncStorage {
        var generation = "pair-a"
        var enabled = true
        val pending = mutableListOf(UploadEvent("event-a", "Example", "Fictional", 1, 1000))
        val acknowledged = mutableListOf<String>()
        val blocked = mutableListOf<String>()
        override fun target() = SyncTarget(generation, enabled) { "fictional-token" }
        override fun currentGeneration() = generation
        override fun next(generation: String) = if (generation == this.generation) pending.firstOrNull() else null
        override fun ack(generation: String, event: UploadEvent, time: Long) { pending.remove(event); acknowledged.add(event.id) }
        override fun block(generation: String, event: UploadEvent, reason: String) { pending.remove(event); blocked.add(event.id) }
        override fun pause(generation: String, notice: String) { enabled = false }
        override fun notice(generation: String, notice: String) {}
    }
    @Test fun boundedSmsBatchLeavesRoomForOtherEventTypesWithoutLosingRetry() {
        val store = Memory()
        repeat(19) { store.pending.add(UploadEvent("extra-$it", "Example", "Fictional", 1, 1000)) }
        val retry = SyncEngine(store, { event, _ -> UploadAck(event.id, 1, 1000) }, { false }, maxEvents = 8).run()
        assertTrue(retry)
        assertEquals(8, store.acknowledged.size)
        assertEquals(12, store.pending.size)
    }
    @Test fun lostAckRetriesSameEventWithoutPrematureCompletion() {
        val store = Memory(); val ids = mutableListOf<String>()
        var loseResponse = true
        val engine = SyncEngine(store, { event, _ ->
            ids.add(event.id)
            if (loseResponse) throw java.io.IOException("fictional lost response")
            UploadAck(event.id, 1, 1000)
        }, { false })
        assertTrue(engine.run()); assertEquals(1, store.pending.size); assertTrue(store.acknowledged.isEmpty())
        loseResponse = false
        assertFalse(engine.run()); assertEquals(listOf("event-a", "event-a"), ids); assertEquals(listOf("event-a"),store.acknowledged)
    }
    @Test fun mismatchedAckKeepsLocalEvent() {
        val store = Memory()
        assertTrue(SyncEngine(store, { _, _ -> UploadAck("wrong", 1, 1000) }, { false }).run())
        assertEquals(1, store.pending.size)
    }
    @Test fun revokedCredentialPausesInsteadOfDroppingOrRetrying() {
        val store = Memory()
        assertFalse(SyncEngine(store, { _, _ -> throw UploadFailure(401) }, { false }).run())
        assertFalse(store.enabled); assertEquals(1, store.pending.size)
    }
    @Test fun conflictBlocksOnlyAffectedEvent() {
        val store = Memory(); store.pending.add(UploadEvent("event-b", "Example", "Other", 1, 1001))
        SyncEngine(store, { event, _ -> if(event.id == "event-a") throw UploadFailure(409) else UploadAck(event.id, 2, 1001) }, { false }).run()
        assertEquals(listOf("event-a"),store.blocked); assertEquals(listOf("event-b"),store.acknowledged)
    }
    @Test fun changedPairingStopsBeforeNextNetworkRequest() {
        val store = Memory(); store.pending.add(UploadEvent("event-b", "Example", "Other", 1, 1001))
        var uploads = 0
        SyncEngine(store, { event, _ -> uploads++; store.generation = "pair-b"; UploadAck(event.id, 1, 1000) }, { false }).run()
        assertEquals(1, uploads); assertEquals("event-b",store.pending.single().id)
    }
    @Test fun stoppedJobDoesNotAcknowledgeUncertainRequest() {
        val store = Memory(); var stopped = false
        assertTrue(SyncEngine(store, { event, _ -> stopped = true; UploadAck(event.id, 1, 1000) }, { stopped }).run())
        assertTrue(store.acknowledged.isEmpty()); assertEquals(1,store.pending.size)
    }
    @Test fun emptyQueueStillSendsHeartbeat() {
        val store = Memory(); store.pending.clear(); var beats = 0
        assertFalse(SyncEngine(store, { _, _ -> error("No SMS expected") }, { false }, { beats++ }).run())
        assertEquals(1, beats)
    }
    @Test fun heartbeatFailureDoesNotBlockSmsAndRequestsRetry() {
        val store = Memory()
        assertTrue(SyncEngine(store, { event, _ -> UploadAck(event.id,1,1000) }, { false }, { throw UploadFailure(503) }).run())
        assertEquals(listOf("event-a"), store.acknowledged)
    }
    @Test fun revokedIdleGatewayPausesAndOldServerRemainsCompatible() {
        val store = Memory(); store.pending.clear()
        assertFalse(SyncEngine(store, { _, _ -> error("No SMS") }, { false }, { throw UploadFailure(401) }).run())
        assertFalse(store.enabled)
        store.enabled = true
        assertFalse(SyncEngine(store, { _, _ -> error("No SMS") }, { false }, { throw UploadFailure(404) }).run())
        assertTrue(store.enabled)
    }
}
