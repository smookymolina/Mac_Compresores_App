"use client";

import { useActionState, useCallback, useEffect, useId, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Check, Copy, ExternalLink, Link2, Mail, MessageCircle, Send, Share2, TriangleAlert } from "lucide-react";
import type { ActionResult } from "@/lib/errors";
import { formatPhone, normalizePhone, whatsappUrl } from "@/modules/quotes/phone";
import { cn, fmtDate } from "@/lib/utils";
import { Button, type BtnVariant } from "./button";
import { Dialog } from "./dialog";
import { useToast } from "./toast";

type Params = Record<string, string>;
type ShareLink = { url: string; expiresAt: string };

export interface SendSuggestion {
  label: string;
  email?: string | null;
  phone?: string | null;
}

export interface SendDialogProps {
  /** Texto del botón que abre el modal. */
  triggerLabel: string;
  /** Texto corto para pantallas angostas (< 640 px); `triggerLabel` sigue siendo el nombre accesible. */
  triggerShortLabel?: string;
  triggerVariant?: BtnVariant;
  triggerSize?: "md" | "sm";
  triggerClassName?: string;
  /** Título del modal, p. ej. «Enviar cotización C-12». */
  title: string;
  /** Nombre corto del documento para la hoja de compartir del dispositivo. */
  docName: string;
  /**
   * El botón vive dentro de un <form> de filtros: al abrir se validan y se leen sus campos (desde, hasta…),
   * que viajan a las acciones como campos ocultos y en la URL del archivo.
   */
  paramsFromForm?: boolean;
  /** Archivo descargable con la sesión del usuario (para «Compartir archivo» en móviles). */
  file: { url: string; filename: string; type: string };
  /** Sugerencias de destinatario (cliente y contactos). */
  suggestions?: SendSuggestion[];
  email: {
    action: (prev: ActionResult<unknown> | null, fd: FormData) => Promise<ActionResult<unknown>>;
    /** null = disponible; texto = motivo por el que no se puede enviar. */
    unavailable?: string | null;
    defaultTo?: string;
    /** Admite {desde} y {hasta} (se muestran como fecha). */
    defaultMessage: string;
    note?: string;
  };
  whatsapp: {
    linkAction: (fd: FormData) => Promise<ActionResult<ShareLink | undefined>>;
    logAction: (fd: FormData) => Promise<ActionResult<unknown>>;
    /** Motivo por el que no se puede generar el enlace público (p. ej. falta SHARE_SECRET). */
    unavailable?: string | null;
    defaultPhone?: string;
    defaultMessage: string;
    note?: string;
  };
}

const fmtParam = (v: string) => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? fmtDate(`${v}T12:00:00Z`) : v);
const fill = (tpl: string, params: Params) => tpl.replace(/\{(\w+)\}/g, (m, k: string) => (params[k] ? fmtParam(params[k]) : m));

function toFormData(params: Params, extra: Params = {}) {
  const fd = new FormData();
  for (const [k, v] of Object.entries({ ...params, ...extra })) fd.set(k, v);
  return fd;
}

function withQuery(url: string, params: Params) {
  const qs = new URLSearchParams(params).toString();
  return qs ? `${url}${url.includes("?") ? "&" : "?"}${qs}` : url;
}

/** ¿El navegador puede compartir archivos (Web Share API nivel 2)? Solo en cliente. */
function canShareFiles(type: string, filename: string) {
  try {
    return typeof navigator !== "undefined" && typeof navigator.canShare === "function"
      && navigator.canShare({ files: [new File(["x"], filename, { type })] });
  } catch {
    return false;
  }
}

/** Botón «Enviar» + modal con dos vías: correo electrónico (archivo adjunto) y WhatsApp (enlace firmado o archivo). */
export function SendDialog(p: SendDialogProps) {
  const [open, setOpen] = useState(false);
  const [params, setParams] = useState<Params>({});
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const onOpen = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (p.paramsFromForm) {
      const form = e.currentTarget.form;
      if (form && !form.reportValidity()) return;
      const next: Params = {};
      if (form) for (const [k, v] of new FormData(form)) if (typeof v === "string" && v) next[k] = v;
      setParams(next);
    }
    setOpen(true);
  };
  const close = useCallback(() => setOpen(false), []);

  return (
    <>
      <Button
        type="button" variant={p.triggerVariant ?? "secondary"} size={p.triggerSize} className={p.triggerClassName}
        aria-haspopup="dialog" aria-label={p.triggerShortLabel ? p.triggerLabel : undefined} onClick={onOpen}
      >
        <Send size={16} strokeWidth={1.75} aria-hidden />
        {p.triggerShortLabel ? (
          <><span className="max-sm:hidden">{p.triggerLabel}</span><span className="sm:hidden">{p.triggerShortLabel}</span></>
        ) : p.triggerLabel}
      </Button>
      {mounted && createPortal(
        <Dialog open={open} onClose={close} title={p.title} className="send-dialog">
          <SendPanels {...p} params={params} onDone={close} />
        </Dialog>,
        document.body,
      )}
    </>
  );
}

