# How we made an EPUB reader's library portable without slowing it down

*Draft for a blog post. Conversational tone; designed to be stolen and rewritten.*

---

A few weeks ago I sat down to fix something that bothers me about every
desktop reader I've used: your **library is trapped inside the app**.
Your progress, tags, ratings, the collections you spent an evening
organising — all of it lives in some app-private SQLite blob, somewhere
under `~/Library/Application Support/`, going nowhere. Open the same
library on a second machine and start over. Uninstall the app and you
might as well have never read those books.

I wanted Atlas, the reader I've been building, to feel different. Not in
a marketing way. In an *if I uninstall this app right now, what
happens?* way.

The answer ought to be: nothing meaningful. The books are still on disk.
The metadata is still there in a format any human can read. Another app
could pick it up tomorrow.

This is roughly the philosophy Obsidian calls **file over app** — the
idea that your data should outlive the tool you happen to be using. For
notes Obsidian's solution is famous: your vault is a folder of plain
markdown files. Sync is your problem; pick iCloud or Dropbox or
Syncthing or git or whatever you're already paying for. The app is a
window, not a warehouse.

The interesting question was: **can you do this for a reader app without
losing the speed of having a real database underneath?**

I think the answer is yes, and the trick is more boring than I expected.
Here's how we got there.

## The two wrong answers I tried not to take

### "Just put the SQLite in iCloud"

Seductive. SQLite is *already* the source of truth. Move the file into
the synced folder and you're done. Right?

No.

SQLite's WAL (write-ahead log) and SHM (shared memory) files are
sidecars to the main `.db` file. Cloud sync clients have no idea those
three files are part of one logical unit. iCloud will happily upload the
`.db` while you're still writing to the WAL, or sync a stale WAL onto
another machine after the main file changed. The corruption modes are
exotic and silent — your data isn't *deleted*, it just slowly drifts
into nonsense. There are GitHub threads going back years about people
losing notebooks this way.

You can disable WAL and switch to rollback journals. You can fsync more
aggressively. None of it really fixes the underlying problem, which is
that a database is a thing you write to *continuously* and a cloud
drive is a thing built to sync *files at rest*.

So: SQLite stays out of the synced folder. Always.

### "Per-book sidecars"

The next idea is what most "open" tools do: for every `book.epub`,
write a `book.epub.atlas.json` next to it with the metadata. No
database. Pure files. Maximum file-over-app virtue.

This sort of works. You can grep your library. You can diff it. You
never have to think about merge conflicts on a whole-library scale —
worst case you get one conflict per book.

But the performance story is grim. To render a library view of 10,000
books you have to:

1. `readdir` the whole tree.
2. Open and parse 10,000 small JSON files.
3. Build the indexes you need for sorting, filtering, search.

That's tens of thousands of syscalls per cold start. Even with an SSD
and a warm OS cache, you're looking at hundreds of milliseconds. Worse,
every interaction (sort by author, filter by tag) either rescans those
files or maintains its own in-memory index — at which point you've
reinvented a database, badly.

I drew this on a napkin, looked at it, and went back to the drawing
board.

## The middle path: portable manifest + local cache

The actual solution is mundane: **one manifest file**, written
atomically, serves as the portable source of truth; **SQLite stays
exactly where it was**, repurposed as a local derived cache.

```
<vault>/                            ← synced
├── Books/
│   └── *.epub
└── .atlas/
    ├── library.json                ← THE portable file
    ├── settings.json
    └── covers/

~/Library/Application Support/Atlas/    ← never synced
├── cache.db                        ← derived from library.json
└── vaults.json                     ← which folders are my vaults?
```

The rule that keeps everything sane: **if it's in the vault, it's
truth. If it's only in the cache, it can be rebuilt from the vault for
free.**

Delete cache.db? Atlas re-parses the manifest on next launch — you lose
nothing, just pay the parse cost once. Delete the manifest? You're
back to a single-device library, but no data is gone, the cache has
everything. Both files have something the other doesn't (manifest has
portability, cache has speed), and either can be rebuilt from
elsewhere.

This is the part I want to highlight: **two representations of the same
data, with a clear directionality between them.** The runtime always
queries the cache. The vault is the durable record.

## The cost calculation

When does the manifest actually get touched? It turns out to be just
three moments:

- **Cold start**: one `fs::read` and one `serde_json::from_slice`. For
  10,000 books the file is 5–10 MB; on an SSD that's well under 50ms.
  The result is folded into the cache once. Every subsequent
  list/filter/sort query hits SQLite exactly as before.
- **Warm start**: we keep a `last_manifest_mtime` row in the cache. If
  the file on disk hasn't changed, we skip the parse entirely. Warm
  starts are byte-for-byte identical to today.
- **Write**: every mutation hits SQLite immediately (UI stays instant).
  A background task flushes the manifest to disk ~500ms after the last
  edit, debounced. The flush is `write tmp → fsync → rename`, which is
  atomic on every filesystem worth supporting.

That's it. The runtime cost is "one file read on cold start," and the
runtime cost on warm start is zero.

For reading progress specifically — which fires on every page turn — we
use a longer debounce (5 seconds, or whenever the reader closes). The
cache gets every update; the manifest gets one update per reading
session. SQLite is durable the moment we write it, so a crash before
flush only loses the *portable copy* of the last few seconds, not the
data itself.

