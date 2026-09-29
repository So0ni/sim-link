plugins { id("com.android.application") }
android {
    namespace = "dev.simlink.gateway"
    compileSdk = 37
    defaultConfig {
        applicationId = "dev.simlink.gateway"
        minSdk = 34
        targetSdk = 37
        versionCode = 1
        versionName = "0.1.0-p0"
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    buildFeatures { buildConfig = true }
    lint { abortOnError = true }
}
dependencies { testImplementation("junit:junit:4.13.2") }
