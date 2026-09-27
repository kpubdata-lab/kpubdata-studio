/**
 * common LinkButton component.
 *
 * render React Router `Link` with button styling. Don't nest `<Button>` inside `<Link>`를 중첩하면
 * 상호작용 요소(button>a)가 중첩되어 HTML 유효성·접근성·키보드 동작에 문제가 생기므로,
 * 라우팅이 필요한 "버튼처럼 보이는" 요소는 이 단일 anchor 컴포넌트를 사용한다.
 */
import { Link, type LinkProps } from "react-router-dom";
import { buttonClassName, type ButtonSize, type ButtonVariant } from "./buttonStyles";

export interface LinkButtonProps extends LinkProps {
  /** variant that determines visual emphasis level */
  variant?: ButtonVariant;
  /** button size */
  size?: ButtonSize;
}

/**
 * render router link with button styling (no nested interactive elements).
 *
 * @param props - Link 속성에 variant/size를 더한 값.
 * @returns 버튼처럼 보이는 anchor(Link) 엘리먼트.
 */
export function LinkButton({ variant = "primary", size = "md", className, ...rest }: LinkButtonProps) {
  return <Link className={buttonClassName(variant, size, className)} {...rest} />;
}
