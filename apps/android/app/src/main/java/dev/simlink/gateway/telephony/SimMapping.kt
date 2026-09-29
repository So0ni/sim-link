package dev.simlink.gateway.telephony

data class SimObservation(val subscriptionId: Int, val slotIndex: Int, val carrier: String)
data class SimMapping(val key: String, val observation: SimObservation)

/** Identity is an observed mapping, never a permanent physical SIM identity. */
fun reconcileSims(previous: List<SimMapping>, current: List<SimObservation>, newKey: () -> String): List<SimMapping> =
    current.map { observation ->
        previous.find { it.observation == observation } ?: SimMapping(newKey(), observation)
    }
