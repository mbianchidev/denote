import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CodeToolPanel } from "./CodeToolPanel";
import { CodeIntelligenceHost } from "../plugins/codeHost";
import { api } from "../lib/api";
import type { CodeToolConfiguration } from "../lib/codeTools";
import type { PluginCodeContribution } from "../plugins/codeIntelligence";

vi.mock("../lib/api", () => ({
  api: {
    codeToolEnvironment: vi.fn(),
    chooseCodeToolExecutable: vi.fn(),
    saveCodeToolConfiguration: vi.fn(),
  },
  errorMessage: (error: unknown) => error instanceof Error ? error.message : String(error),
}));
const provider: PluginCodeContribution = {
  pluginId: "denote.synthetic", id: "denote.synthetic.code", title: "Code intelligence",
  languages: [{ id: "rust", title: "Rust", server: "Synthetic server", debugger: "Synthetic debugger", setup: "Choose an installed tool." }],
};
const configuration: CodeToolConfiguration = {
  enabled: false, executable: "", executableSha256: "", arguments: [], transport: "stdio", options: {}, launch: {}, attach: {},
};

describe("CodeToolPanel", () => {
  it("keeps approval separate from execution and exposes exact-location keyboard navigation", async () => {
    const user = userEvent.setup();
    const execute = vi.fn(async () => ({ status: "Ready" }));
    const host = new CodeIntelligenceHost();
    host.configure(provider, execute, "/synthetic/vault", "project-example", false);
    host.attach("sample/main.rs", "project-example", "fn main() {}\n", { apply: vi.fn(), readOnly: () => false });
    vi.mocked(api.codeToolEnvironment).mockResolvedValue({
      scope: { projectId: "project-example", rootPath: "sample" }, language: "rust", lsp: configuration, dap: configuration,
    });
    vi.mocked(api.chooseCodeToolExecutable).mockResolvedValue("/synthetic/bin/server");
    vi.mocked(api.saveCodeToolConfiguration).mockResolvedValue();
    const onNavigate = vi.fn(async () => {});
    render(<CodeToolPanel provider={provider} host={host} projectId="project-example"
      documentPath="sample/main.rs" files={["sample/main.rs", "sample/other.rs"]}
      encrypted={false} onNavigate={onNavigate} />);
    await screen.findByRole("checkbox", { name: "Enable language server" });
    expect(execute).not.toHaveBeenCalled();
    await user.click(screen.getByRole("checkbox", { name: "Enable language server" }));
    await user.click(screen.getByRole("button", { name: "Choose language server executable" }));
    await user.click(screen.getByRole("button", { name: "Save and approve language server" }));
    await waitFor(() => expect(api.saveCodeToolConfiguration).toHaveBeenCalledWith(
      "denote.synthetic", expect.objectContaining({ projectId: "project-example" }), "lsp",
      expect.objectContaining({ enabled: true, executable: "/synthetic/bin/server" }),
    ));
    expect(execute).not.toHaveBeenCalled();
    await user.type(screen.getByRole("textbox", { name: "File, line and column" }), "sample/other.rs:2:4");
    await user.click(screen.getByRole("button", { name: "Go to location" }));
    expect(onNavigate).toHaveBeenCalledWith(expect.objectContaining({
      path: "sample/other.rs", range: expect.objectContaining({ start: { line: 1, character: 3 } }),
    }));
    host.dispose();
  });

  it("does not expose executable controls for encrypted content", () => {
    const host = new CodeIntelligenceHost();
    render(<CodeToolPanel provider={provider} host={host} projectId={null}
      documentPath={null} files={[]} encrypted onNavigate={vi.fn()} />);
    expect(screen.getByText(/unavailable in encrypted vaults/i)).toBeVisible();
    expect(screen.queryByRole("button", { name: /Choose.*executable/i })).toBeNull();
    host.dispose();
  });
});
