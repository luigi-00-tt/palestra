# Palestra

App web per l'allenamento in sala pesi e per il diario alimentare. Un **unico file**
`index.html`, senza dipendenze esterne e senza server: si può aggiungere alla schermata
Home del telefono e funziona anche senza rete.

**Aprila qui:** https://luigi-00-tt.github.io/palestra/

## Cosa fa

- **Scheda di allenamento** full body su tre sedute, organizzata in blocchi da sei settimane
  che ruotano da soli. Ogni esercizio ha due fotografie (posizione di partenza e di arrivo),
  il setup della macchina, la tecnica, gli errori tipici e un'alternativa se la postazione è
  occupata.
- **Registro delle serie** con timer di recupero automatico, suggerimento di progressione a
  doppia progressione e storico dei carichi.
- **Serie di avvicinamento** calcolate in chilogrammi sull'ultimo carico registrato, dentro
  gli esercizi in cui vanno fatte.
- **Diario alimentare** con **lettore di codici a barre** (`BarcodeDetector`, API nativa del
  browser): si scansiona la confezione, si scrivono i grammi e i macronutrienti si calcolano
  da soli. I valori arrivano da [Open Food Facts](https://world.openfoodfacts.org/); se un
  prodotto non c'è, si inseriscono a mano una volta sola e restano nell'archivio personale.
  Per gli alimenti sfusi c'è un elenco di 158 voci con i valori delle tabelle CREA.
- **Progressi**: carichi per esercizio, volume settimanale per gruppo muscolare e durata reale
  delle sedute.

## Privacy

Non c'è nessun server e non c'è nessun account. Tutto quello che si registra — profilo, carichi,
diario, prodotti — resta nel `localStorage` del browser, cioè **solo sul dispositivo che si sta
usando**, e non viene mai spedito da nessuna parte. Il profilo (peso, altezza, data di nascita)
viene chiesto al primo avvio e serve unicamente al calcolo del fabbisogno calorico.

L'unica richiesta di rete che l'app può fare è a Open Food Facts, e solo quando si scansiona un
codice a barre mai visto prima. La fotocamera si attiva soltanto durante la scansione e le
immagini non lasciano il dispositivo: vengono analizzate dal browser e basta.

## Licenza e crediti

- Le fotografie degli esercizi vengono da
  [free-exercise-db](https://github.com/yuhonas/free-exercise-db), pubblico dominio
  (licenza Unlicense), ridimensionate e incorporate nel file.
- I valori nutrizionali degli alimenti sfusi vengono dalle tabelle di composizione degli
  alimenti del **CREA**, integrate con USDA FoodData Central; quelli dei prodotti confezionati
  da **Open Food Facts** (Open Database License).
- I contenuti su allenamento e alimentazione si appoggiano a una rassegna della letteratura
  scientifica costruita apposta. **Non sono un consiglio medico**: le parti che riguardano
  disturbi gastrointestinali sono informative e non sostituiscono il parere di un medico.

## Sviluppo

Il file `index.html` è generato: si assembla dai sorgenti con `node app/build.js` nel progetto
da cui questa cartella proviene. Non va modificato a mano.
