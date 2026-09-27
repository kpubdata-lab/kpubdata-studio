import { describe, expect, it } from "vitest";
import { describeCredentialReadiness, describeProviderProbe } from "./providerStatus";

describe("describeProviderProbe", () => {
  it("connected는 success/연결됨", () => {
    expect(describeProviderProbe({ status: "connected" })).toMatchObject({
      tone: "success",
      label: "연결됨",
      detail: null,
    });
  });

  it("저장된 credential + 403은 '연결 실패'가 아니라 '확인 필요'로 승격한다", () => {
    const p = describeProviderProbe({
      status: "failed",
      errorCategory: "auth",
      responseCode: 403,
      credentialConfigured: true,
    });
    expect(p.tone).toBe("warning");
    expect(p.label).toBe("확인 필요");
    expect(p.title).toBe("인증 또는 API 활용신청 확인 필요");
    expect(p.detail).toMatch(/Dataset\/API별 사용 권한/);
  });

  it("credential이 없으면 403이라도 일반 인증 오류로 매핑한다", () => {
    const p = describeProviderProbe({ status: "failed", errorCategory: "auth", responseCode: 403 });
    expect(p.tone).toBe("error");
    expect(p.label).toBe("연결 오류");
  });

  it("내부 enum(network 등)을 그대로 노출하지 않는다", () => {
    const p = describeProviderProbe({ status: "failed", errorCategory: "network" });
    expect(p.title).toBe("네트워크 연결 오류");
    expect(JSON.stringify(p)).not.toMatch(/"network"/);
  });

  it("알 수 없는 error_category는 unknown 문구로 떨어진다", () => {
    expect(describeProviderProbe({ status: "failed", errorCategory: "weird" }).title).toBe(
      "연결 상태를 확인할 수 없습니다",
    );
  });
});

describe("describeCredentialReadiness", () => {
  it("requires_credential=false → 인증 불필요(neutral)", () => {
    const r = describeCredentialReadiness({ requiresCredential: false, summaryConfigured: true });
    expect(r).toMatchObject({ tone: "neutral", label: "인증 불필요" });
  });

  it("사용자 저장 credential이 있으면 'API Key 등록됨' + Preview guidance", () => {
    const r = describeCredentialReadiness({
      requiresCredential: true,
      summaryConfigured: true,
      userCredentialConfigured: true,
    });
    expect(r.tone).toBe("success");
    expect(r.label).toBe("API Key 등록됨");
    expect(r.detail).toMatch(/Preview에서 확인/);
  });

  it("요약 configured=true지만 사용자 credential 없음(server default)은 별도 문구", () => {
    const r = describeCredentialReadiness({ requiresCredential: true, summaryConfigured: true });
    expect(r.tone).toBe("success");
    expect(r.label).toBe("연결 준비됨");
    expect(r.detail).toMatch(/Builder 기본 자격 증명/);
    // do not represent same as user-registered API Key.
    expect(r.label).not.toBe("API Key 등록됨");
  });

  it("credential이 필요한데 미설정이면 'API Key 미설정'(warning)", () => {
    const r = describeCredentialReadiness({ requiresCredential: true, summaryConfigured: false });
    expect(r).toMatchObject({ tone: "warning", label: "API Key 미설정" });
  });
});
