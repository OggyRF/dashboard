// Typed errors thrown by services. Actions turn them into friendly messages;
// anything else is logged and shown as a generic failure.
export class AppError extends Error {
  constructor(
    public readonly code: "NOT_FOUND" | "FORBIDDEN" | "VALIDATION" | "CONFLICT",
    message: string,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const notFound = (what: string) => new AppError("NOT_FOUND", `${what} was not found.`);
export const forbidden = () => new AppError("FORBIDDEN", "You do not have permission to do that.");
export const invalid = (message: string) => new AppError("VALIDATION", message);
export const conflict = (message: string) => new AppError("CONFLICT", message);
