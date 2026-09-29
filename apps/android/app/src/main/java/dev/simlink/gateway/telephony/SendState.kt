package dev.simlink.gateway.telephony

enum class SendState(val label: String) {
    PROCESSING("正在发送"), SENT("已发送 · 暂无送达报告"),
    FAILED("发送失败"), PARTIAL("部分分段已发送，请核对"), UNKNOWN("结果未确认，可能已发出")
}

fun summarizeSend(results: List<Int?>, interrupted: Boolean, ageMillis: Long): SendState {
    require(results.isNotEmpty())
    // Android Activity.RESULT_OK is -1. Never treat a timeout as a confirmed failure.
    if (results.all { it == -1 }) return SendState.SENT
    if (results.any { it == -1 } && results.any { it != null && it != -1 }) return SendState.PARTIAL
    if (results.all { it != null && it != -1 }) return SendState.FAILED
    return if (interrupted || ageMillis >= 120_000) SendState.UNKNOWN else SendState.PROCESSING
}

fun normalizedRecipient(value: String): String? = value.replace(Regex("[\\s()\\-]"), "")
    .takeIf { Regex("\\+[1-9][0-9]{6,14}").matches(it) }
