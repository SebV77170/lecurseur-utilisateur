import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AccountsPanel } from "./AccountsPanel";
import { InvitationActivation } from "./InvitationActivation";
import { api } from "./api";
import type { User } from "./types";

const administrator: User = { id: "admin", displayName: "Admin", email: "admin@example.test", role: "admin", invitationStatus: "accepted" };
const practitioner: User = { id: "practitioner", displayName: "Praticien", email: "practitioner@example.test", role: "praticien", invitationStatus: "accepted" };
const pending: User = { id: "client", displayName: "Client invite", email: "client@example.test", role: "client", invitationStatus: "pending" };
const invitation = { url: "http://localhost:5180/#invitation=test", expiresAt: "2026-10-13T10:00:00.000Z" };

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("profile interface", () => {
  it("lets an admin choose all roles and a client's practitioner", async () => {
    const create = vi.spyOn(api, "inviteUser").mockResolvedValue({ user: pending, invitation });
    const refresh = vi.fn().mockResolvedValue(undefined);
    render(<AccountsPanel user={administrator} profiles={[administrator, practitioner]} onRefresh={refresh} />);
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toContain("Administrateur");
    fireEvent.change(screen.getByLabelText("Nom complet"), { target: { value: "Client invite" } });
    fireEvent.change(screen.getByLabelText("Adresse e-mail"), { target: { value: pending.email } });
    fireEvent.change(screen.getByLabelText("Praticien referent"), { target: { value: practitioner.id } });
    fireEvent.submit(screen.getByRole("form", { name: "Creation de profil" }));
    await waitFor(() => expect(create).toHaveBeenCalledWith({ displayName: pending.displayName, email: pending.email, role: "client", practitionerId: practitioner.id }));
    expect(await screen.findByDisplayValue(invitation.url)).toBeInTheDocument();
    expect(screen.getByText(/Aucun e-mail n'a ete envoye/)).toBeInTheDocument();
    expect(refresh).toHaveBeenCalledOnce();
    expect(screen.queryByLabelText(/mot de passe/i)).not.toBeInTheDocument();
  });

  it("offers only client creation to practitioners and displays duplicate errors", async () => {
    vi.spyOn(api, "inviteUser").mockRejectedValue(new Error("Un compte existe deja avec cette adresse e-mail."));
    render(<AccountsPanel user={practitioner} profiles={[pending]} onRefresh={vi.fn()} />);
    expect(screen.queryByLabelText("Type de profil")).not.toBeInTheDocument();
    fireEvent.submit(screen.getByRole("form", { name: "Creation de profil" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/existe deja/);
  });

  it("renews a pending profile's invitation", async () => {
    const renew = vi.spyOn(api, "renewInvitation").mockResolvedValue({ user: pending, invitation });
    render(<AccountsPanel user={practitioner} profiles={[pending]} onRefresh={vi.fn().mockResolvedValue(undefined)} />);
    fireEvent.click(screen.getByRole("button", { name: "Regenerer le lien de Client invite" }));
    expect(await screen.findByDisplayValue(invitation.url)).toBeInTheDocument();
    expect(renew).toHaveBeenCalledWith(pending.id);
  });
});

describe("personal password activation", () => {
  it("validates confirmation then activates with the chosen password", async () => {
    vi.spyOn(api, "resolveInvitation").mockResolvedValue({ user: pending, expiresAt: invitation.expiresAt });
    const accept = vi.spyOn(api, "acceptInvitation").mockResolvedValue({ token: "session", user: { ...pending, invitationStatus: "accepted" } });
    const activated = vi.fn().mockResolvedValue(undefined);
    render(<InvitationActivation token="invitation" onActivated={activated} onCancel={vi.fn()} />);
    const password = await screen.findByLabelText("Mot de passe personnel");
    fireEvent.change(password, { target: { value: "MotDePassePersonnel!42" } });
    fireEvent.change(screen.getByLabelText("Confirmer le mot de passe"), { target: { value: "DifferentPassword!42" } });
    fireEvent.submit(screen.getByRole("button", { name: "Activer mon compte" }).closest("form")!);
    expect(await screen.findByRole("alert")).toHaveTextContent(/ne correspondent pas/);
    expect(accept).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Confirmer le mot de passe"), { target: { value: "MotDePassePersonnel!42" } });
    fireEvent.submit(screen.getByRole("button", { name: "Activer mon compte" }).closest("form")!);
    await waitFor(() => expect(activated).toHaveBeenCalledOnce());
    expect(accept).toHaveBeenCalledWith("invitation", "MotDePassePersonnel!42");
  });

  it("shows an expired invitation without a password form", async () => {
    vi.spyOn(api, "resolveInvitation").mockRejectedValue(new Error("Ce lien est expire."));
    render(<InvitationActivation token="expired" onActivated={vi.fn()} onCancel={vi.fn()} />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/expire/);
    expect(screen.queryByLabelText("Mot de passe personnel")).not.toBeInTheDocument();
  });
});
