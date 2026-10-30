package uz.sodiq.solver

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Test
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.time.Clock
import java.time.Duration
import java.time.Instant
import java.time.ZoneId
import java.time.ZoneOffset

/** A clock the test moves (CLAUDE.md, "Time is injected"). */
class MovingClock(
    private var now: Instant,
) : Clock() {
    fun move(by: Duration) {
        now = now.plus(by)
    }

    override fun instant(): Instant = now

    override fun getZone(): ZoneId = ZoneOffset.UTC

    override fun withZone(zone: ZoneId): Clock = this
}

class RunsTest {
    private val problem =
        ProblemJson(
            rows = listOf(RowJson("a", "t1", "math", "7a", listOf("7a"), listOf("s1"), 1, false, null)),
            lessons = listOf(LessonJson("a#1", listOf("a"), null, false, listOf(OptionJson(1, 480, 525, 1, null, listOf(null))))),
            rooms = emptyList(),
            classes = listOf(ClassJson("7a", 7)),
            days = listOf(DayJson(7, 1, SENIOR_SLOTS)),
            partTimeTeacherIds = emptyList(),
            demandingSubjectIds = emptyList(),
            weights = WEIGHTS.associateWith { 5 },
            seconds = 1,
        )

    private fun waitDone(
        runs: Runs,
        id: String,
    ): RunJson {
        repeat(100) {
            val run = runs.read(id)
            if (run != null && run.state != "solving") return run
            Thread.sleep(100)
        }
        error("The run did not end.")
    }

    @Test
    fun `a finished run is kept 30 minutes by the injected clock, then forgotten`() {
        val clock = MovingClock(Instant.parse("2026-11-02T06:00:00Z"))
        val runs = Runs(clock)
        val id = runs.start(problem)
        val done = waitDone(runs, id)
        assertEquals("done", done.state)
        assertEquals(true, done.answer?.complete)
        clock.move(Duration.ofMinutes(29))
        assertNotNull(runs.read(id))
        clock.move(Duration.ofMinutes(2))
        assertNull(runs.read(id))
    }

    @Test
    fun `the service refuses a request without the token and answers one with it`() {
        val token = "invented-token"
        val server = serve("127.0.0.1", 0, token, Runs(MovingClock(Instant.parse("2026-11-02T06:00:00Z"))))
        try {
            val client = HttpClient.newHttpClient()
            val base = "http://127.0.0.1:${server.address.port}/runs"
            val body = json.writeValueAsString(problem)
            fun post(auth: String?): HttpResponse<String> {
                val request = HttpRequest.newBuilder(URI(base)).POST(HttpRequest.BodyPublishers.ofString(body))
                if (auth != null) request.header("Authorization", auth)
                return client.send(request.build(), HttpResponse.BodyHandlers.ofString())
            }
            assertEquals(401, post(null).statusCode())
            assertEquals(401, post("Bearer other").statusCode())
            assertEquals(201, post("Bearer $token").statusCode())
            val bad =
                client.send(
                    HttpRequest
                        .newBuilder(URI(base))
                        .header("Authorization", "Bearer $token")
                        .POST(HttpRequest.BodyPublishers.ofString("{\"rows\": 1}"))
                        .build(),
                    HttpResponse.BodyHandlers.ofString(),
                )
            assertEquals(400, bad.statusCode())
        } finally {
            server.stop(0)
        }
    }
}
