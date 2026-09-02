import test from "node:test";
import assert from "node:assert/strict";
import {
  SiteAdapterSchema,
  FieldAllowlistEntrySchema,
  AuditEventSchema,
  RetentionConfigSchema,
  DEFAULT_RETENTION_CONFIG
} from "@rn-doc-runner/contracts";

test("a disabled/unconfigured site adapter with empty allowlist is valid", () => {
  const result = SiteAdapterSchema.safeParse({
    enabled: false,
    status: "UNCONFIGURED",
    adapterVersion: "UNCONFIGURED",
    expectedOrigin: "https://example-ehr.invalid",
    expectedAuthor: "Nurse, Demo (RN)",
    identitySelectors: { patient: "", mr: "", form: "", date: "", author: "", page: "" },
    allowlist: []
  });
  assert.equal(result.success, true);
});

test("an adapter cannot be enabled without APPROVED status and a non-empty allowlist", () => {
  const enabledButUnconfigured = SiteAdapterSchema.safeParse({
    enabled: true,
    status: "UNCONFIGURED",
    adapterVersion: "v1",
    expectedOrigin: "https://example-ehr.invalid",
    expectedAuthor: "Nurse, Demo (RN)",
    identitySelectors: { patient: "#p", mr: "#m", form: "#f", date: "#d", author: "#a", page: "#pg" },
    allowlist: []
  });
  assert.equal(enabledButUnconfigured.success, false);
});

test("radio allowlist entries require a group", () => {
  const missingGroup = FieldAllowlistEntrySchema.safeParse({
    key: "p2::status::yes",
    selector: "#status-yes",
    type: "radio",
    label: "Yes"
  });
  assert.equal(missingGroup.success, false);
});

test("text allowlist entries only ever accept exactValue GA", () => {
  const invalid = FieldAllowlistEntrySchema.safeParse({
    key: "p2::note",
    selector: "#note",
    type: "text",
    label: "Note",
    exactValue: "anything"
  });
  assert.equal(invalid.success, false);
});

test("audit events have no free-text clinical value field", () => {
  const parsed = AuditEventSchema.parse({
    id: "evt-1",
    timestamp: new Date().toISOString(),
    eventType: "PAGE_SAVED",
    batchId: "batch-1",
    queueEntryId: "queue-1",
    count: 1
  });
  assert.ok(!("value" in parsed));
  assert.ok(!("patient" in parsed));
});

test("default retention deletes completed data on batch close", () => {
  const parsed = RetentionConfigSchema.parse({});
  assert.equal(parsed.deleteCompletedOnBatchClose, true);
  assert.equal(parsed.completedRetentionDays, 0);
  assert.deepEqual(DEFAULT_RETENTION_CONFIG, parsed);
});
