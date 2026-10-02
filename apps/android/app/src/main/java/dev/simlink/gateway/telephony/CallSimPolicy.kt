package dev.simlink.gateway.telephony

/** Ambiguous or unavailable inventory must not guess the sole/default SIM. */
fun callSimKey(snapshot: SimSnapshot, subscription: Int): String? =
    if(snapshot.status != "available" || subscription < 0) null
    else snapshot.sims.singleOrNull { it.observation.subscriptionId == subscription }?.key
