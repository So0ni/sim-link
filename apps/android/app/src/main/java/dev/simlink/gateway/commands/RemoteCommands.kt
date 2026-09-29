package dev.simlink.gateway.commands

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.os.SystemClock
import dev.simlink.gateway.connection.*
import dev.simlink.gateway.platform.GatewayDatabase
import dev.simlink.gateway.telephony.SimInventory
import dev.simlink.gateway.telephony.SmsSender
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

class RemoteSendSettings(private val context: Context) {
    private val prefs = context.getSharedPreferences("remote-send", Context.MODE_PRIVATE)
    private fun key() = ConnectionStore(context).current()?.generation
    fun optedIn(): Boolean = key()?.let { prefs.getBoolean(it, false) } ?: false
    fun setEnabled(value: Boolean) { key()?.let { check(prefs.edit().putBoolean(it,value).commit()) } }
    fun allowed() = optedIn() && listOf(Manifest.permission.SEND_SMS,Manifest.permission.READ_PHONE_STATE)
        .all { context.checkSelfPermission(it) == PackageManager.PERMISSION_GRANTED }
}

/** NetworkIo serializes runners; SQLite reserves commands across process death and APK updates. */
class RemoteCommands(private val context: Context, private val api: GatewayApi, private val cancellation: RequestCancellation) {
    private val db = GatewayDatabase.get(context).writableDatabase
    private val connections = ConnectionStore(context)
    private val settings = RemoteSendSettings(context)
    fun run(connection: Connection, token: String) {
        fun current() = !cancellation.stopped.get() && connections.current()?.let { it.generation == connection.generation && it.enabled } == true
        if (!current()) return
        try { api.sendCapability(settings.allowed(),token) } catch (e: ApiFailure) { if (e.status == 404) return else throw e }
        // Report only changed snapshots; callbacks can improve unknown results on later syncs.
        val rows = db.rawQuery("SELECT command_id,claim_id,rejection,last_report FROM remote_commands WHERE generation=?",arrayOf(connection.generation)).use { c ->
            buildList { while(c.moveToNext()) add(arrayOf(c.getString(0),c.getString(1),if(c.isNull(2)) null else c.getString(2),if(c.isNull(3)) null else c.getString(3))) }
        }
        for (row in rows) {
            if (!current()) return
            val results = db.rawQuery("SELECT result FROM parts WHERE message_id=? ORDER BY part_index",arrayOf(row[0])).use { c ->
                JSONArray().apply { while(c.moveToNext()) put(if(c.isNull(0)) JSONObject.NULL else c.getInt(0)) }
            }
            val interrupted = db.rawQuery("SELECT interrupted FROM messages WHERE id=?",arrayOf(row[0])).use { it.moveToFirst() && it.getInt(0)==1 }
            val report = JSONObject().put("claimRequestId",row[1]).put("rejection",row[2] ?: if(results.length()==0) "execution_interrupted" else JSONObject.NULL)
                .put("parts",results).put("interrupted",interrupted)
            val serialized=report.toString()
            if(serialized != row[3]) {
                api.commandResult(row[0]!!,report,token)
                db.execSQL("UPDATE remote_commands SET last_report=? WHERE command_id=? AND generation=?",arrayOf(serialized,row[0],connection.generation))
            }
        }
        if (!settings.allowed() || !current()) return
        repeat(5) {
            db.execSQL("INSERT OR IGNORE INTO command_cursor(generation,request_id) VALUES(?,?)",arrayOf(connection.generation,UUID.randomUUID().toString()))
            val claimId=db.rawQuery("SELECT request_id FROM command_cursor WHERE generation=?",arrayOf(connection.generation)).use { it.moveToFirst(); it.getString(0) }
            val started=SystemClock.elapsedRealtime()
            val response=api.claimCommand(claimId,token)
            val command=response.optJSONObject("command") ?: return
            check(command.getString("deviceId") == connection.deviceId && command.getString("claimRequestId") == claimId)
            val id=command.getString("id")
            if (!mayExecuteClaim(command.getString("state"),command.getJSONArray("parts").length())) {
                db.execSQL("UPDATE command_cursor SET request_id=? WHERE generation=?",arrayOf(UUID.randomUUID().toString(),connection.generation))
                return
            }
            val remaining=command.getLong("expiresAt")-response.getLong("serverTime")
            fun validate(): String? {
                val sim=SimInventory(context).refresh().sims.find { it.key==command.getString("simKey") }
                return executionRejection(settings.allowed(),current(),sim?.observation?.let {
                    it.subscriptionId==command.getInt("subscriptionId") && it.slotIndex==command.getInt("slotIndex")
                } == true,remaining-(SystemClock.elapsedRealtime()-started))
            }
            fun reject(reason: String) { db.execSQL("UPDATE remote_commands SET rejection=? WHERE command_id=?",arrayOf(reason,id)) }
            val executor=CommandExecutor(
                reserve={
                    db.beginTransaction()
                    try {
                        val count=db.compileStatement("INSERT OR IGNORE INTO remote_commands(command_id,generation,claim_id) VALUES(?,?,?)").use { q ->
                            q.bindString(1,id);q.bindString(2,connection.generation);q.bindString(3,claimId);q.executeInsert()
                        }
                        db.execSQL("UPDATE command_cursor SET request_id=? WHERE generation=?",arrayOf(UUID.randomUUID().toString(),connection.generation))
                        db.setTransactionSuccessful(); count != -1L
                    } finally { db.endTransaction() }
                },
                rejection={ validate() },
                reject={ reject(it) },
                send={ SmsSender.send(context,command.getInt("subscriptionId"),command.getInt("slotIndex"),command.getString("recipient"),command.getString("body"),id) {
                    val reason=validate(); if(reason!=null) reject(reason); reason==null
                } }
            )
            executor.run()
            if (!current()) return
        }
    }
}
