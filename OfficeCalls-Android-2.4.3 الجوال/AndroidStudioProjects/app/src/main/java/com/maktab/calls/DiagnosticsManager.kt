package com.maktab.calls
import android.content.Context
internal class DiagnosticsManager(context: Context) {
    private val store=CallStore.get(context)
    fun record(event: String,detail: String="",pkg: String="",phone: String="")=store.log(pkg,PhoneNormalizer.normalize(phone),event,detail)
    fun report()=store.logs().asReversed().joinToString("\n\n")
}
