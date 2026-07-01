# OtterNote Technical Plan

## 1. Product Direction

OtterNote is a lightweight personal work note and ToDo application.

The product should feel close to a ChatGPT-style workspace:

- Left sidebar for search, creation, recent content, and navigation
- Right content area for the selected module or selected item
- Timeline as the default landing page
- Notes and ToDo items connected by context

The first version should focus on local-first desktop usage. Mobile can be considered later after the desktop workflow is stable.

## 2. Recommended Stack

Use a Web-first desktop stack:

```text
Tauri + React + TypeScript + Vite
```

Supporting libraries:

```text
UI: Tailwind CSS + shadcn/ui
State: Zustand
Editor: CodeMirror 6
Local database: SQLite through Tauri plugin or Rust-side SQLite
Testing: Vitest + Playwright
```

## 3. Why This Stack

### Tauri

Tauri is suitable because OtterNote is a desktop tool with local data and system integration needs.

Benefits:

- Smaller and lighter than Electron
- Uses system WebView
- Good fit for local-first desktop apps
- Can expose native commands to the frontend
- More suitable than Wails if future mobile support is still possible

### React + TypeScript + Vite

React is recommended because the app has a rich interactive UI:

- Sidebar navigation
- Search
- Timeline
- Note editor
- ToDo list
- Dialogs and command-style actions

TypeScript keeps note, ToDo, and activity models explicit.

Vite keeps local development fast.

### Tailwind CSS + shadcn/ui

Tailwind handles layout and responsive styling.

shadcn/ui provides high-quality components while keeping source code inside the project:

- Button
- Input
- Dialog
- Dropdown Menu
- Checkbox
- Scroll Area
- Resizable Panels
- Command
- Toast

### Zustand

Zustand should manage UI state:

- Current navigation section
- Selected note
- Search keyword
- ToDo filters
- Sidebar state
- Theme

Persistent data should live in SQLite, not Zustand.

## 4. Local Data Strategy

Use SQLite as the durable local database.

Recommended access options:

1. Rust-side SQLite through Tauri commands
2. Tauri SQL plugin

For the first implementation, keep a repository layer so the UI does not depend directly on SQLite details.

Suggested layers:

```text
src/
  features/
  shared/
  db/
  stores/
  types/
src-tauri/
  src/
    commands/
    db/
```

## 5. Core Data Models

### Note

```ts
type Note = {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  archivedAt?: string
}
```

### NoteEntry

Use entries instead of one large note body.

Each user submission creates a new entry, similar to messages in ChatGPT.

```ts
type NoteEntry = {
  id: string
  noteId: string
  content: string
  createdAt: string
  updatedAt: string
}
```

### Todo

ToDo items can be standalone or extracted from a note entry.

```ts
type Todo = {
  id: string
  noteId?: string
  entryId?: string
  title: string
  status: "todo" | "done"
  source: "entry" | "standalone"
  createdAt: string
  updatedAt: string
  completedAt?: string
}
```

### Activity

Timeline should be backed by explicit activity records.

```ts
type Activity = {
  id: string
  type:
    | "note_created"
    | "note_updated"
    | "entry_created"
    | "todo_created"
    | "todo_completed"
    | "todo_deleted"
  noteId?: string
  entryId?: string
  todoId?: string
  title: string
  createdAt: string
}
```

## 6. ToDo Parsing

Note entries should support Markdown task syntax:

```markdown
- [ ] Check token expiration logic
- [x] Confirm UI layout
```

Rules:

- When an entry is submitted, parse task lines.
- Create ToDo records for each task line.
- Store source relation through `noteId` and `entryId`.
- Global ToDo list shows all ToDo records.
- Completing a ToDo updates the ToDo record.
- The source entry should render the updated checkbox state.

Because entries are append-style, this is simpler than editing one large Markdown document.

## 7. MVP Scope

Included:

- Tauri desktop app
- React + TypeScript + Vite frontend
- Two-column ChatGPT-style layout
- Timeline default page
- Notes
- Note entries
- ToDo parsing from entries
- Global ToDo List
- Search entry point
- Settings and Help placeholders
- SQLite local persistence

Excluded from MVP:

- Cloud sync
- User account
- Mobile app
- Collaboration
- Attachments
- AI summary
- Rich block editor
- Complex recurring tasks

## 8. Suggested Project Structure

```text
OtterNote/
  docs/
    technical-plan.md
    ui-design.md
  src/
    app/
      App.tsx
      layout/
    features/
      timeline/
      notes/
      todos/
      search/
      settings/
      help/
    shared/
      components/
      db/
      stores/
      types/
      utils/
  src-tauri/
    src/
      commands/
      db/
      main.rs
  package.json
  vite.config.ts
```

## 9. Implementation Phases

### Phase 1: Foundation

- Create Tauri + React + TypeScript + Vite project
- Add Tailwind CSS
- Add shadcn/ui
- Add Zustand
- Create two-column app shell

### Phase 2: Local Data

- Add SQLite
- Define Note, NoteEntry, Todo, Activity tables
- Implement repository functions
- Add seed/empty state logic

### Phase 3: Core Workflow

- Implement Timeline default page
- Implement Notes list and note detail
- Implement bottom composer for note entries
- Parse ToDo items from submitted entries
- Implement global ToDo List

### Phase 4: Polish

- Search
- Recent content list
- Settings page
- Help page
- Keyboard shortcuts
- Empty states
- Basic tests

