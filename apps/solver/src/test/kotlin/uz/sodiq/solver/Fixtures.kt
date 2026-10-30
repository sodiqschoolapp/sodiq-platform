package uz.sodiq.solver

// Small invented lessons for the constraint tests (task 5.10).

/** Grades 5–11: 45-minute lessons; grades 1–4: 40-minute lessons, both from 08:00. */
val SENIOR_SLOTS = listOf(SlotJson(480, 525, 1), SlotJson(530, 575, 2), SlotJson(590, 635, 3), SlotJson(635, 680, 4))
val JUNIOR_SLOTS = listOf(SlotJson(480, 520, 1), SlotJson(525, 565, 2), SlotJson(570, 610, 3), SlotJson(615, 655, 4))

val ROOMS =
    mapOf(
        "r7a" to Room("r7a", shared = false, lessonsAtOnce = 1, capacity = 30),
        "r7b" to Room("r7b", shared = false, lessonsAtOnce = 1, capacity = 30),
        "hall" to Room("hall", shared = true, lessonsAtOnce = 2, capacity = 60),
        "small-hall" to Room("small-hall", shared = true, lessonsAtOnce = 3, capacity = 5),
    )

val FACTS =
    Facts(
        days = (1..5).flatMap { listOf("7|$it" to SENIOR_SLOTS, "2|$it" to JUNIOR_SLOTS) }.toMap(),
        gradeOf = mapOf("7a" to 7, "7b" to 7, "2a" to 2),
        rooms = ROOMS,
    )

fun row(
    id: String,
    teacher: String = "t-$id",
    classes: Set<String> = setOf("7a"),
    students: Set<String> = setOf("$id-s1", "$id-s2"),
    lessonsPerWeek: Int = 1,
    doubleLessons: Boolean = false,
    mainRoom: String? = null,
    partTime: Boolean = false,
    demanding: Boolean = false,
) = Row(id, teacher, "subject-$id", classes, students, lessonsPerWeek, doubleLessons, mainRoom, partTime, demanding)

fun at(
    weekday: Int,
    start: Int,
    end: Int,
    rows: List<Row>,
    rooms: List<String?> = rows.map { null },
    number: Int = 1,
) = Option(weekday, start, end, number, rows, rooms)

fun lesson(
    id: String,
    rows: List<Row>,
    option: Option?,
    splitClassId: String? = null,
) = Lesson(id, rows, splitClassId, pinned = false, options = listOfNotNull(option), facts = FACTS, option = option)
