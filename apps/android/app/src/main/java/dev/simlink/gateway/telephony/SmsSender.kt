package dev.simlink.gateway.telephony

import dev.simlink.gateway.SentReceiver
import dev.simlink.gateway.data.MessageStore

import android.Manifest
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.telephony.SmsManager
import android.telephony.SubscriptionManager
import java.util.UUID

object SmsSender {
    /** Caller must reserve remote commands durably before entry; no modem retries. */
    fun send(context: Context, subId: Int, slot: Int, address: String, body: String, id: String = UUID.randomUUID().toString(), beforeSubmit: () -> Boolean = { true }): String {
        require(normalizedRecipient(address) != null) { "请输入带国家区号的号码" }
        require(body.isNotBlank()) { "请输入短信正文" }
        check(context.checkSelfPermission(Manifest.permission.SEND_SMS) == PackageManager.PERMISSION_GRANTED) { "请先授予发送短信权限" }
        check(context.checkSelfPermission(Manifest.permission.READ_PHONE_STATE) == PackageManager.PERMISSION_GRANTED) { "请先授予 SIM 读取权限" }
        val selected = context.getSystemService(SubscriptionManager::class.java).activeSubscriptionInfoList
            ?.firstOrNull { it.subscriptionId == subId && it.simSlotIndex == slot }
        check(selected != null) { "SIM 已变化，请返回运行页重新检查" }
        val manager = context.getSystemService(SmsManager::class.java).createForSubscriptionId(subId)
        val parts = manager.divideMessage(body)
        val store = MessageStore.get(context)
        // Persist every part before entering the modem API; a crash never causes automatic resend.
        check(parts.size in 1..32)
        check(store.insert(id, address, body, subId, System.currentTimeMillis(), true, parts.size)) { "发件已记录，禁止重复提交" }
        try {
            val sent = ArrayList(parts.indices.map { i ->
                PendingIntent.getBroadcast(context, 0,
                    Intent(context, SentReceiver::class.java).apply {
                        data = Uri.parse("simlink://sent/$id/$i")
                        putExtra("message_id", id); putExtra("part_index", i)
                    }, PendingIntent.FLAG_ONE_SHOT or PendingIntent.FLAG_IMMUTABLE)
            })
            check(beforeSubmit()) { "执行条件已改变" }
            manager.sendMultipartTextMessage(address, null, parts, sent, null)
        } catch (_: Exception) {
            // The boundary may already have accepted work. Conservatively keep the result unknown.
            store.interrupted(id)
        }
        return id
    }
}
