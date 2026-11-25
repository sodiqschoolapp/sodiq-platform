/** Task 11.19: the descriptions of the map of the platform, shared. */
export const DESCRIPTIONS: Readonly<Record<string, string>> = {
  'app/app-layout.tsx#button:layout.dismiss':
    'Closes the notice that this device is not trusted because a one-time password was used at sign-in.',
  'components/forced-delete-dialog.tsx#button:forcedDeletes.keep':
    'Closes the dialog and keeps the record; nothing is deleted.',
  'components/forced-delete-dialog.tsx#button:forcedDeletes.send':
    'Deletes the record for good with the typed reason. It is listed under Deleted for good and can be restored from there for 30 days.',
  'components/forced-delete-dialog.tsx#field:forcedDeletes.reason':
    'The reason for deleting the record for good; it is required and kept with the deletion.',
  'components/forced-delete-dialog.tsx#panel':
    'The dialog to delete a record for good, such as a lesson, building or room, with a typed reason. It says what is kept and for how long it can be restored.',
  'components/form/record-form.tsx#button:form.cancel':
    'Closes the form without saving. If something was typed, it first asks whether to leave without saving.',
  'components/form/record-form.tsx#button:form.save':
    'Saves what is typed in the form. A field with a problem is marked and the form is not saved until it is corrected.',
  'components/list/list-page.tsx#button:app.loading':
    'Loads the next rows of the list from the server.',
  'components/list/list-page.tsx#button:list.clearSearch':
    'Clears the search text and every filter of the list, so that all rows are shown again.',
  'components/list/list-page.tsx#button:list.clearSelection':
    'Unticks every selected row of the list.',
  'components/list/list-page.tsx#button:list.columns':
    'Opens the column chooser, where columns of the list are shown or hidden.',
  'components/list/list-page.tsx#button:list.exportAlsoChosen':
    'Opens the choice of extra column groups to add to the export file of the list; it shows how many are chosen.',
  'components/list/list-page.tsx#button:list.exporting':
    'Exports the list to a file, either the ticked rows or every row matching the search and filters. The file holds only what the role may see, and the export is logged.',
  'components/list/list-page.tsx#button:list.filters':
    'Shows or hides the filters of the list on a narrow screen; it shows how many filters are in use.',
  'components/list/list-page.tsx#button:list.showMore':
    'Shows the next rows of the list that are already loaded.',
  'components/list/list-page.tsx#panel:app.loading':
    'The side panel of a list that opens when a row is chosen, showing the record with its actions and forms.',
  'components/list/panel-actions.tsx#button:list.moreActions':
    'Opens the menu of the further actions of the record in the side panel.',
  'components/prepared-stamp.tsx#button:prepared.refresh':
    'Asks again for the prepared totals of the report while they are being updated; the figures shown meanwhile are already worked out from the journal.',
  'components/search/command-search.tsx#button:layout.dismiss': 'Closes the search dialog.',
  'components/search/command-search.tsx#button:problems.retry':
    'Searches the records again after the search failed.',
  'components/search/command-search.tsx#button:search.label':
    'Opens the search dialog to find a page or a record by name or UID (also Ctrl+K).',
  'components/search/command-search.tsx#panel:search.label':
    'The search dialog, also opened with Ctrl+K: it finds pages and, where allowed, students, staff, parents, classes and groups by name or UID.',
  'components/side-panel.tsx#button:list.closePanel':
    'Closes the side panel and returns to the list.',
  'components/side-panel.tsx#panel':
    'The side panel that opens beside a list to show the chosen record, its details and its actions.',
  'components/states.tsx#button:problems.retry':
    'Loads the part of the page again after it could not be loaded.',
  'components/theme-switch.tsx#tab:theme.label':
    'Chooses the look of the app: light, dark, or as the device.',
  'components/unsent/unsent-changes.tsx#button:unsent.typed':
    'Shows that something is typed and not saved, or that a save failed, and takes the person to that form.',
};
