/** Task 11.19: the descriptions of the map of the platform, setup. */
export const DESCRIPTIONS: Readonly<Record<string, string>> = {
  'features/setup/branch-page.tsx#field:setup.branch.address': "Holds the branch's street address.",
  'features/setup/branch-page.tsx#field:setup.branch.email':
    "Holds the branch's contact email address.",
  'features/setup/branch-page.tsx#field:setup.branch.goLiveDate':
    'Holds the date the branch starts using the platform: no dated lessons exist before it and the first timetable starts on it. It must lie in a planned or current year and on a school day; empty clears it.',
  'features/setup/branch-page.tsx#field:setup.branch.name':
    "Holds the branch's name, shown in the branch list and the top bar.",
  'features/setup/branch-page.tsx#field:setup.branch.phone':
    "Holds the branch's phone number: +998 and 9 digits.",
  'features/setup/branch-page.tsx#field:setup.branch.workingWeekdays':
    'Chooses the weekdays the branch works; lessons are planned only on these days. A save that would leave the go-live date on a non-school day is refused.',
  'features/setup/branches-page.tsx#button:setup.branch.cancel':
    'Closes the new branch form without saving.',
  'features/setup/branches-page.tsx#button:setup.branch.newBranch':
    'Opens the form for a new branch in the side panel: name, address, phone, email and working weekdays.',
  'features/setup/branches-page.tsx#column:setup.branches.address': "Shows the branch's address.",
  'features/setup/branches-page.tsx#column:setup.branches.buildings':
    'Shows how many buildings the branch has.',
  'features/setup/branches-page.tsx#column:setup.branches.name':
    "Shows the branch's name; selecting it opens the branch.",
  'features/setup/branches-page.tsx#column:setup.branches.rooms':
    'Shows how many rooms the branch has.',
  'features/setup/branches-page.tsx#column:setup.branches.weekdays':
    'Shows the weekdays the branch works.',
  'features/setup/building-panel.tsx#button:forcedDeletes.deletePlace':
    'Deletes the building and its floors for good after asking for a reason; shown only when no floor has a room. It can be restored from Deleted for good for 30 days.',
  'features/setup/building-panel.tsx#button:forcedDeletes.deletePlaceNamed':
    'Deletes the floor for good after asking for a reason; shown only for a floor with no rooms. It can be restored from Deleted for good for 30 days.',
  'features/setup/building-panel.tsx#button:form.edit':
    "Opens the building's name for editing in the panel.",
  'features/setup/building-panel.tsx#button:setup.buildings.addFloor':
    'Opens a form under the floors to add a new floor to the building.',
  'features/setup/building-panel.tsx#button:setup.buildings.archiveBuilding':
    'Archives the building and its floors after a confirmation; refused while a room in it is in use or under repair. It can be restored.',
  'features/setup/building-panel.tsx#button:setup.buildings.archiveNamed':
    'Archives the floor after a confirmation, only when every room on it is closed; on an archived floor the same button restores it.',
  'features/setup/building-panel.tsx#button:setup.buildings.renameNamed':
    "Opens the floor's name in its row for editing; Save keeps the new name.",
  'features/setup/building-panel.tsx#button:setup.buildings.restoreBuilding':
    'Restores the archived building after a confirmation, with the floors that were archived with it.',
  'features/setup/building-panel.tsx#field:setup.buildings.floorName':
    "Holds a floor's name or number, used when rooms are placed on it.",
  'features/setup/building-panel.tsx#field:setup.buildings.name':
    "Holds the building's name, unique among the branch's active buildings.",
  'features/setup/building-panel.tsx#panel':
    'The side panel of one building: its name, status and floors with their room counts, and the actions to rename, add, archive or delete floors and to edit or archive the building.',
  'features/setup/building-panel.tsx#panel:forcedDeletes.placeTitle_building':
    'The dialog that deletes the building for good: it asks for the reason and says the building is kept 30 days and can be restored from Deleted for good.',
  'features/setup/buildings-page.tsx#button:setup.buildings.add':
    'Opens the form for a new building in the side panel.',
  'features/setup/buildings-page.tsx#button:setup.buildings.cancel':
    'Closes the new building form without saving.',
  'features/setup/buildings-page.tsx#column:setup.buildings.floors':
    'Shows how many active floors the building has.',
  'features/setup/buildings-page.tsx#column:setup.buildings.name':
    "Shows the building's name; selecting it opens the building in the side panel.",
  'features/setup/buildings-page.tsx#column:setup.buildings.rooms':
    "Shows how many rooms are on the building's floors.",
  'features/setup/buildings-page.tsx#column:setup.buildings.status':
    'Shows whether the building is active or archived.',
  'features/setup/calendar-entry-form.tsx#field:setup.calendar.examWeek':
    'Marks the special day as part of an exam week, with or without regular lessons, or not an exam week.',
  'features/setup/calendar-entry-form.tsx#field:setup.calendar.firstDate':
    'Holds the first date the entry covers.',
  'features/setup/calendar-entry-form.tsx#field:setup.calendar.follows':
    "Chooses whose lessons the special day holds: its own weekday's, or another weekday's when the date is not a working weekday.",
  'features/setup/calendar-entry-form.tsx#field:setup.calendar.gradeFrom':
    'Holds the lowest grade the entry covers when it is for some grades.',
  'features/setup/calendar-entry-form.tsx#field:setup.calendar.gradeTo':
    'Holds the highest grade the entry covers when it is for some grades.',
  'features/setup/calendar-entry-form.tsx#field:setup.calendar.kind':
    'Chooses whether the new entry is a day off (no lessons) or a special day (lessons on another day template).',
  'features/setup/calendar-entry-form.tsx#field:setup.calendar.lastDate':
    'Holds the last date the entry covers; for a started entry it is the only date that can still change.',
  'features/setup/calendar-entry-form.tsx#field:setup.calendar.name':
    "Holds the entry's name, such as the holiday or event it marks.",
  'features/setup/calendar-entry-form.tsx#field:setup.calendar.scope':
    'Chooses whether the entry holds for the whole branch or only for a range of grades.',
  'features/setup/calendar-entry-form.tsx#field:setup.calendar.template':
    'Chooses the day template whose times the special day follows.',
  'features/setup/calendar-entry-panel.tsx#button:form.edit':
    "Opens the entry's form; a started entry offers only its name and last date. A save that changes dates first shows what it does to the published timetable.",
  'features/setup/calendar-entry-panel.tsx#button:setup.calendar.archive':
    'Archives the entry after showing what it changes in the published timetable; it can be restored.',
  'features/setup/calendar-entry-panel.tsx#button:setup.calendar.restore':
    'Restores the archived entry after showing what it changes in the published timetable.',
  'features/setup/calendar-entry-panel.tsx#panel':
    'The side panel of one calendar entry: its kind, dates, grades and, for a special day, its template, weekday and exam week, with the actions to edit, archive or restore it.',
  'features/setup/calendar-exams-preview.tsx#field:setup.calendar.lessons.exams.block':
    'Asks, for a class that sits an exam in a lesson shared with classes that do not, whether to cancel the whole lesson or keep it for the other classes; the save waits for a choice.',
  'features/setup/calendar-page.tsx#button:setup.calendar.add':
    'Opens the form for a new day off or special day in the side panel.',
  'features/setup/calendar-page.tsx#button:setup.calendar.cancel':
    'Closes the new calendar entry form without saving.',
  'features/setup/calendar-page.tsx#column:setup.calendar.dates':
    'Shows the first and last date of the entry.',
  'features/setup/calendar-page.tsx#column:setup.calendar.kind':
    'Shows whether the entry is a day off or a special day.',
  'features/setup/calendar-page.tsx#column:setup.calendar.name':
    "Shows the entry's name; selecting it opens the entry in the side panel.",
  'features/setup/calendar-page.tsx#column:setup.calendar.scope':
    'Shows whether the entry is for the whole branch or for a range of grades.',
  'features/setup/calendar-page.tsx#column:setup.calendar.state':
    'Shows whether the entry is active or archived.',
  'features/setup/calendar-page.tsx#column:setup.calendar.template':
    'Shows the day template of a special day.',
  'features/setup/calendar-page.tsx#field:setup.calendar.checkDate':
    'Holds a date to check; the table under it shows, grade by grade, which day template or reason for no lessons that date has.',
  'features/setup/calendar-shortened.tsx#button:timetable.publish.shortened.reset':
    'Clears the lessons ticked for a class on a shortened day, so its lessons are kept by their order in the day again.',
  'features/setup/day-template-form.tsx#field:setup.dayTemplates.from':
    'Holds the date the new slots or start time take effect, tomorrow at the earliest.',
  'features/setup/day-template-form.tsx#field:setup.dayTemplates.name':
    "Holds the new day template's name.",
  'features/setup/day-template-form.tsx#field:setup.dayTemplates.slots':
    'Holds the lessons and breaks of the day in order; each is added from the active slot types and shows its times, worked out from the start time and lengths.',
  'features/setup/day-template-form.tsx#field:setup.dayTemplates.startTime':
    'Holds the time the first slot of the day starts; the times of the other slots follow from it.',
  'features/setup/day-template-form.tsx#field:setup.dayTemplates.startTime:2':
    'Holds the start time of the day from the chosen date; earlier days keep their times.',
  'features/setup/day-template-panel.tsx#button:form.edit':
    "Opens the day template's name for editing.",
  'features/setup/day-template-panel.tsx#button:setup.dayTemplates.archive':
    'Archives the day template after a confirmation; it can no longer be set for the branch, past days keep their times, and it can be restored.',
  'features/setup/day-template-panel.tsx#button:setup.dayTemplates.changeSlots':
    'Opens a form for new slots or a new start time from a date; Save first shows what the change does to the published timetable.',
  'features/setup/day-template-panel.tsx#button:setup.dayTemplates.restore':
    'Restores the archived day template after a confirmation.',
  'features/setup/day-template-panel.tsx#field:setup.dayTemplates.name':
    "Holds the day template's name when it is renamed.",
  'features/setup/day-template-panel.tsx#panel':
    'The side panel of one day template: the day as it runs tomorrow, its versions by date, and the actions to rename it, change its slots from a date, archive or restore it.',
  'features/setup/day-templates-page.tsx#button:setup.dayTemplates.add':
    'Opens the form for a new day template: name, start time and slots in order.',
  'features/setup/day-templates-page.tsx#button:setup.dayTemplates.cancel':
    'Closes the new day template form without saving.',
  'features/setup/day-templates-page.tsx#column:setup.dayTemplates.day':
    "Shows when the template's day starts and ends today.",
  'features/setup/day-templates-page.tsx#column:setup.dayTemplates.lessonSlots':
    "Shows how many lesson slots the template's day has.",
  'features/setup/day-templates-page.tsx#column:setup.dayTemplates.name':
    "Shows the template's name; selecting it opens the template in the side panel.",
  'features/setup/day-templates-page.tsx#column:setup.dayTemplates.state':
    'Shows whether the template is active or archived.',
  'features/setup/day-templates-page.tsx#column:setup.dayTemplates.use':
    'Shows whether the template is set anywhere for the branch.',
  'features/setup/demo-clock-page.tsx#button:setup.demoClock.moveChosen':
    'Moves demo time to the date and time typed, after a confirmation; it cannot be undone and everyone signed in sees the new time.',
  'features/setup/demo-clock-page.tsx#button:setup.demoClock.quick.hour':
    'Moves demo time forward by one hour after a confirmation; the buttons beside it move it to tomorrow 07:05 or next Monday 09:05. Demo time never moves back.',
  'features/setup/demo-clock-page.tsx#field:setup.demoClock.date':
    'Holds the date to move demo time to.',
  'features/setup/demo-clock-page.tsx#field:setup.demoClock.time':
    'Holds the time, in branch time, to move demo time to.',
  'features/setup/digest-settings-section.tsx#field:digest.settings.quietFrom':
    'Holds when the quiet hours start; no digest is sent between this time and the end of the quiet hours.',
  'features/setup/digest-settings-section.tsx#field:digest.settings.quietUntil':
    'Holds when the quiet hours end; a digest held back during them is sent then.',
  'features/setup/digest-settings-section.tsx#field:digest.settings.sendAt':
    "Holds the time of day, Tashkent time, the parents' digest is sent; it must lie outside the quiet hours.",
  'features/setup/division-panel.tsx#button:form.edit':
    "Opens the division's names in Uzbek, Russian and English for editing.",
  'features/setup/division-panel.tsx#button:setup.divisions.addDepartment':
    'Opens a form to add a department to the division, with its name in three languages.',
  'features/setup/division-panel.tsx#button:setup.divisions.archiveDivision':
    'Archives the division and its departments after a confirmation; refused while staff members are in it. It can be restored.',
  'features/setup/division-panel.tsx#button:setup.divisions.archiveNamed':
    'Archives the department after a confirmation; on an archived department the same button restores it.',
  'features/setup/division-panel.tsx#button:setup.divisions.renameNamed':
    "Opens the department's names in its row for editing in the three languages.",
  'features/setup/division-panel.tsx#button:setup.divisions.restoreDivision':
    'Restores the archived division after a confirmation, with the departments archived with it.',
  'features/setup/division-panel.tsx#panel':
    'The side panel of one division: its names, status and departments, with the actions to rename, add or archive departments and to edit, archive or restore the division.',
  'features/setup/divisions-page.tsx#button:setup.divisions.add':
    'Opens the form for a new division, with its name in three languages.',
  'features/setup/divisions-page.tsx#button:setup.divisions.cancel':
    'Closes the new division form without saving.',
  'features/setup/divisions-page.tsx#column:setup.divisions.departments':
    'Shows how many active departments the division has.',
  'features/setup/divisions-page.tsx#column:setup.divisions.name':
    "Shows the division's name; selecting it opens the division in the side panel.",
  'features/setup/divisions-page.tsx#column:setup.divisions.staff':
    'Shows how many staff members are in the division.',
  'features/setup/divisions-page.tsx#column:setup.divisions.status':
    'Shows whether the division is active or archived.',
  'features/setup/quarters-preview.tsx#button:setup.years.cancel':
    'Closes the preview and goes back to the quarters form with nothing saved.',
  'features/setup/quarters-preview.tsx#button:setup.years.preview.save':
    'Saves the new quarter dates with the choices made; it stays off while something stops the save or a choice is missing.',
  'features/setup/quarters-preview.tsx#panel:setup.years.preview.title':
    'The dialog that shows what new quarter dates do to the published timetable before they are saved: what stops the save, lessons that change quarter, lessons removed or created, and choices to make.',
  'features/setup/room-form.tsx#field:setup.rooms.building':
    'Chooses the building the room is in; its floors are offered next.',
  'features/setup/room-form.tsx#field:setup.rooms.capacity':
    'Holds how many students the room seats.',
  'features/setup/room-form.tsx#field:setup.rooms.floor':
    'Chooses the floor of the building the room is on.',
  'features/setup/room-form.tsx#field:setup.rooms.maxLessons':
    'Holds how many lessons a shared room can hold at the same time.',
  'features/setup/room-form.tsx#field:setup.rooms.name': "Holds the room's name or number.",
  'features/setup/room-form.tsx#field:setup.rooms.sharedSwitch':
    'Marks the room as shared, so it can hold several lessons at the same time.',
  'features/setup/room-form.tsx#field:setup.rooms.status':
    'Chooses whether the room is in use, under repair or closed; only rooms in use take lessons.',
  'features/setup/room-form.tsx#field:setup.rooms.type':
    "Chooses the room's type: classroom, laboratory, sports hall, hall or other. The timetable uses it when a lesson needs a kind of room.",
  'features/setup/room-panel.tsx#button:forcedDeletes.deletePlace':
    'Deletes the room for good after asking for a reason; only a room nothing uses can be deleted. It can be restored from Deleted for good for 30 days.',
  'features/setup/room-panel.tsx#button:form.edit':
    "Opens the room's form for editing: name, place, type, capacity, status and sharing.",
  'features/setup/room-panel.tsx#panel':
    'The side panel of one room: its building, floor, type, capacity, status and sharing, with the actions to edit it or delete it for good.',
  'features/setup/room-panel.tsx#panel:forcedDeletes.placeTitle_room':
    'The dialog that deletes the room for good: it asks for the reason and says the room is kept 30 days and can be restored from Deleted for good.',
  'features/setup/rooms-by-floor.tsx#button:setup.rooms.buildingCards':
    'Switches the by-floor view to this building, showing its floors and room cards; the number is how many rooms are shown.',
  'features/setup/rooms-by-floor.tsx#button:setup.rooms.types.other':
    'A room card on the floor plan, showing its name, type, seats and sharing; pressing it opens the room in the side panel.',
  'features/setup/rooms-page.tsx#button:setup.rooms.add':
    'Opens the form for a new room in the side panel.',
  'features/setup/rooms-page.tsx#button:setup.rooms.cancel':
    'Closes the new room form without saving.',
  'features/setup/rooms-page.tsx#column:setup.rooms.building': 'Shows the building the room is in.',
  'features/setup/rooms-page.tsx#column:setup.rooms.capacity':
    'Shows how many students the room seats.',
  'features/setup/rooms-page.tsx#column:setup.rooms.floor': 'Shows the floor the room is on.',
  'features/setup/rooms-page.tsx#column:setup.rooms.name':
    "Shows the room's name or number; selecting it opens the room in the side panel.",
  'features/setup/rooms-page.tsx#column:setup.rooms.shared':
    'Shows whether the room is shared and how many lessons it holds at once.',
  'features/setup/rooms-page.tsx#column:setup.rooms.status':
    'Shows whether the room is in use, under repair or closed.',
  'features/setup/rooms-page.tsx#column:setup.rooms.type':
    "Shows the room's type, such as classroom or laboratory.",
  'features/setup/rooms-page.tsx#tab:setup.rooms.views':
    'Switches between the list of rooms and the view by building and floor with room cards.',
  'features/setup/settings-page.tsx#field:setup.settings.classDaily':
    'Holds the most lessons a class should have in a day; a class with more is marked in the timetable. Empty means no limit.',
  'features/setup/settings-page.tsx#field:setup.settings.editDays':
    'Holds how many calendar days after a lesson its journal entries stay open for the teacher; applies to lessons dated after the change.',
  'features/setup/settings-page.tsx#field:setup.settings.lateValue':
    'Holds the percent a late mark counts as in the attendance part for the quarter; a change that alters published grades asks for a reason.',
  'features/setup/settings-page.tsx#field:setup.settings.planWindows':
    'Turns lesson plan windows on or off: on, plans are written in a window and then changed by request; off, teachers change their plans at any time.',
  'features/setup/settings-page.tsx#field:setup.settings.skippedValue':
    'Holds the percent a skipped lesson counts as in the attendance part for the quarter; a change that alters published grades asks for a reason.',
  'features/setup/settings-page.tsx#field:setup.settings.thresholds.lowResult':
    'Holds the quarter result under which a student goes on the early-warning list, beside the other thresholds of that list.',
  'features/setup/slot-type-panel.tsx#button:form.edit': "Opens the slot type's name for editing.",
  'features/setup/slot-type-panel.tsx#button:setup.slotTypes.archive':
    'Archives the slot type after a confirmation; it can no longer be added to a day template, past days keep their times, and it can be restored.',
  'features/setup/slot-type-panel.tsx#button:setup.slotTypes.changeLength':
    'Opens a form for a new length from a date; Save first shows what the change does to the published timetable.',
  'features/setup/slot-type-panel.tsx#button:setup.slotTypes.restore':
    'Restores the archived slot type after a confirmation.',
  'features/setup/slot-type-panel.tsx#field:setup.slotTypes.from':
    'Holds the date the new length takes effect; earlier days keep their times.',
  'features/setup/slot-type-panel.tsx#field:setup.slotTypes.length':
    'Holds the new length in minutes.',
  'features/setup/slot-type-panel.tsx#field:setup.slotTypes.name':
    "Holds the slot type's name when it is renamed.",
  'features/setup/slot-type-panel.tsx#panel':
    'The side panel of one slot type: its kind and its lengths by date, with the actions to rename it, set a new length from a date, archive or restore it.',
  'features/setup/slot-types-page.tsx#button:setup.slotTypes.add':
    'Opens the form for a new lesson or break slot type.',
  'features/setup/slot-types-page.tsx#button:setup.slotTypes.cancel':
    'Closes the new slot type form without saving.',
  'features/setup/slot-types-page.tsx#column:setup.slotTypes.kind':
    'Shows whether the slot type is a lesson or a break.',
  'features/setup/slot-types-page.tsx#column:setup.slotTypes.length':
    "Shows the slot type's length in minutes today.",
  'features/setup/slot-types-page.tsx#column:setup.slotTypes.name':
    "Shows the slot type's name; selecting it opens it in the side panel.",
  'features/setup/slot-types-page.tsx#column:setup.slotTypes.planned':
    'Shows a new length planned from a later date, if any.',
  'features/setup/slot-types-page.tsx#column:setup.slotTypes.state':
    'Shows whether the slot type is active or archived.',
  'features/setup/slot-types-page.tsx#field:setup.slotTypes.kind':
    'Chooses whether the new slot type is a lesson or a break.',
  'features/setup/slot-types-page.tsx#field:setup.slotTypes.length':
    "Holds the new slot type's length in minutes.",
  'features/setup/slot-types-page.tsx#field:setup.slotTypes.name':
    "Holds the new slot type's name.",
  'features/setup/subject-form.tsx#field:setup.subjects.colour':
    "Chooses the subject's colour, used on the timetable and in lists.",
  'features/setup/subject-form.tsx#field:setup.subjects.demanding':
    'Marks the subject as demanding, so the timetable generator places it in the first slots of the day.',
  'features/setup/subject-form.tsx#field:setup.subjects.department':
    'Chooses the department the subject belongs to.',
  'features/setup/subject-form.tsx#field:setup.subjects.departmentStartsOn':
    'Holds the date the subject moves to the newly chosen department.',
  'features/setup/subject-form.tsx#field:setup.subjects.grades':
    'Chooses the grades the subject is taught in.',
  'features/setup/subject-form.tsx#field:setup.subjects.groupSubject':
    'Marks the subject as taught in groups rather than to the whole class.',
  'features/setup/subject-form.tsx#field:setup.subjects.journalType':
    "Chooses whether the subject's journal is graded or attendance only.",
  'features/setup/subject-form.tsx#field:setup.subjects.languageRule':
    "When on, only teachers of the class's language of instruction can take it; switched off for subjects like English taught in another language.",
  'features/setup/subject-form.tsx#field:setup.subjects.nameUz':
    "Holds the subject's name in Uzbek; the fields beside it hold the Russian and English names. Each name must be free among active subjects.",
  'features/setup/subject-form.tsx#field:setup.subjects.ratingExam':
    'Turns on the rating exam for a graded subject, adding a rating exam part to its result.',
  'features/setup/subject-form.tsx#field:setup.subjects.switchesFrom':
    'Chooses the quarter from which a changed journal type or rating exam takes effect; earlier quarters keep what they had.',
  'features/setup/subject-import-page.tsx#button:people.import.reading':
    'Uploads the filled Excel file and shows a preview of every row with its problems; nothing is saved yet.',
  'features/setup/subject-import-page.tsx#button:people.import.template':
    'Downloads the Excel template for the subject import, with headings in three languages.',
  'features/setup/subject-import-page.tsx#button:setup.subjectImport.confirm':
    'Saves every subject of the file at once; it stays off until every row is clean.',
  'features/setup/subject-import-page.tsx#column:people.import.problemsColumn':
    'Shows what is wrong with the row, or that it is clean.',
  'features/setup/subject-import-page.tsx#column:people.import.row':
    'Shows the row number of the subject in the uploaded file.',
  'features/setup/subject-import-page.tsx#column:setup.subjectImport.name':
    "Shows the subject's name as read from the row.",
  'features/setup/subject-panel.tsx#button:form.edit': "Opens the subject's form for editing.",
  'features/setup/subject-panel.tsx#button:setup.subjects.archiveSubject':
    'Archives the subject after a confirmation; it leaves the pickers of every branch and can be restored.',
  'features/setup/subject-panel.tsx#button:setup.subjects.changeWeightsOf':
    "Opens the form of the quarter's distribution: the weights of attendance, classwork, homework and the rating exam.",
  'features/setup/subject-panel.tsx#button:setup.subjects.copy':
    "Copies quarter 1's distribution to quarters 2 to 4, after a confirmation when they already have one.",
  'features/setup/subject-panel.tsx#button:setup.subjects.restoreSubject':
    'Restores the archived subject after a confirmation, with its weights as they were.',
  'features/setup/subject-panel.tsx#field:setup.subjects.year':
    'Chooses the academic year whose quarterly distributions are shown.',
  'features/setup/subject-panel.tsx#panel':
    'The side panel of one subject: its details and its quarterly distributions of weights by year, with the actions to edit, archive or restore it.',
  'features/setup/subjects-page.tsx#button:setup.subjects.add':
    'Opens the form for a new subject in the side panel.',
  'features/setup/subjects-page.tsx#button:setup.subjects.cancel':
    'Closes the new subject form without saving.',
  'features/setup/subjects-page.tsx#column:setup.subjects.department':
    'Shows the department of the subject.',
  'features/setup/subjects-page.tsx#column:setup.subjects.grades':
    'Shows the grades the subject is taught in.',
  'features/setup/subjects-page.tsx#column:setup.subjects.journalType':
    "Shows whether the subject's journal is graded or attendance only.",
  'features/setup/subjects-page.tsx#column:setup.subjects.name':
    "Shows the subject's name with its colour; selecting it opens the subject in the side panel.",
  'features/setup/subjects-page.tsx#column:setup.subjects.quarterlyMissing':
    'Shows how many quarters of a graded subject have no distribution of weights yet.',
  'features/setup/subjects-page.tsx#column:setup.subjects.ratingExam':
    'Shows whether the subject has a rating exam.',
  'features/setup/subjects-page.tsx#column:setup.subjects.status':
    'Shows whether the subject is active or archived.',
  'features/setup/subjects-page.tsx#column:setup.subjects.switches':
    'Shows which of the group subject, language rule and demanding switches are on.',
  'features/setup/template-assignment-panel.tsx#button:setup.templateSettings.endTitle':
    'Opens a form to end the setting from a date; Save first shows the templates after the change. The branch default cannot be ended, only replaced.',
  'features/setup/template-assignment-panel.tsx#field:setup.templateSettings.endFrom':
    'Holds the first date the setting no longer applies, tomorrow at the earliest.',
  'features/setup/template-assignment-panel.tsx#panel':
    'The side panel of one template setting: its level, weekday, grades, template and dates, with the action to end it from a date.',
  'features/setup/template-settings-page.tsx#column:setup.templateSettings.from':
    'Shows the date the setting starts.',
  'features/setup/template-settings-page.tsx#column:setup.templateSettings.grades':
    'Shows the grades of the setting, if it has them.',
  'features/setup/template-settings-page.tsx#column:setup.templateSettings.level':
    'Shows what the setting applies to; selecting it opens the setting in the side panel.',
  'features/setup/template-settings-page.tsx#column:setup.templateSettings.template':
    'Shows the day template the setting gives.',
  'features/setup/template-settings-page.tsx#column:setup.templateSettings.until':
    'Shows the date the setting ends, or that it has no end.',
  'features/setup/template-settings-page.tsx#column:setup.templateSettings.weekday':
    'Shows the weekday of the setting, if it has one.',
  'features/setup/template-settings-page.tsx#field:setup.templateSettings.from':
    'Holds the date the setting starts, tomorrow by default; Save first shows the templates after the change.',
  'features/setup/template-settings-page.tsx#field:setup.templateSettings.gradeFrom':
    'Holds the lowest grade the setting applies to.',
  'features/setup/template-settings-page.tsx#field:setup.templateSettings.gradeTo':
    'Holds the highest grade the setting applies to.',
  'features/setup/template-settings-page.tsx#field:setup.templateSettings.level':
    'Chooses what the new setting applies to: the whole branch, a range of grades, a weekday, or a weekday and a range of grades.',
  'features/setup/template-settings-page.tsx#field:setup.templateSettings.template':
    'Chooses the day template to set.',
  'features/setup/template-settings-page.tsx#field:setup.templateSettings.weekday':
    'Chooses the weekday the setting applies to.',
  'features/setup/template-settings-page.tsx#field:setup.templateTable.date':
    'Chooses the date for which the table shows the day template of every weekday and grade.',
  'features/setup/template-table.tsx#button:setup.templateTable.cancel':
    'Closes the preview and goes back to the form with nothing saved.',
  'features/setup/template-table.tsx#button:setup.templateTable.save':
    'Saves the change with the choices made; it stays off while something stops the save or a choice is missing.',
  'features/setup/template-table.tsx#panel:setup.templateTable.previewTitle':
    'The dialog that shows the templates table after a change, with changed cells marked, and what the change does to the published timetable, before it is saved.',
  'features/setup/travel-times-page.tsx#field:setup.travelTimes.minutes':
    "Holds the travel time in minutes to the other branch; a teacher's lessons in the two branches must be at least this far apart.",
  'features/setup/weights-form.tsx#field:setup.subjects.parts.attendance':
    'Holds the weight of attendance in the quarter result; with classwork, homework and the rating exam the parts must total 100.',
  'features/setup/year-panel.tsx#button:form.edit':
    "Opens the year's start and end dates for editing.",
  'features/setup/year-panel.tsx#button:setup.years.changeQuarters':
    'Opens the quarter dates for editing; when the new dates change the published timetable, Save first shows a preview.',
  'features/setup/year-panel.tsx#button:setup.years.start':
    "Makes the planned year the branch's current year after a confirmation; off while another year is current or an earlier one is not closed.",
  'features/setup/year-panel.tsx#field:setup.years.endDate':
    'Holds the last date of the academic year, in the calendar year after the start.',
  'features/setup/year-panel.tsx#field:setup.years.quarterEnd':
    'Holds the last date of the quarter, on or after its start.',
  'features/setup/year-panel.tsx#field:setup.years.quarterStart':
    'Holds the first date of the quarter, inside the year and after the previous quarter ends.',
  'features/setup/year-panel.tsx#field:setup.years.startDate':
    'Holds the first date of the academic year.',
  'features/setup/year-panel.tsx#panel':
    'The side panel of one academic year: its dates, status and quarters, with the actions to edit the dates, change the quarters and start the year.',
  'features/setup/years-page.tsx#button:setup.years.add':
    'Opens the form for a new academic year with its start and end dates.',
  'features/setup/years-page.tsx#button:setup.years.cancel':
    'Closes the new year form without saving.',
  'features/setup/years-page.tsx#column:setup.years.endDate': "Shows the year's last date.",
  'features/setup/years-page.tsx#column:setup.years.name':
    "Shows the year's name; selecting it opens the year in the side panel.",
  'features/setup/years-page.tsx#column:setup.years.quarters':
    "Shows how many of the year's four quarters are dated.",
  'features/setup/years-page.tsx#column:setup.years.startDate': "Shows the year's first date.",
  'features/setup/years-page.tsx#column:setup.years.status':
    'Shows whether the year is planned, current or closed.',
};
