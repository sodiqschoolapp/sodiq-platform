/** Task 11.19: the descriptions of the map of the platform, journal. */
export const DESCRIPTIONS: Readonly<Record<string, string>> = {
  'features/journal/branch-exports-page.tsx#button:journal.exports.ask':
    "Asks for an export of all the branch's journals in the chosen format and period; it is prepared in the background and appears in the list below.",
  'features/journal/branch-exports-page.tsx#button:journal.exports.download':
    'Downloads the ready export file; access is checked again and an expired link is refused.',
  'features/journal/branch-exports-page.tsx#button:journal.exports.refresh':
    'Reads the list of exports again, to see whether a prepared export is ready.',
  'features/journal/branch-exports-page.tsx#column:journal.exports.asOf':
    "Shows the moment the export's data was taken from; every journal in the file is as it stood then.",
  'features/journal/branch-exports-page.tsx#column:journal.exports.file':
    'Holds the Download button once the export is ready.',
  'features/journal/branch-exports-page.tsx#column:journal.exports.format':
    'Shows the file format of the export: Excel or PDF.',
  'features/journal/branch-exports-page.tsx#column:journal.exports.period':
    'Shows the quarter the export covers, and the month when only one month was asked for.',
  'features/journal/branch-exports-page.tsx#column:journal.exports.requested':
    'Shows when the export was asked for.',
  'features/journal/branch-exports-page.tsx#column:journal.exports.status':
    'Shows whether the export is waiting, being prepared, ready (with the time its link stops working) or failed, with the cause.',
  'features/journal/branch-exports-page.tsx#field:journal.exports.month':
    'Chooses one month of the quarter, or the whole quarter, for the export.',
  'features/journal/branch-exports-page.tsx#field:journal.exports.quarter':
    'Chooses the quarter whose journals the export holds.',
  'features/journal/branch-exports-page.tsx#tab:journal.exports.format':
    'Chooses the format of the export to ask for: Excel or PDF.',
  'features/journal/cell-saves.tsx#button:journal.saving.keepStored':
    'Keeps the value someone else saved and drops yours; nothing is sent.',
  'features/journal/cell-saves.tsx#button:journal.saving.retry':
    'Sends again every journal cell that could not be saved.',
  'features/journal/cell-saves.tsx#button:journal.saving.useMine':
    'Saves your typed value over the newer saved one.',
  'features/journal/cell-saves.tsx#panel:journal.saving.staleTitle':
    'Appears when a cell you typed was changed by someone else meanwhile; it shows the saved value, who saved it and when, beside your value, so you choose which stays.',
  'features/journal/discipline-items-dialog.tsx#button:app.close':
    'Closes the list and goes back to the report.',
  'features/journal/discipline-items-dialog.tsx#panel':
    'The list behind one count of a teacher on the journal discipline report: the lessons, or works and rating exam entries, with the date, the class and subject, and how many of the count each holds.',
  'features/journal/discipline-items-dialog.tsx#panel:journal.discipline.itemsTitle':
    'Lists what one count of a teacher stands for: each lesson or rating exam behind it, with its date and time, class or group, subject and count.',
  'features/journal/discipline-page.tsx#button:journal.discipline.showItems':
    'Opens the list of lessons or works behind this count of the teacher.',
  'features/journal/discipline-page.tsx#column:journal.discipline.teacher':
    'Shows the teacher whose lessons the counts of the row are about.',
  'features/journal/discipline-page.tsx#column:journal.discipline.unplanned':
    "Shows a count of the teacher's lessons in the range (held, nothing entered, in progress, complete, locked incomplete, no attendance, no topic, works missing scores, unplanned works, late entries); a count above zero opens its list.",
  'features/journal/discipline-page.tsx#field:journal.discipline.department':
    'Limits the report to the teachers of one department, or shows all departments.',
  'features/journal/discipline-page.tsx#field:journal.discipline.from':
    "Sets the first day of the range the counts cover; the range starts on this week's Monday by default.",
  'features/journal/discipline-page.tsx#field:journal.discipline.to':
    'Sets the last day of the range the counts cover; today by default.',
  'features/journal/edit-period.tsx#button:journal.locks.approve':
    'Sends the decision: approves the unlock for the chosen days, or, when Refuse is chosen, refuses it with the reason.',
  'features/journal/edit-period.tsx#button:journal.locks.back':
    'Closes the dialog without sending; the typed reason is kept for the next time it is opened.',
  'features/journal/edit-period.tsx#button:journal.locks.correct':
    'Asks for a reason, then opens this locked lesson or rating exam for a correction; every save of it carries that reason.',
  'features/journal/edit-period.tsx#button:journal.locks.hideLocked':
    'Hides again the locked lessons that need nothing now, leaving the ones with a request, an unlock running or entries missing; when hidden it shows them.',
  'features/journal/edit-period.tsx#button:journal.locks.request':
    'Opens a dialog to ask for this locked lesson or rating exam to be unlocked, with a reason; the request waits for a decision.',
  'features/journal/edit-period.tsx#button:journal.locks.stopCorrecting':
    'Ends the correction under way; the corrected lesson is locked for entry again.',
  'features/journal/edit-period.tsx#button:journal.locks.withdraw':
    'Withdraws your waiting unlock request for this lesson.',
  'features/journal/edit-period.tsx#field:journal.locks.days':
    'Chooses for how many days, 1 to 7, the lesson stays unlocked once approved.',
  'features/journal/edit-period.tsx#field:journal.locks.decision':
    'Chooses whether to approve or refuse the unlock request.',
  'features/journal/edit-period.tsx#field:journal.locks.refuseReason':
    'Holds the optional reason of the refusal, which the teacher sees.',
  'features/journal/edit-period.tsx#panel:journal.locks.decideTitle':
    "Decides a teacher's request to unlock a locked lesson or rating exam: approve it for 1 to 7 days, or refuse it with an optional reason.",
  'features/journal/exemptions-page.tsx#button:journal.exemptions.attachDocument':
    'Opens a file picker to attach a supporting document to the exemption.',
  'features/journal/exemptions-page.tsx#button:journal.exemptions.back':
    'Closes the dialog without saving.',
  'features/journal/exemptions-page.tsx#button:journal.exemptions.check':
    'Checks the change and lists the held lessons it touches, asking where a mark exists whether to keep it or exempt and clear it; pressed again, it saves.',
  'features/journal/exemptions-page.tsx#button:journal.exemptions.check:2':
    'Checks the end or void and lists the lessons it reopens or changes; pressed again, it applies the change.',
  'features/journal/exemptions-page.tsx#button:journal.exemptions.check:3':
    'Checks the offered exemption and lists the lessons it touches here; pressed again, it grants the exemption in this branch.',
  'features/journal/exemptions-page.tsx#button:journal.exemptions.close':
    'Closes the form after the exemptions are saved.',
  'features/journal/exemptions-page.tsx#button:journal.exemptions.createFrom':
    'Opens the new exemption form for this student, starting on the day of the absence.',
  'features/journal/exemptions-page.tsx#button:journal.exemptions.drop':
    'Drops the exemption offered by the move, after a confirmation; it is not applied in this branch.',
  'features/journal/exemptions-page.tsx#button:journal.exemptions.end':
    'Opens a dialog to end the exemption from a chosen last day, showing first which lessons change.',
  'features/journal/exemptions-page.tsx#button:journal.exemptions.new':
    'Opens the form to enter a new exemption for one or more students of a class.',
  'features/journal/exemptions-page.tsx#button:journal.exemptions.openDocument':
    'Downloads the document attached to the exemption.',
  'features/journal/exemptions-page.tsx#button:journal.exemptions.removeDocument':
    'Removes the attached document after a confirmation.',
  'features/journal/exemptions-page.tsx#button:journal.exemptions.showReason':
    "Shows the written detail of the exemption's reason; opening it is recorded.",
  'features/journal/exemptions-page.tsx#button:journal.exemptions.showReason:2':
    'Shows the written detail of the reason of the exemption offered by the move.',
  'features/journal/exemptions-page.tsx#button:journal.exemptions.void':
    'Opens a dialog to void this exemption as entered in error, with a reason; the cleared values come back.',
  'features/journal/exemptions-page.tsx#button:journal.exemptions.voidBatch':
    'Opens a dialog to void every exemption entered together with this one, with a reason.',
  'features/journal/exemptions-page.tsx#column:journal.exemptions.absenceReason':
    'Shows the reason the Tutor gave for the absence.',
  'features/journal/exemptions-page.tsx#column:journal.exemptions.category':
    'Shows the reason category: illness, competition, family, school event or other.',
  'features/journal/exemptions-page.tsx#column:journal.exemptions.class':
    "Shows the student's class.",
  'features/journal/exemptions-page.tsx#column:journal.exemptions.date':
    'Shows the day the student was absent.',
  'features/journal/exemptions-page.tsx#column:journal.exemptions.dates':
    'Shows the days the exemption covers, or one day with its time slots.',
  'features/journal/exemptions-page.tsx#column:journal.exemptions.decision':
    'Shows whether the offered exemption is waiting, confirmed or dropped.',
  'features/journal/exemptions-page.tsx#column:journal.exemptions.fromBranch':
    'Shows the branch the student moved from, where the exemption was granted.',
  'features/journal/exemptions-page.tsx#column:journal.exemptions.kind':
    'Shows whether the exemption is temporary (from a date to a date) or full (from a date to the end of the academic year).',
  'features/journal/exemptions-page.tsx#column:journal.exemptions.scope':
    'Shows the subjects exempted, or all subjects.',
  'features/journal/exemptions-page.tsx#column:journal.exemptions.state':
    'Shows whether the exemption is coming, in force, ending this week, ended or voided.',
  'features/journal/exemptions-page.tsx#column:journal.exemptions.student':
    "Shows the exempted student; pressing the row opens the exemption's detail.",
  'features/journal/exemptions-page.tsx#field:journal.exemptions.category':
    'Chooses the reason category of the exemption.',
  'features/journal/exemptions-page.tsx#field:journal.exemptions.class':
    'Chooses the class whose students are exempted; it lists them to tick.',
  'features/journal/exemptions-page.tsx#field:journal.exemptions.days':
    'Chooses whole days, or chosen time slots of a single day.',
  'features/journal/exemptions-page.tsx#field:journal.exemptions.detail':
    'Holds the written detail of the reason; it is shown only when someone opens it.',
  'features/journal/exemptions-page.tsx#field:journal.exemptions.endDate':
    'Sets the last day of a temporary exemption.',
  'features/journal/exemptions-page.tsx#field:journal.exemptions.endDate:2':
    'Sets the new last day of the exemption when it is ended from a date.',
  'features/journal/exemptions-page.tsx#field:journal.exemptions.kind':
    'Chooses a temporary exemption, from a date to a date, or a full one, from a date to the end of the academic year.',
  'features/journal/exemptions-page.tsx#field:journal.exemptions.scope':
    'Chooses whether all subjects are exempted or only chosen ones.',
  'features/journal/exemptions-page.tsx#field:journal.exemptions.slotEnd':
    'Sets the time the exemption ends on its day.',
  'features/journal/exemptions-page.tsx#field:journal.exemptions.slotStart':
    'Sets the time the exemption starts on its day.',
  'features/journal/exemptions-page.tsx#field:journal.exemptions.startDate':
    'Sets the first day of the exemption, or its only day for time slots.',
  'features/journal/exemptions-page.tsx#field:journal.exemptions.students':
    'Ticks the students of the class who get the exemption.',
  'features/journal/exemptions-page.tsx#field:journal.exemptions.subjects':
    'Ticks the subjects the exemption covers.',
  'features/journal/exemptions-page.tsx#field:journal.exemptions.voidReason':
    'Holds why the exemption is voided as entered in error.',
  'features/journal/exemptions-page.tsx#panel:journal.exemptions.new':
    'The form of a new exemption: the class and students, kind, subjects, days or time slots, reason and detail; Check shows the lessons it changes before it is saved.',
  'features/journal/exemptions-page.tsx#panel:journal.exemptions.void':
    'The dialog that ends, voids or voids the whole batch of an exemption: a last day or a reason, a check of the lessons it touches, then the change.',
  'features/journal/exemptions-page.tsx#tab:journal.exemptions.views':
    "Switches between the list of exemptions, absences with a Tutor's reason and no exemption, and exemptions offered by a student's move from another branch.",
  'features/journal/journal-grid.tsx#button:journal.grid.exemptSection':
    'Opens or folds the section at the bottom of the grid that lists the students exempt from the subject.',
  'features/journal/journal-grid.tsx#column:journal.grid.attendanceShort':
    "The attendance column of a lesson: each student's mark (present, late, absent, missed the lesson or exempt); its header shows the lock and offers All present.",
  'features/journal/journal-grid.tsx#column:journal.grid.grade':
    "Shows the grade that the student's result gives.",
  'features/journal/journal-grid.tsx#column:journal.grid.monthResult':
    "Shows the student's result for the chosen period (the month without the rating exam, or the quarter), worked out by the platform, with signs for provisional, partial or carried-in results.",
  'features/journal/journal-grid.tsx#column:journal.grid.number':
    "Shows the student's number in the list of the class or group.",
  'features/journal/journal-grid.tsx#column:journal.grid.photo':
    "Shows the student's photo, or initials; pressing a photo opens it larger.",
  'features/journal/journal-grid.tsx#column:journal.grid.student':
    "Shows the student's name, with any exemption beside it, and the class or group average on the bottom row.",
  'features/journal/journal-grid.tsx#column:journal.grid.uid': "Shows the student's unique ID.",
  'features/journal/journal-grid.tsx#column:journal.works.unplanned':
    "A classwork or homework column added at the lesson rather than taken from the lesson plan; it holds each student's score out of the work's total.",
  'features/journal/journal-page.tsx#button:journal.editor.open':
    "Opens the lesson's editor, to change its topic, works and their totals.",
  'features/journal/journal-page.tsx#button:journal.entry.allPresent':
    'Marks every student without a mark present at this lesson.',
  'features/journal/journal-page.tsx#button:journal.entry.markButton':
    'Sets this attendance mark for the student at the lesson; pressing the chosen mark again clears it.',
  'features/journal/journal-page.tsx#button:journal.grid.attendance':
    'Shows the attendance column of the lesson in lesson mode, to mark each student.',
  'features/journal/journal-page.tsx#button:journal.lessonMode.next':
    'Goes on to the next column of the lesson, the next classwork or homework.',
  'features/journal/journal-page.tsx#button:journal.lessonMode.nextLesson':
    'Moves lesson mode to the lesson after.',
  'features/journal/journal-page.tsx#button:journal.lessonMode.previousLesson':
    'Moves lesson mode to the lesson before.',
  'features/journal/journal-page.tsx#button:journal.page.exitFullScreen':
    'Returns the journal grid from full screen to the page.',
  'features/journal/journal-page.tsx#button:journal.page.fullScreen':
    'Shows the journal grid over the whole screen.',
  'features/journal/journal-page.tsx#button:journal.saving.undoHint':
    'Undoes your last action on this journal page, such as a mark or a score entered.',
  'features/journal/journal-page.tsx#button:list.columns':
    'Opens a menu to show or hide columns of the journal grid; the choice is remembered on this device.',
  'features/journal/journal-page.tsx#field:journal.page.class':
    'Switches to the journal of another class or group with the same subject.',
  'features/journal/journal-page.tsx#field:journal.page.filter':
    'Shows all students, only current members, those who left or moved, or those with an empty cell.',
  'features/journal/journal-page.tsx#field:journal.page.month':
    'Shows one month of the quarter, with the month result, or the whole quarter.',
  'features/journal/journal-page.tsx#field:journal.page.quarter':
    'Chooses the quarter whose lessons the journal shows.',
  'features/journal/journal-page.tsx#field:journal.page.search':
    'Finds students in the journal by name.',
  'features/journal/journal-page.tsx#field:journal.page.subject':
    'Switches to the journal of another subject of the same class or group.',
  'features/journal/journal-page.tsx#field:journal.page.year':
    "Chooses another academic year; it opens that year's list of journals.",
  'features/journal/journal-page.tsx#tab:journal.page.mode':
    'Switches between the grid of all lessons and lesson mode, which shows one lesson and one column at a time.',
  'features/journal/journals-page.tsx#column:journal.page.class':
    'Shows the class or group of the journal; pressing the row opens the journal.',
  'features/journal/journals-page.tsx#column:journal.page.subject':
    'Shows the subject of the journal.',
  'features/journal/journals-page.tsx#field:journal.page.year':
    'Chooses the academic year whose journals are listed.',
  'features/journal/journals-page.tsx#tab:journal.page.tabs':
    'Switches the list between the journals of classes and those of groups.',
  'features/journal/lesson-mode-score.tsx#button:journal.notGraded.typeFor':
    "Sets the student's cell of this work to not graded (-); pressing it again clears it.",
  'features/journal/orphans-page.tsx#button:journal.orphans.withdraw':
    'Withdraws the assignment of the teacher completing this lesson, after a confirmation.',
  'features/journal/orphans-page.tsx#column:journal.orphans.assignment':
    'Shows the teacher assigned to complete the lesson and until when it is open to them.',
  'features/journal/orphans-page.tsx#column:journal.orphans.lesson':
    'Shows the incomplete lesson left by a teacher who left; pressing the row opens it to assign a teacher.',
  'features/journal/orphans-page.tsx#column:journal.orphans.status':
    "Shows how far the lesson's entries got, such as nothing entered or in progress.",
  'features/journal/orphans-page.tsx#column:journal.orphans.teacher':
    'Shows the teacher who left with the lesson incomplete.',
  'features/journal/orphans-page.tsx#field:journal.orphans.days':
    'Chooses for how many days, 1 to 7, the lesson stays open to the assigned teacher.',
  'features/journal/orphans-page.tsx#field:journal.orphans.reason':
    'Holds the reason of the assignment; it is required.',
  'features/journal/orphans-page.tsx#field:journal.orphans.teacherField':
    'Chooses the teacher who completes the orphan lesson.',
  'features/journal/reminders-panel.tsx#panel':
    'Lists what needs doing in the journals: lessons with no attendance, planned works with numbers missing, lessons with no topic, rating exam scores missing and lessons about to lock; each item opens its journal.',
  'features/journal/student-absences-page.tsx#button:journal.absences.clear':
    'Clears the reason of the absence after a confirmation.',
  'features/journal/student-absences-page.tsx#button:journal.absences.file.attach':
    'Opens a file picker to attach a file, such as a medical certificate, to the reason.',
  'features/journal/student-absences-page.tsx#button:journal.absences.file.open':
    'Downloads the file attached to the reason, such as a medical certificate.',
  'features/journal/student-absences-page.tsx#button:journal.absences.file.remove':
    'Removes the attached file after a confirmation.',
  'features/journal/student-absences-page.tsx#button:journal.absences.setReason':
    "Opens the form to set or change the reason of the student's absence that day.",
  'features/journal/student-absences-page.tsx#column:journal.absences.atSchoolEarlier':
    'Shows whether the student was marked at school at an earlier lesson that day.',
  'features/journal/student-absences-page.tsx#column:journal.absences.category':
    'Shows the reason category given for the absence, or none.',
  'features/journal/student-absences-page.tsx#column:journal.absences.date':
    'Shows the day of the absence.',
  'features/journal/student-absences-page.tsx#column:journal.absences.lessons':
    'Lists the lessons the student missed that day, with the time, the subject and the mark.',
  'features/journal/student-absences-page.tsx#column:journal.absences.note':
    'Shows the note written with the reason.',
  'features/journal/student-absences-page.tsx#column:journal.absences.student':
    'Shows the absent student; pressing the row opens the day with its reason.',
  'features/journal/student-absences-page.tsx#field:journal.absences.category':
    'Chooses the reason category of the absence.',
  'features/journal/student-absences-page.tsx#field:journal.absences.class':
    'Chooses the class whose absences are listed.',
  'features/journal/student-absences-page.tsx#field:journal.absences.from':
    'Sets the first day of the range listed (at most 31 days).',
  'features/journal/student-absences-page.tsx#field:journal.absences.note':
    'Holds a short note about the reason.',
  'features/journal/student-absences-page.tsx#field:journal.absences.to':
    'Sets the last day of the range listed.',
  'features/journal/student-photo.tsx#button:journal.entry.close': 'Closes the photo.',
  'features/journal/student-photo.tsx#button:journal.grid.photoOpen':
    "Opens the student's photo larger in a dialog.",
  'features/journal/support-page.tsx#field:journal.support.date':
    'Chooses the day whose lesson entries are shown.',
  'features/journal/support-page.tsx#field:journal.support.journal':
    'Chooses the journal to look into.',
  'features/journal/support-page.tsx#field:journal.support.student':
    'Chooses the student whose cells and their full history are shown.',
  'features/journal/unlock-requests-page.tsx#button:journal.unlocks.decide':
    'Opens the dialog to approve the unlock for some days or refuse it.',
  'features/journal/unlock-requests-page.tsx#button:journal.unlocks.openJournal':
    'Opens the journal of the request at its quarter.',
  'features/journal/unlock-requests-page.tsx#button:journal.unlocks.withdraw':
    'Withdraws your waiting unlock request.',
  'features/journal/unlock-requests-page.tsx#column:journal.unlocks.person':
    'Shows the teacher who asked for the unlock.',
  'features/journal/unlock-requests-page.tsx#column:journal.unlocks.statusLabel':
    'Shows whether the request is waiting, approved, refused, withdrawn or cancelled.',
  'features/journal/unlock-requests-page.tsx#column:journal.unlocks.subject':
    'Shows the subject of the journal.',
  'features/journal/unlock-requests-page.tsx#column:journal.unlocks.unit':
    'Shows the class or group of the journal.',
  'features/journal/unlock-requests-page.tsx#column:journal.unlocks.what':
    'Shows the locked lesson or rating exam the request is for; pressing the row opens the request.',
  'features/journal/unlock-requests-page.tsx#field:journal.unlocks.days':
    'Chooses for how many days those lessons stay open for entry.',
  'features/journal/unlock-requests-page.tsx#field:journal.unlocks.fromDate':
    'Sets the first lesson day whose edit period is extended for the whole branch.',
  'features/journal/unlock-requests-page.tsx#field:journal.unlocks.reason':
    'Holds the reason of the branch-wide extension; it is required and logged.',
  'features/journal/unlock-requests-page.tsx#field:journal.unlocks.toDate':
    'Sets the last lesson day whose edit period is extended.',
  'features/journal/unlock-requests-page.tsx#tab:journal.unlocks.tabs':
    "Switches between the requests waiting for your decision, your own requests and all the branch's requests.",
};
