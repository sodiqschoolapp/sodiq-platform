/** Task 11.19: the descriptions of the map of the platform, classes. */
export const DESCRIPTIONS: Readonly<Record<string, string>> = {
  'features/classes/class-form.tsx#button:classes.takenOpen':
    'Opens the existing class that already holds this name, archived or not, so it can be restored or used instead.',
  'features/classes/class-form.tsx#field:classes.className':
    "Holds the class's name within its grade, unique in the year.",
  'features/classes/class-form.tsx#field:classes.grade': 'Chooses the grade of the class.',
  'features/classes/class-form.tsx#field:classes.language':
    'Chooses the language of instruction of the class; its Tutor and groups must match it.',
  'features/classes/class-form.tsx#field:classes.mainRoom':
    "Chooses the class's main classroom, or none.",
  'features/classes/class-form.tsx#field:classes.maxSize':
    'Holds the most students the class may have; placements beyond it are refused.',
  'features/classes/class-form.tsx#field:classes.year':
    'Chooses the academic year the new class belongs to; it cannot be changed afterwards.',
  'features/classes/class-members.tsx#button:classes.putIntoClass':
    'Opens the form to put students of this grade who have no class into this class from a chosen day.',
  'features/classes/class-members.tsx#button:classes.withdraw':
    'Withdraws a planned placement after a confirmation; the student will not join the class on that day.',
  'features/classes/class-members.tsx#field:classes.from':
    "Sets the first day in the class; by default the latest of today, the start of the year and the students' start dates.",
  'features/classes/class-members.tsx#field:classes.name':
    'Chooses the class of the same grade that the ticked students are put into.',
  'features/classes/class-members.tsx#field:classes.pickStudents':
    "Ticks the active students of the class's grade, without a class, who are put into it.",
  'features/classes/class-panel.tsx#button:classes.archiveClass':
    'Archives the class after a confirmation; its Tutors end and planned ones are withdrawn. A class that still has students cannot be archived.',
  'features/classes/class-panel.tsx#button:classes.restoreClass':
    'Restores the archived class after a confirmation; it comes back without a Tutor.',
  'features/classes/class-panel.tsx#button:form.edit':
    "Opens the class's record for editing: grade, name, language, main classroom and maximum size.",
  'features/classes/class-panel.tsx#panel':
    "Shows a class's record, its Tutors with their dates and its students, and holds the actions to edit, put students in, give a Tutor, archive or restore it.",
  'features/classes/class-tutors.tsx#button:classes.endTutor':
    'Opens a date field to end this Tutor (or Class teacher) of the class from a chosen day, then asks for a confirmation.',
  'features/classes/class-tutors.tsx#button:classes.giveTutor':
    'Opens the form to give the class a Tutor (or Class teacher for grades 0-4) from a date, showing which dated lessons move to them.',
  'features/classes/class-tutors.tsx#button:classes.setActing':
    'Opens the form to set an acting Tutor (or Class teacher) for a period, showing which dated lessons move to them.',
  'features/classes/class-tutors.tsx#button:form.cancel':
    'Closes the Tutor form when no staff member holds the needed role yet.',
  'features/classes/class-tutors.tsx#field:classes.endOn':
    "Sets the day the Tutor's hold of the class ends.",
  'features/classes/class-tutors.tsx#field:classes.from':
    'Sets the first day the person holds the class.',
  'features/classes/class-tutors.tsx#field:classes.person':
    "Chooses the staff member with the Tutor or Class teacher role; one who does not teach in the class's language cannot be chosen.",
  'features/classes/class-tutors.tsx#field:classes.until':
    'Sets the last day the person holds the class, or leaves it open.',
  'features/classes/classes-page.tsx#button:classes.add':
    'Opens the form of a new class; it needs an academic year of the branch first.',
  'features/classes/classes-page.tsx#button:classes.cancel':
    'Closes the new class form without saving.',
  'features/classes/classes-page.tsx#column:classes.language':
    'Shows the language of instruction of the class.',
  'features/classes/classes-page.tsx#column:classes.mainRoom':
    "Shows the class's main classroom, or that it has none.",
  'features/classes/classes-page.tsx#column:classes.maxSize':
    'Shows the most students the class may have.',
  'features/classes/classes-page.tsx#column:classes.name':
    'Shows the class, grade and name; pressing the row opens the class.',
  'features/classes/classes-page.tsx#column:classes.status':
    'Shows whether the class is active or archived.',
  'features/classes/classes-page.tsx#column:classes.students':
    'Shows how many students are in the class today.',
  'features/classes/classes-page.tsx#column:classes.tutorOrClassTeacher':
    "Shows the class's current Tutor (grades 5-11) or Class teacher (grades 0-4).",
  'features/classes/classes-page.tsx#column:classes.year': 'Shows the academic year of the class.',
  'features/classes/group-form.tsx#button:groups.takenOpen':
    'Opens the existing group that already holds this name, archived or not.',
  'features/classes/group-form.tsx#field:groups.classes':
    'Ticks the classes whose students the group draws from, of one grade or two; for two grades the shared lesson slots are shown.',
  'features/classes/group-form.tsx#field:groups.groupName':
    "Holds the group's name, unique in the year.",
  'features/classes/group-form.tsx#field:groups.language':
    'Chooses the language the group is taught in when its classes differ in language; mixing asks for a confirmation.',
  'features/classes/group-form.tsx#field:groups.maxSize':
    'Holds the most students the group may have.',
  'features/classes/group-form.tsx#field:groups.sex':
    'Chooses whether the group is for everyone, girls only or boys only.',
  'features/classes/group-form.tsx#field:groups.subject':
    'Chooses the subject the group is taught; it cannot be changed afterwards.',
  'features/classes/group-form.tsx#field:groups.year':
    'Chooses the academic year of the new group; it cannot be changed afterwards.',
  'features/classes/group-members.tsx#button:groups.markReviewed':
    'Marks a student who was placed into the group automatically as reviewed, removing the review tag.',
  'features/classes/group-members.tsx#button:groups.putIntoGroup':
    "Opens the form to put students of the group's classes who are in no group of its subject into this group from a chosen day.",
  'features/classes/group-members.tsx#button:groups.withdraw':
    'Withdraws a planned placement after a confirmation; the student will not join the group on that day.',
  'features/classes/group-members.tsx#field:groups.columns.name':
    "Chooses the active group, drawing from the ticked students' class, that they are put into.",
  'features/classes/group-members.tsx#field:groups.from': 'Sets the first day in the group.',
  'features/classes/group-members.tsx#field:groups.pickStudents':
    "Ticks the students of the group's classes, in no group of its subject, who are put into it.",
  'features/classes/group-panel.tsx#button:form.edit':
    "Opens the group's record for editing: classes, name, language, maximum size and who it is for.",
  'features/classes/group-panel.tsx#button:groups.archiveGroup':
    'Archives the group after a confirmation; it stays in the history and can be restored. A group that still has students cannot be archived.',
  'features/classes/group-panel.tsx#button:groups.restoreGroup':
    'Restores the archived group after a confirmation; it is checked again against its classes and subject.',
  'features/classes/group-panel.tsx#panel':
    "Shows a group's record, its shared lesson slots and its students, and holds the actions to edit, put students in, archive or restore it.",
  'features/classes/group-placement-page.tsx#button:groups.placement.automatic':
    'Puts every listed student into the smallest group with a free seat, after a confirmation; each is tagged for review.',
  'features/classes/group-placement-page.tsx#column:groups.placement.class':
    "Shows the student's class.",
  'features/classes/group-placement-page.tsx#column:groups.placement.student':
    'Shows the student not yet in a group of the subject.',
  'features/classes/group-placement-page.tsx#column:people.students.uid':
    'Shows the unique ID of the student not yet in a group.',
  'features/classes/group-placement-page.tsx#field:groups.placement.grades':
    'Chooses the grade, or pair of grades, whose classes are looked at.',
  'features/classes/group-placement-page.tsx#field:groups.placement.on':
    'Sets the date the placement is checked on and starts from.',
  'features/classes/group-placement-page.tsx#field:groups.placement.subject':
    'Chooses the subject whose unplaced students are listed.',
  'features/classes/groups-page.tsx#button:groups.add': 'Opens the form of a new group.',
  'features/classes/groups-page.tsx#button:groups.cancel':
    'Closes the new group form without saving.',
  'features/classes/groups-page.tsx#column:groups.columns.classes':
    'Shows the classes the group draws its students from.',
  'features/classes/groups-page.tsx#column:groups.columns.language':
    'Shows the language the group is taught in.',
  'features/classes/groups-page.tsx#column:groups.columns.maxSize':
    'Shows the most students the group may have.',
  'features/classes/groups-page.tsx#column:groups.columns.name':
    "Shows the group's name; pressing the row opens the group.",
  'features/classes/groups-page.tsx#column:groups.columns.status':
    'Shows whether the group is active or archived.',
  'features/classes/groups-page.tsx#column:groups.columns.students':
    'Shows how many students are in the group today.',
  'features/classes/groups-page.tsx#column:groups.columns.subject':
    'Shows the subject the group is taught.',
};
