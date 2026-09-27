/**
 * Secret-scrubbing regression tests (#226).
 *
 * Verifies four defect classes:
 * (a) array traversal — BuildSpec.sources is an array
 * (c) restoreSecrets round-trip — restore including arrays
 * (d) Shannon entropy — detecting long base64 keys
 */
import { describe, expect, it } from "vitest";

import {
  createSecretScrubber,
  hasSecretPlaceholder,
  looksLikeSecret,
  redactSecrets,
  restoreSecrets,
  scrubSecrets,
} from "./scrub";

const SAMPLE_SERVICE_KEY =
  "9dF8kQ2mZ7xV3nL1pR4wY6tB0hJ5sC8gU2iE7oA9bN3cM6dP4qK1rS8tU0vW3xY5z";

describe("scrubSecrets — 배열 순회 회귀 (#226 결함 a)", () => {
  it("BuildSpec.sources 배열 내부의 serviceKey를 스크러빙한다", () => {
    const spec = {
      sources: [
        { provider: "datago", params: { serviceKey: SAMPLE_SERVICE_KEY } },
      ],
    };
    const { scrubbed, placeholders } = scrubSecrets(spec);

    const json = JSON.stringify(scrubbed);
    expect(json).not.toContain(SAMPLE_SERVICE_KEY);
    expect(placeholders.size).toBeGreaterThan(0);
    expect(Array.from(placeholders.values())).toContain(SAMPLE_SERVICE_KEY);
  });

  it("다중 소스 배열의 각 원소를 독립적으로 순회한다", () => {
    const spec = {
      sources: [
        { params: { serviceKey: SAMPLE_SERVICE_KEY } },
        { params: { apiKey: "another-secret-value-1234567890abcdef" } },
      ],
    };
    const { scrubbed } = scrubSecrets(spec);
    const json = JSON.stringify(scrubbed);
    expect(json).not.toContain(SAMPLE_SERVICE_KEY);
    expect(json).not.toContain("another-secret-value-1234567890abcdef");
  });

  it("중첩 배열(배열 안 객체 안 배열)도 순회한다", () => {
    const spec = {
      sources: [{ tags: [{ secret: SAMPLE_SERVICE_KEY }] }],
    };
    const { scrubbed } = scrubSecrets(spec);
    expect(JSON.stringify(scrubbed)).not.toContain(SAMPLE_SERVICE_KEY);
  });
});

describe("restoreSecrets — 배열 왕복 회귀 (#226 결함 c)", () => {
  it("scrub → restore가 배열을 포함한 원본을 완전히 복원한다", () => {
    const original = {
      sources: [{ params: { serviceKey: SAMPLE_SERVICE_KEY } }],
    };
    const { scrubbed, placeholders } = scrubSecrets(original);
    const restored = restoreSecrets(scrubbed, placeholders);
    expect(restored).toEqual(original);
  });

  it("중첩 배열도 왕복 복원된다", () => {
    const original = {
      sources: [{ tags: [{ secret: SAMPLE_SERVICE_KEY }] }],
    };
    const { scrubbed, placeholders } = scrubSecrets(original);
    const restored = restoreSecrets(scrubbed, placeholders);
    expect(restored).toEqual(original);
  });

  it("다른 요청이 만든 플레이스홀더를 복원하지 않는다", () => {
    const requestA = createSecretScrubber("request-a");
    const requestB = createSecretScrubber("request-b");
    const scrubbed = requestA.scrub({ serviceKey: "test-key" }) as {
      serviceKey: string;
    };

    expect(() => requestB.restore(scrubbed)).toThrow("알 수 없는 시크릿");
  });

  it("문자열 응답의 알려진 플레이스홀더만 복원한다", () => {
    const scrubber = createSecretScrubber("request-a");
    const scrubbed = scrubber.scrub({ serviceKey: "test-key" }) as {
      serviceKey: string;
    };

    expect(scrubber.restoreText(`serviceKey: ${scrubbed.serviceKey}`)).toBe(
      "serviceKey: test-key",
    );
    expect(() => scrubber.restoreText("__SCRUBBED_request-b_0__")).toThrow(
      "알 수 없는 시크릿",
    );
    expect(hasSecretPlaceholder(scrubbed)).toBe(true);
  });
});

