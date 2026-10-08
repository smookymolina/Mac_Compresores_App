import { Card, LinkButton } from "@/components/ui";

export default function NotFound() {
  return (
    <Card className="p-6 text-center">
      <p className="mb-4 font-medium">Registro no encontrado o sin acceso.</p>
      <LinkButton href="/dashboard" variant="secondary">Volver al dashboard</LinkButton>
    </Card>
  );
}
