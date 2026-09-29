package dev.simlink.gateway.commands

/** The durable reservation must precede validation and the modem boundary. No replay path calls send. */
class CommandExecutor(
    private val reserve: () -> Boolean,
    private val rejection: () -> String?,
    private val reject: (String) -> Unit,
    private val send: () -> Unit
) {
    fun run() {
        if (!reserve()) return
        val reason = rejection()
        if (reason != null) { reject(reason); return }
        // An exception after reservation is reconciled from durable parts, never by another send.
        send()
    }
}
fun executionRejection(enabled: Boolean, sameConnection: Boolean, sameSim: Boolean, remainingMillis: Long): String? = when {
    !sameConnection -> "connection_changed"
    remainingMillis <= 0 -> "expired"
    !enabled -> "permission_required"
    !sameSim -> "sim_changed"
    else -> null
}

fun mayExecuteClaim(state: String, reportedPartCount: Int): Boolean =
    state in setOf("claimed", "unknown") && reportedPartCount == 0
