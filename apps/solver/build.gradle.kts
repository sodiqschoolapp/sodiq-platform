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
    testImplementation("ai.timefold.solver:timefold-solver-test:2.7.1")
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
}

tasks.test {
    useJUnitPlatform()
}
