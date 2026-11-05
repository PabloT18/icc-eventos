"use client";
import { useState, useEffect, useCallback, type FormEvent } from "react";
import dynamic from "next/dynamic";
const Scanner = dynamic(() => import("@/components/Scanner"), { ssr: false });
const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? "local";
const BUILD_COMMIT = process.env.NEXT_PUBLIC_BUILD_COMMIT ?? "dev";
type Event = {
  id: string;
  name: string;
  item: string;
  period: string;
  status: string;
  role: string;
  email_enabled: boolean;
};
type User = { email: string; global_role: string };
type Student = { code: string; name: string; email: string; type: string };
type Scan = {
  valid: boolean;
  student?: Student;
  validation_id?: string;
  duplicate?: { delivered_at: string; responsible: string };
  message?: string;
};
type Row = Record<string, string | boolean | number | null>;
async function api(path: string, body?: unknown) {
  const r = await fetch("/api/" + path, {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json();
  if (!r.ok || data.error) throw new Error(data.error || "Error de conexión");
  return data;
}
const fields = (e: FormEvent<HTMLFormElement>) =>
  Object.fromEntries(new FormData(e.currentTarget));
const date = (s: string) =>
  new Date(s).toLocaleString("es-EC", { timeZone: "America/Guayaquil" });
export default function Home() {
  const [user, setUser] = useState<User | null>(null),
    [events, setEvents] = useState<Event[]>([]),
    [event, setEvent] = useState<Event | null>(null),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [email, setEmail] = useState(""),
    [sent, setSent] = useState(false),
    [camera, setCamera] = useState(false),
    [scan, setScan] = useState<Scan | null>(null),
    [rows, setRows] = useState<Row[]>([]),
    [readers, setReaders] = useState<Row[]>([]),
    [scans, setScans] = useState<Row[]>([]),
    [filter, setFilter] = useState("");
  const [pilot, setPilot] = useState<boolean | null>(null);
  const [invite, setInvite] = useState("");
  const isAdmin = user?.global_role === "ADMIN";
  const refresh = async () => {
    const es = await api("events");
    setEvents(es);
    setEvent((old) =>
      old ? es.find((e: Event) => e.id === old.id) || null : null,
    );
  };
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setMessage("");
    try {
      await fn();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Error inesperado");
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    const key = new URLSearchParams(location.hash.slice(1)).get("invite");
    if (key) {
      setInvite(key);
      history.replaceState(null, "", location.pathname + location.search);
    }
    api("auth/mode")
      .then((m) => setPilot(m.pilot))
      .catch(() => setMessage("No se pudo consultar el modo de acceso"));
    api("me")
      .then((u) => {
        setUser(u);
        return api("events");
      })
      .then(setEvents)
      .catch(() => { });
  }, []);
  const onRead = useCallback(
    (text: string) => {
      setCamera(false);
      setScan(null);
      setBusy(true);
      setMessage("");
      api("scan", { event_id: event?.id, qr_content: text })
        .then((v) => {
          setScan(v);
          if (v.message) setMessage(v.message);
        })
        .catch((e) => setMessage(e.message))
        .finally(() => setBusy(false));
    },
    [event?.id],
  );
  const report = async () => {
    if (!event) return;
    setRows(await api("report?event=" + event.id));
    setReaders(await api("readers?event=" + event.id));
    setScans(await api("scans?event=" + event.id));
  };
  return (
    <>
      <header>
        <div>
          <strong>CAMPUS / EVENTOS</strong>
          <small>Universidad Politécnica Salesiana</small>
        </div>
        {user && (
          <div>
            <small>{user.email}</small>
            <button
              className="secondary"
              onClick={() =>
                run(async () => {
                  await api("auth/logout", {});
                  setUser(null);
                  setEvent(null);
                  setCamera(false);
                })
              }
            >
              Salir
            </button>
          </div>
        )}
      </header>
      <main>
        {message && (
          <p className="notice" role="status">
            {message}
          </p>
        )}
        {!user ? (
          <section className="card login">
            <span className="eyebrow">Acceso autorizado</span>
            <h1>Gestión de entregas</h1>
            <p className="muted">
              {pilot
                ? "Abra su enlace personal e ingrese el correo registrado."
                : "Ingrese con su correo institucional y el código de un solo uso."}
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                run(async () => {
                  if (pilot) {
                    await api("auth/pilot", { email, invite });
                    setInvite("");
                    setUser(await api("me"));
                    await refresh();
                    return;
                  }
                  await api("auth/request", { email });
                  setSent(true);
                  setMessage(
                    "Si su correo está autorizado, recibirá un código válido por cinco minutos.",
                  );
                });
              }}
            >
              <label htmlFor="email">Correo institucional</label>
              <input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value.trim().toLowerCase());
                  setSent(false);
                }}
              />
              <button disabled={busy || pilot === null || (pilot && !invite)}>
                {pilot ? "Ingresar con invitación" : "Enviar código"}
              </button>
            </form>
            {sent && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = fields(e);
                  run(async () => {
                    await api("auth/verify", { email, code: f.code });
                    setUser(await api("me"));
                    await refresh();
                  });
                }}
              >
                <label htmlFor="code">Código de acceso</label>
                <input
                  id="code"
                  name="code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  required
                />
                <button disabled={busy} className="accent">
                  Ingresar
                </button>
              </form>
            )}
          </section>
        ) : (
          <>
            <div className="row">
              <span className="eyebrow">Panel de operaciones</span>
              <span className="badge">
                {isAdmin ? "Administrador" : "Lector"}
              </span>
            </div>
            <h1>{event ? event.name : "Eventos y entregas"}</h1>
            {!event ? (
              <>
                <p className="muted">
                  Seleccione el evento para comenzar a registrar entregas.
                </p>
                <div className="grid">
                  {events.map((e) => (
                    <section className="card" key={e.id}>
                      <span className="badge">{e.status}</span>
                      <h2>{e.name}</h2>
                      <p className="muted">
                        {e.item} · {e.period || "Sin período"}
                      </p>
                      <button
                        onClick={() => {
                          setEvent(e);
                          setScan(null);
                          setRows([]);
                          setReaders([]);
                          setScans([]);
                        }}
                      >
                        Abrir evento
                      </button>
                    </section>
                  ))}
                </div>
                {!events.length && <p>No tiene eventos asignados.</p>}
              </>
            ) : (
              <>
                <button
                  className="secondary"
                  onClick={() => {
                    setCamera(false);
                    setEvent(null);
                    setScan(null);
                    setMessage("");
                  }}
                >
                  Volver a eventos
                </button>
                <span className="badge">
                  {event.status} · {event.role}
                </span>
                <div className="split">
                  <section className="card">
                    <span className="eyebrow">Lectura de carné</span>
                    <h2>Validar estudiante</h2>
                    <p className="muted">
                      Lea el QR y confirme la entrega de {event.item}.
                    </p>
                    {camera ? (
                      <>
                        <Scanner onRead={onRead} />
                        <button
                          className="secondary"
                          onClick={() => setCamera(false)}
                        >
                          Cerrar cámara
                        </button>
                      </>
                    ) : (
                      <button
                        disabled={busy || event.status !== "ACTIVE"}
                        onClick={() => {
                          setScan(null);
                          setCamera(true);
                        }}
                      >
                        Abrir cámara
                      </button>
                    )}
                    <details>
                      <summary>Ingresar contenido del QR</summary>
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          onRead(String(fields(e).qr));
                        }}
                      >
                        <label>
                          Contenido leído
                          <textarea name="qr" required maxLength={8192} />
                        </label>
                        <button disabled={busy || event.status !== "ACTIVE"}>
                          Validar QR
                        </button>
                      </form>
                    </details>
                    {scan?.valid && scan.student && (
                      <div className="card">
                        <span className="badge">Identidad validada</span>
                        <h3>{scan.student.name}</h3>
                        <p>
                          {scan.student.email} · {scan.student.type}
                        </p>
                        {scan.duplicate ? (
                          <p className="notice">
                            Entrega registrada:{" "}
                            {date(scan.duplicate.delivered_at)} por{" "}
                            {scan.duplicate.responsible}.
                          </p>
                        ) : (
                          <button
                            className="accent"
                            disabled={busy}
                            onClick={() =>
                              run(async () => {
                                const r = await api("deliver", {
                                  event_id: event.id,
                                  method: "QR",
                                  validation_id: scan.validation_id,
                                  request_id: crypto.randomUUID(),
                                });
                                setMessage(
                                  "Entrega registrada. Comprobante: " + r.id,
                                );
                                setScan(null);
                              })
                            }
                          >
                            Registrar entrega
                          </button>
                        )}
                      </div>
                    )}
                  </section>
                  {(isAdmin || event.role === "LECTOR_SUPER") && (
                    <section className="card">
                      <span className="eyebrow">Excepción autorizada</span>
                      <h2>Registro manual</h2>
                      <p className="muted">
                        Verifique la identidad. Este registro no valida la
                        elegibilidad mediante el servicio QR.
                      </p>
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          const form = e.currentTarget;
                          const f = fields(e);
                          run(async () => {
                            const r = await api("deliver", {
                              event_id: event.id,
                              method: "MANUAL",
                              request_id: crypto.randomUUID(),
                              student: {
                                code: f.code,
                                name: f.name,
                                email: f.email,
                                type: f.type,
                              },
                              observation: f.observation,
                            });
                            setMessage(
                              "Entrega manual registrada. Comprobante: " + r.id,
                            );
                            form.reset();
                          });
                        }}
                      >
                        <label>
                          Código del estudiante
                          <input name="code" required maxLength={80} />
                        </label>
                        <label>
                          Nombre completo
                          <input
                            name="name"
                            required
                            minLength={3}
                            maxLength={200}
                          />
                        </label>
                        <label>
                          Correo institucional
                          <input name="email" type="email" required />
                        </label>
                        <label>
                          Tipo
                          <input name="type" required maxLength={80} />
                        </label>
                        <label>
                          Observación obligatoria
                          <textarea
                            name="observation"
                            required
                            minLength={5}
                            maxLength={1000}
                          />
                        </label>
                        <button disabled={busy || event.status !== "ACTIVE"}>
                          Registrar manualmente
                        </button>
                      </form>
                    </section>
                  )}
                </div>
                {isAdmin && (
                  <>
                    <section className="card">
                      <h2>Lectores del evento</h2>
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          const f = fields(e);
                          run(async () => {
                            await api("reader-save", {
                              event_id: event.id,
                              email: f.email,
                              role: f.role,
                              active: f.active === "true",
                            });
                            await report();
                            setMessage("Permisos actualizados.");
                          });
                        }}
                      >
                        <div className="grid">
                          <label>
                            Correo
                            <input type="email" name="email" required />
                          </label>
                          <label>
                            Rol
                            <select name="role">
                              <option>LECTOR</option>
                              <option>LECTOR_SUPER</option>
                            </select>
                          </label>
                          <label>
                            Acceso
                            <select name="active">
                              <option value="true">Habilitado</option>
                              <option value="false">Revocado</option>
                            </select>
                          </label>
                        </div>
                        <button disabled={busy}>Guardar asignación</button>
                      </form>
                      {readers.map((r) => (
                        <p key={String(r.user_id)}>
                          {r.email} · {r.role} ·{" "}
                          {r.active ? "Habilitado" : "Revocado"}
                        </p>
                      ))}
                    </section>
                    <section className="card">
                      <h2>Reportes y auditoría</h2>
                      <button disabled={busy} onClick={() => run(report)}>
                        Actualizar reportes
                      </button>
                      <a
                        className="button secondary"
                        href={"/api/export?event=" + event.id}
                      >
                        Descargar CSV para Excel
                      </a>
                      <label>
                        Filtrar estudiante, responsable, método o fecha
                        <input
                          value={filter}
                          onChange={(e) => setFilter(e.target.value)}
                        />
                      </label>
                      <p className="muted">
                        Confirmadas:{" "}
                        {rows.filter((r) => r.status === "CONFIRMED").length} ·
                        Anuladas:{" "}
                        {rows.filter((r) => r.status === "CANCELLED").length}
                      </p>
                      <div className="table-wrap">
                        <table>
                          <thead>
                            <tr>
                              <th>Estudiante</th>
                              <th>Responsable</th>
                              <th>Fecha</th>
                              <th>Método</th>
                              <th>Estado</th>
                              <th>Observación</th>
                              <th>Acción</th>
                            </tr>
                          </thead>
                          <tbody>
                            {rows
                              .filter((r) =>
                                Object.values(r)
                                  .join(" ")
                                  .toLowerCase()
                                  .includes(filter.toLowerCase()),
                              )
                              .map((r) => (
                                <tr key={String(r.id)}>
                                  <td>
                                    {r.student_name}
                                    <br />
                                    {r.student_code}
                                    <br />
                                    {r.student_email}
                                    {r.student_type ? ` · ${r.student_type}` : ""}
                                  </td>
                                  <td>{r.responsible}</td>
                                  <td>{date(String(r.delivered_at))}</td>
                                  <td>{r.method}</td>
                                  <td>{r.status}</td>
                                  <td>{r.observation}</td>
                                  <td>
                                    {r.status === "CONFIRMED" && (
                                      <button
                                        className="danger"
                                        disabled={busy}
                                        onClick={() => {
                                          const reason = prompt(
                                            "Motivo de anulación, mínimo 5 caracteres",
                                          );
                                          if (reason)
                                            run(async () => {
                                              await api("cancel", {
                                                id: r.id,
                                                reason,
                                              });
                                              await report();
                                            });
                                        }}
                                      >
                                        Anular
                                      </button>
                                    )}
                                  </td>
                                </tr>
                              ))}
                          </tbody>
                        </table>
                      </div>
                      <details>
                        <summary>
                          Lecturas y motivos internos · últimas 200
                        </summary>
                        {scans.map((s) => (
                          <p key={String(s.id)}>
                            {date(String(s.created_at))} · {s.email} ·{" "}
                            {s.valid ? "Válido" : s.reason || "Inválido"}
                          </p>
                        ))}
                      </details>
                    </section>
                  </>
                )}
              </>
            )}
            {isAdmin && (
              <section className="card">
                <h2>{event ? "Configurar evento" : "Crear evento"}</h2>
                <form
                  key={event?.id || "new"}
                  onSubmit={(e) => {
                    e.preventDefault();
                    const f = fields(e);
                    run(async () => {
                      await api("event-save", {
                        ...(event ? { id: event.id } : {}),
                        name: f.name,
                        item: f.item,
                        period: f.period,
                        status: f.status,
                        email_enabled: f.email_enabled === "on",
                      });
                      await refresh();
                      setMessage("Evento guardado.");
                    });
                  }}
                >
                  <div className="grid">
                    <label>
                      Nombre
                      <input
                        name="name"
                        required
                        minLength={3}
                        defaultValue={event?.name || ""}
                      />
                    </label>
                    <label>
                      Artículo
                      <input
                        name="item"
                        required
                        minLength={2}
                        defaultValue={event?.item || "Cuaderno"}
                      />
                    </label>
                    <label>
                      Período descriptivo
                      <input
                        name="period"
                        defaultValue={event?.period || "P69"}
                      />
                    </label>
                    <label>
                      Estado
                      <select
                        name="status"
                        defaultValue={event?.status || "DRAFT"}
                      >
                        <option value="DRAFT">Borrador</option>
                        <option value="ACTIVE">Activo</option>
                        <option value="CLOSED">Cerrado</option>
                      </select>
                    </label>
                  </div>
                  <label>
                    <input
                      name="email_enabled"
                      type="checkbox"
                      defaultChecked={event?.email_enabled}
                    />
                    Enviar comprobante si está habilitado globalmente
                  </label>
                  <button disabled={busy}>Guardar evento</button>
                </form>
              </section>
            )}
          </>
        )}
        <p className="muted">
          Campus Eventos · v{APP_VERSION} · {BUILD_COMMIT} · Horario de Ecuador ·
          Acceso restringido
        </p>
      </main>
    </>
  );
}
