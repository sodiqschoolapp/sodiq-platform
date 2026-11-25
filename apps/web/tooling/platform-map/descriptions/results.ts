/** Task 11.19: the descriptions of the map of the platform, results. */
export const DESCRIPTIONS: Readonly<Record<string, string>> = {
  'features/results/attendance-report-page.tsx#column:results.reports.attendance.daily':
    'The daily attendance percent of the line over the chosen range.',
  'features/results/attendance-report-page.tsx#column:results.reports.attendance.date':
    'The day of the line, when one class is chosen and the report lists its days.',
  'features/results/attendance-report-page.tsx#column:results.reports.attendance.exempt':
    'How many expected cells were marked exempt, with their share; exempt is counted apart from the other marks.',
  'features/results/attendance-report-page.tsx#column:results.reports.attendance.expected':
    'How many attendance cells were expected in the range, the total the shares are taken from.',
  'features/results/attendance-report-page.tsx#field:results.reports.attendance.class':
    'Narrows the report to one class; with a class chosen, the report lists one line per day.',
  'features/results/attendance-report-page.tsx#field:results.reports.attendance.grade':
    'Narrows the report to one grade, or shows all grades.',
  'features/results/attendance-report-page.tsx#field:results.reports.attendance.period':
    'Narrows the report to the lessons that start at one time of day, or shows all periods.',
  'features/results/attendance-report-page.tsx#field:results.reports.attendance.subject':
    'Narrows the report to the lessons of one subject, or shows all subjects.',
  'features/results/attendance-report-page.tsx#field:results.reports.attendance.teacher':
    'Narrows the report to the lessons of one teacher, or shows all teachers.',
  'features/results/attendance-report-page.tsx#field:results.reports.from':
    'The first day of the range the report counts; it defaults to the Monday of this week.',
  'features/results/attendance-report-page.tsx#field:results.reports.to':
    'The last day of the range the report counts; it defaults to today.',
  'features/results/attendance-report-page.tsx#tab:results.reports.attendance.groupBy':
    'Switches the lines between one per class and one per Tutor or Class teacher.',
  'features/results/close-quarter-dialog.tsx#button:results.closing.close.action':
    'Closes the quarter once every point is ticked or chosen; the results are stored as final.',
  'features/results/close-quarter-dialog.tsx#button:results.closing.close.back':
    'Closes the dialog without closing the quarter.',
  'features/results/close-quarter-dialog.tsx#field:results.closing.close.startQuarter':
    "For the branch's start quarter: whether the platform results are kept as the quarter results or the quarter is not official and left out of the year result.",
  'features/results/close-quarter-dialog.tsx#panel':
    'The dialog that closes the chosen quarter once nothing blocks it.',
  'features/results/close-quarter-dialog.tsx#panel:results.closing.close.title':
    'Closes the quarter: its journals become read only for the branch and every result is stored as final. Warnings must be acknowledged first, and lock now ticked when lessons are still open.',
  'features/results/closing-page.tsx#button:results.closing.clear':
    "Clears the decision stored for this student's flagged result.",
  'features/results/closing-page.tsx#button:results.closing.clear:2':
    'Clears the outdated decisions of every flagged student of the journal at once.',
  'features/results/closing-page.tsx#button:results.closing.closeQuarter':
    'Opens the dialog to close the quarter; it is available only when nothing blocks closing.',
  'features/results/closing-page.tsx#button:results.closing.decisions.exempt':
    'Decides one flagged result of a student: keep the number, exempt, or not assessed (one button for each).',
  'features/results/closing-page.tsx#button:results.closing.decisions.exempt:2':
    'Applies one decision, keep the number, exempt or not assessed, to every flagged student of the journal at once.',
  'features/results/closing-page.tsx#button:results.closing.endPeriods':
    'Ends every open plan editing period of the quarter, after a confirmation listing the journals.',
  'features/results/closing-page.tsx#button:results.closing.remind':
    'Sends a reminder to the teachers who still have items to finish in the quarter.',
  'features/results/closing-page.tsx#button:results.reopening.action':
    'Opens the dialog to reopen the closed quarter, for the whole branch or one journal.',
  'features/results/closing-page.tsx#column:results.closing.count':
    'How many lessons, students or other entries the item counts.',
  'features/results/closing-page.tsx#column:results.closing.item':
    "What is left to finish in the quarter, such as lessons with no attendance; pressing it opens the item's details in the side panel.",
  'features/results/closing-page.tsx#column:results.closing.severity':
    'What the item does to the close: blocks closing, is locked when the quarter closes, or is a warning.',
  'features/results/closing-page.tsx#column:results.closing.subject':
    'The subject of the journal the item concerns.',
  'features/results/closing-page.tsx#column:results.closing.teacher':
    'The teacher the item concerns.',
  'features/results/closing-page.tsx#column:results.closing.unit':
    'The class or group of the journal the item concerns.',
  'features/results/closing-page.tsx#field:results.closing.quarter':
    'Chooses the quarter whose closing checklist is shown.',
  'features/results/early-warning-page.tsx#button:results.earlyWarning.handle':
    'Marks the chosen reason handled and stores the note with it.',
  'features/results/early-warning-page.tsx#column:results.earlyWarning.attendance':
    "The student's attendance percent in the subject.",
  'features/results/early-warning-page.tsx#column:results.earlyWarning.reasons':
    'Why the student is listed, with the figure and the threshold: low result, result dropped, low attendance or absences in a row.',
  'features/results/early-warning-page.tsx#column:results.earlyWarning.result':
    "The student's current result in the subject.",
  'features/results/early-warning-page.tsx#column:results.earlyWarning.student':
    'The student who needs attention; pressing it opens the reasons, figures and trend in the side panel.',
  'features/results/early-warning-page.tsx#column:results.earlyWarning.subject':
    'The subject the warning is about.',
  'features/results/early-warning-page.tsx#column:results.earlyWarning.unit':
    "The class or group of the subject's journal.",
  'features/results/early-warning-page.tsx#field:results.earlyWarning.note':
    'A note for staff only on what was done about the warning.',
  'features/results/early-warning-page.tsx#field:results.earlyWarning.quarter':
    'Chooses the quarter whose early-warning list is shown.',
  'features/results/early-warning-page.tsx#field:results.earlyWarning.which':
    'The reason to mark handled, when the student is listed for more than one.',
  'features/results/load-report-page.tsx#tab:results.reports.links.load':
    'Switches the timetable load report between teachers, classes, rooms and free periods.',
  'features/results/rating-page.tsx#button:results.ratingList.excel':
    'Downloads the rating list shown as an Excel file.',
  'features/results/rating-page.tsx#column:results.ratingList.class': 'The class ranked.',
  'features/results/rating-page.tsx#column:results.ratingList.figure':
    "The student's result in the subject, with one decimal, or the state of a result that is not a number.",
  'features/results/rating-page.tsx#column:results.ratingList.figure:2':
    "The student's result across all subjects of the class, with one decimal.",
  'features/results/rating-page.tsx#column:results.ratingList.figure:3':
    "The class's result, with one decimal.",
  'features/results/rating-page.tsx#column:results.ratingList.note':
    "Notes on the student's result, such as few lessons, attendance only, or left the subject on a date.",
  'features/results/rating-page.tsx#column:results.ratingList.place':
    'The place in the rating list.',
  'features/results/rating-page.tsx#column:results.ratingList.student': 'The student ranked.',
  'features/results/rating-page.tsx#column:results.ratingList.students':
    'How many students of the class are counted.',
  'features/results/rating-page.tsx#column:results.ratingList.subjects':
    "How many subjects the student's result counts, marked when fewer than the class has.",
  'features/results/rating-page.tsx#field:results.ratingList.class':
    'Chooses the class whose students are ranked across all subjects.',
  'features/results/rating-page.tsx#field:results.ratingList.grade':
    'Narrows the rating of classes to one grade, or ranks the classes of all grades.',
  'features/results/rating-page.tsx#field:results.ratingList.journal':
    'Chooses the subject and the class or group whose students are ranked.',
  'features/results/rating-page.tsx#field:results.ratingList.language':
    'Narrows the lists and choices to one language of instruction, or shows all.',
  'features/results/rating-page.tsx#field:results.ratingList.quarter':
    "Chooses the quarter of the rating; an open quarter's list is provisional.",
  'features/results/rating-page.tsx#field:results.ratingList.year':
    'Chooses the academic year of the rating.',
  'features/results/rating-page.tsx#tab:results.ratingList.kind':
    'Switches between the rating in one subject, the rating of a class across subjects, and the rating of classes.',
  'features/results/reopening.tsx#button:results.closing.close.back':
    'Closes the dialog without changing anything.',
  'features/results/reopening.tsx#button:results.recalculation.apply':
    'Opens the dialog to apply the recalculated results with a reason.',
  'features/results/reopening.tsx#button:results.recalculation.apply:2':
    'Applies the recalculated results with the reason typed and closes the dialog.',
  'features/results/reopening.tsx#button:results.recalculation.compare':
    "Recalculates the closed quarter's results and lists those that differ from the stored ones.",
  'features/results/reopening.tsx#button:results.reopening.action':
    'Reopens the quarter as chosen; the stored results are kept as a version.',
  'features/results/reopening.tsx#button:results.reopening.closeAgain':
    'Opens the dialog to close the reopened journal again; it is available once nothing blocks it.',
  'features/results/reopening.tsx#button:results.reopening.closeAgain:2':
    'Closes the reopened journal again once its warnings are acknowledged, storing the changed results as a new version.',
  'features/results/reopening.tsx#field:results.reopening.days':
    'For how many days the quarter stays reopened, from 1 to 14.',
  'features/results/reopening.tsx#field:results.reopening.reason':
    'Why the quarter is reopened; required and stored with the reopening.',
  'features/results/reopening.tsx#field:results.reopening.reason:2':
    'Why the recalculated results are applied; required.',
  'features/results/reopening.tsx#field:results.reopening.what':
    'What to reopen: the whole branch or one closed journal.',
  'features/results/reopening.tsx#panel:results.recalculation.applyTitle':
    'The dialog for replacing stored results with the recalculated ones, with a reason.',
  'features/results/reopening.tsx#panel:results.reopening.closeAgainTitle':
    'The dialog for closing a reopened journal again, with the count of results that changed.',
  'features/results/reopening.tsx#panel:results.reopening.title':
    'The dialog for reopening a closed quarter for a number of days, for the whole branch or one journal, with a reason.',
  'features/results/report-parts.tsx#button:results.reports.excel':
    'Downloads the report shown, with its filters, as an Excel file.',
  'features/results/result-lessons-dialog.tsx#button:app.close': 'Closes the lessons dialog.',
  'features/results/result-lessons-dialog.tsx#panel':
    "The dialog that shows the lessons behind a figure of a student's results or attendance.",
  'features/results/result-lessons-dialog.tsx#panel:results.lessonsTitle':
    "Lists the student's counted lessons of the subject in the quarter, with the attendance mark and the works behind the figure.",
  'features/results/results-table-page.tsx#column:results.reports.table.student':
    'The student of the line; each subject column beside it shows the result and grade, or its state.',
  'features/results/results-table-page.tsx#field:results.reports.quarter':
    'Chooses the quarter whose results are shown.',
  'features/results/results-table-page.tsx#field:results.reports.table.class':
    'Chooses the class whose students are listed.',
  'features/results/student-attendance-tab.tsx#button:results.openLessons':
    "Opens the lessons behind the student's attendance figure in the subject.",
  'features/results/student-attendance-tab.tsx#tab:results.quarter':
    "Switches the student's attendance to another quarter.",
  'features/results/student-results-tab.tsx#tab:results.quarter':
    "Switches the student's results to another quarter.",
  'features/results/subject-mastery-page.tsx#column:results.reports.mastery.band':
    'The range of results that falls in the band.',
  'features/results/subject-mastery-page.tsx#column:results.reports.mastery.mark':
    'The grade band, or a state counted beside the bands: exempt, not assessed or no result.',
  'features/results/subject-mastery-page.tsx#column:results.reports.mastery.percent':
    'The share of the students that falls in the band.',
  'features/results/subject-mastery-page.tsx#column:results.reports.mastery.students':
    'How many students fall in the band.',
  'features/results/subject-mastery-page.tsx#field:results.reports.mastery.class':
    'Narrows the count to one class, or counts all classes.',
  'features/results/subject-mastery-page.tsx#field:results.reports.mastery.grade':
    'Narrows the count to one grade, or counts all grades.',
  'features/results/subject-mastery-page.tsx#field:results.reports.mastery.subject':
    'Chooses the subject whose grade bands are shown.',
  'features/results/subject-mastery-page.tsx#field:results.reports.mastery.teacher':
    "Narrows the count to one teacher's students, or counts all teachers.",
  'features/results/subject-mastery-page.tsx#field:results.reports.quarter':
    'Chooses the quarter whose results are counted.',
};
