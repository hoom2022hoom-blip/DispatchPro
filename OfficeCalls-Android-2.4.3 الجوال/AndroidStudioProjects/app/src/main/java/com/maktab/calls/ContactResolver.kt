package com.maktab.calls
import android.content.Context
/** Public ContactsContract only; ambiguity is a result, never a selected first row. */
internal object ContactResolver {
    fun names(context: Context,names: List<String>,hints: Set<String> = emptySet())=ContactIndex.lookupNames(context,names,hints)
    fun uri(context: Context,value: String)=ContactIndex.lookupUri(context,value)
}
