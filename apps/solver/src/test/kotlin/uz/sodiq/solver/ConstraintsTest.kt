package uz.sodiq.solver

import ai.timefold.solver.core.api.score.stream.test.ConstraintVerifier
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test
import java.io.File

/** Each constraint gives its penalty on its case and none on the near miss (task 5.10, plan tests). */
class ConstraintsTest {
    private val verifier = ConstraintVerifier.build(TimetableConstraints(), Timetable::class.java, Lesson::class.java)

    @Test
    fun `the pair rules are the list of rules json`() {
        val file = File("rules.json").readText()
        val listed = Regex("\"pairRules\"\\s*:\\s*\\[([^]]*)]").find(file)?.groupValues?.get(1).orEmpty()
        assertEquals(TimetableConstraints.PAIR_RULES, Regex("\"([a-z_]+)\"").findAll(listed).map { it.groupValues[1] }.toList())
    }

    @Test
    fun `a teacher in two lessons that overlap by clock time on different templates`() {
        val math = row("math", teacher = "t1")
        val junior = row("junior", teacher = "t1", classes = setOf("2a"))
        // Senior slot 2 (08:50–09:35) against junior slot 3 (09:30–10:10).
        verifier
            .verifyThat(TimetableConstraints::teacherDouble)
            .given(lesson("a", listOf(math), at(1, 530, 575, listOf(math))), lesson("b", listOf(junior), at(1, 570, 610, listOf(junior))))
            .penalizesBy(1)
        // Touching end to start, and another weekday, are no clash.
        verifier
            .verifyThat(TimetableConstraints::teacherDouble)
            .given(
                lesson("a", listOf(math), at(1, 530, 575, listOf(math))),
                lesson("b", listOf(junior), at(1, 575, 615, listOf(junior))),
                lesson("c", listOf(junior), at(2, 530, 575, listOf(junior))),
            ).penalizesBy(0)
    }

    @Test
    fun `a vacancy is one place at a time like a teacher`() {
        val first = row("history-5a", teacher = "v-history")
        val second = row("history-5b", teacher = "v-history", classes = setOf("7b"))
        verifier
            .verifyThat(TimetableConstraints::teacherDouble)
            .given(lesson("a", listOf(first), at(3, 480, 525, listOf(first))), lesson("b", listOf(second), at(3, 500, 545, listOf(second))))
            .penalizesBy(1)
        verifier
            .verifyThat(TimetableConstraints::teacherDouble)
            .given(lesson("a", listOf(first), at(3, 480, 525, listOf(first))), lesson("b", listOf(second), at(3, 530, 575, listOf(second))))
            .penalizesBy(0)
    }

    @Test
    fun `a room that is not shared holds one lesson at a time`() {
        val a = row("a")
        val b = row("b", classes = setOf("7b"))
        verifier
            .verifyThat(TimetableConstraints::roomDouble)
            .given(lesson("a", listOf(a), at(1, 480, 525, listOf(a), listOf("r7a"))), lesson("b", listOf(b), at(1, 480, 525, listOf(b), listOf("r7a"))))
            .penalizesBy(1)
        verifier
            .verifyThat(TimetableConstraints::roomDouble)
            .given(lesson("a", listOf(a), at(1, 480, 525, listOf(a), listOf("hall"))), lesson("b", listOf(b), at(1, 480, 525, listOf(b), listOf("hall"))))
            .penalizesBy(0)
    }

    @Test
    fun `a shared room counts the lessons of each row of a block`() {
        val boys = row("pe-1")
        val girls = row("pe-2")
        val other = row("pe-7b", classes = setOf("7b"))
        val block = lesson("block", listOf(boys, girls), at(2, 480, 525, listOf(boys, girls), listOf("hall", "hall")))
        // Two groups of one block are two uses of a hall for two at once: full, not over.
        verifier.verifyThat(TimetableConstraints::roomSharedFull).given(block).penalizesBy(0)
        // A third lesson from 08:20: at its start three uses run, one over (the
        // engine counts at each start too, `checkSharedRooms`).
        verifier
            .verifyThat(TimetableConstraints::roomSharedFull)
            .given(block, lesson("other", listOf(other), at(2, 500, 545, listOf(other), listOf("hall"))))
            .penalizesBy(1)
    }

