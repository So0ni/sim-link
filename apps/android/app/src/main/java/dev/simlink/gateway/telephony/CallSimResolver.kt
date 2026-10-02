package dev.simlink.gateway.telephony

import android.Manifest
import android.content.pm.PackageManager
import android.content.ComponentName
import android.content.Context
import android.telecom.PhoneAccountHandle
import android.telephony.TelephonyManager

/** Resolve the system account, never parse its opaque ID as a subscription or slot. */
class CallSimResolver(private val context: Context) {
    private val telephony = context.getSystemService(TelephonyManager::class.java)
    private val snapshot = SimInventory(context).refresh()
    private val resolved = mutableMapOf<Pair<String,String>,String?>()

    fun resolve(component: String?, accountId: String?): String? {
        if(context.checkSelfPermission(Manifest.permission.READ_PHONE_STATE) != PackageManager.PERMISSION_GRANTED) return null
        if(component.isNullOrBlank() || accountId.isNullOrBlank()) return null
        return resolved.getOrPut(component to accountId) {
            runCatching {
                val name = ComponentName.unflattenFromString(component) ?: return@getOrPut null
                val subscription = telephony.getSubscriptionId(PhoneAccountHandle(name,accountId))
                callSimKey(snapshot, subscription)
            }.getOrNull()
        }
    }
}
