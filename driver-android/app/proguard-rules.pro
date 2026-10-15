# The bridge is discovered by its stable class name and public Context constructor.
# Keep its methods as well: callbacks originate in native Firebase/Android code.
-keep class com.dispatchpro.driver.DriverPushBridge { public *; }
-keep class com.dispatchpro.driver.CustomerPushBridge { public *; }
-keepattributes RuntimeVisibleAnnotations,RuntimeInvisibleAnnotations,AnnotationDefault,InnerClasses,EnclosingMethod