    @Test
    fun `a shared room over its capacity with the students of its lessons together`() {
        val a = row("a", students = setOf("s1", "s2", "s3"))
        val b = row("b", classes = setOf("7b"), students = setOf("s4", "s5", "s6"))
        verifier
            .verifyThat(TimetableConstraints::roomSharedCapacity)
            .given(
                lesson("a", listOf(a), at(1, 480, 525, listOf(a), listOf("small-hall"))),
                lesson("b", listOf(b), at(1, 480, 525, listOf(b), listOf("small-hall"))),
            ).penalizesBy(2)
        verifier
            .verifyThat(TimetableConstraints::roomSharedCapacity)
            .given(
                lesson("a", listOf(a), at(1, 480, 525, listOf(a), listOf("small-hall"))),
                lesson("b", listOf(b), at(1, 530, 575, listOf(b), listOf("small-hall"))),
            ).penalizesBy(0)
    }

    @Test
    fun `two blocks of one class at once, but the lessons of one block are no clash`() {
        val math = row("math")
        val english = row("english")
        verifier
            .verifyThat(TimetableConstraints::classDouble)
            .given(lesson("a", listOf(math), at(1, 480, 525, listOf(math))), lesson("b", listOf(english), at(1, 500, 545, listOf(english))))
            .penalizesBy(1)
        val first = row("en-1", students = setOf("s1", "s2"))
        val second = row("en-2", students = setOf("s3", "s4"))
        verifier
            .verifyThat(TimetableConstraints::classDouble)
            .given(lesson("split", listOf(first, second), at(1, 480, 525, listOf(first, second))))
            .penalizesBy(0)
    }

    @Test
    fun `two groups that share a student`() {
        val a = row("group-a", classes = setOf("7a"), students = setOf("s1", "s2"))
        val b = row("group-b", classes = setOf("7b"), students = setOf("s2", "s9"))
        verifier
            .verifyThat(TimetableConstraints::studentDouble)
            .given(lesson("a", listOf(a), at(4, 480, 525, listOf(a))), lesson("b", listOf(b), at(4, 480, 525, listOf(b))))
            .penalizesBy(1)
        val c = row("group-c", classes = setOf("7b"), students = setOf("s8", "s9"))
        verifier
            .verifyThat(TimetableConstraints::studentDouble)
            .given(lesson("a", listOf(a), at(4, 480, 525, listOf(a))), lesson("c", listOf(c), at(4, 480, 525, listOf(c))))
            .penalizesBy(0)
    }

    @Test
    fun `a lesson not placed, and a mixed split short of its rows' lessons`() {
        val math = row("math")
        verifier.verifyThat(TimetableConstraints::notPlaced).given(lesson("a", listOf(math), null)).penalizesBy(1)
        val peBoys = row("pe-boys", lessonsPerWeek = 2)
        val peGirls = row("pe-girls", lessonsPerWeek = 2)
        val techBoys = row("tech-boys", lessonsPerWeek = 2)
        val techGirls = row("tech-girls", lessonsPerWeek = 2)
        val all = listOf(peBoys, peGirls, techBoys, techGirls)
        val pairing = at(1, 480, 525, listOf(peBoys, techGirls))
        val split = { id: String, option: Option? -> lesson(id, all, option, splitClassId = "8a") }
        // A split's unplaced lesson is counted by its rows, not as a lesson.
        verifier.verifyThat(TimetableConstraints::notPlaced).given(split("s1", null)).penalizesBy(0)
        // The same pairing twice: pe-boys and tech-girls have theirs, the other two none.
        verifier
            .verifyThat(TimetableConstraints::splitShort)
            .given(split("s1", pairing), split("s2", pairing.copy(weekday = 2)), split("s3", null), split("s4", null))
            .penalizesBy(4)
        val reverse = at(3, 480, 525, listOf(techBoys, peGirls))
        verifier
            .verifyThat(TimetableConstraints::splitShort)
            .given(split("s1", pairing), split("s2", pairing.copy(weekday = 2)), split("s3", reverse), split("s4", reverse.copy(weekday = 4)))
            .penalizesBy(0)
    }

    @Test
    fun `class_no_gaps counts the empty slots between a class's first and last lesson`() {
        val a = row("a")
        val b = row("b")
        verifier
            .verifyThat(TimetableConstraints::classNoGaps)
            .given(lesson("a", listOf(a), at(1, 480, 525, listOf(a))), lesson("b", listOf(b), at(1, 590, 635, listOf(b))))
            .penalizesBy(1)
        verifier
            .verifyThat(TimetableConstraints::classNoGaps)
            .given(lesson("a", listOf(a), at(1, 480, 525, listOf(a))), lesson("b", listOf(b), at(1, 530, 575, listOf(b))))
            .penalizesBy(0)
    }

