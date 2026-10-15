plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
}

android {
    namespace = "com.maktab.calls"
    compileSdk {
        version = release(36) {
            minorApiLevel = 1
        }
    }

    defaultConfig {
        applicationId = "com.maktab.calls"
        minSdk = 24
        targetSdk = 36
        versionCode = 325
        versionName = "3.2.5"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    buildTypes {
        release {
            optimization {
                enable = false
            }
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_11
        targetCompatibility = JavaVersion.VERSION_11
    }
    buildFeatures {
        compose = true
        buildConfig = true
    }
    testOptions { unitTests { isIncludeAndroidResources = true } }
}

// The Windows Robolectric native loader does not decode spaces in SDK jar URLs.
// Validation can supply the existing Maven cache's short path without changing dependencies.
tasks.withType<Test>().configureEach {
    providers.environmentVariable("OFFICE_CALLS_TEST_MAVEN_REPO").orNull?.let {
        systemProperty("maven.repo.local", it)
    }
}

dependencies {
    implementation("com.googlecode.libphonenumber:libphonenumber:9.0.40")
    implementation("com.google.zxing:core:3.5.3")
    implementation("androidx.camera:camera-camera2:1.6.2")
    implementation("androidx.camera:camera-lifecycle:1.6.2")
    implementation("androidx.camera:camera-view:1.6.2")
    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.compose.material3)
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.ui.graphics)
    implementation(libs.androidx.compose.ui.tooling.preview)
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    testImplementation(libs.junit)
    testImplementation(libs.androidx.compose.ui.test.junit4)
    testImplementation("org.robolectric:robolectric:4.17")
    androidTestImplementation(platform(libs.androidx.compose.bom))
    androidTestImplementation(libs.androidx.compose.ui.test.junit4)
    androidTestImplementation(libs.androidx.espresso.core)
    androidTestImplementation(libs.androidx.junit)
    debugImplementation(libs.androidx.compose.ui.test.manifest)
    debugImplementation(libs.androidx.compose.ui.tooling)
}
