import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { expect, it } from "vitest";
import i18n from "../../i18n";
import StripePayment from "./StripePayment";

it("localizes the missing-context recovery page and exposes the language switcher", async () => {
  await i18n.changeLanguage("zh-TW");

  render(
    <MemoryRouter initialEntries={["/payment/stripe"]}>
      <StripePayment />
    </MemoryRouter>,
  );

  expect(screen.getByRole("heading", { name: "付款暫時不可用" })).toBeInTheDocument();
  expect(screen.getByText(/安全付款資訊已失效/)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "返回帳務" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "切換語言" })).toBeInTheDocument();
  expect(document.title).toBe("付款 | Mikiko CC");
});
