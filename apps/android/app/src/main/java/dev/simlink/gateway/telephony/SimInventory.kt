package dev.simlink.gateway.telephony

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.telephony.SubscriptionManager
import dev.simlink.gateway.platform.GatewayDatabase
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

data class SimSnapshot(val status: String, val sims: List<SimMapping>) {
    fun json() = JSONObject().put("status", status).put("sims", JSONArray().apply {
        sims.forEach { sim -> put(JSONObject().put("key", sim.key)
            .put("subscriptionId", sim.observation.subscriptionId).put("slotIndex", sim.observation.slotIndex)
            .put("carrier", sim.observation.carrier)) }
    })
}

class SimInventory(private val context: Context) {
    fun refresh(): SimSnapshot = synchronized(lock) {
        if (context.checkSelfPermission(Manifest.permission.READ_PHONE_STATE) != PackageManager.PERMISSION_GRANTED)
            return SimSnapshot("permission_required", emptyList())
        val observed = try {
            val subscriptions = context.getSystemService(SubscriptionManager::class.java).activeSubscriptionInfoList
                ?: return SimSnapshot("unavailable", emptyList())
            if (subscriptions.any { it.subscriptionId < 0 || it.simSlotIndex < 0 })
                return SimSnapshot("unavailable", emptyList())
            subscriptions.map { SimObservation(it.subscriptionId, it.simSlotIndex, it.carrierName?.toString().orEmpty().take(80)) }
        } catch (_: Exception) { return SimSnapshot("unavailable", emptyList()) }
        val db = GatewayDatabase.get(context).writableDatabase
        db.beginTransaction()
        try {
            val previous = db.rawQuery("SELECT local_key,sub_id,slot_index,carrier FROM sim_mappings", null).use { c ->
                buildList { while (c.moveToNext()) add(SimMapping(c.getString(0), SimObservation(c.getInt(1),c.getInt(2),c.getString(3)))) }
            }
            val current = reconcileSims(previous, observed) { UUID.randomUUID().toString() }
            db.execSQL("DELETE FROM sim_mappings")
            current.forEach { db.execSQL("INSERT INTO sim_mappings VALUES(?,?,?,?)", arrayOf<Any>(it.key,it.observation.subscriptionId,it.observation.slotIndex,it.observation.carrier)) }
            db.setTransactionSuccessful()
            SimSnapshot("available", current)
        } finally { db.endTransaction() }
    }
    companion object { private val lock = Any() }
}
