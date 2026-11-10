plugins {
    id("com.android.application")
}

android {
    namespace = "com.pathkin.trail"
    compileSdk = 37

    defaultConfig {
        applicationId = "com.pathkin.trail"
        minSdk = 26
        targetSdk = 37
        versionCode = 2
        versionName = "0.2.0-alpha"
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }
}

// The game itself is the web bundle in src/main/assets/www. Its rules core and
// content packs are gated by Node tests (npm test, npm run check-content).
