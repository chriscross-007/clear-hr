// CLE-238 — Office.js loading + the few Word calls the ClearHR panel uses.
// Office.js isn't bundled (Microsoft only supports the hosted copy), so
// it's injected at runtime and typed loosely here.

/* eslint-disable @typescript-eslint/no-explicit-any */

const OFFICE_JS = "https://appsforoffice.microsoft.com/lib/1/hosted/office.js";

declare global {
  interface Window {
    Office?: any;
    Word?: any;
  }
}

let loading: Promise<{ host: string | null }> | null = null;

/** Loads Office.js once. Resolves with the Office host ("Word") or null
 *  when the page is opened in a normal browser. */
export function loadOffice(): Promise<{ host: string | null }> {
  if (loading) return loading;
  loading = new Promise((resolve) => {
    // Office.js removes history.pushState/replaceState in some hosts,
    // which breaks Next.js navigation — keep and restore them.
    const push = window.history.pushState;
    const replace = window.history.replaceState;
    const done = (host: string | null) => {
      window.history.pushState = push;
      window.history.replaceState = replace;
      resolve({ host });
    };
    const script = document.createElement("script");
    script.src = OFFICE_JS;
    script.async = true;
    script.onload = () => {
      const office = window.Office;
      if (!office?.onReady) return done(null);
      const timer = setTimeout(() => done(null), 5000);
      office.onReady((info: { host?: string | null }) => {
        clearTimeout(timer);
        done(info?.host ?? null);
      });
    };
    script.onerror = () => done(null);
    document.head.appendChild(script);
  });
  return loading;
}

export const inWordHost = (host: string | null) => host === "Word" || host === window.Office?.HostType?.Word;

/** Inserts text at the cursor (replacing any selection). */
export async function insertAtCursor(text: string): Promise<void> {
  const Word = window.Word;
  await Word.run(async (ctx: any) => {
    const sel = ctx.document.getSelection();
    const range = sel.insertText(text, "Replace");
    range.select("End");
    await ctx.sync();
  });
}

/** Every `{{...}}` in the document body, with the raw text as typed. */
export async function readDocumentTags(): Promise<{ raw: string; tag: string }[]> {
  const Word = window.Word;
  let text = "";
  await Word.run(async (ctx: any) => {
    const body = ctx.document.body;
    body.load("text");
    await ctx.sync();
    text = String(body.text ?? "");
  });
  const out: { raw: string; tag: string }[] = [];
  const seen = new Set<string>();
  const re = /\{\{([^{}]*)\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const tag = m[1].trim();
    if (!tag || seen.has(m[0])) continue;
    seen.add(m[0]);
    out.push({ raw: m[0], tag });
  }
  return out;
}

/** Selects the first occurrence of `raw` in the document. */
export async function selectText(raw: string): Promise<boolean> {
  const Word = window.Word;
  let found = false;
  await Word.run(async (ctx: any) => {
    const results = ctx.document.body.search(raw.slice(0, 255), { matchCase: true });
    results.load("items");
    await ctx.sync();
    if (results.items.length > 0) {
      results.items[0].select();
      await ctx.sync();
      found = true;
    }
  });
  return found;
}

/** The open document as .docx bytes. */
export function getDocumentBytes(): Promise<Uint8Array> {
  const Office = window.Office;
  return new Promise((resolve, reject) => {
    Office.context.document.getFileAsync(Office.FileType.Compressed, { sliceSize: 4 * 1024 * 1024 }, (res: any) => {
      if (res.status !== Office.AsyncResultStatus.Succeeded) {
        reject(new Error(res.error?.message ?? "Couldn't read the document."));
        return;
      }
      const file = res.value;
      const count: number = file.sliceCount;
      const parts: Uint8Array[] = [];
      let got = 0;
      const next = (i: number) => {
        file.getSliceAsync(i, (sr: any) => {
          if (sr.status !== Office.AsyncResultStatus.Succeeded) {
            file.closeAsync();
            reject(new Error(sr.error?.message ?? "Couldn't read the document."));
            return;
          }
          parts[i] = new Uint8Array(sr.value.data);
          got++;
          if (got === count) {
            file.closeAsync();
            const total = parts.reduce((n, p) => n + p.length, 0);
            const bytes = new Uint8Array(total);
            let off = 0;
            for (const p of parts) {
              bytes.set(p, off);
              off += p.length;
            }
            resolve(bytes);
          } else next(i + 1);
        });
      };
      next(0);
    });
  });
}

/** The document's file name without extension, when Word knows it. */
export function documentTitle(): string {
  const url: string = window.Office?.context?.document?.url ?? "";
  const last = decodeURIComponent(url.split(/[\\/]/).pop() ?? "");
  return last.replace(/\.docx?$/i, "").trim();
}

/** Opens ClearHR's sign-in dialog; resolves with the message it sends. */
export function openSignInDialog(url: string): Promise<string> {
  const Office = window.Office;
  return new Promise((resolve, reject) => {
    Office.context.ui.displayDialogAsync(url, { height: 70, width: 35, displayInIframe: false }, (res: any) => {
      if (res.status !== Office.AsyncResultStatus.Succeeded) {
        reject(new Error(res.error?.message ?? "Couldn't open the sign-in window."));
        return;
      }
      const dialog = res.value;
      dialog.addEventHandler(Office.EventType.DialogMessageReceived, (arg: any) => {
        dialog.close();
        resolve(String(arg.message ?? ""));
      });
      dialog.addEventHandler(Office.EventType.DialogEventReceived, () => {
        reject(new Error("Sign-in window closed."));
      });
    });
  });
}