describe("looksLikeSecret — Shannon 엔트로피 (#226 결함 d)", () => {
  it("짧은 값은 잡지 않는다 (MIN_LENGTH_FOR_ENTROPY 미만)", () => {
    expect(looksLikeSecret("short")).toBe(false);
  });

  it("200자 고엔트로피 base64 문자열을 잡아낸다 (현재 unique/length로는 32%라 놓침)", () => {
    // base64 distinct chars ≤ 64 over length 192 → unique/length*100 ≈ 33% < 60 (current);
    // Shannon entropy accounts for character-frequency distribution and computes high
    const longB64 =
      "dGhpcy1pcy1hLXZlcnktbG9uZy1iYXNlNjQtc3RyaW5nLXdoaWNoLXNo" +
      "b3VsZC1ub3QtYmUtY2F1Z2h0LWJ5LXRoZS1jdXJyZW50LWhldXJpc3Rp" +
      "Yy1iZWNhdXNlLWl0LWlzLWxvbmctYW5kLXZhcmlk";
    expect(looksLikeSecret(longB64)).toBe(true);
  });

  it("반복 패턴 저엔트로피 문자열은 잡지 않는다", () => {
    expect(looksLikeSecret("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")).toBe(false);
  });
});

describe("redactSecrets — 화면용 비가역 마스킹 (#277)", () => {
  it("structured evidence의 시크릿을 placeholder 대신 REDACTED로 바꾼다", () => {
    const redacted = redactSecrets({
      sources: [{ params: { serviceKey: SAMPLE_SERVICE_KEY }, title: "대기질" }],
    });

    expect(redacted).toEqual({
      sources: [{ params: { serviceKey: "[REDACTED]" }, title: "대기질" }],
    });
    expect(JSON.stringify(redacted)).not.toContain("__SCRUBBED_");
  });
});

/**
 * P6: exact-value allowlist exempts only canonical run-id false positives (#284).
 *
 * Principle — judge by provenance, not shape. Only exact run ids actually
 * confirmed in Builder/evidence are exempt from the generic entropy
 * heuristic; arbitrary lookalike strings and crafted secrets are still
 * scrubbed. Secret-named fields and explicit credential assignments always
 * take priority over the allowlist.
 */
