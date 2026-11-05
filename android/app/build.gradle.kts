plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "app.fitness.collector"
    compileSdk = 36
    defaultConfig {
        applicationId = "app.fitness.collector"
        minSdk = 28
        targetSdk = 35
        versionCode = 1
        versionName = "0.1.0"
    }
    signingConfigs {
        // Chiave di firma FISSA (non segreta, usata solo per l'installazione personale): permette di aggiornare l'app senza disinstallarla.
        create("fixed") {
            storeFile = file("debug-fixed.keystore")
            storePassword = "android"; keyAlias = "androiddebugkey"; keyPassword = "android"
        }
    }
    buildTypes {
        release { signingConfig = signingConfigs.getByName("fixed"); isMinifyEnabled = false }
        debug { signingConfig = signingConfigs.getByName("fixed") }
    }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
    kotlinOptions { jvmTarget = "17" }
}

dependencies {
    implementation("androidx.health.connect:connect-client:1.1.0")
    implementation("androidx.work:work-runtime-ktx:2.9.1")
    implementation("androidx.activity:activity-ktx:1.9.3")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.7")
}
