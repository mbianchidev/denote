import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ActivityRail } from "./ActivityRail";

describe("ActivityRail", () => {
  it("opens About Denote from a named button", async () => {
    const user = userEvent.setup();
    const onAbout = vi.fn();
    render(
      <ActivityRail
        activeView="files"
        activePluginView={null}
        activeSourceControlProvider={null}
        pluginViews={[]}
        sourceControlProviders={[]}
        theme="dark"
        onViewChange={vi.fn()}
        onPluginViewChange={vi.fn()}
        onSourceControlProviderChange={vi.fn()}
        onAbout={onAbout}
        onThemeToggle={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "About Denote" }));
    expect(onAbout).toHaveBeenCalledOnce();
  });

  it("opens a registered plugin sidebar view", async () => {
    const user = userEvent.setup();
    const onPluginViewChange = vi.fn();
    render(
      <ActivityRail
        activeView="files"
        activePluginView={null}
        activeSourceControlProvider={null}
        pluginViews={[{ id: "denote.reference.status", title: "Plugin reference" }]}
        sourceControlProviders={[]}
        theme="dark"
        onViewChange={vi.fn()}
        onPluginViewChange={onPluginViewChange}
        onSourceControlProviderChange={vi.fn()}
        onAbout={vi.fn()}
        onThemeToggle={vi.fn()}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "Plugin reference" }),
    );

    expect(onPluginViewChange).toHaveBeenCalledWith(
      "denote.reference.status",
    );
  });

  it("identifies source control providers by plugin and provider id", async () => {
    const user = userEvent.setup();
    const onSourceControlProviderChange = vi.fn();
    render(
      <ActivityRail
        activeView="files"
        activePluginView={null}
        activeSourceControlProvider={{
          pluginId: "denote.alpha",
          providerId: "git",
        }}
        pluginViews={[]}
        sourceControlProviders={[
          {
            pluginId: "denote.alpha",
            id: "git",
            title: "Git",
            model: sourceControlModel(),
          },
          {
            pluginId: "denote.beta",
            id: "git",
            title: "Git",
            model: sourceControlModel(),
          },
        ]}
        theme="dark"
        onViewChange={vi.fn()}
        onPluginViewChange={vi.fn()}
        onSourceControlProviderChange={onSourceControlProviderChange}
        onAbout={vi.fn()}
        onThemeToggle={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("button", {
        name: "Source control: Git (denote.alpha)",
      }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Files" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );

    const betaProvider = screen.getByRole("button", {
      name: "Source control: Git (denote.beta)",
    });
    betaProvider.focus();
    await user.keyboard("{Enter}");
    expect(onSourceControlProviderChange).toHaveBeenCalledWith(
      "denote.beta",
      "git",
    );
  });

  it("disambiguates providers with duplicate titles from the same plugin", () => {
    render(
      <ActivityRail
        activeView="files"
        activePluginView={null}
        activeSourceControlProvider={null}
        pluginViews={[]}
        sourceControlProviders={[
          {
            pluginId: "denote.git",
            id: "denote.git.primary",
            title: "Git",
            model: sourceControlModel(),
          },
          {
            pluginId: "denote.git",
            id: "denote.git.secondary",
            title: "Git",
            model: sourceControlModel(),
          },
        ]}
        theme="dark"
        onViewChange={vi.fn()}
        onPluginViewChange={vi.fn()}
        onSourceControlProviderChange={vi.fn()}
        onAbout={vi.fn()}
        onThemeToggle={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("button", {
        name: "Source control: Git (denote.git.primary)",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "Source control: Git (denote.git.secondary)",
      }),
    ).toBeInTheDocument();
  });
});

function sourceControlModel() {
  return {
    selectedTab: "changes" as const,
    selectedView: { kind: "repository" as const },
    repository: {
      repositoryId: "synthetic-repository",
      label: "Synthetic repository",
      initialized: true,
      branch: "main",
      upstream: null,
      ahead: 0,
      behind: 0,
      latestCommit: null,
      busy: false,
    },
    resourceGroups: [],
    branches: [],
    remotes: [],
    history: [],
    diffFiles: [],
    conflicts: [],
    recovery: { state: "idle" as const },
  };
}
