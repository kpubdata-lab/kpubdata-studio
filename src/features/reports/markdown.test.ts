import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { escapeHtml, isSafeHref, renderMarkdownToHtml, renderMarkdownToReact } from "./markdown";

describe("markdown safety (#258 §13) — untrusted Ask KPubData/사용자 입력을 다룬다", () => {
  it("<script> 태그는 실행 가능한 형태로 만들지 않고 escape된 텍스트로 남는다", () => {
    const html = renderMarkdownToHtml('<script>alert("xss")</script>');
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("javascript: 링크는 <a href>로 만들지 않는다(원문은 클릭 불가능한 escape된 텍스트로만 남는다)", () => {
    expect(isSafeHref("javascript:alert(1)")).toBe(false);
    const html = renderMarkdownToHtml("[클릭](javascript:alert(1))");
    expect(html).not.toContain("<a ");
    expect(html).not.toContain('href="javascript:');
  });

  it("http(s) 링크만 <a>로 만들고 새 창 안전 속성을 붙인다", () => {
    expect(isSafeHref("https://example.com")).toBe(true);
    const html = renderMarkdownToHtml("[문서](https://example.com/doc)");
    expect(html).toContain('href="https://example.com/doc"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('target="_blank"');
  });

  it("onerror 등 이벤트 핸들러처럼 보이는 텍스트도 실행 가능한 태그로 만들지 않고 escape된 텍스트로만 남는다", () => {
    const html = renderMarkdownToHtml('<img src=x onerror="alert(1)">');
    expect(html).not.toContain("<img ");
    expect(html).not.toMatch(/<img\s|<img>/);
    expect(html).toContain("&lt;img");
    expect(html).toContain("&quot;alert(1)&quot;");
  });

  it("React 렌더러는 dangerouslySetInnerHTML 없이도 굵게/링크/목록을 표현한다", () => {
    const node = renderMarkdownToReact("**중요** 내용입니다.\n\n- 항목1\n- 항목2\n\n[링크](https://example.com)");
    const markup = renderToStaticMarkup(node as never);
    expect(markup).toContain("<strong>중요</strong>");
    expect(markup).toContain("<li>항목1</li>");
    expect(markup).toContain('href="https://example.com"');
  });

  it("React 렌더러도 javascript: 링크는 <a>로 만들지 않는다", () => {
    const node = renderMarkdownToReact("[클릭](javascript:alert(1))");
    const markup = renderToStaticMarkup(node as never);
    expect(markup).not.toContain("<a ");
    expect(markup).not.toContain('href="javascript:');
  });

  it("테이블을 파이프 문법으로 렌더링한다", () => {
    const html = renderMarkdownToHtml("| a | b |\n| --- | --- |\n| 1 | 2 |");
    expect(html).toContain("<table>");
    expect(html).toContain("<th>a</th>");
    expect(html).toContain("<td>1</td>");
  });

  it("escapeHtml은 5대 특수문자를 모두 이스케이프한다", () => {
    expect(escapeHtml(`<>&"'`)).toBe("&lt;&gt;&amp;&quot;&#39;");
  });
});
