package dev.simlink.gateway.sync

import java.util.concurrent.atomic.AtomicBoolean

/** All sync entry points share this gate; a busy caller retains its retry obligation. */
internal object SyncRunGate {
    private val active = AtomicBoolean(false)
    fun run(work: () -> Boolean): Boolean {
        if (!active.compareAndSet(false, true)) return true
        return try { work() } finally { active.set(false) }
    }
}
