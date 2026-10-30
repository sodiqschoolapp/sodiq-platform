package uz.sodiq.solver

import ai.timefold.solver.core.api.score.HardMediumSoftScore
import ai.timefold.solver.core.api.solver.SolutionManager
import ai.timefold.solver.core.api.solver.SolverFactory
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

/** A small problem as JSON, through `timetableOf` and the solver (task 5.10). */
class SolveTest {
    private fun rowJson(
        id: String,
        teacher: String,
        lessonsPerWeek: Int = 1,
    ) = RowJson(id, teacher, "math", "7a", listOf("7a"), listOf("s-$id"), lessonsPerWeek, false, null)

    private fun option(
        weekday: Int,
        start: Int,
        number: Int = 1,
    ) = OptionJson(weekday, start, start + 45, number, null, listOf(null))

    private fun problem(
        rows: List<RowJson>,
        lessons: List<LessonJson>,
        weights: Map<String, Int> = WEIGHTS.associateWith { 5 },
    ) = ProblemJson(
        rows = rows,
        lessons = lessons,
        rooms = emptyList(),
        classes = listOf(ClassJson("7a", 7)),
        days = (1..5).map { DayJson(7, it, SENIOR_SLOTS) },
        partTimeTeacherIds = emptyList(),
        demandingSubjectIds = emptyList(),
        weights = weights,
        seconds = 2,
    )

    private fun solve(problem: ProblemJson): AnswerJson {
        val solution = SolverFactory.create<Timetable>(solverConfig(problem.seconds)).buildSolver().solve(timetableOf(problem))
        return answerOf(solution, 0.0)
    }

    @Test
    fun `the problem and the answer read and write as JSON`() {
        val original = problem(listOf(rowJson("a", "t1")), listOf(LessonJson("a#1", listOf("a"), null, false, listOf(option(1, 480)))))
        val text = json.writeValueAsString(original)
        assertEquals(original, json.readValue(text, ProblemJson::class.java))
        val answer = solve(original)
        assertEquals(answer, json.readValue(json.writeValueAsString(answer), AnswerJson::class.java))
        assertEquals(PlacedJson(1, 480, 525, listOf("a"), listOf(null)), answer.lessons.single().option)
    }

    @Test
    fun `a problem without every weight, or a weight out of range, is refused`() {
        val rows = listOf(rowJson("a", "t1"))
        val lessons = listOf(LessonJson("a#1", listOf("a"), null, false, listOf(option(1, 480))))
        assertThrows(IllegalArgumentException::class.java) {
            timetableOf(problem(rows, lessons, WEIGHTS.drop(1).associateWith { 5 }))
        }
        assertThrows(IllegalArgumentException::class.java) {
            timetableOf(problem(rows, lessons, WEIGHTS.associateWith { 11 }))
        }
    }

    @Test
    fun `a pinned lesson never moves`() {
        val rows = listOf(rowJson("a", "t1", 2))
        val pinned = LessonJson("a#pin1", listOf("a"), null, true, listOf(option(3, 635, 4)))
        val free = LessonJson("a#1", listOf("a"), null, false, listOf(option(3, 635, 4), option(1, 480)))
        val answer = solve(problem(rows, listOf(pinned, free)))
        assertEquals(PlacedJson(3, 635, 680, listOf("a"), listOf(null)), answer.lessons.first { it.id == "a#pin1" }.option)
        assertEquals(PlacedJson(1, 480, 525, listOf("a"), listOf(null)), answer.lessons.first { it.id == "a#1" }.option)
        assertTrue(answer.complete)
    }

    @Test
    fun `a problem that cannot fit leaves a lesson out instead of breaking a hard constraint`() {
        val rows = listOf(rowJson("a", "t1"), rowJson("b", "t1"))
        val lessons =
            listOf(
                LessonJson("a#1", listOf("a"), null, false, listOf(option(1, 480))),
                LessonJson("b#1", listOf("b"), null, false, listOf(option(1, 480))),
            )
        val answer = solve(problem(rows, lessons))
        assertEquals(ScoreJson(0, -1, answer.score.soft), answer.score)
        assertEquals(1, answer.lessons.count { it.option == null })
        assertEquals(false, answer.complete)
    }

    @Test
    fun `a weight multiplies its preference, and 0 switches it off`() {
        val rows = listOf(rowJson("a", "t1", 2))
        val lessons =
            listOf(
                LessonJson("a#1", listOf("a"), null, false, listOf(option(1, 480, 1))),
                LessonJson("a#2", listOf("a"), null, false, listOf(option(1, 590, 3))),
            )
        val manager = SolutionManager.create<Timetable, HardMediumSoftScore>(SolverFactory.create<Timetable>(solverConfig(1)))
        fun softWith(weights: Map<String, Int>): Long {
            val timetable = timetableOf(problem(rows, lessons, weights))
            timetable.lessons.forEach { it.option = it.options.single() }
            return manager.update(timetable)?.softScore() ?: error("no score")
        }
        val off = WEIGHTS.associateWith { 0 }
        assertEquals(0L, softWith(off))
        // One empty slot between the class's lessons, and one lesson beyond the first of the day.
        assertEquals(-3L, softWith(off + (TimetableConstraints.CLASS_NO_GAPS to 3)))
        assertEquals(-7L, softWith(off + (TimetableConstraints.SUBJECT_SPREAD to 7)))
        assertNull(timetableOf(problem(rows, lessons, off)).lessons.first().option)
    }
}
