// L'applicazione desktop di Darkroom.
//
// Non e' un secondo prodotto: e' lo **stesso** frontend della versione web dentro un
// guscio nativo. Una funzionalita' aggiunta all'interfaccia compare in entrambe senza
// essere scritta due volte, ed e' il motivo per cui qui dentro non c'e' nessuna vista.
//
// La differenza vera fra i due gusci sta in una cosa sola: **il percorso caldo**. Nel
// browser un'anteprima e' una richiesta HTTP al backend, che chiama il motore e
// rimanda i byte indietro. Qui il motore e' nello stesso processo, e i byte non
// attraversano nessuna porta. Su una griglia da duemila scatti sono duemila richieste
// che non partono.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod anteprima;

use anteprima::servi_anteprima;
use darkroom_core::preview;
use std::path::{Path, PathBuf};
use std::process::{Child, Command};
use std::sync::Mutex;
use tauri::Manager;

/// Dove gira il backend. La stessa porta della versione web: l'app non e'
/// un'installazione separata, e' un'altra finestra sullo stesso lavoro.
const PORTA: u16 = 3535;

/// L'altezza della barra in cima, in punti. Deve restare uguale a `ALTEZZA_BARRA`
/// in `client/src/barra.ts`: e' quella la barra su cui centriamo i semafori, e una
/// prova confronta i due numeri perche' separandosi non darebbero nessun errore.
const BARRA_ALTEZZA: f64 = 56.5;

/// L'altezza di un semaforo, misurata sulla finestra vera: 14 punti.
const SEMAFORO_ALTEZZA: f64 = 14.0;

/// Di quanto la posizione chiesta e quella ottenuta non coincidono.
///
/// Wry sposta il contenitore della barra del titolo ma lascia il bottone dov'e'
/// dentro al contenitore, quindi lo spazio sopra il semaforo non e' il numero che
/// si passa: e' quel numero meno questo. Il valore e' MISURATO sulla finestra vera
/// (chiesto 26,25, ottenuto 17,00 di spazio sopra), non dedotto: dedurlo dalle
/// altezze nominali di macOS dava 5 e sbagliava di quattro punti e un quarto.
///
/// Si misura e non si corregge a runtime perche' la posizione si puo' dare solo
/// costruendo la finestra: non esiste un modo pubblico di spostarli dopo.
const SEMAFORO_SOTTO: f64 = 9.25;

/// Il backend avviato da noi, se lo abbiamo avviato noi.
///
/// Se ne trova gia' uno in ascolto non se ne apre un secondo: due server sullo stesso
/// database sarebbero due code di lavori che non si vedono.
struct BackendNostro(Mutex<Option<Child>>);

/// La radice del progetto: quella che contiene `package.json` e `server/`.
///
/// Si sale dall'eseguibile finche' non la si trova. Darkroom e' uno strumento locale:
/// il progetto installato *e'* l'applicazione, e il guscio ci gira sopra invece di
/// portarselo dentro.
fn radice_progetto() -> Option<PathBuf> {
    if let Ok(d) = std::env::var("DARKROOM_HOME") {
        let p = PathBuf::from(d);
        if p.join("package.json").exists() {
            return Some(p);
        }
    }
    let mut dir = std::env::current_exe().ok()?;
    for _ in 0..8 {
        if !dir.pop() {
            break;
        }
        if dir.join("package.json").exists() && dir.join("server").is_dir() {
            return Some(dir.clone());
        }
    }
    // In sviluppo si parte da `app/`, quindi la radice e' il genitore.
    let cwd = std::env::current_dir().ok()?;
    for candidato in [cwd.clone(), cwd.parent()?.to_path_buf()] {
        if candidato.join("package.json").exists() && candidato.join("server").is_dir() {
            return Some(candidato);
        }
    }
    None
}

fn backend_risponde() -> bool {
    std::net::TcpStream::connect_timeout(
        &format!("127.0.0.1:{PORTA}").parse().unwrap(),
        std::time::Duration::from_millis(300),
    )
    .is_ok()
}

/// Avvia il backend, se non c'e' gia'.
fn avvia_backend() -> Option<Child> {
    if backend_risponde() {
        eprintln!("[darkroom] backend gia' in ascolto sulla {PORTA}: non ne apro un altro");
        return None;
    }
    let radice = radice_progetto()?;
    eprintln!("[darkroom] avvio il backend da {}", radice.display());
    // `bun` dal PATH: Darkroom lo richiede gia' per la versione web, quindi non e'
    // una dipendenza in piu' -- e' la stessa.
    Command::new("bun")
        .arg("run")
        .arg("server/index.ts")
        .current_dir(&radice)
        .env("PORT", PORTA.to_string())
        .spawn()
        .map_err(|e| eprintln!("[darkroom] bun non si avvia: {e}"))
        .ok()
}

