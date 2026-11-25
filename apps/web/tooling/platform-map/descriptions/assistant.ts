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
  'features/assistant/assistant-settings-section.tsx#field:assistant.settings.dailyLimit':
    'How many questions each person may ask the assistant per day.',
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
};
