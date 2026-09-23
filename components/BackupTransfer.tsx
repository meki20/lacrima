"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Props = {
  kind: "profile" | "sources";
  title: string;
  description: string;
  importNote: string;
  className?: string;
};

export default function BackupTransfer({ kind, title, description, importNote, className = "" }: Props) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState<"export" | "import" | null>(null);
  const [note, setNote] = useState("");
  const endpoint = `/api/backups/${kind}`;

  const download = async () => {
    setBusy("export"); setNote("");
    try {
      const response = await fetch(endpoint);
      if (!response.ok) throw new Error((await response.json() as { error?: string }).error ?? "Could not create the backup.");
      const link = document.createElement("a");
      const href = URL.createObjectURL(await response.blob());
      link.href = href;
      link.download = `lacrima-${kind}.zip`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(href), 0);
      setNote("Backup saved to this device.");
    } catch (error) { setNote(error instanceof Error ? error.message : "Could not create the backup."); }
    finally { setBusy(null); }
  };

  const upload = async () => {
    if (!file) return;
    setBusy("import"); setNote("");
    try {
      const form = new FormData(); form.append("backup", file);
      const response = await fetch(endpoint, { method: "POST", body: form });
      const result = await response.json() as { error?: string; message?: string };
      if (!response.ok) throw new Error(result.error ?? "Could not import the backup.");
      setFile(null); if (input.current) input.current.value = "";
      setNote(result.message ?? "Backup imported.");
      router.refresh();
    } catch (error) { setNote(error instanceof Error ? error.message : "Could not import the backup."); }
    finally { setBusy(null); }
  };

  return <section className={`settings-card backup-card ${className}`}>
    <div><h2>{title}</h2><p>{description}</p></div>
    <div className="backup-actions">
      <button className="btn" type="button" onClick={() => void download()} disabled={busy !== null}>{busy === "export" ? "Saving…" : "Export ZIP"}</button>
      <input ref={input} type="file" accept="application/zip,.zip" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
      <button className="btn primary" type="button" onClick={() => void upload()} disabled={!file || busy !== null}>{busy === "import" ? "Importing…" : "Import ZIP"}</button>
    </div>
    <p className="backup-note" aria-live="polite">{note || (file ? `${file.name} ready to import. ${importNote}` : importNote)}</p>
  </section>;
}
