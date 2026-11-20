plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// Load signing secrets from root keystore.properties (gitignored).
fun loadKeystoreProps(file: java.io.File): Map<String, String> {
    if (!file.exists()) return emptyMap()
    return file.readLines()
        .map { it.trim() }
        .filter { it.isNotEmpty() && !it.startsWith("#") && it.contains("=") }
        .associate {
            val idx = it.indexOf('=')
            it.substring(0, idx).trim() to it.substring(idx + 1).trim()
        }
}

val keystoreProps = loadKeystoreProps(rootProject.file("keystore.properties"))

android {
    namespace = "com.shifuf.prism"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.shifuf.prism"
        minSdk = 26
        targetSdk = 35
        versionCode = 36
        versionName = "2.2.3"
        buildConfigField("int", "DEBUG_PORT", "19222")
        buildConfigField("String", "JPUSH_APPKEY", "\"3549f3f7e72ca47a3021991c\"")
        // NOTE: Master Secret must stay server-side only — never put it in the APK.
        manifestPlaceholders["JPUSH_PKGNAME"] = applicationId!!
        manifestPlaceholders["JPUSH_APPKEY"] = "3549f3f7e72ca47a3021991c"
        manifestPlaceholders["JPUSH_CHANNEL"] = "developer-default"
    }

    signingConfigs {
        create("release") {
            val storeFileName = keystoreProps["storeFile"]
            if (!storeFileName.isNullOrBlank()) {
                storeFile = rootProject.file(storeFileName)
                storePassword = keystoreProps["storePassword"]
                keyAlias = keystoreProps["keyAlias"]
                keyPassword = keystoreProps["keyPassword"]
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("release")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
    buildFeatures {
        viewBinding = true
        buildConfig = true
    }

    // JPush SDK resources (layouts/styles/drawables) from official package
    sourceSets {
        getByName("main") {
            res.srcDirs(
                "src/main/res",
                "../third_party/jpush/jiguang_sdk/jiguang/src/main/res"
            )
        }
    }
}

dependencies {
    testImplementation("junit:junit:4.13.2")
    // JPush / JCore local artifacts (AAR is only allowed on application modules)
    implementation(files("libs/jcore-android-5.4.0.aar"))
    implementation(files("libs/jpush-android-6.1.0.jar"))
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("com.google.android.material:material:1.12.0")
    implementation("androidx.constraintlayout:constraintlayout:2.2.0")
    implementation("androidx.recyclerview:recyclerview:1.3.2")
    implementation("androidx.viewpager2:viewpager2:1.1.0")
    implementation("androidx.swiperefreshlayout:swiperefreshlayout:1.1.0")
    implementation("androidx.webkit:webkit:1.12.1")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.7")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")
    implementation("org.java-websocket:Java-WebSocket:1.5.7")
    implementation("com.journeyapps:zxing-android-embedded:4.3.0")
    implementation("com.google.zxing:core:3.5.3")
    implementation("org.json:json:20240303")
}

// JDK 17 reads Windows worker argument files using the native code page.
// Stage only project-local classpath entries under Gradle's ASCII user-home path.
tasks.withType<Test>().configureEach {
    doFirst {
        if (System.getProperty("os.name").startsWith("Windows") &&
            project.rootDir.absolutePath.any { it.code > 127 }) {
            val stage = File(gradle.gradleUserHomeDir, "prism-test-classpath/${project.rootDir.absolutePath.hashCode()}/$name")
            val entries = classpath.files.mapIndexed { index, entry ->
                if (entry.absolutePath.any { it.code > 127 }) {
                    val target = File(stage, index.toString())
                    project.sync { from(entry); into(target) }
                    if (entry.isFile) File(target, entry.name) else target
                } else entry
            }
            classpath = files(entries)
        }
    }
}
