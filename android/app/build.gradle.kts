import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("com.google.gms.google-services")
}

val localProperties = Properties().apply {
    val file = rootProject.file("local.properties")
    if (file.exists()) file.inputStream().use(::load)
}
fun localSetting(name: String, fallback: String): String =
    localProperties.getProperty(name) ?: providers.gradleProperty(name).orNull ?: fallback
fun quotedBuildConfig(value: String): String =
    "\"${value.replace("\\", "\\\\").replace("\"", "\\\"")}\""
val releaseStoreFile = rootProject.file(localSetting("RELEASE_STORE_FILE", "my-release-key.jks"))
val releaseStorePassword = localSetting("RELEASE_STORE_PASSWORD", "")
val releaseKeyAlias = localSetting("RELEASE_KEY_ALIAS", "")
val releaseKeyPassword = localSetting("RELEASE_KEY_PASSWORD", "")
val releaseBuildRequested = gradle.startParameter.taskNames.any {
    it.contains("release", ignoreCase = true)
}

if (releaseBuildRequested) {
    require(releaseStoreFile.isFile) {
        "Release keystore not found: ${releaseStoreFile.absolutePath}"
    }
    require(releaseStorePassword.isNotBlank() && releaseKeyAlias.isNotBlank() && releaseKeyPassword.isNotBlank()) {
        "Set RELEASE_STORE_PASSWORD, RELEASE_KEY_ALIAS, and RELEASE_KEY_PASSWORD in android/local.properties."
    }
}

android {
    namespace = "id.basecamp.pendaki"
    compileSdk = 35

    defaultConfig {
        applicationId = "id.basecamp.pendaki"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "1.0.0"
        manifestPlaceholders["usesCleartextTraffic"] = "false"
        buildConfigField("String", "API_BASE_URL", quotedBuildConfig(
            localSetting("API_BASE_URL", "http://10.0.2.2:3000").trimEnd('/'),
        ))
        buildConfigField("String", "MAPTILER_API_KEY", quotedBuildConfig(
            localSetting("MAPTILER_API_KEY", ""),
        ))
    }

    buildTypes {
        getByName("debug") {
            manifestPlaceholders["usesCleartextTraffic"] = "true"
        }
        getByName("release") {
            manifestPlaceholders["usesCleartextTraffic"] = "false"
            signingConfig = signingConfigs.create("release") {
                storeFile = releaseStoreFile
                storePassword = releaseStorePassword
                keyAlias = releaseKeyAlias
                keyPassword = releaseKeyPassword
            }
        }
    }

    buildFeatures {
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.work:work-runtime-ktx:2.10.0")
    implementation("com.google.android.gms:play-services-location:21.3.0")
    implementation(platform("com.google.firebase:firebase-bom:33.8.0"))
    implementation("com.google.firebase:firebase-auth")
    implementation("com.google.android.gms:play-services-tasks:18.2.0")
    implementation("org.maplibre.gl:android-sdk:11.8.0")
}
