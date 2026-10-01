package dev.simlink.gateway.calls

import android.content.*
import android.telephony.TelephonyManager

class PhoneStateReceiver: BroadcastReceiver() {
    override fun onReceive(context: Context,intent: Intent) {
        if(intent.action!=TelephonyManager.ACTION_PHONE_STATE_CHANGED)return
        if(intent.getStringExtra(TelephonyManager.EXTRA_STATE)!=TelephonyManager.EXTRA_STATE_IDLE)return
        val pending=goAsync()
        CallCaptureScheduler.executor.execute { try { runCatching { CallCaptureScheduler.request(context.applicationContext,true) } } finally { pending.finish() } }
    }
}
