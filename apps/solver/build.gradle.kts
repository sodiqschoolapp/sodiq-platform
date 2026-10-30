// The timetable solver (docs/spec/13-technology.md: Timefold Solver Community
// Edition in Kotlin, a separate service; task 5.10). Every version is exact.
plugins {
    kotlin("jvm") version "2.4.21"
    application
}

repositories {
    mavenCentral()
}

dependencies {
    implementation("ai.timefold.solver:timefold-solver-core:2.7.1")
    implementation("com.fasterxml.jackson.module:jackson-module-kotlin:2.22.4")
    testImplementation("org.junit.jupiter:junit-jupiter:6.1.3")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher:6.1.3")
}

kotlin {
    jvmToolchain(21)
    compilerOptions {
        allWarningsAsErrors.set(true)
    }
}

application {
    mainClass.set("uz.sodiq.solver.MainKt")
    applicationName = "solver"
}

// Built into dist/, as every package of the workspace (turbo's build outputs).
tasks.named<Sync>("installDist") {
    destinationDir = layout.projectDirectory.dir("dist").asFile
    finalizedBy(writeJavaHome)
}

// dist/java-home names the Java 21 the solver was built with: the start script
// runs the Java of JAVA_HOME, and a runner's default Java may be older (GitHub's
// is 17, and turbo passes no JAVA_HOME_21_X64 to the task).
val writeJavaHome by tasks.registering {
    val home =
        javaToolchains
            .launcherFor { languageVersion.set(JavaLanguageVersion.of(21)) }
            .map { it.metadata.installationPath.asFile.absolutePath }
    val file = layout.projectDirectory.file("dist/java-home")
    inputs.property("home", home)
    outputs.file(file)
    doLast { file.asFile.writeText(home.get()) }
}

tasks.test {
    useJUnitPlatform()
}
