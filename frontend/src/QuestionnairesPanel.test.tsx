import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "./api";
import { QuestionnairesPanel, ResponseForm } from "./QuestionnairesPanel";
import type { Questionnaire, User } from "./types";

const questionnaire: Questionnaire = { id: "test", title: "Mon suivi", version: 1, status: "published", sensitivity: "health", questions: [
  { id: "scale", label: "Votre confort", type: "scale", required: true, min: 1, max: 10 },
  { id: "multi", label: "Vos activités", type: "multiple", required: true, options: ["Marche", "Yoga", "Natation"], min: 1, max: 2 },
  { id: "bool", label: "Une difficulté ?", type: "boolean", required: true }
] };
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
describe("patient questionnaire form", () => {
  it("requires an explicit slider choice, submits false and selected options, and retains answers after a network failure", async () => {
    const submit = vi.fn().mockRejectedValueOnce(new Error("Connexion interrompue")).mockResolvedValueOnce(undefined);
    render(<ResponseForm questionnaire={questionnaire} onSubmit={submit} />);
    const form = screen.getByRole("form", { name: "Répondre au questionnaire" });
    const slider = screen.getByRole("slider");
    expect(slider).toHaveAttribute("min", "1");
    expect(slider).toHaveAttribute("max", "10");
    expect(slider).toHaveAttribute("aria-valuetext", "Aucune valeur sélectionnée");
    fireEvent.submit(form);
    expect(submit).not.toHaveBeenCalled();
    expect(screen.getAllByText("Cette question est obligatoire.")).toHaveLength(3);
    fireEvent.change(slider, { target: { value: "7" } });
    expect(screen.getByText("Valeur choisie : 7")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Marche"));
    fireEvent.click(screen.getByLabelText("Non"));
    fireEvent.submit(form);
    expect(await screen.findByRole("alert")).toHaveTextContent("Connexion interrompue");
    expect(slider).toHaveValue("7");
    fireEvent.submit(form);
    await waitFor(() => expect(submit).toHaveBeenLastCalledWith({ scale: 7, multi: ["Marche"], bool: false }));
    expect(await screen.findByRole("status")).toHaveTextContent("transmises");
  });
  it("allows choosing a slider endpoint and rejects too many checkbox answers", () => {
    const submit = vi.fn();
    render(<ResponseForm questionnaire={questionnaire} onSubmit={submit} />);
    fireEvent.click(screen.getByRole("button", { name: "Choisir 1 pour Votre confort" }));
    expect(screen.getByRole("slider")).toHaveValue("1");
    for (const label of ["Marche", "Yoga", "Natation", "Oui"]) fireEvent.click(screen.getByLabelText(label));
    fireEvent.submit(screen.getByRole("form"));
    expect(screen.getByText("Sélectionnez entre 1 et 2 choix.")).toBeInTheDocument();
    expect(submit).not.toHaveBeenCalled();
  });
});
describe("practitioner questionnaire editor", () => {
  const user: User = { id: "p", role: "praticien", displayName: "Praticien", email: "p@example.test", invitationStatus: "accepted" };
  it("creates a draft with a required configurable slider and exposes publishing separately", async () => {
    const save = vi.spyOn(api, "saveQuestionnaire").mockResolvedValue({ questionnaire });
    const refresh = vi.fn().mockResolvedValue(undefined);
    render(<QuestionnairesPanel user={user} questionnaires={[]} assignments={[]} responses={[]} clients={[]} selectedClientId="" onRefresh={refresh} />);
    fireEvent.click(screen.getByRole("button", { name: "Créer un questionnaire" }));
    fireEvent.change(screen.getByLabelText("Titre du questionnaire"), { target: { value: "Mon échelle" } });
    fireEvent.change(screen.getByLabelText("Intitulé de la question 1"), { target: { value: "Votre confort" } });
    fireEvent.change(screen.getByLabelText("Type de question 1"), { target: { value: "scale" } });
    expect(screen.getByLabelText("Valeur minimale")).toHaveValue(1);
    fireEvent.change(screen.getByLabelText("Valeur maximale"), { target: { value: "20" } });
    fireEvent.click(screen.getByLabelText("Question obligatoire"));
    fireEvent.submit(screen.getByRole("form", { name: "Éditeur de questionnaire" }));
    await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ title: "Mon échelle", questions: [expect.objectContaining({ type: "scale", min: 1, max: 20, required: true })] }), undefined));
    expect(refresh).toHaveBeenCalledOnce();
  });
});
