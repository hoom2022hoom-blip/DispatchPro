# DispatchPro Backend — Phase 1

تم توسيع ASP.NET Core API الحالي بالمصادقة والصلاحيات وعزل المكاتب وPostgreSQL/PostGIS ومحرك التسعير والكيانات الأساسية.

- [الإعداد والتشغيل وعقود API والاختبارات](PHASE1.md)
- [نتائج التحقق والملفات المتغيرة](VERIFICATION.md)
- [خطة المشروع والتدقيق](../docs/TAXI_NABLUS_MASTER_PLAN.md)
- [ربط الاستقبال بالـAPI وتشغيل العامل المستقل](RECEPTION_BRIDGE.md)

الموفر الافتراضي السابق محفوظ؛ أُضيف وضع API صريح للاستقبال مع قراءة وكتابة PostgreSQL وعامل مكالمات مستقل. لم تُرحّل بيانات Firebase/IndexedDB تلقائيًا. تكامل iCall وWhatsApp وشبكة المكتب محفوظة.

يلزم ضبط `Auth__SigningKey` و`ConnectionStrings__Taxi` ثم تنفيذ migrations وseed صراحةً حسب الدليل. لا توجد كلمة مرور افتراضية. OTP جاهز كواجهة مزود فقط، ولا يرسل رسائل فعلية بعد.