    @Test
    fun `teacher_few_gaps counts each whole 40 idle minutes`() {
        val a = row("a", teacher = "t1")
        val b = row("b", teacher = "t1", classes = setOf("7b"))
        // 08:45 to 10:20 idle: 95 minutes, two whole 40s.
        verifier
            .verifyThat(TimetableConstraints::teacherFewGaps)
            .given(lesson("a", listOf(a), at(1, 480, 525, listOf(a))), lesson("b", listOf(b), at(1, 620, 665, listOf(b))))
            .penalizesBy(2)
        // A break of 5 minutes is no gap.
        verifier
            .verifyThat(TimetableConstraints::teacherFewGaps)
            .given(lesson("a", listOf(a), at(1, 480, 525, listOf(a))), lesson("b", listOf(b), at(1, 530, 575, listOf(b))))
            .penalizesBy(0)
    }

    @Test
    fun `subject_spread counts lessons of a block beyond the first of a day, a possible double once`() {
        val math = row("math")
        val three = (1..3).map { lesson("m$it", listOf(math), at(1, 480 + 50 * it, 525 + 50 * it, listOf(math), number = it)) }
        verifier.verifyThat(TimetableConstraints::subjectSpread).given(*three.toTypedArray()).penalizesBy(2)
        val doubleRow = row("math-11a", doubleLessons = true)
        val pair =
            listOf(
                lesson("d1", listOf(doubleRow), at(2, 480, 525, listOf(doubleRow), listOf("r7a"), number = 1)),
                lesson("d2", listOf(doubleRow), at(2, 530, 575, listOf(doubleRow), listOf("r7a"), number = 2)),
            )
        verifier.verifyThat(TimetableConstraints::subjectSpread).given(*pair.toTypedArray()).penalizesBy(0)
        val apart =
            listOf(
                lesson("d1", listOf(doubleRow), at(2, 480, 525, listOf(doubleRow), listOf("r7a"), number = 1)),
                lesson("d2", listOf(doubleRow), at(2, 590, 635, listOf(doubleRow), listOf("r7a"), number = 3)),
            )
        verifier.verifyThat(TimetableConstraints::subjectSpread).given(*apart.toTypedArray()).penalizesBy(1)
    }

    @Test
    fun `demanding_early counts the lesson number less one`() {
        val math = row("math", demanding = true)
        verifier
            .verifyThat(TimetableConstraints::demandingEarly)
            .given(lesson("a", listOf(math), at(1, 635, 680, listOf(math), number = 4)))
            .penalizesBy(3)
        val art = row("art")
        verifier.verifyThat(TimetableConstraints::demandingEarly).given(lesson("a", listOf(art), at(1, 635, 680, listOf(art), number = 4))).penalizesBy(0)
    }

    @Test
    fun `class_even_days is the most lessons of a day less the fewest`() {
        val a = row("a")
        val monday = (0..2).map { lesson("m$it", listOf(a), at(1, 480 + 50 * it, 525 + 50 * it, listOf(a))) }
        val tuesday = lesson("t", listOf(a), at(2, 480, 525, listOf(a)))
        verifier.verifyThat(TimetableConstraints::classEvenDays).given(*(monday + tuesday).toTypedArray()).penalizesBy(2)
    }

    @Test
    fun `main_room counts a class row's lesson outside its main classroom`() {
        val a = row("a", mainRoom = "r7a")
        verifier.verifyThat(TimetableConstraints::mainRoom).given(lesson("a", listOf(a), at(1, 480, 525, listOf(a), listOf("r7b")))).penalizesBy(1)
        verifier.verifyThat(TimetableConstraints::mainRoom).given(lesson("a", listOf(a), at(1, 480, 525, listOf(a), listOf("r7a")))).penalizesBy(0)
    }

    @Test
    fun `part_time_few_days counts a part-time teacher's days`() {
        val a = row("a", teacher = "t-part", partTime = true)
        val b = row("b", teacher = "t-full")
        verifier
            .verifyThat(TimetableConstraints::partTimeFewDays)
            .given(lesson("a1", listOf(a), at(1, 480, 525, listOf(a))), lesson("a2", listOf(a), at(3, 480, 525, listOf(a))), lesson("b", listOf(b), at(2, 480, 525, listOf(b))))
            .penalizesBy(2)
    }
}
