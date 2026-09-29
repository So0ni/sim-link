package dev.simlink.gateway.connection

import android.content.ContentValues
import android.content.Context
import dev.simlink.gateway.platform.CredentialVault
import dev.simlink.gateway.platform.GatewayDatabase
import java.util.UUID

// Never expose credentials in toString, UI state, logs, or saved Activity state.
class Connection(val generation: String, val server: String, val deviceId: String,
                 private val sealed: String, val enabled: Boolean, val notice: String) {
    fun token(): String = CredentialVault.open(sealed, "$generation|$server|$deviceId")
}
class ConnectionStore(context: Context) {
    private val db = GatewayDatabase.get(context).writableDatabase
    fun current(): Connection? = db.rawQuery("SELECT generation,server,device_id,credential,enabled,notice FROM connection WHERE singleton=1", null).use { c ->
        if (!c.moveToFirst()) null else Connection(c.getString(0),c.getString(1),c.getString(2),c.getString(3),c.getInt(4)==1,c.getString(5))
    }
    fun save(server: String, deviceId: String, token: String) {
        val generation = UUID.randomUUID().toString()
        val encrypted = CredentialVault.seal(token, "$generation|$server|$deviceId")
        db.insertWithOnConflict("connection", null, ContentValues().apply {
            put("singleton", 1); put("generation", generation); put("server", server)
            put("device_id", deviceId); put("credential", encrypted); put("enabled", 1); put("notice", "配对成功，等待新短信")
        }, android.database.sqlite.SQLiteDatabase.CONFLICT_REPLACE).also { check(it != -1L) }
    }
    fun pause(generation: String, notice: String) {
        db.update("connection", ContentValues().apply { put("enabled", 0); put("notice", notice) }, "generation=?", arrayOf(generation))
    }
    fun notice(generation: String, notice: String) {
        db.update("connection", ContentValues().apply { put("notice", notice) }, "generation=?", arrayOf(generation))
    }
    fun disconnect() { db.delete("connection", null, null) }
}
