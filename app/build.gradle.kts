import java.util.Properties

plugins {
    id("com.android.application")
}

// Release signing: put storeFile, storePassword, keyAlias and keyPassword in
// keystore.properties (never committed). Without it the release is unsigned.
val keystore = Properties().apply {
    val file = rootProject.file("keystore.properties")
    if (file.exists()) file.inputStream().use { load(it) }
}

android {
    namespace = "com.pathkin.trail"
    compileSdk = 37

    defaultConfig {
        applicationId = "com.pathkin.trail"
        minSdk = 26
        targetSdk = 37
        versionCode = 5
        versionName = "1.0.0-rc1"
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    signingConfigs {
        if (keystore.containsKey("storeFile")) {
            create("release") {
                storeFile = rootProject.file(keystore.getProperty("storeFile"))
                storePassword = keystore.getProperty("storePassword")
                keyAlias = keystore.getProperty("keyAlias")
                keyPassword = keystore.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.findByName("release")
        }
    }
}

// A release build fails if a content pack breaks its schema, a text key is
// missing in any language, or a shipped asset has no ledger row.
val contentGate = tasks.register<Exec>("contentGate") {
    workingDir = rootProject.projectDir
    commandLine("node", "tools/check-content.mjs")
}
tasks.matching { it.name == "preReleaseBuild" }.configureEach { dependsOn(contentGate) }

// The game itself is the web bundle in src/main/assets/www. Its rules core and
// content packs are gated by Node tests (npm test, npm run check-content).
