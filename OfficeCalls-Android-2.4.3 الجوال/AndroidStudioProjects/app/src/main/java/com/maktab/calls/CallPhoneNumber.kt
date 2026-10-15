package com.maktab.calls
/** Compatibility facade; all callers share the candidate-only canonical normalizer. */
internal object CallPhoneNumber {
    fun extract(value: String) = PhoneNormalizer.extract(value)
    fun candidates(value: String) = PhoneNormalizer.candidates(value)
    fun normalize(value: String) = PhoneNormalizer.identity(value)
}
