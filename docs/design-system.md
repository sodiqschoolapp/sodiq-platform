# Design system

The look of every screen of the Sodiq School apps: the academic platform (`sodiqschoolapp/sodiq-platform`) and the procurement and warehouse app (`sodiqschoolapp/procurement`). Approved by the owner on 12 October 2026 from the design board "Sodiq Platform design directions" (page "Final"). The brand comes from the Sodiq School brand guidelines (Opera Branding Agency, 2021–2022): colours, logo, slogan, hexagon pattern and the navy-and-orange letterhead strip.

**One text in two repositories.** Everything above the last section, "This app", is the same text, word for word, in both repositories, so the two apps look like one family and can later share one sign-in. A change to it is a process change made by the owner in both repositories in the same week. The last section holds what belongs to one app only: its files, its menu and its own labels.

Each app's spec says what its screens must do; this file says how they look. Where they differ, the spec wins and the difference is reported. Every screen is checked against this file by the builder before the report and by the reviewer on every pull request that changes a screen.

## The principle: loud at the edges, calm in the work

- **Brand moments** are loud: the sign-in page, empty pages, full-page errors and everything printed or downloaded as a PDF. They use the slab font, the hexagon pattern and the letterhead strip.
- **Working screens** are calm: tables, lists, forms, editors and home pages. White panels on a light grey canvas, navy text, and orange only where the person acts: the primary button, the active menu item, and "now" or "today".
- One primary (orange) button per area. If two actions compete, one of them is secondary.

## What we never do

These patterns make a screen look generated. The review refuses them.

1. Small uppercase labels above a title ("eyebrows"). A title stands alone; its context is in the breadcrumbs or a normal line under it.
2. Icons inside coloured squares or circles. An icon stands next to its word.
3. A coloured stripe on the left of a card, a row or a menu item. The active menu item is a solid orange fill.
4. Pill-shaped tags for counts or plain status ("Now", "4 lessons", "Active"). Status is plain words, with an icon where it helps; a count is a plain number. The one exception is a status label that the app's spec defines as a label (see "This app"): a rectangle with corner 6, its icon and its word.
5. Greetings ("Good morning, Dilnoza"). The page title says what the page is.
6. Outlined buttons. A button is a fill; only a field has a border.
7. Buttons of different heights side by side, or one-off sizes.
8. Shadows and gradients on panels and cards. Elevation is for things that float: menus, dialogs, popovers.
9. Orange text, thin orange icons, or white text on orange. Orange on white is 2.35 : 1.
10. Emoji, decorative illustrations on working screens, or icons from more than one set.
11. An intro sentence under a page title on a screen used every day. A page explains itself through its title and its content.
12. A notification dot that only says "something".

## Colour

The tokens keep the names of shadcn/ui and are written in the app's stylesheet in oklch; the app's contrast test reads them there (files: "This app"). Hex is the brand value; the oklch value is its exact conversion.

### Light theme

