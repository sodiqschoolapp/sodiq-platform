/** Task 11.19: the descriptions of the map of the platform, plans. */
export const DESCRIPTIONS: Readonly<Record<string, string>> = {
  'features/plans/plan-item-editor.tsx#button:plans.files.dropOf':
    'Removes a picked file from the row before it is uploaded; nothing is sent for it when the row is saved.',
  'features/plans/plan-item-editor.tsx#button:plans.files.dropOf:2':
    'Removes a file that could not be uploaded from the not-uploaded list, without trying again.',
  'features/plans/plan-item-editor.tsx#button:plans.files.retry':
    'Tries again to upload a file that failed when the row was saved, attaching it to its work or to the materials.',
  'features/plans/plan-item-editor.tsx#button:plans.panel.addClasswork':
    'Adds one more classwork line to the row (the homework section has its own button), up to the limit of works.',
  'features/plans/plan-item-editor.tsx#button:plans.panel.sameTopic':
    'Fills the topic with the topic of the previous lesson on the same day, for a double lesson.',
  'features/plans/plan-item-editor.tsx#field:plans.panel.classworkTitle':
    'The title of a classwork (or homework) of the lesson; once it has a title, files can be attached to it.',
  'features/plans/plan-item-editor.tsx#field:plans.panel.description':
    'A short description of the classwork or homework beside it.',
  'features/plans/plan-item-editor.tsx#field:plans.panel.links':
    'Web links for the lesson, one per line; each must be a valid address.',
  'features/plans/plan-item-editor.tsx#field:plans.panel.objectives':
    'The objectives of the lesson and the materials it uses, as free text.',
  'features/plans/plan-item-editor.tsx#field:plans.plan.topic':
    'The topic of the lesson in this plan row.',
  'features/plans/plan-master-page.tsx#button:form.edit':
    'Opens the master item in the side panel for editing.',
  'features/plans/plan-master-page.tsx#button:plans.master.addItem':
    'Opens a form to add a new item at the end of the master plan.',
  'features/plans/plan-master-page.tsx#button:plans.master.moveDown':
    "Moves the item one place down in the master plan's order.",
  'features/plans/plan-master-page.tsx#button:plans.master.moveUp':
    "Moves the item one place up in the master plan's order.",
  'features/plans/plan-master-page.tsx#button:plans.master.remove':
    'Removes the item from the master plan, after a confirmation.',
  'features/plans/plan-master-page.tsx#button:plans.master.rename':
    'Opens a small form to change the name of the master plan.',
  'features/plans/plan-master-page.tsx#button:plans.master.restore':
    'Restores an archived master plan so it can be edited and copied again. On an active master the same place archives it, after a confirmation.',
  'features/plans/plan-master-page.tsx#button:plans.masters.cancel':
    'Closes the new item form without adding anything.',
  'features/plans/plan-master-page.tsx#button:plans.panel.addClasswork':
    'Adds one more classwork line to the master item (the homework section has its own button).',
  'features/plans/plan-master-page.tsx#column:plans.master.number':
    "The position of the item in the master plan's order.",
  'features/plans/plan-master-page.tsx#column:plans.plan.classworks':
    "The titles of the item's classworks.",
  'features/plans/plan-master-page.tsx#column:plans.plan.homeworks':
    "The titles of the item's homeworks.",
  'features/plans/plan-master-page.tsx#column:plans.plan.topic':
    'The topic of the master item; pressing it opens the item in the side panel.',
  'features/plans/plan-master-page.tsx#field:plans.masters.name':
    'The new name of the master plan.',
  'features/plans/plan-master-page.tsx#field:plans.panel.classworkTitle':
    'The title of a classwork (or homework) of the master item.',
  'features/plans/plan-master-page.tsx#field:plans.panel.description':
    'A short description of the classwork or homework beside it.',
  'features/plans/plan-master-page.tsx#field:plans.panel.links':
    'Web links for the master item, one per line.',
  'features/plans/plan-master-page.tsx#field:plans.panel.objectives':
    'The objectives and materials of the master item, as free text.',
  'features/plans/plan-master-page.tsx#field:plans.plan.topic': 'The topic of the master item.',
  'features/plans/plan-master-updated.tsx#button:plans.share.back':
    'Closes the dialog without changing the plan.',
  'features/plans/plan-master-updated.tsx#button:plans.share.copySend':
    "Copies the chosen master's items into the plan's rows in order and closes the dialog.",
  'features/plans/plan-master-updated.tsx#button:plans.updated.compare':
    'Opens a side-by-side comparison of the plan and the master it was copied from, which has changed since.',
  'features/plans/plan-master-updated.tsx#button:plans.updated.keep':
    'Keeps the plan as it is, after a confirmation; the updated mark goes until the master changes again.',
  'features/plans/plan-master-updated.tsx#button:plans.updated.take':
    "Takes the master's changes into this plan, after a confirmation; this cannot be undone.",
  'features/plans/plan-master-updated.tsx#field:plans.masterCopy.master':
    'The master plan to copy, with its scope and number of items.',
  'features/plans/plan-master-updated.tsx#panel:plans.masterCopy.title':
    "The dialog for filling this quarter's plan from a master plan that fits its subject, grade, language and quarter.",
  'features/plans/plan-master-updated.tsx#panel:plans.updated.title':
    "The dialog that compares each changed master item with the plan's row, so the changes can be taken or the plan kept.",
  'features/plans/plan-masters-page.tsx#button:plans.masters.add':
    'Opens the form for a new master plan of a subject one keeps; after saving, the new master opens.',
  'features/plans/plan-masters-page.tsx#button:plans.masters.cancel':
    'Closes the new master form without creating anything.',
  'features/plans/plan-masters-page.tsx#column:plans.masters.grade':
    'The grade the master plan is for.',
  'features/plans/plan-masters-page.tsx#column:plans.masters.items':
    'How many items (rows) the master plan has.',
  'features/plans/plan-masters-page.tsx#column:plans.masters.language':
    'The language of instruction the master plan is for.',
  'features/plans/plan-masters-page.tsx#column:plans.masters.name':
    'The name of the master plan; pressing it opens the master.',
  'features/plans/plan-masters-page.tsx#column:plans.masters.quarter':
    'The quarter the master plan is for.',
  'features/plans/plan-masters-page.tsx#column:plans.masters.scope':
    'Whether the master is kept for this branch or for all branches.',
  'features/plans/plan-masters-page.tsx#column:plans.masters.state':
    'Whether the master plan is active or archived.',
  'features/plans/plan-masters-page.tsx#column:plans.page.subject':
    'The subject of the master plan.',
  'features/plans/plan-masters-page.tsx#field:plans.masters.grade':
    'The grade of the new master plan.',
  'features/plans/plan-masters-page.tsx#field:plans.masters.language':
    'The language of instruction of the new master plan.',
  'features/plans/plan-masters-page.tsx#field:plans.masters.name':
    'The name of the new master plan.',
  'features/plans/plan-masters-page.tsx#field:plans.masters.quarter':
    'The quarter of the new master plan.',
  'features/plans/plan-masters-page.tsx#field:plans.masters.scope':
    'Whether the new master is kept for this branch or for all branches; shown only when both are possible.',
  'features/plans/plan-masters-page.tsx#field:plans.page.subject':
    'The subject of the new master plan, from the subjects one keeps; the grade and scope choices follow it.',
  'features/plans/plan-masters-page.tsx#field:plans.page.year':
    'Chooses the academic year whose master plans are listed.',
  'features/plans/plan-minimums.tsx#button:plans.minimum.save':
    "Saves the subject's minimum works; a plan below them is flagged once its window has ended.",
  'features/plans/plan-minimums.tsx#field:plans.minimum.classworks':
    'The minimum number of classworks a plan of this subject should have per quarter; 0 is no minimum.',
  'features/plans/plan-minimums.tsx#field:plans.minimum.homeworks':
    'The minimum number of homeworks a plan of this subject should have per quarter; 0 is no minimum.',
  'features/plans/plan-outcomes.tsx#button:plans.outcomes.carry':
    "Carries the not-covered item to the next quarter's plan, after a confirmation; it waits there in the carried-in tray.",
  'features/plans/plan-outcomes.tsx#button:plans.outcomes.drop':
    'Opens a dialog to drop the item from the plan with a reason.',
  'features/plans/plan-outcomes.tsx#button:plans.outcomes.drop:2':
    'Drops the item with the reason typed and closes the dialog.',
  'features/plans/plan-outcomes.tsx#button:plans.outcomes.merge':
    "Opens a dialog to merge a not-covered item into one of the plan's open lessons.",
  'features/plans/plan-outcomes.tsx#button:plans.outcomes.merge:2':
    'Merges the item into the chosen lesson (or places it there, for a carried-in item) and closes the dialog.',
  'features/plans/plan-outcomes.tsx#button:plans.outcomes.place':
    "Opens a dialog to place an item carried in from the last quarter at one of this plan's open lessons.",
  'features/plans/plan-outcomes.tsx#button:plans.share.back':
    'Closes the dialog without changing the plan.',
  'features/plans/plan-outcomes.tsx#field:plans.outcomes.reason':
    "Why the item is dropped; required, and shown in the quarter's outcomes.",
  'features/plans/plan-outcomes.tsx#field:plans.outcomes.row':
    'The open lesson of the plan to use, with its number, date and current topic.',
  'features/plans/plan-outcomes.tsx#panel:plans.outcomes.dropTitle':
    'The dialog for dropping a not-covered or carried-in item from the plan with a reason.',
  'features/plans/plan-outcomes.tsx#panel:plans.outcomes.mergeTitle':
    'The dialog for choosing the lesson at which a carried-in item is placed or into which a not-covered item is merged.',
  'features/plans/plan-page.tsx#column:plans.plan.classworks':
    "The titles of the lesson's classworks.",
  'features/plans/plan-page.tsx#column:plans.plan.date':
    'The date and slot of the lesson; pressing it opens the row in the side panel.',
  'features/plans/plan-page.tsx#column:plans.plan.files': 'How many files are attached to the row.',
  'features/plans/plan-page.tsx#column:plans.plan.homeworks':
    "The titles of the lesson's homeworks.",
  'features/plans/plan-page.tsx#column:plans.plan.marks':
    "The journal's marks on a held lesson: topic not delivered, or homework not given.",
  'features/plans/plan-page.tsx#column:plans.plan.number':
    'The number of the lesson in the quarter.',
  'features/plans/plan-page.tsx#column:plans.plan.topic':
    'The topic planned for the lesson, with marks such as moved from a date or edited after the lesson.',
  'features/plans/plan-page.tsx#tab:plans.plan.quarter':
    'Switches the plan shown to another quarter of the year.',
  'features/plans/plan-parallel-page.tsx#field:plans.masters.grade':
    'Chooses the grade whose classes and groups are shown side by side.',
  'features/plans/plan-parallel-page.tsx#field:plans.masters.quarter':
    'Chooses the quarter whose plans are compared.',
  'features/plans/plan-parallel-page.tsx#field:plans.page.subject':
    'Chooses the subject whose classes are compared.',
  'features/plans/plan-reports-page.tsx#button:plans.reports.excel':
    'Downloads the report shown, with its quarter and department, as an Excel file.',
  'features/plans/plan-reports-page.tsx#column:plans.page.subject': 'The subject of the plan.',
  'features/plans/plan-reports-page.tsx#column:plans.reports.counts.percentComplete':
    "The share of the teacher's plans that are complete, where every lesson has a topic.",
  'features/plans/plan-reports-page.tsx#column:plans.reports.counts.plans':
    'How many plans the teacher has in the quarter.',
  'features/plans/plan-reports-page.tsx#column:plans.reports.flag':
    'Warnings on the plan: overdue, window not opened, vacancy, or below the minimum works.',
  'features/plans/plan-reports-page.tsx#column:plans.reports.progress.behind':
    'Marks the plans whose delivered topics are behind the plan.',
  'features/plans/plan-reports-page.tsx#column:plans.reports.progress.notHeld':
    "How many of the teacher's planned works were not held.",
  'features/plans/plan-reports-page.tsx#column:plans.reports.progress.percentNotHeld':
    "The share of the teacher's planned works that were not held.",
  'features/plans/plan-reports-page.tsx#column:plans.reports.progress.planned':
    'How many lessons of the quarter the plan has planned.',
  'features/plans/plan-reports-page.tsx#column:plans.reports.progress.plannedWorks':
    'How many works the teacher planned in the quarter.',
  'features/plans/plan-reports-page.tsx#column:plans.reports.requests.changes':
    'What was changed in the plan under the request, with the topic before and after.',
  'features/plans/plan-reports-page.tsx#column:plans.reports.requests.decidedBy':
    'Who decided the request, and on which date.',
  'features/plans/plan-reports-page.tsx#column:plans.reports.requests.kind':
    'The kind of edit request: text, re-plan or extension.',
  'features/plans/plan-reports-page.tsx#column:plans.reports.requests.status':
    'Where the request stands: prepared, sent, approved, refused or void.',
  'features/plans/plan-reports-page.tsx#column:plans.reports.state':
    'Where the plan stands: complete, not started, no lessons, or how many rows lack a topic.',
  'features/plans/plan-reports-page.tsx#column:plans.reports.teacher':
    'The teacher whose plans the row counts, or the teacher of the plan.',
  'features/plans/plan-reports-page.tsx#column:plans.reports.unit':
    'The class or group of the plan.',
  'features/plans/plan-reports-page.tsx#column:plans.reports.unit:3':
    'The class or group and the subject of the plan the request was for.',
  'features/plans/plan-reports-page.tsx#field:plans.reports.department':
    'Narrows the report to one department, or shows all departments.',
  'features/plans/plan-reports-page.tsx#field:plans.reports.quarter':
    'Chooses the quarter the report counts.',
  'features/plans/plan-reports-page.tsx#tab:plans.reports.part':
    'Switches the completeness or progress report between one row per teacher and one row per plan.',
  'features/plans/plan-reports-page.tsx#tab:plans.reports.report':
    'Switches between the completeness, progress and edit requests reports.',
  'features/plans/plan-requests-page.tsx#button:plans.requests.approveAll':
    'Approves every waiting request caused by one change, with the school days chosen, after a confirmation; it cannot be taken back.',
  'features/plans/plan-requests-page.tsx#button:plans.requests.approveSubject':
    'Approves the waiting requests of one change for one subject only, after a confirmation.',
  'features/plans/plan-requests-page.tsx#button:plans.requests.decide':
    'Opens the dialog to approve or refuse the request.',
  'features/plans/plan-requests-page.tsx#column:plans.requests.kindLabel':
    'The kind of request: text, re-plan or window extension.',
  'features/plans/plan-requests-page.tsx#column:plans.requests.owner':
    'The teacher who owns the plan.',
  'features/plans/plan-requests-page.tsx#column:plans.requests.statusLabel':
    'Where the request stands; one waiting 2 school days is highlighted.',
  'features/plans/plan-requests-page.tsx#column:plans.requests.subject': 'The subject of the plan.',
  'features/plans/plan-requests-page.tsx#column:plans.requests.unit':
    'The class or group of the plan the request is for; pressing it opens the request in the side panel.',
  'features/plans/plan-requests-page.tsx#field:plans.requests.daysLabel':
    'How many school days, 1 to 10, the lessons stay open when requests are approved together.',
  'features/plans/plan-requests.tsx#button:plans.requests.approve':
    'Sends the decision (approve, or refuse when chosen) and closes the dialog.',
  'features/plans/plan-requests.tsx#button:plans.requests.ask':
    'Opens a dialog to ask for permission to edit the plan outside its window.',
  'features/plans/plan-requests.tsx#button:plans.requests.decide':
    'Opens the dialog to approve or refuse the edit request.',
  'features/plans/plan-requests.tsx#button:plans.requests.finish':
    'Ends an open request early, after a confirmation; its lessons lock again at once.',
  'features/plans/plan-requests.tsx#button:plans.requests.send':
    'Sends the edit request the system prepared for this plan to the people who decide it.',
  'features/plans/plan-requests.tsx#button:plans.requests.send:2':
    'Sends the edit request with the lessons and reason chosen, and closes the dialog.',
  'features/plans/plan-requests.tsx#button:plans.share.back':
    'Closes the dialog without sending anything.',
  'features/plans/plan-requests.tsx#button:plans.windows.extend':
    "Opens a dialog to give the plan's teacher a later end of the plan window.",
  'features/plans/plan-requests.tsx#button:plans.windows.extend:2':
    'Saves the new last day of the window for this teacher and closes the dialog.',
  'features/plans/plan-requests.tsx#field:plans.requests.daysLabel':
    'How many school days, 1 to 10, the approved lessons stay open.',
  'features/plans/plan-requests.tsx#field:plans.requests.decisionLabel':
    'Whether the request is approved or refused.',
  'features/plans/plan-requests.tsx#field:plans.requests.firstLabel':
    'The first lesson the request covers; for a re-plan, the first lesson not yet held to re-plan from.',
  'features/plans/plan-requests.tsx#field:plans.requests.keepLesson':
    'A tick for each lesson of the request; untick a lesson to leave it locked, giving a reason.',
  'features/plans/plan-requests.tsx#field:plans.requests.kindLabel':
    'The kind of request: text changes the wording of lessons; re-plan reopens the lessons not yet held from a first lesson on.',
  'features/plans/plan-requests.tsx#field:plans.requests.lastLabel':
    'The last lesson a text request covers.',
  'features/plans/plan-requests.tsx#field:plans.requests.reasonLabel':
    'Why the plan needs editing; required.',
  'features/plans/plan-requests.tsx#field:plans.requests.refuseReason':
    'Why the request is refused, or why lessons were unticked; a refusal changes nothing in the plan.',
  'features/plans/plan-requests.tsx#field:plans.windows.end':
    'The new last day of the plan window for this teacher.',
  'features/plans/plan-requests.tsx#panel:plans.requests.askTitle':
    'The dialog for an edit request: the kind, the lessons and the reason.',
  'features/plans/plan-requests.tsx#panel:plans.requests.decideTitle':
    'The dialog for approving or refusing an edit request.',
  'features/plans/plan-requests.tsx#panel:plans.windows.extendTitle':
    'The dialog for extending the plan window for one teacher.',
  'features/plans/plan-row-panel.tsx#button:plans.panel.clear':
    'Clears the row of a lesson not yet held, after a confirmation; the history keeps what it held.',
  'features/plans/plan-row-panel.tsx#button:plans.panel.fill':
    'Opens the form to fill in the empty row with a topic, works and files.',
  'features/plans/plan-row-panel.tsx#button:plans.panel.removeFileOf':
    'Removes the file from the row, after a confirmation.',
  'features/plans/plan-row-panel.tsx#panel':
    "The side panel of one plan row: the lesson's topic, objectives, links, works and files, read or edited.",
  'features/plans/plan-sharing.tsx#button:plans.masterCopy.open':
    'Opens a dialog to fill this plan from a master plan.',
  'features/plans/plan-sharing.tsx#button:plans.share.back':
    'Closes the dialog without changing the plan.',
  'features/plans/plan-sharing.tsx#button:plans.share.copy':
    'Opens a dialog to copy the items of another plan, from this year or another, into this plan.',
  'features/plans/plan-sharing.tsx#button:plans.share.copySend':
    "Copies the chosen plan's items into this plan and closes the dialog.",
  'features/plans/plan-sharing.tsx#button:plans.share.separate':
    'Separates this class from the shared plan, after a confirmation; it keeps its own copy of every item.',
  'features/plans/plan-sharing.tsx#button:plans.share.share':
    'Opens a dialog to share this plan with another class or group of the same language.',
  'features/plans/plan-sharing.tsx#button:plans.share.shareSend':
    'Shares the plan with the chosen class or group and closes the dialog.',
  'features/plans/plan-sharing.tsx#field:plans.share.copyPart':
    'Whether to copy all items or only the items of lessons not yet held.',
  'features/plans/plan-sharing.tsx#field:plans.share.copyQuarter':
    'The quarter of the source plan to copy.',
  'features/plans/plan-sharing.tsx#field:plans.share.copySource':
    'The plan of the same subject to copy from.',
  'features/plans/plan-sharing.tsx#field:plans.share.copyYear':
    'The academic year to copy a plan from.',
  'features/plans/plan-sharing.tsx#field:plans.share.shareWith':
    'The class or group to share the plan with.',
  'features/plans/plan-sharing.tsx#panel:plans.share.copyTitle':
    'The dialog for copying the items of another plan of the same subject into this one, in order.',
  'features/plans/plan-sharing.tsx#panel:plans.share.shareTitle':
    'The dialog for sharing this plan with another class or group.',
  'features/plans/plan-windows-page.tsx#field:plans.windows.end':
    "The last day of the quarter's plan window; if lessons will be held without a plan before it, saving asks for confirmation.",
  'features/plans/plan-windows-page.tsx#field:plans.windows.start':
    "The first day of the quarter's plan window, when teachers may write their plans.",
  'features/plans/plans-page.tsx#column:plans.page.class':
    'The class or group of the plan; pressing it opens the plan.',
  'features/plans/plans-page.tsx#column:plans.page.quarter':
    'Where the plan of that quarter stands, with flags such as overdue, master updated or below the minimum.',
  'features/plans/plans-page.tsx#column:plans.page.subject': 'The subject of the plan.',
  'features/plans/plans-page.tsx#field:plans.page.year':
    'Chooses the academic year whose plans are listed.',
  'features/plans/plans-page.tsx#tab:plans.page.tabs':
    'Switches the list between the plans of classes and the plans of groups.',
};
