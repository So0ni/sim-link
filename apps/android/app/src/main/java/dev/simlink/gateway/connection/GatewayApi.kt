package dev.simlink.gateway.connection

import org.json.JSONObject
import java.net.URL
import java.util.concurrent.atomic.AtomicBoolean
import java.net.HttpURLConnection

class PairingResult(val deviceId: String, val token: String, val serverId: String)
class ApiFailure(val status: Int, val hasRetryAfter: Boolean = false) : Exception("HTTP $status")
class Cancelled : Exception()
class RequestCancellation {
    val stopped = AtomicBoolean(false)
    @Volatile private var connection: HttpURLConnection? = null
    fun attach(value: HttpURLConnection) { connection = value; if (stopped.get()) { value.disconnect(); throw Cancelled() } }
    fun clear() { connection = null }
    fun cancel() { stopped.set(true); connection?.disconnect() }
}
class GatewayApi(private val server: String, private val cancellation: RequestCancellation = RequestCancellation(), private val allowHttp: Boolean = false) {
    init { require(serverOrigin(server, allowHttp) == server) }
    private fun request(path: String, body: JSONObject? = null, token: String? = null): JSONObject {
        if (cancellation.stopped.get()) throw Cancelled()
        val connection = URL(server + path).openConnection() as HttpURLConnection
        try {
            cancellation.attach(connection)
            connection.instanceFollowRedirects = false
            connection.connectTimeout = 10000; connection.readTimeout = 10000
            connection.setRequestProperty("Accept", "application/json")
            token?.let { connection.setRequestProperty("Authorization", "Bearer $it") }
            if (body != null) {
                connection.requestMethod = "POST"; connection.doOutput = true
                connection.setRequestProperty("Content-Type", "application/json; charset=utf-8")
                val bytes = body.toString().toByteArray(Charsets.UTF_8)
                connection.setFixedLengthStreamingMode(bytes.size)
                connection.outputStream.use { it.write(bytes) }
            }
            val status = connection.responseCode
            if (status != 200) throw ApiFailure(status, connection.getHeaderField("Retry-After") != null)
            val bytes = connection.inputStream.use { it.readNBytes(65537) }
            check(bytes.size <= 65536)
            if (cancellation.stopped.get()) throw Cancelled()
            return JSONObject(String(bytes, Charsets.UTF_8))
        } finally { cancellation.clear(); connection.disconnect() }
    }
    fun checkServer() {
        val result = request("/.well-known/sim-gateway")
        check(result.getInt("apiVersion") == 1 && result.getString("name") == "SIMLink")
        val capabilities = result.getJSONArray("capabilities")
        check((0 until capabilities.length()).any { capabilities.getString(it) == "sms.receive" })
    }
    fun pair(pairingToken: String, name: String, installationId: String): PairingResult {
        require(Regex("[A-Za-z0-9_-]{43}").matches(pairingToken))
        require(name.isNotBlank() && name.length <= 80)
        val result = request("/api/v1/device/pair", JSONObject().put("pairingToken", pairingToken).put("name", name).put("apiVersion", 1).put("installationId", installationId))
        check(result.getInt("apiVersion") == 1)
        val deviceId = result.getString("deviceId"); val deviceToken = result.getString("deviceToken")
        check(deviceId.isNotBlank() && Regex("[A-Za-z0-9_-]{43}").matches(deviceToken))
        return PairingResult(deviceId, deviceToken, result.getString("serverId"))
    }
    fun identity(token: String, deviceId: String, installationId: String, expectedServerId: String?): String {
        // Check the advertised server ID before transmitting credentials when a trusted ID is known.
        val discovery = request("/.well-known/sim-gateway")
        check(discovery.getInt("apiVersion") == 1 && discovery.getString("name") == "SIMLink")
        val serverId = discovery.getString("serverId")
        check(expectedServerId == null || expectedServerId == serverId)
        val body = JSONObject().put("deviceId", deviceId).put("installationId", installationId)
        expectedServerId?.let { body.put("serverId", it) }
        val result = request("/api/v1/device/identity", body, token)
        check(result.getString("deviceId") == deviceId && result.getString("serverId") == serverId && result.getString("installationId") == installationId)
        return serverId
    }
    fun sendCapability(enabled: Boolean, token: String) { check(request("/api/v1/device/send-capability",JSONObject().put("enabled",enabled),token).getBoolean("ok")) }
    fun claimCommand(requestId: String, token: String) = request("/api/v1/device/commands/claim",JSONObject().put("requestId",requestId),token)
    fun commandResult(id: String, body: JSONObject, token: String) { check(request("/api/v1/device/commands/$id/result",body,token).getString("id") == id) }
    fun inventory(body: JSONObject, token: String) { check(request("/api/v1/device/sims", body, token).getBoolean("ok")) }
    fun heartbeat(token: String) { check(request("/api/v1/device/heartbeat", JSONObject(), token).getLong("receivedAt") >= 0) }
    fun unpair(token: String) {
        try { check(request("/api/v1/device/unpair", JSONObject(), token).getBoolean("ok")) }
        catch (error: ApiFailure) { if (error.status != 401) throw error } // Already revoked / lost successful response.
    }
    fun upload(body: JSONObject, token: String): JSONObject = request("/api/v1/device/messages", body, token)
}
