package dev.simlink.gateway.connection

fun canRetainQueue(oldServerId: String?, oldDeviceId: String?, serverId: String, deviceId: String) =
    oldServerId != null && oldServerId == serverId && oldDeviceId == deviceId
