import { fireEvent, screen, waitFor } from "@testing-library/react";

/**
 * Choose a provider in the source step once it can actually be chosen.
 *
 * A step's title renders before the catalog arrives, so it does not mean the provider
 * select has its options: a change made before the option exists is ignored and the
 * dataset select stays disabled. Wait for the option itself (by value, since the two
 * wizards label it differently), then change the select.
 */
export async function chooseProvider(provider: string) {
  const label = /제공자/;
  await waitFor(() => {
    const select = screen.getByLabelText(label);
    if (!select.querySelector(`option[value="${provider}"]`)) throw new Error(`no ${provider} option yet`);
  });
  fireEvent.change(screen.getByLabelText(label), { target: { value: provider } });
}
