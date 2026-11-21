import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { api, type ProxyTestResult } from "../lib/api";
import { poolApi, type Catalog } from "./api";
import { ProfileProxyField } from "./ProfileProxyField";
import { ProxyWorkspace } from "./ProxyWorkspace";

const home = "a".repeat(32), node = "b".repeat(32), source = "c".repeat(32);
const catalog: Catalog = {
  homes: [{ id: home, name: "Home", endpoint: "http://home.example:8080", group_name: "", latency_ms: null, error: "" }],
  nodes: [{ id: node, name: "Office", protocol: "http", source_id: null, latency_ms: null, error: "" }],
  subscriptions: [{ id: source, name: "Provider", synced_at: null }], kernel_path: "", kernel_available: true,
};
function Draft({ initial = "" }: { initial?: string }) {
  const [value, setValue] = useState<string | null>(initial);
  return <><ProfileProxyField value={value ?? ""} onChange={setValue} /><output data-testid="draft">{value}</output></>;
}
afterEach(() => vi.restoreAllMocks());

it("composes both selectors independently and clears each hop without changing the other", async () => {
  vi.spyOn(poolApi, "catalog").mockResolvedValue(catalog);
  render(<Draft />);
  await screen.findByRole("option", { name: "Home" });
  const homeSelect = screen.getByLabelText("Static residential proxy");
  const nodeSelect = screen.getByLabelText("Proxy node");
  const draft = () => screen.getByTestId("draft").textContent;
  expect(screen.getByRole("group", { name: "Proxy" })).toBeTruthy();
  expect(screen.queryByText("Proxy")).toBeNull();
  expect(screen.queryByRole("textbox")).toBeNull();
  expect(draft()).toBe("");
  fireEvent.change(homeSelect, { target: { value: home } });
  expect(draft()).toBe(`pool:${home}:`);
  fireEvent.change(nodeSelect, { target: { value: node } });
  expect(draft()).toBe(`pool:${home}:${node}`);
  fireEvent.change(homeSelect, { target: { value: "" } });
  expect(draft()).toBe(`pool::${node}`);
  fireEvent.change(nodeSelect, { target: { value: "" } });
  expect(draft()).toBe("");
});

it("never displays a late result on a different route", async () => {
  vi.spyOn(poolApi, "catalog").mockResolvedValue(catalog);
  let done!: (v: ProxyTestResult) => void;
  vi.spyOn(api, "testProxy").mockImplementation(() => new Promise((r) => { done = r; }));
  render(<Draft initial={`pool:${home}:`} />);
  fireEvent.click(await screen.findByRole("button", { name: "Test connection" }));
  fireEvent.change(screen.getByLabelText("Proxy node"), { target: { value: node } });
  await act(async () => done({ ok: true, ip: "192.0.2.1" }));
  expect(screen.queryByText("192.0.2.1")).toBeNull();
});

it("measures a single node and syncs only the chosen subscription using that node", async () => {
  vi.spyOn(poolApi, "catalog").mockResolvedValue(catalog);
  const check = vi.spyOn(poolApi, "latency").mockResolvedValue({ latency_ms: 12, error: "" });
  const sync = vi.spyOn(poolApi, "sync").mockResolvedValue({ count: 1 });
  render(<ProxyWorkspace onClose={vi.fn()} />);
  await screen.findByText("Home");
  fireEvent.click(screen.getByRole("button", { name: /Proxy nodes/ }));
  const row = screen.getByText("Office").closest("tr")!;
  fireEvent.click(within(row).getByRole("button", { name: "Check latency" }));
  await waitFor(() => expect(check).toHaveBeenCalledWith("nodes", node));
  fireEvent.click(screen.getByRole("button", { name: /Subscriptions/ }));
  fireEvent.change(screen.getByLabelText("Fetch through"), { target: { value: node } });
  fireEvent.click(screen.getByRole("button", { name: "Sync subscription" }));
  await waitFor(() => expect(sync).toHaveBeenCalledWith(source, node));
});

it("shows the visible range and keeps page size selectable on short or empty results", async () => {
  const homes = Array.from({ length: 53 }, (_, i) => ({
    ...catalog.homes[0]!, id: String(i + 1), name: `Home ${i + 1}`,
  }));
  vi.spyOn(poolApi, "catalog").mockResolvedValue({ ...catalog, homes });
  render(<ProxyWorkspace onClose={vi.fn()} />);
  await screen.findByText("Showing 1–40 of 53");
  fireEvent.click(screen.getByRole("button", { name: "Next page" }));
  expect(screen.getByText("Showing 41–53 of 53")).toBeTruthy();
  expect(screen.getByText("Home 53")).toBeTruthy();

  const size = screen.getByRole("combobox", { name: "Rows per page" }) as HTMLSelectElement;
  fireEvent.change(size, { target: { value: "10" } });
  expect(screen.getByText("Showing 1–10 of 53")).toBeTruthy();
  expect(screen.queryByText("Home 11")).toBeNull();

  const search = screen.getByRole("textbox", { name: "Search pool" });
  fireEvent.change(search, { target: { value: "Home 5" } });
  expect(screen.getByText("Showing 1–5 of 5 (53 before filtering)")).toBeTruthy();
  fireEvent.change(search, { target: { value: "nonexistent" } });
  expect(screen.getByText("0 entries (53 before filtering)")).toBeTruthy();
  expect((screen.getByRole("button", { name: "Next page" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(size, { target: { value: "20" } });
  fireEvent.click(screen.getByRole("button", { name: /Proxy nodes/ }));
  expect(screen.getByText("Showing 1–1 of 1")).toBeTruthy();
  expect(size.value).toBe("20");
});