| Token | Hex | oklch | Use |
| --- | --- | --- | --- |
| `--background` | #ECECEC | oklch(0.9431 0 0) | The page canvas (brand grey). |
| `--foreground` | #06113C | oklch(0.2026 0.0841 266.73) | All text: brand navy, never black. |
| `--card`, `--popover` | #FFFFFF | oklch(1 0 0) | Panels, side panels, menus, dialogs. |
| `--card-foreground`, `--popover-foreground` | #06113C | as foreground | |
| `--primary` | #FF8A32 | oklch(0.7491 0.1706 52.71) | Primary button fill, active menu item, "now". |
| `--primary-foreground` | #06113C | as foreground | Text on orange: 7.75 : 1. |
| `--primary-hover` (new) | #DE7230 | oklch(0.6666 0.1552 48.52) | Hover and pressed orange (the brand's darker orange); navy on it 5.68 : 1. |
| `--secondary` | #DCDFE8 | oklch(0.9040 0.0127 271.28) | Secondary button fill; navy on it 13.67 : 1. |
| `--secondary-hover` (new) | #CDD1DD | oklch(0.8612 0.0171 271.22) | Its hover; navy on it 11.93 : 1. |
| `--secondary-foreground` | #06113C | as foreground | |
| `--muted` | #F6F6F6 | oklch(0.9731 0 0) | Table header and summary columns, quiet fills on white. |
| `--muted-foreground` | #4A5270 | oklch(0.4441 0.0505 272.67) | Second lines, captions: 7.69 : 1 on white, 6.51 : 1 on the canvas. |
| `--accent` | #ECECEC | oklch(0.9431 0 0) | Hover of quiet buttons and rows. |
| `--accent-foreground` | #06113C | as foreground | |
| `--destructive` | #A3221A | oklch(0.4680 0.1662 28.87) | Danger text and danger buttons (7.50 : 1 on white). |
| `--destructive-bg` (new) | #FDE7E4 | oklch(0.9448 0.0245 26.92) | Danger tint (danger text on it 6.33 : 1). |
| `--success`, `--success-bg` (new) | #146C2E on #E6F4EA | oklch(0.4670 0.1247 148.20) on oklch(0.9540 0.0199 154.90) | Saved, active, done (5.75 : 1). |
| `--warning`, `--warning-bg` (new) | #7A4A00 on #FFF1CC | oklch(0.4544 0.0996 68.13) on oklch(0.9599 0.0504 89.76) | Late, provisional, needs attention (6.66 : 1). Amber, never the brand orange. |
| `--info`, `--info-bg` (new) | #1D4FA8 on #E3ECFB | oklch(0.4486 0.1532 260.94) on oklch(0.9407 0.0225 260.72) | Notices (6.45 : 1). |
| `--today` (new) | #FFF4E8 | oklch(0.9725 0.0198 70.00) | The row, column or item that is "now" or "today", and the selection bar (navy on it 16.79 : 1, muted 7.09 : 1). |
| `--border` | #DBDBDB | oklch(0.8914 0 0) | Dividers and panel edges (decorative). |
| `--input` | #7C849C | oklch(0.6152 0.0375 270.74) | Border of fields and selects: 3.73 : 1 on white, 3.15 : 1 on the canvas. |
| `--ring` | #06113C | as foreground | Focus: 2 px outline, 2 px offset. |
| `--sidebar` | #06113C | as foreground | The menu, navy in both themes. |
| `--sidebar-foreground` | #C9CFE3 | oklch(0.8560 0.0285 272.47) | Menu items (11.72 : 1 on navy). |
| `--sidebar-primary` | #FF8A32 | as primary | Active menu item fill. |
| `--sidebar-primary-foreground` | #06113C | as foreground | |
| `--sidebar-accent` | #0E1B4D | oklch(0.2475 0.0939 267.72) | Menu hover (light text on it 10.54 : 1). |
| `--sidebar-accent-foreground` | #FFFFFF | oklch(1 0 0) | |
| `--sidebar-border` | #16224F | oklch(0.2703 0.0841 268.91) | |
| `--sidebar-ring` | #FF8A32 | as primary | Focus inside the menu (7.75 : 1 on navy). |

### Dark theme

| Token | Hex | oklch |
| --- | --- | --- |
| `--background` | #040920 | oklch(0.1509 0.0498 267.91) |
| `--foreground` | #ECECEC | oklch(0.9431 0 0) |
| `--card`, `--popover` | #0B1438 | oklch(0.2087 0.0711 268.84) |
| top bar | #08102F | oklch(0.1880 0.0631 268.56) |
| `--primary`, `--primary-foreground`, `--primary-hover` | as light | as light |
| `--secondary` | #1C2856 | oklch(0.2942 0.0845 269.60) |
| `--secondary-hover` | #26346A | oklch(0.3441 0.0955 269.85) |
| `--secondary-foreground` | #ECECEC | |
| `--muted` | #16224F | oklch(0.2703 0.0841 268.91) |
| `--muted-foreground` | #A9B1CC | oklch(0.7629 0.0397 272.38) (8.41 : 1 on the card) |
| `--accent` | #16224F | oklch(0.2703 0.0841 268.91) |
| `--destructive` | #FF8F85 | oklch(0.7681 0.1370 26.09) (8.13 : 1 on the card) |
| `--success` | #6FD08C | oklch(0.7806 0.1343 151.86) |
| `--warning` | #FFD27A | oklch(0.8847 0.1180 82.93) |
| `--info` | #9DBBFF | oklch(0.7953 0.1027 265.79) |
| `--today` | #2A1C14 | oklch(0.2416 0.0266 50.81), its second line #D9C2B0 oklch(0.8286 0.0359 60.33) |
| links | #FFB37A | oklch(0.8269 0.1149 57.22) (10.23 : 1 on the card) |
| `--border` | #1C2856 | oklch(0.2942 0.0845 269.60) |
| `--input` | #5A6690 | oklch(0.5176 0.0683 271.60) (3.19 : 1 on the card) |
| `--ring`, `--sidebar-ring` | #FF8A32 | as primary (focus is orange in the dark theme) |
| `--sidebar` and its tokens | as light | the menu does not change between themes |

