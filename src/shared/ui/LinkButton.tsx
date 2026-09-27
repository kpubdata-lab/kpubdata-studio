/**
 * Common LinkButton component.
 *
 * Render React Router `Link` with button styling. Nesting `<Button>` inside `<Link>`
 * creates nested interactive elements (button>a) causing HTML validity, accessibility,
 * and keyboard behavior issues, so routing-required "button-like" elements use this
 * single anchor component.
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
 * Render router link with button styling (no nested interactive elements).
 *
 * @param props - Link props plus variant/size.
 * @returns Anchor (Link) element styled like button.
 */
export function LinkButton({ variant = "primary", size = "md", className, ...rest }: LinkButtonProps) {
  return <Link className={buttonClassName(variant, size, className)} {...rest} />;
}
