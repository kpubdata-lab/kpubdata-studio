/**
 * What Studio remembers for the session, outside any screen, is forgotten when another
 * account signs in (#902).
 *
 * Screens are remounted by `OwnerScope`. These stores outlive a screen, so each is reset
 * here: whether the user is an administrator, whether their sign-up is held back, and the
 * assistant's conversation — its answers quote the previous account's tables and runs.
 * The assistant's saved LLM key follows the owner in `features/assistant/config`, and the
 * version check is about the Builder, not the account, so it stays.
 */
import { resetAdminCheck } from "@/features/admin/store";
import { useAssistantStore } from "@/features/assistant/useAssistantSession";
import { onStorageOwnerChange } from "@/features/auth/storageOwner";
import { clearSessionRefusal } from "@/shared/lib/sessionRefusal";
import { clearSignupBlock } from "@/shared/lib/signupStatus";

export function forgetSessionFacts(): void {
  resetAdminCheck();
  clearSignupBlock();
  clearSessionRefusal();
  useAssistantStore.getState().forgetSession();
}

onStorageOwnerChange(forgetSessionFacts);
