package uz.sodiq.solver

import ai.timefold.solver.core.api.score.HardMediumSoftScore
import ai.timefold.solver.core.api.score.stream.Constraint
import ai.timefold.solver.core.api.score.stream.ConstraintCollectors
import ai.timefold.solver.core.api.score.stream.ConstraintFactory
import ai.timefold.solver.core.api.score.stream.ConstraintProvider
import ai.timefold.solver.core.api.score.stream.Joiners

/**
 * The constraints of the solver (task 5.10). Hard: the blocked rules of the
 * rule engine that two lessons of one draft can break, named by the engine's
 * codes (`rules.json`); every rule one block breaks alone is already out of
 * each lesson's options (packages/timetable-rules/src/solver.ts). Every
 * clash compares the weekday and clock minutes, never slot numbers
 * (edge/timetable, Structure, first row). Medium: a lesson not placed (06,
 * Auto-generation: "It places what it can"). Soft: the preferences of `06`,
 * each one "lesson" per unit (decision 7), weighted by the draft's weights.
 */
class TimetableConstraints : ConstraintProvider {
    override fun defineConstraints(factory: ConstraintFactory): Array<Constraint> =
        arrayOf(
            teacherDouble(factory),
            roomDouble(factory),
            roomSharedFull(factory),
            roomSharedCapacity(factory),
            classDouble(factory),
            studentDouble(factory),
            notPlaced(factory),
            splitShort(factory),
            classNoGaps(factory),
            teacherFewGaps(factory),
            subjectSpread(factory),
            demandingEarly(factory),
            classEvenDays(factory),
            mainRoom(factory),
            partTimeFewDays(factory),
        )

    /** Two lessons of the draft at overlapping times on one weekday. */
    private fun overlappingPairs(factory: ConstraintFactory) =
        factory.forEachUniquePair(
            Lesson::class.java,
            Joiners.equal<Lesson, Int> { it.at().weekday },
            Joiners.overlapping<Lesson, Int>({ it.at().start }, { it.at().end }),
        )

    fun teacherDouble(factory: ConstraintFactory): Constraint =
        overlappingPairs(factory)
            .filter { a, b -> a.teacherIds.any { it in b.teacherIds } }
            .penalize(HardMediumSoftScore.ONE_HARD) { a, b -> a.teacherIds.count { it in b.teacherIds }.toLong() }
            .asConstraint(TEACHER_DOUBLE)

    fun roomDouble(factory: ConstraintFactory): Constraint =
        overlappingPairs(factory)
            .filter { a, b -> a.ownRooms().any { it in b.ownRooms() } }
            .penalize(HardMediumSoftScore.ONE_HARD) { a, b -> a.ownRooms().count { it in b.ownRooms() }.toLong() }
            .asConstraint(ROOM_DOUBLE)

    /** Every use of a shared room with the uses running at its start (the most at once is reached at some start). */
    private fun sharedTogether(factory: ConstraintFactory) =
        factory
            .forEach(Lesson::class.java)
            .flattenLast { it.sharedUses() }
            .join(
                factory.forEach(Lesson::class.java).flattenLast { it.sharedUses() },
                Joiners.equal<SharedUse, String> { it.room.id },
                Joiners.equal<SharedUse, Int> { it.weekday },
                Joiners.filtering<SharedUse, SharedUse> { at, other -> other.start <= at.start && at.start < other.end },
            ).groupBy(
                { at, _ -> at },
                ConstraintCollectors.countBi(),
                ConstraintCollectors.sum<SharedUse, SharedUse> { _, other -> other.students.toLong() },
            )

    fun roomSharedFull(factory: ConstraintFactory): Constraint =
        sharedTogether(factory)
            .filter { at, count, _ -> count > at.room.lessonsAtOnce }
            .penalize(HardMediumSoftScore.ONE_HARD) { at, count, _ -> count - at.room.lessonsAtOnce }
            .asConstraint(ROOM_SHARED_FULL)

    fun roomSharedCapacity(factory: ConstraintFactory): Constraint =
        sharedTogether(factory)
            .filter { at, _, students -> students > at.room.capacity }
            .penalize(HardMediumSoftScore.ONE_HARD)
            .asConstraint(ROOM_SHARED_CAPACITY)

    /** Two blocks of one class at once; the lessons of one block at once are no clash (`checkClashes`). */
    fun classDouble(factory: ConstraintFactory): Constraint =
        overlappingPairs(factory)
            .filter { a, b -> a.classIds.any { it in b.classIds } }
            .penalize(HardMediumSoftScore.ONE_HARD)
            .asConstraint(CLASS_DOUBLE)