The tints of success, warning, info and danger in the dark theme are the colour at 16% over the card; the builder checks each pair in the app's contrast test.

The theme follows the device by default; the person can choose light or dark, and the choice is kept in the browser.

## Type

- **Golos Text** (ParaType, SIL Open Font License) for everything people work with. It covers Uzbek Latin (oʻ, gʻ with U+02BB) and Cyrillic, and has tabular figures: every column of numbers and every amount uses `font-variant-numeric: tabular-nums`. PDFs use the same font files.
- **Bitter** (SIL Open Font License) for brand moments only: the sign-in title and slogan, the title of an empty page and of a full-page error. Never in tables, forms, menus or page titles of working screens. If Bitter lacks a letter of a language (checked in the browser test with "Oʻgʻil, Ўзбекистон, Қашқадарё, Ғулом, Ҳамид"), that language's slab titles use Golos Text bold.
- Both are served from the app's own files (no Google Fonts at run time).

| Style | Size / line | Weight | Use |
| --- | --- | --- | --- |
| Page title | 28 / 34 | 700, letter spacing −0.01em | The page header title |
| Section | 17 / 24 | 700 | Panel and section titles |
| Body | 15 / 22 | 400 | Text, list rows, first lines of items |
| Control | 14 / 20 | 600 | Buttons, menu items (500 when not active), selects |
| Table | 13 / 18 | 400 | Dense tables; 14 / 20 in ordinary lists |
| Caption | 12 or 13 / 16 | 400 | Second lines, legends |
| Brand title | 40 / 44 (empty page), 56 / 58 (sign-in slogan) | 700–800 | Bitter, brand moments only |

## Spacing, corners, elevation

- Spacing in steps of 4: 4, 8, 12, 16, 24, 32, 48. Page padding 32 (16 at phone width), panel padding 24, gap between panels 24.
- Corners: 8 for every control (buttons, fields, selects, menu items, tiles), 12 for panels, 6 for the inner buttons of a segmented control and for status labels, round for avatars.
- Panels are white on the canvas with no border and no shadow. Floating things (menus, popovers, dialogs) have one shadow: `0 8px 24px -8px` of navy at 20%.

## Buttons

Three sizes, four kinds, one shape. Every button is a fill with no border.

| Size | Height | Padding | Text | Where |
| --- | --- | --- | --- | --- |
| Large | 48 | 0 20 | 16 / 600 | Sign-in, the main action of a phone screen |
| Medium | 40 (44 at phone width) | 0 16 | 14 / 600 | Everywhere else (default) |
| Small | 32 | 0 12 | 13 / 600 | Inside dense tables and selection bars on a desktop |

| Kind | Fill | Text | Hover |
| --- | --- | --- | --- |
| Primary | `--primary` | `--primary-foreground` | `--primary-hover` |
| Secondary | `--secondary` | `--secondary-foreground` | `--secondary-hover` |
| Quiet | none | foreground | `--accent` |
| Danger | none | `--destructive` | `--destructive-bg` |

