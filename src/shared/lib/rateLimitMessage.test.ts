/**
 * The 429 refusals of Builder 1.119.0 are said with how long to wait (#949).
 */
import { describe, expect, it } from "vitest";

import { classifyQueryError } from "@/features/sql/api";
import EN from "@/shared/i18n/locales/en.json";
import { ApiError, httpError } from "./builderApi";

const QUERY = { error: "you have run as many queries as the server allows for now", code: "query_rate_limited", retry_after_seconds: 12 };
const EGRESS = { error: "the provider has been called as often as allowed", code: "provider_egress_limited", retry_after_seconds: 7.2 };

describe("rate-limit refusals", () => {
  it("says the query refusal in the user's language, with the seconds to wait", () => {
    const message = httpError(429, QUERY).message;
    expect(message).toBe("방금 질의를 너무 많이 실행했습니다. 12초 뒤에 다시 시도하세요.");
    expect(message).not.toContain("you have run");
  });

  it("says the preview refusal with the seconds rounded up", () => {
    expect(httpError(429, EGRESS).message).toBe(
      "서버가 허용하는 만큼 데이터 제공자를 호출해 지금은 미리보기를 실행하지 않았습니다. 8초 뒤에 다시 시도하세요.",
    );
  });

  it.each([undefined, 0, -1, "5", null])("does not make up a wait from %j", (wait) => {
    expect(httpError(429, { ...QUERY, retry_after_seconds: wait }).message).toBe("방금 질의를 너무 많이 실행했습니다. 잠시 후 다시 시도하세요.");
  });

  it("has English wording for both", () => {
    expect(EN.api.rateLimit.queryRateLimited).toContain("{{seconds}} seconds");
    expect(EN.api.rateLimit.providerEgressLimited).toContain("{{seconds}} seconds");
  });

  it("leaves the same codes on another status, and other 429s, as Builder wrote them", () => {
    expect(httpError(503, QUERY).message).toBe(QUERY.error);
    expect(httpError(429, { error: "slow down", code: "auth_throttled" }).message).toBe("slow down");
  });

  it("shows the SQL workspace the localized sentence under Builder's code", () => {
    expect(classifyQueryError(new ApiError(429, httpError(429, QUERY).message, QUERY))).toStrictEqual({
      status: "error",
      code: "query_rate_limited",
      message: "방금 질의를 너무 많이 실행했습니다. 12초 뒤에 다시 시도하세요.",
    });
  });
});