    fun studentDouble(factory: ConstraintFactory): Constraint =
        overlappingPairs(factory)
            .filter { a, b ->
                val (small, large) = if (a.studentIds.size <= b.studentIds.size) a to b else b to a
                small.studentIds.any { it in large.studentIds }
            }.penalize(HardMediumSoftScore.ONE_HARD)
            .asConstraint(STUDENT_DOUBLE)

    fun notPlaced(factory: ConstraintFactory): Constraint =
        factory
            .forEachIncludingUnassigned(Lesson::class.java)
            .filter { it.option == null && it.splitClassId == null }
            .penalize(HardMediumSoftScore.ONE_MEDIUM)
            .asConstraint("not_placed")

    /**
     * A mixed split's rows short of, or over, their lessons per week: each
     * lesson of the split places one combination of two rows, so a row's
     * lessons are counted over the split's lessons (06, Rules, last row: the
     * load is met; a lesson not placed is medium, as above).
     */
    fun splitShort(factory: ConstraintFactory): Constraint =
        factory
            .forEachIncludingUnassigned(Lesson::class.java)
            .filter { it.splitClassId != null }
            .groupBy({ it.splitClassId }, ConstraintCollectors.toList())
            .filter { _, lessons -> splitMisses(lessons) > 0 }
            .penalize(HardMediumSoftScore.ONE_MEDIUM) { _, lessons -> splitMisses(lessons).toLong() }
            .asConstraint("split_short")

    /** 1. Empty lesson slots of a class's template between its first and last lesson of a day. */
    fun classNoGaps(factory: ConstraintFactory): Constraint =
        factory
            .forEach(Lesson::class.java)
            .flattenLast { lesson ->
                val at = lesson.at()
                lesson.classIds.flatMap { classId ->
                    lesson.facts.numbersOf(classId, at.weekday, at.start, at.end).map { ClassSlot(classId, at.weekday, it) }
                }
            }.groupBy({ it.classId }, { it.weekday }, ConstraintCollectors.toSet { it.number })
            .filter { _, _, numbers -> gapsOf(numbers) > 0 }
            .penalize(HardMediumSoftScore.ONE_SOFT) { _, _, numbers -> gapsOf(numbers).toLong() }
            .asConstraint(CLASS_NO_GAPS)

    /** 2. Per teacher and day, each whole 40 minutes of an idle stretch between two lessons. */
    fun teacherFewGaps(factory: ConstraintFactory): Constraint =
        factory
            .forEach(Lesson::class.java)
            .flattenLast { lesson ->
                val at = lesson.at()
                lesson.teacherIds.map { TeacherSpan(it, at.weekday, at.start, at.end) }
            }.groupBy({ it.teacherId }, { it.weekday }, ConstraintCollectors.toList())
            .filter { _, _, spans -> idleOf(spans) > 0 }
            .penalize(HardMediumSoftScore.ONE_SOFT) { _, _, spans -> idleOf(spans).toLong() }
            .asConstraint(TEACHER_FEW_GAPS)

    /**
     * 3. Per block and day, every lesson beyond the first; two lessons of rows
     * that all allow doubles, in consecutive lesson slots in the same rooms,
     * count once (a possible pair, decision 4).
     */
    fun subjectSpread(factory: ConstraintFactory): Constraint =
        factory
            .forEach(Lesson::class.java)
            .groupBy({ it.spreadKey }, { it.at().weekday }, ConstraintCollectors.toList())
            .filter { _, _, lessons -> beyondFirst(lessons) > 0 }
            .penalize(HardMediumSoftScore.ONE_SOFT) { _, _, lessons -> beyondFirst(lessons).toLong() }
            .asConstraint(SUBJECT_SPREAD)

    /** 4. A lesson of a demanding subject: its lesson number less one. */
    fun demandingEarly(factory: ConstraintFactory): Constraint =
        factory
            .forEach(Lesson::class.java)
            .filter { lesson -> lesson.placedRows.any { it.demanding } && lesson.at().number > 1 }
            .penalize(HardMediumSoftScore.ONE_SOFT) { (it.at().number - 1).toLong() }
            .asConstraint(DEMANDING_EARLY)

    /** 5. Per class, the most lessons on a day less the fewest on a day it has lessons. */
    fun classEvenDays(factory: ConstraintFactory): Constraint =
        factory
            .forEach(Lesson::class.java)
            .flattenLast { lesson ->
                val at = lesson.at()
                lesson.classIds.filter { lesson.facts.hasClass(it) }.map { ClassStart(it, at.weekday, at.start) }
            }.groupBy({ it.classId }, { it.weekday }, ConstraintCollectors.toSet { it.start })
            .groupBy({ classId, _, _ -> classId }, ConstraintCollectors.toList { _, _, starts -> starts.size })
            .filter { _, counts -> counts.max() - counts.min() > 0 }
            .penalize(HardMediumSoftScore.ONE_SOFT) { _, counts -> (counts.max() - counts.min()).toLong() }
            .asConstraint(CLASS_EVEN_DAYS)

