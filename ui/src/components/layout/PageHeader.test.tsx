import { describe, it, expect, vi } from "vitest";
import { Plus } from "lucide-react";
import { render, screen, userEvent } from "../../test-utils";
import { PageHeader, PageHeaderButton } from "./PageHeader";

// Spec 196, FR-1 — on a phone the header actions wrap under the title and the
// add button shrinks to its icon; the label must survive as its accessible name.

describe("PageHeader", () => {
  it("renders the title, the subtitle and the actions", () => {
    render(<PageHeader title="Équipements" subtitle="12 équipements" actions={<button>Filtrer</button>} />);
    expect(screen.getByRole("heading", { level: 1, name: "Équipements" })).toBeTruthy();
    expect(screen.getByText("12 équipements")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Filtrer" })).toBeTruthy();
  });

  it("lets the row wrap so the actions drop under the title on a phone", () => {
    const { container } = render(<PageHeader title="Topologie" actions={<button>Ajouter</button>} />);
    expect(container.firstElementChild?.className).toContain("flex-wrap");
  });

  it("hides the title visually below lg, where the top bar names the page", () => {
    // Spec 196, decision pr6-h1 — still the page heading for screen readers.
    render(<PageHeader title="Équipements" actions={<button>Filtrer</button>} />);
    const title = screen.getByRole("heading", { level: 1, name: "Équipements" });
    expect(title.className).toBe("sr-only lg:not-sr-only");
  });

  it("renders no actions row when there are none", () => {
    const { container } = render(<PageHeader title="Logs" />);
    expect(container.firstElementChild?.childElementCount).toBe(1);
  });
});

describe("PageHeaderButton", () => {
  it("keeps its label as accessible name when only the icon shows", () => {
    render(<PageHeaderButton icon={Plus} label="Ajouter une zone" onClick={() => {}} />);
    const button = screen.getByRole("button", { name: "Ajouter une zone" });
    expect(button.getAttribute("aria-label")).toBe("Ajouter une zone");
    // The visible label is hidden below 640 px, shown from `sm` up.
    expect(screen.getByText("Ajouter une zone").className).toContain("hidden sm:inline");
  });

  it("calls onClick", async () => {
    const onClick = vi.fn();
    render(<PageHeaderButton icon={Plus} label="Ajouter" onClick={onClick} />);
    await userEvent.click(screen.getByRole("button", { name: "Ajouter" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
