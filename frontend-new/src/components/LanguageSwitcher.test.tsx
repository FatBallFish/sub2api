import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import i18n, { LOCALE_STORAGE_KEY } from "../i18n";
import LanguageSwitcher from "./LanguageSwitcher";

describe("LanguageSwitcher", () => {
  afterEach(async () => {
    await i18n.changeLanguage("en");
    localStorage.clear();
  });

  it("changes language immediately and exposes the persisted selection", async () => {
    const user = userEvent.setup();
    render(<LanguageSwitcher />);

    const trigger = screen.getByRole("button", { name: "Change language" });
    expect(trigger).toHaveAttribute("aria-haspopup", "menu");
    await user.click(trigger);

    expect(screen.getByRole("menu")).toBeInTheDocument();
    expect(screen.getByRole("menuitemradio", { name: "English" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("menuitemradio", { name: "简体中文" })).toBeInTheDocument();
    expect(screen.getByRole("menuitemradio", { name: "繁體中文" })).toBeInTheDocument();
    expect(screen.getByRole("menuitemradio", { name: "日本語" })).toBeInTheDocument();

    await user.click(screen.getByRole("menuitemradio", { name: "繁體中文" }));

    await waitFor(() => {
      expect(i18n.resolvedLanguage).toBe("zh-TW");
      expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe("zh-TW");
      expect(document.documentElement.lang).toBe("zh-TW");
    });
    expect(screen.getByRole("button", { name: "切換語言" })).toHaveFocus();

    await user.click(screen.getByRole("button", { name: "切換語言" }));
    expect(screen.getByRole("menuitemradio", { name: "繁體中文" })).toHaveAttribute("aria-checked", "true");
  });

  it("focuses the selected option when the menu opens", async () => {
    const user = userEvent.setup();
    await i18n.changeLanguage("zh-TW");
    render(<LanguageSwitcher />);

    await user.click(screen.getByRole("button", { name: "切換語言" }));

    expect(screen.getByRole("menuitemradio", { name: "繁體中文" })).toHaveFocus();
  });

  it("supports arrow, Home, and End menu navigation", async () => {
    const user = userEvent.setup();
    render(<LanguageSwitcher />);

    await user.click(screen.getByRole("button", { name: "Change language" }));
    expect(screen.getByRole("menuitemradio", { name: "English" })).toHaveFocus();

    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("menuitemradio", { name: "简体中文" })).toHaveFocus();

    await user.keyboard("{End}");
    expect(screen.getByRole("menuitemradio", { name: "日本語" })).toHaveFocus();

    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("menuitemradio", { name: "English" })).toHaveFocus();

    await user.keyboard("{Home}");
    expect(screen.getByRole("menuitemradio", { name: "English" })).toHaveFocus();

    await user.keyboard("{ArrowUp}");
    expect(screen.getByRole("menuitemradio", { name: "日本語" })).toHaveFocus();
  });

  it.each([
    { label: "Tab", shift: false, destination: "After" },
    { label: "Shift+Tab", shift: true, destination: "Change language" },
  ])("closes on $label while preserving native focus movement", async ({ shift, destination }) => {
    const user = userEvent.setup();
    render(
      <div>
        <LanguageSwitcher />
        <button type="button">After</button>
      </div>,
    );

    await user.click(screen.getByRole("button", { name: "Change language" }));
    expect(screen.getByRole("menuitemradio", { name: "English" })).toHaveFocus();

    await user.tab({ shift });

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: destination })).toHaveFocus();
  });

  it("closes the menu when Escape is pressed", async () => {
    const user = userEvent.setup();
    render(<LanguageSwitcher />);

    await user.click(screen.getByRole("button", { name: "Change language" }));
    expect(screen.getByRole("menu")).toBeInTheDocument();

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("closes the menu after a click outside", async () => {
    const user = userEvent.setup();
    render(
      <div>
        <button type="button">Outside</button>
        <LanguageSwitcher />
      </div>,
    );

    await user.click(screen.getByRole("button", { name: "Change language" }));
    expect(screen.getByRole("menu")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Outside" }));

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });
});