/// Aspetta che il backend risponda, per non mostrare una finestra su una pagina morta.
fn attendi_backend(secondi: u64) -> bool {
    let scadenza = std::time::Instant::now() + std::time::Duration::from_secs(secondi);
    while std::time::Instant::now() < scadenza {
        if backend_risponde() {
            return true;
        }
        std::thread::sleep(std::time::Duration::from_millis(150));
    }
    false
}

/// Quello che il motore sa dire di un file senza decodificarlo.
/// Nell'app si chiede direttamente, senza passare dal backend.
#[tauri::command]
fn diagnosi(file: String) -> Result<serde_json::Value, String> {
    preview::diagnosi(Path::new(&file))
        .map(|d| {
            serde_json::json!({
                "file": d.file,
                "byteFile": d.byte_file,
                "latoLungoIncorporata": d.lato_lungo_incorporata,
                "latoLungoScatto": d.lato_lungo_scatto,
                "orientamento": d.orientamento,
                "anteprimeTrovate": d.anteprime_trovate,
                "livelliServiti": d.livelli_serviti,
            })
        })
        .map_err(|e| e.to_string())
}

/// Dice all'interfaccia che e' dentro l'app, e su quale porta parla il backend.
/**
 * Il trascinamento dal Finder, girato alla pagina come un evento del documento.
 *
 * Tauri manda gia' i suoi `tauri://drag-drop`, ma per ascoltarli la pagina dovrebbe
 * passare dall'API del guscio e dai suoi permessi; e soprattutto sarebbero raggiungibili
 * solo li'. Un evento del documento invece e' una cosa che il browser conosce: la parte
 * che decide cosa fare con le cartelle e' codice normale, si prova senza aprire
 * l'applicazione, e nella versione web semplicemente non arriva mai.
 *
 * I percorsi sono quelli veri sul disco -- e' l'unica cosa che il browser non puo' dare,
 * ed e' esattamente cio' che serve: Darkroom non copia le fotografie, le indirizza.
 */
fn inoltra_trascinamento(finestra: &tauri::WebviewWindow) {
    let eco = finestra.clone();
    finestra.on_webview_event(move |evento| {
        // `WebviewEvent` e' dichiarato aperto a nuove varianti: quelle che non
        // conosciamo si lasciano passare invece di far finta che non esistano.
        let tauri::WebviewEvent::DragDrop(trascinamento) = evento else { return };
        let dettaglio = match trascinamento {
            tauri::DragDropEvent::Enter { paths, .. } => {
                serde_json::json!({ "fase": "entra", "percorsi": percorsi(paths) })
            }
            tauri::DragDropEvent::Drop { paths, .. } => {
                serde_json::json!({ "fase": "lascia", "percorsi": percorsi(paths) })
            }
            tauri::DragDropEvent::Leave => {
                serde_json::json!({ "fase": "esce", "percorsi": Vec::<String>::new() })
            }
            // `Over` arriva a ogni movimento del mouse: la pagina non ne fa niente,
            // e girarne uno per fotogramma sarebbe solo lavoro.
            _ => return,
        };
        let _ = eco.eval(&js_trascinamento(&dettaglio));
    });
}

/// L'evento, scritto come lo esegue la pagina.
///
/// `to_string` di serde produce JSON, che e' anche un'espressione JavaScript valida:
/// non si concatena niente a mano, quindi non c'e' niente che un nome di file con un
/// apice o una virgoletta possa rompere. E' l'unico punto in cui il guscio scrive del
/// codice invece di dati, ed e' per questo che sta da solo e ha una prova sua.
fn js_trascinamento(dettaglio: &serde_json::Value) -> String {
    format!("window.dispatchEvent(new CustomEvent('darkroom:trascinamento',{{detail:{dettaglio}}}))")
}

fn percorsi(elenco: &[std::path::PathBuf]) -> Vec<String> {
    elenco.iter().map(|p| p.to_string_lossy().into_owned()).collect()
}

#[tauri::command]
fn ambiente() -> serde_json::Value {
    serde_json::json!({
        "guscio": "desktop",
        "porta": PORTA,
        "versione": env!("CARGO_PKG_VERSION"),
        "radice": radice_progetto().map(|p| p.to_string_lossy().into_owned()),
    })
}

