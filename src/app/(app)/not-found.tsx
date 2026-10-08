import { SearchX } from "lucide-react";
import { Card, EmptyState, LinkButton } from "@/components/ui";

export default function NotFound() {
  return (
    <Card>
      <EmptyState icon={SearchX} title="Registro no encontrado o sin acceso." action={<LinkButton href="/dashboard" variant="secondary">Volver al dashboard</LinkButton>} />
    </Card>
  );
}
