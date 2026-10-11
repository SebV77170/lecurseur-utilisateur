import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import type { AppDatabase } from "./database.js";
import type { Role, User } from "./types.js";

const jwtSecret = process.env.JWT_SECRET ?? "dev-only-change-before-production";

export type AuthenticatedRequest = Request & {
  user?: User;
};

export function signUser(user: User) {
  return jwt.sign(
    {
      sub: user.id,
      role: user.role
    },
    jwtSecret,
    {
      expiresIn: "8h",
      issuer: "le-curseur-demo"
    }
  );
}

export function authentication(database: AppDatabase) {
  return function authenticate(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    const header = req.header("authorization");
    const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : null;

    if (!token) {
      res.status(401).json({ message: "Authentification requise." });
      return;
    }

    try {
      const payload = jwt.verify(token, jwtSecret, {
        issuer: "le-curseur-demo"
      });
      const userId = typeof payload === "object" ? payload.sub : undefined;
      const user = typeof userId === "string" ? database.find("users", { id: userId }) : undefined;

      if (!user || user.invitationStatus !== "accepted") {
        res.status(401).json({ message: "Session invalide." });
        return;
      }

      req.user = user;
      next();
    } catch {
      res.status(401).json({ message: "Session expiree ou invalide." });
    }
  };
}

export function requireRole(...roles: Role[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) {
      res.status(403).json({ message: "Droits insuffisants." });
      return;
    }

    next();
  };
}

export function canAccessClient(database: AppDatabase, user: User, clientId: string) {
  if (user.role === "admin") {
    return true;
  }

  if (user.role === "praticien") {
    return !!database.find("clients", { id: clientId, assignedPractitionerId: user.id });
  }

  return user.clientId === clientId;
}

