import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Workspace } from "./pages/Workspace.js";

const fetchMock = vi.fn(async (url: string) => {
  if (url.includes("/stats")) return new Response(JSON.stringify({ needs_review: 1 }));
  if (url.includes("/transactions?")) return new Response(JSON.stringify([
    { id: "T1", date: "2026-03-01", amount: 1000, currency: "EUR",
      counterparty_name: "Acme", structured_reference: null, description: "x",
      status: "needs_review", version: 1 },
  ]));
  return new Response("[]");
});
vi.stubGlobal("fetch", fetchMock);

describe("workspace smoke", () => {
  it("renders the list", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={qc}><Workspace /></QueryClientProvider>);
    expect(await screen.findByText("Acme")).toBeInTheDocument();
  });
});
