/**
 * A browser that already chose to show every column of the journal (task 10.7): since then a
 * browser with no choice shows only the photo of the hideable columns. A test that reads the
 * UID or a figure column stores this choice first, as a teacher who ticked them all would.
 */
export function showEveryJournalColumn(): void {
  window.localStorage.setItem('sodiq.list.journal.hidden', '[]');
}
