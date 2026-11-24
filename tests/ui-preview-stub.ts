// SPDX-License-Identifier: Apache-2.0
// A stand-in for the Rust side, so the real window code (src/main.ts) runs in a browser for looking and accessibility testing.
// It answers the same commands with made-up but realistic data, and pretends to download and install. It touches nothing on the computer.
import type { AppView, JobEvent, View } from "../src/types";
import { apps as brandApps } from "virtual:brand-apps";

const callbacks = new Map<number, (data: unknown) => void>();
const listeners = new Map<string, number[]>();
let next = 1;

function emit(event: string, payload: unknown) {
  for (const id of listeners.get(event) ?? []) callbacks.get(id)?.({ event, id, payload });
}

/** The states the rows are shown in, one per app in the brand's list, in this order (and round again for a longer list). */
const states: Partial<AppView>[] = [
  { installed: { version: "0.1.0-alpha.4", exact: true, folderKnown: true }, offer: { version: "0.1.0-alpha.5", preview: true, size: 75489000 }, update: true, running: true },
  { installed: { version: "0.1.0-alpha.4", exact: true, folderKnown: true }, offer: { version: "0.1.0-alpha.4", preview: true, size: 5472304 } },
  { offer: { version: "0.1.0-alpha.4", preview: true, size: 7013808 } },
  { installed: { version: "0.1.0", exact: false, folderKnown: true }, offer: { version: "0.1.0-alpha.26", preview: true, size: 27122688 } },
  { installed: { version: "0.2.0-alpha.3", exact: true, folderKnown: true }, offer: { version: "0.2.0-alpha.4", preview: true, size: 15247912 }, update: true },
  { offer: { version: "0.1.0-alpha.7", preview: true, size: 29168344 } },
  { offer: { version: "0.3.0-alpha.8", preview: true, size: 138865896 } },
];
/** The app whose pretend install fails its checksum, to show a problem: the second not installed (the first, with a short list). */
const released = brandApps.apps.filter((a) => !a.comingSoonUntilReleased);
const notInstalled = released.filter((_, i) => !states[i % states.length].installed);
const failing = (notInstalled[1] ?? notInstalled[0])?.id;

const view: View = {
  hubVersion: "1.0.2",
  catalogDate: "2026-11-16T16:48:55Z",
  fetch: { kind: "fresh" },
  lastCheck: Math.floor(Date.now() / 1000) - 600,
  keyMissing: false,
  needsNewerHub: false,
  // ?hub-update shows a newer hub in the catalog, to try Update all with the hub last.
  hubUpdate: new URLSearchParams(location.search).has("hub-update") ? { version: "1.0.3", size: 3318544 } : null,
  justUpdated: null,
  apps: released.map((a, i) => ({
    id: a.id,
    name: a.name,
    letters: a.mark.letters,
    color: a.mark.color,
    // Every app shows the icon the real catalog would carry; an app without one (a planned app) shows its round mark.
    icon: a.mark.icon ?? null,
    description: a.description ?? "",
    installed: null, offer: null, update: false, running: false, needsNewerHub: false, previewBlocked: false,
    extras: (a.extras ?? []).map((x, index) => ({ index, name: x.name, description: x.description ?? "", size: 5151595 })),
    // An app listed before its release has none: its row reads "No release yet".
    ...(a.listedBeforeRelease ? {} : states[i % states.length]),
  })),
  // As in the real catalog, a link with no address yet is left out.
  web: brandApps.web.filter((w) => w.url),
  comingSoon: [
    ...brandApps.comingSoon,
    // Planned apps (left out of the real catalog until their repositories exist) are shown here too, to see the section full.
    ...brandApps.apps.filter((a) => a.comingSoonUntilReleased).map((a) => ({ id: a.id, name: a.name, description: a.description ?? "", mark: { letters: a.mark.letters, color: a.mark.color, icon: a.mark.icon ?? null } })),
  ],
  updatesReady: 0,
  settings: { offerPreviews: true, keepInTray: false, dailyCheck: true, askedStartWithWindows: true },
  startWithWindows: false,
  policy: { checks: true, startWithWindows: true, previews: true },
  jobs: [],
  batch: null,
  repository: `https://github.com/${brandApps.hub.repository}`,
};
view.updatesReady = view.apps.filter((x) => x.update).length;

const cancelled = new Set<string>();

/** A pretend install: Downloading with progress, Checking, Installing, then done (or a checksum problem for one app, to show one).
 *  `ended` is told whether it worked. */
function pretend(id: string, ended: (worked: boolean) => void = () => {}) {
  const a = view.apps.find((x) => x.id === id)!;
  const total = a.offer!.size;
  let received = 0;
  const send = (e: Partial<JobEvent>) => emit("job", { id, received: 0, total: 0, message: "", ...e });
  const tick = window.setInterval(() => {
    if (cancelled.delete(id)) {
      window.clearInterval(tick);
      send({ stage: "cancelled", message: "Cancelled." });
      ended(false);
      return;
    }
    received = Math.min(total, received + total / 12);
    send({ stage: "downloading", received, total, message: "Downloading" });
    if (received >= total) {
      window.clearInterval(tick);
      window.setTimeout(() => send({ stage: "checking", message: "Checking" }), 400);
      window.setTimeout(() => {
        if (id === failing) {
          send({ stage: "failed", message: "The download did not match its checksum, so nothing was installed." });
          return ended(false);
        }
        send({ stage: "installing", message: "Installing" });
        window.setTimeout(() => {
          a.installed = { version: a.offer!.version, exact: true, folderKnown: true };
          a.update = false;
          a.running = false;
          view.updatesReady = view.apps.filter((x) => x.update).length;
          send({ stage: "done", message: `${a.name} is installed.` });
          emit("view", view);
          ended(true);
        }, 1500);
      }, 1200);
    }
  }, 300);
}

