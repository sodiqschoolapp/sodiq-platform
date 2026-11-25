/** Task 11.19: the descriptions of the map of the platform, people. */
export const DESCRIPTIONS: Readonly<Record<string, string>> = {
  'features/people/account-access-section.tsx#button:confirm.cancel':
    'Closes the lock dialog without locking the account.',
  'features/people/account-access-section.tsx#button:people.access.lock':
    'Opens a dialog that asks for the reason and then locks the account, so the person can no longer sign in.',
  'features/people/account-access-section.tsx#button:people.access.lock:2':
    'Locks the account with the reason typed; the person can no longer sign in until it is unlocked.',
  'features/people/account-access-section.tsx#button:people.access.resetPassword':
    'Resets the password after a confirmation: all sessions end and a slip with a one-time password valid for 24 hours is shown to print.',
  'features/people/account-access-section.tsx#button:people.access.resetSecondStep':
    'Removes the two-step sign-in and its recovery codes and resets the password after a confirmation; a one-time password slip is shown and the person sets up the second step again.',
  'features/people/account-access-section.tsx#button:people.access.unlock':
    'Unlocks the account after a confirmation, so the person can sign in again.',
  'features/people/account-access-section.tsx#field:people.access.reason':
    'Holds why the account is locked, in at most 500 characters; the reason is shown with the lock.',
  'features/people/account-access-section.tsx#panel:people.access.lockTitle':
    "The dialog for locking a staff member's account, with the reason of the lock.",
  'features/people/account-section.tsx#button:people.account.changeSubjectsOf':
    'Opens a form to change the subjects this role oversees, from a chosen date.',
  'features/people/account-section.tsx#button:people.account.chooseAll':
    'Ticks every subject in the list.',
  'features/people/account-section.tsx#button:people.account.create':
    'Opens the form to create a sign-in account for this staff record; after saving, a first-password slip is shown to print.',
  'features/people/account-section.tsx#button:people.account.endOf':
    'Opens a form to end this role from a chosen date; after a confirmation the role ends on that date.',
  'features/people/account-section.tsx#button:people.account.give':
    'Opens the form to give the account a new role, with its branch, start date and, for a Head Teacher, its subjects.',
  'features/people/account-section.tsx#button:people.account.linkOwn':
    'Links this staff record to your own account after a confirmation; your name and photo then come from this record. The link cannot be undone.',
  'features/people/account-section.tsx#button:people.account.retry':
    'Reads the list of subjects again after it failed to load.',
  'features/people/account-section.tsx#field:people.account.branch':
    'The branch the new role is for; not asked for a school-wide role.',
  'features/people/account-section.tsx#field:people.account.endFrom':
    'The day from which the role ends; once that day has come the end cannot be taken back.',
  'features/people/account-section.tsx#field:people.account.from':
    'The first day the new role is in force.',
  'features/people/account-section.tsx#field:people.account.login':
    'The login of the new account, in small Latin letters and dots, for example a.karimov.',
  'features/people/account-section.tsx#field:people.account.newRole':
    'The role to give to the account.',
  'features/people/account-section.tsx#field:people.account.subjects':
    "The subjects the role oversees, ticked from the branch's subjects.",
  'features/people/account-section.tsx#field:people.account.subjectsFrom':
    'The first day the new set of subjects applies to the role.',
  'features/people/availability-section.tsx#button:people.availability.change':
    "Opens a form to change the person's weekly available hours in this branch from a chosen date.",
  'features/people/availability-section.tsx#field:people.availability.from':
    'The first day the new available hours apply; the hours are typed per weekday, such as 08:00-13:00, 14:00-17:00.',
  'features/people/branch-move.tsx#button:people.students.branchMoves.accept':
    'Opens the accept of a student released to this branch: the class to join, then a confirmation; an accept cannot be undone.',
  'features/people/branch-move.tsx#button:people.students.branchMoves.decline':
    'Opens the decline of a release to this branch, with a reason; after a confirmation the student stays in the other branch.',
  'features/people/branch-move.tsx#field:people.students.branchMoves.class':
    'The class of this branch the arriving student joins.',
  'features/people/branch-move.tsx#field:people.students.branchMoves.from':
    "The student's first day in the other branch.",
  'features/people/branch-move.tsx#field:people.students.branchMoves.toBranch':
    'The branch the student is released to.',
  'features/people/branch-move.tsx#field:people.students.reason':
    'Holds why the release from the other branch is declined.',
  'features/people/first-password-slip.tsx#button:people.account.closeSlip':
    'Closes the slip; the password is not shown again.',
  'features/people/first-password-slip.tsx#button:people.account.print':
    'Prints the password slip.',
  'features/people/first-password-slip.tsx#button:problems.retry':
    'Reads the branch details for the slip again after they failed to load.',
  'features/people/first-password-slip.tsx#panel:people.access.slipTitle':
    'The dialog that shows the printable slip with the login and the one-time password; the password is shown only once.',
  'features/people/head-teachers-page.tsx#column:people.headTeachers.from':
    'The first day of the appointment.',
  'features/people/head-teachers-page.tsx#column:people.headTeachers.person':
    'The staff member who holds the Head Teacher role.',
  'features/people/head-teachers-page.tsx#column:people.headTeachers.role':
    'The kind of Head Teacher role held.',
  'features/people/head-teachers-page.tsx#column:people.headTeachers.state':
    'Whether the appointment is planned or in force.',
  'features/people/head-teachers-page.tsx#column:people.headTeachers.subjects':
    'The subjects the Head Teacher oversees.',
  'features/people/head-teachers-page.tsx#column:people.headTeachers.until':
    'The day the appointment ends, if an end is set.',
  'features/people/never-used-page.tsx#column:people.neverUsed.created':
    'When the account was created.',
  'features/people/never-used-page.tsx#column:people.neverUsed.lockedColumn':
    'Shows whether the account is locked.',
  'features/people/never-used-page.tsx#column:people.neverUsed.login': 'The login of the account.',
  'features/people/never-used-page.tsx#column:people.neverUsed.name':
    'The surname and name of the staff member whose account was never used.',
  'features/people/never-used-page.tsx#column:people.neverUsed.password':
    'Until when the first password is valid, or the day it ran out.',
  'features/people/never-used-page.tsx#column:people.neverUsed.staffNumber':
    'The staff ID of the person.',
  'features/people/parent-account-part.tsx#button:people.parentAccount.reset':
    "Resets the parent's password after a confirmation and a choice of slip language: every session ends and a new slip valid for 7 days is printed.",
  'features/people/parent-account-part.tsx#button:people.parentAccount.unlink':
    "Unlinks the parent's Telegram after a confirmation; the portal no longer opens from Telegram without the password, and the password stays.",
  'features/people/parent-panel.tsx#button:form.edit':
    "Opens the parent's record form to change the name, phones, workplace or email.",
  'features/people/parent-panel.tsx#button:people.relatives.closeChoices':
    'Closes the choices shown when the new phone belongs to another relative.',
  'features/people/parent-panel.tsx#button:people.relatives.giveNumber':
    "Gives the phone to this parent and saves the earlier holder's new phone, or marks it unknown.",
  'features/people/parent-panel.tsx#button:people.relatives.merge':
    'Merges the two parent records after a confirmation: every student of both is linked to the one that stays, and the other is archived.',
  'features/people/parent-panel.tsx#button:people.relatives.show':
    "Shows the parent's workplace and email, which are hidden until asked for; the showing is logged.",
  'features/people/parent-panel.tsx#field:people.relatives.mergeName':
    'Chooses which of the two names the merged record keeps.',
  'features/people/parent-panel.tsx#field:people.relatives.mergePhone':
    'Chooses which of the two phones the merged record keeps.',
  'features/people/parent-panel.tsx#field:people.relatives.previousPhone':
    'The new phone of the relative who held this number before.',
  'features/people/parent-panel.tsx#field:people.relatives.previousUnknown':
    "Ticked when the earlier holder's new phone is not known; that relative is then marked as having no valid phone.",
  'features/people/parent-panel.tsx#panel':
    'The side panel of a parent: their data, phones and all linked students; a change of name or phone here applies for every linked student.',
  'features/people/parent-slip.tsx#button:people.parentSlips.back':
    "Leaves the slips and goes back to the list of the class's parents; the passwords are not shown again.",
  'features/people/parent-slip.tsx#button:people.parentSlips.print':
    'Prints the sheet of parent slips, four to a page.',
  'features/people/parent-slip.tsx#button:problems.retry':
    'Reads the branch details for the slips again after they failed to load.',
  'features/people/parent-slips-page.tsx#button:people.parentSlips.back':
    'Goes back to the list of parents when there was nothing to print.',
  'features/people/parent-slips-page.tsx#button:people.parentSlips.printSlips':
    'Makes new passwords for the parents still to print and shows their slips, in the chosen language, ready to print.',
  'features/people/parent-slips-page.tsx#column:people.parentSlips.children':
    "The parent's children in the class.",
  'features/people/parent-slips-page.tsx#column:people.parentSlips.login':
    "The login of the parent's account, once one exists.",
  'features/people/parent-slips-page.tsx#column:people.parentSlips.relative':
    'The parent with portal access.',
  'features/people/parent-slips-page.tsx#column:people.parentSlips.state':
    "Whether the parent's slip is still to print, has been printed (where and when), or the parent has signed in.",
  'features/people/parents-never-used-page.tsx#column:people.parentsNeverUsed.children':
    "The parent's children.",
  'features/people/parents-never-used-page.tsx#column:people.parentsNeverUsed.expired':
    "Shows whether the slip's password has run out.",
  'features/people/parents-never-used-page.tsx#column:people.parentsNeverUsed.login':
    "The login of the parent's account.",
  'features/people/parents-never-used-page.tsx#column:people.parentsNeverUsed.name':
    'The parent whose account has never been signed in to.',
  'features/people/parents-never-used-page.tsx#column:people.parentsNeverUsed.printedAt':
    "When the parent's last slip was printed.",
  'features/people/parents-never-used-page.tsx#column:people.parentsNeverUsed.validUntil':
    "Until when the slip's password is valid.",
  'features/people/parents-page.tsx#column:people.relatives.elsewhere':
    'How many students of other branches the parent is linked to.',
  'features/people/parents-page.tsx#column:people.relatives.listName':
    "The parent's surname and name.",
  'features/people/parents-page.tsx#column:people.relatives.phone': "The parent's main phone.",
  'features/people/parents-page.tsx#column:people.relatives.students':
    'The students of this branch the parent is linked to.',
  'features/people/personal-data-report-page.tsx#button:people.report.close':
    'Closes the report and goes back to the list it was opened from.',
  'features/people/personal-data-report-page.tsx#button:people.report.print':
    'Prints the personal data report.',
  'features/people/relative-form.tsx#button:people.relatives.addExtraPhone':
    'Adds a field for another extra phone.',
  'features/people/relative-form.tsx#button:people.relatives.removeExtraPhone':
    'Removes this extra phone from the form.',
  'features/people/relative-form.tsx#field:people.relatives.email': "The relative's email address.",
  'features/people/relative-form.tsx#field:people.relatives.extraPhone':
    'An extra phone of the relative, besides the main phone.',
  'features/people/relative-form.tsx#field:people.relatives.fullNameField':
    "The relative's surname, name and patronymic.",
  'features/people/relative-form.tsx#field:people.relatives.noPhone':
    'Ticked when the relative has no phone of their own; notices then cannot reach them.',
  'features/people/relative-form.tsx#field:people.relatives.ownerChoice':
    "Says whether the typed phone's current holder is the same person, to link them, or a different person, so the number has a new owner.",
  'features/people/relative-form.tsx#field:people.relatives.phone':
    "The relative's main phone, used for notices and to find the same person among other students' relatives.",
  'features/people/relative-form.tsx#field:people.relatives.previousPhone':
    'The new phone of the relative who held this number before.',
  'features/people/relative-form.tsx#field:people.relatives.previousUnknown':
    "Ticked when the earlier holder's new phone is not known; that relative is then marked as having no valid phone.",
  'features/people/relative-form.tsx#field:people.relatives.workplace': 'Where the relative works.',
  'features/people/reset-entries-page.tsx#field:people.resetEntries.from':
    'The first day of the period whose password resets are listed.',
  'features/people/reset-entries-page.tsx#field:people.resetEntries.to':
    'The last day of the period whose password resets are listed.',
  'features/people/staff-form.tsx#field:people.staff.academicDepartment':
    'The department in the Academic division; subjects can be given only with one.',
  'features/people/staff-form.tsx#field:people.staff.admissionDate':
    'The day the staff member joined the school.',
  'features/people/staff-form.tsx#field:people.staff.birthDate':
    "The staff member's date of birth.",
  'features/people/staff-form.tsx#field:people.staff.contractDate':
    'The date of the employment contract.',
  'features/people/staff-form.tsx#field:people.staff.contractType':
    'Whether the contract is full time or part time.',
  'features/people/staff-form.tsx#field:people.staff.dailyLessons':
    'The most lessons the person may teach in one day; the timetable keeps to it.',
  'features/people/staff-form.tsx#field:people.staff.department':
    'The department within the main division.',
  'features/people/staff-form.tsx#field:people.staff.departmentStartsOn':
    'The day the person moves to the newly chosen department.',
  'features/people/staff-form.tsx#field:people.staff.educationLevel':
    'The highest education of the staff member.',
  'features/people/staff-form.tsx#field:people.staff.email':
    "The staff member's email; a link to choose a new password can be sent to it.",
  'features/people/staff-form.tsx#field:people.staff.fatherName':
    "The staff member's father's name.",
  'features/people/staff-form.tsx#field:people.staff.firstName': "The staff member's first name.",
  'features/people/staff-form.tsx#field:people.staff.furtherDivisions':
    'Other divisions the person also works in.',
  'features/people/staff-form.tsx#field:people.staff.jshshir':
    "The staff member's JSHSHIR, the personal identification number.",
  'features/people/staff-form.tsx#field:people.staff.lastName': "The staff member's surname.",
  'features/people/staff-form.tsx#field:people.staff.mainDivision':
    'The division the person mainly works in.',
  'features/people/staff-form.tsx#field:people.staff.phone':
    "The staff member's phone; it must not belong to another staff record and marks the same person when it is a parent's main phone.",
  'features/people/staff-form.tsx#field:people.staff.sex': "The staff member's sex.",
  'features/people/staff-form.tsx#field:people.staff.weeklyLessons':
    'How many lessons a week the contract provides for; the timetable uses it for the teaching load.',
  'features/people/staff-import-page.tsx#button:people.import.reading':
    'Uploads the filled Excel file and shows its rows with their problems; it says Reading the file while the file is read.',
  'features/people/staff-import-page.tsx#button:people.import.template':
    'Downloads the Excel template to fill in.',
  'features/people/staff-import-page.tsx#button:people.staffImport.confirm':
    'Saves every row of the file as staff records; it is on only when every row is clean and every question is decided.',
  'features/people/staff-import-page.tsx#button:people.staffImport.print':
    'Prints the first-password slips of the people just imported; the passwords are shown only on this page.',
  'features/people/staff-import-page.tsx#column:people.account.login':
    'The login made for the person.',
  'features/people/staff-import-page.tsx#column:people.import.decisions':
    'Possible duplicates to tick when the row is really another person.',
  'features/people/staff-import-page.tsx#column:people.import.name':
    'The surname and name on the row.',
  'features/people/staff-import-page.tsx#column:people.import.problemsColumn':
    'What is wrong on the row and must be corrected, or Ready.',
  'features/people/staff-import-page.tsx#column:people.import.row':
    'The row number in the uploaded file.',
  'features/people/staff-import-page.tsx#column:people.staffImport.role':
    'The role the row gives the person: Teacher, Tutor or none.',
  'features/people/staff-page.tsx#button:people.staff.add':
    'Opens the form for a new staff member in the side panel.',
  'features/people/staff-page.tsx#button:people.staff.cancel':
    'Closes the new staff member form without saving.',
  'features/people/staff-page.tsx#column:people.staff.branches':
    'The branches the person works in.',
  'features/people/staff-page.tsx#column:people.staff.categories':
    'The staff categories of the person, such as Teacher or Tutor.',
  'features/people/staff-page.tsx#column:people.staff.department': "The person's department.",
  'features/people/staff-page.tsx#column:people.staff.grades': 'The grades the person teaches.',
  'features/people/staff-page.tsx#column:people.staff.languagesTitle':
    'The languages the person teaches in.',
  'features/people/staff-page.tsx#column:people.staff.name': "The staff member's surname and name.",
  'features/people/staff-page.tsx#column:people.staff.phone': "The person's phone.",
  'features/people/staff-page.tsx#column:people.staff.photo.column':
    "The staff member's photo, or initials when there is none.",
  'features/people/staff-page.tsx#column:people.staff.staffId': 'The staff ID of the person.',
  'features/people/staff-page.tsx#column:people.staff.statusColumn':
    'Whether the person is active, inactive, has left or has not started yet.',
  'features/people/staff-page.tsx#column:people.staff.subjects': 'The subjects the person teaches.',
  'features/people/staff-panel.tsx#button:form.edit':
    "Opens the staff member's record form for editing.",
  'features/people/staff-panel.tsx#button:people.staff.changeBranches':
    "Opens a form to change the person's main branch and further branches.",
  'features/people/staff-panel.tsx#button:people.staff.changeStatus':
    'Opens a form to set a new status (active, inactive or left) from a date; a change to Left ends every role of the account.',
  'features/people/staff-panel.tsx#button:people.staff.changeTeaching':
    'Opens a form to change the subjects the person teaches, their grades and the languages of instruction.',
  'features/people/staff-panel.tsx#button:people.staff.photo.add':
    'Opens a file choice to add a photo to the record; the photo is shrunk before it is sent.',
  'features/people/staff-panel.tsx#button:people.staff.photo.remove':
    'Removes the photo after a confirmation; initials are shown instead.',
  'features/people/staff-panel.tsx#button:people.staff.showIdentity':
    'Shows the hidden date of birth and JSHSHIR of the person; the showing is logged.',
  'features/people/staff-panel.tsx#field:people.staff.from':
    'The day the new status starts; a change planned after today replaces an earlier planned one.',
  'features/people/staff-panel.tsx#field:people.staff.furtherBranches':
    'Other branches the person also works in.',
  'features/people/staff-panel.tsx#field:people.staff.gradesOf':
    'The grades in which the person teaches this subject.',
  'features/people/staff-panel.tsx#field:people.staff.languagesTitle':
    'The languages the person teaches in.',
  'features/people/staff-panel.tsx#field:people.staff.mainBranchField':
    'The branch the person mainly works in.',
  'features/people/staff-panel.tsx#field:people.staff.newStatus':
    'The status the person takes: active, inactive or left.',
  'features/people/staff-panel.tsx#field:people.staff.subjects':
    'The subjects the person teaches, from the subjects of their department.',
  'features/people/staff-panel.tsx#panel':
    'The side panel of a staff member: the record, photo, subjects and languages, branches, status, availability, account and roles, and sign-in access.',
  'features/people/student-form.tsx#button:people.students.restoreThis':
    'Opens the inactive or graduated student who already holds this JSHSHIR or document number, so that record can be restored instead.',
  'features/people/student-form.tsx#button:problems.retry':
    'Reads the free seats of the classes again after they failed to load.',
  'features/people/student-form.tsx#field:people.relatives.email':
    "The first relative's email address.",
  'features/people/student-form.tsx#field:people.relatives.fullNameField':
    "The first relative's surname, name and patronymic.",
  'features/people/student-form.tsx#field:people.relatives.noPhone':
    'Ticked when the first relative has no phone of their own; notices then cannot reach them.',
  'features/people/student-form.tsx#field:people.relatives.phone':
    "The first relative's main phone; a phone already known links that person.",
  'features/people/student-form.tsx#field:people.relatives.portalAccess':
    "Ticked to give the relative a parent account for the portal; it is made when the class's slips are printed.",
  'features/people/student-form.tsx#field:people.relatives.relationship':
    'How the first relative is related to the student, such as Father or Mother.',
  'features/people/student-form.tsx#field:people.relatives.workplace':
    'Where the first relative works.',
  'features/people/student-form.tsx#field:people.students.address': "The student's home address.",
  'features/people/student-form.tsx#field:people.students.birthDate':
    "The student's date of birth.",
  'features/people/student-form.tsx#field:people.students.class':
    'The class the student joins; a student who starts today or earlier needs one.',
  'features/people/student-form.tsx#field:people.students.consentSignedOn':
    'The day the consent to the use of personal data was signed.',
  'features/people/student-form.tsx#field:people.students.contractNumber':
    "The number of the student's contract.",
  'features/people/student-form.tsx#field:people.students.contractSignedOn':
    'The date the contract was signed.',
  'features/people/student-form.tsx#field:people.students.diagnosticScore':
    "The student's score in the diagnostic entry test.",
  'features/people/student-form.tsx#field:people.students.documentNumber':
    'The number of the identity document; it must not be held by another student.',
  'features/people/student-form.tsx#field:people.students.documentType':
    'The kind of identity document: passport, ID card or birth certificate.',
  'features/people/student-form.tsx#field:people.students.email': "The student's email address.",
  'features/people/student-form.tsx#field:people.students.firstName': "The student's first name.",
  'features/people/student-form.tsx#field:people.students.grade': 'The grade the student is in.',
  'features/people/student-form.tsx#field:people.students.jshshir':
    "The student's JSHSHIR, the personal identification number; it must not be held by another student.",
  'features/people/student-form.tsx#field:people.students.lastName': "The student's surname.",
  'features/people/student-form.tsx#field:people.students.paternalName':
    "The student's paternal name.",
  'features/people/student-form.tsx#field:people.students.phone': "The student's own phone.",
  'features/people/student-form.tsx#field:people.students.previousSchool':
    'The school the student came from.',
  'features/people/student-form.tsx#field:people.students.region':
    'The region the student lives in.',
  'features/people/student-form.tsx#field:people.students.scholarshipAmount':
    'The scholarship amount in soum.',
  'features/people/student-form.tsx#field:people.students.scholarshipCoverage':
    'Whether the scholarship covers the fee in full or in part.',
  'features/people/student-form.tsx#field:people.students.scholarshipType':
    'The kind of scholarship, or not a scholarship student.',
  'features/people/student-form.tsx#field:people.students.sex': "The student's sex.",
  'features/people/student-form.tsx#field:people.students.startsOn':
    "The student's first day at school.",
  'features/people/student-form.tsx#field:people.students.uid':
    "The student's UID: letters, digits or both, up to 20 characters; a UID is never given twice.",
  'features/people/student-import-page.tsx#button:people.import.confirm':
    'Saves every row of the file as students; it is on only when every row is clean and every question is decided.',
  'features/people/student-import-page.tsx#button:people.import.reading':
    'Uploads the filled Excel file and shows its rows with their problems; it says Reading the file while the file is read.',
  'features/people/student-import-page.tsx#button:people.import.template':
    'Downloads the Excel template to fill in.',
  'features/people/student-import-page.tsx#column:people.import.decisions':
    'Questions to decide on the row: possible duplicates to tick, or a relative to link to the person who has the phone.',
  'features/people/student-import-page.tsx#column:people.import.name':
    'The surname and name on the row.',
  'features/people/student-import-page.tsx#column:people.import.problemsColumn':
    'What is wrong on the row and must be corrected, or Ready.',
  'features/people/student-import-page.tsx#column:people.import.row':
    'The row number in the uploaded file.',
  'features/people/student-import-page.tsx#column:people.students.class': 'The class on the row.',
  'features/people/student-import-page.tsx#column:people.students.uid': 'The UID on the row.',
  'features/people/student-merge.tsx#button:people.students.merge.show':
    'Shows what merging the two records would do: which record stays, the rows that change and the values that differ.',
  'features/people/student-merge.tsx#field:people.students.merge.reason':
    'Holds why the two records are merged; a merge cannot be undone.',
  'features/people/student-merge.tsx#field:people.students.merge.uid':
    'The UID of the other record of the same student, to be merged with this one.',
  'features/people/student-moves.tsx#button:people.students.moves.undo':
    'Opens a form to undo this move, with a reason.',
  'features/people/student-moves.tsx#field:people.students.moves.from':
    "The student's first day in the new class.",
  'features/people/student-moves.tsx#field:people.students.moves.from:2':
    "The student's first day in the new group.",
  'features/people/student-moves.tsx#field:people.students.moves.groupRow':
    'The group the student moves out of.',
  'features/people/student-moves.tsx#field:people.students.moves.toClass':
    'The class the student moves to.',
  'features/people/student-moves.tsx#field:people.students.moves.toGroup':
    'The group of the same subject the student moves to.',
  'features/people/student-moves.tsx#field:people.students.reason': 'Holds why the move is undone.',
  'features/people/student-panel.tsx#button:people.students.branchMoves.cancel':
    'Cancels the release to another branch after a confirmation; the student stays in this branch.',
  'features/people/student-panel.tsx#button:people.students.cancelLeaving':
    'Cancels the scheduled leaving after a confirmation; the student stays active.',
  'features/people/student-panel.tsx#button:people.students.cancelReturn':
    'Cancels the scheduled return after a confirmation; the class booked for next year is released.',
  'features/people/student-panel.tsx#button:people.students.moves.cancel':
    'Cancels the scheduled move to the named class or group after a confirmation; the student stays where they are.',
  'features/people/student-panel.tsx#button:people.students.showIdentity':
    "Shows the student's hidden documents and date of birth; the showing is logged.",
  'features/people/student-panel.tsx#field:people.students.reason':
    'Holds why the UID is corrected.',
  'features/people/student-panel.tsx#field:people.students.uid':
    'The corrected UID of the student: letters, digits or both, up to 20 characters.',
  'features/people/student-panel.tsx#panel':
    'The side panel of a student: the record in tabs (overview, results, attendance, contract, relatives, history) and the actions on the student.',
  'features/people/student-panel.tsx#tab:people.students.tabs.label':
    'The tabs of the student record; switching shows the overview, results, attendance, contract and scholarship, relatives or history.',
  'features/people/student-photo-section.tsx#button:people.staff.photo.add':
    "Opens a file choice to add a photo to the student's record.",
  'features/people/student-photo-section.tsx#button:people.staff.photo.remove':
    "Removes the student's photo after a confirmation; initials are shown instead.",
  'features/people/student-relatives.tsx#button:form.cancel':
    'Closes the choice of a new main contact without unlinking.',
  'features/people/student-relatives.tsx#button:people.relatives.add':
    'Opens the form to add a relative to the student, a new person or one found by phone.',
  'features/people/student-relatives.tsx#button:people.relatives.changeLink':
    'Opens a form to change how this relative is linked: relationship, main contact and portal access.',
  'features/people/student-relatives.tsx#button:people.relatives.unlink':
    'Unlinks the relative from the student after a confirmation; for the main contact it first asks who becomes the new main contact.',
  'features/people/student-relatives.tsx#button:people.relatives.unlink:2':
    'Unlinks the main contact after a confirmation and makes the chosen relative the new main contact.',
  'features/people/student-relatives.tsx#field:people.relatives.email':
    "The relative's email address.",
  'features/people/student-relatives.tsx#field:people.relatives.fullNameField':
    "The relative's surname, name and patronymic.",
  'features/people/student-relatives.tsx#field:people.relatives.mainContact':
    "Ticked when this relative is the student's main contact.",
  'features/people/student-relatives.tsx#field:people.relatives.newMain':
    'The relative who becomes the main contact when the current one is unlinked.',
  'features/people/student-relatives.tsx#field:people.relatives.noPhone':
    'Ticked when the relative has no phone of their own; notices then cannot reach them.',
  'features/people/student-relatives.tsx#field:people.relatives.phone':
    "The relative's main phone; a phone already known links that person.",
  'features/people/student-relatives.tsx#field:people.relatives.portalAccess':
    "Ticked to give the relative a parent account for the portal; it is made when the class's slips are printed.",
  'features/people/student-relatives.tsx#field:people.relatives.relationship':
    'How the relative is related to the student, such as Father or Mother.',
  'features/people/student-relatives.tsx#field:people.relatives.workplace':
    'Where the relative works.',
  'features/people/student-status-section.tsx#button:people.students.nextYearStart':
    'Fills in the first day of the next academic year as the first day back.',
  'features/people/student-status-section.tsx#field:people.students.class':
    'The class the returning student joins.',
  'features/people/student-status-section.tsx#field:people.students.class:2':
    'The class the restored student joins; the student takes its grade.',
  'features/people/student-status-section.tsx#field:people.students.contractNumber':
    'The number of the contract signed for the return, if any.',
  'features/people/student-status-section.tsx#field:people.students.contractSignedOn':
    'The date of the contract signed for the return.',
  'features/people/student-status-section.tsx#field:people.students.grade':
    'The grade the returning student goes into.',
  'features/people/student-status-section.tsx#field:people.students.lastDay':
    "The student's last day at school; the student is inactive from the day after.",
  'features/people/student-status-section.tsx#field:people.students.reason':
    'Holds why the student leaves the school.',
  'features/people/student-status-section.tsx#field:people.students.reason:2':
    'Holds why the leaving is undone.',
  'features/people/student-status-section.tsx#field:people.students.reason:3':
    'Holds why the student comes back.',
  'features/people/student-status-section.tsx#field:people.students.reason:4':
    'Holds why the graduated student is restored to active.',
  'features/people/student-status-section.tsx#field:people.students.reason:5':
    'Holds why the student created twice is deleted; the UID stays reserved.',
  'features/people/student-status-section.tsx#field:people.students.restoreFrom':
    'The day from which the graduated student is active again.',
  'features/people/student-status-section.tsx#field:people.students.returnFrom':
    "The student's first day back at school.",
  'features/people/students-page.tsx#button:people.students.add':
    'Opens the form for a new student in the side panel.',
  'features/people/students-page.tsx#button:people.students.cancel':
    'Closes the panel that puts the ticked students into a class, without a change.',
  'features/people/students-page.tsx#button:people.students.cancel:2':
    'Closes the panel that puts the ticked students into a group, without a change.',
  'features/people/students-page.tsx#button:people.students.cancel:3':
    'Closes the new student form without saving.',
  'features/people/students-page.tsx#button:people.students.cancel:4':
    'Closes the panel that records the leaving of the ticked students, without a change.',
  'features/people/students-page.tsx#button:problems.retry':
    'Reads the list of classes for the Class filter again after it failed to load.',
  'features/people/students-page.tsx#column:people.staff.photo.column':
    "The student's photo, or initials when there is none.",
  'features/people/students-page.tsx#column:people.students.class':
    "The student's class, with a planned class and its date.",
  'features/people/students-page.tsx#column:people.students.groups':
    'The groups the student is in, with planned groups and their dates.',
  'features/people/students-page.tsx#column:people.students.name':
    "The student's surname and name.",
  'features/people/students-page.tsx#column:people.students.status':
    'Whether the student is active, inactive, graduated or starts later.',
  'features/people/students-page.tsx#column:people.students.tutor':
    "The Tutor or Class teacher of the student's class, and an acting Tutor.",
  'features/people/students-page.tsx#column:people.students.uid': "The student's UID.",
  'features/people/students-page.tsx#field:people.students.lastDay':
    'The last day at school of the ticked students; they are inactive from the day after.',
  'features/people/students-page.tsx#field:people.students.reason':
    'Holds why the ticked students leave the school.',
  'features/people/vacancies-page.tsx#button:people.staff.cancel':
    'Closes the new vacancy form without saving.',
  'features/people/vacancies-page.tsx#button:people.vacancies.add':
    'Opens the form for a new vacancy in the side panel.',
  'features/people/vacancies-page.tsx#column:people.staff.grades':
    'The grades the vacancy teaches.',
  'features/people/vacancies-page.tsx#column:people.staff.languagesTitle':
    'The languages the vacancy teaches in.',
  'features/people/vacancies-page.tsx#column:people.staff.weeklyLessons':
    'How many lessons a week the vacancy is planned for.',
  'features/people/vacancies-page.tsx#column:people.vacancies.department':
    'The department of the vacancy.',
  'features/people/vacancies-page.tsx#column:people.vacancies.name': 'The name of the vacancy.',
  'features/people/vacancies-page.tsx#column:people.vacancies.statusTitle':
    'Whether the vacancy is open or closed, and the day it closes.',
  'features/people/vacancies-page.tsx#column:people.vacancies.subjects':
    'The subjects the vacancy teaches.',
  'features/people/vacancy-acting.tsx#button:people.vacancies.acting.cancel':
    'Closes the dialog without a change.',
  'features/people/vacancy-acting.tsx#button:people.vacancies.acting.end':
    "Opens a dialog to end the current acting teacher's period on a chosen day.",
  'features/people/vacancy-acting.tsx#button:people.vacancies.acting.end:2':
    "Ends the acting teacher's period on the day chosen.",
  'features/people/vacancy-acting.tsx#button:people.vacancies.acting.name':
    'Names the acting teacher for the chosen journal and dates.',
  'features/people/vacancy-acting.tsx#button:people.vacancies.acting.open':
    'Opens a dialog to name an acting teacher who writes a journal of the vacancy for a period.',
  'features/people/vacancy-acting.tsx#button:people.vacancies.acting.substitute':
    'Opens a dialog to arrange substitutes for the lessons of this journal of the vacancy.',
  'features/people/vacancy-acting.tsx#button:people.vacancies.acting.withdraw':
    'Withdraws the planned acting teacher before the period starts, after a confirmation; it stays in the history.',
  'features/people/vacancy-acting.tsx#field:people.vacancies.acting.endOn':
    'The first day the acting teacher no longer holds the journal.',
  'features/people/vacancy-acting.tsx#field:people.vacancies.acting.from':
    'The first day the acting teacher holds the journal, today at the earliest.',
  'features/people/vacancy-acting.tsx#field:people.vacancies.acting.journal':
    'The journal of the vacancy the acting teacher takes over.',
  'features/people/vacancy-acting.tsx#field:people.vacancies.acting.person':
    'The staff member named as acting teacher.',
  'features/people/vacancy-acting.tsx#field:people.vacancies.acting.untilField':
    'The day the acting teacher hands the journal back, if known; left empty the period is open-ended.',
  'features/people/vacancy-acting.tsx#panel:people.vacancies.acting.dialogTitle':
    'The dialog for naming an acting teacher for a journal of the vacancy, from a day and optionally until one.',
  'features/people/vacancy-acting.tsx#panel:people.vacancies.acting.endTitle':
    "The dialog for ending an acting teacher's period on a chosen day.",
  'features/people/vacancy-fill-dialog.tsx#button:people.vacancies.fill.action':
    'Gives the checked rows to the person after a confirmation, in the timetable in force and every later version; the vacancy closes when nothing holds it.',
  'features/people/vacancy-fill-dialog.tsx#button:people.vacancies.fill.close':
    'Closes the fill dialog.',
  'features/people/vacancy-fill-dialog.tsx#button:timetable.publish.defaultStart':
    'Sets the start day to the usual start, the next Monday.',
  'features/people/vacancy-fill-dialog.tsx#field:people.vacancies.fill.person':
    "The staff member who takes over the vacancy's lessons.",
  'features/people/vacancy-fill-dialog.tsx#field:people.vacancies.fill.startsOn':
    "The first day the person takes the vacancy's rows.",
  'features/people/vacancy-fill-dialog.tsx#panel':
    'The dialog for filling a vacancy with a person: the start day, the rows that go to the person and the effect on the timetable.',
  'features/people/vacancy-fill-dialog.tsx#panel:people.vacancies.fill.title':
    'The dialog for filling a vacancy: choose the person and start day, check which rows they can take, then fill.',
  'features/people/vacancy-form.tsx#field:people.staff.dailyLessons':
    'The most lessons a day the vacancy may have in the timetable.',
  'features/people/vacancy-form.tsx#field:people.staff.gradesOf':
    'The grades in which the vacancy teaches this subject.',
  'features/people/vacancy-form.tsx#field:people.staff.languagesTitle':
    'The languages the vacancy teaches in.',
  'features/people/vacancy-form.tsx#field:people.staff.weeklyLessons':
    'How many lessons a week the vacancy is planned for.',
  'features/people/vacancy-form.tsx#field:people.vacancies.department':
    'The department of the vacancy; its subjects are offered below.',
  'features/people/vacancy-form.tsx#field:people.vacancies.name': 'The name of the vacancy.',
  'features/people/vacancy-form.tsx#field:people.vacancies.subjects':
    "The subjects the vacancy teaches, from the department's subjects.",
  'features/people/vacancy-panel.tsx#button:form.edit':
    "Opens the vacancy's record form for editing.",
  'features/people/vacancy-panel.tsx#button:people.vacancies.close':
    'Closes the vacancy; the button then reopens it.',
  'features/people/vacancy-panel.tsx#button:people.vacancies.delete':
    'Deletes the vacancy and its hours after a confirmation; the audit log keeps a copy.',
  'features/people/vacancy-panel.tsx#button:people.vacancies.fill.open':
    'Opens the dialog to fill the vacancy with a staff member.',
  'features/people/vacancy-panel.tsx#panel':
    'The side panel of a vacancy: its record, hours, fills and acting teachers.',
  'features/people/parent-panel.tsx#button:people.relatives.mergeWith':
    'Chooses to merge this parent with the record that already holds the phone number, so both become one person.',
  'features/people/parent-panel.tsx#button:people.relatives.newOwner':
    'Chooses to give the phone number to this parent as its new owner; the other record keeps its name without the number.',
  'features/people/student-panel.tsx#tab:people.students.tabs.overview':
    "Shows the student's record: class, groups, status, UID and the main details.",
  'features/people/student-panel.tsx#tab:people.students.tabs.results':
    "Shows the student's quarter and year results by subject.",
  'features/people/student-panel.tsx#tab:people.students.tabs.attendance':
    "Shows the student's attendance: absences and lateness by subject and quarter.",
  'features/people/student-panel.tsx#tab:people.students.tabs.relatives':
    "Shows the student's relatives and parents with their phones, the main contact and portal access.",
  'features/people/student-panel.tsx#tab:people.students.tabs.contract':
    "Shows the student's contracts, scholarship and stipend history.",
  'features/people/student-panel.tsx#tab:people.students.tabs.history':
    "Shows the student's history: classes, groups, branch moves, leavings and returns, with dates.",
  'features/people/student-panel.tsx#tab:journal.exemptions.panelTitle':
    "Shows the student's exemptions from subjects or lessons, with their dates.",
  'features/people/student-panel.tsx#button:people.students.uidTitle':
    "Opens the form to change the student's UID, the school's identifier of the student.",
  'features/people/student-panel.tsx#button:people.students.undoTitle':
    "Opens the form to undo the student's leaving, with a reason; the student is active again in the same class.",
  'features/people/student-panel.tsx#button:people.students.returnTitle':
    'Opens the form for a student who left to return: the date and the class of the return.',
  'features/people/student-panel.tsx#button:people.students.restoreTitle':
    'Opens the form to restore an archived student record.',
  'features/people/student-panel.tsx#button:people.students.moves.moveClass':
    'Opens the form to move the student to another class of the branch from a date.',
  'features/people/student-panel.tsx#button:people.students.moves.moveGroup':
    'Opens the form to move the student to another group of a subject from a date.',
  'features/people/student-panel.tsx#button:people.students.moves.change':
    'Opens the form to change a scheduled move of the student (its date or its class or group).',
  'features/people/student-panel.tsx#button:people.students.branchMoves.move':
    'Opens the form to release the student to another branch from a date; the receiving branch then accepts the student and places them in a class.',
  'features/people/student-panel.tsx#button:people.students.merge.action':
    'Opens the merge of this student record with another record of the same student; one record stays and holds the data of both.',
  'features/people/student-panel.tsx#button:people.students.leaveTitle':
    "Opens the form for the student's leaving: the date and the reason; the student leaves the class and its journals from that date.",
  'features/people/student-panel.tsx#button:people.students.deleteAction':
    'Opens the delete of a student record that holds no data, after a confirmation.',
  'features/people/student-panel.tsx#button:form.edit':
    "Opens the student's record form to edit the name, the details and the documents.",
};
