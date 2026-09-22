import TopBar from "@/components/TopBar";
import SettingsForm from "@/components/SettingsForm";
import UpdateSettings from "@/components/UpdateSettings";
import { currentProfile } from "@/lib/profile";
import { bestProviders, profileSettings } from "@/lib/settings";
import { updateStatus } from "@/lib/updates";

export const dynamic = "force-dynamic";
const COLORS = ["#630E19", "#e8c56b", "#8d6bdf", "#46a758", "#4a94c6", "#c76d9d"];

export default async function Settings() {
  const me = await currentProfile();
  const [settings, providers, updates] = [profileSettings(me.id), bestProviders(me.id), updateStatus()];
  const total = providers.reduce((n, p) => n + p.times, 0);
  let at = 0;
  const pie = providers.map((p, i) => { const from = at; at += (p.times / total) * 100; return `${COLORS[i % COLORS.length]} ${from}% ${at}%`; }).join(", ");
  return <><TopBar active="Settings" /><main className="settings-page">
    <header className="settings-title"><div><span className="mono">{me.name}&apos;s account</span><h1>Settings</h1></div></header>
    <SettingsForm initial={settings} />
    <UpdateSettings initial={updates} />
    <section className="settings-card providers-card"><div><h2>Best providers</h2><p>Confirmed after 15 seconds of playback. Your account only.</p></div>
      {total ? <div className="provider-stats"><div className="provider-pie" role="img" aria-label={`${total} provider selections`} style={{ background: `conic-gradient(${pie})` }}><span>{total}<small>plays</small></span></div><div className="provider-list">{providers.map((p, i) => <div key={p.provider}><i style={{ background: COLORS[i % COLORS.length] }} /><b>{p.provider}</b><span>{p.times} {p.times === 1 ? "time" : "times"} · {Math.round((p.times / total) * 100)}%</span></div>)}</div></div> : <div className="empty"><b>No provider history yet</b>Watch an episode for a few seconds and its provider will appear here.</div>}
    </section>
  </main></>;
}
