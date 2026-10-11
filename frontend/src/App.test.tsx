import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { App } from "./App";

describe("App", () => {
  it("shows the private login screen by default", () => {
    render(<App />);
    expect(screen.getByRole("heading", { name: /connexion privee/i })).toBeInTheDocument();
    expect(screen.getByText(/acces sur invitation/i)).toBeInTheDocument();
  });
});

