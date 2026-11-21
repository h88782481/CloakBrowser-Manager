import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { poolApi, type Catalog, type Timing } from "./api";
import { ProxyWorkspace } from "./ProxyWorkspace";

const pool: Catalog = {
  homes: Array.from({ length: 11 }, (_, i) => ({ id: `h${i}`, name: `Home ${i}`, group_name: "QA", endpoint: "https://home.example:443", latency_ms: null, error: "" })),
  nodes: [{ id: "n1", name: "Relay", source_id: "s1", protocol: "vmess", latency_ms: null, error: "" }],
  subscriptions: [{ id: "s1", name: "Provider", synced_at: null }], kernel_available: true, kernel_path: "",
};
const button = (name: string) => screen.getByRole("button", { name });
const row = (name: string) => within(screen.getByText(name, { selector: "td" }).closest("tr")!);
async function open() {
  vi.spyOn(poolApi, "catalog").mockResolvedValue(pool);
  render(<ProxyWorkspace onClose={vi.fn()} />);
  await screen.findByText("Home 0");
}
afterEach(() => vi.restoreAllMocks());

it("accepts a home name and loads the full saved settings only when editing", async () => {
  const address = "https://user:test-secret@home.example:443";
  const detail = vi.spyOn(poolApi, "editDetails").mockResolvedValue({ name: "Home 0", address, group_name: "QA", scheme: "https" });
  const add = vi.spyOn(poolApi, "importHomes").mockResolvedValue({ count: 1 });
  await open();
  fireEvent.click(button("Add residential proxies"));
  fireEvent.change(screen.getByLabelText("Display name"), { target: { value: "Named home" } });
  fireEvent.change(screen.getByLabelText("Residential proxy addresses"), { target: { value: address } });
  fireEvent.click(button("Save"));
  await waitFor(() => expect(add).toHaveBeenCalledWith(address, "", "socks5", "Named home"));
  expect(detail).not.toHaveBeenCalled();
  fireEvent.click(row("Home 0").getByRole("button", { name: "Edit" }));
  await screen.findByDisplayValue(address);
  expect((screen.getByLabelText("Group") as HTMLInputElement).value).toBe("QA");
  expect((screen.getByLabelText("Protocol for addresses without a scheme") as HTMLSelectElement).value).toBe("https");
});

it("edits and removes a subscription-owned node through its own row", async () => {
  const original = "vmess://fixture";
  vi.spyOn(poolApi, "editDetails").mockResolvedValue({ name: "Relay", address: original });
  const save = vi.spyOn(poolApi, "saveNode").mockResolvedValue({});
  const remove = vi.spyOn(poolApi, "remove").mockResolvedValue({});
  vi.spyOn(window, "confirm").mockReturnValue(true);
  await open();
  fireEvent.click(screen.getByRole("button", { name: /Proxy nodes/ }));
  fireEvent.click(row("Relay").getByRole("button", { name: "Edit" }));
  await screen.findByDisplayValue(original);
  fireEvent.change(screen.getByLabelText("Display name"), { target: { value: "Local name" } });
  fireEvent.click(button("Save"));
  await waitFor(() => expect(save).toHaveBeenCalledWith("n1", "Local name", original));
  fireEvent.click(row("Relay").getByRole("button", { name: "Delete" }));
  await waitFor(() => expect(remove).toHaveBeenCalledWith("nodes", "n1"));
});

it("checks and deletes just the selected IDs across pages; failed deletion retains the selection", async () => {
  const latency = vi.spyOn(poolApi, "latency").mockResolvedValueOnce({ latency_ms: null, error: "offline" }).mockResolvedValue({ latency_ms: 10, error: "" });
  const remove = vi.spyOn(poolApi, "removeMany").mockRejectedValueOnce(new Error("In use")).mockResolvedValue({ count: 2 });
  vi.spyOn(window, "confirm").mockReturnValue(true);
  await open();
  fireEvent.change(screen.getByLabelText("Rows per page"), { target: { value: "10" } });
  fireEvent.click(screen.getByLabelText("Select Home 0"));
  fireEvent.click(button("Next page"));
  fireEvent.click(screen.getByLabelText("Select this page"));
  fireEvent.click(button("Check selected latency"));
  await screen.findByText("Checked 2 of 2: 1 succeeded, 1 failed");
  expect(latency.mock.calls).toEqual([["homes", "h0"], ["homes", "h10"]]);
  fireEvent.click(button("Delete selected"));
  await screen.findByText("In use");
  expect(screen.getByText("Selected: 2")).toBeTruthy();
  fireEvent.click(button("Delete selected"));
  await screen.findByText("Deleted 2 items");
  expect(remove).toHaveBeenLastCalledWith("homes", ["h0", "h10"]);
  expect(screen.queryByText("Selected: 2")).toBeNull();
});

it("stops launching checks after the in-flight items finish", async () => {
  const finish: ((timing: Timing) => void)[] = [];
  const check = vi.spyOn(poolApi, "latency").mockImplementation(() => new Promise((resolve) => finish.push(resolve)));
  await open();
  fireEvent.click(screen.getByLabelText("Select this page"));
  fireEvent.click(button("Check selected latency"));
  await waitFor(() => expect(finish).toHaveLength(3));
  fireEvent.click(button("Stop after current checks"));
  await act(async () => { finish.forEach((resolve) => resolve({ latency_ms: 10, error: "" })); });
  expect(check).toHaveBeenCalledTimes(3);
  expect(screen.getByText("Checked 3 of 11: 3 succeeded, 0 failed")).toBeTruthy();
});
