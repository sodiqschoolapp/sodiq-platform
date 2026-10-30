package uz.sodiq.solver

/**
 * The solver's problem and answer as JSON: `SolverProblem` and `SolverAnswer`
 * of packages/timetable-rules/src/solver.ts, which builds the problem with the
 * rule engine (task 5.10). Times are clock minutes of the day in branch time.
 */
data class ProblemJson(
    val rows: List<RowJson>,
    val lessons: List<LessonJson>,
    val rooms: List<RoomJson>,
    val classes: List<ClassJson>,
    val days: List<DayJson>,
    val partTimeTeacherIds: List<String>,
    val demandingSubjectIds: List<String>,
    val weights: Map<String, Int>,
    val seconds: Long,
)

data class RowJson(
    val id: String,
    val teacherId: String,
    val subjectId: String,
    val unitId: String,
    val classIds: List<String>,
    val studentIds: List<String>,
    val lessonsPerWeek: Int,
    val doubleLessons: Boolean,
    val mainRoomId: String?,
)

data class OptionJson(
    val weekday: Int,
    val start: Int,
    val end: Int,
    val number: Int,
    /** The rows of a mixed split's combination; `null` for every row of the lesson. */
    val rowIds: List<String>? = null,
    val rooms: List<String?>,
)

data class LessonJson(
    val id: String,
    val rowIds: List<String>,
    val splitClassId: String?,
    val pinned: Boolean,
    val options: List<OptionJson>,
)

data class RoomJson(val id: String, val shared: Boolean, val lessonsAtOnce: Int, val capacity: Int)

data class ClassJson(val id: String, val grade: Int)

data class SlotJson(val start: Int, val end: Int, val number: Int)

data class DayJson(val grade: Int, val weekday: Int, val slots: List<SlotJson>)

data class PlacedJson(
    val weekday: Int,
    val start: Int,
    val end: Int,
    val rowIds: List<String>,
    val rooms: List<String?>,
)

data class AnswerLessonJson(val id: String, val option: PlacedJson?)

data class ScoreJson(val hard: Long, val medium: Long, val soft: Long)

data class AnswerJson(
    val lessons: List<AnswerLessonJson>,
    val score: ScoreJson,
    val seconds: Double,
    /** Every lesson placed and no hard constraint broken. */
    val complete: Boolean,
)
