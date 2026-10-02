package dev.simlink.gateway.calls

/** Android CallLog type values; outgoing/voicemail/unknown are not inbound-call events. */
fun callOutcome(type: Int): String? = when(type) {
    1 -> "incoming"
    3 -> "missed"
    5 -> "rejected"
    6 -> "blocked"
    else -> null
}
fun scanCursor(saved: Long, observedMax: Long): Long = if(observedMax < saved) 0 else saved

/** Provider ID reuse must not attribute an unrelated historical call. */
fun matchesCapturedCall(old: CapturedCall,id: Long,number: String?,outcome: String?,started: Long,duration: Long): Boolean =
    old.source == id && old.number == number && old.outcome == outcome && old.started == started && old.duration == duration