function SendPanels(p: SendDialogProps & { params: Params; onDone: () => void }) {
  const [tab, setTab] = useState<"email" | "whatsapp">(p.email.unavailable && !p.whatsapp.unavailable ? "whatsapp" : "email");
  const base = useId();
  const tabs = [
    { id: "email" as const, label: "Correo electrónico", Icon: Mail },
    { id: "whatsapp" as const, label: "WhatsApp", Icon: MessageCircle },
  ];
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight" && e.key !== "Home" && e.key !== "End") return;
    e.preventDefault();
    const next = tab === "email" ? "whatsapp" : "email";
    setTab(next);
    document.getElementById(`${base}-tab-${next}`)?.focus();
  };

  return (
    <div className="send-body">
      <div role="tablist" aria-label="Medio de envío" className="send-tabs" onKeyDown={onKey}>
        {tabs.map(({ id, label, Icon }) => (
          <button
            key={id} id={`${base}-tab-${id}`} type="button" role="tab" aria-selected={tab === id} aria-controls={`${base}-panel-${id}`}
            tabIndex={tab === id ? 0 : -1} className="send-tab" onClick={() => setTab(id)}
          >
            <Icon size={16} strokeWidth={1.75} aria-hidden /> {label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`${base}-panel-${tab}`} aria-labelledby={`${base}-tab-${tab}`} className="send-panel">
        {tab === "email" ? <EmailPanel {...p} /> : <WhatsAppPanel {...p} />}
      </div>
    </div>
  );
}

function Unavailable({ children }: { children: React.ReactNode }) {
  return (
    <p role="status" className="send-alert">
      <TriangleAlert size={16} strokeWidth={1.75} aria-hidden /> <span>{children}</span>
    </p>
  );
}

function TextInput({
  id, label, name, error, hint, inputRef, ...props
}: React.InputHTMLAttributes<HTMLInputElement> & {
  id: string; label: string; name: string; error?: string[]; hint?: string; inputRef?: React.Ref<HTMLInputElement>;
}) {
  const desc = error || hint ? `${id}-desc` : undefined;
  return (
    <div>
      <label htmlFor={id} className="label">{label}</label>
      <input ref={inputRef} id={id} name={name} className="input" aria-invalid={!!error} aria-describedby={desc} {...props} />
      {desc && <p id={desc} className={cn("mt-1 text-xs", error ? "text-danger" : "text-muted")}>{error?.[0] ?? hint}</p>}
    </div>
  );
}

function Suggestions({ items, onPick, label }: { items: { label: string; value: string }[]; onPick: (v: string) => void; label: string }) {
  if (!items.length) return null;
  return (
    <div className="send-chips" role="group" aria-label={label}>
      {items.map((s) => (
        <button key={`${s.label}-${s.value}`} type="button" className="send-chip" onClick={() => onPick(s.value)}>
          <span className="send-chip-label">{s.label}</span> <span className="send-chip-value">{s.value}</span>
        </button>
      ))}
    </div>
  );
}

function EmailPanel(p: SendDialogProps & { params: Params; onDone: () => void }) {
  const [state, formAction, pending] = useActionState<ActionResult<unknown> | null, FormData>(p.email.action, null);
  const [, startTransition] = useTransition();
  const { push } = useToast();
  const router = useRouter();
  const toRef = useRef<HTMLInputElement>(null);
  const uid = useId(); // ids propios: la página puede tener otro campo «to» (p. ej. «Nuevo estado»)
  const msgId = `${uid}-message`;
  const { onDone } = p;

  useEffect(() => {
    if (!state?.ok) return;
    push(state.message ?? "Enviado por correo.", "success");
    router.refresh();
    onDone();
  }, [state, push, onDone, router]);

  const fieldErrors = state && !state.ok ? state.fieldErrors : undefined;
  const msgError = fieldErrors?.message;
  const emails = (p.suggestions ?? []).filter((s) => s.email).map((s) => ({ label: s.label, value: s.email! }));
  const addTo = (email: string) => {
    const el = toRef.current;
    if (!el) return;
    const list = el.value.split(/[,;\s]+/).filter(Boolean);
    if (!list.includes(email)) el.value = [...list, email].join(", ");
    el.focus();
  };

  if (p.email.unavailable) return <Unavailable>{p.email.unavailable}</Unavailable>;

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        startTransition(() => formAction(fd));
      }}
    >
      {Object.entries(p.params).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <div>
        <TextInput
          id={`${uid}-to`} inputRef={toRef} label="Para" name="to" error={fieldErrors?.to} hint="Varios correos separados por coma"
          type="text" inputMode="email" autoComplete="email" defaultValue={p.email.defaultTo} required
        />
        <Suggestions items={emails} onPick={addTo} label="Correos sugeridos" />
      </div>
      <TextInput id={`${uid}-cc`} label="CC (opcional)" name="cc" error={fieldErrors?.cc} type="text" inputMode="email" />
        <div>
          <label htmlFor={msgId} className="label">Mensaje</label>
          <textarea
            id={msgId} name="message" rows={6} className="input" defaultValue={fill(p.email.defaultMessage, p.params)} required maxLength={2000}
            aria-invalid={!!msgError} aria-describedby={`${msgId}-hint`}
          />
          <p id={`${msgId}-hint`} className={cn("mt-1 text-xs", msgError ? "text-danger" : "text-muted")}>
            {msgError?.[0] ?? p.email.note}
          </p>
        </div>
      <div className="send-actions">
        {state && !state.ok && <p role="status" className="send-error">{state.error}</p>}
        <Button type="button" variant="ghost" onClick={onDone}>Cancelar</Button>
        <Button type="submit" disabled={pending} aria-busy={pending || undefined}>
          <Send size={16} strokeWidth={1.75} aria-hidden /> {pending ? "Enviando…" : "Enviar correo"}
        </Button>
      </div>
    </form>
  );
}

