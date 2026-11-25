/** Task 11.19: the descriptions of the map of the platform, timetable. */
export const DESCRIPTIONS: Readonly<Record<string, string>> = {
  'features/timetable/absence-form.tsx#field:timetable.absences.firstDay':
    'Holds the first day of the absence; it starts as today.',
  'features/timetable/absence-form.tsx#field:timetable.absences.firstDay:2':
    'Holds the new first day of the absence while changing its dates; it can be changed only before the absence has started.',
  'features/timetable/absence-form.tsx#field:timetable.absences.lastDay':
    'Holds the last day of the absence, when the return date is known.',
  'features/timetable/absence-form.tsx#field:timetable.absences.lastDay:2':
    'Holds the new last day of the absence while changing its dates; shortening it gives later lessons back to the teacher.',
  'features/timetable/absence-form.tsx#field:timetable.absences.openEnded':
    'When ticked, the absence has no last day yet and the last day field is hidden.',
  'features/timetable/absence-form.tsx#field:timetable.absences.openEnded:2':
    'When ticked while changing the dates, the absence is left without a last day.',
  'features/timetable/absence-form.tsx#field:timetable.absences.person':
    'Chooses the staff member who will be absent; one absence covers every branch they work in.',
  'features/timetable/absence-form.tsx#field:timetable.absences.reason':
    'Holds the reason for the absence.',
  'features/timetable/absence-panel.tsx#button:timetable.absences.changeDates':
    'Opens a form in the panel to change the first day (before it starts), the last day or the open end of the absence.',
  'features/timetable/absence-panel.tsx#button:timetable.absences.substituteJournal':
    'Opens a dialog to give one substitute every lesson of this journal for the whole absence; each date is still checked.',
  'features/timetable/absence-panel.tsx#button:timetable.absences.withdraw':
    'Withdraws the absence after a confirmation; its lessons go back to the teacher and a withdrawn absence cannot be changed again.',
  'features/timetable/absence-panel.tsx#button:timetable.day.substitute':
    'Opens the substitution dialog for this lesson of the absence, to choose a free teacher to take it.',
  'features/timetable/absence-panel.tsx#button:timetable.day.withdrawSubstitution':
    'Opens a dialog to withdraw the substitute of this lesson, with a reason.',
  'features/timetable/absence-panel.tsx#panel':
    'The side panel of an absence: its details, the buttons to change or withdraw it, and the lessons of this branch that fall inside it, with their substitutes.',
  'features/timetable/absences-page.tsx#button:timetable.absences.add':
    'Opens the form for a new absence: the person, the first and last day and the reason.',
  'features/timetable/absences-page.tsx#button:timetable.absences.cancel':
    'Closes the new absence form without saving.',
  'features/timetable/absences-page.tsx#column:timetable.absences.firstDay':
    'Shows the first day of the absence.',
  'features/timetable/absences-page.tsx#column:timetable.absences.lastDay':
    'Shows the last day of the absence, or Open-ended when no return date is set.',
  'features/timetable/absences-page.tsx#column:timetable.absences.person':
    'Shows the staff member who is absent; clicking it opens the absence in the side panel.',
  'features/timetable/absences-page.tsx#column:timetable.absences.reason':
    'Shows the reason given for the absence.',
  'features/timetable/absences-page.tsx#column:timetable.absences.state':
    'Shows whether the absence is planned, happening now, ended or withdrawn.',
  'features/timetable/builder-page.tsx#button:timetable.builder.confirm':
    'Confirms the period and day templates shown for the draft, which marks this step ready.',
  'features/timetable/builder-page.tsx#button:timetable.builder.stepNumber':
    'Opens that step of the draft builder; each step shows whether it is ready.',
  'features/timetable/builder-page.tsx#button:timetable.load.changeStart':
    'Opens a form to change the intended start date of the draft, with quarter-start shortcuts.',
  'features/timetable/builder-page.tsx#field:timetable.load.version':
    'Chooses which timetable version (draft or published) the builder shows.',
  'features/timetable/bulk-cancel-dialog.tsx#button:timetable.bulk.check':
    'Asks the server what the bulk cancel would do: the lessons cancelled, lessons shared with other classes and lessons that hold data.',
  'features/timetable/bulk-cancel-dialog.tsx#button:timetable.bulk.send':
    'Cancels every lesson the check listed, with the choices and the reason given.',
  'features/timetable/bulk-cancel-dialog.tsx#button:timetable.day.back':
    'Closes the dialog without cancelling anything.',
  'features/timetable/bulk-cancel-dialog.tsx#field:timetable.bulk.classes':
    'Chooses the classes whose lessons are cancelled; one tick chooses every class of the branch.',
  'features/timetable/bulk-cancel-dialog.tsx#field:timetable.bulk.shared':
    "Chooses, for a lesson shared with classes not chosen, whether to cancel it whole or keep it for the others and exempt the chosen classes' students.",
  'features/timetable/bulk-cancel-dialog.tsx#field:timetable.bulk.slots':
    'Chooses the lesson numbers of the day to cancel.',
  'features/timetable/bulk-cancel-dialog.tsx#field:timetable.day.reason':
    'Holds the reason for the bulk cancel; it is required.',
  'features/timetable/bulk-cancel-dialog.tsx#panel':
    'The dialog that cancels many lessons of one date at once, for chosen classes and lesson slots, with a reason.',
  'features/timetable/bulk-cancel-dialog.tsx#panel:timetable.bulk.title':
    'Cancels the lessons of chosen classes and lesson slots on the date at once; Check first lists what would be cancelled and asks for a choice on shared lessons.',
  'features/timetable/correction-dialog.tsx#button:timetable.day.back':
    'Closes the dialog without saving the correction.',
  'features/timetable/correction-dialog.tsx#button:timetable.day.correctSend':
    "Saves the correction of the lesson; it is recorded in the lesson's history.",
  'features/timetable/correction-dialog.tsx#field:timetable.day.confirm':
    'A tick that confirms the warnings listed have been checked; the correction is then saved with them.',
  'features/timetable/correction-dialog.tsx#field:timetable.day.correctKind':
    'Chooses what happened: it did not take place, it took place after all, someone else taught it, or it was held in another room.',
  'features/timetable/correction-dialog.tsx#field:timetable.day.heldIn':
    'Chooses the room the lesson was actually held in.',
  'features/timetable/correction-dialog.tsx#field:timetable.day.reason':
    'Holds the reason for the correction; it is required.',
  'features/timetable/correction-dialog.tsx#field:timetable.day.whoTaught':
    'Chooses the person who actually taught the lesson.',
  'features/timetable/correction-dialog.tsx#panel':
    'The dialog for correcting a past lesson, one at a time, with a reason.',
  'features/timetable/correction-dialog.tsx#panel:timetable.day.correctTitle':
    'Corrects what happened in a lesson that has started: it did not take place, took place after all, someone else taught it, or it was in another room.',
  'features/timetable/day-page.tsx#button:timetable.bulk.open':
    'Opens the bulk cancel dialog for the chosen date, to cancel lessons of several classes and slots at once.',
  'features/timetable/day-page.tsx#button:timetable.day.back':
    'Closes the dialog without changing the lesson.',
  'features/timetable/day-page.tsx#button:timetable.day.cancel':
    'Opens a dialog to cancel this lesson for this day, with a reason.',
  'features/timetable/day-page.tsx#button:timetable.day.cancelSend':
    'Cancels the lesson for this day; a lesson that holds marks or attendance asks for a tick first.',
  'features/timetable/day-page.tsx#button:timetable.day.changeRoom':
    'Opens a dialog to put this lesson in another room for this day only, with a reason.',
  'features/timetable/day-page.tsx#button:timetable.day.correct':
    'Opens the correction dialog for this past lesson: not held, held after all, another teacher or another room.',
  'features/timetable/day-page.tsx#button:timetable.day.forcedDelete':
    'Opens a dialog to delete this lesson for good with a typed reason; it and its data can be restored for 30 days.',
  'features/timetable/day-page.tsx#button:timetable.day.history':
    'Opens the history of this lesson: every change, who made it and when.',
  'features/timetable/day-page.tsx#button:timetable.day.keep':
    'Closes the dialog and keeps the lesson.',
  'features/timetable/day-page.tsx#button:timetable.day.move':
    'Opens a dialog to move this lesson to another date and lesson slot, and optionally another room, with a reason.',
  'features/timetable/day-page.tsx#button:timetable.day.restore':
    'Restores this cancelled lesson; when its room is no longer free, another free room is offered.',
  'features/timetable/day-page.tsx#button:timetable.day.roomSend':
    'Saves the change: the new room, the move or the restore, for this day only.',
  'features/timetable/day-page.tsx#button:timetable.day.substitute':
    'Opens the substitution dialog to choose a free teacher to take this lesson.',
  'features/timetable/day-page.tsx#button:timetable.day.withdrawSubstitution':
    'Opens a dialog to withdraw the substitute of this lesson, with a reason; the lesson goes back to its teacher.',
  'features/timetable/day-page.tsx#field:timetable.day.class':
    'Chooses the class whose lessons of the date are shown.',
  'features/timetable/day-page.tsx#field:timetable.day.date':
    'Chooses the date whose lessons are shown.',
  'features/timetable/day-page.tsx#field:timetable.day.moveDate':
    'Holds the date the lesson is moved to.',
  'features/timetable/day-page.tsx#field:timetable.day.moveRoom':
    'Chooses the room for the lesson; when moving, it can keep its own room.',
  'features/timetable/day-page.tsx#field:timetable.day.reason':
    'Holds the reason for the change; it is required.',
  'features/timetable/day-page.tsx#field:timetable.day.reason:2':
    'Holds the reason for cancelling the lesson; it is required.',
  'features/timetable/day-page.tsx#field:timetable.day.slot':
    'Chooses the lesson slot of the new date the lesson is moved to.',
  'features/timetable/day-page.tsx#panel:timetable.day.cancelTitle':
    'The dialog that cancels one lesson for this day, with a reason.',
  'features/timetable/day-page.tsx#panel:timetable.day.restoreTitle':
    'The dialog for a one-day change of a lesson: a change of room, a move to another date and slot, or a restore into another room, each with a reason.',
  'features/timetable/edit-lock.tsx#button:timetable.editLock.takeOver':
    'Takes over editing of the draft from the person editing it; allowed after 5 minutes without activity from them.',
  'features/timetable/exam-form.tsx#button:timetable.day.back':
    'Closes the exam form without saving.',
  'features/timetable/exam-form.tsx#button:timetable.exams.addRoom':
    'Adds another room to the exam, with its own classes and invigilators.',
  'features/timetable/exam-form.tsx#button:timetable.exams.check':
    'Asks the server what saving the exam would do: the lessons it cancels, shared lessons that need a choice, blocked rules and warnings.',
  'features/timetable/exam-form.tsx#button:timetable.exams.removeRoom':
    'Removes this room, with its classes and invigilators, from the exam.',
  'features/timetable/exam-form.tsx#button:timetable.exams.save':
    'Saves the exam and cancels its lessons; it is on only when the latest check allows the save.',
  'features/timetable/exam-form.tsx#field:timetable.exams.date': 'Holds the date of the exam.',
  'features/timetable/exam-form.tsx#field:timetable.exams.examTitle':
    'Holds the title of the exam.',
  'features/timetable/exam-form.tsx#field:timetable.exams.firstLesson':
    'Chooses the first lesson slot the exam takes.',
  'features/timetable/exam-form.tsx#field:timetable.exams.keepReason':
    'Holds the reason for keeping cancelled the lessons that a change of the exam cannot give back.',
  'features/timetable/exam-form.tsx#field:timetable.exams.lastLesson':
    'Chooses the last lesson slot the exam takes.',
  'features/timetable/exam-form.tsx#field:timetable.exams.room':
    'Chooses the room of this part of the exam; each room also takes its classes or groups and its invigilators.',
  'features/timetable/exam-form.tsx#field:timetable.exams.shared':
    'Chooses, for a lesson shared with classes that do not sit the exam, whether to cancel it for everyone or keep it for the others.',
  'features/timetable/exam-form.tsx#field:timetable.exams.subject':
    'Chooses the subject of the exam, or none.',
  'features/timetable/exam-form.tsx#panel:timetable.exams.newTitle':
    'The form of an exam: date, title, subject, lesson slots and rooms with their classes and invigilators. Check shows what it would cancel before it can be saved.',
  'features/timetable/exams-page.tsx#button:timetable.exams.cancel':
    'Opens a question to cancel this exam; the lessons it cancelled come back where nothing else holds their time.',
  'features/timetable/exams-page.tsx#button:timetable.exams.cancelSend':
    'Cancels the exam and gives its lessons back, or keeps the listed ones cancelled with the reason.',
  'features/timetable/exams-page.tsx#button:timetable.exams.change':
    'Opens the exam form to change this exam before it starts.',
  'features/timetable/exams-page.tsx#button:timetable.exams.keepExam':
    'Closes the question and keeps the exam.',
  'features/timetable/exams-page.tsx#button:timetable.exams.new':
    'Opens the form for a new exam on the chosen date.',
  'features/timetable/exams-page.tsx#column:timetable.exams.examTitle':
    'Shows the title of the exam; clicking it opens the exam in the side panel.',
  'features/timetable/exams-page.tsx#column:timetable.exams.invigilators':
    'Shows the invigilators of the exam.',
  'features/timetable/exams-page.tsx#column:timetable.exams.rooms':
    'Shows each room of the exam with the classes or groups it holds.',
  'features/timetable/exams-page.tsx#column:timetable.exams.state':
    'Shows whether the exam is planned, started or cancelled.',
  'features/timetable/exams-page.tsx#column:timetable.exams.subject':
    'Shows the subject of the exam, or No subject.',
  'features/timetable/exams-page.tsx#column:timetable.exams.time': 'Shows the time of the exam.',
  'features/timetable/exams-page.tsx#field:timetable.exams.date':
    'Chooses the date whose exams are listed.',
  'features/timetable/exams-page.tsx#field:timetable.exams.keepReason':
    'Holds the reason for keeping cancelled the lessons that cannot come back when the exam is cancelled.',
  'features/timetable/exams-page.tsx#panel:timetable.exams.cancelTitle':
    'Asks before cancelling the exam; lessons that cannot come back are listed and can be kept cancelled with a reason.',
  'features/timetable/grid-clock-board.tsx#button:timetable.grid.openClass':
    "Opens the board of this lesson's class, where the lesson can be moved.",
  'features/timetable/grid-conflicts.tsx#button:timetable.grid.show':
    'Opens the class board of the lesson behind this conflict and puts the focus on it.',
  'features/timetable/grid-conflicts.tsx#button:timetable.grid.show:2':
    'Shows the entry in the To place list for a row of this conflict that has no lesson placed yet.',
  'features/timetable/grid-conflicts.tsx#field:timetable.grid.conflictFilter':
    'Chooses what the conflict panel lists: errors and warnings, errors only, or warnings only.',
  'features/timetable/grid-locks.tsx#button:timetable.grid.lockClass':
    'Locks every lesson of the class shown, so suggestions and regeneration leave them where they are.',
  'features/timetable/grid-locks.tsx#button:timetable.grid.lockDay':
    'Locks every lesson of the chosen weekday, so regeneration leaves it as it is.',
  'features/timetable/grid-locks.tsx#button:timetable.grid.lockTeacher':
    'Locks every lesson of the chosen teacher, so regeneration leaves them where they are.',
  'features/timetable/grid-locks.tsx#button:timetable.grid.unlock':
    'Removes this lock, so suggestions and generation may move what it held.',
  'features/timetable/grid-locks.tsx#field:timetable.grid.lockDayLabel':
    'Chooses the weekday to lock.',
  'features/timetable/grid-locks.tsx#field:timetable.grid.lockTeacherLabel':
    'Chooses the teacher to lock.',
  'features/timetable/grid-move-dialog.tsx#button:timetable.grid.close':
    'Closes the dialog without moving the lesson.',
  'features/timetable/grid-move-dialog.tsx#button:timetable.grid.slotAt':
    'Moves the lesson to this weekday and time; a blocked slot cannot be chosen.',
  'features/timetable/grid-move-dialog.tsx#panel':
    'The dialog that moves a lesson without dragging: every slot of the board with its free, warning or blocked mark.',
  'features/timetable/grid-place-form.tsx#field:timetable.grid.lesson':
    'Chooses which lesson of the load to place in the empty slot, with how many of its lessons are already placed.',
  'features/timetable/grid-place-form.tsx#field:timetable.grid.pairedWith':
    'Chooses the half of the mixed split this lesson is placed together with, or the whole split.',
  'features/timetable/grid-place-form.tsx#field:timetable.grid.placeDouble':
    'When ticked, places the lesson as a double lesson.',
  'features/timetable/grid-place-form.tsx#field:timetable.grid.room':
    'Chooses the room of the new lesson from the rooms free in that slot, best fit first.',
  'features/timetable/grid-room-picker.tsx#button:timetable.grid.close':
    'Closes the room list without changing the room.',
  'features/timetable/grid-room-picker.tsx#button:timetable.grid.unknownRoom':
    'Puts the lesson in this room; the list shows the rooms free in its slot with their capacity and warnings.',
  'features/timetable/grid-step.tsx#button:timetable.grid.addAt':
    'Opens the form to add a lesson in this empty slot of the class board.',
  'features/timetable/grid-step.tsx#button:timetable.grid.history.redo':
    'Makes again the last change that was taken back.',
  'features/timetable/grid-step.tsx#button:timetable.grid.history.undo':
    'Takes back the last change made in the grid.',
  'features/timetable/grid-step.tsx#field:timetable.grid.class':
    'Chooses the class whose board is shown.',
  'features/timetable/grid-step.tsx#field:timetable.grid.room':
    'Chooses the room whose week is shown on the clock board.',
  'features/timetable/grid-step.tsx#field:timetable.grid.teacher':
    'Chooses the teacher whose week is shown on the clock board.',
  'features/timetable/grid-step.tsx#field:timetable.grid.view':
    'Chooses the board: by class, by teacher or by room.',
  'features/timetable/grid-suggest-dialog.tsx#button:timetable.grid.applyAt':
    'Applies this suggestion: places or moves the lesson there, moving the other lessons it names.',
  'features/timetable/grid-suggest-dialog.tsx#button:timetable.grid.close':
    'Closes the suggestions without changing anything.',
  'features/timetable/grid-suggest-dialog.tsx#panel':
    'Suggests places for a lesson: the best free slots, or moves of two or three other lessons that make room.',
  'features/timetable/grid-tile.tsx#button:timetable.grid.move':
    'Opens the move dialog to choose another slot for this lesson without dragging.',
  'features/timetable/grid-tile.tsx#button:timetable.grid.remove':
    'Removes this lesson from the draft after a confirmation.',
  'features/timetable/grid-tile.tsx#button:timetable.grid.roomOf':
    'Opens the room list of this lesson to put it in another free room.',
  'features/timetable/grid-tile.tsx#button:timetable.grid.suggest':
    'Opens the suggestions of a better place for this lesson.',
  'features/timetable/grid-tile.tsx#button:timetable.grid.unlock':
    'Locks this lesson in its place, or unlocks it when it is locked.',
  'features/timetable/grid-to-place.tsx#button:timetable.grid.place':
    'Opens the slot list of the board to place this lesson in a slot.',
  'features/timetable/grid-to-place.tsx#button:timetable.grid.suggest':
    'Opens suggestions of free slots, or of moves that make room, for this lesson.',
  'features/timetable/grid-to-place.tsx#field:timetable.grid.pairedWith':
    'Chooses the half of the mixed split this entry is placed together with, or the whole split.',
  'features/timetable/held-data.tsx#field:timetable.held.confirm':
    'A tick that cancels lessons holding attendance or marks anyway; the entries are kept, struck through and left out of every figure.',
  'features/timetable/journal-substitute-dialog.tsx#button:timetable.day.back':
    'Closes the dialog without saving the substitution.',
  'features/timetable/journal-substitute-dialog.tsx#button:timetable.day.substituteSend':
    'Saves the substitute for every lesson of the journal in the period; the answer lists the dates saved and those blocked.',
  'features/timetable/journal-substitute-dialog.tsx#button:timetable.journalSubstitute.close':
    'Closes the dialog after the substitution, once the dates saved and blocked are shown.',
  'features/timetable/journal-substitute-dialog.tsx#field:timetable.day.reason':
    'Holds the reason for the substitution.',
  'features/timetable/journal-substitute-dialog.tsx#field:timetable.day.substitute':
    'Chooses the substitute; each teacher shows which dates they are free to take.',
  'features/timetable/journal-substitute-dialog.tsx#field:timetable.day.substituteConfirm':
    'A tick that confirms the warnings listed have been checked; the substitution is then saved with them.',
  'features/timetable/journal-substitute-dialog.tsx#field:timetable.journalSubstitute.from':
    'Holds the first day of the period the substitute takes, for a vacancy.',
  'features/timetable/journal-substitute-dialog.tsx#field:timetable.journalSubstitute.until':
    'Holds the first day without the substitute, for a vacancy; empty means no end.',
  'features/timetable/journal-substitute-dialog.tsx#panel':
    'The dialog that gives one substitute every lesson of a journal over an absence or a vacancy period; each date is still checked.',
  'features/timetable/lesson-forced-delete.tsx#button:timetable.day.back':
    'Closes the history of the lesson.',
  'features/timetable/lesson-forced-delete.tsx#panel:timetable.lessonHistory.title':
    'Shows the history of one lesson: every change of teacher, room, time or cancel, who made it and when.',
  'features/timetable/load-import-page.tsx#button:people.import.reading':
    'Opens a file picker to upload a filled-in teaching load file; the server reads it and shows a preview of every row.',
  'features/timetable/load-import-page.tsx#button:people.import.template':
    'Downloads the Excel template of the teaching load for the draft.',
  'features/timetable/load-import-page.tsx#button:timetable.loadImport.confirm':
    "Adds every row of the file to the draft's teaching load; it is on only when every row is clean.",
  'features/timetable/load-import-page.tsx#column:people.import.problemsColumn':
    'Shows what is wrong with the row, or its warnings, as the server read it.',
  'features/timetable/load-import-page.tsx#column:people.import.row':
    'Shows the row number of the line in the uploaded file.',
  'features/timetable/load-import-page.tsx#column:timetable.loadImport.rowColumn':
    'Shows the class or group, subject, teacher and lessons per week as the file has them.',
  'features/timetable/load-page.tsx#button:timetable.load.add':
    'Opens the form for a new row of the teaching load.',
  'features/timetable/load-page.tsx#button:timetable.load.cancel':
    'Closes the new row form without saving.',
  'features/timetable/load-page.tsx#button:timetable.load.changeStart':
    'Opens a form to change the start date of the draft.',
  'features/timetable/load-page.tsx#button:timetable.load.dismiss':
    'Hides, after a confirmation, the list of rows a copy could not bring over; the audit log keeps them.',
  'features/timetable/load-page.tsx#button:timetable.load.newDraft':
    'Opens the form for a new draft: its year, its start date, and empty or a copy of a version.',
  'features/timetable/load-page.tsx#button:timetable.load.withdraw':
    'Opens the question to withdraw this published version before it starts; the earlier version runs again over its dates.',
  'features/timetable/load-page.tsx#column:timetable.load.blockColumn':
    'Shows, for a group row, the other groups of its block that meet at the same time.',
  'features/timetable/load-page.tsx#column:timetable.load.columns.double':
    'Shows whether double lessons are allowed for the row.',
  'features/timetable/load-page.tsx#column:timetable.load.columns.lessons':
    'Shows how many lessons a week the row has.',
  'features/timetable/load-page.tsx#column:timetable.load.columns.problems':
    'Shows the problems the row has today, such as a teacher out or a subject not in the profile.',
  'features/timetable/load-page.tsx#column:timetable.load.columns.room':
    'Shows the room or room type the row needs, or no room.',
  'features/timetable/load-page.tsx#column:timetable.load.columns.subject':
    'Shows the subject of the load row.',
  'features/timetable/load-page.tsx#column:timetable.load.columns.teacher':
    'Shows the teacher or vacancy of the load row.',
  'features/timetable/load-page.tsx#column:timetable.load.columns.unit':
    'Shows the class or group of the load row; clicking it opens the row in the side panel.',
  'features/timetable/load-page.tsx#field:timetable.load.version':
    'Chooses the timetable version whose teaching load is shown.',
  'features/timetable/load-row-form.tsx#button:timetable.load.useGroup':
    'Puts this group in place of the class, for a subject taught in groups by default.',
  'features/timetable/load-row-form.tsx#field:timetable.load.doubleLessons':
    "When ticked, the row's lessons may be placed as double lessons.",
  'features/timetable/load-row-form.tsx#field:timetable.load.lessons':
    'Holds how many lessons a week the row has.',
  'features/timetable/load-row-form.tsx#field:timetable.load.mixedBlock':
    'When ticked, the halves of a split meet in different slots and one teacher may take both halves.',
  'features/timetable/load-row-form.tsx#field:timetable.load.room':
    'Chooses a room or a room type the row needs, or no room.',
  'features/timetable/load-row-form.tsx#field:timetable.load.shortReason':
    'Holds the reason when the row has fewer lessons placed than its lessons per week on purpose.',
  'features/timetable/load-row-form.tsx#field:timetable.load.subject':
    'Chooses the subject of the row.',
  'features/timetable/load-row-form.tsx#field:timetable.load.teacher':
    'Chooses the teacher or vacancy who teaches the row.',
  'features/timetable/load-row-form.tsx#field:timetable.load.unit':
    'Chooses the class or group the row is for.',
  'features/timetable/load-row-panel.tsx#button:form.edit':
    "Opens the row's form to change its teacher, lessons per week, room and double lessons.",
  'features/timetable/load-row-panel.tsx#button:timetable.load.deleteRow':
    'Deletes the row from the draft after a confirmation; the audit log keeps a copy.',
  'features/timetable/load-row-panel.tsx#panel':
    'The side panel of a teaching load row: its fields and problems, with Edit and Delete.',
  'features/timetable/out-of-date-panel.tsx#button:timetable.outOfDate.allDraft':
    "Picks the draft's side for every difference.",
  'features/timetable/out-of-date-panel.tsx#button:timetable.outOfDate.allPublished':
    "Picks the published version's side for every difference.",
  'features/timetable/out-of-date-panel.tsx#button:timetable.outOfDate.bring':
    'Brings the draft up to date with the picks made; it is on once every difference has a pick.',
  'features/timetable/out-of-date-panel.tsx#button:timetable.outOfDate.openCheck':
    'Opens the builder step that lists the reasons the draft cannot be published now.',
  'features/timetable/out-of-date-panel.tsx#panel':
    'Shows why the draft is out of date and every difference from the published version, with a choice for each, to bring the draft up to date.',
  'features/timetable/out-of-date-panel.tsx#tab:timetable.outOfDate.pick':
    'Chooses, for this difference, whether to keep the draft or take the published version.',
  'features/timetable/pattern-import-page.tsx#button:people.import.reading':
    'Opens a file picker to upload a filled-in timetable file; the server reads it and shows a preview with problems and warnings.',
  'features/timetable/pattern-import-page.tsx#button:people.import.template':
    'Downloads the Excel template of the timetable for the draft.',
  'features/timetable/pattern-import-page.tsx#button:timetable.patternImport.confirm':
    "Places every lesson of the file in the draft, after asking to remove the draft's placed lessons; it is on only when every row is clean.",
  'features/timetable/pattern-import-page.tsx#column:people.import.problemsColumn':
    'Shows what is wrong with the row, as the server read it.',
  'features/timetable/pattern-import-page.tsx#column:people.import.row':
    'Shows the row number of the line in the uploaded file.',
  'features/timetable/pattern-import-page.tsx#column:timetable.patternImport.rowColumn':
    'Shows the weekday, lesson, class or group, subject, teacher and room as the file has them.',
  'features/timetable/pins-section.tsx#button:timetable.builder.pins.remove':
    'Removes this pin, so the lesson is no longer fixed to that time.',
  'features/timetable/pins-section.tsx#field:timetable.builder.pins.row':
    'Chooses the lesson of the load to pin to a fixed time.',
  'features/timetable/pins-section.tsx#field:timetable.builder.pins.slot':
    'Chooses the lesson slot of the weekday the lesson is pinned to.',
  'features/timetable/pins-section.tsx#field:timetable.builder.pins.weekday':
    'Chooses the weekday of the pin.',
  'features/timetable/publish-chain.tsx#field:timetable.publish.chain.title':
    'Chooses what happens to later published versions: run until the next one starts, replace them, or carry the change into them.',
  'features/timetable/publish-check-parts.tsx#button:timetable.publish.openGrid':
    'Opens the grid step of the builder to fix the blocked rule shown beside it.',
  'features/timetable/publish-day-changes.tsx#field:timetable.publish.dayChanges.exams.reason':
    'Holds the reason for the choice made for an exam that clashes with the new timetable.',
  'features/timetable/publish-day-changes.tsx#field:timetable.publish.dayChanges.substitutions.reason':
    'Holds the reason for cancelling, that day, a lesson whose substitution the new timetable no longer fits.',
  'features/timetable/publish-impact.tsx#button:timetable.publish.impact.showAll':
    'Shows every line of the changes, not only the first 20.',
  'features/timetable/publish-shortened.tsx#button:timetable.publish.shortened.remove':
    'Removes a stored choice that no longer decides anything.',
  'features/timetable/publish-shortened.tsx#button:timetable.publish.shortened.reset':
    'Removes the choice for this day, so the default lessons are kept.',
  'features/timetable/publish-shortened.tsx#button:timetable.publish.shortened.save':
    'Saves which lessons are kept on this shortened day for the class.',
  'features/timetable/publish-step.tsx#button:timetable.publish.action':
    'Publishes the draft from the start date after a confirmation; it is on only when nothing blocks the publish.',
  'features/timetable/publish-step.tsx#button:timetable.publish.defaultStart':
    'Puts the usual start date, next Monday, in the start date field.',
  'features/timetable/publish-step.tsx#button:timetable.publish.quarterStart':
    'Puts the first day of this coming quarter in the start date field.',
  'features/timetable/publish-step.tsx#field:timetable.publish.startsOn':
    'Holds the date the new version starts; the check below is made for it.',
  'features/timetable/room-closure-form.tsx#field:timetable.roomClosures.firstDay':
    'Holds the first day of the closure.',
  'features/timetable/room-closure-form.tsx#field:timetable.roomClosures.firstDay:2':
    'Holds the new first day of the closure; it can be changed only before the closure has started.',
  'features/timetable/room-closure-form.tsx#field:timetable.roomClosures.lastDay':
    'Holds the last day of the closure.',
  'features/timetable/room-closure-form.tsx#field:timetable.roomClosures.lastDay:2':
    'Holds the new last day of the closure.',
  'features/timetable/room-closure-form.tsx#field:timetable.roomClosures.moveReason':
    "Holds the reason of the one-day room changes; it starts as the closure's reason.",
  'features/timetable/room-closure-form.tsx#field:timetable.roomClosures.moveRoom':
    "Chooses the room the closed room's lessons go to for the period.",
  'features/timetable/room-closure-form.tsx#field:timetable.roomClosures.reason':
    'Holds the reason the room is closed, for example repairs.',
  'features/timetable/room-closure-form.tsx#field:timetable.roomClosures.room':
    'Chooses the room to close.',
  'features/timetable/room-closure-panel.tsx#button:timetable.roomClosures.changeDates':
    'Opens a form to change the first day (before it starts) or the last day of the closure.',
  'features/timetable/room-closure-panel.tsx#button:timetable.roomClosures.moveAll':
    'Opens a form to move every lesson of the closed room to another room for the period; nothing moves if some cannot go there.',
  'features/timetable/room-closure-panel.tsx#button:timetable.roomClosures.withdraw':
    'Withdraws the closure after a confirmation; its lessons stay in the room and it cannot be changed again.',
  'features/timetable/room-closure-panel.tsx#panel':
    "The side panel of a room closure: its details, the buttons to change, move or withdraw it, and the room's lessons inside it, marked when they need a room.",
  'features/timetable/room-closures-page.tsx#button:timetable.roomClosures.add':
    'Opens the form to close a room: the room, the first and last day and the reason.',
  'features/timetable/room-closures-page.tsx#button:timetable.roomClosures.cancel':
    'Closes the new closure form without saving.',
  'features/timetable/room-closures-page.tsx#column:timetable.roomClosures.firstDay':
    'Shows the first day of the closure.',
  'features/timetable/room-closures-page.tsx#column:timetable.roomClosures.lastDay':
    'Shows the last day of the closure.',
  'features/timetable/room-closures-page.tsx#column:timetable.roomClosures.reason':
    'Shows the reason the room is closed.',
  'features/timetable/room-closures-page.tsx#column:timetable.roomClosures.room':
    'Shows the closed room; clicking it opens the closure in the side panel.',
  'features/timetable/room-closures-page.tsx#column:timetable.roomClosures.state':
    'Shows whether the closure is planned, happening now, ended or withdrawn.',
  'features/timetable/rules-step.tsx#button:timetable.builder.rulesStep.confirm':
    'Confirms the rules, the saved preference weights and the pinned lessons, which marks this step ready.',
  'features/timetable/rules-step.tsx#field:timetable.preference.class_no_gaps':
    'Sets the weight, from 0 (not used) to 10, of the preference that a class has no empty slot between its first and last lesson; each preference has such a field.',
  'features/timetable/substitute-dialog.tsx#button:timetable.day.back':
    'Closes the dialog without saving.',
  'features/timetable/substitute-dialog.tsx#button:timetable.day.keep':
    'Closes the dialog and keeps the substitution.',
  'features/timetable/substitute-dialog.tsx#button:timetable.day.substituteSend':
    'Saves the substitute for this lesson.',
  'features/timetable/substitute-dialog.tsx#button:timetable.day.withdrawSubstitutionSend':
    'Withdraws the substitution of this lesson.',
  'features/timetable/substitute-dialog.tsx#field:timetable.day.reason':
    'Holds the reason for the substitution.',
  'features/timetable/substitute-dialog.tsx#field:timetable.day.reason:2':
    'Holds the reason for withdrawing the substitution.',
  'features/timetable/substitute-dialog.tsx#field:timetable.day.substitute':
    "Chooses the substitute from the free teachers; those who cannot teach in the class's language are listed last and marked.",
  'features/timetable/substitute-dialog.tsx#field:timetable.day.substituteConfirm':
    'A tick that confirms the warnings listed have been checked; the substitution is then saved with them.',
  'features/timetable/substitute-dialog.tsx#panel':
    'The dialogs that give one lesson a substitute teacher, or withdraw a substitution, each with a reason.',
  'features/timetable/substitute-dialog.tsx#panel:timetable.day.substituteTitle':
    'Gives this lesson a substitute: teachers free at that time are suggested, same subject first, then same department.',
  'features/timetable/substitute-dialog.tsx#panel:timetable.day.withdrawSubstitutionTitle':
    'Withdraws the substitution of this lesson, with a reason; the lesson goes back to its teacher.',
  'features/timetable/teaching-home.tsx#button:journal.open':
    "Opens the journal of this lesson for the day, switching to the lesson's branch first when needed.",
  'features/timetable/timetable-file-buttons.tsx#button:timetable.views.excel':
    'Downloads the file as an Excel workbook; the download is logged.',
  'features/timetable/timetable-file-buttons.tsx#button:timetable.views.pdf':
    'Downloads the file as a PDF; the download is logged.',
  'features/timetable/timetable-file-buttons.tsx#button:timetable.views.print':
    'Opens the file as a PDF in a new browser tab, to print it there.',
  'features/timetable/version-files.tsx#field:timetable.history.printWhat':
    'Chooses what to print or export of the version: the whole school, a class, a teacher or a room.',
  'features/timetable/version-form.tsx#button:timetable.load.quarterShortcut':
    'Puts the first day of this coming quarter in the start date field.',
  'features/timetable/version-form.tsx#field:timetable.load.copyFrom':
    'Chooses whether the new draft starts empty or as a copy of a version of the same year.',
  'features/timetable/version-form.tsx#field:timetable.load.startsOn':
    'Holds the date the new draft is meant to start; next Monday by default.',
  'features/timetable/version-form.tsx#field:timetable.load.startsOn:2':
    'Holds the new start date of the draft when changing it.',
  'features/timetable/version-form.tsx#field:timetable.load.year':
    'Chooses the academic year of the new draft.',
  'features/timetable/versions-page.tsx#button:timetable.history.restore':
    'Opens the new draft form prefilled as a copy of this version, to reopen it as a new draft.',
  'features/timetable/versions-page.tsx#column:timetable.history.columns.copiedFrom':
    'Shows the version this one was copied from, if any.',
  'features/timetable/versions-page.tsx#column:timetable.history.columns.inForce':
    'Shows the quarters on whose first day this version is in force.',
  'features/timetable/versions-page.tsx#column:timetable.history.columns.status':
    'Shows whether the version is a draft, published or withdrawn.',
  'features/timetable/versions-page.tsx#column:timetable.history.columns.validFrom':
    'Shows the date the version starts.',
  'features/timetable/versions-page.tsx#column:timetable.history.columns.version':
    'Shows the version number; clicking it opens the version in the side panel.',
  'features/timetable/versions-page.tsx#field:timetable.history.compareWith':
    'Chooses another version of the year to compare with; the changes between the two are listed.',
  'features/timetable/versions-page.tsx#field:timetable.history.year':
    'Chooses the academic year whose versions are listed.',
  'features/timetable/views-page.tsx#field:timetable.views.date':
    'Chooses the date the view shows, or the week it falls in.',
  'features/timetable/views-page.tsx#tab:timetable.views.kind':
    'Switches the timetable shown between the whole school, a class, a teacher and a room.',
  'features/timetable/views-page.tsx#tab:timetable.views.span':
    'Switches between one day and the whole week.',
  'features/timetable/withdraw-dialog.tsx#panel':
    'Asks before withdrawing a published version, listing its one-day changes as kept, needing a decision or dropped; Withdraw waits for each decision.',
};