- At phone width every control a finger uses is at least 44 high; small buttons are not used there.
- An icon-only button is square (40 × 40 at medium, 44 × 44 at phone width) and has an `aria-label`.
- Buttons in one row have one size. Action buttons in a list of items share one minimum width (112 at medium) so they line up.
- A link styled as a button uses the same classes. Plain links are navy, weight 600, underlined on hover.
- In the shadcn/ui button the sizes are `sm` 32, `default` 40 and `lg` 48, with the square `icon-sm`, `icon` and `icon-lg`; the kinds are `default` (primary), `secondary`, `ghost` (quiet) and `destructive` (danger, no fill until hover). There are no `xs` sizes and no `outline` or `link` variants.

## Fields and switches

- Fields and selects: 40 high (44 at phone width, 48 on sign-in), white fill, 1 px `--input` border, corner 8; focus is the 2 px ring. An error is a 2 px `--destructive` border and one line under the field in `--destructive`.
- A select draws a filled "expand more" icon on the right, never a text caret.
- A segmented control (two to four choices) is a `--accent` track with 4 px padding; the chosen item is white with navy text, the others muted text, 32 high (44 at phone width, so the track is 52).
- Checkboxes use the navy accent colour.

## Icons

- **Material Symbols Rounded, filled** (Apache 2.0): filled and rounded like the brand book's icon page. One set only, drawn from SVG, never from a font ligature (the icon's name would be text in a screen).
- 20 px in menus, buttons and fields; 24 px on phone screens; 16–18 px inline with small text.
- An icon stands next to its word. An icon alone is a button with an `aria-label`, or decoration with `aria-hidden`.
- Common actions: `search`, `notifications`, `download`, `print`, `add`, `edit`, `close`, `expand_more`, `chevron_left`, `chevron_right`, `arrow_back`, `check_circle`, `warning`, `error`, `info`, `inventory_2` (archive), `logout`, `dark_mode`, `light_mode`, `language`, `tune` (settings). Each app's menu icons are in "This app".

## Layout shell

