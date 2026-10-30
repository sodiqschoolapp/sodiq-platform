package uz.sodiq.solver

import ai.timefold.solver.core.api.domain.solution.ConstraintWeightOverrides
import ai.timefold.solver.core.api.score.HardMediumSoftScore
import ai.timefold.solver.core.api.solver.SolutionManager
import ai.timefold.solver.core.api.solver.SolverFactory
import ai.timefold.solver.core.config.solver.SolverConfig
import ai.timefold.solver.core.config.solver.termination.TerminationConfig
import com.fasterxml.jackson.databind.DeserializationFeature
import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.module.kotlin.jacksonObjectMapper
import java.time.Duration

/** 06, Auto-generation, Time: "until stopped or until the time limit of 5 minutes". */
const val MOST_SECONDS = 300L

val json: ObjectMapper =
    jacksonObjectMapper().configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, true)

/** The preferences of `06` that have a constraint, by the weight's name (`PREFERENCES`). */
val PREFERENCE_CONSTRAINTS =
    listOf(
        TimetableConstraints.CLASS_NO_GAPS,
        TimetableConstraints.TEACHER_FEW_GAPS,
        TimetableConstraints.SUBJECT_SPREAD,
        TimetableConstraints.DEMANDING_EARLY,
        TimetableConstraints.CLASS_EVEN_DAYS,
        TimetableConstraints.MAIN_ROOM,
        TimetableConstraints.PART_TIME_FEW_DAYS,
    )

/** Every weight the problem must carry: the seven above and `teacher_preferred_times` (decision 6). */
val WEIGHTS = PREFERENCE_CONSTRAINTS + TimetableConstraints.TEACHER_PREFERRED_TIMES

/** The problem as the solver's planning solution, each lesson unplaced unless pinned. */
fun timetableOf(problem: ProblemJson): Timetable {
    val missing = WEIGHTS.filter { it !in problem.weights }
    require(missing.isEmpty()) { "The problem has no weight of $missing." }
    require(problem.weights.values.all { it in 0..10 }) { "A weight is a whole number from 0 to 10." }
    val partTime = problem.partTimeTeacherIds.toSet()
    val demanding = problem.demandingSubjectIds.toSet()
    val rows =
        problem.rows.associate {
            it.id to
                Row(
                    id = it.id,
                    teacherId = it.teacherId,
                    subjectId = it.subjectId,
                    unitId = it.unitId,
                    classIds = it.classIds.toSet(),
                    studentIds = it.studentIds.toSet(),
                    lessonsPerWeek = it.lessonsPerWeek,
                    doubleLessons = it.doubleLessons,
                    mainRoomId = it.mainRoomId,
                    partTime = it.teacherId in partTime,
                    demanding = it.subjectId in demanding,
                )
        }
    val facts =
        Facts(
            days = problem.days.associate { "${it.grade}|${it.weekday}" to it.slots },
            gradeOf = problem.classes.associate { it.id to it.grade },
            rooms = problem.rooms.associate { it.id to Room(it.id, it.shared, it.lessonsAtOnce, it.capacity) },
        )
    val lessons =
        problem.lessons.map { lesson ->
            val own = lesson.rowIds.map { rows[it] ?: error("Lesson ${lesson.id} names no row $it.") }
            val options =
                lesson.options.map { option ->
                    val held = option.rowIds?.map { id -> own.find { it.id == id } ?: error("Lesson ${lesson.id} has no row $id.") } ?: own
                    require(option.rooms.size == held.size) { "Lesson ${lesson.id} needs one room per row." }
                    Option(option.weekday, option.start, option.end, option.number, held, option.rooms)
                }
            require(!lesson.pinned || options.size == 1) { "Pinned lesson ${lesson.id} needs exactly one option." }
            Lesson(
                id = lesson.id,
                rows = own,
                splitClassId = lesson.splitClassId,
                pinned = lesson.pinned,
                options = options,
                facts = facts,
                option = if (lesson.pinned) options.first() else null,
            )
        }
    val weights =
        ConstraintWeightOverrides.of(
            PREFERENCE_CONSTRAINTS.associateWith { HardMediumSoftScore.ofSoft(problem.weights.getValue(it).toLong()) },
        )
    return Timetable(lessons, weights)
}

fun solverConfig(seconds: Long): SolverConfig =
    SolverConfig()
        .withSolutionClass(Timetable::class.java)
        .withEntityClasses(Lesson::class.java)
        .withConstraintProviderClass(TimetableConstraints::class.java)
        .withTerminationConfig(TerminationConfig().withSpentLimit(Duration.ofSeconds(seconds.coerceIn(1, MOST_SECONDS))))

private val solutionManager: SolutionManager<Timetable, HardMediumSoftScore> by lazy {
    SolutionManager.create(SolverFactory.create<Timetable>(solverConfig(1)))
}

/** The answer of a solution: each lesson's option and the score. */
fun answerOf(
    solution: Timetable,
    seconds: Double,
): AnswerJson {
    // Timefold's score analysis by constraint is a paid feature; the score itself is free.
    val score = solutionManager.update(solution) ?: error("The solution has no score.")
    return AnswerJson(
        lessons =
            solution.lessons.map { lesson ->
                AnswerLessonJson(lesson.id, lesson.option?.let { PlacedJson(it.weekday, it.start, it.end, it.rows.map { row -> row.id }, it.rooms) })
            },
        score = ScoreJson(score.hardScore(), score.mediumScore(), score.softScore()),
        seconds = seconds,
        complete = score.hardScore() == 0L && score.mediumScore() == 0L,
    )
}
