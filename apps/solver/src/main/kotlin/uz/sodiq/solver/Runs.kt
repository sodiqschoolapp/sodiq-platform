package uz.sodiq.solver

import ai.timefold.solver.core.api.solver.SolverFactory
import com.sun.net.httpserver.HttpExchange
import com.sun.net.httpserver.HttpServer
import java.net.InetSocketAddress
import java.security.MessageDigest
import java.time.Clock
import java.time.Duration
import java.time.Instant
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors

/** What `GET /runs/{id}` answers. */
data class RunJson(
    val id: String,
    /** `solving` until the time limit or a stop, then `done`; `failed` with `error`. */
    val state: String,
    val seconds: Double,
    /** The best answer so far; `null` before the first one. */
    val answer: AnswerJson?,
    val error: String?,
)

/**
 * The runs of the service, kept in memory (decision 8): a finished run is
 * kept `KEEP` after it ended, then dropped. The clock is injected
 * (CLAUDE.md, "Time is injected"); Timefold's own time limit is the library's.
 */
class Runs(
    private val clock: Clock,
) {
    private class Run(
        val id: String,
        val started: Instant,
    ) {
        @Volatile var best: Timetable? = null

        @Volatile var ended: Instant? = null

        @Volatile var error: String? = null

        @Volatile var stop: (() -> Unit)? = null
    }

    private val runs = ConcurrentHashMap<String, Run>()
    private val pool = Executors.newCachedThreadPool { Thread(it, "solver-run").apply { isDaemon = true } }

    /** Starts a run of the problem; returns its id. */
    fun start(problem: ProblemJson): String {
        forget()
        val timetable = timetableOf(problem)
        val run = Run(UUID.randomUUID().toString(), clock.instant())
        val solver = SolverFactory.create<Timetable>(solverConfig(problem.seconds)).buildSolver()
        solver.addEventListener { event -> run.best = event.newBestSolution }
        run.stop = { solver.terminateEarly() }
        runs[run.id] = run
        pool.execute {
            try {
                run.best = solver.solve(timetable)
            } catch (failure: RuntimeException) {
                run.error = failure.message ?: failure.javaClass.simpleName
            } finally {
                run.ended = clock.instant()
            }
        }
        return run.id
    }

    /** The run's state and best answer; `null` for a run not known or forgotten. */
    fun read(id: String): RunJson? {
        forget()
        val run = runs[id] ?: return null
        val ended = run.ended
        val seconds = Duration.between(run.started, ended ?: clock.instant()).toMillis() / 1000.0
        return RunJson(
            id = run.id,
            state =
                when {
                    run.error != null -> "failed"
                    ended != null -> "done"
                    else -> "solving"
                },
            seconds = seconds,
            answer = run.best?.let { answerOf(it, seconds) },
            error = run.error,
        )
    }

    /** Stops a run early; its best answer stays. `false` for a run not known. */
    fun stop(id: String): Boolean {
        val run = runs[id] ?: return false
        run.stop?.invoke()
        return true
    }

    private fun forget() {
        val now = clock.instant()
        runs.values.removeIf { run -> run.ended?.let { Duration.between(it, now) > KEEP } ?: false }
    }

    companion object {
        val KEEP: Duration = Duration.ofMinutes(30)
    }
}

/**
 * The HTTP service on the JDK's own server: `POST /runs`, `GET /runs/{id}`,
 * `DELETE /runs/{id}`. With a token, every request carries
 * `Authorization: Bearer <token>`, else 401.
 */
fun serve(
    host: String,
    port: Int,
    token: String?,
    runs: Runs,
): HttpServer {
    val server = HttpServer.create(InetSocketAddress(host, port), 0)
    server.executor = Executors.newFixedThreadPool(4)
    server.createContext("/runs") { exchange ->
        exchange.use {
            try {
                handle(it, token, runs)
            } catch (failure: IllegalArgumentException) {
                reply(it, 400, mapOf("error" to (failure.message ?: "bad request")))
            } catch (failure: com.fasterxml.jackson.core.JacksonException) {
                reply(it, 400, mapOf("error" to "The problem is not valid JSON of the solver: ${failure.originalMessage}"))
            }
        }
    }
    server.start()
    return server
}

private fun handle(
    exchange: HttpExchange,
    token: String?,
    runs: Runs,
) {
    if (token != null && !sameToken(exchange.requestHeaders.getFirst("Authorization"), "Bearer $token")) {
        reply(exchange, 401, mapOf("error" to "unauthorized"))
        return
    }
    val id = exchange.requestURI.path.removePrefix("/runs").removePrefix("/")
    when {
        exchange.requestMethod == "POST" && id.isEmpty() -> {
            val problem = json.readValue(exchange.requestBody, ProblemJson::class.java)
            reply(exchange, 201, mapOf("id" to runs.start(problem)))
        }
        exchange.requestMethod == "GET" && id.isNotEmpty() -> {
            val run = runs.read(id)
            if (run == null) reply(exchange, 404, mapOf("error" to "no such run")) else reply(exchange, 200, run)
        }
        exchange.requestMethod == "DELETE" && id.isNotEmpty() -> {
            if (runs.stop(id)) reply(exchange, 202, mapOf("id" to id)) else reply(exchange, 404, mapOf("error" to "no such run"))
        }
        else -> reply(exchange, 405, mapOf("error" to "method not allowed"))
    }
}

private fun sameToken(
    given: String?,
    expected: String,
): Boolean = given != null && MessageDigest.isEqual(given.toByteArray(), expected.toByteArray())

private fun reply(
    exchange: HttpExchange,
    status: Int,
    body: Any,
) {
    val bytes = json.writeValueAsBytes(body)
    exchange.responseHeaders.add("Content-Type", "application/json")
    exchange.sendResponseHeaders(status, bytes.size.toLong())
    exchange.responseBody.use { it.write(bytes) }
}
