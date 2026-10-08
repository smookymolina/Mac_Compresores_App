"use client";

import { Button, Card } from "@/components/ui";

export default function AppError({ reset }: { error: Error; reset: () => void }) {
  return (
    <Card className="p-6 text-center">
      <p className="font-medium">No se pudo cargar esta sección.</p>
      <p className="mb-4 text-sm text-ink-soft">Intenta de nuevo; si persiste, contacta al administrador.</p>
      <Button onClick={reset}>Reintentar</Button>
    </Card>
  );
}
