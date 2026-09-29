package dev.simlink.gateway.telephony

import dev.simlink.gateway.data.LocalIo
import dev.simlink.gateway.data.MessageStore

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.provider.Telephony
import android.telephony.SubscriptionManager
import java.security.MessageDigest
import dev.simlink.gateway.sync.SyncScheduler

open class SmsReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Telephony.Sms.Intents.SMS_RECEIVED_ACTION) return
        val messages = Telephony.Sms.Intents.getMessagesFromIntent(intent)?.toList().orEmpty()
        if (messages.isEmpty()) return
        // OEM broadcasts may omit subscription. Preserve unknown; never guess the default SIM.
        @Suppress("DEPRECATION")
        val subscription = intent.extras?.get(SubscriptionManager.EXTRA_SUBSCRIPTION_INDEX)
            ?: intent.extras?.get("subscription")
        val subId = (subscription as? Number)?.toInt() ?: SubscriptionManager.INVALID_SUBSCRIPTION_ID
        val first = messages.first()
        val address = first.displayOriginatingAddress ?: "未知发件人"
        val body = messages.joinToString("") { it.displayMessageBody.orEmpty() }
        val digest = MessageDigest.getInstance("SHA-256")
        digest.update(subId.toString().toByteArray())
        messages.forEach { digest.update(it.pdu) }
        val id = digest.digest().joinToString("") { "%02x".format(it) }
        val pending = goAsync()
        LocalIo.executor.execute {
            try {
                MessageStore.get(context).insert(id, address, body, subId, first.timestampMillis, false)
                runCatching { SyncScheduler.schedule(context) }
            } finally { pending.finish() }
        }
    }
}

open class SentReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val id = intent.getStringExtra("message_id") ?: return
        val index = intent.getIntExtra("part_index", -1)
        if (index < 0) return
        val result = resultCode
        val pending = goAsync()
        LocalIo.executor.execute {
            try { MessageStore.get(context).result(id, index, result); SyncScheduler.schedule(context) }
            finally { pending.finish() }
        }
    }
}
