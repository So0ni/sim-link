package dev.simlink.gateway.connection

import android.content.ContentValues
import android.content.Context
import dev.simlink.gateway.platform.CredentialVault
import dev.simlink.gateway.platform.GatewayDatabase
import java.util.UUID

// Never expose credentials in toString, UI state, logs, or saved Activity state.
class Connection(val generation: String, val server: String, val deviceId: String,
                 private val sealed: String, val enabled: Boolean, val notice: String, val serverId: String? = null) {
    fun token(): String = CredentialVault.open(sealed, "$generation|$server|$deviceId")
}
class ConnectionStore(context: Context) {
    private val db = GatewayDatabase.get(context).writableDatabase
    fun current(): Connection? = db.rawQuery("SELECT generation,server,device_id,credential,enabled,notice,server_id FROM connection WHERE singleton=1", null).use { c ->
        if (!c.moveToFirst()) null else Connection(c.getString(0),c.getString(1),c.getString(2),c.getString(3),c.getInt(4)==1,c.getString(5), if(c.isNull(6)) null else c.getString(6))
    }
    fun save(server: String, deviceId: String, token: String, serverId: String) {
        val old = current()
        val generation = if (canRetainQueue(old?.serverId, old?.deviceId, serverId, deviceId)) old!!.generation else UUID.randomUUID().toString()
        val encrypted = CredentialVault.seal(token, "$generation|$server|$deviceId")
        db.insertWithOnConflict("connection", null, ContentValues().apply {
            put("singleton", 1); put("generation", generation); put("server", server)
            put("server_id", serverId); put("device_id", deviceId); put("credential", encrypted); put("enabled", 1); put("notice", "配对成功，等待新短信")
        }, android.database.sqlite.SQLiteDatabase.CONFLICT_REPLACE).also { check(it != -1L) }
    }
    fun relocate(expected: Connection, server: String, serverId: String) {
        val encrypted = CredentialVault.seal(expected.token(), "${expected.generation}|$server|${expected.deviceId}")
        check(db.update("connection", ContentValues().apply {
            put("server", server); put("server_id", serverId); put("credential", encrypted); put("enabled", 1)
            put("notice", "服务器地址已更新，原队列继续同步")
        }, "generation=? AND server=?", arrayOf(expected.generation, expected.server)) == 1)
    }
    fun rememberIdentity(generation: String, serverId: String) {
        db.execSQL("UPDATE connection SET server_id=? WHERE generation=? AND server_id IS NULL", arrayOf(serverId,generation))
    }
    fun pause(generation: String, notice: String) {
        db.update("connection", ContentValues().apply { put("enabled", 0); put("notice", notice) }, "generation=?", arrayOf(generation))
    }
    fun notice(generation: String, notice: String) {
        db.update("connection", ContentValues().apply { put("notice", notice) }, "generation=?", arrayOf(generation))
    }
    fun disconnect() { db.delete("connection", null, null) }
}
