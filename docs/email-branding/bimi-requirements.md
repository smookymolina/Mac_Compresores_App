# Requisitos BIMI por proveedor (consultado 2026-10-11)

| Proveedor | Mecanismo | Requisitos relevantes | Estado MAC | Bloqueos | Próxima acción |
|---|---|---|---|---|---|
| Gmail | BIMI | DMARC `quarantine/reject` pct=100; **VMC o CMC** (PEM en `a=`); VMC añade palomita azul | DMARC ✔; sin certificado; DKIM sin confirmar | Certificado | Confirmar DKIM; cotizar CMC/VMC |
| Apple Mail (iCloud) | BIMI | DMARC en aplicación; certificado VMC (confirmar con CA si acepta CMC) | Sin certificado | Certificado | Igual que Gmail |
| Yahoo/AOL | BIMI | DMARC en aplicación; puede mostrar logos sin certificado a remitentes con reputación/volumen suficientes (criterio propio) | Elegible en teoría tras publicar BIMI | Volumen/reputación no garantizados | Publicar BIMI sin `a=` |
| Outlook/Microsoft 365 | No usa BIMI | Perfil de marca propio de Microsoft | — | — | Fuera de alcance |
| Gmail (alternativa sin BIMI) | Foto de perfil de Cuenta de Google | Crear Cuenta de Google con `ventas@maccompresores.com.mx` y poner el logo | No creada | Ninguno técnico | Opcional, gratis; no es verificación de marca |

**VMC vs CMC:** VMC exige marca registrada ante una oficina reconocida (IMPI en México es elegible según la CA); CMC no exige registro pero sí prueba de uso público del logotipo ≥ 12 meses en un dominio propio. Emisores habituales: DigiCert, Sectigo, GlobalSign, SSL.com — precios anuales del orden de cientos a >1 000 USD; **verificar directamente con la CA**. No se asume que MAC tenga marca registrada. No se compró nada.

SVG: perfil SVG Tiny PS (`baseProfile="tiny-ps"`, `version="1.2"`), `<title>` obligatorio, sin scripts/animaciones/referencias externas, cuadrado, fondo sólido, ≤ 32 KB.

Fuentes: [Google Workspace — Set up BIMI](https://knowledge.workspace.google.com/admin/security/set-up-bimi) · [Red Sift — Gmail CMC](https://redsift.com/es/blog/gmail-supports-common-mark-certificates-for-bimi-adoption) · [Valimail — BIMI SVG](https://www.valimail.com/blog/bimi-compatible-logos/) · [Suped — SVG BIMI](https://www.suped.com/knowledge/email-authentication/bimi/what-are-the-specific-requirements-for-an-svg-image-to-be-bimi-compliant) · [BIMI Group](https://bimigroup.org/). Varias son de proveedores; confirmar en la CA antes de comprar.
