# Allenamenti

Web app personale (PWA) per iPhone: schede di palestra, attività da Google Calendar e Apple Watch, report settimanali e mensili con esportazione PDF.

- Nessun server: i dati restano sull'iPhone (IndexedDB). Backup manuale in JSON su iCloud Drive (Altro → Esporta backup).
- Funziona offline una volta installata (Safari → Condividi → Aggiungi alla schermata Home).
- Google Calendar in sola lettura con OAuth nel browser: serve un Client ID (vedi la Guida nell'app).
- Allenamenti di Fitness / Apple Watch: import dell'export dell'app Salute (`esportazione.zip`), letto in streaming nel browser (`js/health.js`). Accetta anche il JSON di Health Auto Export.

## Struttura
- `index.html`, `css/app.css`
- `js/app.js` interfaccia e flussi · `js/stats.js` calcoli e abbinamento calendario/Watch · `js/parse.js` import schede e attività
- `js/muscles.js` mappa esercizio → muscoli · `js/pdf.js` report PDF · `js/gcal.js` Google Calendar · `js/db.js` salvataggio
- `sw.js` cache offline: aumenta `VERSION` a ogni modifica.

## Formato import testo (una riga per allenamento)
`W;tipo;inizio;fine;durata_min;kcal;km;fc` — `C;titolo;inizio;fine` per eventi di calendario.