/** A pretend Update all or Install all, the way commands.rs start_all does it: one after another, open apps last. */
function pretendAll(kind: "update" | "install") {
  const wanted = view.apps.filter((a) => a.offer && !a.needsNewerHub && (kind === "update" ? a.installed && a.update : !a.installed && !a.previewBlocked));
  const order = [...wanted.filter((a) => !a.running), ...wanted.filter((a) => a.running)].map((a) => a.id);
  const hubLast = kind === "update" && !!view.hubUpdate;
  view.batch = { kind, total: order.length + (hubLast ? 1 : 0), done: 0, current: null, queued: [...order], notDone: [], hubLast };
  emit("view", view);
  let worked = 0;
  const step = () => {
    const b = view.batch!;
    const id = b.queued.shift();
    if (!id || cancelled.delete("all")) {
      const what = kind === "update" ? "updated" : "installed";
      const apps = order.length;
      let words = id
        ? `Stopped. ${worked} of ${apps} apps ${what}.`
        : b.notDone.length
          ? `${worked} of ${apps} apps ${what}. Not ${what}: ${b.notDone.join(", ")}. Each one's row says why.`
          : apps === 2 ? `Both apps ${what}.` : `All ${apps} apps ${what}.`;
      if (hubLast && !id && b.notDone.length === 0) {
        // The hub's own update, last: in the real hub it closes here and the new hub starts.
        b.current = "the hub";
        emit("job", { id: "hub", stage: "downloading", received: 1659272, total: 3318544, message: "Downloading" });
        emit("view", view);
        window.setTimeout(() => emit("job", { id: "hub", stage: "installing", received: 0, total: 0, message: "Installing" }), 1500);
        window.setTimeout(() => {
          emit("job", { id: "hub", stage: "done", received: 0, total: 0, message: "Updating the hub. It restarts by itself." });
          view.batch = null;
          emit("view", view);
        }, 3000);
        return;
      }
      if (hubLast && !id) words += " The hub was not updated, so you can see what happened first. Its Update button is at the top.";
      view.batch = null;
      emit("batch-done", words);
      emit("view", view);
      return;
    }
    const a = view.apps.find((x) => x.id === id)!;
    b.current = a.name;
    emit("view", view);
    pretend(id, (ok) => {
      if (ok) worked++;
      else b.notDone.push(a.name);
      b.done++;
      b.current = null;
      step();
    });
  };
  step();
}

(window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
  transformCallback(cb: (data: unknown) => void) {
    const id = next++;
    callbacks.set(id, cb);
    return id;
  },
  unregisterCallback(id: number) {
    callbacks.delete(id);
  },
  async invoke(cmd: string, args: Record<string, unknown>) {
    console.log("invoke", cmd, args);
    switch (cmd) {
      case "plugin:event|listen": {
        const list = listeners.get(args.event as string) ?? [];
        list.push(args.handler as number);
        listeners.set(args.event as string, list);
        return args.handler;
      }
      case "get_view":
      case "refresh":
        await new Promise((r) => window.setTimeout(r, 300));
        view.lastCheck = Math.floor(Date.now() / 1000);
        return view;
      case "start_job":
        pretend(args.id as string);
        return null;
      case "start_all":
        pretendAll(args.kind as "update" | "install");
        return null;
      case "cancel_job":
        cancelled.add(args.id as string);
        // Stop also cancels the app being done.
        if (args.id === "all" && view.batch?.current) cancelled.add(view.apps.find((a) => a.name === view.batch!.current)!.id);
        return null;
      case "set_setting": {
        const name = args.name as string;
        if (name === "startWithWindows") {
          view.startWithWindows = args.value as boolean;
          if (args.value) view.settings.keepInTray = true;
        } else (view.settings as Record<string, boolean>)[name] = args.value as boolean;
        return view;
      }
      case "answer_first_run":
        view.settings.askedStartWithWindows = true;
        return view;
      case "take_pending_settings":
        return false;
      case "uninstall":
        // As the hub says it when the uninstaller Windows lists is not the app's own signed one; Retry asks again.
        window.setTimeout(() => emit("job", { id: args.id, stage: "failed", received: 0, total: 0, message: "The uninstaller is not signed. It was not run, and nothing was removed." }), 400);
        return null;
      default:
        return null;
    }
  },
};

// The real page: its markup, then its code.
const html = await (await fetch("/index.html")).text();
const doc = new DOMParser().parseFromString(html, "text/html");
document.body.replaceWith(doc.body);
document.body.querySelectorAll("script").forEach((s) => s.remove());
const style = document.createElement("link");
style.rel = "stylesheet";
style.href = "/src/style.css";
document.head.append(style);
await import("../src/main.ts");