describe("P6 safeRunIds — provenance 기반 exact-value 면제 (#284)", () => {
  const RUN_ID = "datago-air-quality-1788004513062";
  // safeRunIds holds only run ids "actually confirmed" (never inferred from free user text).
  const safeRunIds = new Set([RUN_ID]);

  it("A. known run id: 자유 텍스트에서 exact run id 를 보존한다", () => {
    const scrubber = createSecretScrubber("p6-a", { safeRunIds });
    expect(scrubber.scrubText(`Run ${RUN_ID}의 상태를 분석해줘`)).toContain(RUN_ID);
    // Preserved even when attached like `runId=<id>` (prompt context-line shape).
    expect(scrubber.scrubText(`현재 문맥: page=quality, runId=${RUN_ID}, stage=silver`)).toContain(
      `runId=${RUN_ID}`,
    );
  });

  it("A. known run id: structured evidence / suggestedAction 에서 보존한다", () => {
    const redacted = redactSecrets(
      {
        context: { runId: RUN_ID },
        deepLinks: { buildDetail: RUN_ID },
        recentRuns: [{ runId: RUN_ID, status: "succeeded" }],
        suggestedActions: [{ type: "OPEN_BUILD", runId: RUN_ID, reason: "실패 원인" }],
      },
      safeRunIds,
    );
    expect(JSON.stringify(redacted)).not.toContain("[REDACTED]");
    expect(JSON.stringify(redacted)).toContain(RUN_ID);
  });

  it("B. 똑같은 모양의 unknown secret(crafted timestamp tail)은 여전히 스크럽한다", () => {
    const crafted = "service-secret-production-abcdef-1788004513062";
    expect(looksLikeSecret(crafted, safeRunIds)).toBe(true);

    const scrubber = createSecretScrubber("p6-b", { safeRunIds });
    const out = scrubber.scrubText(`토큰은 ${crafted} 입니다`);
    expect(out).not.toContain(crafted);
    expect(hasSecretPlaceholder(out)).toBe(true);

    const redacted = redactSecrets({ note: crafted }, safeRunIds);
    expect(redacted).toEqual({ note: "[REDACTED]" });
  });

  it("C. secret-named field 는 값이 safe run id 여도 무조건 스크럽한다", () => {
    for (const key of ["serviceKey", "apiKey", "api_key", "accessToken", "clientSecret"]) {
      const redacted = redactSecrets({ [key]: RUN_ID }, safeRunIds);
      expect(redacted).toEqual({ [key]: "[REDACTED]" });
    }
  });

  it("D. 명시적 free-text credential 대입은 값이 safe run id 여도 스크럽한다", () => {
    const scrubber = createSecretScrubber("p6-d", { safeRunIds });
    for (const text of [
      `serviceKey=${RUN_ID}`,
      `apiKey: ${RUN_ID}`,
      `token=${RUN_ID}`,
      `secret=${RUN_ID}`,
    ]) {
      const out = scrubber.scrubText(text);
      expect(out).not.toContain(RUN_ID);
      expect(hasSecretPlaceholder(out)).toBe(true);
    }
  });

  it("E. 기존 시크릿(base64/hex/random/service key/bearer)은 회귀 없이 스크럽한다", () => {
    const scrubber = createSecretScrubber("p6-e", { safeRunIds });
    const secrets = [
      SAMPLE_SERVICE_KEY, // base64-ish service key
      "xJ7kL9mN2pQ4rT6vW8yB3cD5eF7gH9jZ", // mixed-case random token
      "sk-live-51H8xKq9Wd0123456789abcdefABCDEF00", // bearer-like
    ];
    for (const s of secrets) {
      expect(looksLikeSecret(s, safeRunIds)).toBe(true);
      const out = scrubber.scrubText(`value ${s} end`);
      expect(out).not.toContain(s);
    }
  });

  it("F. safe set 에 없는 run-id 처럼 생긴 문자열은 면제하지 않는다(exact match 만)", () => {
    const lookalike = "other-dataset-private-1788004513063"; // entropy ≥ 4, safe set 밖
    expect(looksLikeSecret(lookalike, safeRunIds)).toBe(true);

    const scrubber = createSecretScrubber("p6-f", { safeRunIds });
    expect(scrubber.scrubText(`Run ${lookalike} 분석`)).not.toContain(lookalike);
  });

  it("G. action round-trip: known run id 는 redaction 후에도 동일, unknown 은 스크럽", () => {
    const known = redactSecrets(
      { suggestedActions: [{ type: "OPEN_BUILD", runId: RUN_ID }] },
      safeRunIds,
    );
    expect(known).toEqual({ suggestedActions: [{ type: "OPEN_BUILD", runId: RUN_ID }] });

    const unknown = redactSecrets(
      { suggestedActions: [{ type: "OPEN_BUILD", runId: "unknown-private-run-1788004513063" }] },
      safeRunIds,
    );
    expect(JSON.stringify(unknown)).toContain("[REDACTED]");
  });

  it("safeRunIds 를 넘기지 않으면 main 과 동일하게 canonical run id 도 스크럽한다", () => {
    // Confirms behavior preservation for existing non-Kubi consumers (paramsRedaction/urlRedaction/savedSpecs).
    expect(looksLikeSecret(RUN_ID)).toBe(true);
    expect(redactSecrets({ note: RUN_ID })).toEqual({ note: "[REDACTED]" });
  });
});

