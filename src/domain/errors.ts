/** Error de dominio con mensaje seguro para mostrar al usuario. */
export class AppError extends Error {
  constructor(
    message: string,
    public code: "FORBIDDEN" | "NOT_FOUND" | "CONFLICT" | "VALIDATION" | "UNAUTHENTICATED" = "VALIDATION",
  ) {
    super(message);
  }
}
