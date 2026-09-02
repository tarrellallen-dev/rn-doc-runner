import type { FormAdapter, FormAdapterPage } from "@rn-doc-runner/contracts";
import { SNV_V1_ADAPTER } from "./snv-v1.js";
import { RECERT_V1_ADAPTER } from "./recert-v1.js";
import { MED_ADMIN_V1_ADAPTER } from "./med-admin-v1.js";

export * from "./selector.js";
export * from "./layout-fingerprint.js";
export * from "./snv-v1.js";
export * from "./recert-v1.js";
export * from "./med-admin-v1.js";
export * from "./site-adapter.js";

export const SYNTHETIC_FORM_ADAPTERS: FormAdapter[] = [SNV_V1_ADAPTER, RECERT_V1_ADAPTER, MED_ADMIN_V1_ADAPTER];

export function findFormAdapter(formType: string, formVersion: string): FormAdapter | undefined {
  return SYNTHETIC_FORM_ADAPTERS.find((a) => a.formType === formType && a.formVersion === formVersion);
}

export function findFormAdapterPage(formType: string, formVersion: string, pageIndex: number): FormAdapterPage | undefined {
  return findFormAdapter(formType, formVersion)?.pages.find((p) => p.page.pageIndex === pageIndex);
}
