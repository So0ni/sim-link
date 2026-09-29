package dev.simlink.gateway.connection

import android.content.Context
import dev.simlink.gateway.platform.GatewayDatabase

/** Installation identity survives upgrades/unpair, but is excluded from backups with the database. */
class InstallationStore(context: Context) {
    val id: String = GatewayDatabase.get(context).readableDatabase.rawQuery("SELECT id FROM installation WHERE singleton=1", null).use {
        check(it.moveToFirst()); it.getString(0)
    }
}
