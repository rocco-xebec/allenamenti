// Schede iniziali (dal documento "Scheda gambe B — palestra"). Vengono caricate solo al primo avvio.
export const SEED_TEXT = `
Riscaldamento
1. Cyclette 5 min a ritmo leggero.
2. Glute bridge isometrico sinistro: 2 × 30 secondi.
3. Squat a corpo libero: 2 × 10, ampiezza confortevole.
4. Due serie di avvicinamento sul primo esercizio, al 50% e al 70% del carico di lavoro.
Scheda A
Esercizio	Serie × ripetizioni	Esecuzione	Recupero	Carico
Squat	3 × 6	Bacino e peso centrati, nessuno spostamento verso destra	2–3 min	82 kg
Stacco	3 × 5	Schiena neutra, bilanciere vicino alle tibie	2,5 min	90 kg
Leg extension sinistra	4 × 10	Discesa lenta in 3 secondi, non forzare il blocco in estensione completa se senti il tendine rotuleo	90 s	23 kg
Bulgarian split squat	4 × 10	Discesa controllata in 3 secondi	90 s	16 kg per mano
RDL	2 × 8	Schiena neutra, discesa fino a metà tibia	2 min	10 kg
Scheda B
Esercizio	Serie × ripetizioni	Esecuzione	Recupero	Carico
A. Leg press monolaterale	SX 4 × 8 a RIR 2, DX 2 × 8	Discesa lenta in 3 secondi, spinta controllata	2 min	60 kg
B. Leg extension esplosiva	SX 4 × 6, DX 2 x 6	Spinta veloce, discesa in 3 secondi, circa 60% del massimale	2 min	22 kg
C. Hack squat	3 × 8 a RIR 2	Schiena appoggiata, discesa fino a 90° senza rimbalzo	2 min	70 kg
D. Leg curl da seduto	3 × 10	Schienale regolato, ginocchio sull'asse della macchina, discesa in 3 secondi	90 s	20 kg
E. Step-up con manubri	3 × 8 	Gradino 30 cm, ginocchio sinistro sopra l'alluce	90 s	10 + 10 kg
Scheda C: Padel Upper Body + Core (1× a settimana)
Riscaldamento (10 min)
1. Vogatore per 5 min
2.Circuito con elastico, 2 giri: band pull-apart × 15, rotazioni esterne × 12 per lato, scapular push-up × 10
3. woodchop  con cavo o elastico × 10 per lato
Esercizio	Serie × ripetizioni	Note	Recupero	Carico
A1. Incline dumbbell press 	3 × 8	Potenza di colpo ed equilibrio della spalla	-	20 kg
A2. Chest-supported row o seated cable row	3 × 10	Scapole addotte, nessuna spinta dal busto	75 s	20 kg
B1. Cable woodchop	3 × 10 per lato		—	14 kg
B2. Pallof press	3 × 12 per lato		60 s	14 kg
C1. Half-kneeling single-arm DB overhead press	3 × 8 per lato	Braccio opposto alla gamba inginocchiata	—	12 kg
C2. Lat pulldown (presa neutra o semi-supina)	3 × 10		75s	41 kg
D1. Farmer's carries	3 × 40 s		—	32 kg
D2. Wrist flexion + extension	2 × 15 		—	—
E. Hanging knee raise	3 x 12	Finisher	60s	—
Finisher opzionale (core atletico, se hai tempo): hanging knee raises o captain's chair.
Organizzazione settimanale
Metti le due sedute di gambe con almeno 48 ore di distanza, per esempio lunedì e giovedì.
`;

export const DEFAULT_SETTINGS = {
  googleClientId: '',
  calendarIds: ['primary'],
  calendarLookbackDays: 60,
  // parole chiave nel titolo dell'evento -> tipo di attività
  keywords: {
    padel: ['padel'],
    tennis: ['tennis'],
    corsa: ['corsa', 'running', 'run'],
    palestra: ['palestra', 'gym'],
  },
  weightStep: 2.5,
  lastBackup: null,
};

export const TYPE_LABEL = {
  palestra: 'Palestra', padel: 'Padel', tennis: 'Tennis', corsa: 'Corsa', camminata: 'Camminata',
  bici: 'Bici', nuoto: 'Nuoto', altro: 'Altro',
};
export const TYPE_ICON = {
  palestra: '🏋️', padel: '🎾', tennis: '🎾', corsa: '🏃', camminata: '🚶', bici: '🚴', nuoto: '🏊', altro: '⚡',
};
