import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import PublicLayout from "./PublicLayout";

describe("PublicLayout", () => {
  afterEach(() => {
    localStorage.clear();
  });

  it("shows sign in for anonymous visitors", () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route element={<PublicLayout />}>
            <Route path="/" element={<div>Home</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByRole("link", { name: /sign in/i })).toHaveAttribute("href", "/login");
  });

  it("shows the current account and routes console CTAs for authenticated visitors", () => {
    localStorage.setItem("auth_token", "token");
    localStorage.setItem("auth_user", JSON.stringify({ id: 7, email: "signed@example.com" }));

    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route element={<PublicLayout />}>
            <Route path="/" element={<div>Home</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.queryByRole("link", { name: /sign in/i })).not.toBeInTheDocument();
    expect(screen.getByText("signed@example.com")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /open console/i })).toHaveAttribute("href", "/console");
  });
});
