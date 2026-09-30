package dev.simlink.gateway.sync

/** Serialize SMS requests with job completion so arrivals at the end of a run are not lost. */
internal class SmsSyncDispatch {
    private var running = false
    private var requested = false

    @Synchronized fun request(schedule: () -> Boolean): Boolean {
        if (running) {
            requested = true
            return true
        }
        return schedule()
    }

    @Synchronized fun started() { running = true; requested = false }

    @Synchronized fun finished(retry: Boolean, finish: (Boolean) -> Unit) {
        // jobFinished is asynchronous. Let the system reschedule the same job rather than
        // replacing it before its completion callback has reached JobScheduler.
        finish(retry || requested)
        running = false
        requested = false
    }

    @Synchronized fun stopped() { running = false; requested = false }
}

/** A rejected expedited request must still register durable ordinary work. */
internal fun scheduleSmsWithFallback(expedited: () -> Boolean, ordinary: () -> Boolean): Boolean =
    expedited() || ordinary()
