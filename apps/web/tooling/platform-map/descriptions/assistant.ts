/** Task 11.19: the descriptions of the map of the platform, assistant. */
export const DESCRIPTIONS: Readonly<Record<string, string>> = {
  'features/assistant/assistant-chat.tsx#button:assistant.sending':
    'Sends the typed question to the assistant (also Enter); it shows while the question is being sent or answered.',
  'features/assistant/assistant-conversations-page.tsx#button:assistant.conversationsPage.restore':
    "Restores the conversation after a confirmation; it comes back to its person's list for 90 days.",
  'features/assistant/assistant-conversations-page.tsx#column:assistant.conversationsPage.branch':
    'The branch of the conversation.',
  'features/assistant/assistant-conversations-page.tsx#column:assistant.conversationsPage.lastActivity':
    'When the conversation was last used.',
  'features/assistant/assistant-conversations-page.tsx#column:assistant.conversationsPage.person':
    'The person who had the conversation.',
  'features/assistant/assistant-conversations-page.tsx#column:assistant.conversationsPage.role':
    'The role the person used in the conversation.',
  'features/assistant/assistant-conversations-page.tsx#column:assistant.conversationsPage.state':
    'Whether the conversation is active or archived.',
  'features/assistant/assistant-conversations-page.tsx#column:assistant.conversationsPage.titleColumn':
    'The name of the conversation.',
  'features/assistant/assistant-page.tsx#button:assistant.newConversation':
    'Starts a new, empty conversation with the assistant.',
  'features/assistant/assistant-page.tsx#button:assistant.page.back':
    'Goes back from a conversation to the list of conversations.',
  'features/assistant/assistant-panel.tsx#button:assistant.close': 'Closes the assistant panel.',
  'features/assistant/assistant-panel.tsx#button:assistant.newConversation':
    'Starts a new, empty conversation in the assistant panel.',
  'features/assistant/assistant-panel.tsx#button:assistant.open':
    'Opens the assistant panel beside the page.',
  'features/assistant/assistant-panel.tsx#panel':
    'The assistant panel beside every page: ask how to do something, or ask it to prepare changes that run only after Confirm.',
  'features/assistant/assistant-settings-page.tsx#tab:assistant.settingsPage.role':
    'Chooses the role whose actions are listed: the Super Admin, the Academic Vice Principal or the Teacher. Each area opens to show its actions with a switch each, and a switch for the whole area.',
  'features/assistant/assistant-settings-section.tsx#field:assistant.settings.dataGroup_contact':
    'Six switches, one per group of personal data (contact, identity, financial, the diagnostic score, medical, relatives): a group switched off reaches the model as [removed]. Secrets never do.',
  'features/assistant/proposal-card.tsx#button:assistant.proposal.secretPrint':
    'Prints the one-time password or secret a confirmed step gave out, as its screen prints the slip.',
  'features/assistant/proposal-card.tsx#button:assistant.proposal.secretClose':
    'Closes the one-time password or secret a confirmed step gave out; it is shown once and is not kept in the conversation.',
  'features/assistant/assistant-settings-section.tsx#field:assistant.settings.dailyLimit':
    'How many questions each person may ask the assistant per day; 0 is no daily limit.',
  'features/assistant/assistant-settings-section.tsx#field:assistant.settings.fallbackOn':
    'Lets a question go through a worldwide endpoint when the Frankfurt one is busy or does not answer.',
  'features/assistant/assistant-settings-section.tsx#field:assistant.settings.monthlyCap':
    'The most the assistant may spend in a month, in US dollars.',
  'features/assistant/assistant-settings-section.tsx#field:assistant.settings.roleOn':
    'Switches the assistant on or off for one role.',
  'features/assistant/assistant-settings-section.tsx#field:assistant.settings.schoolOn':
    'Switches the assistant on or off for the whole school.',
  'features/assistant/proposal-card.tsx#button:assistant.proposal.confirming':
    "Confirms the assistant's proposal: its changes run in order as on their pages, and the first one refused stops the rest.",
  'features/assistant/proposal-card.tsx#button:assistant.proposal.decline':
    "Declines the assistant's proposal; nothing is changed.",
  // Task 11.21: the limits, Continue and Undo.
  // Task 11.22: files, photos and voice in the conversation.
  'features/assistant/assistant-files.tsx#button:assistant.files.attach':
    'Attaches an Excel file, a PDF or a photo to the next question (at most 5 files, Excel up to 5 MB, a PDF or photo up to 10 MB, 14 MB together). An import template attached goes through that import\u2019s own preview; the assistant reads any other file into a proposal.',
  'features/assistant/assistant-files.tsx#button:assistant.files.remove':
    'Removes an attached file from the question before it is sent.',
  'features/assistant/assistant-files.tsx#button:assistant.files.stop':
    'On a phone: records the question by voice (up to 2 minutes) and, when pressed again, stops and sends it; the assistant writes it out word for word and answers.',
  'features/assistant/assistant-files.tsx#button:assistant.files.recordingFile':
    'Downloads a file of the conversation: one the person attached, the recording of a spoken question, or an export the assistant made.',
  'features/assistant/assistant-chat.tsx#button:assistant.continue':
    'Shown under an answer that a limit of one question cut: asks the next part of the work, which never proposes again a step proposed before. Waits until the proposal shown is confirmed or declined.',
  // The owner's request of 28 November 2026: the chat follows new messages.
  'features/assistant/assistant-chat.tsx#button:assistant.newMessages':
    'Shown at the bottom of the conversation when new messages or more of an answer came while the person had scrolled up to read: scrolls to the end. A person already near the end is followed there without it.',
  'features/assistant/assistant-settings-section.tsx#field:assistant.settings.questionActions':
    'How many reads and changes the assistant may make for one question (40 at the start); past it, the answer offers Continue.',
  'features/assistant/assistant-settings-section.tsx#field:assistant.settings.proposalSteps':
    'How many changes one proposal may hold (100 at the start); the rest goes to the next part.',
  'features/assistant/assistant-settings-section.tsx#field:assistant.settings.questionMinutes':
    'How many minutes the assistant may work on one question (10 at the start); then it says what is done and offers Continue.',
  'features/assistant/proposal-card.tsx#button:assistant.proposal.undoing':
    'Undo of a confirmed proposal: proposes the reverse of each change made, the last first, as a new proposal to confirm; a change no action reverses is named.',
};
