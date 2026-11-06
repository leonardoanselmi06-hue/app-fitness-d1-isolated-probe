// Recupero percepito (check-in giornaliero) e regolarità del sonno. Il Coach NON attribuisce un calo di prestazione alla stanchezza senza check-in:
// con dati insufficienti lo dichiara e basta. Valori 1–5; stanchezza, indolenzimento e stress: più alto = peggio.
import { addDays, fmt, insight } from './stats.js';
import { checkinAverages } from '../checkin/store.js';

const MIN_ENTRIES = 5;

export function recoveryInsight(checkins, today, { progression = null, sleep = null } = {}) {
  const recent = checkins.filter(c => c.day > addDays(today, -14) && c.day <= today);
  const reg = sleep?.regularity ?? null, regLine = reg?.label ? `Regolarità del sonno (ultime ${reg.n} notti): ${reg.label} · letto alle ${reg.bed_mean} ±${reg.bed_sd_min} min, risveglio alle ${reg.wake_mean} ±${reg.wake_sd_min} min` : null;
  const prog = progression?.data?.overall;
  if (recent.length < MIN_ENTRIES) {
    const ev = [`Check-in negli ultimi 14 giorni: ${recent.length} (ne servono almeno ${MIN_ENTRIES})`]; if (regLine) ev.push(regLine);
    if (prog === 'declining' || prog === 'stalling') ev.push('La progressione è ferma o in calo, ma senza check-in non posso dire se il recupero c\'entri: non lo attribuisco alla stanchezza.');
    return insight('recovery', 'Recupero', 'insufficiente', 'Mancano check-in per valutare il recupero percepito: compilali nella scheda Recupero (30 secondi al giorno, servono almeno 5 giorni su 14).', { evidence: ev }); // nessuna "azione": non si insiste con chi non lo usa
  }
  const { last7, prev7 } = checkinAverages(checkins, today), ev = [];
  if (last7.n >= 3) ev.push(`Ultimi 7 giorni (${last7.n} check-in): indice ${last7.index}/100 · stanchezza ${fmt(last7.fatigue, 1)}/5 · indolenzimento ${fmt(last7.soreness, 1)}/5 · stress ${fmt(last7.stress, 1)}/5 · prontezza ${fmt(last7.readiness, 1)}/5 · sonno percepito ${fmt(last7.sleep_quality, 1)}/5`);
  if (prev7.n >= 3) ev.push(`7 giorni precedenti (${prev7.n} check-in): indice ${prev7.index}/100`);
  if (regLine) ev.push(regLine);
  const drop = last7.index != null && prev7.index != null ? last7.index - prev7.index : null, flags = [];
  if (last7.n >= 3 && last7.fatigue >= 4) flags.push('stanchezza alta');
  if (last7.n >= 3 && last7.readiness != null && last7.readiness <= 2.5) flags.push('prontezza bassa');
  if (drop != null && drop <= -15) flags.push(`indice in calo di ${Math.abs(drop)} punti`);
  if (reg?.label === 'irregolare') flags.push('orari del sonno irregolari');
  if ((prog === 'declining' || prog === 'stalling') && last7.index != null) ev.push(last7.index >= 60 ? 'Progressione ferma o in calo con recupero percepito buono: il recupero da solo non lo spiega (valuta volume, tecnica, alimentazione).' : 'Progressione ferma o in calo con recupero percepito basso: il recupero può contribuire (compatibile, non dimostrato).');
  const data = { last7, prev7, regularity: reg, entries: recent.length };
  if (flags.length) return insight('recovery', 'Recupero', 'attenzione', `Segnali di recupero da guardare: ${flags.join(', ')}.`, { evidence: ev, action: 'Per una settimana proteggi il sonno (orari fissi, 7–9 h), evita di aggiungere volume e controlla le note del periodo; se persiste, valuta una settimana di scarico.', data });
  return insight('recovery', 'Recupero', 'ok', `Recupero percepito in linea${last7.index != null ? ` (indice ${last7.index}/100)` : ''}.`, { evidence: ev, data });
}
