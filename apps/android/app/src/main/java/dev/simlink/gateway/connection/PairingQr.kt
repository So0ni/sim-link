package dev.simlink.gateway.connection

import org.json.JSONObject

/** Temporary pairing data, never logged, persisted, or treated as an executable URI. */
class PairingQr(val server: String, val token: String, val expiresAt: Long) {
    companion object {
        fun parse(raw: String, now: Long = System.currentTimeMillis()): PairingQr {
            require(raw.length <= 4096)
            val value = JSONObject(raw)
            require(value.getString("type") == "simlink.pairing")
            require(value.getInt("version") == 1 && value.getInt("apiVersion") == 1)
            val token = value.getString("pairingToken")
            require(Regex("[A-Za-z0-9_-]{43}").matches(token))
            val expiry = value.getLong("expiresAt")
            require(expiry > now) { "Expired pairing code" }
            // Parsing may fill an HTTP address, but does not grant the HTTP opt-in.
            val origin = serverOrigin(value.getString("server"), allowHttp = true)
            return PairingQr(origin, token, expiry)
        }
    }
}