## Render-from-cache-while-parsing

The other detail I'm pleased with: cold start renders the library
**immediately** from the cache, then folds in any remote changes a beat
later.

```
launch
  ├── synchronously: open cache.db, query books, paint UI    ← ~10ms
  └── background:    stat manifest, parse if newer,
                     apply deltas, emit library-updated      ← ~50ms
```

The UI never waits on the manifest. If a sibling device wrote
something while you were away, you see your library appear instantly
and then quietly update — same feel as Obsidian opening a vault that
synced overnight. Skeleton shimmer is reserved for the truly first
launch (no cache yet).

## Identity is content, not path

A subtle decision that pays off everywhere: a book's identity is the
**SHA-256 of its file content**, not its on-disk path or database
rowid.

Why this matters:
- Rename `the-dispossessed.epub` to `Le Guin - The Dispossessed.epub`
  → nothing breaks. Same hash.
- Import the same EPUB on two devices independently before any sync
  ever happens → same hash → they merge cleanly when the manifests
  meet.
- Move books between folders inside the vault → still the same book.

The cache.db keeps integer rowids because joins are faster with them,
but those rowids are *local and meaningless across devices*. The
manifest never mentions them. Every cross-device reference is by
content hash, every cross-device collection reference is by name.

This rule — *integer ids are local, hashes and names are portable* —
took about three iterations to internalise. Once it clicks, a lot of
other design questions answer themselves.

## Conflicts

When two devices edit the same library offline and then both sync,
cloud drives produce a sibling file like `library (jack's Mac).json`.
On launch Atlas detects it, parses both, and does **last-write-wins
per record** keyed by content hash, using a `updated_at` timestamp
stored on every book entry. The conflict copy gets moved into
`.atlas/conflicts/<timestamp>.json` so users can recover anything we
got wrong. A non-blocking toast surfaces the result: *"Merged 3
changes from jack's Mac."*

The reason this works is that the unit of conflict is the **book
record**, not the file. If you tagged a book on your laptop and rated
the same book on your phone, both writes survive — they touched
different fields. If you actually conflicted on the same field, the
newer timestamp wins, and the old value is recoverable in the
conflict directory for at least 30 days.

This is fundamentally easier than git-style 3-way merge because
records are small, independent, and tagged with provenance.

## What you give up

I want to be honest about the tradeoffs:

- **One big file means one big conflict.** If two devices write
  simultaneously you get one whole-library merge instead of one merge
  per book. Per-record `updated_at` makes this fine in practice — the
  merge is mechanical — but if you ever picture two power users
  hammering the same vault with rapid edits, sidecar-per-book has
  better conflict granularity.
- **Cold-start parse cost grows linearly** with library size. At
  10k books you're <50ms. At 100k books you'd want either streaming
  parse or a sharded manifest. Not a problem I have today.
- **Cover images.** We currently keep them in app-data, derivable from
  the EPUB on import. A future migration moves them into
  `.atlas/covers/` so they sync too. The "vault contains everything"
  property is only fully true once that's done.

## Things I didn't expect to matter

A few small things turned out to be load-bearing:

**Atomic writes are non-negotiable.** Cloud sync clients are *very*
willing to upload a partially-written file. Write to `library.json.tmp`,
fsync it, then rename. Every time. Never `File::create("library.json")`
and hope.

**Deterministic output.** I serialise the books map with a `BTreeMap`,
not a `HashMap`, so the JSON is sorted by content hash. Diffs make
sense. Users who put their vault in git get a free reading-history log
where every commit is a real, readable change.

**Forward compatibility.** Every record has a `#[serde(flatten)] extra:
BTreeMap<String, Value>` field that catches unknown keys and writes
them back unchanged. An older Atlas reading a newer schema doesn't
silently drop data. This is the kind of thing you only appreciate the
first time you ship a breaking change.

**Don't put SQLite in the vault.** Worth saying twice.

## Takeaways

If you're designing storage for a desktop app and you want it to
"just work" across devices, the pattern I'd reach for now:

1. **Two representations.** One portable (lives with the user's data,
   syncs with their files). One fast (lives in app-data, can always be
   rebuilt). Make the direction between them explicit.
2. **Atomic writes for the portable side. Always.** Cloud drives have
   a long list of horror stories, and "torn file" is at the top of it.
3. **Content-addressable identity** for anything that should survive a
   move or a cross-device import. Integer rowids are great inside the
   cache and a footgun outside it.
4. **Debounce mutations** into the portable file. The UI runs against
   the cache; the portable file catches up. Define your debounce in
   terms of what's expected (page-turn floods vs single edits), not
   one global number.
5. **Render from cache, fold in remote changes after.** Users never
   wait on sync. The UI lies a tiny bit (you're seeing data from
   200ms ago) in exchange for never feeling slow.
6. **Forward-compatible schemas from day one.** A flatten-extras field
   is cheap insurance. The first time you ship v2 and a v1 build
   gracefully round-trips the new fields, you'll be grateful.

None of this is novel. Obsidian's vault model, content-addressable
storage from git, write-ahead logging from every database ever — it's
just the well-known parts wired together carefully. But the *combination*
gives you something that feels nice to use: an app whose data doesn't
need it to exist.

That's the version of file-over-app worth caring about. Not the
ideology, the consequence: **your library is yours, and the app is
just a way to look at it today.**
