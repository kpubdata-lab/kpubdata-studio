/**
 * deterministic dataset catalog used in demo (mock) mode.
 *
 * static demo (GitHub Pages) build list/detail/manifest viewer doesn't look empty by using seed data
 * modeled after actual kpubdata-builder dataset build specs (`scripts/configs/*.yaml`) and manifest
 * wire form that Builder records.
 *
 * This data is for demo display only, not production values, and isn't used when
 * `VITE_USE_REAL_BUILDER=true` (replaced with Builder's actual data). Since it reflects Builder's
 * actual column names/provenance/HuggingFace layout, the UI looks similar to the real thing.
 */
import type {
  BuildRunStatus,
  ExportTarget,
  ManifestFieldSummary,
} from "@/shared/lib/types";

/** single dataset definition in demo catalog. */
export interface DemoDataset {
  /** path-safe dataset slug (also used as build ID prefix). */
  slug: string;
  /** build execution ID (key for list/detail/manifest queries). */
  buildId: string;
  /** human-readable title. */
  title: string;
  /** build purpose description. */
  description: string;
  /** provider-internal dataset identifier (underscore, e.g., air_quality). */
  providerDataset: string;
  /** data.go.kr original OpenAPI address. */
  sourceUrl: string;
  /** snapshot of provider request parameters. */
  params: Record<string, string>;
  /** list of artifact export formats. */
  exports: ExportTarget[];
  /** HuggingFace Hub repository path. */
  hfRepo: string;
  /** current execution state. */
  status: BuildRunStatus;
  /** execution start time (ISO). */
  startedAt: string;
  /** execution end time (ISO). Undefined if running/queued. */
  finishedAt?: string;
  /** number of collected records. */
  recordCount: number;
  /** result table column schema (based on Builder column_mapping). */
  fields: ManifestFieldSummary[];
  /** error message when in failed state. */
  errors?: string[];
}

/** common OpenAPI address for DUR family datasets (DURPrdlstInfoService03). */
const DUR_SOURCE_URL = "https://www.data.go.kr/data/15075057/openapi.do";

function str(name: string, nullable = true): ManifestFieldSummary {
  return { name, type: "string", nullable };
}

function f64(name: string): ManifestFieldSummary {
  return { name, type: "float64", nullable: true };
}

/**
 * demo dataset catalog.
 *
 * modeled after actual builder specs (apartment trades, DUR items/interactions/pregnancy/elderly/dosage)
 * includes various states (succeeded/running/failed/queued).
 */