    /** 6. A class row's lesson outside its main classroom when the row names no room or room type. */
    fun mainRoom(factory: ConstraintFactory): Constraint =
        factory
            .forEach(Lesson::class.java)
            .filter { outsideMainRoom(it) > 0 }
            .penalize(HardMediumSoftScore.ONE_SOFT) { outsideMainRoom(it).toLong() }
            .asConstraint(MAIN_ROOM)

    /** 7. Per part-time teacher, the days with lessons. */
    fun partTimeFewDays(factory: ConstraintFactory): Constraint =
        factory
            .forEach(Lesson::class.java)
            .flattenLast { lesson -> lesson.placedRows.filter { it.partTime }.map { TeacherDay(it.teacherId, lesson.at().weekday) } }
            .groupBy({ it.teacherId }, ConstraintCollectors.toSet { it.weekday })
            .penalize(HardMediumSoftScore.ONE_SOFT) { _, days -> days.size.toLong() }
            .asConstraint(PART_TIME_FEW_DAYS)

    companion object {
        const val TEACHER_DOUBLE = "teacher_double"
        const val ROOM_DOUBLE = "room_double"
        const val ROOM_SHARED_FULL = "room_shared_full"
        const val ROOM_SHARED_CAPACITY = "room_shared_capacity"
        const val CLASS_DOUBLE = "class_double"
        const val STUDENT_DOUBLE = "student_double"
        const val CLASS_NO_GAPS = "class_no_gaps"
        const val TEACHER_FEW_GAPS = "teacher_few_gaps"
        const val SUBJECT_SPREAD = "subject_spread"
        const val DEMANDING_EARLY = "demanding_early"
        const val CLASS_EVEN_DAYS = "class_even_days"
        const val MAIN_ROOM = "main_room"
        const val PART_TIME_FEW_DAYS = "part_time_few_days"

        /** `teacher_preferred_times` has no input yet: no record holds preferred days and slots (decision 6). */
        const val TEACHER_PREFERRED_TIMES = "teacher_preferred_times"

        /** The constraints named by the rule engine's blocked rules (`rules.json`). */
        val PAIR_RULES =
            listOf(
                TEACHER_DOUBLE,
                ROOM_DOUBLE,
                ROOM_SHARED_FULL,
                ROOM_SHARED_CAPACITY,
                CLASS_DOUBLE,
                STUDENT_DOUBLE,
            )

        /** The shortest lesson of a template: one empty slot of a teacher's day (decision 7). */
        const val IDLE_SLOT_MINUTES = 40

        fun gapsOf(numbers: Set<Int>): Int = if (numbers.isEmpty()) 0 else numbers.max() - numbers.min() + 1 - numbers.size

        fun idleOf(spans: List<TeacherSpan>): Int {
            var idle = 0
            var end: Int? = null
            for (span in spans.sortedBy { it.start }) {
                val before = end
                if (before != null && span.start > before) idle += (span.start - before) / IDLE_SLOT_MINUTES
                end = if (before == null) span.end else maxOf(before, span.end)
            }
            return idle
        }

        fun beyondFirst(lessons: List<Lesson>): Int {
            val placed = lessons.sortedBy { it.at().number }
            var units = 0
            var index = 0
            while (index < placed.size) {
                val first = placed[index]
                val second = placed.getOrNull(index + 1)
                val pair =
                    second != null &&
                        first.placedRows.all { it.doubleLessons } &&
                        second.at().number == first.at().number + 1 &&
                        second.at().rooms == first.at().rooms
                units += 1
                index += if (pair) 2 else 1
            }
            return units - 1
        }

        /** Each row of a split: how far its lessons placed are from its lessons per week. */
        fun splitMisses(lessons: List<Lesson>): Int {
            val rows = lessons.flatMap { it.rows }.distinctBy { it.id }
            val placed = lessons.mapNotNull { it.option }.flatMap { it.rows }.groupingBy { it.id }.eachCount()
            return rows.sumOf { kotlin.math.abs(it.lessonsPerWeek - (placed[it.id] ?: 0)) }
        }

        fun outsideMainRoom(lesson: Lesson): Int =
            lesson.placedRows.withIndex().count { (index, row) ->
                row.mainRoomId != null && lesson.at().rooms.getOrNull(index) != row.mainRoomId
            }
    }
}

data class ClassSlot(val classId: String, val weekday: Int, val number: Int)

data class ClassStart(val classId: String, val weekday: Int, val start: Int)

data class TeacherSpan(val teacherId: String, val weekday: Int, val start: Int, val end: Int)

data class TeacherDay(val teacherId: String, val weekday: Int)
