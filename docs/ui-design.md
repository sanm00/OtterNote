# OtterNote UI Design

## 1. Layout Direction

OtterNote should use a ChatGPT-like two-column layout.

Overall structure:

```text
┌────────────────────────┬──────────────────────────────────────┐
│ Left Sidebar            │ Right Content Area                    │
│                        │                                      │
│ App name               │ Selected navigation content            │
│ Search                 │                                      │
│ New                    │ Timeline / Notes / ToDo / Settings    │
│ Today or Recent        │                                      │
│ Navigation             │ Empty state when no content exists     │
└────────────────────────┴──────────────────────────────────────┘
```

The left side is stable. The right side changes based on the selected navigation item or selected recent content.

## 2. Visual Style

Use a restrained two-blue theme.

Recommended roles:

- Primary blue: active navigation, main action, focus state
- Secondary blue: sidebar background, selected row, subtle highlight
- Content background: white or near-white
- Text: neutral high-contrast
- Secondary text: muted neutral
- Done state: green or muted gray
- Warning: amber
- Danger: red

The app should feel like a focused tool, not a marketing page.

Avoid:

- Large hero sections
- Decorative gradients
- Heavy card nesting
- Overly colorful surfaces

## 3. Left Sidebar Structure

The left sidebar order is fixed from top to bottom:

```text
OtterNote

[ Search input ]

[ + New ]

Today / Recent
- Recent item
- Recent item
- Recent item

Navigation
- Notes
- ToDo List
- Timeline
- Settings
- Help
```

### App Name

Display the product name clearly:

```text
OtterNote
```

### Search Box

The search box should be near the top.

Placeholder:

```text
Search notes, todos...
```

Search should cover:

- Note titles
- Note entries
- ToDo titles

### New Entry

The new entry should be visually prominent.

Suggested label:

```text
+ New
```

Clicking it opens a small menu:

```text
New Note
New ToDo
Quick Record
```

### Today Or Recent Content

This section should show today's content first.

If there is no content from today, show recently created or recently updated content.

Suggested behavior:

- Max 8-12 items
- Click item to open it on the right
- Show note title or brief entry title
- Use subtle timestamp metadata

### Navigation

Navigation items:

```text
Notes
ToDo List
Timeline
Settings
Help
```

The active item should use primary blue.

## 4. Right Content Area

The right content area displays the content for the selected sidebar item.

Default page:

```text
Timeline
```

If the app has no content, show the empty state instead of an empty timeline.

## 5. Empty State

When there are no notes, entries, or ToDo items, the right side should show:

```text
Search
[ Search notes, todos... ]

Create
[ New Note ] [ New ToDo ] [ Quick Record ]
```

This prevents the first launch from feeling blank.

The empty state should be centered but not oversized.

## 6. Timeline Page

Timeline is the default landing page.

Purpose:

- Show recent work activity
- Help the user resume work quickly
- Provide a chronological view of notes and ToDo events

Example:

```text
Timeline

Today
09:30  Created note: Login issue investigation
10:20  Completed ToDo: Add API test
14:10  Updated note: OtterNote UI design

Yesterday
16:40  Created note: Meeting notes
```

Timeline event types:

- Note created
- Note updated
- Entry added
- ToDo created
- ToDo completed
- ToDo deleted

Clicking a timeline event opens the related note or ToDo.

## 7. Notes Page

Notes page shows note list and note detail in the right content area.

Recommended desktop layout inside right content:

```text
Notes list | Current note
```

Current note should look like a conversation/work log:

```text
Note title
Tags / metadata

Entry
Entry
Entry with checklist

[ Composer at bottom ]
```

The composer is used to append new content to the current note.

Example input:

```markdown
Investigated login failure.

- [ ] Check token expiration logic
- [ ] Add API regression test
```

Submitting the composer creates a new `NoteEntry` and parses ToDo items.

## 8. ToDo List Page

ToDo List is the global task view.

Example:

```text
ToDo List

Incomplete
[ ] Check token expiration logic
    Source: Login issue investigation

[ ] Add API regression test
    Source: Login issue investigation

Done
[x] Confirm layout direction
    Source: UI redesign
```

Each ToDo row should show:

- Checkbox
- Title
- Source note if available
- Created or completed time when useful

Clicking the source opens the related note.

## 9. Settings Page

Settings should be simple in MVP.

Suggested items:

- Theme
- Data location
- Export data
- About

Do not overbuild settings in the first version.

## 10. Help Page

Help should explain the minimum usage needed.

Content:

```text
Markdown ToDo:
- [ ] incomplete task
- [x] completed task

Use New to create notes or tasks.
Use Timeline to review recent activity.
```

## 11. Interaction Rules

- App opens to Timeline by default.
- If there is no content, right side shows empty state.
- Search is always available from the sidebar.
- New is always available from the sidebar.
- Recent content opens directly in the right content area.
- Notes navigation opens the notes workspace.
- ToDo List navigation opens the global ToDo list.
- Timeline navigation opens chronological activity.
- Settings and Help open simple utility pages.

## 12. Mobile Adaptation

Mobile can keep the same information architecture, but the sidebar becomes a drawer.

Mobile structure:

```text
Top bar: Menu | Current page | New
Drawer: same sidebar content
Main: right content area
```

For MVP, desktop should be prioritized.