/**
 * Safe evidence id — deterministic quality-evidence identifiers are also exact-value exempt (#319 follow-up).
 *
 * The canonical id built by `qualityResultRefId`
 * (`provider.dataset::category::rule::column`) exceeds Shannon entropy 4.0
 * (length and character variety), so without a safe set it is a `[REDACTED]`
 * false positive. It shares the run-id provenance contract (an exact string
 * actually produced during this load), so it is exempted by the same
 * argument — while secret-named fields, explicit credential assignments and
 * lookalikes must still be scrubbed.
 */
describe("safe evidence id — canonical quality identifier 면제 (#319)", () => {
  const QUALITY_ID = "datago.air_quality::completeness::min_rows::_";
  const safeValues = new Set([QUALITY_ID]);

  it("safe set 없이는 canonical quality id 도 엔트로피 오탐으로 스크럽된다(기존 동작)", () => {
    expect(looksLikeSecret(QUALITY_ID)).toBe(true);
    expect(redactSecrets({ evidenceRefs: [{ kind: "quality", id: QUALITY_ID }] })).toEqual({
      evidenceRefs: [{ kind: "quality", id: "[REDACTED]" }],
    });
  });

  it("safe set 에 exact 로 들어간 quality id 는 evidence/자유 텍스트에서 보존된다", () => {
    expect(looksLikeSecret(QUALITY_ID, safeValues)).toBe(false);

    const redacted = redactSecrets(
      {
        quality: { results: [{ id: QUALITY_ID, rule: "min_rows", actual: 40, threshold: 1000 }] },
        evidenceRefs: [{ kind: "quality", id: QUALITY_ID, label: "행 수 검사" }],
      },
      safeValues,
    );
    expect(JSON.stringify(redacted)).not.toContain("[REDACTED]");
    expect(JSON.stringify(redacted)).toContain(QUALITY_ID);

    const scrubber = createSecretScrubber("safe-ev-a", { safeRunIds: safeValues });
    expect(scrubber.scrubText(`quality:${QUALITY_ID} 근거를 확인했습니다`)).toContain(QUALITY_ID);
  });

  it("secret-named field 는 값이 safe quality id 여도 무조건 스크럽한다", () => {
    for (const key of ["serviceKey", "apiKey", "token", "secret"]) {
      expect(redactSecrets({ [key]: QUALITY_ID }, safeValues)).toEqual({ [key]: "[REDACTED]" });
    }
    const scrubber = createSecretScrubber("safe-ev-b", { safeRunIds: safeValues });
    const out = scrubber.scrubText(`serviceKey=${QUALITY_ID}`);
    expect(out).not.toContain(QUALITY_ID);
    expect(hasSecretPlaceholder(out)).toBe(true);
  });

  it("safe set 밖의 비슷한 canonical id 는 면제하지 않는다(exact match 만)", () => {
    const lookalike = "datago.air_quality::completeness::not_null::stationName";
    expect(looksLikeSecret(lookalike, safeValues)).toBe(true);
    expect(redactSecrets({ evidenceRefs: [{ kind: "quality", id: lookalike }] }, safeValues)).toEqual({
      evidenceRefs: [{ kind: "quality", id: "[REDACTED]" }],
    });
  });
});

/**
 * P6 supplement — scrubbing secret fragments adjacent to safe run ids (#284).
 *
 * With a non-alphanumeric boundary around a safe id (e.g.
 * `<secret>/<safeRunId>`), the safe id is preserved — but carving it out can
 * leave a secret fragment under 24 chars that escapes the entropy check.
 * Only the safe id is preserved; surrounding non-safe fragments all go
 * through the existing scrub logic.
 */
