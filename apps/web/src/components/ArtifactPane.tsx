import { useEffect, useMemo, useState, type FormEvent } from "react";
import { bookSlot, getSlots } from "../lib/api";
import type {
  ArtifactBundle,
  ArtifactMutation,
  BookingResponse,
  Slot
} from "../types";

interface ArtifactPaneProps {
  bundle: ArtifactBundle;
  busy: boolean;
  defaultName: string;
  defaultEmail: string;
  onMutate: (mutation: ArtifactMutation) => Promise<void>;
  onRefresh: () => void;
  onBooked: (result: BookingResponse) => void;
}

function dateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function formatSlot(start: string, timezone: string): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: timezone,
    timeZoneName: "short"
  }).format(new Date(start));
}

function mutationLabel(mutation: Record<string, unknown>): string {
  const op = typeof mutation.op === "string" ? mutation.op : "change";
  return op.replaceAll("_", " ");
}

interface BookingPanelProps {
  bundle: ArtifactBundle;
  defaultName: string;
  defaultEmail: string;
  onBooked: (result: BookingResponse) => void;
}

function BookingPanel({ bundle, defaultName, defaultEmail, onBooked }: BookingPanelProps) {
  const existing = bundle.artifact.state.booking;
  const timezone = useMemo(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    []
  );
  const [slots, setSlots] = useState<Slot[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [name, setName] = useState(defaultName);
  const [email, setEmail] = useState(defaultEmail);
  const [loading, setLoading] = useState(false);
  const [booking, setBooking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [degraded, setDegraded] = useState(false);

  useEffect(() => {
    if (existing) {
      return;
    }

    let cancelled = false;
    const from = new Date();
    const to = new Date();
    to.setDate(to.getDate() + 14);

    setLoading(true);
    setError(null);
    getSlots(bundle.artifact.id, dateOnly(from), dateOnly(to), timezone)
      .then((result) => {
        if (cancelled) {
          return;
        }
        const upcoming = result.slots
          .filter((slot) => new Date(slot.start).getTime() > Date.now())
          .slice(0, 12);
        setSlots(upcoming);
        setSelected((current) => current ?? upcoming[0]?.start ?? null);
        setDegraded(result.degraded);
      })
      .catch((loadError: unknown) => {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Could not load Calnode slots.");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [bundle.artifact.id, existing, timezone]);

  async function handleApprove(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || !name.trim() || !email.trim()) {
      return;
    }

    setBooking(true);
    setError(null);
    try {
      const result = await bookSlot(bundle.artifact.id, {
        startAt: selected,
        timezone,
        name: name.trim(),
        email: email.trim()
      });
      onBooked(result);
    } catch (bookingError) {
      setError(bookingError instanceof Error ? bookingError.message : "Could not create the booking.");
    } finally {
      setBooking(false);
    }
  }

  if (existing) {
    return (
      <section className="booking-panel booking-confirmed" aria-labelledby="booking-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Calnode booking</p>
            <h3 id="booking-title">Confirmed</h3>
          </div>
          <span className="status-pill status-success">Booked</span>
        </div>
        <p className="booking-time">{formatSlot(existing.startAt, existing.timezone)}</p>
        <dl className="booking-meta">
          <div>
            <dt>Booking ID</dt>
            <dd>{existing.id}</dd>
          </div>
          <div>
            <dt>Event</dt>
            <dd>{existing.eventTypeSlug}</dd>
          </div>
          <div>
            <dt>Timezone</dt>
            <dd>{existing.timezone}</dd>
          </div>
          <div>
            <dt>Name</dt>
            <dd>{existing.name ?? "—"}</dd>
          </div>
        </dl>
        <p className="fine-print">
          This booking lives in Calnode. The Assistant can propose slots, but only this explicit
          approval action creates a booking.
        </p>
      </section>
    );
  }

  return (
    <section className="booking-panel" aria-labelledby="booking-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Calnode availability</p>
          <h3 id="booking-title">Choose one real slot</h3>
        </div>
        <span className="status-pill">30 minutes</span>
      </div>

      {loading ? <p className="muted">Loading slots from Calnode...</p> : null}
      {degraded ? (
        <p className="warning" role="status">
          Calnode reported degraded availability. Re-check before approving.
        </p>
      ) : null}

      {!loading && slots.length === 0 && !error ? (
        <p className="muted">No open slots in the next 14 days. Ask the operator to add availability.</p>
      ) : null}

      {slots.length > 0 ? (
        <div className="slot-grid" role="radiogroup" aria-label="Available booking slots">
          {slots.map((slot) => (
            <button
              key={slot.start}
              type="button"
              role="radio"
              aria-checked={selected === slot.start}
              className={`slot-button${selected === slot.start ? " is-selected" : ""}`}
              onClick={() => setSelected(slot.start)}
            >
              {formatSlot(slot.start, timezone)}
            </button>
          ))}
        </div>
      ) : null}

      <form className="booking-form" onSubmit={handleApprove}>
        <div className="field-row">
          <label>
            <span>Full name</span>
            <input value={name} onChange={(event) => setName(event.target.value)} required />
          </label>
          <label>
            <span>Email</span>
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </label>
        </div>
        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}
        <button className="primary-button" type="submit" disabled={!selected || booking}>
          {booking ? "Booking..." : "Approve and book this slot"}
        </button>
      </form>
      <p className="fine-print">
        Clicking Approve is the required user confirmation. The Assistant cannot book on its own.
      </p>
    </section>
  );
}

export function ArtifactPane({
  bundle,
  busy,
  defaultName,
  defaultEmail,
  onMutate,
  onRefresh,
  onBooked
}: ArtifactPaneProps) {
  const state = bundle.artifact.state;
  const [title, setTitle] = useState(state.title);
  const [newItem, setNewItem] = useState("");

  useEffect(() => {
    setTitle(state.title);
  }, [state.title]);

  async function saveTitle(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next = title.trim();
    if (next && next !== state.title) {
      await onMutate({ op: "set_title", title: next });
    }
  }

  async function addItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = newItem.trim();
    if (!text) {
      return;
    }
    await onMutate({ op: "add_item", text });
    setNewItem("");
  }

  const completed = state.items.filter((item) => item.done).length;

  return (
    <section className="artifact-pane" aria-labelledby="artifact-title">
      <div className="pane-header artifact-header">
        <div>
          <p className="eyebrow">Artifact · version {bundle.artifact.version}</p>
          <h2 id="artifact-title">Interactive checklist</h2>
        </div>
        <button className="ghost-button" type="button" onClick={onRefresh} disabled={busy}>
          Refresh
        </button>
      </div>

      <div className="artifact-scroll">
        <form className="title-form" onSubmit={saveTitle}>
          <label>
            <span>Title</span>
            <input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={200} />
          </label>
          <button className="secondary-button" type="submit" disabled={busy || title.trim() === state.title}>
            Save title
          </button>
        </form>

        <div className="checklist-summary">
          <p>
            {completed} of {state.items.length} complete
          </p>
          <div className="progress-track" aria-hidden="true">
            <span
              style={{
                width: state.items.length === 0 ? "0%" : `${(completed / state.items.length) * 100}%`
              }}
            />
          </div>
        </div>

        {state.items.length === 0 ? (
          <p className="muted empty-list">
            The Assistant can add checklist items here. You can also add one yourself.
          </p>
        ) : (
          <ul className="checklist">
            {state.items.map((item) => (
              <li key={item.id} className={item.done ? "is-done" : ""}>
                <label className="check-row">
                  <input
                    type="checkbox"
                    checked={item.done}
                    disabled={busy}
                    onChange={() =>
                      void onMutate({
                        op: "set_item_done",
                        itemId: item.id,
                        done: !item.done
                      })
                    }
                  />
                  <span>{item.text}</span>
                </label>
                <button
                  className="icon-button"
                  type="button"
                  aria-label={`Remove ${item.text}`}
                  disabled={busy}
                  onClick={() => void onMutate({ op: "remove_item", itemId: item.id })}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}

        <form className="add-item-form" onSubmit={addItem}>
          <input
            value={newItem}
            onChange={(event) => setNewItem(event.target.value)}
            placeholder="Add a checklist item"
            maxLength={300}
          />
          <button className="secondary-button" type="submit" disabled={busy || !newItem.trim()}>
            Add
          </button>
        </form>

        <BookingPanel
          bundle={bundle}
          defaultName={defaultName}
          defaultEmail={defaultEmail}
          onBooked={onBooked}
        />

        <section className="history-panel" aria-labelledby="history-title">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Immutable history</p>
              <h3 id="history-title">Recent versions</h3>
            </div>
            <span className="status-pill">{bundle.versions.length} snapshots</span>
          </div>
          <ol className="version-list">
            {bundle.versions.slice(0, 8).map((version) => (
              <li key={`${version.id}-${version.version}`}>
                <span className="version-number">v{version.version}</span>
                <div>
                  <p>{mutationLabel(version.mutation)}</p>
                  <time dateTime={version.created_at}>
                    {new Date(version.created_at).toLocaleString()}
                  </time>
                </div>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </section>
  );
}
