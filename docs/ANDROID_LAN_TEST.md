# اختبار Android على الشبكة المحلية

شغّل لوحة المكتب كالمعتاد بـ `npm.cmd run dev`، وأبقها مفتوحة على `http://127.0.0.1:9005`.
شغّل مستقبِل الشبكة بـ `node scripts/call-lan-server.mjs`. يكتشف IPv4 الخاص تلقائيًا إذا وجد عنوانًا واحدًا؛ عند تعدد البطاقات عيّن `DISPATCHPRO_LAN_IP` للبطاقة المطلوبة.

العنوان عند التجهيز: `http://192.168.0.104:9006/api/calls`.
هذه بوابة POST فقط للمكالمات، تمرر الحدث إلى نفس Call Integration Layer. التاريخ ولوحة التطوير يبقيان على loopback. لا يتغير الاختبار التجريبي ولا تطبيق Android.

إعداد التطبيق الحالي المطلوب:
- Method: `POST`
- `Content-Type: application/json`
- `Authorization: Bearer <token>`؛ اقرأ الرمز محليًا بواسطة `Get-Content .dispatchpro-local/call-token` ولا تضعه في الرابط.
- مثال الحقول: `{ "eventId": "unique-call-id", "source": "WHATSAPP", "phone": "0599123456", "timestamp": "2026-09-25T12:00:00Z" }`.
- يعاد نفس الحدث كاملًا عند retry؛ المكالمة التالية تستخدم eventId جديدًا.

اختبار الكمبيوتر: `node scripts/test-lan-calls.mjs`.
اختبار الوصول من متصفح الهاتف: `http://192.168.0.104:9006/health` يعيد `listening` (لا يعرض بيانات مكالمات).
اختبار الهاتف الحقيقي يحتاج أن يدعم التطبيق الموجود هذا العقد والرمز، وأن يستخرج رقم المتصل بالفعل؛ لم يُفحص كود التطبيق أو يُعدّل.

إذا منع Firewall الاتصال، شغّل الأمر التالي كمسؤول فقط؛ لم يُطبّق آليًا:

```powershell
New-NetFirewallRule -DisplayName "DispatchPro Android Calls" -Direction Inbound -Action Allow -Protocol TCP -LocalPort 9006 -LocalAddress 192.168.0.104 -RemoteAddress LocalSubnet -Profile Any
```

عنوان DHCP قد يتغير؛ عندها أعد اكتشافه وتحديث عنوان التطبيق وقاعدة الجدار. لا حاجة لأي خدمة سحابية. سجّل المكالمة من هاتف آخر إلى WhatsApp Business على Android المتصل؛ لا يُعد اختبارًا حقيقيًا ناجحًا حتى يصل event من التطبيق وتظهر النتيجة باللوحة.