describe("P6 adjacency — safe run id 옆에 붙은 시크릿 조각도 스크럽 (#284)", () => {
  const RUN_ID = "datago-air-quality-1788004513062";
  const safeRunIds = new Set([RUN_ID]);
  const HIGH_ENTROPY = "xJ7kL9mN2pQ4rT6vW8yB3cD5eF7gH9j"; // 31자, entropy ≥ 4

  const SEPARATORS: [name: string, char: string][] = [
    ["slash", "/"],
    ["colon", ":"],
    ["equals", "="],
    ["comma", ","],
  ];

  it.each(SEPARATORS)(
    "`<secret>%s<safeRunId>` (%s) — 시크릿은 스크럽하고 run id 는 보존한다",
    (name, sep) => {
      const scrubber = createSecretScrubber(`p6-adj-${name}`, { safeRunIds });
      const out = scrubber.scrubText(`${HIGH_ENTROPY}${sep}${RUN_ID}`);
      expect(out).not.toContain(HIGH_ENTROPY);
      expect(out).toContain(RUN_ID);
      expect(hasSecretPlaceholder(out)).toBe(true);
    },
  );

  it.each(SEPARATORS.filter(([, char]) => char !== "="))(
    "`<safeRunId>%s<secret>` (%s) — 뒤에 붙은 시크릿도 스크럽하고 run id 는 보존한다",
    (name, sep) => {
      const scrubber = createSecretScrubber(`p6-adj-suffix-${name}`, { safeRunIds });
      const out = scrubber.scrubText(`${RUN_ID}${sep}${HIGH_ENTROPY}`);
      expect(out).not.toContain(HIGH_ENTROPY);
      expect(out).toContain(RUN_ID);
    },
  );

  it("safe id 가 긴 고엔트로피 토큰을 둘로 쪼개도 양쪽 조각이 모두 스크럽된다", () => {
    // Each fragment is under 24 chars once the safe id is removed — per-fragment entropy checks alone would miss them.
    const scrubber = createSecretScrubber("p6-adj-split", { safeRunIds });
    const head = "xJ7kL9mN2pQ4"; // 12자
    const tail = "rT6vW8yB3cD5eF7gH9j"; // 19자
    const out = scrubber.scrubText(`${head}/${RUN_ID}/${tail}`);
    expect(out).toContain(RUN_ID);
    expect(out).not.toContain(head);
    expect(out).not.toContain(tail);
    expect(hasSecretPlaceholder(out)).toBe(true);
  });

  it("explicit credential 대입은 adjacency 처리보다 먼저 적용된다(값이 safe run id 여도 스크럽)", () => {
    const scrubber = createSecretScrubber("p6-adj-assign", { safeRunIds });
    const out = scrubber.scrubText(`serviceKey=${HIGH_ENTROPY}/${RUN_ID}`);
    expect(out).not.toContain(HIGH_ENTROPY);
    // The assignment captures `[^\s,}\]]+` wholesale, so in this shape the run id is masked too (fail-closed).
    expect(hasSecretPlaceholder(out)).toBe(true);
  });

  it("경계 없이 이어붙은 `<secret><safeRunId>` 는 토큰 전체를 스크럽한다(fail-closed)", () => {
    const scrubber = createSecretScrubber("p6-adj-glued", { safeRunIds });
    const out = scrubber.scrubText(`${HIGH_ENTROPY}${RUN_ID}`);
    expect(out).not.toContain(HIGH_ENTROPY);
    expect(hasSecretPlaceholder(out)).toBe(true);
  });

  it("일반 산문에서 safe run id 는 인접 구두점이 있어도 그대로 보존한다", () => {
    const scrubber = createSecretScrubber("p6-adj-prose", { safeRunIds });
    for (const text of [`Run ${RUN_ID}의 상태`, `(${RUN_ID})`, `"${RUN_ID}".`, `${RUN_ID}, 그리고`]) {
      expect(scrubber.scrubText(text)).toContain(RUN_ID);
    }
  });

  it("safe set 밖의 run-id 처럼 생긴 값은 인접 경계가 있어도 스크럽한다", () => {
    const scrubber = createSecretScrubber("p6-adj-lookalike", { safeRunIds });
    const lookalike = "other-dataset-private-1788004513063";
    const out = scrubber.scrubText(`${HIGH_ENTROPY}/${lookalike}`);
    expect(out).not.toContain(HIGH_ENTROPY);
    expect(out).not.toContain(lookalike);
  });
});
