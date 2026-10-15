package com.maktab.calls

/** No notification text is retained. Incoming evidence must precede number parsing. */
internal object CallNotificationRules {
    val packages = setOf("com.whatsapp", "com.whatsapp.w4b")
    fun incoming(values: List<String>, actions: List<String>, callType: Int = 0): Boolean {
        if (outgoing(values)) return false
        if (callType == 1 || callType == 3) return true // CallStyle screening is also an incoming call.
        if (callType == 2) return false
        val text = values.joinToString(" ").lowercase()
        val explicit = listOf("incoming call", "incoming voice call", "incoming video call", "is calling", "calling you",
            "voice call from", "video call from", "مكالمة واردة", "مكالمة صوتية واردة", "مكالمة فيديو واردة", "يتصل بك", "مكالمة من", "مكالمة صوتية من", "مكالمة فيديو من", "اتصال وارد",
            "appel entrant", "llamada entrante", "eingehender anruf", "chamada recebida", "gelen arama", "שיחה נכנסת", "panggilan masuk", "आने वाला कॉल")
        // 2.4.3 accepted descriptive labels such as "Answer voice call". Match complete
        // action words, not substrings like "unacceptable"; still require BOTH directions.
        val answer = actions.any { Regex("(?iu)(?:^|[^\\p{L}])(answer|accept|إجابة|اجابة|الرد|رد|قبول|répondre|accepter|responder|aceptar|annehmen|atender|aceitar|yanıtla|kabul|מענה|ענה|terima)(?:$|[^\\p{L}])").containsMatchIn(it) }
        val decline = actions.any { Regex("(?iu)(?:^|[^\\p{L}])(decline|reject|رفض|تجاهل|refuser|rechazar|ablehnen|recusar|reddet|דחה|דחייה|tolak)(?:$|[^\\p{L}])").containsMatchIn(it) }
        return explicit.any(text::contains) || (answer && decline)
    }
    fun outgoing(values: List<String>): Boolean = listOf("outgoing call", "calling…", "dialing", "مكالمة صادرة", "جارٍ الاتصال", "جاري الاتصال", "appel sortant", "llamada saliente", "ausgehender anruf", "chamada efetuada", "שיחה יוצאת")
        .any(values.joinToString(" ").lowercase()::contains)
    fun ongoing(values: List<String>, callType: Int = 0): Boolean = callType == 2 ||
        listOf("ongoing call", "مكالمة جارية", "appel en cours", "llamada en curso", "laufender anruf", "chamada em andamento", "שיחה מתמשכת").any(values.joinToString(" ").lowercase()::contains)
    fun finished(values: List<String>, callType: Int = 0): Boolean =
        listOf("missed call", "call ended", "call finished", "مكالمة فائتة", "انتهت المكالمة", "انتهاء المكالمة", "appel manqué", "appel terminé", "llamada perdida", "llamada finalizada", "verpasster anruf", "anruf beendet", "chamada perdida", "שיחה שלא נענתה")
            .any(values.joinToString(" ").lowercase()::contains)

    fun number(values: List<String>): String = values.flatMap(CallPhoneNumber::candidates).distinct().singleOrNull().orEmpty()
}
