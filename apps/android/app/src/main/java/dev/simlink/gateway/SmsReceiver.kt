package dev.simlink.gateway

/** Stable components preserve system PendingIntents across upgrades. */
class SmsReceiver : dev.simlink.gateway.telephony.SmsReceiver()
class SentReceiver : dev.simlink.gateway.telephony.SentReceiver()