function WhatsAppPanel(p: SendDialogProps & { params: Params; onDone: () => void }) {
  const { push } = useToast();
  const router = useRouter();
  const ids = useId();
  const [phone, setPhone] = useState(p.whatsapp.defaultPhone ?? "");
  const [message, setMessage] = useState(() => fill(p.whatsapp.defaultMessage, p.params));
  const [link, setLink] = useState<ShareLink | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [shareable, setShareable] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  const { linkAction } = p.whatsapp;
  const { params, file: fileSpec, onDone } = p;
  const linkUnavailable = p.whatsapp.unavailable;

  // Enlace firmado: se genera al abrir la pestaña.
  useEffect(() => {
    if (linkUnavailable) return;
    let alive = true;
    linkAction(toFormData(params)).then(
      (r) => {
        if (!alive) return;
        if (r.ok && r.data) setLink(r.data);
        else setLinkError(r.ok ? "No se pudo generar el enlace." : r.error);
      },
      () => alive && setLinkError("No se pudo generar el enlace. Revisa tu conexión."),
    );
    return () => { alive = false; };
  }, [linkAction, params, linkUnavailable]);

  // Compartir el archivo real (móviles con Web Share API): se descarga antes para no perder el gesto del usuario.
  useEffect(() => {
    if (!canShareFiles(fileSpec.type, fileSpec.filename)) return;
    setShareable(true);
    let alive = true;
    fetch(withQuery(fileSpec.url, params), { credentials: "same-origin" })
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        // Nombre real del servidor (p. ej. «ventas_2026-10-01_a_2026-10-10.csv»), si lo envía.
        const name = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") ?? "")?.[1] ?? fileSpec.filename;
        const f = new File([await res.blob()], name, { type: fileSpec.type });
        if (alive) setFile(f);
      })
      .catch(() => alive && setFileError("No se pudo preparar el archivo para compartir."));
    return () => { alive = false; };
  }, [fileSpec.url, fileSpec.filename, fileSpec.type, params]);

  const intl = normalizePhone(phone);
  const phoneError = phone.trim() && !intl ? "Número inválido. Usa 10 dígitos (México) o +código de país." : null;
  const text = link ? `${message.trim()}\n\n${link.url}` : message.trim();
  const phones = (p.suggestions ?? []).filter((s) => s.phone).map((s) => ({ label: s.label, value: s.phone! }));

  const log = (channel: "link" | "file") =>
    p.whatsapp.logAction(toFormData(params, { channel, phone: intl ?? "" })).then((r) => {
      if (!r.ok) push(r.error, "error");
      else router.refresh();
    }, () => {});

  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      push("No se pudo copiar. Selecciona el enlace y cópialo manualmente.", "error");
    }
  };

  const shareFile = async () => {
    if (!file) return;
    setSharing(true);
    try {
      await navigator.share({ files: [file], title: p.docName, text: message.trim() });
      await log("file");
      push("Archivo compartido.", "success");
      onDone();
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) push("No se pudo compartir el archivo.", "error");
    } finally {
      setSharing(false);
    }
  };

  const canOpen = !!intl && !!link;

  return (
    <div className="space-y-4">
      {linkUnavailable && <Unavailable>{linkUnavailable}</Unavailable>}
      {!linkUnavailable && (
        <>
          <div>
            <label htmlFor={`${ids}-phone`} className="label">Número de WhatsApp</label>
            <input
              id={`${ids}-phone`} name="wa-phone" type="tel" inputMode="tel" autoComplete="tel" className="input"
              value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="55 1234 5678"
              aria-invalid={!!phoneError} aria-describedby={`${ids}-phone-hint`}
            />
            <p id={`${ids}-phone-hint`} className={cn("mt-1 text-xs", phoneError ? "text-danger" : "text-muted")}>
              {phoneError ?? (intl ? `Se abrirá el chat con ${formatPhone(intl)}` : "México (+52) por omisión; para otro país escribe +código.")}
            </p>
            <Suggestions items={phones} onPick={setPhone} label="Teléfonos sugeridos" />
          </div>
          <div>
            <label htmlFor={`${ids}-msg`} className="label">Mensaje</label>
            <textarea
              id={`${ids}-msg`} name="wa-message" rows={4} className="input" maxLength={1500}
              value={message} onChange={(e) => setMessage(e.target.value)} aria-describedby={`${ids}-msg-hint`}
            />
            <p id={`${ids}-msg-hint`} className="mt-1 text-xs text-muted">Al final se agrega el enlace de descarga.</p>
          </div>
          <div className="send-link" aria-live="polite">
            <Link2 size={16} strokeWidth={1.75} aria-hidden className="shrink-0 text-muted" />
            <div className="min-w-0 flex-1">
              {link ? (
                <>
                  <p className="send-link-url">{link.url}</p>
                  <p className="text-xs text-muted">
                    {p.whatsapp.note ? `${p.whatsapp.note} ` : ""}Vence el {fmtDate(link.expiresAt)}.
                  </p>
                </>
              ) : (
                <p className={cn("text-xs", linkError ? "text-danger" : "text-muted")}>{linkError ?? "Generando enlace seguro…"}</p>
              )}
            </div>
            {link && (
              <button type="button" className="btn btn-ghost icon-btn btn-sm" aria-label="Copiar enlace" data-tip={copied ? "Copiado" : "Copiar enlace"} onClick={copy}>
                {copied ? <Check size={16} strokeWidth={1.75} aria-hidden /> : <Copy size={16} strokeWidth={1.75} aria-hidden />}
              </button>
            )}
          </div>
        </>
      )}
      {shareable && fileError && <p role="status" className="send-error">{fileError}</p>}
      <div className="send-actions">
        <Button type="button" variant="ghost" onClick={onDone}>Cancelar</Button>
        {shareable && (
          <Button type="button" variant="secondary" disabled={!file || sharing} aria-busy={(!file && !fileError) || sharing || undefined} onClick={shareFile}>
            <Share2 size={16} strokeWidth={1.75} aria-hidden /> {file || fileError ? `Compartir ${fileSpec.filename.endsWith(".pdf") ? "PDF" : "archivo"}` : "Preparando…"}
          </Button>
        )}
        {!linkUnavailable && (
          canOpen ? (
            <a
              className="btn btn-primary" href={whatsappUrl(intl, text)} target="_blank" rel="noopener noreferrer"
              onClick={() => { void log("link"); onDone(); }}
            >
              <ExternalLink size={16} strokeWidth={1.75} aria-hidden /> Abrir WhatsApp
            </a>
          ) : (
            <Button type="button" disabled>
              <ExternalLink size={16} strokeWidth={1.75} aria-hidden /> Abrir WhatsApp
            </Button>
          )
        )}
      </div>
    </div>
  );
}
