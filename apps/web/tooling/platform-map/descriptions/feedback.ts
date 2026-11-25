/** Task 11.19: the descriptions of the map of the platform, feedback. */
export const DESCRIPTIONS: Readonly<Record<string, string>> = {
  'features/feedback/feedback-button.tsx#button:confirm.cancel':
    'Closes the feedback dialog without sending.',
  'features/feedback/feedback-button.tsx#button:feedback.button':
    'Opens the dialog to send feedback about what happened or what should work better.',
  'features/feedback/feedback-button.tsx#button:feedback.send':
    'Sends the feedback report with the page and role attached. Only a limited number can be sent in 24 hours.',
  'features/feedback/feedback-button.tsx#field:feedback.message':
    'The message of the feedback report: what happened or what should work better.',
  'features/feedback/feedback-button.tsx#panel:feedback.title':
    'The dialog to send feedback about the platform; the current page and role are attached to the report.',
  'features/feedback/feedback-reports-page.tsx#button:feedbackReports.markNew':
    'Marks the report handled, or a handled report back as new.',
  'features/feedback/feedback-reports-page.tsx#column:feedbackReports.page':
    'The page the report was sent from.',
  'features/feedback/feedback-reports-page.tsx#column:feedbackReports.roles':
    'The roles the sender held when sending.',
  'features/feedback/feedback-reports-page.tsx#column:feedbackReports.sender':
    'The person who sent the report.',
  'features/feedback/feedback-reports-page.tsx#column:feedbackReports.sent':
    'When the report was sent.',
  'features/feedback/feedback-reports-page.tsx#column:feedbackReports.state':
    'Whether the report is new or handled.',
  'features/feedback/feedback-reports-page.tsx#column:feedbackReports.text':
    'The text of the feedback report.',
  'features/feedback/system-status-card.tsx#button:problems.retry':
    'Reads the last 24 hours of the outside services again after they could not be read.',
  'features/feedback/system-status-page.tsx#button:systemStatus.refresh':
    'Reads every check of the system status again.',
  'features/feedback/system-status-page.tsx#tab:systemStatus.period':
    'Chooses the period for the outside services: 24 hours, 7 days or 14 days.',
};
