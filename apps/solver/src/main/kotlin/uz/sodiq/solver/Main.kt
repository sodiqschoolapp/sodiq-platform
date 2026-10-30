package uz.sodiq.solver

import ai.timefold.solver.core.api.solver.SolverFactory
import java.io.File
import java.time.Clock

/**
 * `solver solve <problem.json> <answer.json> [--seconds N]` solves once and
 * writes the answer; `solver serve [--port N]` runs the service (`Runs`).
 */
fun main(args: Array<String>) {
    when (args.firstOrNull()) {
        "solve" -> {
            val (problemPath, answerPath) = args.drop(1).take(2).also { require(it.size == 2) { USAGE } }
            val problem = json.readValue(File(problemPath), ProblemJson::class.java)
            val seconds = option(args, "--seconds")?.toLong() ?: problem.seconds
            val clock = Clock.systemUTC()
            val started = clock.millis()
            val solution = SolverFactory.create<Timetable>(solverConfig(seconds)).buildSolver().solve(timetableOf(problem))
            json.writeValue(File(answerPath), answerOf(solution, (clock.millis() - started) / 1000.0))
        }
        "serve" -> {
            val port = option(args, "--port")?.toInt() ?: System.getenv("PORT")?.toInt() ?: 8090
            val host = System.getenv("SOLVER_HOST") ?: "127.0.0.1"
            val server = serve(host, port, System.getenv("SOLVER_TOKEN"), Runs(Clock.systemUTC()))
            println("The solver listens on $host:${server.address.port}.")
        }
        else -> {
            System.err.println(USAGE)
            kotlin.system.exitProcess(2)
        }
    }
}

private const val USAGE = "Usage: solver solve <problem.json> <answer.json> [--seconds N] | solver serve [--port N]"

private fun option(
    args: Array<String>,
    name: String,
): String? = args.indexOf(name).takeIf { it >= 0 }?.let { args.getOrNull(it + 1) }
