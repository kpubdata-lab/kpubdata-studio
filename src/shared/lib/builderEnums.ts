/**
 * The enums of Builder's contract, as Studio's schemas use them (#793).
 *
 * `generated/builderEnums.ts` is a snapshot of every enum in the contract's
 * `components.schemas`, written by `scripts/generate-builder-enums.mjs`. A schema here
 * takes an enum from it by name — `builderEnum("BuildJob.status")` — instead of typing
 * its values out again. What is generated and what is written by hand:
 *
 * - **Generated**: the values of each enum, and the contract version they come from.
 * - **By hand**: the schemas themselves (`builderApi.schema.ts`), and — for each field —
 *   what an unknown value does. `builderEnum(name)` is strict: a value the snapshot does
 *   not hold fails the parse, which is right where Studio decides something by the
 *   value (a job's `status`). A field Studio only shows, or can do without, says so
 *   where it is declared (`.catch(undefined)`, or a plain `z.string()` as for
 *   `BuildJob.code`). The generator does not choose that; the schema's author does.
 *
 * A snapshot can be ahead of Builder's `main`: a new value is generated here from
 * Builder's branch first, because Builder cannot merge a value Studio's drift test does
 * not accept. `builderEnums.test.ts` holds the snapshot to the contract exactly when
 * their versions are the same.
 */
import { z } from "zod";
import { BUILDER_ENUMS } from "./generated/builderEnums";

export { BUILDER_ENUMS, BUILDER_ENUMS_CONTRACT_VERSION } from "./generated/builderEnums";

/** The name of an enum in the contract: `Schema` or `Schema.property`. */
export type BuilderEnumName = keyof typeof BUILDER_ENUMS;

/** The names whose values are all strings — the ones a `z.enum` can be made of. */
export type BuilderStringEnumName = {
  [Name in BuilderEnumName]: (typeof BUILDER_ENUMS)[Name] extends readonly string[] ? Name : never;
}[BuilderEnumName];

/**
 * A strict zod enum of the values the contract gives `name`. Use it where the hand-written
 * list would be those same values; say next to the field when an unknown value should
 * not fail the parse.
 */
export function builderEnum<Name extends BuilderStringEnumName>(name: Name) {
  return z.enum(BUILDER_ENUMS[name]);
}
