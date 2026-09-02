# RN DOC Runner — User Guide

RN DOC Runner takes the repetitive mechanical work out of clearing your
documentation queue — finding the right prior note, carrying forward the
selections you'd copy forward anyway, running the date-update steps —
and leaves every clinical decision, review, signature, and submission to
you.

## Quick start

1. **Add Worklist** — pick a photo, PDF, or CSV of your pending list.
2. Check the rows, fix anything wrong, then **Confirm Queue**.
3. **Start Batch**.
4. When it's done, open **Completed Drafts** and **Exceptions**, click
   **Open Draft for Review** on each, and finish your own review,
   narrative, and signature as usual.

That's the whole thing. Details below.

## The three-action workflow

```
Add Worklist → Confirm Queue → Start Batch
```

### 1. Add worklist

Open RN DOC Runner and click **Add Worklist**. Choose a photo of your
pending-documentation list, a PDF, or a CSV export. RN DOC Runner reads
it entirely on your Mac — nothing is uploaded anywhere.

### 2. Review and confirm the queue

You'll see a table of what was read from your worklist next to a
preview of the source photo or PDF page each row came from, so you can
compare them side by side. Correct anything misread (patient name,
form date, form type), remove a row that shouldn't be there, or add
one that was missed. Anything low-confidence or flagged as a duplicate
is called out; **Confirm Queue** stays disabled until every row is
ready. This is the one review step before anything automated happens.

### 3. Start Batch

Click **Start Batch**. RN DOC Runner will, for each queued document:

- Open the matching pending document and verify it's really the right
  patient, MR, form, date, and author before touching anything.
- Find and verify the nearest qualifying prior note.
- Carry forward only the repeatable selections (checkboxes, radio
  buttons, dropdown choices) that have been explicitly approved for
  that exact form — never vitals, pain scores, wound measurements,
  medication facts, numbers, comments, or narrative text.
- Run any configured date-update steps (e.g., Plan of Care red links),
  using the visit date already verified on that page.
- Save the page as a draft.
- Move to the next page or the next document.

If anything is unclear, ambiguous, or doesn't match — wrong author,
no qualifying prior note, a form RN DOC Runner doesn't have an approved
configuration for, a save that didn't clearly succeed — that entry is
set aside for your review instead of guessing. The batch keeps going;
one problem entry never stops the rest of your queue.

You can **Pause**, **Resume**, or hit **Stop** at any time from the
Running Batch screen. Stop cancels further action immediately — nothing
already saved is undone.

### 4. Review completed drafts and exceptions

When the batch finishes, **Completed Drafts** lists what RN DOC Runner
finished, and **Exceptions** lists what needs your attention (needs
review, skipped, or blocked — each with a plain, non-clinical reason).
Click **Open Draft for Review** on any item to open that exact document
in a real browser window — RN DOC Runner never signs or submits
anything itself. **You still open each draft, confirm the current
clinical picture, correct anything that needs it, write/approve the
narrative, and sign and submit yourself.**

## What RN DOC Runner will never do

- Invent or guess a clinical fact.
- Copy vitals, pain scores, wound measurements, medication
  administration details, or any narrative/comment text.
- Sign, submit, finalize, lock, or send anything to your office.
- Continue past a document where the patient, MR, form, date, or author
  don't check out.

## Settings

- **Clear Session** — clears RN DOC Runner's temporary in-memory state.
- **Delete Imported Worklist** — deletes the worklist data you imported.
- **Retention** — by default, RN DOC Runner deletes a batch's
  patient-level queue data once you confirm the batch is closed out.
  This is configurable in Settings.

## If something goes wrong

- **Session expired**: RN DOC Runner pauses and asks you to log back
  into the EHR yourself — it never stores or re-enters your credentials.
- **App or browser restart**: reopen RN DOC Runner; if a batch was in
  progress, a **Resume Batch** button appears on Home. Nothing already
  saved is ever redone, and nothing left ambiguous is ever silently
  retried.

## Current limitations

RN DOC Runner today runs against a **synthetic test environment** only
— see [KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md). Enabling it against
your real EHR requires a validated site adapter and organizational
approval, which have not yet been completed.