export const DEMO_DATASETS: DemoDataset[] = [
  {
    slug: "apt-trade",
    buildId: "apt-trade-20260621",
    title: "아파트 매매 실거래가",
    description: "아파트 매매 실거래가(단지명/거래금액/전용면적/층/건축년도/법정동) 데이터셋 빌드",
    providerDataset: "apt_trade",
    sourceUrl: "https://www.data.go.kr/data/15126469/openapi.do",
    params: { LAWD_CD: "11110", DEAL_YMD: "202606" },
    exports: [{ format: "parquet" }, { format: "huggingface" }],
    hfRepo: "kpubdata/apt-trade",
    status: "succeeded",
    startedAt: "2026-06-21T09:00:00.000Z",
    finishedAt: "2026-06-21T09:00:12.000Z",
    recordCount: 12304,
    fields: [
      str("apt_name", false),
      str("deal_date", false),
      f64("deal_amount"),
      f64("exclusive_area"),
      f64("floor"),
      f64("build_year"),
      str("legal_dong"),
      str("jibun"),
      str("lawd_cd"),
      str("deal_type"),
    ],
  },
  {
    slug: "dur-product-info",
    buildId: "dur-product-info-20260620",
    title: "DUR 품목정보",
    description: "DUR 의약품 품목 마스터(품목기준코드/품목명/업체명/약효분류) 데이터셋 빌드",
    providerDataset: "dur_product_info",
    sourceUrl: DUR_SOURCE_URL,
    params: {},
    exports: [{ format: "jsonl" }, { format: "huggingface" }],
    hfRepo: "kpubdata/dur-product-info",
    status: "succeeded",
    startedAt: "2026-06-20T14:30:00.000Z",
    finishedAt: "2026-06-20T14:31:47.000Z",
    recordCount: 48512,
    fields: [
      str("item_seq", false),
      str("item_name", false),
      str("company_name"),
      str("formulation"),
      str("class_code"),
      str("class_name"),
      str("etc_otc_code"),
      str("item_permit_date"),
      str("change_date"),
    ],
  },
  {
    slug: "dur-usjnt-taboo",
    buildId: "dur-usjnt-taboo-20260620",
    title: "병용금기 품목정보",
    description: "DUR 병용금기 의약품 조합(함께 복용하면 안 되는 약제 쌍과 금기 사유) 데이터셋 빌드",
    providerDataset: "dur_usjnt_taboo",
    sourceUrl: DUR_SOURCE_URL,
    params: {},
    exports: [{ format: "jsonl" }, { format: "huggingface" }],
    hfRepo: "kpubdata/dur-usjnt-taboo",
    status: "succeeded",
    startedAt: "2026-06-19T22:10:00.000Z",
    finishedAt: "2026-06-19T22:12:03.000Z",
    recordCount: 31894,
    fields: [
      str("item_seq", false),
      str("item_name", false),
      str("company_name"),
      str("class_name"),
      str("mixture_item_seq"),
      str("mixture_item_name"),
      str("mixture_company_name"),
      str("prohibition_content"),
      str("remark"),
      str("item_permit_date"),
      str("change_date"),
    ],
  },
  {
    slug: "dur-pregnancy-taboo",
    buildId: "dur-pregnancy-taboo-20260621",
    title: "임부금기 의약품",
    description: "DUR 임부금기 의약품(임신 중 사용 금기 약제와 금기 내용) 데이터셋 빌드",
    providerDataset: "dur_pregnancy_taboo",
    sourceUrl: DUR_SOURCE_URL,
    params: {},
    exports: [{ format: "jsonl" }, { format: "huggingface" }],
    hfRepo: "kpubdata/dur-pregnancy-taboo",
    status: "running",
    startedAt: "2026-06-21T10:15:00.000Z",
    recordCount: 0,
    fields: [
      str("item_seq", false),
      str("item_name", false),
      str("company_name"),
      str("class_name"),
      str("prohibition_content"),
      str("remark"),
      str("item_permit_date"),
      str("change_date"),
    ],
  },
  {
    slug: "dur-older-adult-caution",
    buildId: "dur-older-adult-caution-20260618",
    title: "노인주의 의약품",
    description: "DUR 노인주의 의약품 데이터셋 빌드(원본 오픈API 응답 지연으로 실패)",
    providerDataset: "dur_older_adult_caution",
    sourceUrl: DUR_SOURCE_URL,
    params: {},
    exports: [{ format: "jsonl" }, { format: "huggingface" }],
    hfRepo: "kpubdata/dur-older-adult-caution",
    status: "failed",
    startedAt: "2026-06-18T03:05:00.000Z",
    finishedAt: "2026-06-18T03:05:31.000Z",
    recordCount: 0,
    errors: ["원본 오픈API 응답 시간 초과(gateway timeout) — Bronze 단계 수집 실패"],
    fields: [
      str("item_seq", false),
      str("item_name", false),
      str("company_name"),
      str("class_name"),
      str("prohibition_content"),
      str("remark"),
    ],
  },
  {
    slug: "dur-dosage-caution",
    buildId: "dur-dosage-caution-20260621",
    title: "용량주의 의약품",
    description: "DUR 용량주의 의약품(1일 최대 투여량 주의 약제) 데이터셋 빌드(실행 대기 중)",
    providerDataset: "dur_dosage_caution",
    sourceUrl: DUR_SOURCE_URL,
    params: {},
    exports: [{ format: "jsonl" }, { format: "huggingface" }],
    hfRepo: "kpubdata/dur-dosage-caution",
    status: "queued",
    startedAt: "2026-06-21T10:20:00.000Z",
    recordCount: 0,
    fields: [
      str("item_seq", false),
      str("item_name", false),
      str("company_name"),
      str("class_name"),
      str("max_dosage_content"),
      str("remark"),
    ],
  },
];

/**
 * find demo dataset by build ID. Try exact match first, then slug prefix match.
 *
 * @param buildId - build execution ID to query.
 * @returns matching demo dataset (first item if none found).
 */
export function findDemoDataset(buildId: string): DemoDataset {
  const exact = DEMO_DATASETS.find((d) => d.buildId === buildId);
  if (exact) return exact;
  const bySlug = DEMO_DATASETS.find((d) => buildId.startsWith(d.slug));
  return bySlug ?? DEMO_DATASETS[0];
}
