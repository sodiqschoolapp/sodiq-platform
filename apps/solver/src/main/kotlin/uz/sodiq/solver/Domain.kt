package uz.sodiq.solver

import ai.timefold.solver.core.api.domain.common.PlanningId
import ai.timefold.solver.core.api.domain.entity.PlanningEntity
import ai.timefold.solver.core.api.domain.entity.PlanningPin
import ai.timefold.solver.core.api.domain.solution.ConstraintWeightOverrides
import ai.timefold.solver.core.api.domain.solution.PlanningEntityCollectionProperty
import ai.timefold.solver.core.api.domain.solution.PlanningScore
import ai.timefold.solver.core.api.domain.solution.PlanningSolution
import ai.timefold.solver.core.api.domain.valuerange.ValueRangeProvider
import ai.timefold.solver.core.api.domain.variable.PlanningVariable
import ai.timefold.solver.core.api.score.HardMediumSoftScore

/** A load row of the draft as the constraints read it. */
data class Row(
    val id: String,
    /** The teacher or the vacancy: one key either way (06, Rules: a vacancy is bound like a teacher). */
    val teacherId: String,
    val subjectId: String,
    /** The class or group of the row. */
    val unitId: String,
    val classIds: Set<String>,
    val studentIds: Set<String>,
    val lessonsPerWeek: Int,
    val doubleLessons: Boolean,
    val mainRoomId: String?,
    val partTime: Boolean,
    val demanding: Boolean,
)

/**
 * Where a lesson goes: a slot of the week and a room for each row it holds.
 * A lesson of a load block holds all its rows; a lesson of a mixed split
 * holds the two rows of one combination the engine accepted (`rows`).
 */
data class Option(
    val weekday: Int,
    val start: Int,
    val end: Int,
    val number: Int,
    val rows: List<Row>,
    val rooms: List<String?>,
) {
    val teacherIds: Set<String> = rows.map { it.teacherId }.toSet()
    val classIds: Set<String> = rows.flatMap { it.classIds }.toSet()
    val studentIds: Set<String> = rows.flatMap { it.studentIds }.toSet()

    override fun toString() = "$weekday@$start${rows.map { it.id }}"
}

data class Room(val id: String, val shared: Boolean, val lessonsAtOnce: Int, val capacity: Int)

/** One use of a shared room: a row lesson in it at a time (shared rooms count row lessons, `checkSharedRooms`). */
data class SharedUse(
    val lessonId: String,
    val rowId: String,
    val room: Room,
    val weekday: Int,
    val start: Int,
    val end: Int,
    val students: Int,
)

/** What the problem knows beside the lessons: the rooms and each class's lesson slots. */
class Facts(
    /** `grade|weekday` to the lesson slots of that day. */
    private val days: Map<String, List<SlotJson>>,
    private val gradeOf: Map<String, Int>,
    val rooms: Map<String, Room>,
) {
    /** The lesson numbers of a class's template that a lesson at these times covers. */
    fun numbersOf(
        classId: String,
        weekday: Int,
        start: Int,
        end: Int,
    ): List<Int> {
        val grade = gradeOf[classId] ?: return emptyList()
        return days["$grade|$weekday"].orEmpty().filter { it.start < end && start < it.end }.map { it.number }
    }

    fun hasClass(classId: String) = classId in gradeOf

    companion object {
        val NONE = Facts(emptyMap(), emptyMap(), emptyMap())
    }
}

/**
 * A lesson of the week: one lesson of a load block (every row of the block
 * at one time), or one lesson of a mixed split (one combination of its
 * halves at one time; task 5.4c-3b).
 */
@PlanningEntity
class Lesson() {
    @field:PlanningId
    var id: String = ""

    /** The rows it may hold: its block's, or every row of its mixed split. */
    var rows: List<Row> = emptyList()
    var splitClassId: String? = null

    @field:PlanningPin
    var pinned: Boolean = false

    @field:ValueRangeProvider(id = "options")
    var options: List<Option> = emptyList()

    @field:PlanningVariable(valueRangeProviderRefs = ["options"], allowsUnassigned = true)
    var option: Option? = null

    var facts: Facts = Facts.NONE

    constructor(
        id: String,
        rows: List<Row>,
        splitClassId: String?,
        pinned: Boolean,
        options: List<Option>,
        facts: Facts,
        option: Option? = null,
    ) : this() {
        this.id = id
        this.rows = rows
        this.splitClassId = splitClassId
        this.pinned = pinned
        this.options = options
        this.facts = facts
        this.option = option
    }

    fun at(): Option = option ?: error("Lesson $id is not placed.")

    /** The rows placed: the chosen option's. */
    val placedRows: List<Row> get() = at().rows

    val teacherIds: Set<String> get() = at().teacherIds
    val classIds: Set<String> get() = at().classIds
    val studentIds: Set<String> get() = at().studentIds

    /** The rooms of its rows that are not shared, without empty ones. */
    fun ownRooms(): List<String> = at().rooms.filterNotNull().filter { facts.rooms[it]?.shared != true }

    /** Each row lesson in a shared room. */
    fun sharedUses(): List<SharedUse> {
        val placed = option ?: return emptyList()
        return placed.rows.mapIndexedNotNull { index, row ->
            val room = placed.rooms.getOrNull(index)?.let { facts.rooms[it] }
            if (room == null || !room.shared) {
                null
            } else {
                SharedUse(id, row.id, room, placed.weekday, placed.start, placed.end, row.studentIds.size)
            }
        }
    }

    override fun toString() = id
}

@PlanningSolution
class Timetable() {
    @field:PlanningEntityCollectionProperty
    var lessons: List<Lesson> = emptyList()

    @field:PlanningScore
    var score: HardMediumSoftScore? = null

    var constraintWeightOverrides: ConstraintWeightOverrides<HardMediumSoftScore> =
        ConstraintWeightOverrides.none()

    constructor(lessons: List<Lesson>, weights: ConstraintWeightOverrides<HardMediumSoftScore>) : this() {
        this.lessons = lessons
        this.constraintWeightOverrides = weights
    }
}
