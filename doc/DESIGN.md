Design Principles
-----------------
The primary metaphor is *direct manipulation*. jjuicy aims to present a view of the repository's 
conceptual contents - revisions, changes to files, synced refs and maybe more - which can be
modified, using right-click and drag-drop, to 'edit' the repo as a whole. 

Jujutsu CLI commands sometimes have a lot of options (`rebase`) or are partially redundant 
for convenience (`move`, `squash`). This is good for scripting, but some use cases demand 
interactivity - reordering multiple commits, for example. Hopefully, `gg` can complement `jj`
by providing decomposed means to achieve some of the same tasks, with immediate visual feedback.

The UI uses a couple of key conventions for discoverability:
- An *actionable object* is represented by an icon followed by a line of text. These are
  drag sources, drop targets and context menu hosts. 
- Chrome and labels are greyscale; anything interactable uses specific colours to indicate
  categories of widget or object states.

Layout
------
The window is a header, a body and a status bar (`app/Shell.svelte`).
- The header (`app/shell/Header.svelte`) holds repo-level actions: sidebar toggle, refresh,
  fetch/push, the repo/workspace breadcrumb, terminal and settings. It doubles as the window's
  drag region, so interactive children must opt back in to pointer events.
- The body is built from `SplitView` panes (`app/shell/SplitView.svelte`), whose sizes persist.
- The status bar (`app/shell/StatusBar.svelte`) shows the latest operation with undo, and
  counters from `RepoStatus.summary`. Clicking a counter filters the log through
  `logQueryRequest`. The backend caps counts and skips the summary on large repos, so the
  counters are cheap to keep current.
- Log rows have a fixed height per `jjuicy.ui.log-density` (`app/log/density.ts`): compact
  rows are one line, comfortable rows are cards with id/refs, a two-line description and an
  author line. Virtualisation and graph geometry both read that height, so a row's content
  must never change its height.
- The main body is Log | Files | Detail. The files column (`app/files/FilesPane.svelte`) and the
  detail pane share one `selectedFile` store; each resolves it against its own revisions, so a
  file stays selected across revisions that touch it and falls back to the first file otherwise.
  File rows are `ChangeObject`s, so they remain drag sources for moving changes between revisions.
- Chips use a `variant` (bookmark, wc, conflict, divergent, tag, remote, immutable) mapped to
  `chip*` theme tokens. Selection is a tint and a left bar rather than a fill, so chip and id
  colours stay legible on the selected row.

Architectural Choices
---------------------
In order to create a quality desktop app, a pure webapp is out of scope. However, significant
portions of the code could be reused in a client server app, and we won't introduce *needless*
coupling. `mod worker` and `ipc.ts` are key abstraction boundaries which keep Tauri-specific
code in its own glue layers.

Each window has a worker thread which owns `Session` data. A session can be in multiple states,
including:
- `WorkerSession` - Opening/reopening a workspace
- `WorkspaceSession` - Workspace open, able to execute mutations
- `QuerySession` - Paged query in progress, able to fetch efficiently

IPC is divided into four categories, which is probably one too many:
- Client->Server **triggers** cause the backend to perform native UI actions.
- Client->Server **queries** request information from the session without affecting state.
- Client->Server **mutations** modify session state in a structured fashion.
- Server->Client and Client->Client **events** are broadcast to push information to the UI.

Drag & drop capabilities are implemented by `objects/Object.svelte`, a draggable item, and
`objects/Zone.svelte`, a droppable region. Policy is centralised in `mutators/BinaryMutator.ts`.

Bookmark Objects
--------------
The representation of bookmarks, in JJ and jjuicy, is a bit complicated; there are multiple state axes.
A repository can have zero or more **remotes**. 
A **local bookmark** can track zero or more of the remotes. (Technically, remote *branches*.)
A **remote bookmark** can be any of *tracked* (a flag on the ref), *synced* (if it points to the same 
commit as a local bookmark of the same name), and *absent* (if there's a local bookmark with *no* ref, 
in which case it will be deleted by the CLI on push.

jjuicy attempts to simplify the display of bookmarks by combining refs in the UI. Taking advantage of 
Jujutsu's model, which guarantees that a bookmark name identifies the same bookmark across remotes, a 
local bookmark and the tracked remote bookmarks with which it is currently synced are be combined into
a single UI object. Remote bookmarks are displayed separately if they're unsynced, untracked or absent.

Consequently, the commands available for a bookmark as displayed in the UI have polymorphic effect:
1) "Track": Applies to any remote bookmark that is not already tracked. 
2) "Untrack": 
    - For a *tracking local/combined bookmark*, untracks all remotes.
    - For an *unsynced remote bookmark*, untracks one remote.
3) "Push": Applies to local bookmarks tracking any remotes. 
4) "Push to remote...": Applies to local bookmarks when any remotes exist.
5) "Fetch": Downloads for a specific bookmark only. 
    - For a *tracking local/combined bookmark*, fetches from all remotes.
    - For a *remote bookmark*, fetches from its remote.
6) "Fetch from remote...": Applies to local bookmarks when any trackable remotes exist.
7) "Rename...": Renames a local bookmark, without affecting remote bookmarks. 
  - For a *nontracking local bookmark*, just renames.
  - For a *tracking/combined bookmark*, untracks first.
8) "Delete": Applies to a user-visible object, not combined objects.
   - For a *local/combined bookmark*, deletes the local ref. 
   - For a *remote bookmark*, forgets the remote ref (which also clears pending deletes.)

Multiple-dispatch commands:
1) "Move": Drop local bookmark onto revision. Sets the ref to a commit, potentially de- or re-syncing it.
2) "Track": Drop remote bookmark onto local of the same name. 
3) "Delete": Drag almost any bookmark out, with polymorphic effect (see above).

Displaying the bookmark state is a bit fuzzy. The idea is to convey the most useful bits of information at 
a glance, and leave the rest to tooltips or context menus. Most bookmarks display in the 
"modify" state; "add" and "remove" are used only for *unsynced* bookmarks, with unsynced locals being "add"
and unsynced or absent remotes "remove". 

This is vaguely analogous to the more straightforward use of modify/add/remove for file changes, adapted to 
the fact that many bookmark states are "normal"; the mental shorthand is that add/green means that pushing will 
cause a remote to set this ref, and remove/red means the remote will no longer contain this ref (at this pointer).

Additionally, a dashed border (like the dashed lines used for elided commits) has a special meaning, also
fuzzy: this ref is "disconnected", either local-only or remote-only. Disconnected local bookmarks are ones 
which have no remotes (in a repo that does have remotes); disconnected remote bookmarks are ones which will
be deleted on push (with an absent local ref).