fn main() {
    let figlio = avvia_backend();
    if !attendi_backend(20) {
        eprintln!("[darkroom] il backend non risponde: la finestra si aprira' comunque");
    }

    tauri::Builder::default()
        .manage(BackendNostro(Mutex::new(figlio)))
        .setup(|app| {
            // La finestra si costruisce qui e non nella configurazione perche' solo
            // cosi' si puo' iniettare uno script **prima** che la pagina carichi.
            //
            // Serve perche' l'interfaccia deve sapere di essere dentro
            // l'applicazione gia' al primo disegno: e' lei a lasciare lo spazio per
            // i semafori, che senza barra del titolo stanno sopra il contenuto.
            // Indovinarlo da una variabile globale non basta -- quali variabili
            // esistano dipende dalla versione e dalla configurazione -- e sbagliare
            // non da' un errore, da' il nome dell'applicazione scritto sotto i tre
            // bottoni.
            let finestra = tauri::WebviewWindowBuilder::new(
                app,
                "principale",
                tauri::WebviewUrl::default(),
            )
            .title("Darkroom")
            .inner_size(1440.0, 900.0)
            .min_inner_size(900.0, 600.0)
            // Lo script gira a documento ancora vuoto: `document.documentElement`
            // li' non esiste, e scriverci sopra fallisce in silenzio -- e' esattamente
            // cosi' che il marcatore non arrivava mai e l'interfaccia si comportava da
            // browser. La variabile globale invece c'e' sempre; l'attributo si mette
            // appena il documento c'e', per chi preferisce leggerlo dal CSS.
            .initialization_script(
                r#"
                window.__DARKROOM_GUSCIO__ = 'desktop';
                (function () {
                  function marca() {
                    try { document.documentElement.dataset.guscio = 'desktop'; } catch (e) {}
                  }
                  marca();
                  document.addEventListener('DOMContentLoaded', marca);
                })();
                "#,
            );

            #[cfg(target_os = "macos")]
            let finestra = finestra
                .title_bar_style(tauri::TitleBarStyle::Overlay)
                .hidden_title(true)
                // Centrati sulla barra, non appoggiati al soffitto della finestra.
                // Senza questa riga macOS li mette dove andrebbero in una barra del
                // titolo da 28 punti, che non e' la nostra: restavano in alto, e
                // accanto a loro il nome dell'applicazione stava dodici punti piu'
                // in basso.
                .traffic_light_position(tauri::LogicalPosition::new(
                    20.0,
                    (BARRA_ALTEZZA - SEMAFORO_ALTEZZA) / 2.0 + SEMAFORO_SOTTO,
                ));

            let finestra = finestra.build()?;
            inoltra_trascinamento(&finestra);
            Ok(())
        })
        .register_uri_scheme_protocol("anteprima", |_ctx, request| {
            servi_anteprima(&request.uri().to_string())
        })
        .invoke_handler(tauri::generate_handler![diagnosi, ambiente])
        .on_window_event(|finestra, evento| {
            if let tauri::WindowEvent::Destroyed = evento {
                // Il backend che abbiamo avviato noi si chiude con noi. Quello che
                // c'era gia' non si tocca: non e' nostro.
                if let Some(stato) = finestra.app_handle().try_state::<BackendNostro>() {
                    if let Ok(mut b) = stato.0.lock() {
                        if let Some(mut c) = b.take() {
                            let _ = c.kill();
                        }
                    }
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("l'applicazione non parte");
}

#[cfg(test)]
mod prove_trascinamento {
    use super::*;

    /// Un apice in un nome di cartella non deve chiudere la stringa JavaScript.
    ///
    /// E' il modo classico in cui un `eval` costruito a mano smette di essere un
    /// evento e diventa codice: qui la difesa non e' una regola di scrittura, e'
    /// che il dettaglio passa da serde e non da `format!`.
    #[test]
    fn un_apice_nel_percorso_non_rompe_l_evento() {
        let dettaglio = serde_json::json!({
            "fase": "lascia",
            "percorsi": percorsi(&[std::path::PathBuf::from("/Users/x/L'estate \"2026\"")]),
        });
        let js = js_trascinamento(&dettaglio);
        // Il percorso arriva intero e sfuggito, non spezzato a meta'.
        assert!(js.contains(r#"L'estate \"2026\""#), "js: {js}");
        // E niente e' evaso dalla stringa: dopo il dettaglio c'e' solo la chiusura.
        assert!(js.ends_with("}))"), "js: {js}");
        assert_eq!(js.matches("dispatchEvent").count(), 1);
    }

    #[test]
    fn i_percorsi_diventano_testo_anche_quando_non_sono_utf8_puro() {
        let v = percorsi(&[
            std::path::PathBuf::from("/a/b"),
            std::path::PathBuf::from("/c"),
        ]);
        assert_eq!(v, vec!["/a/b".to_string(), "/c".to_string()]);
    }

    /// I semafori devono finire in mezzo alla barra, non appoggiati al soffitto.
    #[test]
    fn i_semafori_stanno_al_centro_della_barra() {
        let y = (BARRA_ALTEZZA - SEMAFORO_ALTEZZA) / 2.0 + SEMAFORO_SOTTO;
        let sopra = y - SEMAFORO_SOTTO;
        let sotto = BARRA_ALTEZZA - sopra - SEMAFORO_ALTEZZA;
        assert!((sopra - sotto).abs() < 1e-9, "sopra {sopra}, sotto {sotto}");
    }
}
