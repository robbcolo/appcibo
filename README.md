# Piano alimentare

Web app (PWA) per seguire il piano alimentare pasto dopo pasto. Funziona sull'iPhone come una vera app, anche offline, e salva i dati solo sul telefono.

## Come pubblicarla su GitHub Pages

1. Carica tutti i file di questa cartella nel repository (branch `main`, nella radice).
2. Su GitHub: **Settings → Pages**.
3. In **Build and deployment** scegli **Source: Deploy from a branch**, branch **main**, cartella **/ (root)**, poi **Save**.
4. Dopo 1-2 minuti l'app è online su `https://TUO-UTENTE.github.io/NOME-REPO/`.

## Come metterla nella Home dell'iPhone

1. Apri l'indirizzo qui sopra **con Safari** (non con Chrome).
2. Tocca il tasto **Condividi** (il quadrato con la freccia).
3. Scegli **Aggiungi alla schermata Home** e poi **Aggiungi**.
4. Apri l'app dall'icona nella Home: parte a schermo intero.

## Cose da sapere

- **I dati restano nel telefono**, dentro l'app installata. Quelli inseriti nella pagina aperta in Safari *non* passano all'app della Home: usa sempre l'icona.
- Se elimini l'app o cambi telefono i dati si perdono. Da **Altro → Salva un backup** esporti un file (salvalo in File o iCloud Drive); con **Ripristina da un backup** lo reimporti. L'app ti ricorda il backup dopo 7 giorni.
- Per aggiornare l'app dopo una modifica al repository: chiudila e riaprila (con internet). Se non cambia nulla: **Altro → Aggiorna l'app**.
- Ricerca online dei prodotti: [Open Food Facts](https://world.openfoodfacts.org) (dati inseriti dagli utenti, da verificare con l'etichetta).

## Struttura

- `index.html`, `styles.css`, `app.js`: interfaccia e logica
- `foods.js`: catalogo alimenti, piatti e giornate tipo
- `sw.js`, `manifest.webmanifest`, `icons/`: parte PWA (installazione e offline)
