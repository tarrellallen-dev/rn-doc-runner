import test from "node:test";
import assert from "node:assert/strict";
import { selectNearestQualifyingPredecessor, type ChartEpisode } from "@rn-doc-runner/queue-engine";
import * as rules from "@rn-doc-runner/rules";

const EXPECTED_AUTHOR = "Nurse, Demo (RN)";
const destinationDateMs = rules.parseUsDate("07/28/2026")!;

test("T03: multiple earlier same-type documents -> the nearest (latest still-earlier) qualifying source is selected", () => {
  const episodes: ChartEpisode[] = [
    {
      episodeId: "ep-1",
      label: "Episode #1 (current)",
      rows: [{ documentId: "current", form: "Skilled Nurse Visit Note", date: "07/28/2026", author: EXPECTED_AUTHOR, status: "Pending" }]
    },
    {
      episodeId: "ep-2",
      label: "Episode #2 (older)",
      rows: [
        { documentId: "far", form: "Skilled Nurse Visit Note", date: "05/01/2026", author: EXPECTED_AUTHOR, status: "Completed" },
        { documentId: "near", form: "Skilled Nurse Visit Note", date: "06/15/2026", author: EXPECTED_AUTHOR, status: "Completed" }
      ]
    }
  ];
  const result = selectNearestQualifyingPredecessor(episodes, { formType: "Skilled Nurse Visit Note", expectedAuthor: EXPECTED_AUTHOR, destinationDateMs });
  assert.equal(result.ok, true);
  assert.equal(result.documentId, "near");
});

test("two candidates tied for nearest date is ambiguous chronology, not an arbitrary pick", () => {
  const episodes: ChartEpisode[] = [
    {
      episodeId: "ep-2",
      label: "Episode #2 (older)",
      rows: [
        { documentId: "a", form: "Skilled Nurse Visit Note", date: "06/15/2026", author: EXPECTED_AUTHOR, status: "Completed" },
        { documentId: "b", form: "Skilled Nurse Visit Note", date: "06/15/2026", author: EXPECTED_AUTHOR, status: "Completed" }
      ]
    }
  ];
  const result = selectNearestQualifyingPredecessor(episodes, { formType: "Skilled Nurse Visit Note", expectedAuthor: EXPECTED_AUTHOR, destinationDateMs });
  assert.equal(result.ok, false);
  assert.deepEqual(result.failures, ["ambiguous_predecessor_chronology"]);
});

test("T04: a qualifying document in an older episode is found even when the nearer episode has none", () => {
  const episodes: ChartEpisode[] = [
    { episodeId: "ep-1", label: "Episode #1 (current)", rows: [] },
    { episodeId: "ep-2", label: "Episode #2 (no qualifying documents)", rows: [] },
    {
      episodeId: "ep-3",
      label: "Episode #3 (oldest)",
      rows: [{ documentId: "old", form: "Skilled Nurse Visit Note", date: "04/02/2026", author: EXPECTED_AUTHOR, status: "Completed" }]
    }
  ];
  const result = selectNearestQualifyingPredecessor(episodes, { formType: "Skilled Nurse Visit Note", expectedAuthor: EXPECTED_AUTHOR, destinationDateMs });
  assert.equal(result.ok, true);
  assert.equal(result.documentId, "old");
});

test("wrong author, wrong form, and same/later dates are all excluded from candidacy", () => {
  const episodes: ChartEpisode[] = [
    {
      episodeId: "ep-2",
      label: "Episode #2",
      rows: [
        { documentId: "wrong-author", form: "Skilled Nurse Visit Note", date: "06/01/2026", author: "Rivera, Jordan (RN)", status: "Completed" },
        { documentId: "wrong-form", form: "OASIS/Nurse Recert", date: "06/01/2026", author: EXPECTED_AUTHOR, status: "Completed" },
        { documentId: "not-earlier", form: "Skilled Nurse Visit Note", date: "07/28/2026", author: EXPECTED_AUTHOR, status: "Completed" },
        { documentId: "later", form: "Skilled Nurse Visit Note", date: "08/01/2026", author: EXPECTED_AUTHOR, status: "Completed" }
      ]
    }
  ];
  const result = selectNearestQualifyingPredecessor(episodes, { formType: "Skilled Nurse Visit Note", expectedAuthor: EXPECTED_AUTHOR, destinationDateMs });
  assert.equal(result.ok, false);
  assert.deepEqual(result.failures, ["no_qualifying_predecessor"]);
});

test("no documents anywhere in the chart -> no_qualifying_predecessor", () => {
  const result = selectNearestQualifyingPredecessor([], { formType: "Skilled Nurse Visit Note", expectedAuthor: EXPECTED_AUTHOR, destinationDateMs });
  assert.equal(result.ok, false);
  assert.deepEqual(result.failures, ["no_qualifying_predecessor"]);
});