- **Menu:** left, navy in both themes, 240 wide: the one-line logo (on-dark version) at the top, the items (icon and word, 40 high, corner 8, the active one solid orange with navy text), a count as a plain number at the right of an item, and at the bottom the person (round avatar with initials on #1B2A63, name, role) with a sign-out icon button. It can collapse to a 72-wide rail of icons with the shield logo; the choice is kept in the browser.
- **Top bar:** white (dark: #08102F), 64 high, a bottom border: the app's context selects on the left (which ones: "This app"), the search field with "Ctrl K" as plain text at its right, and at the right the notifications button and any app-specific switch.
- **Page:** a header with breadcrumbs (inner pages), the title and its actions at the right; then the content. A short fact may follow the title on the same line in muted text ("74 active, 6 archived"; "Monday, 12 October").
- **Lists:** a toolbar (search field, filter selects, a quiet "Reset", the column chooser as an icon button), a selection bar in `--today` above the table when rows are chosen (count, small secondary actions, quiet "Clear"), the table in a white panel, and the side panel (white, left border) for an opened record with its actions at the bottom: primary "Edit", secondary actions, danger quiet "Archive".
- **Phone width (below 640 px):** the menu becomes a bottom tab bar (navy, the app's main items with icon and word, the active one orange), the top bar keeps the context select and the search button, toolbars wrap, wide tables scroll inside their panel or become cards where the app's spec says so.

## Brand moments

- **Sign-in:** the form on the left (horizontal colour logo, the language select and the theme button at the top; a Bitter title, two fields 48 high, a large primary button the full width of the form); on the right a navy panel with the slogan in Bitter, uppercase, orange, with the brand's line ornament, and a white column of orange hexagons (the brand book's cover). The slogan is a text of the three languages: uz "Taʼlim tarbiyadan boshlanadi", ru "Образование начинается с воспитания", en "Education begins with upbringing". At phone width the navy panel is hidden.
- **Empty page:** in the page's white panel: a Bitter title that says what is missing, one short line (what the page is for), the first action as a primary button and at most one quiet second action; at the right, a small drawing of navy hexagon outlines with one or two orange filled hexagons. At phone width the drawing is hidden.
- **Full-page error** (not found, no access, failed to load the app): like the empty page.
- **Printouts and PDFs:** A4, white; at the top of each page or slip the letterhead strip: a navy tab with the on-dark one-line logo and a rounded top-right corner, followed by an orange band; Golos Text; navy text; no other colour except where the app's spec asks for one (a status, a grey "Draft" word). Which documents: "This app".

## Logo

The same files in both apps (path: "This app"), exact vectors of the brand book:

| File | Use |
| --- | --- |
| `sodiq-logo.svg`, `sodiq-logo-on-dark.svg` | Stacked logo: printouts, About |
| `sodiq-logo-horizontal.svg`, `sodiq-logo-horizontal-on-dark.svg` | One line: sign-in (colour), menu (on dark), letterhead (on dark) |
| `sodiq-mark.svg`, `sodiq-mark-on-dark.svg` | The shield alone: collapsed menu, browser-tab icon |
| `favicon.ico`, `icon-32.png`, `icon-48.png`, `icon-180.png` (Apple touch), `icon-192.png`, `icon-512.png` | Browser and home-screen icons: the shield on white |

The brand book's rules: keep clear space around the logo, never recolour, stretch, rotate, outline, shadow or blur it, never place the colour logo on a busy or orange background; the on-dark version goes on navy. Its smallest height is 10 mm in print and 24 px on screen (the shield alone below that). The logo is part of the app, not a setting.

## Motion

Short and quiet: 120 ms for hover and press, 160 ms for panels and menus opening, ease-out; nothing moves on its own. People who ask the system for reduced motion get none.

## Accessibility

Text 4.5 : 1 and controls 3 : 1 in both themes (checked by the app's contrast test), full keyboard use, the visible focus ring, text that can be enlarged to 200%, touch targets of 44 px at phone width, and no information by colour alone.

## This app: the academic platform

This section belongs to `sodiqschoolapp/sodiq-platform` only.

- **Files.** Tokens in `apps/web/src/index.css`; the contrast test is `apps/web/tooling/contrast.test.ts`; the shadcn/ui button is `apps/web/src/components/ui/button.tsx`; the logo files are in `apps/web/public/brand/`. The page header is `PageHeader`, a list is `ListPage`, and empty, loading and error states are `EmptyState`, `LoadingOutline` and `ErrorState` (`.claude/rules/web.md`).
- **Sign-in.** Under the large button, the link "Forgot your password?" to the password reset by email (`02`, Before the school goes live; "Decided ahead for tasks 2.1 to 2.6", item 16).
- **Top bar.** The selects for branch, academic year and quarter (`12`, Context: always shown); at the right the role switch, a select, when the person has several roles.
- **Menu icons.** Today `home`, Timetable `calendar_month`, Journals `menu_book`, Lesson plans `assignment`, Results `bar_chart`, Requests `forum`, Staff `group`, Students `school`, Classes and groups `grid_view`, Subjects `auto_stories`, Settings and School setup `tune`, Audit log `history` (task 2.6a).
- **Phone tab bar.** The role's first four menu items and "More". This is the owner's decision of 12 October 2026 (`docs/decisions.md`, "one design for both apps"); `12`, Devices lists which functions work on a phone, not the tab bar.
- **Subject colours.** The 12 subject colours of task 2.1 stay as they are (keys and values in `index.css`): a timetable tile or a chip is the colour's 15% tint with the subject in the normal text and a 10 px square of the full colour. A subject colour never carries meaning alone: the subject's name is always written.
- **Status labels: grades and attendance marks.** Always the digit; colour only helps. Grade 2 danger tint, 3 warning tint, 4 info tint, 5 success tint, each with its text colour. Attendance marks in the journal: 1 plain; 0 and 3 danger tint; 2 warning tint; 4 and 5 (exempt) muted fill with muted text.
- **Printouts.** The first-password slips (task 2.3: four per A4 page with cut lines; name, role, the three steps to sign in at the site's address, and a box with login, password and date of issue), the personal data report (2.6), and later the PDF exports.
