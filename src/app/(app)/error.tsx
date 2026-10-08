"use client";

import { Button, Card, ErrorState } from "@/components/ui";

export default function AppError({ reset }: { error: Error; reset: () => void }) {
  return (
    <Card>
      <ErrorState action={<Button onClick={reset}>Reintentar</Button>}>
        Intenta de nuevo; si persiste, contacta al administrador.
      </ErrorState>
    </Card>
  );
}
