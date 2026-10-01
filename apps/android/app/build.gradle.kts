plugins { id("com.android.application") }
android {
    namespace = "dev.simlink.gateway"
    compileSdk = 37
    defaultConfig {
        applicationId = "dev.simlink.gateway"
        minSdk = 34
        targetSdk = 37
        versionCode = 14
        versionName = "0.5.0-calls"
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    buildFeatures { buildConfig = true }
    lint { abortOnError = true }
}
dependencies {
    implementation("androidx.activity:activity:1.10.1")
    implementation("com.journeyapps:zxing-android-embedded:4.3.0")
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20240303")
}
