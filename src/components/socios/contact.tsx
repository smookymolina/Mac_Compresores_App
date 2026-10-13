/** Contacto que ve el socio en pantallas de bloqueo o cuota. Configurable aquí; sin teléfono por ahora. */
export interface PortalContact {
  email?: string;
  phone?: string;
}

export const PORTAL_CONTACT: PortalContact = { email: "ventas@maccompresores.com.mx" };

export function ContactLine({ contact }: { contact?: PortalContact }) {
  if (!contact?.email && !contact?.phone) return null;
  return (
    <p className="text-sm text-ink-soft">
      Contacto:{" "}
      {contact.email && <a className="auth-link" href={`mailto:${contact.email}`}>{contact.email}</a>}
      {contact.email && contact.phone && " · "}
      {contact.phone && <a className="auth-link" href={`tel:${contact.phone.replace(/[^\d+]/g, "")}`}>{contact.phone}</a>}
    </p>
  );
}
