package dev.simlink.gateway.connection

import java.net.URI
import java.util.Locale

/** Production accepts an HTTPS origin only; no credentials, path, query, or TLS exceptions. */
fun serverOrigin(value: String, allowHttp: Boolean = false): String {
    val uri = URI(value.trim())
    require((uri.scheme.equals("https", ignoreCase = true) || (allowHttp && uri.scheme.equals("http", ignoreCase = true))) && !uri.host.isNullOrBlank()) { "请输入 HTTPS 服务器地址" }
    require(uri.rawUserInfo == null && uri.rawQuery == null && uri.rawFragment == null)
    require(uri.rawPath.isNullOrEmpty() || uri.rawPath == "/")
    require(uri.port == -1 || uri.port in 1..65535)
    val host = uri.host.lowercase(Locale.ROOT)
    val scheme = uri.scheme.lowercase(Locale.ROOT)
    return "$scheme://$host" + if (uri.port == -1 || (uri.port == 443 && scheme == "https") || (uri.port == 80 && scheme == "http")) "" else ":${uri.port}"
}
